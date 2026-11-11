# Issue #61 — the worker-visible gate verdict + objectives generated from live truth (v1.0 DRAFT)

- **Issue:** #61 — two AX clarity items from the trust-gate steering epic: the worker-facing
  verdict surface (GLM P1-3) and the objective constraint block generated from live truth
  (Opus P0-2). The judged worker never learns why it failed; the HARD CONSTRAINT block ships
  boilerplate that live truth has refuted.
- **Date:** 2026-08-12
- **Status:** v1.0 DRAFT — implementation contract (Ring-2 form: ground truths → decisions →
  refusal vocabulary → red-first acceptance → open questions). Every acceptance pin is RED at
  this HEAD — the behavior is absent from this tree.
- **Verification HEAD:** `2b5003a1cdb5bf25caead2d01d14eb45c33764d2` ("Baton private effective-tree
  snapshot"), the tree every `file:line` citation below was verified against with NUL-safe
  `grep -an` searches and targeted `sed -n` reads.

**NUL discipline.** `impl/src/application.mjs` and `impl/src/coordination-store.mjs` are the two
NUL-bearing files (3 NUL bytes each); their anchors are grep/sed-verified only, never whole-file
reads. `adapter.mjs`, `recipes.mjs`, `cli-adapters.mjs`, `application-deployment.mjs`,
`coordinator.mjs`, `limits.mjs`, `messages.mjs`, and `verifier-diagnostics.mjs` are clean and were
read directly. Sorted-key literals are quoted in their ACTUAL source order (none are sorted
claims); no `localeCompare` ordering is used anywhere in this contract. No clocks: every rule and
pin is a pure function of durable state — no wall-time windows, no retry counts, no numeric caps
beyond the declared `FRAME_LIMITS` rows.

**Cross-references (not re-specified here):** #64 (`trust-gate-steering-decisions.md` — TG4, the
verdict shape and the "worker never learns why" gap this epic closes), DG-1
(`issue53-decisions.md` v2 — the `run.debug` failure leg whose sanitized `{gate, detail}` this
surface reuses verbatim), #79 (`worker-delivery-push-contract.md` — the delivery half: the
sanitized `gate_verdict` push, the consumer of this surface), #73
(`feedback-forge-hardening-contract.md` — verdicts are hub-minted, never caller-authored), #141
(the boundary-commit workstyle law — the live truth that refutes the no-commit boilerplate).
Each is cited at the decision it touches.

Scope in one sentence: **the worker-facing verdict surface is a four-field corrective structure
(`gate`, `check`, `evidence`, `corrective`) that #61 owns beyond #79's delivery mechanics, and the
objective constraint block is generated from the deployment's live policy reads at compose time —
each line derived from a named source, a line that cannot be derived never printed.**

---

## Ground truths (code-verified)

**GT1 — The gate verdict is already a sanitized `{gate, detail}` projection.** `debugGateRefusal(events)`
(application.mjs:993-1014) projects the LATEST trust-gate/verifier refusal — `error` with
`payload['phase'] === 'trust_gate'`, or `verify.reverified` with `accept === false` — into
`{kind, code, message, gate, detail}`. `gate` maps the live code via `debugGateFromLiveCode`
(application.mjs:949-956) against `DEBUG_GATE_CODES` (application.mjs:945-948, ACTUAL order:
`scope`, `red_green`, `coverage`, `route_mismatch`, `forbidden_effect`, `unknown`); `message` is
`boundedAttentionText(event.payload.message)` (application.mjs:1007-1009); `code` is
`debugTerminalCode(liveCode, 'trust_gate_failed')` (application.mjs:1010) — the durable
discriminator. `debugGateDetail` (application.mjs:958-990) is: `scope` → `{digests, counts}` —
NEVER path strings; `red_green`/`coverage` → `{tail: sanitizeVerifierDiagnosticText(raw).text}` —
NEVER the raw failure capsule (verifier-diagnostics.mjs:26, reused verbatim, no parallel
redaction path); every other gate → `{}`. The `run.debug` failure leg consumes this SAME
projection (application.mjs:11321), scoped per worker/run/task (`_debugMember`,
application.mjs:11300-11313).

**GT2 — The source events carry the worker binding and the trust phase.** The trust-gate `error`
mints `{message, code, phase: 'trust_gate', trustPhase, …}` (coordinator.mjs:13284-13289) with
`trustPhase` from the evaluation order `capture`, `forbidden_effect`, `path_scope`,
`required_effect`, `evidence_mapping`, `terminal_batch`, `promotion`, `complete`
(coordinator.mjs:12956-13236, first-occurrence ACTUAL order). `worker_path_scope_violation`
carries `pathScopeEvidence` = `{changedPathCount, changedPathsDigest, inScopeChangedPathCount,
inScopeChangedPathsDigest, outOfScopeChangedPathCount, outOfScopeChangedPathsDigest}`
(coordinator.mjs:12979-12983) — the digest+count shape `debugGateDetail` projects. `verify.reverified`
carries a top-level `worker` field (coordinator.mjs:6459, kind minted at :6462) — the per-worker
projection filter is available on every source event.

**GT3 — #79 owns delivery; this contract owns structure.** The `gate_verdict` push item is keyed
`gate:${event.seq}` and derived from the worker-scoped projection `debugGateRefusal(events.filter(
e => e.worker === workerId))`, framed `wrapHubDerived` inside the `[attention/untrusted]` block
(worker-delivery-push-contract.md:294, 317-323, 158-159 — do not re-spec the seam). The
provider-facing brief is composed at `_providerBrief` (coordinator.mjs:3790); the
recovery-refinement brief is digest-pinned — `canonicalDigest(fields.brief) !==
canonicalDigest(priorTask.brief)` → `recovery_refinement_conflict`
(coordination-store.mjs:3037-3043) — so the verdict surface never rides a byte-identical
refinement brief (the TG4 v1.0.1 scope clarification).

**GT4 — The constraint block is composed from live markers plus static recipe boilerplate.** Both
provider-facing renderers emit the constraint block from `brief.constraints` — `renderBrief`
renders `## Constraints` (adapter.mjs:128-131), `renderPrompt` renders `Constraints:` and the
`Work only within:` line (cli-adapters.mjs:100-101). The goal's constraints are composed at
admission as `[...profile.constraints, profileConstraint(intent.profile, profile),
...(workflowConstraint ? [workflowConstraint] : []), ...(resultConstraint !== null &&
!profile.constraints.includes(resultConstraint) ? [resultConstraint] : [])]`
(application.mjs:4572-4575), where `profileConstraint(name, profile)` =
`Baton deployment profile ${name}@${profile.digest}` (application.mjs:2207-2209) and the
result-policy markers are closed literals (application.mjs:117-119, e.g. `Baton objective/result
policy explicit change_v1`). The deployment profile's own constraints array carries the
verification-command bound (application-deployment.mjs:891-893). SEPARATELY, the implement-contract
recipe ships a STATIC `IMPLEMENT_CONSTRAINTS` list (recipes.mjs:529-537) that includes the no-commit
line (`'Do NOT git commit — the orchestrator harvests your worktree.'`, recipes.mjs:532), the
wire_frame line (`'HARD CONSTRAINT (wire_frame_oversize, issue #28): never read a whole file over
~1500 lines; grep -an to locate, then read targeted ranges.'`, recipes.mjs:531), two coaching lines
(recipes.mjs:530, 533), and the scratchpad closed-shape line (recipes.mjs:536 — live-derivable from
the scratchpad entry law but shipped without naming its source) — none of the static lines carries a
named live derivation source when rendered.

**GT5 — The no-commit boilerplate is refuted by live truth.** The #141 workstyle law requires a
worker to commit its worktree at NATURAL SUBSYSTEM BOUNDARIES (impl-114-brief.md:45), and the
lived losses are on the record: a drained wave with zero commits lost the work — only the boundary
commits saved the code (redrive-continuity-contract.md:55, 90). The hub itself mints git objects
for the effective tree (`'Baton private effective-tree snapshot'`, application-deployment.mjs:222)
and pins results as snapshot commits. A constraint that tells the worker never to commit is false
exactly where the deployment expects boundary commits.

**GT6 — The wire_frame constraint is lane-conditional, not universal.** The `wire.frame` substrate
row is 1 MiB (limits.mjs:81) and the oversize refusal code is `wire_frame_oversize` (issue #28).
Whether a lane's tool surface is actually wire-frame-bounded is a LIVE read: the served scope of
an impl lane contains files far over ~1500 lines (`coordination-store.mjs` 17,249;
`application.mjs` 13,326; `coordinator.mjs` 14,379), while a lane whose scope has no such file
never needs the line. The constraint is true per lane, never universally.

---

## Decisions

### D1 — The worker-facing verdict surface (GLM P1-3): a four-field corrective structure, hub-projected once

The judged worker must see WHICH gate, WHAT it checked, and WHY it failed — in the sanitized
`{gate, detail}` shape (the verifier-diagnostics law), delivered through the #79 push lane (GT3).
What #61 owns beyond #79 is the verdict's STRUCTURE: the fields the worker needs to correct. The
surface is a single hub-projection — the SAME sanitizer and the SAME worker-scoped event set #79's
push and DG-1's `run.debug` failure leg use (GT1/GT3) — rendered as four fields:

- **`gate`** — WHICH gate, the closed `DEBUG_GATE_CODES` enum (application.mjs:945-948): `scope`,
  `red_green`, `coverage`, `route_mismatch`, `forbidden_effect`, `unknown`.
- **`check`** — WHAT was checked: the trust phase that refused — the source event's `trustPhase`
  (coordinator.mjs:13284) for error-kind refusals, or the verification phase for `verify.reverified`
  refusals (red_green / coverage from the verdict's diagnosticCode). Prose-free phase name, never
  path text.
- **`evidence`** — the failing evidence CLASS: `debugGateDetail` output — `scope` →
  `{digests, counts}` (NEVER path strings), `red_green`/`coverage` → `sanitizeVerifierDiagnosticText`
  output (NEVER the raw capsule), every other gate → `{}` (application.mjs:958-990;
  verifier-diagnostics.mjs:26).
- **`corrective`** — the corrective CLASS the worker can act on: a hub-minted mapping keyed by the
  terminal `code` (GT1's durable discriminator), a closed prose-free enum; a code absent from the
  table carries `corrective: null` (honest absence — escalate to the orchestrator), never a
  fabricated corrective.

**Derivation is one projection, three consumers.** The surface derives from the same per-worker
projection `debugGateRefusal(events.filter(e => e.worker === workerId))` the #79 push uses
(GT3), keyed `gate:${event.seq}` and superseded by the latest evidence (`.at(-1)`,
application.mjs:999) — matching the #79 supersession semantics (do not re-spec). It is a pure
function of the durable event log: two replays over the same log derive the same surface; a worker
receives ITS OWN surface, never another worker's. The `corrective` field rides BOTH consumers
(`run.debug` failure leg and the #79 push) — the surface is not a third projection, it is the
shared projection's structure.

**The corrective-class table (hub-minted, keyed by terminal code):**

| terminal `code` (live) | `gate` | `check` | `evidence` class | `corrective` |
|---|---|---|---|---|
| `worker_path_scope_violation` | `scope` | `path_scope` | `{digests, counts}` | `in_scope_revision` |
| `forbidden_effect_observed` | `forbidden_effect` | `forbidden_effect` | `{}` | `forbidden_effect_retraction` |
| `verification_red_green_failed` | `red_green` | red_green verification | sanitized `tail` | `failing_check_fix` |
| `verification_coverage_failed` | `coverage` | coverage verification | sanitized `tail` | `coverage_completion` |
| `plan_route_mismatch` / `recovery_route_mismatch` | `route_mismatch` | `route_mismatch` | `{}` | `exact_harness_dispatch` |
| `required_effect_absent` | `unknown` (per today's mapping) | `required_effect` | `{}` | `in_scope_edit` |
| any other code | `unknown` | — | `{}` | `null` (escalate) |

The corrective is keyed by the terminal CODE, never the coarse `gate`: `required_effect_absent`
degrades to gate `unknown` under today's mapping (application.mjs:949-956) but keeps its durable
code (application.mjs:1010) and therefore its corrective — a worker whose only failure is a missing
in-scope edit is not told to "escalate". A code absent from the table carries `corrective: null`:
the honest absence is itself the observability signal.

### D2 — Objectives generated from live truth (Opus P0-2): a per-line derivation rule + the honesty rule

The HARD CONSTRAINT block — the `## Constraints` section at the render seam (adapter.mjs:128-131,
cli-adapters.mjs:100) — is generated from the deployment's ACTUAL laws at compose time. The static
recipe boilerplate (GT4) has gone false: the no-commit line is refuted where #141's boundary-commit
norm applies (GT5); the wire_frame line is emitted on lanes that do not carry it (GT6). Two rules
replace it:

**Rule 1 — the generation rule: every constraint line derives from a live policy read; the source
is named per line.** A served constraint line must be re-derivable from the deployment's durable
state by a named source:

| served line (or its live analogue) | named live source |
|---|---|
| `Baton deployment profile <name>@<digest>` | the profile digest — `profileConstraint(name, profile)`, application.mjs:2207-2209; composed at application.mjs:4572 |
| `Baton objective/result policy <intent>_v1` | the effective result intent — `EXPLICIT_RESULT_CONSTRAINTS`, application.mjs:117-119 |
| `Baton workflow <strategy>:<workspace>:<join>` | the composition — application.mjs:4572 (when the run is composed) |
| `Do not claim completion without the deployment verification command.` | the deployment profile's constraints — application-deployment.mjs:891-893 |
| `Work only within: <paths>` | the goal's pathScope — cli-adapters.mjs:101; adapter.mjs:132-135 |
| the wire_frame HARD CONSTRAINT (issue #28) | IFF the lane-liveness read confirms the served scope carries a file over ~1500 lines — the `wire.frame` row (limits.mjs:81) plus the scope census; never on a lane that doesn't carry it |
| the boundary-commit line (#141) | IFF the deployment's worktree-harvest policy expects boundary commits — the #141 workstyle law (impl-114-brief.md:45) |

**Rule 2 — the honesty rule: a constraint that cannot be derived from live policy is not printed.**
Boilerplate a worker learns to discount is worse than none. Specifically:

- `Do NOT git commit — the orchestrator harvests your worktree.` (recipes.mjs:532) is NOT printed
  where the #141 boundary-commit norm applies — the worker's own boundary commits and the hub's
  snapshot commits (application-deployment.mjs:222) are the receipts that contradict it. It is
  replaced by the live-derived boundary-commit line, or absent — never shipped false.
- Coaching lines with no named live source (e.g. `Work red-first: …`, `Match existing code
  style; minimal diffs; …`, recipes.mjs:530, 533) are NOT HARD CONSTRAINTS: they ride the
  objective prose as coaching, never the constraint block, unless a deployment policy names them.
- A constraint naming a bound the deployment does not enforce (a bound with no live row in the
  deployment profile or the `FRAME_LIMITS` registry, limits.mjs) is never printed.

The served block is honest by construction — every line is re-derivable from the deployment's
durable state, and the suppression of a line a worker might expect (e.g. the no-commit line on a
boundary-commit deployment) is itself observable (the Observability section) rather than silent.

---

## Refusal vocabulary

Codes follow the registry's snake_case family (`recovery_refinement_conflict`,
`application_workflow_feedback_gate_unbound`). New codes introduced by this contract:

- **`verdict_surface_corrective_forced`** (D1) — a surface record would carry a corrective class
  not in the closed hub-minted table, or a corrective attached to an unmappable terminal code.
  The surface degrades PER-RECORD: the malformed record is excluded from the projection and the
  push/run.debug carry the un-forced `{gate, code, check, evidence}` — never a map-wide throw
  (the #73 B5 degradation precedent, cross-ref).
- **`objective_constraint_underrived`** (D2) — the composition is asked to ship a constraint line
  with no named live derivation source; the line refuses and is NOT printed (the honesty rule's
  loud form when a caller explicitly requests the line).
- **`objective_constraint_unenforced`** (D2) — a constraint line names a bound the deployment does
  not enforce (no live row in the deployment profile or `FRAME_LIMITS`); it refuses — never print
  a bound the deployment doesn't enforce.

Cross-referenced (not re-specified): a caller-authored gate-shaped verdict through `run.feedback`
refuses `application_workflow_feedback_gate_unbound` (#73 — the surface never admits
caller-authored content); `recovery_refinement_conflict` (coordination-store.mjs:3037-3043) pins
that the surface never rides the refinement brief.

## Observability

- **The surface is the shared projection (D1).** `{gate, check, evidence, corrective}` is
  observable on BOTH consumers — the `run.debug` failure leg (application.mjs:11321) and the #79
  `gate_verdict` push — from the SAME worker-scoped projection; a reader never sees a field one
  consumer has and the other lacks. The `corrective: null` for an unmappable code is the honest
  "escalate" signal, never a missing field.
- **The block is generated, not hand-carried (D2).** The composition function is observable:
  it returns the served block AND a suppression record — each suppressed line and its suppression
  reason (e.g. `no-commit refuted by the #141 boundary-commit norm`), exposed through a
  diagnostics projection while the worker's block carries only the served lines. Two composes over
  the same deployment state derive the same block and the same suppression record — a pure
  function, no clock, no random.

---

## Red-first acceptance

Each pin is RED at this HEAD — the behavior is absent from this tree — and the implementation
makes it GREEN. The red suite is `impl/test/issue61-verdict-surface-red.test.mjs`, mirroring the
`issue62-write-failure-red.test.mjs` harness shape (deterministic; MockAdapter fixtures; no live
providers; fixed clocks).

### The verdict surface (D1)

- **R1 — the four-field surface.** A worker whose latest gate event is a scope refusal receives
  (via the #79 push, cross-ref) `{gate: 'scope', check: 'path_scope', evidence: {digests, counts},
  corrective: 'in_scope_revision'}` — WHICH gate, WHAT was checked, the sanitized evidence class,
  the corrective class. RED: no worker-facing verdict surface exists; the judged worker sees at
  most a bare code (TG4).
- **R2 — evidence sanitization holds.** The `scope` evidence carries digests+counts and NEVER a
  path string; `red_green`/`coverage` evidence is `sanitizeVerifierDiagnosticText` output, never
  the raw failure capsule (application.mjs:958-990; verifier-diagnostics.mjs:26). RED: no surface
  to sanitize.
- **R3 — the corrective is hub-minted per terminal code.** `required_effect_absent` carries
  `corrective: 'in_scope_edit'` (its gate degrades to `unknown`, its code does not); a code absent
  from the table carries `corrective: null`. A forced corrective on an unmappable code refuses
  `verdict_surface_corrective_forced` and degrades per-record. RED: no corrective field exists.
- **R4 — one projection, three consumers.** The surface's `{gate, check, evidence, corrective}` is
  derived by the SAME worker-scoped projection `debugGateRefusal(events.filter(e => e.worker ===
  workerId))` that `run.debug` (application.mjs:11321) and the #79 push (cross-ref) use; two
  replays over the same log derive the same surface; cross-worker isolation holds — a worker
  receives ITS OWN surface, never another worker's. RED: the verdict lives only on `run.debug`'s
  run-wide view.
- **R5 — the surface never rides the refinement brief.** The recovery-refinement digest pin
  (coordination-store.mjs:3037-3043) stays byte-stable when the surface is present. RED: no surface
  to violate the pin.

### Objectives from live truth (D2)

- **R6 — the no-commit line never ships on a boundary-commit deployment.** A deployment whose
  worktree-harvest policy expects boundary commits (#141) serves the boundary-commit line or
  nothing — never `Do NOT git commit` (recipes.mjs:532). RED: the recipe ships the no-commit line
  unconditionally today.
- **R7 — every served constraint line has a named live derivation source; a line without one is
  not printed.** The composition refuses `objective_constraint_underrived` when asked to ship an
  underrived line, and the served block is re-derivable from the deployment's durable state.
  RED: recipes.mjs:530-536 ships five static lines, none with a named live source.
- **R8 — the wire_frame line is lane-conditional.** The wire_frame HARD CONSTRAINT (issue #28) is
  emitted IFF the lane-liveness read confirms the served scope carries a file over ~1500 lines; a
  lane whose scope has none never carries it. RED: recipes.mjs:531 ships it unconditionally.
- **R9 — the composed block is a pure function of live policy.** Two composes over the same
  deployment state derive the same served block AND the same suppression record (digest-stable; no
  clock, no random). RED: no live composition function exists — the recipe constraints are static.

---

## Open questions

- **OQ1 — where the corrective table lives.** Pin: a closed hub-minted table beside
  `DEBUG_GATE_CODES` (application.mjs:945-948), with an acceptance source-scan that every terminal
  code reachable on the surface has a corrective or `null`. The alternative — a deployment-policy
  table — is rejected for the same reason the gate mapping is hub-owned: a corrective a caller can
  rewrite is a forged corrective (#73's class).
- **OQ2 — the required_effect_absent corrective.** The gate degrades to `unknown` under today's
  mapping, but the code is durable. Pin (above): the corrective is keyed by the terminal CODE, so
  the corrective survives the gate degradation. Revisit only if `debugGateFromLiveCode` grows a
  `required_effect` gate — the table then follows, it does not lead.
- **OQ3 — the boundary-commit line's served text.** Present as an explicit live-derived line
  ("commit at natural subsystem boundaries (#141)") when the deployment's worktree-harvest policy
  expects boundary commits, absent otherwise. The suppression record (the Observability section)
  names the reason either way, so the absence is observable, not silent.
