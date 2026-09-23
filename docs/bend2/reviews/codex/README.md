# Codex architecture review record

This directory holds the external Codex review of the Baton2 architecture and its evidence, copied
byte for byte from the operator's review directory. The review covers the six staged documents at
`387ff4399c382e49a8320e12ab48d949c3cd54b6`: `architecture-review.md`, `target-architecture.md`,
`architecture-findings-coordination.md`, `architecture-findings-surface.md`, `rewrite-plan.md`, and
`go-no-go.md`. The review names each input by SHA256 and reports that each hash matches the Git
object at that commit.

## Verdict

The eight logical owners are a useful prototype architecture. The evidence supports Prototype-only
for production authority transfer. The rewrite proceeds under the operator's standing authorization
with the corrections below and bounded proofs. The review does not reopen the final approval of the
16 operative laws at `1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35`.

## Required corrections

The review states seven corrections to the proposal. Each is an obligation on the named phase or
mechanism before it carries production authority:

1. Capability provenance and structured lifecycle management are explicit prerequisites. Ordinary
   application records are forgeable and droppable; `LANG-F-26` and `LANG-F-28` supply the
   counterexamples. Close, cancellation acknowledgement, process termination, reap and custody
   release are specified independently (findings F5, F7, F8; laws M-4, M-7, M-8, M-17).
2. Phase 4 binds publication to the admitted canonical shared destination, the expected shared
   target state, and the verified artifact. Local preparation has its own state, and completion
   requires evidence from the shared destination (issue #558; laws M-3a, M-3b, M-3c, M-8, M-18).
3. The native host prerequisites include a demonstrated durable journal path: append, partial
   writes, file synchronization, replacement, directory persistence where required, interprocess
   serialization and stale-writer exclusion. The `U32` File quantities need a segmentation design
   for large logical journals (laws M-1, M-5, M-8, M-10).
4. Reconciliation separates operation identity, attempt identity, local ownership and observed
   external outcome. An unreachable local value does not establish the external outcome, so a
   generic retry rule cannot replace effect-specific evidence (laws M-2, M-3b, M-3c, M-8, M-17).
5. Startup, doctor and recovery use the same applicable recorded schema and policy basis, or report
   that the basis cannot be reconstructed. A missing-policy replay refusal is classified separately
   from corrupted source bytes (laws M-5, M-7, M-14, M-17).
6. Change-to-contract verification coverage is demonstrated before the seam inventory is deleted. A
   pure helper change, a schema change, a shared library change and an altered C effect each need
   coverage (F17; law M-3a).
7. The migration maps to the approved 16 prohibitions. The 138-row register stays as classificatory
   compatibility evidence, and the runtime premise is corrected to the validated generated-C and
   BendRT path of the accepted pin.

## Files

| File | SHA256 |
|---|---|
| `codex-architecture-review.md` | `39d3ce14317fcb07fc728d48f0c10c821461e0e19875e00a37d1af59363da55d` |
| `codex-architecture-message.txt` | `69c3cb05e1d615ac32941dbac07c52cba91e53f084e768c7176850e5da649262` |
| `codex-review-manifest.json` | `396fc94431a3ba960a4c69b2037a9d178b718c4ebb2bab6cddd04281bec8258c` |
| `codex-native-surface-checks.json` | `3445a74f695e18b2164995eb362f73e2347d8e10df8e01b5307d36fce0ed9f7b` |
| `codex-probes/dropped-child.bend` | `5c4f864338fedfebfc52dae6fb3b25d7b338fe60269405a386065ad49ad41200` |
| `codex-probes/dropped-child-results.json` | `d7cee9a414af9daf9e625ca37bbc836223ccd5383a6d781de335acb50bc85427` |
| `codex-architecture-message-delivery.json` | `6d9ec21d915b06c6f9afbb9b3d10c63fa2c134310a18f9b578bf7fcae6c3bd7f` |

`codex-architecture-message.txt` records the delivery message that accompanies the review.
`codex-review-manifest.json` names the six reviewed artifacts with their hashes, the review report
hash, and the compiler hash used for the probes. `codex-native-surface-checks.json` records the
Base `File` and `IO` queries that establish which durability and lifecycle operations the installed
2.0.25 surface exposes. `codex-probes/dropped-child.bend` compiles and runs with the pinned
compiler, and `codex-probes/dropped-child-results.json` records the commands and the exact
`parent returned without joining` / `child continued` output.

The final law approval record for the 16 operative entries is
[`../codex-final-law-review-r9.1.md`](../codex-final-law-review-r9.1.md).

## Scope

The review's verdict covers the six documents at the reviewed commit and the source paths it cites.
Later changes to those documents require their own validation. The appendices contain no full test
suite run, no canary, and no production implementation certification.
