# Compiler semantics oracle corpus

The runner compares fixture facts from TypeScript and Clang with independent
semantic assertions. Its probes call the compiler APIs and tools directly.
Installed provider and native CLI/MCP qualification require separate integration
with the admitted provider artifact and its retained query evidence.

## Source composition

`run.mjs` selects `ts/probe-ts.mjs` or `c/probe-c.mjs`, then imports the
corresponding oracle modules. The probes and oracles use `lib/util.mjs` and the
fixture tree beside them. All JavaScript imports in this subtree use Node
built-ins or local source, except the explicitly supplied TypeScript library.
TypeScript also reads its staged standard libraries. C fixtures include the
local `include/handler.h`; Clang additionally needs its resource headers and
platform toolchain closure.

The TS runner selects symbols, diagnostics, flow, exceptions, SQL source joins
and invalidation. The C runner selects signatures, calls, guards and CFG
relations. `c/oracles/clangd.oracle.mjs` is retained source for a separate
capability check; the current C runner does not select it. The probes record
compiler identities in their reports. These observations require independent
verification against the admitted runtime and compiler artifacts.

## Remote invocation

Every syntax check, compiler invocation and fixture run requires exact admission
on a remote runner. From this directory, the entrypoints are:

```sh
node run.mjs ts --typescript /staged/typescript/lib/typescript.js \
  --evidence-dir /evidence/unique-ts-run
node run.mjs c --clang /staged/llvm/bin/clang \
  --clangd /staged/llvm/bin/clangd --evidence-dir /evidence/unique-c-run
```

Stage TypeScript 5.9.3 with its complete library directory, or LLVM/Clang and
clangd 20.1.8 with their dependencies. Supply absolute tool paths. The Node
floor qualification uses exactly 22.15.0; a qualification-host Node run retains
its own runtime identity and evidence directory. These versions are qualification
requirements, not results from this source composition.

Use a new evidence directory for each attempt and retain the whole runner's
stdout, stderr and exit status. Case files contain the returned probe values
and failed assertions; they do not constitute complete child-stream or
interrupted-process custody. The report identifies selected suites and checks.
An empty selection fails. The runner's success covers only the selected oracle
checks that actually ran.

`--suite` selects an exported suite name from the configured oracle modules.
Fixture locations are derived from fixture text; assertions compare identities,
diagnostic families and structural relationships. The input fixtures include
intentional invalid programs and must remain unchanged during a run.
