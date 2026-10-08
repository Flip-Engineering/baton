// Pure control-flow-graph reasoning for guard derivation. Operates on the
// extractor's local block/edge numbering so unit tests exercise it without
// LLVM. Whole-condition accepted/denied exit semantics come from the mapped
// condition's logical tree (AND/OR/not) simulated with short-circuit
// evaluation order; the mapped CFG edges must agree with that simulation.
// These rules implement guarded_call derivation in
// docs/bend2/semantic-context-spec.md.
#ifndef CONTEXT_CLANG_GRAPH_H
#define CONTEXT_CLANG_GRAPH_H

#include <cstdint>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

namespace ctxclang {

struct GraphEdge {
  int64_t from = -1;
  int64_t to = -1;
  std::string label; // "true" | "false" | "nonDecision" | "null" | "unreachable"
};

// The mapped condition's logical expression. Leaves are the spelled operand
// expressions (a leaf may itself be a negated operand); whole marks a leaf
// that is the whole condition expression when the lowering decides the
// condition at one block.
struct LogicTree {
  enum class Op { Leaf, Not, And, Or };
  Op op = Op::Leaf;
  std::string leafId; // Leaf: condition id of the spelled leaf expression
  bool whole = false; // Leaf: this leaf is the whole condition expression
  std::vector<std::unique_ptr<LogicTree>> children; // Not:1, And/Or:2
};

struct DecisionExit {
  int64_t edgeIndex = -1;  // index into the graph edge vector
  int64_t fromBlock = -1;
  int64_t toBlock = -1;
  std::string leafId;   // leaf evaluated on the path reaching this exit
  bool leafOutcome = false; // edge polarity of that leaf
  bool conditionValue = false; // whole-condition value carried by this exit
};

struct Decision {
  std::string conditionId;
  std::map<std::string, int64_t> leafBlockOf; // leaf id -> block id
  std::set<int64_t> decisionBlocks;           // all blocks deciding a leaf
  std::vector<DecisionExit> exits;            // complete exit set
};

struct DecisionBuildResult {
  bool ok = false;
  std::string reason; // when !ok: "decisionMappingIncomplete" and friends
  Decision decision;
};

// Compute the whole-condition exit set from the mapped graph and cross-check
// it against the logical tree's short-circuit simulation. Every labeled
// true/false edge leaving a decision block must be classified the same way
// by both; any disagreement or nonDecision exit refuses the mapping.
DecisionBuildResult buildDecision(const std::string &conditionId,
                                  const LogicTree &Tree,
                                  const std::map<std::string, int64_t> &LeafBlockOf,
                                  const std::vector<GraphEdge> &Edges);

struct GraphNode {
  bool isReturn = false; // block whose element set includes a mapped ReturnStmt
  bool isExit = false;   // CFG exit block (fall-off-the-end sink)
  std::string returnId;  // mapped return identity when isReturn
  std::vector<std::string> callIds; // call elements in this block, in order
};

struct RouteOp {
  std::string conditionId;
  std::string operandLeafId;
  bool outcome = false;
};

struct GuardSolveInput {
  int64_t entryId = -1;
  int64_t callBlockId = -1;
  std::string callId;
  bool acceptedValue = false; // polarity of the claimed accepted side
  Decision decision;
  std::vector<GraphEdge> edges;
  std::map<int64_t, GraphNode> nodes;
};

struct GuardSolveOutput {
  bool derived = false;
  std::string reason; // unavailable reason when !derived
  std::vector<int64_t> cutEdges;
  struct Route {
    std::vector<RouteOp> evaluated;
    std::vector<int64_t> edges;
    std::string returnId;
    std::vector<std::string> interveningCalls;
  };
  std::vector<Route> deniedRoutes;
  std::vector<std::string> acceptedInterveningCalls;
};

// Solve one condition/call pair. Every decision reads only the mapped graph
// and the validated decision exits; no block identifiers or source text
// participate.
GuardSolveOutput solveGuard(const GuardSolveInput &In);

} // namespace ctxclang

#endif
