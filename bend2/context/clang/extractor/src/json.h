// Minimal strict JSON for the context-clang-20 extractor's private contract.
// Supports objects, arrays, strings, integers, booleans and null. Numbers are
// admitted only as integer tokens stored losslessly in int64_t. Unknown object
// members refuse at the contract layer; this module supplies the tree.
#ifndef CONTEXT_CLANG_JSON_H
#define CONTEXT_CLANG_JSON_H

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace ctxclang {

class Json;
using JsonArray = std::vector<Json>;
// Members keep insertion order; duplicates refuse during parse.
using JsonObject = std::vector<std::pair<std::string, Json>>;

class Json {
public:
  enum class Kind { Null, Bool, Int, String, Array, Object };

  Json() : Kind_(Kind::Null) {}
  static Json null() { return Json(); }
  static Json boolean(bool V) { Json J; J.Kind_ = Kind::Bool; J.Bool_ = V; return J; }
  static Json integer(int64_t V) { Json J; J.Kind_ = Kind::Int; J.Int_ = V; return J; }
  static Json str(std::string V) { Json J; J.Kind_ = Kind::String; J.Str_ = std::move(V); return J; }
  static Json array(JsonArray V) { Json J; J.Kind_ = Kind::Array; J.Arr_ = std::move(V); return J; }
  static Json object(JsonObject V) { Json J; J.Kind_ = Kind::Object; J.Obj_ = std::move(V); return J; }

  Kind kind() const { return Kind_; }
  bool isNull() const { return Kind_ == Kind::Null; }
  bool asBool() const { return Bool_; }
  int64_t asInt() const { return Int_; }
  const std::string &asString() const { return Str_; }
  const JsonArray &asArray() const { return Arr_; }
  const JsonObject &asObject() const { return Obj_; }

  // Object member lookup; nullptr when absent or not an object.
  const Json *find(const std::string &Key) const;

  // Strict parser. Returns false and fills Error on any malformed input,
  // including trailing bytes, control characters and duplicate members.
  static bool parse(const std::string &Text, Json &Out, std::string &Error);

  // Writer. Emits compact UTF-8 with minimal escaping.
  std::string dump() const;

private:
  Kind Kind_;
  bool Bool_ = false;
  int64_t Int_ = 0;
  std::string Str_;
  JsonArray Arr_;
  JsonObject Obj_;
};

std::string jsonEscape(const std::string &S);

} // namespace ctxclang

#endif
