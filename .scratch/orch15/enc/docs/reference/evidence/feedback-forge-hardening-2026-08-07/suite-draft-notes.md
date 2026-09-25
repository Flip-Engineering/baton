# #73 Suite Draft Notes — `feedback-forge-hardening-red.test.mjs`

Date: 2026-08-12 · Contract: **feedback-forge-hardening v1.1** (folded #73, `run.feedback`
forged-verdict lane) · Suite: 16 rows (8 RED / 8 PIN) after the blue-team fold
Deliverable: `impl/test/feedback-forge-hardening-red.test.mjs` (this draft's only other deliverable).
Authority: `feedback-forge-hardening-contract.md` (v1.1 source of truth; §5 acceptance pins),
`contract-fold.md` (the `candidate.evidence.verification.worker` referent fix + the one
derived-flag model + B5 per-record degradation), `contract-redteam.md` (the attack surface, B5
blocker), `suite-73-brief.md` (this suite's brief), `suite-fold-2.md` (the blue-team NEEDS-FOLD
fold: S1–S3 + M1–M3).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/feedback-forge-hardening-red.test.mjs   # run from repo root
ℹ tests 16
ℹ pass 8
ℹ fail 8
ℹ cancelled 0  skipped 0  todo 0
```

Recorded after the blue-team fold (`suite-fold-2.md`) was finalized. Two consecutive runs of the
finished suite both produced **pass 8 · fail 8** — the split is deterministic. The 8 passes are
exactly the eight PIN rows (P1–P8); the 8 failures are the red rows (R1–R8), each confirmed to
fail at its NAMED stage (the stage is in the header row inventory AND in each row's
first-failing assertion message — see the failure seam column below). Before the fold the split
was 13 rows (P1–P7 green; R1–R6 red); the fold added P8 + R7 + R8 and extended R2/R4/R6 without
moving any existing stage.

## Row map

Every red row fails at the named stage today and goes green on the v1.1 implementation ONLY.
Stages in **bold** are the current HEAD failure seam. PIN rows are green today and stay live: each
kills a specific wrong implementation (see the PIN list).

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| P1 | GREEN-1/G2 | PIN | workflow-gate-discriminator | green today — `normalizeGateCauseFeedback` (application.mjs:1594) accepts gate-shaped `{gate, detail}` (closed `exactObject(value, ['gate','detail'])` :1597); a non-workflow run refuses at the workflow gate with `application_workflow_feedback_unavailable` (sendWorkflowFeedback:6717), never the shape code |
| P2 | G4-B1/fold | PIN | referent-binding | green today — `candidate.evidence.verification` is `{worker, workerSeq, verdictDigest, changedPathsDigest}` (:6264-6267); `verification.worker`/`.workerSeq` bind the D1 lookup to the worker stream (the fold's referent fix) |
| P3 | RED-2 | PIN | caller-derived-refused | green today — `exactObject(value, ['gate', 'detail'], 'application_workflow_feedback_invalid')` (:1597) refuses a caller-supplied `derived` key; the caller schema is ALREADY closed at HEAD, so RED-2 is a pin (kills any impl that widens the schema) |
| P4 | GREEN-5a | PIN | debug-failure-shape | green today — `run.debug` projects the exact `{kind:'error', code:'worker_path_scope_violation', message:'scope', gate:'scope', detail:{digests, counts}}` (debugGateRefusal :984-1006, pathScopeEvidence :955-968) — the honest referent a forged verdict spoofs |
| P5 | GREEN-5b/B6 | PIN | push-derived-free | green today — the D6 push contract (`worker-delivery-push-contract.md`, `### D6`) and the push red-suite `gate_verdict` literal (worker-delivery-push-red.test.mjs:287) carry NO `derived`; `wrapHubDerived.provenance === 'hub-derived'` discriminates — never a packet field |
| P6 | GREEN-3 | PIN | coaching-authored | green today — `{summary, findings}` coaching is authored, anchored (`assertWorkflowFeedbackAnchors` :1683), and read back intact; the feedback section render (:10572-10576) emits `summary: packet.feedback.summary` |
| P7 | refusals | PIN | refusal-vocabulary-typed | green today — `application_workflow_feedback_invalid`, `application_workflow_feedback_anchor_invalid`, `application_workflow_feedback_unavailable`, `application_workflow_integrity` are all typed in application.mjs |
| P8 | S2 (fold) | PIN | secret-shaped-coaching-refused | green today — the coaching-branch `SECRET_SHAPED_TEXT` guard already refuses a secret-shaped `summary` (:1665) or finding `message` (:1675) with `application_workflow_feedback_invalid`; the fold pins BOTH arms (summary + message) and that nothing is appended |
| R1 | RED-1 | | **expect_typed_refusal** | `sendWorkflowFeedback` (:6717) normalizes gate-shaped `{gate, detail}`, `assertWorkflowFeedbackAnchors` (:6745) BYPASSES path anchors for gate-shaped feedback, and the forge records the caller's bytes verbatim — no gate-unbound refusal, no derived/gateEventSeq, no `SECRET_SHAPED_TEXT` guard invoked |
| R2 | GREEN-2 + B4 (fold) | | **expect_derived_record** (+ expect_replaced_record, expect_replay_stable) | a real gate event (emitted through the adapter, durable per-worker `seq` on `<deploymentRoot>/state/<workerId>.jsonl`) never binds the stored packet: no `derived: true`, no `gateEventSeq === seq`; a fabricated verdict lands with the caller's bytes. The M2 (B4) extension — a SECOND gate event (different digests, seq N+1) on the same worker — is not reached at HEAD, so bound-vs-latest is indistinguishable today |
| R3 | GREEN-3 | | **expect_coaching_derived_false** | coaching records no `derived: false` / `gateEventSeq: null` (the 10-field literal at :6360-6362 has no flags) |
| R4 | GREEN-4 + render half (fold) | | **select_candidate_no_crash** (+ expect_render_verdict_summary, expect_render_verdict_line) | a gate-shaped verdict packet in the revision set crashes `_workflowRevisionEligibility` at :6860 (`packets.some((packet) => packet.feedback.findings.some(...))` → `TypeError: Cannot read properties of undefined (reading 'some')`). The render half (S3) runs only post-hardening: the feedback section must render a non-undefined verdict summary and the revision objective a distinct verdict line, never `Feedback: undefined` |
| R5 | B2 | | **literal_12_field_closed** | `_workflowFeedback` projects the 10-field literal (:6360-6362) — `['definitionDigest','feedback','feedbackId','planDigest','prefix','repoId','runId','schemaVersion','source','target']` — no `derived` / `gateEventSeq` |
| R6 | B5 + migration (fold) | | **expect_pre_hardening_record_excluded** | a GENUINE persisted pre-hardening 10-field record — staged through `driver.coordination.recordDriver` via the M1 seam (`openBatonDeployment(options, createDriver)`) — SURFACES in the read (itemCount 1): per-record exclusion absent; the later coaching record and the excluded pre-hardening record cannot yet project separately |
| R7 | S1 (fold) | | **expect_second_run_refused** | a gate event on run-1's builder worker binds a verdict on run-1, but run-2's same-shaped submission (its own builder stream has no gate event) is ACCEPTED and recorded at HEAD — the candidate-scoped `runId`+`taskId` referent boundary is unobserved, so cross-run verdict laundering passes |
| R8 | D4 (fold) | | **expect_gate_unbound_typed** | `application_workflow_feedback_gate_unbound` is absent from application.mjs at HEAD (grep-count 0), so the typed refusal can never surface verbatim through the web-northbound `application_*` fallthrough (web-northbound.mjs:206-209) or the mcp-northbound error mapper (mcp-northbound.mjs:206) |

## Invented surfaces

No invented module is imported — every invented surface is probed through a REAL entry point (the
openBaton workflow facade, the DG-1b `application.command`, or `readFileSync` source scanning).
The invented members are referenced as string literals / property reads only, so the suite has no
imports that would fail to resolve at HEAD.

| Invented surface | Probed through | HEAD behavior |
|------------------|-----------------|---------------|
| `application_workflow_feedback_gate_unbound` — the NEW typed refusal for a gate-shaped submission with no ledger referent (RED-1 / S1 / D4) | `workflow.sendFeedback(...)` outcome (`error.code`) on R1/R7 + a source-scan of application.mjs / web-northbound.mjs / mcp-northbound.mjs on R8 | no such code — the forge accepts instead (R1/R7) and the code is absent from every surface (R8) |
| `derived` / `gateEventSeq` packet fields — the one derived-flag model (B2): `derived: true` on hub-minted verdicts, `derived: false` + `gateEventSeq: null` on coaching | the read-back packet (`workflow.feedback()` → section item `value`) | absent (R2/R3) and absent from the `_workflowFeedback` fields literal (R5) |
| `wrapHubDerived` provenance discriminator — `{provenance: 'hub-derived', untrusted: true}` (B6), never a `derived` field on the push item | the D6 push-contract text + the push red-suite `gate_verdict` literal | the discriminator is contract-only; the push item carries NO `derived` today and must not gain one (P5) |

Two harnesses supply the real entry points:

- **DG-1b harness** (mirrors `diagnostics-red.test.mjs`): real Coordinator + `BatonApplication`
  through `createDriver`, a `DebugAdapter` (`turnCompletion: 'pausable'`) with `adapter.emit`
  injection, and `application.command('run.feedback', …)` — the P1/P3/P4 rows drive the actual
  `normalizeGateCauseFeedback` / `sendWorkflowFeedback` / `debugGateRefusal` code paths.
- **openBaton workflow harness**: a real deployment (resident dispatch loop) with two
  `EmittableAdapter` workers that actually complete candidate work through verify; the P2/P6/P8 and
  R1–R4/R6/R7 rows drive the public workflow facade (`sendFeedback`, `feedback`, `candidates`,
  `debug`, `select`, `revise`) against real candidates carrying `evidence.verification.worker`.
  R6 additionally lands the **M1 seam**: `openWorkflow(t, { captureDriver: true })` builds the
  deployment via `openBatonDeployment(options, createDriver)` so the wrapper captures the driver
  (without touching the private `#driver` field) and `driver.coordination.recordDriver` can stage
  a genuine pre-hardening record. R7 opens a SECOND workflow on the same deployment to pin the
  candidate-scoped referent boundary (S1).

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **P1** workflow-gate-discriminator | an impl that adds a SHAPE reject for gate-shaped input (a non-workflow `run.feedback` returning `application_workflow_feedback_invalid` would break GREEN-1 — the discriminator must be the workflow gate, never the caller schema) |
| **P2** referent-binding | an impl that binds the D1 hub-derived lookup to the closed `verification` field or any key other than `candidate.evidence.verification.worker` / `.workerSeq` (the fold's referent fix — the `{worker, workerSeq, verdictDigest, changedPathsDigest}` object at :6264) |
| **P3** caller-derived-refused | an impl that widens the caller schema to admit `derived` (RED-2's closed schema — a caller-authored `derived` flag would let a forge self-certify a hub verdict) |
| **P4** debug-failure-shape | an impl that renames/re-shapes the `run.debug` failure leg (the honest referent must stay byte-stable so validated-or-replaced can verify against it) |
| **P5** push-derived-free | an impl that carries `derived` on the #79 `gate_verdict` push item (B6 — the derived flag is the planner's packet discriminator, never a wire/projection field) |
| **P6** coaching-authored | an impl that re-authors, re-anchors, or re-renders coaching (GREEN-3 coaching `{summary, findings}` must be preserved verbatim) |
| **P7** refusal-vocabulary-typed | an impl that renames or un-types any of the four existing refusal codes (`application_workflow_feedback_invalid` / `_anchor_invalid` / `_unavailable` / `application_workflow_integrity`) |
| **P8** secret-shaped-coaching-refused (S2) | an impl that removes or relaxes the coaching-branch `SECRET_SHAPED_TEXT` guard — the fold pins BOTH the secret-shaped `summary` arm and the finding-`message` arm refusing `application_workflow_feedback_invalid` with nothing appended |

## What makes each stage go green (implementer's checklist)

- **expect_typed_refusal** (R1) → RED-1: a gate-shaped submission with `derived === null` (no
  ledger referent) refuses typed `application_workflow_feedback_gate_unbound` — the refusal is
  `SECRET_SHAPED_TEXT`-guarded (the gate is never caller-authored content), and the refusal
  appends no record. The D1 hub-minted rule: REFUSE when there is no gate event on the Candidate's
  task stream (`_debugMember` scope, application.mjs:11300 — reads `driver.log.read(workerId)`
  filtered by `runId` + `taskId`).
- **expect_derived_record / expect_replaced_record / expect_replay_stable** (R2) → GREEN-2 + B4:
  the guard resolves the referent from `candidate.evidence.verification.worker`'s stream (the fold
  referent fix), and a byte-matching verdict records `derived: true` + `gateEventSeq` = the source
  gate event's per-worker `seq` (from `<deploymentRoot>/state/<workerId>.jsonl`, per-worker 1-based
  gap-free); a fabricated verdict is replaced by the derived gate or refused — never persisted with
  the caller's bytes. B4 replay-stability (M2): the read-back re-projects the BOUND event
  (`gateEventSeq === N`, first digests), so a SECOND gate event at seq N+1 must NOT move the
  projection — the `.at(-1)`-latest implementation is killed.
- **expect_coaching_derived_false** (R3) → GREEN-3: coaching `{summary, findings}` records
  `derived: false` + `gateEventSeq: null` — the one derived-flag model (B2) on EVERY packet.
- **select_candidate_no_crash / expect_render_verdict_summary / expect_render_verdict_line**
  (R4) → GREEN-4: `_workflowRevisionEligibility` (:6860) reads `packet.feedback.findings?.some(...)`
  (optional chaining) so a gate-shaped packet cannot throw; the feedback section renders a
  non-undefined `summary` for gate-shaped packets, and `renderWorkflowRevisionObjective`
  (:1787-1804) renders a `derived:true` packet as a distinct verdict line (the gate name), never
  `Feedback: undefined`.
- **literal_12_field_closed** (R5) → B2: the `_workflowFeedback` projection uses the 12-field
  CLOSED literal `['definitionDigest', 'derived', 'feedback', 'feedbackId', 'gateEventSeq',
  'planDigest', 'prefix', 'repoId', 'runId', 'schemaVersion', 'source', 'target']` in ACTUAL
  sorted order (never a derived set / spread).
- **expect_pre_hardening_record_excluded** (R6) → B5: a failing packet is EXCLUDED per-record
  from the read projection (never a map-wide `application_workflow_integrity` throw — the
  contract-redteam B5 blocker); the migration step must name which (re-derived-and-marked or
  excluded) it applies to a PERSISTED pre-hardening record — the fold stages a genuine 10-field
  record via the M1 seam so the code path is reached, and asserts a later coaching record still
  projects.
- **expect_second_run_refused** (R7) → S1: the referent lookup is candidate-scoped — D1 filters
  `event.runId === current.goal.runId && event.taskId === candidate.taskId`. A gate event on
  run-1's builder must NOT bind run-2's same-shaped submission: the refusal is typed
  `application_workflow_feedback_gate_unbound` and appends nothing.
- **expect_gate_unbound_typed** (R8) → D4: the new code is typed in application.mjs and preserved
  verbatim through the web-northbound `application_*` fallthrough (web-northbound.mjs:206-209) and
  the mcp-northbound error mapper (mcp-northbound.mjs:206).

## Design notes and limitations

- **RED-2 is GREEN at HEAD (P3 reassignment).** The §5 RED-2 pin — a caller-supplied `derived`
  flag → `application_workflow_feedback_invalid` — is already satisfied by
  `exactObject(value, ['gate', 'detail'], 'application_workflow_feedback_invalid')` at :1597. The
  caller schema is closed TODAY. Reassigning RED-2 as a PIN row is the honest read: the red-first
  law demands rows fail at NAMED stages at HEAD, and this one does not — it fails at HEAD only for
  the wrong reason (shape-only validation, the forge). As a pin it kills any impl that widens the
  schema while the hardening lands the real (referent) control elsewhere.
- **R6 stages a GENUINE pre-hardening record via the M1 seam (injection limitation resolved).**
  The fold (suite-fold-2 M1) resolves the R6 injection limitation: `openBatonDeployment(rawOptions,
  createDriver)` (application-deployment.mjs:1719) accepts the driver factory as parameter 2, so
  `openWorkflow(t, { captureDriver: true })` passes a wrapper `(driverOpts) => { const d =
  createDriver(driverOpts); captured = d; return d; }` that captures the driver WITHOUT touching
  the private `#driver` field, while the deployment still runs its resident dispatch loop. R6 then
  stages a persisted 10-field `application.workflow_feedback_recorded` record — the exact shape
  the pre-hardening forge wrote — through `driver.coordination.recordDriver`. At HEAD it surfaces
  (itemCount 1 → RED); after hardening it must be EXCLUDED per-record while a later coaching
  record still projects, with no map-wide `application_workflow_integrity` throw.
- **Workflow rows are behavioral and injective.** Emitted gate events go through the real
  EmittableAdapter (durable, per-worker `seq`, matching `runId`+`taskId`); pre-existing packets
  can now be staged through the captured driver (R6); the honest referent is read back through
  `workflow.debug()` — the exact shape the forged verdict spoofs.
- **S1 pins the run-wide/worker-any class (arm 1).** The same-worker arm of the S1 fold would
  require reusing a worker identity across two workflows; the openBaton harness derives worker IDs
  per task (run-unique), so R7 lands the different-worker arm — run-2's builder stream has zero
  gate events on its own run, and a run-any/worker-any referent scan that borrowed run-1's gate
  would mint and fail the refusal assertion. This kills the run-wide and worker-any scan classes
  the blue-team identified.

## Suite-law hygiene (verified)

- **Hermetic**: every deployment is a `mkdtempSync` repo + `mkdtempSync` deployment root torn down
  by `t.after`; adapters are MockAdapter subclasses; verification is the brief's `true` command;
  no network, no real provider spawns.
- **Red-first at named stages**: each RED row's first failing assertion is the named-stage failure;
  the stage names live in the header row inventory AND in each row's assertion message (confirmed
  by the eight distinct `stage:` strings in the failure output). 8 RED rows / 8 PINs, stable across
  consecutive runs.
- **NUL discipline**: `application.mjs` contains literal NUL bytes (line 619 cacheKey) — plain
  `grep` treats it as binary and fails silently. Manual inspection uses `grep -a` / `sed -n`; the
  suite reads sources with `readFileSync(..., 'utf8')` + string scanning, which is NUL-tolerant.
  The suite file itself is NUL-free.
- **No clocks as controls**: no `setTimeout`/wall-clock/timeout logic anywhere; workflow progress
  is driven by openBaton's resident dispatch loop, never by a timer.
- **No `localeCompare`**; the B2 12-field literal and every key set are asserted in ACTUAL sorted
  order against frozen constants.
- **Namespace discipline**: no invented imports — the invented refusal code, packet fields, and
  push provenance are probed through real surfaces and string literals only.
