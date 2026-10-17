# Issue #61 — the worker-visible gate verdict + objectives generated from live truth (v1.1 FOLDED)

- **Issue:** #61 — two AX clarity items from the trust-gate steering epic: the worker-facing
  verdict surface (GLM P1-3) and the objective constraint block generated from live truth
  (Opus P0-2). The judged worker never learns why it failed; the HARD CONSTRAINT block ships
  boilerplate that live truth has refuted.
- **Date:** 2026-08-13
- **Status:** v1.1 — folded contract. Folds the r2-2026-08-13 red-team verdict
  (`contract-redteam.md`, **NOT FOLD-READY**: six numbered blockers + four minors, citations
  PASS) into v1.0. Every blocker and minor is folded below with its fix; the red-team's keep
  list is unchanged. All acceptance pins R1–R9 remain RED at this HEAD (the behavior is absent
  from this tree).
- **Verification HEAD:** `a4663195dabaf6458d1cbaf721cfc2d26c118b5c` ("Baton private effective-tree
  snapshot") — the tree under test. The red-team verified at its own HEAD (`25139b9f…`); every
  citation below was re-grepped at THIS HEAD, so a few anchors differ from the red-team's line
  numbers (e.g. the trust-gate error mint is at coordinator.mjs:13510-13517 here, not :13284).

**NUL discipline.** `impl/src/application.mjs` and `impl/src/coordination-store.mjs` are the two
NUL-bearing files (3 NUL bytes each — verified at this HEAD); their anchors are
`grep -an`/`sed -n`-verified only, never whole-file reads. `adapter.mjs`, `recipes.mjs`,
`cli-adapters.mjs`, `application-deployment.mjs`, `coordinator.mjs`, `limits.mjs`,
`verifier-diagnostics.mjs`, and `messages.mjs` are clean and were read directly. Sorted-key
literals are quoted in their ACTUAL source order (none are sorted claims); no `localeCompare`
ordering is used anywhere in this contract. No clocks: every rule and pin is a pure function of
durable state — no wall-time windows, no retry counts, no numeric caps beyond the declared
`FRAME_LIMITS` rows.

**Cross-references (not re-specified here):** #64 (`trust-gate-steering-decisions.md` — TG4, the
verdict shape and the "worker never learns why" gap this epic closes), DG-1
(`issue53-decisions.md` v2 — the `run.debug` failure leg whose sanitized `{gate, detail}` this
surface reuses verbatim), #79 (`worker-delivery-push-contract.md` — the delivery half: the
sanitized `gate_verdict` push, the consumer of this surface), #73
(`feedback-forge-hardening-contract.md` — verdicts are hub-minted, never caller-authored), #141
(the boundary-commit workstyle law — the live truth that refutes the no-commit boilerplate).
Each is cited at the decision it touches.

Scope in one sentence: **the worker-facing verdict surface is a four-field corrective structure
(`gate`, `check`, `detail`, `corrective`) that #61 owns beyond #79's delivery mechanics, and the
implement-contract objective's constraint block is generated at admission from the deployment's
live policy reads — each line derived from a named source, a line that cannot be derived never
printed, and the served block frozen for the run.**

---

## Fold map — v1.0 → v1.1

| Red-team finding (r2-2026-08-13) | Resolution in the fold | Where in v1.1 |
|---|---|---|
| B1 — D2 anchors the wrong seam: the static boilerplate ships through the recipe objective render, not the `## Constraints` adapter seam | Rule 1/2 re-anchored to `renderObjective`/`renderMember`; `IMPLEMENT_CONSTRAINTS` retired to its single named-source line (the scratchpad closed-shape line); coaching scope boundary pinned | §GT4, §D2 (Rule 1, Rule 2, retirement), §R7 |
| B2 — `evidence` collides with the landed #79 field `detail` | Shared field adopted as `detail` (#79's landed name — renaming #79 is out of this fold's reach); the four-field surface is `{gate, check, detail, corrective}`; R1 asserts the exact key | §D1 (field list, reconciliation), §R1, §Observability |
| B3 — `check` is not closed and leaks gate-internal phase names | `check` domain closed: error-kind refusals whitelist `{path_scope, forbidden_effect, required_effect}`, everything else escalates `check: null`; verifier refusals carry the closed `diagnosticCode` itself; table gains the eight reachable null rows | §D1 (`check`, table), §R2 |
| B4 — the `route_mismatch` table row is unreachable; `exact_harness_dispatch` can never ship | Row + corrective claim removed; D1 covers post-identity gate/verifier refusals only; pre-identity dispatch refusals (`goal_plan_required`/`plan_route_mismatch`) explicitly out of scope | §D1 (`gate`, table, reachability), §OQ1 |
| B5 — the boundary-commit live source does not exist as durable state | `worktreeHarvestPolicy` added to the `applicationProfile` schema with default `'orchestrator-harvest'`; R6's predicate reads the field | §GT5, §D2 (Rule 1 table, B5 note), §R6, §OQ3 |
| B6 — the live-truth epoch is unpinned | Admission-time derivation + freeze-for-the-run pinned; the suppression record carries the derivation epoch | §D2 (B6 note), §Observability, §R9 |
| Minor — `required_effect_absent` evidence pinned `{}` though sanitizable digest/count evidence exists | `detail` projects the digest/count subset of `requiredEffectEvidence`; the table row's detail class updated | §D1 (`detail`, table), §R2 |
| Minor — the `[attempt:]` salt line has no Rule 1/2 carve-out | Carve-out: the `[attempt: <salt> <role>]` line is the per-attempt discriminator, re-derived from the attempt salt, not a constraint line | §D2 (Rule 1 table) |
| Minor — the wire_frame census source is unnamed | Census named: the lane's served scope (`brief.pathScope`) resolved against the effective tree at the admission SHA, read as a `wc -l` size census | §GT6, §D2 (Rule 1 table), §R8 |
| Minor — GT1's `_debugMember` citation range is loose | Tightened: definition `application.mjs:11304-11337`; `gateRefusal = debugGateRefusal(events)` at `:11325`; `failure = gateRefusal ?? …` at `:11327` | §GT1 |

---

## Ground truths (code-verified)

**GT1 — The gate verdict is already a sanitized `{gate, detail}` projection.** `debugGateRefusal(events)`
(application.mjs:993-1015) projects the LATEST trust-gate/verifier refusal — `error` with
`payload['phase'] === 'trust_gate'`, or `verify.reverified` with `accept === false` — into
`{kind, code, message, gate, detail}`. `gate` maps the live code via `debugGateFromLiveCode`
(application.mjs:949-956) against `DEBUG_GATE_CODES` (application.mjs:945-948, ACTUAL order:
`scope`, `red_green`, `coverage`, `route_mismatch`, `forbidden_effect`, `unknown`); `message` is
`boundedAttentionText(event.payload.message)` (application.mjs:1006-1007); `code` is
`debugTerminalCode(liveCode, 'trust_gate_failed')` (application.mjs:1010) — the durable
discriminator. `debugGateDetail` (application.mjs:958-990) is: `scope` → `{digests, counts}` —
NEVER path strings; `red_green`/`coverage` → `{tail: sanitizeVerifierDiagnosticText(raw).text}` —
NEVER the raw failure capsule (verifier-diagnostics.mjs:26, reused verbatim, no parallel
redaction path); every other gate → `{}`. The `run.debug` failure leg consumes this SAME
projection: `_debugMember` (application.mjs:11304-11337, scoped per worker/run/task) computes
`gateRefusal = debugGateRefusal(events)` at :11325 and `const failure = gateRefusal ?? …` at
:11327. *(Fold, Minor 4 — citation tightened: v1.0's loose 11300-11313 range is corrected to the
definition span 11304-11337 with the gateRefusal call at :11325, outside the definition head.)*

**GT2 — The source events carry the worker binding and the trust phase.** The trust-gate `error`
mints `{message, code, phase: 'trust_gate', trustPhase, …}` (coordinator.mjs:13510-13517) with
`trustPhase` from the evaluation order `capture`, `forbidden_effect`, `path_scope`,
`required_effect`, `evidence_mapping`, `terminal_batch`, `promotion`, `complete`
(coordinator.mjs:13185-13465, first-occurrence ACTUAL order). `worker_path_scope_violation`
carries `pathScopeEvidence` = `{changedPathCount, changedPathsDigest, inScopeChangedPathCount,
inScopeChangedPathsDigest, outOfScopeChangedPathCount, outOfScopeChangedPathsDigest}`
(coordinator.mjs:13208-13215) — the digest+count shape `debugGateDetail` projects.
`required_effect_absent` carries `requiredEffectEvidence` =
`{requiredEffect, baseSha, sha, changedPathCount, changedPathsDigest, inScopeChangedPathCount,
inScopeChangedPathsDigest}` (coordinator.mjs:13229-13235) — a digest+count object, never paths.
`verify.reverified` carries a top-level `worker` field (coordinator.mjs:6483, kind minted at
:6486; :13324) — the per-worker projection filter is available on every source event.

**GT3 — #79 owns delivery; this contract owns structure.** The `gate_verdict` push item is keyed
`gate:${event.seq}` and derived from the worker-scoped projection `debugGateRefusal(events.filter(
e => e.worker === workerId))`, framed `wrapHubDerived` inside the `[attention/untrusted]` block
(worker-delivery-push-contract.md:294, 317-323, 158-159 — do not re-spec the seam). The
provider-facing brief is composed at `_providerBrief` (coordinator.mjs:3810); the
recovery-refinement brief is digest-pinned — `canonicalDigest(fields.brief) !==
canonicalDigest(priorTask.brief)` → `recovery_refinement_conflict`
(coordination-store.mjs:3030-3045) — so the verdict surface never rides a byte-identical
refinement brief (the TG4 v1.0.1 scope clarification).

**GT4 — The implement-contract objective is rendered from a static constraint list; the static
lines ship through the OBJECTIVE render, not the adapter seam.** Both provider-facing renderers
emit the constraint block from `brief.constraints` — `renderBrief` renders `## Constraints`
(adapter.mjs:128-131), `renderPrompt` renders `Constraints:` and the `Work only within:` line
(cli-adapters.mjs:100-101). The goal's constraints are composed at admission as
`[...profile.constraints, constraint, ...(workflowConstraint ? [workflowConstraint] : []),
...(resultConstraint !== null && !profile.constraints.includes(resultConstraint)
? [resultConstraint] : [])]` (application.mjs:4572-4575), where `profileConstraint(name, profile)` =
`Baton deployment profile ${name}@${profile.digest}` (application.mjs:2207-2209) and the
result-policy markers are closed literals (`Baton objective/result policy <intent>_v1`,
application.mjs:112, 117-119). The deployment profile's own constraints array carries the
verification-command bound (application-deployment.mjs:903-905). SEPARATELY, the implement-contract
recipe ships a STATIC `IMPLEMENT_CONSTRAINTS` list (recipes.mjs:529-537) that is rendered into the
recipe objective by `renderObjective` = `[task, ...constraints, "[attempt: ${salt} ${role}]"].join(
'\n')` (recipes.mjs:296-309) via `renderMember` (recipes.mjs:327). The list includes the no-commit
line (`'Do NOT git commit — the orchestrator harvests your worktree.'`, recipes.mjs:532), the
wire_frame line (`'HARD CONSTRAINT (wire_frame_oversize, issue #28): never read a whole file over
~1500 lines; grep -an to locate, then read targeted ranges.'`, recipes.mjs:531), two coaching lines
(recipes.mjs:530, 533), and the scratchpad closed-shape line (recipes.mjs:536) — none carries a
named live derivation source when rendered. **This objective render is the seam that ships the
false static boilerplate — not the `## Constraints` adapter seam, which is already live-composed.**
*(Fold B1: D2 is re-anchored to this seam, §D2.)*

**GT5 — The no-commit boilerplate is refuted by live truth where the deployment expects boundary
commits.** The #141 workstyle law requires a worker to commit its worktree at NATURAL SUBSYSTEM
BOUNDARIES (impl-114-brief.md:45), and the lived losses are on the record: a drained wave with
zero commits lost the work — only the boundary commits saved the code
(redrive-continuity-contract.md:55, 90). The hub itself mints git objects for the effective tree
(`'Baton private effective-tree snapshot'`, application-deployment.mjs:234) and pins results as
snapshot commits. A constraint that tells the worker never to commit is false exactly where the
deployment expects boundary commits. *(Fold B5: whether a deployment expects boundary commits is
now a named profile field — `worktreeHarvestPolicy`, §D2 — added to the `applicationProfile`
schema, application-deployment.mjs:895-905. The field is absent from the tree at this HEAD — grep
for `worktreeHarvest`/`harvestPolicy`/`boundaryCommit` finds nothing under `impl/` — so R6 stays
RED.)*

**GT6 — The wire_frame constraint is lane-conditional, not universal.** The `wire.frame` substrate
row is 1 MiB (limits.mjs:81) and the oversize refusal code is `wire_frame_oversize` (issue #28).
Whether a lane's tool surface is actually wire-frame-bounded is a LIVE read: the served scope of
an impl lane contains files far over ~1500 lines (`coordination-store.mjs` 17,249; `application.mjs`
13,330; `coordinator.mjs` 14,611 — `wc -l` at this HEAD), while a lane whose scope has no such file
never needs the line. The constraint is true per lane, never universally. *(Fold, Minor 3 — the
census source is named: the lane's served scope — the goal's `pathScope`, rendered at
cli-adapters.mjs:100-101 and adapter.mjs:128-131 — resolved against the effective tree at the
admission SHA; the read is a `wc -l` size census over that scope's files, §D2 Rule 1.)*

---

## Decisions

### D1 — The worker-facing verdict surface (GLM P1-3): a four-field corrective structure, hub-projected once

The judged worker must see WHICH gate, WHAT it checked, and WHY it failed — in the sanitized
`{gate, detail}` shape (the verifier-diagnostics law), delivered through the #79 push lane (GT3).
What #61 owns beyond #79 is the verdict's STRUCTURE: the fields the worker needs to correct. The
surface is a single hub-projection — the SAME sanitizer and the SAME worker-scoped event set #79's
push and DG-1's `run.debug` failure leg use (GT1/GT3) — rendered as four fields:

- **`gate`** — WHICH gate, the closed `DEBUG_GATE_CODES` enum (application.mjs:945-948): `scope`,
  `red_green`, `coverage`, `route_mismatch`, `forbidden_effect`, `unknown`. *(Fold B4: the
  `route_mismatch` member never reaches the verdict surface — `plan_route_mismatch` throws
  pre-identity at coordinator.mjs:4335 (before `_allocWorkerId` :4336) and `recovery_route_mismatch`
  is a result string (coordinator.mjs:5505-5506, :5866), neither an event `debugGateRefusal`'s
  candidate filter accepts (application.mjs:994-998). The member stays in the closed enum — the
  live code path still maps it (application.mjs:954) — but the surface covers post-identity
  gate/verifier refusals only, and no corrective is advertised for it.)*
- **`check`** — WHAT was checked, and a CLOSED domain *(fold B3)*. For `error`-kind refusals: the
  trust phase IFF it has a corrective row — the whitelist `{path_scope, forbidden_effect,
  required_effect}`. Any other trustPhase — `capture`, `evidence_mapping`, `terminal_batch`,
  `promotion`, `complete` (coordinator.mjs:13185, 13382, 13436, 13457, 13465) — escalates with
  `check: null`; a raw gate-internal phase name never crosses to the worker. For `verify.reverified`
  refusals: `check` = the verdict's `diagnosticCode` itself — a closed enum,
  `CLOSED_VERIFIER_DIAGNOSTICS` (coordinator.mjs:428-433), never a two-row label. Prose-free phase
  name, never path text.
- **`detail`** — the failing evidence CLASS *(fold B2: the field is named `detail`, not `evidence` —
  reconciliation below)*: `debugGateDetail` output (application.mjs:958-990; verifier-diagnostics.mjs:26)
  — `scope` → `{digests, counts}` (NEVER path strings), `red_green`/`coverage` →
  `sanitizeVerifierDiagnosticText` output (NEVER the raw capsule), `required_effect` → the
  digest/count subset of `requiredEffectEvidence` *(fold, Minor 1)*, every other gate → `{}`.
- **`corrective`** — the corrective CLASS the worker can act on: a hub-minted mapping keyed by the
  terminal `code` (GT1's durable discriminator), a closed prose-free enum; a code absent from the
  table carries `corrective: null` (honest absence — escalate to the orchestrator), never a
  fabricated corrective.

**Field-name reconciliation (fold B2).** #79 D6 pins the pushed item shape
`{kind, code, message, gate, detail}` (worker-delivery-push-contract.md:315-317) and #79 R2 asserts
"scope `detail` carries digests+counts" (:389). v1.0 named the same projection output `evidence`;
the fold adopts `detail` — the landed #79 name — for BOTH consumers (the #79 push and the
`run.debug` failure leg). Renaming #79's field is out of this fold's reach, so the surface
converges on #79's name: a worker implementing against #79's shape and one implementing against R1
read the same key. R1 asserts the exact key `detail` (see R1).

**Derivation is one projection, three consumers.** The surface derives from the same per-worker
projection `debugGateRefusal(events.filter(e => e.worker === workerId))` the #79 push uses
(GT3), keyed `gate:${event.seq}` and superseded by the latest evidence (`.at(-1)`,
application.mjs:999) — matching the #79 supersession semantics (do not re-spec). It is a pure
function of the durable event log: two replays over the same log derive the same surface; a worker
receives ITS OWN surface, never another worker's. The `corrective` field rides BOTH consumers
(`run.debug` failure leg and the #79 push) — the surface is not a third projection, it is the
shared projection's structure.

**The corrective-class table (hub-minted, keyed by terminal code):**

| terminal `code` (live) | `gate` | `check` | `detail` class | `corrective` |
|---|---|---|---|---|
| `worker_path_scope_violation` | `scope` | `path_scope` | `{digests, counts}` | `in_scope_revision` |
| `forbidden_effect_observed` | `forbidden_effect` | `forbidden_effect` | `{}` | `forbidden_effect_retraction` |
| `required_effect_absent` | `unknown` (per today's mapping, application.mjs:949-956) | `required_effect` | digest/count subset: `{changedPathCount, changedPathsDigest, inScopeChangedPathCount, inScopeChangedPathsDigest}` | `in_scope_edit` |
| `verification_red_green_failed` | `red_green` | `verification_red_green_failed` (the diagnosticCode) | sanitized `tail` | `failing_check_fix` |
| `verification_coverage_failed` | `coverage` | `verification_coverage_failed` (the diagnosticCode) | sanitized `tail` | `coverage_completion` |
| the eight reachable null diagnostics (below) | `unknown` | the code itself | `{}` | `null` (escalate) |
| any other `error`-kind code (trustPhase outside the whitelist) | `unknown` | `null` | `{}` | `null` (escalate) |

**Reachable verifier diagnostics with no corrective (fold B3).** The closed verifier enum is
`CLOSED_VERIFIER_DIAGNOSTICS` (coordinator.mjs:428-433, ACTUAL order). `verification_passed` never
appears on an accept:false refusal, so the reachable refusal diagnostics are the ten below — two
carry a corrective, eight carry `corrective: null`, each `{gate: 'unknown', check: <the code>,
detail: {}, corrective: null}`:

> `verification_output_exceeded`, `verification_timed_out`, `verification_spawn_unavailable`,
> `verification_claim_diverged`, `verification_mutation_failed`, `verification_coverage_unavailable`,
> `verification_mutation_unavailable`, `verification_exit_mismatch`

The corrective is keyed by the terminal CODE, never the coarse `gate`: `required_effect_absent`
degrades to gate `unknown` under today's mapping (application.mjs:949-956) but keeps its durable
code (application.mjs:1010) and therefore its corrective — a worker whose only failure is a missing
in-scope edit is not told to "escalate". A code absent from the table carries `corrective: null`:
the honest absence is itself the observability signal.

*(Fold B4 — reachability. `plan_route_mismatch`/`recovery_route_mismatch` are NOT in the table and
`exact_harness_dispatch` is retired: neither code can be projected by `debugGateRefusal`, so the
surface makes no claim for them. D1 covers post-identity gate/verifier refusals only. Pre-identity
dispatch refusals — `goal_plan_required` (coordinator.mjs:4333), `plan_route_mismatch` (:4335) —
reject the request before any worker exists: no gate event, no verdict, no corrective. A
request-keyed dispatch-refusal projection is a future seam, explicitly out of this fold's scope.)*

### D2 — Objectives generated from live truth (Opus P0-2): a per-line derivation rule + the honesty rule

The implement-contract objective's constraint block — the lines `renderObjective`/`renderMember`
render from the constraint list into the objective text (recipes.mjs:296-309, :327) — is generated
from the deployment's ACTUAL laws at admission time. *(Fold B1: v1.0 anchored to the `## Constraints`
render seam (adapter.mjs:128-131, cli-adapters.mjs:100), which renders `brief.constraints` —
ALREADY live-composed at admission (GT4, application.mjs:4572-4575). The false static lines ship
through the recipe objective render, NOT that seam. Rule 1 and Rule 2 below govern the recipe
objective render; the adapter seam stays live-composed and is untouched.)* Two rules replace the
static boilerplate:

**Rule 1 — the generation rule: every constraint line derives from a live policy read; the source
is named per line.** A served constraint line in the implement-contract objective must be
re-derivable from the deployment's durable state by a named source:

| served line (or its live analogue) | named live source |
|---|---|
| `Baton deployment profile <name>@<digest>` | the profile digest — `profileConstraint(name, profile)`, application.mjs:2207-2209; composed at application.mjs:4572 |
| `Baton objective/result policy <intent>_v1` | the effective result intent — `EXPLICIT_RESULT_CONSTRAINTS`, application.mjs:117-119 |
| `Baton workflow <strategy>:<workspace>:<join>` | the composition — application.mjs:4572 (when the run is composed) |
| `Do not claim completion without the deployment verification command.` | the deployment profile's constraints — application-deployment.mjs:903-905 |
| `Work only within: <paths>` | the goal's pathScope — cli-adapters.mjs:100-101; adapter.mjs:128-131 |
| the wire_frame HARD CONSTRAINT (issue #28) | IFF the size census over the lane's served scope at the admission SHA shows a file over ~1500 lines — the `wire.frame` row (limits.mjs:81) plus the census (the goal's `pathScope` resolved against the effective tree at the admission SHA, read as `wc -l`) *(fold, Minor 3)*; never on a lane that doesn't carry it |
| the boundary-commit line (#141) | IFF `worktreeHarvestPolicy === 'boundary-commits'` — the deployment-profile field *(fold B5)*; the #141 workstyle law (impl-114-brief.md:45) |
| the scratchpad closed-shape line | the scratchpad entry law (issue #62) — the sole retained `IMPLEMENT_CONSTRAINTS` member *(fold B1)* |
| `[attempt: <salt> <role>]` | the per-attempt discriminator, re-derived from the attempt salt (recipes.mjs:512) — NOT a constraint line under Rule 1/2 *(fold, Minor 2)* |

**Rule 2 — the honesty rule: a constraint that cannot be derived from live policy is not printed.**
Boilerplate a worker learns to discount is worse than none. Specifically:

- `Do NOT git commit — the orchestrator harvests your worktree.` (recipes.mjs:532) is NOT printed
  where `worktreeHarvestPolicy === 'boundary-commits'` — the worker's own boundary commits and the
  hub's snapshot commits (application-deployment.mjs:234) are the receipts that contradict it. It
  is replaced by the live-derived boundary-commit line, or absent — never shipped false. On a
  deployment whose `worktreeHarvestPolicy` is `'orchestrator-harvest'`, the line is TRUE (the
  orchestrator harvests the worktree) and ships under its named source (the profile's harvest
  policy).
- Coaching lines with no named live source (`Work red-first: …`, `Match existing code style;
  minimal diffs; …`, recipes.mjs:530, 533) are NOT HARD CONSTRAINTS. **Scope boundary (fold B1):**
  the served objective text has two zones — the constraint block (lines naming deployment bounds or
  laws, governed by Rule 1/2) and coaching prose (advisory style guidance, explicitly OUT of
  Rule 1/2's scope). Coaching rides the objective prose as prose, never the constraint block,
  unless a deployment policy names it.
- A constraint naming a bound the deployment does not enforce (a bound with no live row in the
  deployment profile or the `FRAME_LIMITS` registry, limits.mjs) is never printed.

*(Fold B1 — `IMPLEMENT_CONSTRAINTS` retirement. The static list (recipes.mjs:529-537) is retired as
the objective's constraint source. It is reduced to the single line that carries a live-derivation
source — the scratchpad closed-shape line (recipes.mjs:536), which derives from the scratchpad
entry law (issue #62). The no-commit line (:532), the wire_frame line (:531), and the two coaching
lines (:530, :533) are no longer static constraint lines: each is derived live, reclassified as
coaching prose, or absent.)*

*(Fold B5 — `worktreeHarvestPolicy`. Added to the `applicationProfile` schema
(application-deployment.mjs:895-905) as a closed field `worktreeHarvestPolicy:
'orchestrator-harvest' | 'boundary-commits'`, default `'orchestrator-harvest'` — the deployment
does not expect worker boundary commits and the orchestrator harvests the worktree, so the
no-commit line is TRUE and may ship. A deployment opting into the #141 workstyle sets
`'boundary-commits'`: the boundary-commit line ships (or nothing) and the no-commit line is
suppressed. R6's predicate reads this field. The field is RED at this HEAD — grep for
`worktreeHarvest`/`harvestPolicy`/`boundaryCommit` finds nothing under `impl/`.)*

*(Fold B6 — the epoch. The block is derived at admission and FROZEN for the run — a pure function
of the admission-time deployment state (the profile digest and the effective-tree SHA at
admission). Mid-run policy changes do not retro-edit a served block. The recovery-refinement digest
pin (coordination-store.mjs:3030-3045) already forbids mutating `task.brief` on refinement, so a
refined worker cannot re-derive; the freeze is now explicit. The suppression record carries the
derivation epoch — §Observability.)*

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
  push/run.debug carry the un-forced `{gate, code, check, detail}` — never a map-wide throw
  (the #73 B5 degradation precedent, cross-ref).
- **`objective_constraint_underrived`** (D2) — the composition is asked to ship a constraint line
  with no named live derivation source; the line refuses and is NOT printed (the honesty rule's
  loud form when a caller explicitly requests the line). *(Fold B5: a caller requesting the
  boundary-commit line now names `worktreeHarvestPolicy` — the refusal fires only for a line with
  genuinely no named derivation source.)*
- **`objective_constraint_unenforced`** (D2) — a constraint line names a bound the deployment does
  not enforce (no live row in the deployment profile or `FRAME_LIMITS`); it refuses — never print
  a bound the deployment doesn't enforce.

Cross-referenced (not re-specified): a caller-authored gate-shaped verdict through `run.feedback`
refuses `application_workflow_feedback_gate_unbound` (#73 — the surface never admits
caller-authored content); `recovery_refinement_conflict` (coordination-store.mjs:3030-3045) pins
that the surface never rides the refinement brief.

## Observability

- **The surface is the shared projection (D1).** `{gate, check, detail, corrective}` is
  observable on BOTH consumers — the `run.debug` failure leg (application.mjs:11325-11327) and the
  #79 `gate_verdict` push — from the SAME worker-scoped projection; a reader never sees a field one
  consumer has and the other lacks. The `corrective: null` for an unmappable code is the honest
  "escalate" signal, never a missing field.
- **The block is generated, not hand-carried (D2).** The composition function is observable:
  it returns the served block AND a suppression record — each suppressed line and its suppression
  reason (e.g. `no-commit refuted by the #141 boundary-commit norm`), exposed through a
  diagnostics projection while the worker's block carries only the served lines. *(Fold B6: the
  suppression record also carries the derivation epoch — the admission-time deployment state
  reference, the profile digest and the admission SHA.)* Two composes over the same deployment
  state derive the same block and the same suppression record — a pure function, no clock, no
  random.

---

## Red-first acceptance

Each pin is RED at this HEAD — the behavior is absent from this tree — and the implementation
makes it GREEN. The red suite is `impl/test/issue61-verdict-surface-red.test.mjs`, mirroring the
`issue62-write-failure-red.test.mjs` harness shape (deterministic; MockAdapter fixtures; no live
providers; fixed clocks).

### The verdict surface (D1)

- **R1 — the four-field surface asserts the exact key `detail` (fold B2).** A worker whose latest
  gate event is a scope refusal receives (via the #79 push, cross-ref)
  `{gate: 'scope', check: 'path_scope', detail: {digests, counts}, corrective: 'in_scope_revision'}`
  — WHICH gate, WHAT was checked, the sanitized evidence class, the corrective class. The pushed
  item's sanitized field is `detail` — the landed #79 name — so a #79-shape reader and an R1 reader
  read the same key. RED: no worker-facing verdict surface exists; the judged worker sees at most a
  bare code (TG4).
- **R2 — evidence sanitization holds; the `required_effect` evidence is asserted (fold, Minor 1).**
  The `scope` evidence carries digests+counts and NEVER a path string; `red_green`/`coverage`
  evidence is `sanitizeVerifierDiagnosticText` output, never the raw failure capsule
  (application.mjs:958-990; verifier-diagnostics.mjs:26); `required_effect_absent` carries `detail`
  = the digest/count subset of `requiredEffectEvidence` — `{changedPathCount, changedPathsDigest,
  inScopeChangedPathCount, inScopeChangedPathsDigest}` — never paths. RED: no surface to sanitize.
- **R3 — the corrective is hub-minted per terminal code.** `required_effect_absent` carries
  `corrective: 'in_scope_edit'` (its gate degrades to `unknown`, its code does not); a code absent
  from the table carries `corrective: null`. A forced corrective on an unmappable code refuses
  `verdict_surface_corrective_forced` and degrades per-record. RED: no corrective field exists.
- **R4 — one projection, three consumers.** The surface's `{gate, check, detail, corrective}` is
  derived by the SAME worker-scoped projection `debugGateRefusal(events.filter(e => e.worker ===
  workerId))` that `run.debug` (application.mjs:11325-11327) and the #79 push (cross-ref) use; two
  replays over the same log derive the same surface; cross-worker isolation holds — a worker
  receives ITS OWN surface, never another worker's. RED: the verdict lives only on `run.debug`'s
  run-wide view.
- **R5 — the surface never rides the refinement brief.** The recovery-refinement digest pin
  (coordination-store.mjs:3030-3045) stays byte-stable when the surface is present. RED: no surface
  to violate the pin.

### Objectives from live truth (D2)

- **R6 — the no-commit line never ships on a boundary-commit deployment.** A deployment whose
  `worktreeHarvestPolicy` is `'boundary-commits'` (fold B5) serves the boundary-commit line or
  nothing — never `Do NOT git commit` (recipes.mjs:532). RED: the recipe ships the no-commit line
  unconditionally today, and no `worktreeHarvestPolicy` field exists in the deployment-profile
  schema (application-deployment.mjs:895-905).
- **R7 — every served constraint line has a named live derivation source; a line without one is
  not printed.** The composition refuses `objective_constraint_underrived` when asked to ship an
  underrived line, and the served block is re-derivable from the deployment's durable state — on
  the recipe objective render seam (fold B1). RED: recipes.mjs:529-537 ships five static lines
  through `renderObjective`, none with a named live source.
- **R8 — the wire_frame line is lane-conditional.** The wire_frame HARD CONSTRAINT (issue #28) is
  emitted IFF the size census over the lane's served scope — `brief.pathScope` resolved against
  the effective tree at the admission SHA — shows a file over ~1500 lines; a lane whose scope has
  none never carries it (fold, Minor 3). RED: recipes.mjs:531 ships it unconditionally.
- **R9 — the composed block is a pure function of live policy, frozen at admission (fold B6).**
  Two composes over the same admission-time deployment state derive the same served block AND the
  same suppression record (digest-stable; no clock, no random). RED: no live composition function
  exists — the recipe constraints are static.

---

## Open questions

- **OQ1 — where the corrective table lives.** Pin: a closed hub-minted table beside
  `DEBUG_GATE_CODES` (application.mjs:945-948), with an acceptance source-scan that every terminal
  code REACHABLE on the surface has a corrective or `null`. *(Fold B4: the source-scan must
  enumerate reachable codes — `plan_route_mismatch`/`recovery_route_mismatch` are removed from
  reachability. The reachable set is the three error-kind codes (`worker_path_scope_violation`,
  `forbidden_effect_observed`, `required_effect_absent`) plus the ten reachable `verify.reverified`
  diagnostics (two corrective-bearing, eight null), each with a corrective or `null`.)* The
  alternative — a deployment-policy table — is rejected for the same reason the gate mapping is
  hub-owned: a corrective a caller can rewrite is a forged corrective (#73's class).
- **OQ2 — the required_effect_absent corrective.** The gate degrades to `unknown` under today's
  mapping, but the code is durable. Pin (above): the corrective is keyed by the terminal CODE, so
  the corrective survives the gate degradation, and the evidence class is the digest/count subset
  of `requiredEffectEvidence` (fold, Minor 1). Revisit only if `debugGateFromLiveCode` grows a
  `required_effect` gate — the table then follows, it does not lead.
- **OQ3 — the boundary-commit line's served text.** Present as an explicit live-derived line
  ("commit at natural subsystem boundaries (#141)") when the deployment's `worktreeHarvestPolicy`
  is `'boundary-commits'` (fold B5), absent otherwise. The suppression record (the Observability
  section) names the reason either way, so the absence is observable, not silent.
