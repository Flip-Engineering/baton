// context-clang-20 entry point. Reads one private-contract JSON document on
// stdin, runs the extraction, writes one JSON document on stdout. Refusals
// exit 2 with the structured error document; extraction failure reports in
// the output document with a nonempty error field and exit 0. --probe emits
// the linked-version identity document used by the provider discovery.
#include "analyze.h"
#include "contract.h"
#include "json.h"

#include "clang/Tooling/Tooling.h"
#include "llvm/ADT/SmallString.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"

#include <cstdio>
#include <string>
#include <unistd.h>

using namespace ctxclang;

namespace {

int writeOut(const std::string &Text) {
  llvm::outs() << Text << "\n";
  llvm::outs().flush();
  return 0;
}

int refuse(const std::string &Command, const std::string &Condition) {
  JsonObject E;
  E.push_back({"error", Json::str("validationRefusal")});
  E.push_back({"command", Json::str(Command)});
  E.push_back({"condition", Json::str(Condition)});
  E.push_back({"next", Json::array({})});
  llvm::errs() << Json::object(std::move(E)).dump() << "\n";
  return 2;
}

std::string readStdin() {
  std::string All;
  char Buf[1 << 16];
  size_t N;
  while ((N = fread(Buf, 1, sizeof(Buf), stdin)) > 0)
    All.append(Buf, N);
  return All;
}

} // namespace

int main(int Argc, char **Argv) {
  if (Argc >= 2 && std::string(Argv[1]) == "--version") {
    llvm::outs() << "context-clang-20 " << "0.1.0" << " (clang "
                 << ClangVersionString << ")\n";
    return 0;
  }
  if (Argc >= 2 && std::string(Argv[1]) == "--probe") {
    // The probe actually exercises the linked clang libraries with a real
    // in-process parse before reporting identity.
    auto AU = clang::tooling::buildASTFromCode("int probe_x;\n");
    if (!AU) {
      JsonObject E;
      E.push_back({"error", Json::str("probeFailed")});
      E.push_back({"command", Json::str("--probe")});
      E.push_back({"condition", Json::str("inProcessParseFailed")});
      E.push_back({"next", Json::array({})});
      llvm::errs() << Json::object(std::move(E)).dump() << "\n";
      return 2;
    }
    JsonObject O;
    O.push_back({"name", Json::str("context-clang-20")});
    O.push_back({"version", Json::str("0.1.0")});
    O.push_back({"clangVersion", Json::str(ClangVersionString)});
    O.push_back({"inProcessParse", Json::boolean(true)});
    return writeOut(Json::object(std::move(O)).dump());
  }
  if (Argc < 2 || std::string(Argv[1]) != "-") {
    return refuse("context-clang-20", "stdinDocumentRequired");
  }

  std::string Text = readStdin();
  Json Doc;
  std::string Error;
  if (!Json::parse(Text, Doc, Error))
    return refuse("context-clang-20", "invalidJson: " + Error);
  Input In;
  if (!Input::decode(Doc, In, Error))
    return refuse("context-clang-20", Error);

  // The extraction runs with the declared directory as the working
  // directory so relative compile-command paths resolve as declared.
  {
    llvm::SmallString<256> Dir(In.directory);
    if (chdir(Dir.c_str()) != 0)
      return refuse("context-clang-20", "directoryUnusable");
  }

  Output Out;
  runAnalysis(In, Out);
  return writeOut(Out.toJson().dump());
}
