# Synthesis314 code-semantics oracle qualification receipt — d5384042

Request: synthesis314 + code-remote-qual-request-20261006 (semantic-impl-code). Oracle corpus `bend2/context/acceptance/code-semantics/` at branch codex/baton2-semantic-impl-code-20261005 HEAD `d5384042dff2d108496b25e2422220fc2a701556`, tree `52d88eecbf7addba0feb850f4a8d48f3e3f48f9b` (clean at checkout, verified remotely).

## Staged toolchain (hashes in inputs.sha256, verified during provisioning)

- Node `v22.15.0` (archive `dafe2e8f…78fd4`, nodejs.org dist) — exact floor version per README.
- TypeScript `5.9.3` (npm tarball `10e108c9…a1d3`, `staged/typescript/package/lib/typescript.js`, version read from the library itself).
- LLVM Clang `20.1.8` and clangd `20.1.8` (`LLVM-20.1.8-Linux-X64.tar.xz` `1ead36b3…c1ae6`; clang reports llvm-project commit `87f0227cb60147a26a1eeb4fb06e3b505e9c7261`).

## Runner

Host `acp-compute-cluster-001`, Linux x86_64, kernel 6.14.0-37-generic. Root `/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/code-semantics-d5384042`, service `baton2-code-semantics-d5384042.service`, invocation `2e2aaab42b0a43d38199eab447bcff8c`, custody `batonci`, `PrivateNetwork=yes`, `NoNewPrivileges=yes`. Fresh evidence directories `evidence/ts-run` and `evidence/c-run`. Started 19:05:53Z, ended 19:06:08Z 2026-10-06.

## Results

| Stage | Command | Exit | Outcome |
| --- | --- | --- | --- |
| oracle-ts | `node run.mjs ts --typescript …/typescript.js --evidence-dir …/ts-run` | 1 | Oracle executed: **68 checks, 23 failures, ok:false** |
| oracle-c | `node run.mjs c --clang …/clang --clangd …/clangd --evidence-dir …/c-run` | 1 | **C probe never executed** — ESM parse error |

### oracle-ts (full execution)

Suites with failed checks (13): alias-use-resolves-to-canonical-declaration (1), quoted-literal-member-access-is-indexed (2), unreachable-7027-family-depends-on-options (2), declared-throws-jsdoc (5), quoted-method-access-shares-declaration-identity (2), imported-module-edit-changes-snapshot-and-type (1), added-module-changes-resolution (2), config-exclusion-honored (1). Six further suites report ok:false with zero executed checks (merged-symbol-carries-two-declarations, computed-and-any-access-produce-no-edge, dynamic-import-not-covered, literal-sql-receiver-resolution-is-checker-based, unknown-receiver-and-variable-key-are-unresolved, shadowed-prepare-is-a-different-symbol) — their probe facts did not materialize, so no check ran; per the README the runner's success covers only checks that actually ran. 16 suites passed fully. Complete per-case JSON retained in `oracle-ts.stdout` (16965 bytes, SHA256 `d231da73…cbc98`).

### oracle-c (not executed)

`c/probe-c.mjs:204` declares `const arguments = Array.isArray(node.inner) ? …` — `arguments` is a reserved binding in strict mode, and ESM is always strict. Node 22.15.0 rejects the module at parse time (`SyntaxError: Unexpected eval or arguments in strict mode`), exit 1 in 76 ms, before any clang/clangd contact. This is a committed-source defect at d5384042 (single occurrence, confirmed in the worktree), independent of the staged toolchain. No C oracle check ran; clang and clangd identities were verified only via `--version`.

## Verdict

The bounded oracle run is executed with exact pinned toolchain and fresh evidence. Result: **not qualified** — TS oracle reports 23/68 check failures, and the C oracle is blocked by a source-level strict-mode defect in the committed corpus. Independent fixture review, installed provider and native CLI/MCP acceptance through the admitted artifact remain outside this run's scope.

## Evidence

Local `.scratch/native-ci-evidence/code-semantics-d5384042/` (manifests, provision/service records, retained-evidence.tar.gz, extracted results/). Remote qualification root retained.
