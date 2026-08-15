[attempt: 7741f6cb-9563-480e-9cc4-a6bc6a6f9332 row-admission-align]

# row-admission-align — wave admission refuses what members cannot start (#207 root)

Deliverable: the interpreter now refuses at the compile/admit seam when an objectiveRef brief
renders over the run.start objective cap, naming both byte counts; the 64 KiB envelope is aligned
to the registry cap; the red-first pin suite is green on the fix.

## Changes (all within the assigned path scope + the brief-mandated pin file)

- `impl/src/workflow-interpreter.mjs`
  - `OBJECTIVE_REF_MAX_BYTES` now derives from `FRAME_LIMITS['run.objective'].value` (Decision 8 —
    the registry is the only source; no re-declared literal). `limits.mjs` joins the lane's import
    graph as the one pure-data exception (it runs nothing at top level, so the F10b transitive-graph
    law and W5-01 stay green).
  - `renderObjective` measures the RENDERED objective (`[attempt: <salt> <role>] ` + brief — exactly
    what run.start admits) and, when it exceeds the cap, throws `workflow_objective_ref_invalid`
    naming the member role, the ref, the measured bytes, and the cap. Fail-loud at admission —
    never a per-member phantom start failure.
- `impl/src/limits.mjs` — additive doc comment at the `run.objective` row (comment only; the
  `FRAME_LIMITS_DIGEST` over the declared rows is byte-identical). No cap changed anywhere.
- `impl/test/objective-admission-align-red.test.mjs` — the contract's red-first pin suite:
  - 4097 / 8192 / 65536-byte briefs refuse at admission with `workflow_objective_ref_invalid`
    naming both byte counts (measured rendered bytes + the 4096 cap);
  - boundary guard: a brief at cap − 200 admits and settles (the refusal is the run-cap alignment,
    never a blanket objectiveRef wall).

## Judgment call (contract 2): the 64 KiB bound ALIGNS to the run cap

OQ5's spill-aware advisory PASS is sound only where the lane actually SPLITS — the inline
run.start path mints a durable digest-citable spill artifact and the run proceeds (pinned by
frame-economics-red C7/C10). The by-reference lane renders the FULL brief into the member
objective and hands it to the embedded client (`BatonRuns.start` → `prepareRunStart` → the
`nonempty` byte wall, application-client.mjs:11-12), which refuses anything over 4 KiB before the
spill-aware application admission is ever reached. There is no split in this lane, so a
"spill-aware envelope" admission would only reproduce the phantom. The bound therefore aligns to
the registry run.objective value; the F8b behavior pin (64 KiB + 1 refuses, workflow-as-data-red
W1-03) still holds — the refusal now names both byte counts.

Refusal class: `workflow_objective_ref_invalid` — the objectiveRef member of the
workflow_spec_invalid family, consistent with the sibling D5 byte-bound refusal at the same seam
(the previous 64 KiB refusal used the same code, pinned by W1-03).

## Measured pre-change head (RED — da16e834, 2026-08-15)

A 5000-byte brief through the real interpreter path (bindBaton + runWorkflow over BatonApplication):
the lane ADMITTED and resolved a D6 receipt whose member outcome was `phase:'failed'`,
`terminalCause:'start'`, `error:{code:'application_client_invalid', message:'Run objective is
required'}` — the misleading client wall, per-member and phantom (the brief's `spill_body_exceeded`
attribution is the same mechanism; the client's `nonempty` refuses at the same 4,096 bytes before
the application's spill admission). Contract QA's GT-L6 ("no longer phantom-fails at HEAD") was
measured against the application start seam, missing the embedded-client seam this row fixes.

## Verification

- Pin RED at pre-change head (lane admitted; assertion failed at the named stage), GREEN on the fix.
- `workflow-as-data-red` 45/45 green (W1-03 oversize pin, W5-01 import law, F10b walk, W2-phantom).
- `launch-validation-red` unchanged: 9 red / 3 green — the suite's own documented split, verified
  byte-identical against the clean HEAD (no regression from this change).
- Full battery: see the run-suite exit (below).

Known minor drift (out of path scope): `workflow-lane.mjs`'s header comment says the interpreter's
static import graph is "only Node built-ins"; it now also reaches the pure-data `limits.mjs`
(Decision 8). The comment could not be edited under this row's path scope; the law it describes
(F10b — no top-level driver call site) is verified green by W5-01.
