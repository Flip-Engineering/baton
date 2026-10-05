# Remote runner runbook — code-package installed-acceptance

Exact inputs and commands for admitted remote Darwin arm64 runners. Every run
captures complete stdout/stderr, real exit statuses and sha256 identities into
the evidence directory given by `--evidence`. Refusal exit 3 lists missing
candidate inputs and is an expected state until package/extractor candidates
are admitted; it is not a failure of the runner.

## Required runner inputs

1. Repository worktree at the critic-owned commit (see the handoff message for
   the exact commit/tree/base).
2. Exact Node 22.15.0 darwin-arm64: download
   `https://nodejs.org/dist/v22.15.0/node-v22.15.0-darwin-arm64.tar.gz` plus
   `SHASUMS256.txt` from the same directory; verify the archive line
   `92eb58f54d172ed9dee320b8450f1390db629d4262c936d5c074b25a110fed02` before
   extracting; binary sha256 must be
   `6a1137a572bc6648411bfe51032173a535e010576cad6da87547f414daa11fdb`
   (verified on the local host independently by two downloads).
3. TypeScript 5.9.3 reference bundle for harness self-qualification:
   `npm pack typescript@5.9.3` + extract, or the staged package tree once the
   package candidate exists. Expected `lib/typescript.js` sha256 and d.ts
   identity are recorded by the run itself.
4. External LLVM/Clang 20.1.8 (Homebrew or distribution equivalent) with
   `clang`, `clangd`, `libclang-cpp.dylib`, `lib/cmake/clang/ClangConfig.cmake`;
   pass its prefix via `--llvm-prefix`.
5. Xcode SDK for the `-isysroot` syntax-only gate (`xcrun --show-sdk-path`).
6. For the Fossil harness: the retained authentic fixture root
   (`.scratch/semantic-context-20261005/probes/semantic-models-security-critic/fossil-qualification/source/fossil`
   and `runtime-connection/allowed.fossil`) copied to the runner, plus the
   codec-owned result-schema map when it lands.

## Commands

TS package isolation (self-qualification now; installed acceptance when the
candidate root exists):

    python3 bend2/context/acceptance/code-package/ts-package-isolation/harness.py \
      --typescript-dir <extracted typescript@5.9.3 package> \
      [--package-root <staged package root>] \
      --node <runner node-v22.15.0 binary> \
      --host-node <runner default node if >= 22.15.0> \
      --evidence <private evidence dir>/ts-isolation

LLVM/Clang 20.1.8 artifact closure (candidate-gated):

    python3 bend2/context/acceptance/code-package/clang-artifact-closure/harness.py \
      --package-root <staged package root> \
      --llvm-prefix <external llvm 20.1.8 prefix> \
      [--extractor-invocation <json argv template from the extractor owner>] \
      --evidence <private evidence dir>/clang-closure

Fossil five-family (grounding inspection runs today; joined checks are
candidate-gated):

    python3 bend2/context/acceptance/code-package/fossil-five-family/harness.py \
      [--installed-cli <installed baton2> --db <coordination db> --session <active session>] \
      [--extractor-invocation <json argv template>] \
      [--result-map <codec schema map>] \
      --fixture-root <runner copy of fossil source root> \
      --catalog <runner copy of allowed.fossil> \
      --evidence <private evidence dir>/fossil-five

## Open candidate inputs (missing-input refusals name these)

- staged package root under `libexec/baton2/` with `bend2/context/package.json`
  + lockfile pin and recorded payload hashes;
- `libexec/baton2/context-clang-20` extractor artifact with sha256 (actual
  immutable source + remote build result first);
- extractor CLI invocation template (owner-declared; none invented);
- installed baton2 CLI containing `context-query`, coordination database and
  active session;
- codec-owned result-schema map for the five-family predicates;
- contingent `libexec/baton2/context/fossil-helper-summary.json` per Models
  exact source declaration.

## Pre-boundary local evidence provenance

Local runs `package-critic-evidence/ts-package-isolation-selfqual-1` and
`-selfqual-2` executed before the remote-only boundary. They are retained with
their original provenance. Findings absorbed into source: the type-check host
must serve the bundled lib chain, `moduleResolution Node16` is required for the
`.js` import to resolve to the bundled `d.ts` while fixture programs use
`NodeJs`, and checker internals crash capture must become structured gate
failures. These two runs did not qualify anything and are superseded by the
remote runs above.
