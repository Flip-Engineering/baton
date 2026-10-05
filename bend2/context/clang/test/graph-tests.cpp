// context-clang-20 source tests: pure graph/JSON unit tests and extractor
// fixture tests. Remote-executed; no test depends on block numbers, source
// text parsing or a preferred first statement.
#include "analyze.h"
#include "contract.h"
#include "graph.h"
#include "json.h"

#include <cstdio>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

using namespace ctxclang;

namespace {

int Failures = 0;
int Checks = 0;

void check(bool Ok, const std::string &Name) {
  ++Checks;
  if (!Ok) {
    ++Failures;
    std::printf("FAIL %s\n", Name.c_str());
  } else {
    std::printf("ok   %s\n", Name.c_str());
  }
}

// --- graph fixture helpers --------------------------------------------------

struct GraphBuilder {
  std::vector<GraphEdge> edges;
  std::map<int64_t, GraphNode> nodes;
  int64_t entry = 0;

  int64_t block(bool isReturn = false, bool isExit = false,
                const std::string &returnId = "") {
    static int64_t Next = 0;
    int64_t Id = Next++;
    GraphNode N;
    N.isReturn = isReturn;
    N.isExit = isExit;
    N.returnId = returnId;
    nodes[Id] = N;
    return Id;
  }

  int64_t edge(int64_t From, int64_t To, const std::string &Label) {
    edges.push_back({From, To, Label});
    return static_cast<int64_t>(edges.size() - 1);
  }
};

LogicTree leaf(const std::string &Id, bool Whole = false) {
  LogicTree T;
  T.op = LogicTree::Op::Leaf;
  T.leafId = Id;
  T.whole = Whole;
  return T;
}

LogicTree bin(LogicTree::Op Op, LogicTree L, LogicTree R) {
  LogicTree T;
  T.op = Op;
  T.children.push_back(std::make_unique<LogicTree>(std::move(L)));
  T.children.push_back(std::make_unique<LogicTree>(std::move(R)));
  return T;
}

LogicTree neg(LogicTree C) {
  LogicTree T;
  T.op = LogicTree::Op::Not;
  T.children.push_back(std::make_unique<LogicTree>(std::move(C)));
  return T;
}

GuardSolveOutput solve(const Decision &D, const GraphBuilder &G, int64_t Call,
                       const std::string &CallId, bool Accepted) {
  GuardSolveInput In;
  In.entryId = G.entry;
  In.callBlockId = Call;
  In.callId = CallId;
  In.acceptedValue = Accepted;
  In.decision = D;
  In.edges = G.edges;
  In.nodes = G.nodes;
  return solveGuard(In);
}

// --- pure graph tests -------------------------------------------------------

void testAndDenyGuard() {
  // if (A && B) { opa(); return; } call();
  // Blocks: entry=A, B, deny(call opa + return), then(call).
  GraphBuilder G;
  int64_t A = G.block();
  int64_t B = G.block();
  int64_t Deny = G.block(true, false, "ret-0");
  int64_t Then = G.block();
  G.nodes[Deny].callIds = {"call-opa"};
  G.nodes[Then].callIds = {"call-target"};
  G.entry = A;
  G.edge(A, B, "true");       // internal: A true continues to B
  G.edge(A, Deny, "false");   // A false short-circuits the condition false
  G.edge(B, Then, "true");    // B true completes the condition true
  G.edge(B, Deny, "false");
  // Deny carries the mapped return and falls to an exit block.
  int64_t Exit = G.block(false, true);
  G.edge(Deny, Exit, "nonDecision");

  std::map<std::string, int64_t> LeafBlocks{{"A", A}, {"B", B}};
  DecisionBuildResult Built =
      buildDecision("C", bin(LogicTree::Op::And, leaf("A"), leaf("B")),
                    LeafBlocks, G.edges);
  check(Built.ok, "and-deny: decision built");
  if (!Built.ok) {
    std::printf("  reason: %s\n", Built.reason.c_str());
    return;
  }
  // Accepted false (the call runs when the condition is false).
  GuardSolveOutput R = solve(Built.decision, G, Then, "call-target", false);
  check(R.derived, "and-deny: derived");
  check(R.cutEdges.size() == 2, "and-deny: cut set is both false exits");
  check(R.deniedRoutes.size() == 2, "and-deny: two denial routes");
  if (R.derived) {
    bool ShortRoute = false, LongRoute = false;
    for (const auto &Rt : R.deniedRoutes) {
      if (Rt.evaluated.size() == 1 && !Rt.evaluated[0].outcome)
        ShortRoute = true; // only A evaluated, outcome false
      if (Rt.evaluated.size() == 2)
        LongRoute = true;  // A true then B false
    }
    check(ShortRoute, "and-deny: short route evaluates only A");
    check(LongRoute, "and-deny: long route evaluates A then B");
    check(R.acceptedInterveningCalls.empty(),
          "and-deny: no accepted-side opaque calls");
  }
  // Accepted true must fail: denial side (condition true) reaches the call.
  GuardSolveOutput Wrong = solve(Built.decision, G, Then, "call-target", true);
  check(!Wrong.derived, "and-deny: inverted polarity refuses");
  check(Wrong.reason == "denialReachesCall" ||
            Wrong.reason == "acceptedCutSetDoesNotDisconnectCall",
        "and-deny: inverted polarity reason");
}

void testBypassRefuses() {
  // Same guard but the call is also reachable directly from entry.
  GraphBuilder G;
  int64_t A = G.block();
  int64_t B = G.block();
  int64_t Deny = G.block(true, false, "ret-0");
  int64_t Then = G.block();
  G.nodes[Then].callIds = {"call-target"};
  G.entry = A;
  G.edge(A, B, "true");
  G.edge(A, Deny, "false");
  G.edge(B, Then, "true");
  G.edge(B, Deny, "false");
  int64_t Exit = G.block(false, true);
  G.edge(Deny, Exit, "nonDecision");
  G.edge(A, Then, "nonDecision"); // bypass edge

  std::map<std::string, int64_t> LeafBlocks{{"A", A}, {"B", B}};
  DecisionBuildResult Built =
      buildDecision("C", bin(LogicTree::Op::And, leaf("A"), leaf("B")),
                    LeafBlocks, G.edges);
  check(Built.ok, "bypass: decision built");
  if (!Built.ok)
    return;
  GuardSolveOutput R = solve(Built.decision, G, Then, "call-target", false);
  check(!R.derived, "bypass: refused");
  check(R.reason == "acceptedCutSetDoesNotDisconnectCall",
        "bypass: cut-set reason");
}

void testOrGuard() {
  // if (A || B) { return; } call();
  GraphBuilder G;
  int64_t A = G.block();
  int64_t B = G.block();
  int64_t Deny = G.block(true, false, "ret-0");
  int64_t Then = G.block();
  G.nodes[Then].callIds = {"call-target"};
  G.entry = A;
  G.edge(A, Deny, "true");  // A true determines true (exit)
  G.edge(A, B, "false");    // internal
  G.edge(B, Deny, "true");
  G.edge(B, Then, "false");
  int64_t Exit = G.block(false, true);
  G.edge(Deny, Exit, "nonDecision");

  std::map<std::string, int64_t> LeafBlocks{{"A", A}, {"B", B}};
  DecisionBuildResult Built =
      buildDecision("C", bin(LogicTree::Op::Or, leaf("A"), leaf("B")),
                    LeafBlocks, G.edges);
  check(Built.ok, "or: decision built");
  if (!Built.ok)
    return;
  GuardSolveOutput R = solve(Built.decision, G, Then, "call-target", false);
  check(R.derived, "or: derived with accepted false");
  check(R.cutEdges.size() == 1, "or: single false exit cut set");
  check(R.deniedRoutes.size() == 2, "or: two denial routes (A-true, B-true)");
}

void testNegationOverAnd() {
  // if (!(A && B)) { return; } call();
  // Exits: B-true carries condition false; B-false carries condition true.
  GraphBuilder G;
  int64_t A = G.block();
  int64_t B = G.block();
  int64_t Deny = G.block(true, false, "ret-0");
  int64_t Then = G.block();
  G.nodes[Then].callIds = {"call-target"};
  G.entry = A;
  G.edge(A, B, "true");     // internal (condition still undetermined)
  G.edge(A, Then, "false"); // !false = true -> accepted side
  G.edge(B, Then, "true");  // !(true) = false -> accepted side
  G.edge(B, Deny, "false"); // !(false) = true -> denial
  int64_t Exit = G.block(false, true);
  G.edge(Deny, Exit, "nonDecision");

  std::map<std::string, int64_t> LeafBlocks{{"A", A}, {"B", B}};
  DecisionBuildResult Built = buildDecision(
      "C", neg(bin(LogicTree::Op::And, leaf("A"), leaf("B"))), LeafBlocks,
      G.edges);
  check(Built.ok, "neg-and: decision built");
  if (!Built.ok) {
    std::printf("  reason: %s\n", Built.reason.c_str());
    return;
  }
  int ExitsTrue = 0, ExitsFalse = 0;
  for (const auto &X : Built.decision.exits)
    X.conditionValue ? ++ExitsTrue : ++ExitsFalse;
  check(ExitsTrue == 1 && ExitsFalse == 1,
        "neg-and: inverted exit values");
  GuardSolveOutput R = solve(Built.decision, G, Then, "call-target", true);
  check(R.derived, "neg-and: derived with accepted true");
}

void testWholeConditionLeaf() {
  // if (X) { return; } call();
  GraphBuilder G;
  int64_t X = G.block();
  int64_t Deny = G.block(true, false, "ret-0");
  int64_t Then = G.block();
  G.nodes[Then].callIds = {"call-target"};
  G.entry = X;
  G.edge(X, Deny, "true");
  G.edge(X, Then, "false");
  int64_t Exit = G.block(false, true);
  G.edge(Deny, Exit, "nonDecision");

  std::map<std::string, int64_t> LeafBlocks{{"X", X}};
  DecisionBuildResult Built =
      buildDecision("X", leaf("X", /*Whole=*/true), LeafBlocks, G.edges);
  check(Built.ok, "whole: decision built");
  if (!Built.ok)
    return;
  check(Built.decision.exits.size() == 2, "whole: both polarities exit");
  GuardSolveOutput R = solve(Built.decision, G, Then, "call-target", false);
  check(R.derived, "whole: derived");
  GuardSolveOutput Wrong = solve(Built.decision, G, Then, "call-target", true);
  check(!Wrong.derived, "whole: true polarity denied by route to call");
}

void testNonDecisionRefused() {
  // A decision block whose exit edge is nonDecision refuses the mapping.
  GraphBuilder G;
  int64_t X = G.block();
  int64_t Deny = G.block(true, false, "ret-0");
  int64_t Then = G.block();
  G.entry = X;
  G.edge(X, Deny, "true");
  G.edge(X, Then, "nonDecision"); // must refuse
  std::map<std::string, int64_t> LeafBlocks{{"X", X}};
  DecisionBuildResult Built =
      buildDecision("X", leaf("X", true), LeafBlocks, G.edges);
  check(!Built.ok, "nondecision: refused");
  check(Built.reason == "decisionMappingIncomplete",
        "nondecision: reason");
}

void testDenialDeadEnd() {
  // Denial target has no successors and is neither return nor exit.
  GraphBuilder G;
  int64_t X = G.block();
  int64_t Dead = G.block();
  int64_t Then = G.block();
  G.nodes[Then].callIds = {"call-target"};
  G.entry = X;
  G.edge(X, Dead, "true");
  G.edge(X, Then, "false");
  std::map<std::string, int64_t> LeafBlocks{{"X", X}};
  DecisionBuildResult Built =
      buildDecision("X", leaf("X", true), LeafBlocks, G.edges);
  check(Built.ok, "deadend: decision built");
  if (!Built.ok)
    return;
  GuardSolveOutput R = solve(Built.decision, G, Then, "call-target", false);
  check(!R.derived, "deadend: refused");
  check(R.reason == "denialSideDeadEnd", "deadend: reason");
}

void testDenialUnaccountedAlternative() {
  // Denial falls to the exit block without a mapped return.
  GraphBuilder G;
  int64_t X = G.block();
  int64_t Then = G.block();
  G.nodes[Then].callIds = {"call-target"};
  G.entry = X;
  G.edge(X, G.block(false, true), "true");
  G.edge(X, Then, "false");
  std::map<std::string, int64_t> LeafBlocks{{"X", X}};
  DecisionBuildResult Built =
      buildDecision("X", leaf("X", true), LeafBlocks, G.edges);
  check(Built.ok, "unaccounted: decision built");
  if (!Built.ok)
    return;
  GuardSolveOutput R = solve(Built.decision, G, Then, "call-target", false);
  check(!R.derived, "unaccounted: refused");
  check(R.reason == "denialSideHasUnaccountedAlternative",
        "unaccounted: reason");
}

void testTwoRouteCallAccumulation() {
  // Two denial routes pass different opaque calls; per-route records keep
  // them separate, and per-path intervening stacks restore across siblings.
  GraphBuilder G;
  int64_t X = G.block();
  int64_t Mid1 = G.block();
  int64_t Mid2 = G.block();
  int64_t Deny = G.block(true, false, "ret-0");
  int64_t Then = G.block();
  G.nodes[Mid1].callIds = {"call-opaque-1"};
  G.nodes[Mid2].callIds = {"call-opaque-2"};
  G.nodes[Then].callIds = {"call-target"};
  G.entry = X;
  G.edge(X, Mid1, "true");
  G.edge(X, Mid2, "false");
  G.edge(Mid1, Deny, "nonDecision");
  G.edge(Mid2, Deny, "nonDecision");
  int64_t Exit = G.block(false, true);
  G.edge(Deny, Exit, "nonDecision");
  std::map<std::string, int64_t> LeafBlocks{{"X", X}};
  DecisionBuildResult Built =
      buildDecision("X", leaf("X", true), LeafBlocks, G.edges);
  check(Built.ok, "tworoute: decision built");
  if (!Built.ok)
    return;
  // The single decision block exits both polarities to different targets;
  // accepted side (call) is unreachable without crossing accepted exit.
  GuardSolveOutput R = solve(Built.decision, G, Then, "call-target", false);
  check(R.derived, "tworoute: derived");
  check(R.deniedRoutes.size() == 2, "tworoute: two routes");
  bool Has1 = false, Has2 = false;
  for (const auto &Rt : R.deniedRoutes) {
    for (const auto &C : Rt.interveningCalls) {
      if (C == "call-opaque-1")
        Has1 = true;
      if (C == "call-opaque-2")
        Has2 = true;
    }
  }
  check(Has1 && Has2, "tworoute: both opaque calls recorded per route");
}

void testAcceptedSideOpaqueCalls() {
  // Opaque call on the accepted path between the accepted exit and the call.
  GraphBuilder G;
  int64_t X = G.block();
  int64_t After = G.block();
  int64_t Deny = G.block(true, false, "ret-0");
  int64_t Then = G.block();
  G.nodes[After].callIds = {"call-mutator"};
  G.nodes[Then].callIds = {"call-target"};
  G.entry = X;
  G.edge(X, Deny, "true");
  G.edge(X, After, "false");
  G.edge(After, Then, "nonDecision");
  int64_t Exit = G.block(false, true);
  G.edge(Deny, Exit, "nonDecision");
  std::map<std::string, int64_t> LeafBlocks{{"X", X}};
  DecisionBuildResult Built =
      buildDecision("X", leaf("X", true), LeafBlocks, G.edges);
  check(Built.ok, "accepted-opaque: decision built");
  if (!Built.ok)
    return;
  GuardSolveOutput R = solve(Built.decision, G, Then, "call-target", false);
  check(R.derived, "accepted-opaque: derived");
  bool Found = false;
  for (const auto &C : R.acceptedInterveningCalls)
    if (C == "call-mutator")
      Found = true;
  check(Found, "accepted-opaque: post-accept call retained");
}

void testDenialWitnessRequired() {
  // Denial edges exist but no route reaches a mapped return.
  GraphBuilder G;
  int64_t X = G.block();
  int64_t Then = G.block();
  G.nodes[Then].callIds = {"call-target"};
  G.entry = X;
  G.edge(X, Then, "false");
  // true edge goes to an isolated block with no further edges and no
  // return/exit designation.
  G.edge(X, G.block(), "true");
  std::map<std::string, int64_t> LeafBlocks{{"X", X}};
  DecisionBuildResult Built =
      buildDecision("X", leaf("X", true), LeafBlocks, G.edges);
  check(Built.ok, "witness: decision built");
  if (!Built.ok)
    return;
  GuardSolveOutput R = solve(Built.decision, G, Then, "call-target", false);
  check(!R.derived, "witness: refused");
  check(R.reason == "denialSideDeadEnd" ||
            R.reason == "denialWitnessUnavailable",
        "witness: reason");
}

// --- JSON tests -------------------------------------------------------------

void testJsonRoundTripAndRefusals() {
  Json Doc;
  std::string Error;
  check(Json::parse("{\"a\":[1,2,{\"b\":\"x\\u00e9\"}],\"c\":null}",
                    Doc, Error),
        "json: parses escapes and nesting");
  check(Json::parse("{}", Doc, Error) && Doc.asObject().empty(),
        "json: empty object");
  check(!Json::parse("{\"a\":1,\"a\":2}", Doc, Error),
        "json: duplicate members refuse");
  check(!Json::parse("[1,2", Doc, Error), "json: unterminated refuses");
  check(!Json::parse("1.5", Doc, Error), "json: fraction refuses");
  check(!Json::parse("1e3", Doc, Error), "json: exponent refuses");
  check(!Json::parse("{}x", Doc, Error), "json: trailing bytes refuse");
  check(Json::parse("\"\\ud83d\\ude00\"", Doc, Error) &&
            Doc.asString() == "\xF0\x9F\x98\x80",
        "json: surrogate pair decodes");
  check(!Json::parse("\"\\ud83d\"", Doc, Error),
        "json: lone high surrogate refuses");
  check(!Json::parse("\"\\x41\"", Doc, Error), "json: bad escape refuses");
  Json Arr = Json::array({});
  check(Arr.dump() == "[]", "json: empty array dump");
}

} // namespace

int main() {
  testAndDenyGuard();
  testBypassRefuses();
  testOrGuard();
  testNegationOverAnd();
  testWholeConditionLeaf();
  testNonDecisionRefused();
  testDenialDeadEnd();
  testDenialUnaccountedAlternative();
  testTwoRouteCallAccumulation();
  testAcceptedSideOpaqueCalls();
  testDenialWitnessRequired();
  testJsonRoundTripAndRefusals();
  std::printf("%d checks, %d failures\n", Checks, Failures);
  return Failures == 0 ? 0 : 1;
}
