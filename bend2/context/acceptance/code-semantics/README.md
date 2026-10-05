# code-semantics acceptance corpus

Independent executable qualification fixtures and oracles for the code
engines (TypeScript and Clang) described in
`docs/bend2/semantic-context-spec.md` at the approved commit. This corpus is
owned by the semantics-critic session (`semantic-impl-code-semantics-critic`)
and contains only new fixtures, oracles, probes and vector data. It contains
no provider production code and imports no provider implementation.

## Layout

```
run.mjs                     oracle runner (TypeScript and C suites)
lib/util.mjs                shared helpers (SHA-256, locating, checker)
ts/fixtures/                TypeScript corpus (strict, types:[] pinned)
ts/fixtures/src/excluded/   excluded-by-config inputs (config-selection oracle)
ts/fixtures/invalidation/   cross-file invalidation inputs (overlay-swapped lib)
ts/fixtures/ambient/        fixture-authored client declaration (named input)
ts/oracles/*.mjs            TS oracles: symbols, diagnostics, flow, exceptions,
                            constant-SQL source join, invalidation
ts/probe-ts.mjs             provider-direct probe over the pinned TS compiler
c/fixtures/                 C corpus (gnu89, -Wall, compile_commands.json)
c/fixtures/include/         shared header with stand-in db_* helpers
c/fixtures/solveguard/      pure solveGuard test vectors + remote C++ driver
c/oracles/*.mjs             C oracles: signature, calls, guard, cfg, clangd
c/probe-c.mjs               provider-direct probe over clang/clangd
```

## Execution boundary

All compilation, compiler invocation and test execution for this corpus runs
on admitted remote validation runners only. Nothing here executes providers
locally. The runner and probes are source delivered to the runner; exact
entrypoints:

### TypeScript suite

```
node run.mjs ts --typescript <path-to-pinned>/lib/typescript.js \
     --evidence-dir <raw-output-dir>
```

Requirements: Node 22.15.0 exact for floor-version runs (binary
SHA-256 `6a1137a572bc6648411bfe51032173a535e010576cad6da87547f414daa11fdb`
from the retained provisioning); runner Node versions are recorded in the
report and must be stated separately from the floor run. TypeScript must be
the pinned 5.9.3 package with real staged bytes inside the package tree
(symlinked external installs are refused by production containment and must
not be used here either).

### C suite

```
node run.mjs c --clang <llvm-20.1.8-clang> --clangd <llvm-20.1.8-clangd> \
     --evidence-dir <raw-output-dir>
```

Requirements: external LLVM/Clang clang and clangd 20.1.8 on the runner
(declared external dependency; record the actual resolved paths and
`--version` output). The probe spawns clangd per case with
`--background-index=0` and the fixture `compile_commands.json` at the fixture
root.

### solveGuard pure vectors (no LLVM)

```
c++ -std=c++17 -I <extractor-src> \
    c/fixtures/solveguard/solveguard-driver.cpp -o solveguard-driver
./solveguard-driver c/fixtures/solveguard/vectors.txt
```

`<extractor-src>` is the staged `bend2/context/clang/extractor/src` directory
(commit-identified at remote admission). The vectors encode specification
semantics, not current implementation behavior; several vectors are expected
to fail against an uncorrected `solveGuard` and the failing blocks are the
required negative controls (AND/OR/negation exit sets, nonDecision mapping,
denial dead end, per-route call accumulation, accepted-side intervening
calls).

## Oracle semantics

Every oracle asserts semantic facts: resolved identities, diagnostic family
membership, structural graph relations, contract-required refusals. No oracle
pins counts or line numbers of implementation code; fixture spans are located
from fixture bytes at run time. Classification vocabulary follows the spec:
`checked` for compiler-family verdicts, `static-possible` for resolved static
relationships, `declared` for authored text (JSDoc), `observed` for
runtime/catalog facts (out of scope here; owned by the security/runtime
fixture owners).

## Absent source gates

The following provider surfaces do not exist in this worktree; adapter-mode
execution of these oracles is admitted only when the named candidates land:

- TypeScript provider functions and TS-specific laws:
  `bend2/src/context/typescript.bend` and its law module, owned by
  `semantic-impl-typescript`. The constant-SQL, module-use and diagnostic
  oracles run unchanged against that candidate's projection functions once
  pinned.
- Clang LibTooling extractor binary (AST/CFG mapping): owned solely by
  `semantic-impl-clang`. The AST/CFG oracles run against the extractor's
  emitted graph and refs once a pinned build exists; the pure solveGuard
  vectors already run without it.
- Native SQL planner (planner tail/second-statement/authorizer profiles):
  native-owned. The source-side prepare-profile oracles here pin only the
  source facts the planner consumes; planner-profile oracles are deferred to
  the planner owner's surface and are not stubbed here.

## Expectation provenance

TS expectations derive from the approved specification plus the retained
bindings/flow research (pinned TS 5.9.3 outputs). C structural expectations
were cross-checked against actual clang/clangd 20.1.8 runs on this corpus
before the remote-only execution boundary took effect; that pre-boundary
session evidence is recorded in the session's private evidence directory
with host and tool identities. solveGuard vector expectations derive from the
approved specification only.
