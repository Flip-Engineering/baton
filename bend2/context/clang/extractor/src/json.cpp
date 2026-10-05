#include "json.h"

#include <cctype>
#include <cerrno>
#include <cstdio>
#include <set>

namespace ctxclang {

const Json *Json::find(const std::string &Key) const {
  if (Kind_ != Kind::Object)
    return nullptr;
  for (const auto &M : Obj_)
    if (M.first == Key)
      return &M.second;
  return nullptr;
}

namespace {

struct Parser {
  const std::string &T;
  size_t P = 0;
  std::string Error;

  explicit Parser(const std::string &Text) : T(Text) {}

  bool done() const { return P >= T.size(); }
  char peek() const { return T[P]; }

  void skipWs() {
    while (P < T.size()) {
      char C = T[P];
      if (C == ' ' || C == '\t' || C == '\n' || C == '\r')
        ++P;
      else
        break;
    }
  }

  bool parseValue(Json &Out) {
    skipWs();
    if (done()) {
      Error = "unexpected end of input";
      return false;
    }
    char C = peek();
    if (C == '{')
      return parseObject(Out);
    if (C == '[')
      return parseArray(Out);
    if (C == '"')
      return parseString(Out);
    if (C == 't') {
      if (T.compare(P, 4, "true") != 0) {
        Error = "bad literal";
        return false;
      }
      P += 4;
      Out = Json::boolean(true);
      return true;
    }
    if (C == 'f') {
      if (T.compare(P, 5, "false") != 0) {
        Error = "bad literal";
        return false;
      }
      P += 5;
      Out = Json::boolean(false);
      return true;
    }
    if (C == 'n') {
      if (T.compare(P, 4, "null") != 0) {
        Error = "bad literal";
        return false;
      }
      P += 4;
      Out = Json::null();
      return true;
    }
    return parseNumber(Out);
  }

  bool parseNumber(Json &Out) {
    size_t Start = P;
    if (P < T.size() && T[P] == '-')
      ++P;
    if (P >= T.size() || !std::isdigit(static_cast<unsigned char>(T[P]))) {
      Error = "bad number";
      return false;
    }
    if (T[P] == '0') {
      ++P;
      if (P < T.size() && std::isdigit(static_cast<unsigned char>(T[P]))) {
        Error = "leading zero";
        return false;
      }
    } else {
      while (P < T.size() && std::isdigit(static_cast<unsigned char>(T[P])))
        ++P;
    }
    if (P < T.size() && (T[P] == '.' || T[P] == 'e' || T[P] == 'E')) {
      Error = "fractional or exponent numbers refuse";
      return false;
    }
    std::string Tok = T.substr(Start, P - Start);
    // Range check into int64 without locale-dependent parsing.
    errno = 0;
    char *EndP = nullptr;
    long long V = std::strtoll(Tok.c_str(), &EndP, 10);
    if (errno != 0 || EndP != Tok.c_str() + Tok.size()) {
      Error = "number out of range";
      return false;
    }
    Out = Json::integer(static_cast<int64_t>(V));
    return true;
  }

  bool parseHex4(unsigned &Out) {
    if (P + 4 > T.size()) {
      Error = "bad \\u escape";
      return false;
    }
    unsigned V = 0;
    for (int I = 0; I < 4; ++I) {
      char C = T[P + I];
      V <<= 4;
      if (C >= '0' && C <= '9')
        V |= static_cast<unsigned>(C - '0');
      else if (C >= 'a' && C <= 'f')
        V |= static_cast<unsigned>(C - 'a' + 10);
      else if (C >= 'A' && C <= 'F')
        V |= static_cast<unsigned>(C - 'A' + 10);
      else {
        Error = "bad \\u escape digit";
        return false;
      }
    }
    P += 4;
    Out = V;
    return true;
  }

  static void appendUtf8(std::string &S, unsigned CP) {
    if (CP < 0x80) {
      S.push_back(static_cast<char>(CP));
    } else if (CP < 0x800) {
      S.push_back(static_cast<char>(0xC0 | (CP >> 6)));
      S.push_back(static_cast<char>(0x80 | (CP & 0x3F)));
    } else if (CP < 0x10000) {
      S.push_back(static_cast<char>(0xE0 | (CP >> 12)));
      S.push_back(static_cast<char>(0x80 | ((CP >> 6) & 0x3F)));
      S.push_back(static_cast<char>(0x80 | (CP & 0x3F)));
    } else {
      S.push_back(static_cast<char>(0xF0 | (CP >> 18)));
      S.push_back(static_cast<char>(0x80 | ((CP >> 12) & 0x3F)));
      S.push_back(static_cast<char>(0x80 | ((CP >> 6) & 0x3F)));
      S.push_back(static_cast<char>(0x80 | (CP & 0x3F)));
    }
  }

  bool parseString(Json &Out) {
    ++P; // opening quote
    std::string S;
    while (true) {
      if (done()) {
        Error = "unterminated string";
        return false;
      }
      unsigned char C = static_cast<unsigned char>(T[P]);
      if (C == '"') {
        ++P;
        Out = Json::str(std::move(S));
        return true;
      }
      if (C < 0x20) {
        Error = "control character in string";
        return false;
      }
      if (C == '\\') {
        ++P;
        if (done()) {
          Error = "bad escape";
          return false;
        }
        char E = T[P++];
        switch (E) {
        case '"': S.push_back('"'); break;
        case '\\': S.push_back('\\'); break;
        case '/': S.push_back('/'); break;
        case 'b': S.push_back('\b'); break;
        case 'f': S.push_back('\f'); break;
        case 'n': S.push_back('\n'); break;
        case 'r': S.push_back('\r'); break;
        case 't': S.push_back('\t'); break;
        case 'u': {
          unsigned U;
          if (!parseHex4(U))
            return false;
          if (U >= 0xD800 && U <= 0xDBFF) {
            if (P + 1 < T.size() && T[P] == '\\' && T[P + 1] == 'u') {
              P += 2;
              unsigned L;
              if (!parseHex4(L))
                return false;
              if (L < 0xDC00 || L > 0xDFFF) {
                Error = "bad surrogate pair";
                return false;
              }
              unsigned CP = 0x10000 + ((U - 0xD800) << 10) + (L - 0xDC00);
              appendUtf8(S, CP);
            } else {
              Error = "lone high surrogate";
              return false;
            }
          } else if (U >= 0xDC00 && U <= 0xDFFF) {
            Error = "lone low surrogate";
            return false;
          } else {
            appendUtf8(S, U);
          }
          break;
        }
        default:
          Error = "unknown escape";
          return false;
        }
        continue;
      }
      S.push_back(static_cast<char>(C));
      ++P;
    }
  }

  bool parseArray(Json &Out) {
    ++P;
    JsonArray A;
    skipWs();
    if (!done() && peek() == ']') {
      ++P;
      Out = Json::array(std::move(A));
      return true;
    }
    while (true) {
      Json V;
      if (!parseValue(V))
        return false;
      A.push_back(std::move(V));
      skipWs();
      if (done()) {
        Error = "unterminated array";
        return false;
      }
      if (peek() == ',') {
        ++P;
        continue;
      }
      if (peek() == ']') {
        ++P;
        Out = Json::array(std::move(A));
        return true;
      }
      Error = "expected , or ]";
      return false;
    }
  }

  bool parseObject(Json &Out) {
    ++P;
    JsonObject O;
    std::set<std::string> Keys;
    skipWs();
    if (!done() && peek() == '}') {
      ++P;
      Out = Json::object(std::move(O));
      return true;
    }
    while (true) {
      skipWs();
      if (done() || peek() != '"') {
        Error = "expected member name";
        return false;
      }
      Json KeyV;
      if (!parseString(KeyV))
        return false;
      const std::string &Key = KeyV.asString();
      if (!Keys.insert(Key).second) {
        Error = "duplicate member " + Key;
        return false;
      }
      skipWs();
      if (done() || peek() != ':') {
        Error = "expected : after member name";
        return false;
      }
      ++P;
      Json V;
      if (!parseValue(V))
        return false;
      O.push_back({Key, std::move(V)});
      skipWs();
      if (done()) {
        Error = "unterminated object";
        return false;
      }
      if (peek() == ',') {
        ++P;
        continue;
      }
      if (peek() == '}') {
        ++P;
        Out = Json::object(std::move(O));
        return true;
      }
      Error = "expected , or }";
      return false;
    }
  }
};

} // namespace

bool Json::parse(const std::string &Text, Json &Out, std::string &Error) {
  Parser P(Text);
  if (!P.parseValue(Out)) {
    Error = P.Error.empty() ? "parse failure" : P.Error;
    return false;
  }
  P.skipWs();
  if (!P.done()) {
    Error = "trailing bytes after document";
    return false;
  }
  return true;
}

std::string jsonEscape(const std::string &S) {
  std::string O;
  O.push_back('"');
  for (unsigned char C : S) {
    switch (C) {
    case '"': O += "\\\""; break;
    case '\\': O += "\\\\"; break;
    case '\b': O += "\\b"; break;
    case '\f': O += "\\f"; break;
    case '\n': O += "\\n"; break;
    case '\r': O += "\\r"; break;
    case '\t': O += "\\t"; break;
    default:
      if (C < 0x20) {
        char Buf[8];
        std::snprintf(Buf, sizeof(Buf), "\\u%04x", C);
        O += Buf;
      } else {
        O.push_back(static_cast<char>(C));
      }
    }
  }
  O.push_back('"');
  return O;
}

std::string Json::dump() const {
  switch (Kind_) {
  case Kind::Null:
    return "null";
  case Kind::Bool:
    return Bool_ ? "true" : "false";
  case Kind::Int: {
    char Buf[32];
    std::snprintf(Buf, sizeof(Buf), "%lld", static_cast<long long>(Int_));
    return Buf;
  }
  case Kind::String:
    return jsonEscape(Str_);
  case Kind::Array: {
    std::string O = "[";
    bool First = true;
    for (const auto &V : Arr_) {
      if (!First)
        O.push_back(',');
      First = false;
      O += V.dump();
    }
    O.push_back(']');
    return O;
  }
  case Kind::Object: {
    std::string O = "{";
    bool First = true;
    for (const auto &M : Obj_) {
      if (!First)
        O.push_back(',');
      First = false;
      O += jsonEscape(M.first);
      O.push_back(':');
      O += M.second.dump();
    }
    O.push_back('}');
    return O;
  }
  }
  return "null";
}

} // namespace ctxclang
