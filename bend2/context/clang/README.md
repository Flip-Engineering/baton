# Clang context providers

This module owns the two C/C++ context providers: the first-party LibTooling
extractor (`clang-analyzer`) and the clangd protocol adapter (`clangd`).

## Layout

```text
extractor/   C++ LibTooling extractor; CMake target context-clang-20
adapter/     Node 22.15.0 adapter modules (clang-analyzer.mjs, clangd.mjs)
test/        source tests and fixtures (remote-executed)
```

The staged package installs the extractor binary as
`libexec/baton2/context-clang-20` and the adapter modules under
`libexec/baton2/context/clang/adapter/`. From the installed adapter URL,
`../../../context-clang-20` resolves the extractor and
`../../fossil-helper-summary.json` resolves the helper summary owned by the
security fixtures owner. Both resolutions use `import.meta.url`; the adapters
read no ambient paths.

## Extractor private contract

The extractor reads one JSON document on stdin and writes one JSON document
on stdout. This is the producer/consumer contract between the extractor and
the clang-analyzer adapter; it is not the public canonical request schema.

Input members (closed; unknown members refuse): `version` (1), `operation`
(`handlerAnalysis` | `functionSignature`), `directory` (absolute), `file`
(translation unit as given to the compile command), `arguments` (reduced
frontend command, program name first, translation unit last), `subject`
(`position` with zero-based line and UTF-16 column, or `symbol` with name),
optional `pairs` (original/generated file pairs) and optional `helpers`
(helper function names to parse).

The output document records: the selected function identity (canonical USR,
formals, return type, variadic status, token-inclusive body interval),
generated/original correspondence with the verified unique identical-bytes
mapping, conditions with classified operands and supported-guard status,
direct calls with canonical callee identities and parameter types, returns,
global reads, the mapped CFG (blocks, elements, terminator conditions,
labeled edges), derived `guarded_call` relations with whole-condition
accepted/denied exit sets, denial routes with evaluated operands and mapped
returns, compiler diagnostics, helper definitions with formals and variadic
status, helper call candidates with SQL literal bytes and bound-local
lineage, and the hashed consumed-input manifest read in-process.

Derivation rules: guard relations come from `CFG::buildCFG` inside the same
`ASTContext` that resolves declarations, mapped by `CFGStmt::getStmt`
in-process identity, `getTerminatorCondition` and `getLastCondition`.
Whole-condition exit values come from the condition's logical tree simulated
with short-circuit evaluation and cross-checked against the mapped edges; a
`nonDecision` exit or any disagreement refuses the mapping. No block
numbers, source-text parsing or first-IfStmt selection participates.

Refusals exit 2 with `{"error","command","condition","next"}` on stderr and
empty stdout. An extraction that runs but fails reports `error` in the output
document with exit 0.

## Adapter contract

Both adapters run as `<absolute node> <adapter.mjs> -` and read one JSON
command document on stdin. `version` must equal 1; unknown members and
commands refuse with exit 2.

`providerEngines` performs the fixed capability probe and answers one
document: `{version:1, provider, engines:[{engine, provider, version,
executable, sha256, linkedIdentity, projections, effects, availability,
limits}]}`. The clang-analyzer entry runs `context-clang-20 --probe` (an
actual in-process parse proving the linked closure) and hashes the binary.
The clangd entry takes `executable` (absolute path selected by the
deployment provider selection), runs `clangd --version`, and records the
real path, parsed version and binary hash. Failed probes stay visible as
`availability:"unavailable"` with their code.

`analyze` (clang-analyzer) forwards one closed private-contract document to
the extractor and returns its result plus the extractor binary identity.
`diagnose` (clangd) opens one captured document at a recorded integer
version with `textDocument.publishDiagnostics.versionSupport:true`, runs the
requested language-service methods, and completes the diagnostics projection
only on `textDocument/publishDiagnostics` for the exact URI and exact
version; an explicit empty array completes with no diagnostics. Versionless
publications, other URIs and other versions are retained evidence. The
adapter adds no timer: silence never completes or fails the projection;
provider exit, transport failure and structured protocol errors are failure
evidence.

## Build (remote runners only)

Pinned dependency: LLVM/Clang 20.1.8 with `ClangConfig.cmake`, the
`clang-cpp` shared library and resource headers. Qualified closure observed
on darwin-arm64: `/opt/homebrew/opt/llvm` 20.1.8 (`libclang-cpp.dylib`
Mach-O arm64, `ClangConfig.cmake` present). The runtime closure of the
installed binary is a package-owner qualification obligation.

```sh
cmake -S bend2/context/clang/extractor -B <build-dir> \
  -DLLVM_DIR=<llvm-prefix>/lib/cmake/llvm \
  -DClang_DIR=<llvm-prefix>/lib/cmake/clang \
  -DCMAKE_BUILD_TYPE=Release
cmake --build <build-dir> --target context-clang-20
```

The extractor links `clang-cpp` and `LLVM` from the selected package. No
other dependency is admitted. Compiler flags `-plugin` and `-load` (direct
or through `-Xclang`) refuse before any parse.

## Evidence limits

Derived relations are facts about the mapped CFG of the parsed translation
unit under the supplied frontend options and captured inputs. Generated/
original correspondence requires a unique identical-bytes segment in the
paired original file; ambiguous or missing segments keep direct
generated-source facts without an original mapping. The helper trust
boundary stays with the reviewed helper summary; the extractor emits parsed
definitions and call candidates only. No executable-contribution claim is
made by any output of this module.
