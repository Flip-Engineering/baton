# #61 Suite Draft Notes — `worker-verdict-surface-red.test.mjs`

Date: 2026-08-13 · Contract: **worker-verdict-surface v1.1** (folded #61) · Suite: 31 rows (26 RED / 5 PIN)
Deliverables: `impl/test/worker-verdict-surface-red.test.mjs`, `suite-fold-2.md` (the blue-team finding →
resolution map), this draft. Contract stays at **v1.1** — every blue-team finding is a suite-side fold
with no contract movement required.
Authority: `worker-verdict-surface-contract.md` (v1.1 source of truth), `contract-fold.md` (the R1–R9
pins, fold B2 `detail`/B3 closed `check`/B5 `worktreeHarvestPolicy`/B6 epoch, fold Minor 1
`required_effect` digest/count subset, fold Minor 2 the `[attempt:]` carve-out), `suite-blueteam.md`
(the NEEDS-FOLD report folded here), `suite-61-brief.md` (this suite's brief and suite law).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/worker-verdict-surface-red.test.mjs   # run from repo root
ℹ tests 31
ℹ pass 5
ℹ fail 26
ℹ cancelled 0  skipped 0  todo 0
```

Recorded against the PRE-implementation tree. Two consecutive runs of the folded suite both
produced **pass 5 · fail 26** (run 1 ≈ 5.2 s, run 2 ≈ 5.5 s) — the split is deterministic. The 5
passes are exactly the five PIN rows (C4, E1, E2, E3, E4); the 26 failures are the red rows, each
confirmed to fail at its NAMED stage (the per-row stage is in the header and in each row's
first-failing assertion message). The fold's G1+G2 green-side fixes keep D2/A3 failing on the ABSENT
invented surface, never on the green-side fragility the fold removed.

## Row map

Every red row fails at the named stage today and goes green on the v1.1 implementation ONLY. Stages
in **bold** are the current HEAD failure seam. All RED rows' first assertion is an `assert.ok(...)`
or an `assert.equal(typeof …,'function', …)` for the invented methods, so the row fails at the stage —
never on a vacuous shape assertion.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1 | R1/fold B2 | | **verdict-surface-missing** | `applicationNs.projectVerdictSurface(events)` does not exist — there is NO four-field `{gate, check, detail, corrective}` projection; `debugGateRefusal` (application.mjs:993-1015) returns only `{kind, code, message, gate, detail}` |
| A2 | R1/fold B3 | | **verdict-surface-missing** | the closed `check` domain has no constructor — a promotion-phase `trust_gate_failed` would never escalate `check: null`; no projection exists to hold it |
| A3 | R2/fold Minor 1 | | **verdict-surface-missing** | the `required_effect_absent` digest/count subset (`{changedPathCount, changedPathsDigest, inScopeChangedPathCount, inScopeChangedPathsDigest}`) is never projected — no projection exists. The G2 fold dropped the two out-of-scope fixture fields so the event mirrors the real mint (coordinator.mjs:13229-13235) byte-for-byte — the path_scope phase throws first, so out-of-scope is always zero |
| A4 | R2 | | **verdict-surface-missing** | a `verify.reverified accept:false` refusal never reaches a surface with `check` = the closed `diagnosticCode` and a sanitized `detail.tail` — the never-raw law has no consumer |
| A5 | R3/S3 | | **verdict-surface-missing** | the whitelisted `forbidden_effect` member is never projected — a `forbidden_effect_observed` refusal has no surface (`gate` `forbidden_effect`, `check` `forbidden_effect`, `corrective` `forbidden_effect_retraction`) |
| A6 | R2/S3 | | **verdict-surface-missing** | `verification_coverage_failed` is never projected — its `coverage` gate, closed-code `check`, sanitized `tail`, and `coverage_completion` corrective are unpinned |
| B1 | fold D1 B3 | | **verdict-surface-missing** | the honest-absence row — EACH reachable verifier diagnostic carries `corrective: null` and `check` = the closed code; parametrized over the 8-code `NULL_CORRECTIVE_DIAGNOSTICS` set so a wrong mapping of ANY null row is caught |
| B2 | R3 | | **corrective-table-missing** | `applicationNs.VERDICT_CORRECTIVE_TABLE` does not exist — the frozen hub-minted corrective table keyed by terminal CODE (#73 law) has no surface constant |
| B3 | R3/OQ1 | | **corrective-table-missing** | the reachable-codes scan finds no closed table — the 8 null verifier diagnostics + the 5 corrective codes cannot be honest-absence asserted |
| B4 | refusals | | **forced-corrective-refusal-missing** | `verdict_surface_corrective_forced` appears NOWHERE in `impl/` (grep `application.mjs` returns no hit) — a caller-authored corrective has no typed refusal. The S4 fold added the behavioral half: a payload-carried forged corrective is per-record excluded (the remaining valid record survives, the forged corrective never reaches a surface, a malformed-only stream projects `null`) — never a map-wide throw |
| C1 | R4 | | **verdict-surface-missing** | no projection exists to be replay-pure or `.at(-1)`-superseding — the R4 pure-function law is unenforceable |
| C2 | R4 | | **verdict-surface-missing** | no worker-scoped projection exists — the per-worker filter source (`events.filter(e => e.worker === workerId)`, the #79/feedback-forge pattern) is absent |
| C3 | R4-b | | **run-debug-verdict-missing** | the run.debug failure leg exists (P4 shape at HEAD: `{kind, code, message, gate, detail}`) but carries NO `check` and NO `corrective` — the shared projection does not feed the DG-1 consumer |
| C4 | R5 | PIN | digest-pin-green | green today — `task.brief` is byte-stable under `_providerBrief` (pure compose); the recovery-refinement digest pin (`canonicalDigest(fields.brief)`, coordination-store.mjs:3037) never moves |
| C5 | R4/M2 | | **push-verdict-missing** | the #79 push consumer is never driven — a Coordinator-direct ScriptableAdapter turn ends in a gate miss and `_providerBrief` carries NO `attention` array; the pushed `gate_verdict` item (`{stage: push-verdict-missing, verdict: {check, corrective, detail}}`) has no constructor |
| D1 | R6 | | **live-composition-missing** | `recipesNs.composeObjectiveConstraintLines` does not exist — IMPLEMENT_CONSTRAINTS (recipes.mjs:529-537) ships the 5 static lines unconditionally through `renderObjective` (:296-315); the `worktreeHarvestPolicy` read is absent |
| D2 | R6/fold B5 | | **worktree-harvest-policy-missing** | `applicationProfile` (application-deployment.mjs:895-905) returns a frozen profile with NO `worktreeHarvestPolicy` field. The G1 fold widened the slice from a 1200-char proximity cap to the full schema span (`start` → the closing `});` at :935) — a correct placement anywhere in the object passes, only absence fails |
| D3 | R6/Rule 2 | | **live-composition-missing** | same missing composition — the no-commit line cannot be shipped under its named source, and "a TRUE line is never suppressed" is unassertable |
| D4 | R7 | | **live-composition-missing / underrived-refusal-missing** | the composition is absent (HEAD seam `live-composition-missing`); once it exists but refuses nothing, the deeper seam `objective_constraint_underrived` fires |
| D5 | R7 | | **live-composition-missing / unenforced-refusal-missing** | same two-stage seam — `objective_constraint_unenforced` is nowhere in `impl/` |
| D6 | R8 | | **live-composition-missing** | the wire_frame line (recipes.mjs:531) is unconditional in IMPLEMENT_CONSTRAINTS — lane-conditionality is unenforceable without the composition. The M3 fold added the outside-scope edge: a >~1500-line file OUTSIDE the lane's served `pathScope` never carries the line (the census is scope-scoped) |
| D7 | R9/fold B6 | | **live-composition-missing / epoch-missing** | the composition is absent; the suppression record with the derivation epoch (`{profileDigest, admissionSha}`) has no home |
| D8 | fold Minor 2 | | **live-composition-missing** | the `[attempt: salt role]` discriminator is appended by `renderObjective` from the attempt salt (recipes.mjs:296-315) and never rides a constraint block — but no composition exists to pin the carve-out |
| D9 | R9/M1a | | **live-composition-missing / epoch-missing** | the epoch is unpinned behaviorally — composing over DIFFERENT `profile.digest` / `admissionSha` must derive a DIFFERENT epoch (kills a hardcoded `{profileDigest: 'p'×64, admissionSha: 'a'×40}` literal) |
| D10 | R9/M1b | | **live-composition-missing / epoch-missing** | the freeze is unpinned — compose at admission, mutate the deployment policy (harvest flip + digest change), and the admitted rendered objective stays byte-stable while a fresh compose over the mutated policy differs (fold B6's "frozen for the run") |
| D11 | R7/S2 | | **live-composition-missing** | served-line VALUES are never asserted — the exact `Work only within: impl/test/**, docs/guide.md` join, the `Baton deployment profile default@<digest>` line, the workflow/result-policy lines, and the profile-constraints verification-command line must all ship with the LIVE input values |
| D12 | R6/S1 | | **live-composition-missing** | the composition is never anchored to the render seam — the composed `lines` drive the REAL `renderObjective` (no-commit absent on `boundary-commits`, present on `orchestrator-harvest`, the wire_frame line absent on a small lane) AND the static `IMPLEMENT_CONSTRAINTS` list is retired (fold B1 source-scan) |
| E1 | R2 | PIN | current-shape | green today — the run.debug scope detail is `{digests, counts}` (application.mjs:962) in ACTUAL order, never a path string |
| E2 | GT1 | PIN | closed-gate-enum | green today — `DEBUG_GATE_CODES` (application.mjs:945-948) is exactly `{scope, red_green, coverage, route_mismatch, forbidden_effect, unknown}` in ACTUAL source order |
| E3 | fold D1 B3 | PIN | closed-verifier-enum | green today — `CLOSED_VERIFIER_DIAGNOSTICS` (coordinator.mjs:428-433) is the closed 11-code set in ACTUAL source order |
| E4 | refusals | PIN | refusal-precedents | green today — the #73 closed `{gate, detail}` caller schema refuses `application_workflow_feedback_invalid` (application.mjs:1597); the R5 recovery-digest pin is alive |

## Invented surfaces

Every invented member is probed through a namespace import (`applicationNs`, `recipesNs`) or a
source pin; every one is absent at HEAD (the seam the red row holds). The first assertion on every
invented export is an `assert.ok(...)` / `assert.equal(typeof …,'function',…)`, so the row fails at
the named stage — never on a shape assertion that `Object.isFrozen(undefined) === true` could
spuriously satisfy.

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `applicationNs.projectVerdictSurface(events)` → `{gate, code, check, detail, corrective} \| null` — the R1 four-field projection over a worker-scoped event stream (R4: pure, replay-derived, `.at(-1)` supersession); `check` is the closed domain, `corrective` is hub-minted by terminal CODE, `detail` is the sanitized evidence class | namespace import `* as applicationNs` | no such export (A1–A6/B1/C1/C2/C5) |
| `applicationNs.VERDICT_CORRECTIVE_TABLE` — frozen, closed, keyed by terminal CODE (R3) | namespace import `* as applicationNs` | no such export (B2/B3) |
| `recipesNs.composeObjectiveConstraintLines(input)` → `{lines, suppression}` — the R7 live composition over the admission-time deployment state, with the fold B6 suppression record `{epoch: {profileDigest, admissionSha}, suppressed: [{line, reason}]}` | namespace import `* as recipesNs` | no such export (D1/D3–D12) |
| `recipesNs.renderObjective` — the REAL recipe render seam (recipes.mjs:296-315); D12 anchors the composition to it (S1a) | namespace import `* as recipesNs` | exists today but ships the static boilerplate; the composition wiring is absent (D12) |
| the static `IMPLEMENT_CONSTRAINTS` retirement (fold B1) — no-commit and wire_frame lines never live there, the scratchpad closed-shape line does | whole-file read of NUL-free `recipes.mjs`, bracket-sliced | the list ships all five static lines today (D12 S1b) |
| the `worktreeHarvestPolicy` applicationProfile field (`'orchestrator-harvest'` default \| `'boundary-commits'`, fold B5) | source pin on `application-deployment.mjs` `applicationProfile` (:895-935 full span) | field absent (D2) |
| the refusal literals `verdict_surface_corrective_forced`, `objective_constraint_underrived`, `objective_constraint_unenforced` | grep -an on `application.mjs` / the composition | absent (B4/D4/D5) |

The D rows drive the invented `composeObjectiveConstraintLines` with an admission-time deployment
state literal (`profile` incl. `worktreeHarvestPolicy` + `constraints`, `goal.pathScope`,
`workflowConstraint`/`resultConstraint` sources, `admissionSha`, `sizeCensus`, optional
`requestedLines`). D6's wire_frame lane is pinned through `sizeCensus`: a lane whose served scope
carries a >~1500-line file gets the HARD CONSTRAINT, a small lane never does — and the M3 edge
(a large file OUTSIDE the lane's `pathScope`) never does. D9's epoch-variation row composes over
different `profile.digest`/`admissionSha` and asserts the suppression epoch moves with them (a
hardcoded hex literal is caught). D10's freeze row composes at admission, mutates the deployment
policy, and asserts the admitted rendered objective stays byte-stable while a fresh compose over
the mutated policy differs. D11 pins served-line VALUES against the live inputs (the exact
pathScope join, the profile digest, the workflow/result sources, the profile-constraints
verification-command line). D12 anchors the composition to the REAL `renderObjective` seam by
harvest policy and source-scans the static `IMPLEMENT_CONSTRAINTS` list for fold-B1 retirement.
The run.debug rows (C3, E1) drive the REAL `createDriver` + `BatonApplication` stack with
adapter-emitted `error`/`trust_gate` events (the feedback-forge `emitScopeGateEvent` pattern),
reading the DG-1 consumer synchronously — no polling, no wall clock. The C5 push row drives the
Coordinator-direct ScriptableAdapter harness (the worker-delivery-push F1/F5 pattern): a pushed
worker turn ends in a gate miss, `_providerBrief` reads the composed `attention` array, and the
`gate_verdict` item carries `check`/`corrective`/`detail` from the same projection.

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **C4** digest-pin-green | an impl that rides the verdict surface on the refinement brief — a mutation of the admitted `task.brief` while composing moves the recovery-refinement digest pin (coordination-store.mjs:3037) and the store refuses `recovery_refinement_conflict` |
| **E1** current-shape | an impl that leaks a path string in the scope `detail` (R2's never-raw law) or renames a digest/count key — the `{digests, counts}` ACTUAL-order shape must stay byte-stable |
| **E2** closed-gate-enum | an impl that adds a gate code to `DEBUG_GATE_CODES` (a two-row label like `required_effect`/`red_green_failed` slipping into the gate enum instead of the closed `check` domain) |
| **E3** closed-verifier-enum | an impl that renames or removes a `CLOSED_VERIFIER_DIAGNOSTICS` code (the fold B3 `check` source set must stay closed) |
| **E4** refusal-precedents | an impl that drops the #73 closed `{gate, detail}` caller schema (refusing `application_workflow_feedback_invalid`) or moves the R5 recovery-digest pin |

## What makes each stage go green (implementer's checklist)

- **verdict-surface-missing** → R1/fold B2/B3/Minor 1 + R4: `applicationNs.projectVerdictSurface(events)`
  derives `{gate, code, check, detail, corrective}` from the worker-scoped stream
  (`events.filter(e => e.worker === workerId)` — the same filter #79/feedback-forge feed the #79
  `gate_verdict` push). `gate` = `debugGateFromLiveCode(code)` (application.mjs:949-956), `code` =
  `debugTerminalCode` (:937-943), `check` = the whitelisted `trustPhase` OR the closed
  `CLOSED_VERIFIER_DIAGNOSTICS` `diagnosticCode`, and `null` for everything else (fold B3); `detail` =
  the sanitized evidence class (`{digests, counts}` for scope, the `required_effect` digest/count
  subset for required_effect_absent, `{tail: sanitizeVerifierDiagnosticText(...).text}` for
  red_green/coverage, `{}` otherwise); `corrective` = `VERDICT_CORRECTIVE_TABLE[code] ?? null`.
  The S3 fold pins the FULL positive mapping: `forbidden_effect_observed` → gate/check
  `forbidden_effect` + `forbidden_effect_retraction` (A5), `verification_coverage_failed` → gate
  `coverage` + sanitized tail + `coverage_completion` (A6), and B1 is parametrized over all 8 null
  verifier diagnostics so each carries `check` = the closed code (over-escalation to `check: null`
  is caught).
- **corrective-table-missing** → R3: export the frozen `VERDICT_CORRECTIVE_TABLE` keyed by terminal
  CODE (never caller-authored, #73): `worker_path_scope_violation→in_scope_revision`,
  `forbidden_effect_observed→forbidden_effect_retraction`,
  `required_effect_absent→in_scope_edit` (gate degrades to `unknown`, the code survives),
  `verification_red_green_failed→failing_check_fix`,
  `verification_coverage_failed→coverage_completion`, and the 8 reachable null verifier diagnostics →
  `null` (OQ1 honest absence).
- **run-debug-verdict-missing** → R4-b: the DG-1 consumer (`application.debug` failure leg,
  application.mjs:11325-11327) consumes the SAME projection, so `debug.members[].failure` carries
  `check` + `corrective` on top of the existing `{kind, code, message, gate, detail}`.
- **push-verdict-missing** → R4/M2: the #79 push consumer (`coordinator._providerBrief` →
  `composed.attention` with `gate_verdict` items, the worker-delivery-push F1/F5 pattern) carries
  `{stage: 'push-verdict-missing', verdict: {gate, code, check, corrective, detail}}` from the SAME
  projection (C5).
- **forced-corrective-refusal-missing** → refusals: a caller-authored corrective refuses the typed
  surface constant `verdict_surface_corrective_forced` (the #73 law extended to the corrective field)
  AND is per-record excluded from the projection — the remaining valid record survives, a
  malformed-only stream projects `null`, never a map-wide throw (S4's behavioral half).
- **live-composition-missing** → D2/R7/R8/R9/Minor 2: `recipesNs.composeObjectiveConstraintLines`
  serves the constraint block from the admission-time deployment state. Rule 1: every served line
  re-derives from a named live source (the profile constraints, the `pathScope`/`Work only within:`
  line, the `wire_frame_oversize` census line, the no-commit line under `orchestrator-harvest`, the
  #141 boundary-commit line under `boundary-commits`, the workflow/result-policy sources, the
  SCRATCHPAD_WRITE coaching line) — and the served VALUES are asserted against the live inputs
  (S2/D11: the exact pathScope join, the profile digest, the workflow/result lines, the
  verification-command line). Rule 2: underrived/unenforced lines refuse (`objective_constraint_underrived`
  / `objective_constraint_unenforced`), never print. R8: the wire_frame line is lane-conditional on
  the served scope's size census — a large file OUTSIDE the lane's scope never carries it (M3). R9:
  two composes over the same state derive the identical block, the suppression record carries
  `{epoch: {profileDigest, admissionSha}, suppressed: [{line, reason}]}`, and the epoch DERIVES from
  the inputs (M1a/D9 — a hardcoded hex literal is caught); the served block is FROZEN for the run —
  a mid-run policy change does not retro-edit the admitted rendered objective (M1b/D10). The fold B1
  retirement: the no-commit and wire_frame lines no longer live in the static `IMPLEMENT_CONSTRAINTS`
  list, and the composed `lines` drive the REAL `renderObjective` seam by harvest policy (S1/D12).
  The `[attempt: salt role]` discriminator stays a per-attempt render-time append (fold Minor 2),
  never a constraint line.
- **worktree-harvest-policy-missing** → fold B5: `applicationProfile` (application-deployment.mjs:895-905)
  declares `worktreeHarvestPolicy` (`'orchestrator-harvest'` default | `'boundary-commits'`); the
  composition reads it to decide the no-commit / boundary-commit lines. D2 slices the FULL object
  span to the closing `});` — a correct placement anywhere in the schema passes (G1).
- **underrived-refusal-missing / unenforced-refusal-missing** → R7: the composition validates every
  requested line against the Rule 1 named-source table and refuses the two typed codes.

## Suite-law hygiene (verified)

- **Hermetic**: a Coordinator-direct ScriptableAdapter (no harness, no network, mock worktrees) for
  the store-seam rows incl. the C5 push consumer (the worker-delivery-push F1/F5 harness pattern) +
  the real `createDriver` + `BatonApplication` stack (MockAdapter) for the run.debug rows;
  `mkdtempSync` repos/logs; global `test.after` cleanup; the deployment-verification stub is the
  brief's `true` command.
- **Red-first at named stages**: every RED row's first assertion is the named-stage failure (a
  `typeof`/`ok` guard for invented surfaces, a behavior assertion for the C3 run.debug row); the
  stage names live in the header row inventory AND in each row's assertion message. 26 RED rows / 5
  PINs, stable across consecutive runs.
- **NUL discipline**: `application.mjs` and `coordination-store.mjs` (3 NUL bytes each) are touched
  ONLY via `grep -an` / `sed -n` (the `enumLiteralsUnder` helper is bracket-sliced) — never a
  whole-file read. `coordinator.mjs`, `application-deployment.mjs`, and `limits.mjs` are NUL-free
  and read for the anchors. The suite file itself is NUL-free.
- **No clocks as controls / no wall-clock assertion**: the Coordinator-direct rows drive the real
  event path with a fixed microtask drain (`flush(80)`); the full-application rows inject gate
  events and read the debug projection synchronously. No row asserts wall-clock behavior;
  `Date.now()` never appears.
- **`watchdog.stallMs` is a VALID POSITIVE integer** in every fixture: the full-application harness
  passes `stallMs: 60_000` with a fixture comment (the #67 admission law — `stallMs: 0` now refuses).
- **No `localeCompare`**; the closed-enum PINs (E2/E3), the `{digests, counts}` shape (E1), and the
  `VERDICT_CORRECTIVE_TABLE` expected literals are asserted in ACTUAL source order against frozen
  constants.
