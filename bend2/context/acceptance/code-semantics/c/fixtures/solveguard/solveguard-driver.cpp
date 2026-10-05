// Pure-function vector driver for ctxclang::solveGuard (remote-only compile).
//
// Reads the vector grammar documented in vectors.txt from a file given as
// argv[1] (or stdin when argv[1] is "-"), builds one GuardSolveInput per
// vector, calls the extractor's solveGuard, and prints one machine-comparable
// result block per vector. No LLVM is required: graph.h declares pure types.
//
// Build (on the admitted remote runner, with the extractor sources staged):
//   c++ -std=c++17 -I <extractor-src> solveguard-driver.cpp -o solveguard-driver
//   ./solveguard-driver vectors.txt
//
// Result block per vector (fixed order, tab-separated):
//   result <id> derived <true|false> reason <token>
//   cutedges <i,j,...|empty>
//   route <denial-edge-index> evaluated <leaf=outcome,...|empty> edges <i,...> \
//     return <returnId|none> calls <id,...|empty>
//   accepted-intervening <id,...|empty>
// The checker compares these blocks against the expect directives.
#include "graph.h"

#include <cctype>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct Vector {
  std::string id;
  int64_t entryId = -1;
  int64_t callBlockId = -1;
  std::string callId;
  bool acceptedValue = false;
  std::vector<std::pair<int64_t, std::string>> decisionBlocks;
  std::map<int64_t, ctxclang::GraphNode> nodes;
  std::vector<ctxclang::GraphEdge> edges;
};

std::vector<std::string> splitList(const std::string &Text) {
  std::vector<std::string> Out;
  std::string Current;
  for (char C : Text) {
    if (C == ',') {
      if (!Current.empty())
        Out.push_back(Current);
      Current.clear();
    } else if (C != ' ') {
      Current.push_back(C);
    }
  }
  if (!Current.empty() && Current != "empty")
    Out.push_back(Current);
  return Out;
}

std::string joinIndices(const std::vector<int64_t> &Values) {
  if (Values.empty())
    return "empty";
  std::string Out;
  for (size_t I = 0; I < Values.size(); ++I) {
    if (I > 0)
      Out += ",";
    Out += std::to_string(Values[I]);
  }
  return Out;
}

std::string joinStrings(const std::vector<std::string> &Values) {
  if (Values.empty())
    return "empty";
  std::string Out;
  for (size_t I = 0; I < Values.size(); ++I) {
    if (I > 0)
      Out += ",";
    Out += Values[I];
  }
  return Out;
}

std::string orNone(const std::string &Value) {
  return Value.empty() ? "none" : Value;
}

std::string reasonToken(const std::string &Reason) {
  return Reason.empty() ? std::string("-") : Reason;
}

} // namespace

int main(int argc, char **argv) {
  std::istream *Input = &std::cin;
  std::ifstream File;
  if (argc > 1 && std::string(argv[1]) != "-") {
    File.open(argv[1]);
    if (!File.is_open()) {
      std::cerr << "cannot open vector file: " << argv[1] << "\n";
      return 2;
    }
    Input = &File;
  }

  std::vector<Vector> Vectors;
  std::vector<std::string> Expects; // raw expect lines, per vector
  std::string Line;
  bool InVector = false;
  while (std::getline(*Input, Line)) {
    if (Line.empty() || Line[0] == '#')
      continue;
    std::istringstream Fields(Line);
    std::string Directive;
    Fields >> Directive;
    if (Directive == "vector") {
      Vector V;
      Fields >> V.id;
      Vectors.push_back(V);
      InVector = true;
      continue;
    }
    if (!InVector)
      continue;
    Vector &V = Vectors.back();
    if (Directive == "entry") {
      Fields >> V.entryId;
    } else if (Directive == "callblock") {
      Fields >> V.callBlockId;
    } else if (Directive == "call") {
      Fields >> V.callId;
    } else if (Directive == "accepted") {
      std::string Polarity;
      Fields >> Polarity;
      V.acceptedValue = (Polarity == "true");
    } else if (Directive == "decisionblock") {
      int64_t BlockId = -1;
      std::string Leaf;
      Fields >> BlockId >> Leaf;
      V.decisionBlocks.emplace_back(BlockId, Leaf);
    } else if (Directive == "node") {
      int64_t Id = -1;
      Fields >> Id;
      ctxclang::GraphNode Node;
      std::string Rest;
      std::getline(Fields, Rest);
      std::istringstream RestFields(Rest);
      std::string Token;
      while (RestFields >> Token) {
        if (Token == "return") {
          Node.isReturn = true;
          RestFields >> Node.returnId;
        } else if (Token == "exit") {
          Node.isExit = true;
        } else if (Token == "calls") {
          std::string Calls;
          std::getline(RestFields, Calls);
          Node.callIds = splitList(Calls);
        }
      }
      V.nodes[Id] = Node;
    } else if (Directive == "edge") {
      std::string Body;
      Fields >> Body;
      const auto Arrow = Body.find("->");
      std::string Label;
      Fields >> Label;
      ctxclang::GraphEdge Edge;
      Edge.from = std::stoll(Body.substr(0, Arrow));
      Edge.to = std::stoll(Body.substr(Arrow + 2));
      Edge.label = Label;
      V.edges.push_back(Edge);
    } else if (Directive == "expect") {
      Expects.push_back(Line);
    }
  }

  for (const Vector &V : Vectors) {
    ctxclang::GuardSolveInput In;
    In.entryId = V.entryId;
    In.callBlockId = V.callBlockId;
    In.callId = V.callId;
    In.acceptedValue = V.acceptedValue;
    for (const auto &Block : V.decisionBlocks) {
      ctxclang::Decision::DecisionBlock Db;
      Db.blockId = Block.first;
      Db.leafId = Block.second;
      In.decision.blocks.push_back(Db);
    }
    In.edges = V.edges;
    In.nodes = V.nodes;
    const ctxclang::GuardSolveOutput Out = ctxclang::solveGuard(In);
    std::cout << "result " << V.id << " derived "
              << (Out.derived ? "true" : "false") << " reason "
              << reasonToken(Out.reason) << "\n";
    std::cout << "cutedges " << joinIndices(Out.cutEdges) << "\n";
    std::cout << "accepted-intervening " << joinStrings(Out.acceptedInterveningCalls) << "\n";
    for (const auto &Route : Out.deniedRoutes) {
      std::string Evaluated;
      for (size_t I = 0; I < Route.evaluated.size(); ++I) {
        if (I > 0)
          Evaluated += ",";
        Evaluated += Route.evaluated[I].operandLeafId;
        Evaluated += Route.evaluated[I].outcome ? "=true" : "=false";
      }
      std::cout << "route evaluated " << (Evaluated.empty() ? "empty" : Evaluated)
                << " return " << orNone(Route.returnId)
                << " calls " << joinStrings(Route.interveningCalls) << "\n";
    }
    std::cout << "end " << V.id << "\n";
  }

  std::cout << "expects\n";
  for (const std::string &Expect : Expects)
    std::cout << Expect << "\n";
  return 0;
}
