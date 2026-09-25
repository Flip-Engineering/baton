# ROW BRIEF — row-task-namespace: member task ids carry the wave namespace (#200 root)

Deliverable: implementation + red-first pin suite. Issue #200 is the contract; read it first.

## Anchors (re-verify at YOUR head)

- impl/src/wave.mjs — task id derivation for members (content-derived WITHOUT the wave key;
  the issue's evidence: baton-0b77f5031f85e9b33edbad4d-work bound by re-drive attempt-b).
- impl/src/workflow-interpreter.mjs — where the member brief/task mint rides the wave key
  (idempotencyKey) today for admission; the salt exists at the wave level (saltObjectives).

## Contract (closed)

1. Member task ids derive from (wave idempotencyKey, role, brief content) — a same-brief
   re-drive NEVER collides with a prior attempt's task id. Existing salt mechanism if it
   fits; else additive salt at the member mint.
2. Back-compat: wave-internal lookups by role unaffected; store schemas unchanged.
3. Red-first pin impl/test/wave-task-namespace-red.test.mjs: two waves, identical briefs,
   distinct keys -> distinct task ids, second drive spawns fresh (RED at pre-change head:
   today the second binds the dead task and verdicts failed with no spawn).

## Hard bounds

Additive hunks; no new event kinds; never edit an existing suite to pass; batteries green.
