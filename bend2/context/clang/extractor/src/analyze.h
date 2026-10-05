// In-process LLVM/Clang 20.1.8 extraction: parse the admitted translation
// unit, select the requested function, map its CFG through CFGStmt::getStmt
// in-process identity, and emit snapshot-bound facts. No CFG block numbers,
// source text parsing or preferred statements participate in any derivation.
#ifndef CONTEXT_CLANG_ANALYZE_H
#define CONTEXT_CLANG_ANALYZE_H

#include "contract.h"

namespace ctxclang {

// Number of clang/extractor versions recorded in every output document.
extern const char *const ClangVersionString;

// Run one extraction. Parses args[0..n) (argv[0] first, translation unit
// last) in the caller's current working directory. Returns false and fills
// Output.error on operation failure.
bool runAnalysis(const Input &In, Output &Out);

} // namespace ctxclang

#endif
