// Private input/output contract for the context-clang-20 extractor.
// This is the source-pinned producer contract consumed by the
// clang-analyzer adapter; it is not the public canonical request schema.
#ifndef CONTEXT_CLANG_CONTRACT_H
#define CONTEXT_CLANG_CONTRACT_H

#include "json.h"
#include <cstdint>
#include <string>
#include <vector>

namespace ctxclang {

struct SubjectPos {
  std::string path;
  int64_t line = 0;    // zero-based
  int64_t column = 0;  // zero-based UTF-16 code units
};

struct Subject {
  enum class Kind { Position, Symbol };
  Kind kind = Kind::Position;
  std::string path;
  int64_t line = 0;
  int64_t column = 0;
  std::string name; // symbol subject
};

struct FilePair {
  std::string original;  // path as given
  std::string generated; // path as given
};

struct Input {
  enum class Operation { HandlerAnalysis, FunctionSignature };
  Operation operation = Operation::HandlerAnalysis;
  std::string directory;              // absolute working directory
  std::string file;                   // translation unit path as given
  std::vector<std::string> arguments; // reduced frontend command, argv[0] first
  Subject subject;
  std::vector<FilePair> pairs;
  std::vector<std::string> helpers;   // helper function names to parse/emit

  // Strict closed decode. Unknown members, missing members, wrong types and
  // duplicate members refuse with the failure reason in Error.
  static bool decode(const Json &Doc, Input &Out, std::string &Error);
};

// Byte span in one physical file with spelling/expansion qualification.
struct SpanInfo {
  std::string file;
  int64_t byteStart = 0;
  int64_t byteEnd = 0; // exclusive
  bool expanded = false; // spelling and expansion differ (macro involvement)
  Json toJson() const;
};

struct OperandInfo {
  std::string usr;      // canonical declaration USR of the base declaration
  std::string name;     // base declaration name
  std::string varKind;  // "local" | "param" | "global" | "field"
  std::string type;     // printed type of the base declaration
  std::vector<std::string> fields; // field chain names (record reads)
  std::vector<std::string> fieldUsrs;
  bool negated = false;  // operand appears under a logical not at the leaf
  SpanInfo spelling;
};

struct ConditionInfo {
  std::string id;       // cond-N, local to this extraction
  std::string exprKind; // "if" | "logicalAnd" | "logicalOr"
  std::string exprText; // printed canonical expression text (evidence aid)
  SpanInfo spelling;
  SpanInfo expansion;
  std::vector<OperandInfo> operands;
  bool supported = false;
  std::string unsupportedReason; // nonempty when !supported
};

struct CallArgInfo {
  int64_t index = 0;
  std::string parameterType; // canonical printed formal type when direct
  SpanInfo spelling;
};

struct CallInfo {
  std::string id;        // call-N
  bool direct = false;
  std::string usr;       // canonical callee USR when direct
  std::string name;      // callee name when direct
  std::vector<std::string> parameterTypes; // canonical printed formals when direct
  bool calleeUnavailable = false;          // indirect call
  std::string calleeUnavailableReason;
  std::vector<CallArgInfo> arguments;
  SpanInfo spelling;
  SpanInfo expansion;
  int64_t blockId = -1;  // CFG block containing the call element
};

struct ReturnInfo {
  std::string id;   // ret-N
  SpanInfo spelling;
  int64_t blockId = -1;
};

struct CfgEdge {
  int64_t from = -1;
  int64_t to = -1;
  std::string label; // "true" | "false" | "nonDecision"
};

struct CfgBlock {
  int64_t id = -1;
  bool entry = false;
  bool exit = false;
  bool unreachable = false;
  std::string terminatorKind; // "if" | "logicalAnd" | "logicalOr" | ""
  std::string conditionId;    // decision condition mapped to this block
  std::string lastConditionOperandId; // leaf operand decision for this block
};

struct CfgInfo {
  std::vector<CfgBlock> blocks;
  std::vector<CfgEdge> edges;
  int64_t entryId = -1;
  int64_t exitId = -1;
};

struct RouteOperand {
  std::string conditionId;    // decision whose leaf was evaluated
  std::string operandLeafId;  // leaf operand condition (sub-condition) id
  bool outcome = false;       // edge polarity taken for the leaf
};

struct DenialRoute {
  std::vector<RouteOperand> evaluated;  // operands actually evaluated
  std::vector<int64_t> edges;           // graph edges along the route
  std::string returnId;                 // explicit mapped return reached
  std::vector<std::string> interveningCalls; // opaque calls passed
};

struct GuardRelation {
  std::string conditionId;
  std::string callId;
  bool acceptedValue = false; // condition value on the accepted side
  std::string status;         // "derived" | "unavailable"
  std::string unavailableReason;
  std::vector<DenialRoute> deniedRoutes;
  std::vector<int64_t> cutEdges;   // whole accepted exit-edge set
  std::vector<std::string> acceptedInterveningCalls;
};

struct FormalInfo {
  std::string name;
  std::string type; // canonical printed
  SpanInfo spelling;
};

struct HelperDefinition {
  std::string name;
  std::string usr;
  std::string returnType;
  bool variadic = false;
  std::vector<FormalInfo> formals;
  SpanInfo body; // token-inclusive interval in the generated file
};

struct SqlLiteralInfo {
  int64_t argumentIndex = 0;
  std::string valueText;
  std::string valueSha256; // sha256 of the processed literal bytes
  int64_t valueLength = 0;
  bool hasPercent = false;
  bool hasNul = false;
  SpanInfo rawSource; // quoted source bytes
};

struct HelperCandidate {
  std::string callId;       // matching CallInfo id
  std::string helperName;
  std::string helperUsr;
  std::vector<SqlLiteralInfo> sqlLiterals;
  std::string boundLocalUsr; // address-of local binding (first argument)
  std::string boundLocalName;
  std::string lineageStatus; // "", "derived", "refused", "unavailable"
  std::string lineageReason;
  std::vector<std::string> interveningUses; // call ids or spans of other uses
};

struct DiagnosticInfo {
  std::string level; // "error" | "warning" | "note" | "remark"
  std::string message;
  std::string file;
  int64_t byteStart = -1;
  int64_t byteEnd = -1;
};

struct ConsumedInput {
  std::string path;
  std::string sha256;
  std::string role; // "main" | "header"
};

struct CorrespondenceInfo {
  std::string status; // "mapped" | "unmapped" | "absent"
  std::string original;
  std::string generated;
  int64_t originalStart = -1;
  int64_t originalEnd = -1;
  int64_t generatedStart = -1;
  int64_t generatedEnd = -1;
  std::string segmentSha256;
  std::string reason; // when unmapped
};

struct SelectedFunction {
  std::string name;
  std::string usr;
  std::string returnType;
  bool variadic = false;
  std::vector<FormalInfo> formals; // empty list for void(void)
  SpanInfo body;                   // token-inclusive interval
  CorrespondenceInfo correspondence;
};

struct Output {
  int64_t version = 1;
  std::string extractorName = "context-clang-20";
  std::string extractorVersion = "0.1.0";
  std::string clangVersion;
  std::string operation;
  std::string translationUnitPath;
  std::string translationUnitSha256;
  std::vector<ConsumedInput> consumedInputs;
  SelectedFunction selected;
  std::vector<ConditionInfo> conditions;
  std::vector<CallInfo> calls;
  std::vector<ReturnInfo> returns;
  std::vector<OperandInfo> globals;
  CfgInfo cfg;
  std::vector<GuardRelation> guards;
  std::vector<DiagnosticInfo> diagnostics;
  std::vector<HelperDefinition> helperDefinitions;
  std::vector<HelperCandidate> helperCandidates;
  std::string error; // nonempty when the operation itself failed

  Json toJson() const;
};

} // namespace ctxclang

#endif
