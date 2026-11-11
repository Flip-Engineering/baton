# Trust-Gate Steering — Acceptance Reader Report

Surveyor's read-out of `_runTrustGate` and the pause-admission seam that arms
steering. Grounded in the lines read: the gate body
(`impl/src/coordinator.mjs:11297–11704`), its three dispatch sites
(`:10975`, `:2217`, `:2480`), the pause record and the one bounded steering
cycle (`:2009–2122`), the turn-completion guard that precedes dispatch
(`:11119`, `:10964–10967`), and the plan-validation rule that defines the
analysis exemption (`impl/src/goal-plan.mjs:347–353`).

Note: the range `coordinator.mjs:11119–11200` is the `decision.requested`
interaction-admission path (closed-shape check, drain/duplicate rejection,
one-pending-decision defense at `:11146–11200`), not the gate function itself.
The gate begins at `:11297`. Both are reported below; only the gate's checks
populate the first section.

---

## What the gate checks

`_runTrustGate(handle, workerResult, opts)` runs the phases in source order,
each advancing a `trustPhase` marker that rides the durable error verdict on
failure (`coordinator.mjs:11315`, `11651`):

1. **Capture** — `_worktrees.capture(...)` snapshots the worker tree and yields
   `sha` + `changedPaths`, threading the dispatching vendor/model/effort through
   for genuine attribution (`:11319–11329`).
2. **Forbidden effect** — if the plan has a `goalPlan` and changed paths exist
   but the brief's `effects` do not include `repository_edit` (and it is not a
   derived semantic review), capture proved an effect the approved Plan forbids
   → `forbidden_effect_observed` (`:11330–11339`).
3. **Path scope** — changed paths are partitioned by
   `pathInScope(brief.pathScope, path)`; any out-of-scope change →
   `worker_path_scope_violation`, carrying counts and digests for in-scope and
   out-of-scope sets as `pathScopeEvidence` (`:11340–11355`).
4. **Required effect (the progress judgment)** — for a node whose
   `requiredEffects` includes `repository_edit`, the gate requires an in-scope
   diff distinct from base. No `sha`, no `baseSha`, `sha === baseSha`, no changed
   paths, or no in-scope changed path → `required_effect_absent` with
   `requiredEffectEvidence` (`:11359–11377`). This is the phase that turns "the
   worker paused mid-work" into a verdict about whether progress actually
   happened.
5. **Environment** — verify and base-verify worktrees are created
   (`:11378–11399`); the worker's sparse-checkout identity and toolchain
   projection must match the verifier's, else `verification_environment_mismatch`
   (`:11386–11398`).
6. **Structural evidence** — when an `_atlasStructuralEvidence` authority is
   configured and both roots exist, `classify(...)` produces a structural
   change-class over the before/after roots, logged as
   `atlas.structural_classified` and carried as provenance (`:11400–11415`).
   Coverage (`changedLines`) is computed when required (`:11416–11418`).
7. **Referee (sole done-gate)** — `_referee(task, workerResult, { … })` runs the
   pinned verification in the sandbox; `referee.accept()` is the single gate to
   `completed` (`:11420–11426`).

On any failure the gate records an `error` event with `phase: 'trust_gate'` and
the sanitized `trustPhase` plus the phase-specific evidence and, when present,
the `steered` receipt (`:11644–11656`). The three policy-failure codes
(`forbidden_effect_observed`, `required_effect_absent`,
`worker_path_scope_violation`) set a `terminalCause` that names the gate — never
`unknown` — and stop the worker (`:11674–11687`). The `finally` block removes
the owned verify sandboxes and logs any cleanup failure (`:11689–11701`).

## When it fires

The gate is skipped for already-terminal tasks — `TERMINAL_TASK_STATUSES.has(task.status)`
returns immediately (`:11301`), mirroring the interaction family's own terminal
guard (`:11119`). Otherwise it is invoked at three points, each the same call an
ordinary turn completion makes:

- **Ordinary turn completion** — for a non-pausable turn whose task is open and
  not draining/stopping, `Promise.resolve(handle.worktreeReady).then(() =>
  this._runTrustGate(handle, wr))` (`:10970–10976`). The pausable path parks the
  turn in `_admitPauseRecord` first and breaks before this (`:10964–10968`).
- **Steering-expiry final evaluation** — when a paused turn's bounded steering
  window expires unanswered, the turn is unparked to `working` and the full gate
  runs with the steering receipt attached as durable evidence:
  `_runTrustGate(handle, record.workerResult ?? null, { steered: { nudgeId,
  answered: false } })` (`:2207–2219`). "We asked and it never answered" becomes
  evidence on the verdict, not a separate verdict.
- **Live re-run at claim** — `claimTurn` unparks the turn and re-runs the live
  gate against a fresh capture at claim time, never reading the stored
  `changedPathsDigest` as gate input; a claim on a cycle-armed record clears the
  timer first so the window cannot fire later (`:2455–2481`).

The pause record is what makes a turn pausable rather than immediately gated.
`_admitPauseRecord` mints a frozen `origin` (sanitized at mint via the shared
messages pipeline, `:2016–2024`), records `turn.paused`, stores the record keyed
by `pause:${task.id}:${terminalEvent.seq}` carrying `workerResult` so a later
`claim` reproduces the same gate call, and parks `task.status = 'paused'`
(`:2028–2052`). If a driver is registered the turn pends for `claim_turn`; if
not, exactly one steering cycle is armed — one provenance-marked policy nudge
through the control lane and one bounded window (`progressNudgeWindowMs`,
default 300000 ms) whose expiry or answer settles the turn (`:2056–2068`,
`:2098–2114`).

## Why mid-workflow analysis is legitimate work

Not every node must mutate the repository. A plan node may declare `analysis:
true`, and the plan-validation layer treats that field as the **sole legitimate
path** for an effectful node to omit `repository_edit` from its `requiredEffects`
(`goal-plan.mjs:347–353`). Any other omission fails
`plan_required_effect_invalid`, so analysis is declared on the node, not smuggled
past the effect audit.

The gate honors that declaration narrowly. The required-effect verdict is gated
behind `!task.brief?.analysis` (`coordinator.mjs:11359`): an analysis node
skipping `repository_edit` never trips `required_effect_absent`, even though it
produced no in-scope diff. But the comment at `:11356–11358` is explicit that
this exempts **only** the required-effect phase — capture, forbidden-effect,
path-scope, environment, coverage, structural evidence, and the referee all still
run. So an analysis turn is held to the same evidence standard as any other turn;
it is simply not penalized for being the read-only deliverable the plan approved.

This is precisely what makes the present task — a read-heavy surveyor that reads
the gate, records a scratchpad note, and writes a single bounded evidence report
— legitimate mid-workflow work. It performs no `repository_edit` and is not
required to; its deliverable is the report under
`docs/reference/evidence/trust-gate-steering-2026-08-02/`. The gate's other
phases still apply: the capture still snapshots the tree, forbidden effects and
path scope are still enforced against the one file written, and the environment
and structural-evidence machinery still runs. Mid-workflow analysis is work the
plan can authorize and the gate can verify, rather than a gap in the trust model.
