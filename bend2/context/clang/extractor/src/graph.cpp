#include "graph.h"

#include <algorithm>
#include <functional>
#include <optional>

namespace ctxclang {

namespace {

// Short-circuit simulation of the logical tree. Given a partial assignment
// leafId -> outcome, evaluate the tree. A missing leaf means "not yet
// evaluated"; the result is either a definite bool or unevaluated (nullopt).
struct Sim {
  std::map<std::string, bool> Assigned;

  std::optional<bool> eval(const LogicTree &N) const {
    switch (N.op) {
    case LogicTree::Op::Leaf: {
      auto It = Assigned.find(N.leafId);
      if (It == Assigned.end())
        return std::nullopt;
      return It->second;
    }
    case LogicTree::Op::Not: {
      std::optional<bool> V = eval(*N.children[0]);
      if (!V)
        return std::nullopt;
      return !*V;
    }
    case LogicTree::Op::And: {
      std::optional<bool> L = eval(*N.children[0]);
      if (!L)
        return std::nullopt;
      if (!*L)
        return false; // short circuit; rhs unevaluated
      return eval(*N.children[1]);
    }
    case LogicTree::Op::Or: {
      std::optional<bool> L = eval(*N.children[0]);
      if (!L)
        return std::nullopt;
      if (*L)
        return true; // short circuit; rhs unevaluated
      return eval(*N.children[1]);
    }
    }
    return std::nullopt;
  }

  // Leaves the evaluation of this node still requires, in evaluation order.
  void pendingLeaves(const LogicTree &N, std::vector<std::string> &Out) const {
    switch (N.op) {
    case LogicTree::Op::Leaf:
      if (!Assigned.count(N.leafId))
        Out.push_back(N.leafId);
      break;
    case LogicTree::Op::Not:
    case LogicTree::Op::And:
    case LogicTree::Op::Or:
      for (const auto &C : N.children)
        pendingLeaves(*C, Out);
      break;
    }
  }

  // The leaf the node evaluates next (the head of the short-circuit order).
  std::string nextLeaf(const LogicTree &N) const {
    std::vector<std::string> P;
    pendingLeaves(N, P);
    return P.empty() ? "" : P.front();
  }
};

// Simulate evaluation and produce every determining (leaf, polarity) pair
// with the whole-condition value it carries.
void determiningOutcomes(const LogicTree &N, Sim S,
                         std::map<std::pair<std::string, bool>, bool> &Out) {
  std::string Leaf = S.nextLeaf(N);
  if (Leaf.empty()) {
    // Fully evaluated; no leaf decision remains.
    return;
  }
  for (int P = 0; P < 2; ++P) {
    Sim T = S;
    T.Assigned[Leaf] = P == 1;
    std::optional<bool> V = T.eval(N);
    if (V.has_value()) {
      Out[{Leaf, P == 1}] = *V;
    } else {
      determiningOutcomes(N, T, Out);
    }
  }
}

// Whole-condition value of one leaf evaluation under the tree.
bool valueOf(const std::map<std::pair<std::string, bool>, bool> &Determining,
             const std::string &Leaf, bool Outcome, bool &Found) {
  auto It = Determining.find({Leaf, Outcome});
  if (It == Determining.end()) {
    Found = false;
    return false;
  }
  Found = true;
  return It->second;
}

struct PathEnum {
  const GuardSolveInput &In;
  std::vector<GuardSolveOutput::Route> Routes;
  std::string Failure; // "cycle" | "exitWithoutReturn" | "denialDeadEnd"
  bool ReachesCall = false;

  explicit PathEnum(const GuardSolveInput &Input) : In(Input) {}

  void walk(int64_t Current, std::vector<int64_t> &Visited,
            std::vector<int64_t> &PathEdges, std::vector<RouteOp> &Evaluated,
            std::vector<std::string> &Intervening) {
    if (std::find(Visited.begin(), Visited.end(), Current) != Visited.end()) {
      // A cycle reachable from the denial target before any mapped return.
      if (Failure.empty() || Failure == "exitWithoutReturn" ||
          Failure == "denialDeadEnd")
        Failure = "cycle";
      return;
    }
    Visited.push_back(Current);
    if (Current == In.callBlockId) {
      ReachesCall = true;
      Visited.pop_back();
      return;
    }
    auto NodeIt = In.nodes.find(Current);
    if (NodeIt != In.nodes.end() && NodeIt->second.isReturn) {
      GuardSolveOutput::Route R;
      R.evaluated = Evaluated;
      R.edges = PathEdges;
      R.returnId = NodeIt->second.returnId;
      for (const auto &C : NodeIt->second.callIds)
        R.interveningCalls.push_back(C);
      R.interveningCalls.insert(R.interveningCalls.end(),
                                Intervening.begin(), Intervening.end());
      Routes.push_back(std::move(R));
      Visited.pop_back();
      return;
    }
    if (NodeIt != In.nodes.end() && NodeIt->second.isExit) {
      if (Failure.empty())
        Failure = "exitWithoutReturn";
      Visited.pop_back();
      return;
    }
    bool HadEdge = false;
    if (NodeIt != In.nodes.end()) {
      size_t Mark = Intervening.size();
      for (const auto &C : NodeIt->second.callIds)
        if (C != In.callId)
          Intervening.push_back(C);
      for (const auto &E : In.edges) {
        if (E.from != Current)
          continue;
        HadEdge = true;
        PathEdges.push_back(
            static_cast<int64_t>(&E - In.edges.data()));
        walk(E.to, Visited, PathEdges, Evaluated, Intervening);
        PathEdges.pop_back();
      }
      Intervening.resize(Mark); // restore across sibling recursion
    }
    if (!HadEdge && (NodeIt == In.nodes.end() ||
                     (!NodeIt->second.isReturn && !NodeIt->second.isExit))) {
      if (Failure.empty())
        Failure = "denialDeadEnd";
    }
    Visited.pop_back();
  }
};

bool reaches(const std::vector<GraphEdge> &Edges, int64_t From, int64_t To,
             const std::set<size_t> *RemovedEdges = nullptr) {
  if (From == To)
    return true;
  std::set<int64_t> Seen;
  std::vector<int64_t> Stack{From};
  while (!Stack.empty()) {
    int64_t Cur = Stack.back();
    Stack.pop_back();
    if (Cur == To)
      return true;
    if (!Seen.insert(Cur).second)
      continue;
    for (size_t I = 0; I < Edges.size(); ++I) {
      const auto &E = Edges[I];
      if (E.from != Cur)
        continue;
      if (RemovedEdges && RemovedEdges->count(I))
        continue;
      Stack.push_back(E.to);
    }
  }
  return false;
}

} // namespace

DecisionBuildResult buildDecision(const std::string &conditionId,
                                  const LogicTree &Tree,
                                  const std::map<std::string, int64_t> &LeafBlockOf,
                                  const std::vector<GraphEdge> &Edges) {
  DecisionBuildResult R;

  // The whole condition deciding at one block: both polarities carry the
  // condition value directly.
  if (Tree.op == LogicTree::Op::Leaf && Tree.whole) {
    auto It = LeafBlockOf.find(Tree.leafId);
    if (It == LeafBlockOf.end()) {
      R.reason = "decisionMappingIncomplete";
      return R;
    }
    R.decision.conditionId = conditionId;
    R.decision.leafBlockOf[Tree.leafId] = It->second;
    R.decision.decisionBlocks.insert(It->second);
    int64_t Block = It->second;
    for (size_t I = 0; I < Edges.size(); ++I) {
      const auto &E = Edges[I];
      if (E.from != Block)
        continue;
      DecisionExit X;
      X.edgeIndex = static_cast<int64_t>(I);
      X.fromBlock = E.from;
      X.toBlock = E.to;
      X.leafId = Tree.leafId;
      if (E.label == "true") {
        X.leafOutcome = true;
        X.conditionValue = true;
      } else if (E.label == "false") {
        X.leafOutcome = false;
        X.conditionValue = false;
      } else {
        // nonDecision/null/unreachable exits carry no Boolean condition
        // outcome; the mapping refuses rather than inferring one.
        R.reason = "decisionMappingIncomplete";
        return R;
      }
      R.decision.exits.push_back(X);
    }
    if (R.decision.exits.empty()) {
      R.reason = "decisionMappingIncomplete";
      return R;
    }
    R.ok = true;
    return R;
  }

  // Determine which (leaf, polarity) pairs decide the whole condition and
  // with which value, under short-circuit evaluation.
  std::map<std::pair<std::string, bool>, bool> Determining;
  determiningOutcomes(Tree, Sim(), Determining);

  R.decision.conditionId = conditionId;
  for (const auto &KV : LeafBlockOf) {
    R.decision.leafBlockOf[KV.first] = KV.second;
    R.decision.decisionBlocks.insert(KV.second);
  }
  if (R.decision.leafBlockOf.empty()) {
    R.reason = "decisionMappingIncomplete";
    return R;
  }

  // Every labeled edge leaving a decision block is either internal (its
  // target is another decision block) or a whole-condition exit whose
  // (leaf, polarity) the simulation says is determining.
  std::set<std::pair<std::string, bool>> SeenExits;
  for (size_t I = 0; I < Edges.size(); ++I) {
    const auto &E = Edges[I];
    if (!R.decision.decisionBlocks.count(E.from))
      continue;
    bool Internal = R.decision.decisionBlocks.count(E.to) > 0;
    if (E.label != "true" && E.label != "false") {
      // Null/unreachable successors preserve their metadata; they carry no
      // decision outcome. nonDecision leaving a decision block refuses.
      if (E.label == "nonDecision" && !Internal) {
        R.reason = "decisionMappingIncomplete";
        return R;
      }
      continue;
    }
    // Which leaf does this block decide?
    std::string Leaf;
    for (const auto &KV : LeafBlockOf)
      if (KV.second == E.from)
        Leaf = KV.first;
    if (Leaf.empty()) {
      R.reason = "decisionMappingIncomplete";
      return R;
    }
    bool Outcome = E.label == "true";
    if (Internal) {
      // The simulation must say this evaluation does NOT determine the
      // whole condition.
      if (Determining.count({Leaf, Outcome})) {
        R.reason = "decisionMappingIncomplete";
        return R;
      }
      continue;
    }
    // Exit: the simulation must determine a value here.
    bool Found = false;
    bool Value = valueOf(Determining, Leaf, Outcome, Found);
    if (!Found) {
      R.reason = "decisionMappingIncomplete";
      return R;
    }
    DecisionExit X;
    X.edgeIndex = static_cast<int64_t>(I);
    X.fromBlock = E.from;
    X.toBlock = E.to;
    X.leafId = Leaf;
    X.leafOutcome = Outcome;
    X.conditionValue = Value;
    R.decision.exits.push_back(X);
    SeenExits.insert({Leaf, Outcome});
  }

  // The simulation's determining outcomes must all appear as exits.
  for (const auto &KV : Determining) {
    if (!SeenExits.count(KV.first)) {
      R.reason = "decisionMappingIncomplete";
      return R;
    }
  }
  if (R.decision.exits.empty()) {
    R.reason = "decisionMappingIncomplete";
    return R;
  }
  R.ok = true;
  return R;
}

GuardSolveOutput solveGuard(const GuardSolveInput &In) {
  GuardSolveOutput Out;
  const Decision &D = In.decision;

  // Split the complete exit set by whole-condition value.
  std::set<size_t> AcceptedEdges;
  struct DenialStart {
    int64_t edgeIndex;
    int64_t target;
    std::string leafId;
    bool leafOutcome;
  };
  std::vector<DenialStart> Denials;
  for (const auto &X : D.exits) {
    size_t Index = static_cast<size_t>(X.edgeIndex);
    if (X.conditionValue == In.acceptedValue)
      AcceptedEdges.insert(Index);
    else
      Denials.push_back({X.edgeIndex, X.toBlock, X.leafId, X.leafOutcome});
  }
  for (size_t I : AcceptedEdges)
    Out.cutEdges.push_back(static_cast<int64_t>(I));

  if (AcceptedEdges.empty()) {
    Out.reason = "noAcceptedExitEdges";
    return Out;
  }

  // Reachability: entry must reach the call in the full graph...
  if (!reaches(In.edges, In.entryId, In.callBlockId)) {
    Out.reason = "callUnreachableFromEntry";
    return Out;
  }
  // ...and never without the accepted exit set (cut-set property).
  if (reaches(In.edges, In.entryId, In.callBlockId, &AcceptedEdges)) {
    Out.reason = "acceptedCutSetDoesNotDisconnectCall";
    return Out;
  }

  // Denial side: every finite path from every denial exit target must reach
  // a mapped return before the call, with no reachable cycle, no fall to the
  // exit block, and no dead end.
  PathEnum Enum(In);
  for (const auto &Start : Denials) {
    if (!In.nodes.count(Start.target)) {
      Out.reason = "denialTargetUnmapped";
      return Out;
    }
    std::vector<int64_t> Visited;
    std::vector<int64_t> PathEdges{Start.edgeIndex};
    std::vector<RouteOp> Evaluated;
    Evaluated.push_back({D.conditionId, Start.leafId, Start.leafOutcome});
    std::vector<std::string> Intervening;
    Enum.walk(Start.target, Visited, PathEdges, Evaluated, Intervening);
  }
  if (Enum.ReachesCall) {
    Out.reason = "denialReachesCall";
    return Out;
  }
  if (Enum.Failure == "cycle") {
    Out.reason = "denialSideReachesCycle";
    return Out;
  }
  if (Enum.Failure == "exitWithoutReturn") {
    Out.reason = "denialSideHasUnaccountedAlternative";
    return Out;
  }
  if (Enum.Failure == "denialDeadEnd") {
    Out.reason = "denialSideDeadEnd";
    return Out;
  }
  if (Denials.empty() || Enum.Routes.empty()) {
    // Denial edges existed; without witnesses the denial claim is unproved.
    Out.reason = "denialWitnessUnavailable";
    return Out;
  }
  Out.deniedRoutes = std::move(Enum.Routes);
  Out.derived = true;

  // Opaque calls after the accepted exits: blocks reachable from accepted
  // exit targets that can still reach the selected call. This keeps calls
  // that mutate guard inputs after acceptance inside the field.
  std::set<int64_t> CanReachCall;
  {
    std::vector<int64_t> Stack{In.callBlockId};
    while (!Stack.empty()) {
      int64_t Cur = Stack.back();
      Stack.pop_back();
      if (!CanReachCall.insert(Cur).second)
        continue;
      for (const auto &E : In.edges)
        if (E.to == Cur)
          Stack.push_back(E.from);
    }
  }
  {
    std::set<int64_t> Seen;
    std::vector<int64_t> Stack;
    for (const auto &X : D.exits)
      if (X.conditionValue == In.acceptedValue)
        Stack.push_back(X.toBlock);
    while (!Stack.empty()) {
      int64_t Cur = Stack.back();
      Stack.pop_back();
      if (!Seen.insert(Cur).second)
        continue;
      if (!CanReachCall.count(Cur))
        continue;
      auto NodeIt = In.nodes.find(Cur);
      if (NodeIt != In.nodes.end())
        for (const auto &C : NodeIt->second.callIds)
          if (C != In.callId)
            Out.acceptedInterveningCalls.push_back(C);
      for (const auto &E : In.edges)
        if (E.from == Cur)
          Stack.push_back(E.to);
    }
  }
  return Out;
}

} // namespace ctxclang
