## Verdict

REVISE. Attach-only identity proof and prompt ordering are substantially implemented: recovery passes `attachOnly: true`, waits for exactly one fresh `lifecycle.spawned`, compares the wire identity with the persisted native ID, atomically creates/claims the refinement, records the continuation intent, and only then invokes the Brief dialect hook. The committed focused suite also exercises all three adapters and coordinator failure/replay paths. One P1 leaves exact model/effort recovery failure in a falsely live durable state.

## P0-P1 findings

- **P1 — route mismatch leaves the recovery refinement durably `working`.** In `impl/src/coordinator.mjs:2326-2358`, `_recover()` first calls `_createCoordinationRecoveryRefinement`, whose dedicated store API durably creates and claims the new task as `working`. It then admits the buffered provider testimony and, when `handle.modelMismatch` or `handle.effortMismatch` is set, kills the transport and immediately returns `recovery_route_mismatch`. Unlike prompt refusal/unknown paths, this branch never transitions the newly claimed refinement to `failed`. Replay therefore retains a claimed working recovery task even though exact route recovery was refused and its transport was reaped. That contradicts NR2's no-substitution rule and NR3's requirement that a failed recovery not fabricate working recovery. The tests cover mismatch teardown, but do not assert durable refinement closure after the post-claim mismatch.

No P0 finding. I found no confirmed defect in attach-only native-ID comparison or no-prompt-before-commit ordering. Missing/wrong Grok identity is retained as current scope; provider-idle testimony, old in-flight-turn safety, provider-history reconciliation, and operator resolution of `dispatch_unknown` are explicitly later scope under NR4/NR6/NR8, not defects.

## Required corrections

On the post-claim model/effort mismatch branch, atomically or evidence-backed transition the exact recovery refinement to `failed` before completing ordered transport/runtime cleanup and releasing provider authority. Preserve the completed verified prior task unchanged. Add a coordinator/replay assertion that model mismatch and effort mismatch each leave no live recovery refinement, send no prompt, reap exactly once, and retain the exact requested/resolved model and effort in durable attribution.