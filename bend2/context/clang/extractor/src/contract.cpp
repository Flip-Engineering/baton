#include "contract.h"

#include <map>
#include <set>

namespace ctxclang {

namespace {

void fail(std::string &Error, const std::string &Reason) { Error = Reason; }

bool decodeString(const Json &V, std::string &Out, std::string &Error,
                  const char *Field) {
  if (V.kind() != Json::Kind::String) {
    fail(Error, std::string(Field) + " must be a string");
    return false;
  }
  Out = V.asString();
  return true;
}

bool decodeInt(const Json &V, int64_t &Out, std::string &Error,
               const char *Field) {
  if (V.kind() != Json::Kind::Int) {
    fail(Error, std::string(Field) + " must be an integer");
    return false;
  }
  Out = V.asInt();
  return true;
}

} // namespace

bool Input::decode(const Json &Doc, Input &Out, std::string &Error) {
  if (Doc.kind() != Json::Kind::Object) {
    fail(Error, "input must be an object");
    return false;
  }
  std::set<std::string> seen;
  for (const auto &M : Doc.asObject()) {
    if (!seen.insert(M.first).second) {
      fail(Error, "duplicate member " + M.first);
      return false;
    }
  }
  const Json *Version = Doc.find("version");
  if (!Version || Version->kind() != Json::Kind::Int || Version->asInt() != 1) {
    fail(Error, "version must equal 1");
    return false;
  }
  const Json *Op = Doc.find("operation");
  if (!Op || Op->kind() != Json::Kind::String) {
    fail(Error, "operation must be a string");
    return false;
  }
  if (Op->asString() == "handlerAnalysis")
    Out.operation = Operation::HandlerAnalysis;
  else if (Op->asString() == "functionSignature")
    Out.operation = Operation::FunctionSignature;
  else {
    fail(Error, "unknown operation " + Op->asString());
    return false;
  }
  const Json *Dir = Doc.find("directory");
  if (!Dir || !decodeString(*Dir, Out.directory, Error, "directory"))
    return false;
  const Json *File = Doc.find("file");
  if (!File || !decodeString(*File, Out.file, Error, "file"))
    return false;
  const Json *Args = Doc.find("arguments");
  if (!Args || Args->kind() != Json::Kind::Array) {
    fail(Error, "arguments must be an array");
    return false;
  }
  for (const Json &A : Args->asArray()) {
    std::string S;
    if (!decodeString(A, S, Error, "arguments[i]"))
      return false;
    Out.arguments.push_back(S);
  }
  const Json *Subj = Doc.find("subject");
  if (!Subj || Subj->kind() != Json::Kind::Object) {
    fail(Error, "subject must be an object");
    return false;
  }
  const Json *Kind = Subj->find("kind");
  if (!Kind || Kind->kind() != Json::Kind::String) {
    fail(Error, "subject.kind must be a string");
    return false;
  }
  if (Kind->asString() == "position") {
    Out.subject.kind = Subject::Kind::Position;
  } else if (Kind->asString() == "symbol") {
    Out.subject.kind = Subject::Kind::Symbol;
  } else {
    fail(Error, "unknown subject.kind " + Kind->asString());
    return false;
  }
  const Json *P = Subj->find("path");
  if (!P || !decodeString(*P, Out.subject.path, Error, "subject.path"))
    return false;
  if (Out.subject.kind == Subject::Kind::Position) {
    if (!decodeInt(*Subj->find("line"), Out.subject.line, Error,
                   "subject.line"))
      return false;
    if (!decodeInt(*Subj->find("column"), Out.subject.column, Error,
                   "subject.column"))
      return false;
  } else {
    const Json *N = Subj->find("name");
    if (!N || !decodeString(*N, Out.subject.name, Error, "subject.name"))
      return false;
  }
  const Json *Pairs = Doc.find("pairs");
  if (Pairs) {
    if (Pairs->kind() != Json::Kind::Array) {
      fail(Error, "pairs must be an array");
      return false;
    }
    for (const Json &E : Pairs->asArray()) {
      if (E.kind() != Json::Kind::Object) {
        fail(Error, "pairs[i] must be an object");
        return false;
      }
      FilePair FP;
      const Json *O = E.find("original");
      const Json *G = E.find("generated");
      if (!O || !decodeString(*O, FP.original, Error, "pairs[i].original"))
        return false;
      if (!G || !decodeString(*G, FP.generated, Error, "pairs[i].generated"))
        return false;
      Out.pairs.push_back(FP);
    }
  }
  const Json *Helpers = Doc.find("helpers");
  if (Helpers) {
    if (Helpers->kind() != Json::Kind::Array) {
      fail(Error, "helpers must be an array");
      return false;
    }
    for (const Json &H : Helpers->asArray()) {
      std::string S;
      if (!decodeString(H, S, Error, "helpers[i]"))
        return false;
      Out.helpers.push_back(S);
    }
  }
  // Closed member check: only the declared fields may appear.
  static const std::set<std::string> Allowed = {
      "version", "operation", "directory", "file", "arguments",
      "subject", "pairs",     "helpers"};
  for (const auto &M : Doc.asObject()) {
    if (!Allowed.count(M.first)) {
      fail(Error, "unknown member " + M.first);
      return false;
    }
  }
  return true;
}

Json SpanInfo::toJson() const {
  JsonObject O;
  O.push_back({"file", Json::str(file)});
  O.push_back({"byteStart", Json::integer(byteStart)});
  O.push_back({"byteEnd", Json::integer(byteEnd)});
  O.push_back({"expanded", Json::boolean(expanded)});
  return Json::object(std::move(O));
}

static Json operandToJson(const OperandInfo &Op) {
  JsonObject O;
  O.push_back({"usr", Json::str(Op.usr)});
  O.push_back({"name", Json::str(Op.name)});
  O.push_back({"varKind", Json::str(Op.varKind)});
  O.push_back({"type", Json::str(Op.type)});
  JsonArray Fields;
  for (const auto &F : Op.fields)
    Fields.push_back(Json::str(F));
  O.push_back({"fields", Json::array(std::move(Fields))});
  JsonArray FUsrs;
  for (const auto &F : Op.fieldUsrs)
    FUsrs.push_back(Json::str(F));
  O.push_back({"fieldUsrs", Json::array(std::move(FUsrs))});
  O.push_back({"negated", Json::boolean(Op.negated)});
  O.push_back({"spelling", Op.spelling.toJson()});
  return Json::object(std::move(O));
}

Json Output::toJson() const {
  JsonObject O;
  O.push_back({"version", Json::integer(version)});
  JsonObject Ex;
  Ex.push_back({"name", Json::str(extractorName)});
  Ex.push_back({"version", Json::str(extractorVersion)});
  Ex.push_back({"clangVersion", Json::str(clangVersion)});
  O.push_back({"extractor", Json::object(std::move(Ex))});
  O.push_back({"operation", Json::str(operation)});
  O.push_back({"translationUnit", Json::str(translationUnitPath)});
  O.push_back({"translationUnitSha256", Json::str(translationUnitSha256)});
  JsonArray Inputs;
  for (const auto &C : consumedInputs) {
    JsonObject Cj;
    Cj.push_back({"path", Json::str(C.path)});
    Cj.push_back({"sha256", Json::str(C.sha256)});
    Cj.push_back({"role", Json::str(C.role)});
    Inputs.push_back(Json::object(std::move(Cj)));
  }
  O.push_back({"consumedInputs", Json::array(std::move(Inputs))});
  {
    JsonObject S;
    S.push_back({"name", Json::str(selected.name)});
    S.push_back({"usr", Json::str(selected.usr)});
    S.push_back({"returnType", Json::str(selected.returnType)});
    S.push_back({"variadic", Json::boolean(selected.variadic)});
    JsonArray Fs;
    for (const auto &F : selected.formals) {
      JsonObject Fj;
      Fj.push_back({"name", Json::str(F.name)});
      Fj.push_back({"type", Json::str(F.type)});
      Fj.push_back({"spelling", F.spelling.toJson()});
      Fs.push_back(Json::object(std::move(Fj)));
    }
    S.push_back({"formals", Json::array(std::move(Fs))});
    S.push_back({"body", selected.body.toJson()});
    JsonObject Cor;
    Cor.push_back({"status", Json::str(selected.correspondence.status)});
    Cor.push_back({"original", Json::str(selected.correspondence.original)});
    Cor.push_back({"generated", Json::str(selected.correspondence.generated)});
    Cor.push_back(
        {"originalStart", Json::integer(selected.correspondence.originalStart)});
    Cor.push_back(
        {"originalEnd", Json::integer(selected.correspondence.originalEnd)});
    Cor.push_back({"generatedStart",
                   Json::integer(selected.correspondence.generatedStart)});
    Cor.push_back(
        {"generatedEnd", Json::integer(selected.correspondence.generatedEnd)});
    Cor.push_back(
        {"segmentSha256", Json::str(selected.correspondence.segmentSha256)});
    Cor.push_back({"reason", Json::str(selected.correspondence.reason)});
    S.push_back({"correspondence", Json::object(std::move(Cor))});
    O.push_back({"selectedFunction", Json::object(std::move(S))});
  }
  JsonArray Conds;
  for (const auto &C : conditions) {
    JsonObject Cj;
    Cj.push_back({"id", Json::str(C.id)});
    Cj.push_back({"exprKind", Json::str(C.exprKind)});
    Cj.push_back({"exprText", Json::str(C.exprText)});
    Cj.push_back({"spelling", C.spelling.toJson()});
    Cj.push_back({"expansion", C.expansion.toJson()});
    JsonArray Ops;
    for (const auto &Op : C.operands)
      Ops.push_back(operandToJson(Op));
    Cj.push_back({"operands", Json::array(std::move(Ops))});
    Cj.push_back({"supported", Json::boolean(C.supported)});
    Cj.push_back({"unsupportedReason", Json::str(C.unsupportedReason)});
    Conds.push_back(Json::object(std::move(Cj)));
  }
  O.push_back({"conditions", Json::array(std::move(Conds))});
  JsonArray Calls;
  for (const auto &C : calls) {
    JsonObject Cj;
    Cj.push_back({"id", Json::str(C.id)});
    Cj.push_back({"direct", Json::boolean(C.direct)});
    Cj.push_back({"usr", Json::str(C.usr)});
    Cj.push_back({"name", Json::str(C.name)});
    JsonArray PTs;
    for (const auto &T : C.parameterTypes)
      PTs.push_back(Json::str(T));
    Cj.push_back({"parameterTypes", Json::array(std::move(PTs))});
    Cj.push_back({"calleeUnavailable", Json::boolean(C.calleeUnavailable)});
    Cj.push_back(
        {"calleeUnavailableReason", Json::str(C.calleeUnavailableReason)});
    JsonArray Args;
    for (const auto &A : C.arguments) {
      JsonObject Aj;
      Aj.push_back({"index", Json::integer(A.index)});
      Aj.push_back({"parameterType", Json::str(A.parameterType)});
      Aj.push_back({"spelling", A.spelling.toJson()});
      Args.push_back(Json::object(std::move(Aj)));
    }
    Cj.push_back({"arguments", Json::array(std::move(Args))});
    Cj.push_back({"spelling", C.spelling.toJson()});
    Cj.push_back({"expansion", C.expansion.toJson()});
    Cj.push_back({"blockId", Json::integer(C.blockId)});
    Calls.push_back(Json::object(std::move(Cj)));
  }
  O.push_back({"calls", Json::array(std::move(Calls))});
  JsonArray Rets;
  for (const auto &R : returns) {
    JsonObject Rj;
    Rj.push_back({"id", Json::str(R.id)});
    Rj.push_back({"spelling", R.spelling.toJson()});
    Rj.push_back({"blockId", Json::integer(R.blockId)});
    Rets.push_back(Json::object(std::move(Rj)));
  }
  O.push_back({"returns", Json::array(std::move(Rets))});
  JsonArray Glo;
  for (const auto &G : globals)
    Glo.push_back(operandToJson(G));
  O.push_back({"globals", Json::array(std::move(Glo))});
  {
    JsonObject Cj;
    JsonArray Bs;
    for (const auto &B : cfg.blocks) {
      JsonObject Bj;
      Bj.push_back({"id", Json::integer(B.id)});
      Bj.push_back({"entry", Json::boolean(B.entry)});
      Bj.push_back({"exit", Json::boolean(B.exit)});
      Bj.push_back({"unreachable", Json::boolean(B.unreachable)});
      Bj.push_back({"terminatorKind", Json::str(B.terminatorKind)});
      Bj.push_back({"conditionId", Json::str(B.conditionId)});
      Bj.push_back(
          {"lastConditionOperandId", Json::str(B.lastConditionOperandId)});
      Bs.push_back(Json::object(std::move(Bj)));
    }
    Cj.push_back({"blocks", Json::array(std::move(Bs))});
    JsonArray Es;
    for (const auto &E : cfg.edges) {
      JsonObject Ej;
      Ej.push_back({"from", Json::integer(E.from)});
      Ej.push_back({"to", Json::integer(E.to)});
      Ej.push_back({"label", Json::str(E.label)});
      Es.push_back(Json::object(std::move(Ej)));
    }
    Cj.push_back({"edges", Json::array(std::move(Es))});
    Cj.push_back({"entryId", Json::integer(cfg.entryId)});
    Cj.push_back({"exitId", Json::integer(cfg.exitId)});
    O.push_back({"cfg", Json::object(std::move(Cj))});
  }
  JsonArray Guards;
  for (const auto &G : guards) {
    JsonObject Gj;
    Gj.push_back({"conditionId", Json::str(G.conditionId)});
    Gj.push_back({"callId", Json::str(G.callId)});
    Gj.push_back({"acceptedValue", Json::boolean(G.acceptedValue)});
    Gj.push_back({"status", Json::str(G.status)});
    Gj.push_back({"unavailableReason", Json::str(G.unavailableReason)});
    JsonArray Routes;
    for (const auto &R : G.deniedRoutes) {
      JsonObject Rj;
      JsonArray Ev;
      for (const auto &E : R.evaluated) {
        JsonObject Ej;
        Ej.push_back({"conditionId", Json::str(E.conditionId)});
        Ej.push_back({"operandLeafId", Json::str(E.operandLeafId)});
        Ej.push_back({"outcome", Json::boolean(E.outcome)});
        Ev.push_back(Json::object(std::move(Ej)));
      }
      Rj.push_back({"evaluated", Json::array(std::move(Ev))});
      JsonArray Eds;
      for (int64_t E : R.edges)
        Eds.push_back(Json::integer(E));
      Rj.push_back({"edges", Json::array(std::move(Eds))});
      Rj.push_back({"returnId", Json::str(R.returnId)});
      JsonArray Ics;
      for (const auto &C : R.interveningCalls)
        Ics.push_back(Json::str(C));
      Rj.push_back({"interveningCalls", Json::array(std::move(Ics))});
      Routes.push_back(Json::object(std::move(Rj)));
    }
    Gj.push_back({"deniedRoutes", Json::array(std::move(Routes))});
    JsonArray Cut;
    for (int64_t E : G.cutEdges)
      Cut.push_back(Json::integer(E));
    Gj.push_back({"cutEdges", Json::array(std::move(Cut))});
    JsonArray Aic;
    for (const auto &C : G.acceptedInterveningCalls)
      Aic.push_back(Json::str(C));
    Gj.push_back({"acceptedInterveningCalls", Json::array(std::move(Aic))});
    Guards.push_back(Json::object(std::move(Gj)));
  }
  O.push_back({"guards", Json::array(std::move(Guards))});
  JsonArray Diags;
  for (const auto &D : diagnostics) {
    JsonObject Dj;
    Dj.push_back({"level", Json::str(D.level)});
    Dj.push_back({"message", Json::str(D.message)});
    Dj.push_back({"file", Json::str(D.file)});
    Dj.push_back({"byteStart", Json::integer(D.byteStart)});
    Dj.push_back({"byteEnd", Json::integer(D.byteEnd)});
    Diags.push_back(Json::object(std::move(Dj)));
  }
  O.push_back({"diagnostics", Json::array(std::move(Diags))});
  JsonArray HDefs;
  for (const auto &H : helperDefinitions) {
    JsonObject Hj;
    Hj.push_back({"name", Json::str(H.name)});
    Hj.push_back({"usr", Json::str(H.usr)});
    Hj.push_back({"returnType", Json::str(H.returnType)});
    Hj.push_back({"variadic", Json::boolean(H.variadic)});
    JsonArray Fs;
    for (const auto &F : H.formals) {
      JsonObject Fj;
      Fj.push_back({"name", Json::str(F.name)});
      Fj.push_back({"type", Json::str(F.type)});
      Fj.push_back({"spelling", F.spelling.toJson()});
      Fs.push_back(Json::object(std::move(Fj)));
    }
    Hj.push_back({"formals", Json::array(std::move(Fs))});
    Hj.push_back({"body", H.body.toJson()});
    HDefs.push_back(Json::object(std::move(Hj)));
  }
  O.push_back({"helperDefinitions", Json::array(std::move(HDefs))});
  JsonArray HCands;
  for (const auto &C : helperCandidates) {
    JsonObject Cj;
    Cj.push_back({"callId", Json::str(C.callId)});
    Cj.push_back({"helperName", Json::str(C.helperName)});
    Cj.push_back({"helperUsr", Json::str(C.helperUsr)});
    JsonArray Lits;
    for (const auto &L : C.sqlLiterals) {
      JsonObject Lj;
      Lj.push_back({"argumentIndex", Json::integer(L.argumentIndex)});
      Lj.push_back({"valueText", Json::str(L.valueText)});
      Lj.push_back({"valueSha256", Json::str(L.valueSha256)});
      Lj.push_back({"valueLength", Json::integer(L.valueLength)});
      Lj.push_back({"hasPercent", Json::boolean(L.hasPercent)});
      Lj.push_back({"hasNul", Json::boolean(L.hasNul)});
      Lj.push_back({"rawSource", L.rawSource.toJson()});
      Lits.push_back(Json::object(std::move(Lj)));
    }
    Cj.push_back({"sqlLiterals", Json::array(std::move(Lits))});
    Cj.push_back({"boundLocalUsr", Json::str(C.boundLocalUsr)});
    Cj.push_back({"boundLocalName", Json::str(C.boundLocalName)});
    Cj.push_back({"lineageStatus", Json::str(C.lineageStatus)});
    Cj.push_back({"lineageReason", Json::str(C.lineageReason)});
    JsonArray IUs;
    for (const auto &U : C.interveningUses)
      IUs.push_back(Json::str(U));
    Cj.push_back({"interveningUses", Json::array(std::move(IUs))});
    HCands.push_back(Json::object(std::move(Cj)));
  }
  O.push_back({"helperCandidates", Json::array(std::move(HCands))});
  O.push_back({"error", Json::str(error)});
  return Json::object(std::move(O));
}

} // namespace ctxclang
