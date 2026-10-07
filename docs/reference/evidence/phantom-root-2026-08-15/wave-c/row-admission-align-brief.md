# ROW BRIEF — row-admission-align: wave admission refuses what members cannot start (#207 root)

Deliverable: implementation + red-first pin suite. Issue #207 is the contract.

## Anchors

- impl/src/workflow-interpreter.mjs:39 OBJECTIVE_REF_MAX_BYTES = 64KiB.
- impl/src/limits.mjs:56 run.objective cap 4096 (refusalCode spill_body_exceeded).
- impl/src/wave.mjs createWave -> entry.startError capture; 852700a5 surfaced
  terminalCause:'start' — VERIFY that landing covers the receipt path, then fix the ADMISSION
  misalignment: the interpreter must refuse at waves.compile/admission when an objectiveRef
  brief exceeds the run.start objective cap, naming both byte counts (fail-loud at the seam,
  never per-member phantom failure).

## Contract (closed)

1. Admission-time refusal: brief > run.objective cap -> typed workflow_spec_invalid-class
   refusal at compile/admit with measured bytes in the message.
2. The 64KiB OBJECTIVE_REF_MAX_BYTES either aligns to the run cap or is documented as the
   spill-aware envelope (admission may pass if the interpreter splits) — pick per the
   existing spill semantics (OQ5: spill-aware advisory PASS) and record the judgment call.
3. Red-first pin impl/test/objective-admission-align-red.test.mjs: a 4-64KiB brief refuses
   at admission naming byte counts (RED at pre-change head: admits, then every member
   spill_body_exceeded).

## Hard bounds

Additive; no cap changes to run.objective itself; batteries green.
