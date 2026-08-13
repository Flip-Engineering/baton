# #73 Suite Draft Notes — `feedback-forge-hardening-red.test.mjs`

Date: 2026-08-12 · Contract: **feedback-forge-hardening v1.1** (folded #73, `run.feedback`
forged-verdict lane) · Suite: 13 rows (6 RED / 7 PIN)
Deliverable: `impl/test/feedback-forge-hardening-red.test.mjs` (this draft's only other deliverable).
Authority: `feedback-forge-hardening-contract.md` (v1.1 source of truth; §5 acceptance pins),
`contract-fold.md` (the `candidate.evidence.verification.worker` referent fix + the one
derived-flag model + B5 per-record degradation), `contract-redteam.md` (the attack surface, B5
blocker), `suite-73-brief.md` (this suite's brief).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/feedback-forge-hardening-red.test.mjs   # run from repo root
ℹ tests 13
ℹ pass 7
ℹ fail 6
ℹ cancelled 0  skipped 0  todo 0
```

Recorded after the suite was finalized. Two consecutive runs of the finished suite both produced
**pass 7 · fail 6** (run 1 ≈ 19.2 s, run 2 ≈ 19.1 s) — the split is deterministic. The 7 passes
are exactly the seven PIN rows (P1–P7); the 6 failures are the red rows (R1–R6), each confirmed
to fail at its NAMED stage (the stage is in the header row inventory AND in each row's
first-failing assertion message — see the failure seam column below).

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
| R1 | RED-1 | | **expect_typed_refusal** | `sendWorkflowFeedback` (:6717) normalizes gate-shaped `{gate, detail}`, `assertWorkflowFeedbackAnchors` (:6745) BYPASSES path anchors for gate-shaped feedback, and the forge records the caller's bytes verbatim — no gate-unbound refusal, no derived/gateEventSeq, no `SECRET_SHAPED_TEXT` guard invoked |
| R2 | GREEN-2 | | **expect_derived_record** | a real gate event (emitted through the adapter, durable per-worker `seq` on `<deploymentRoot>/state/<workerId>.jsonl`) never binds the stored packet: no `derived: true`, no `gateEventSeq === seq`; a fabricated verdict lands with the caller's bytes |
| R3 | GREEN-3 | | **expect_coaching_derived_false** | coaching records no `derived: false` / `gateEventSeq: null` (the 10-field literal at :6360-6362 has no flags) |
| R4 | GREEN-4 | | **select_candidate_no_crash** | a gate-shaped verdict packet in the revision set crashes `_workflowRevisionEligibility` at :6860 (`packets.some((packet) => packet.feedback.findings.some(...))` → `TypeError: Cannot read properties of undefined (reading 'some')`), and the feedback section renders a non-undefined summary |
| R5 | B2 | | **literal_12_field_closed** | `_workflowFeedback` projects the 10-field literal (:6360-6362) — `['definitionDigest','feedback','feedbackId','planDigest','prefix','repoId','runId','schemaVersion','source','target']` — no `derived` / `gateEventSeq` |
| R6 | B5 | | **expect_pre_hardening_record_excluded** | a shape-only gate-shaped record (the pre-hardening population the migration must replay honestly) SURFACES in the read (itemCount 1) — per-record exclusion absent; the forged record is never dropped from the projection |

## Invented surfaces

No invented module is imported — every invented surface is probed through a REAL entry point (the
openBaton workflow facade, the DG-1b `application.command`, or `readFileSync` source scanning).
The invented members are referenced as string literals / property reads only, so the suite has no
imports that would fail to resolve at HEAD.

| Invented surface | Probed through | HEAD behavior |
|------------------|-----------------|---------------|
| `application_workflow_feedback_gate_unbound` — the NEW typed refusal for a gate-shaped submission with no ledger referent (RED-1) | `workflow.sendFeedback(...)` outcome (`error.code`) | no such code — the forge accepts instead (R1) |
| `derived` / `gateEventSeq` packet fields — the one derived-flag model (B2): `derived: true` on hub-minted verdicts, `derived: false` + `gateEventSeq: null` on coaching | the read-back packet (`workflow.feedback()` → section item `value`) | absent (R2/R3) and absent from the `_workflowFeedback` fields literal (R5) |
| `wrapHubDerived` provenance discriminator — `{provenance: 'hub-derived', untrusted: true}` (B6), never a `derived` field on the push item | the D6 push-contract text + the push red-suite `gate_verdict` literal | the discriminator is contract-only; the push item carries NO `derived` today and must not gain one (P5) |

Two harnesses supply the real entry points:

- **DG-1b harness** (mirrors `diagnostics-red.test.mjs`): real Coordinator + `BatonApplication`
  through `createDriver`, a `DebugAdapter` (`turnCompletion: 'pausable'`) with `adapter.emit`
  injection, and `application.command('run.feedback', …)` — the P1/P3/P4 rows drive the actual
  `normalizeGateCauseFeedback` / `sendWorkflowFeedback` / `debugGateRefusal` code paths.
- **openBaton workflow harness**: a real deployment (resident dispatch loop) with two
  `EmittableAdapter` workers that actually complete candidate work through verify; the P2/P6 and
  R1–R4/R6 rows drive the public workflow facade (`sendFeedback`, `feedback`, `candidates`,
  `debug`, `select`, `revise`) against real candidates carrying `evidence.verification.worker`.

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

## What makes each stage go green (implementer's checklist)

- **expect_typed_refusal** (R1) → RED-1: a gate-shaped submission with `derived === null` (no
  ledger referent) refuses typed `application_workflow_feedback_gate_unbound` — the refusal is
  `SECRET_SHAPED_TEXT`-guarded (the gate is never caller-authored content), and the refusal
  appends no record. The D1 hub-minted rule: REFUSE when there is no gate event on the Candidate's
  task stream (`_debugMember` scope, application.mjs:11300 — reads `driver.log.read(workerId)`
  filtered by `runId` + `taskId`).
- **expect_derived_record / expect_replaced_record** (R2) → GREEN-2: the guard resolves the
  referent from `candidate.evidence.verification.worker`'s stream (the fold referent fix), and a
  byte-matching verdict records `derived: true` + `gateEventSeq` = the source gate event's
  per-worker `seq` (from `<deploymentRoot>/state/<workerId>.jsonl`, per-worker 1-based gap-free);
  a fabricated verdict is replaced by the derived gate or refused — never persisted with the
  caller's bytes.
- **expect_coaching_derived_false** (R3) → GREEN-3: coaching `{summary, findings}` records
  `derived: false` + `gateEventSeq: null` — the one derived-flag model (B2) on EVERY packet.
- **select_candidate_no_crash** (R4) → GREEN-4: `_workflowRevisionEligibility` (:6860) reads
  `packet.feedback.findings?.some(...)` (optional chaining) so a gate-shaped packet cannot throw;
  the feedback section renders a non-undefined `summary` for gate-shaped packets.
- **literal_12_field_closed** (R5) → B2: the `_workflowFeedback` projection uses the 12-field
  CLOSED literal `['definitionDigest', 'derived', 'feedback', 'feedbackId', 'gateEventSeq',
  'planDigest', 'prefix', 'repoId', 'runId', 'schemaVersion', 'source', 'target']` in ACTUAL
  sorted order (never a derived set / spread).
- **expect_pre_hardening_record_excluded** (R6) → B5: a failing packet is EXCLUDED per-record
  from the read projection (never a map-wide `application_workflow_integrity` throw — the
  contract-redteam B5 blocker); the deployment migration step excludes the forge's shape-only
  gate-shaped records so the pre-hardening population replays honestly as "absent".

## Design notes and limitations

- **RED-2 is GREEN at HEAD (P3 reassignment).** The §5 RED-2 pin — a caller-supplied `derived`
  flag → `application_workflow_feedback_invalid` — is already satisfied by
  `exactObject(value, ['gate', 'detail'], 'application_workflow_feedback_invalid')` at :1597. The
  caller schema is closed TODAY. Reassigning RED-2 as a PIN row is the honest read: the red-first
  law demands rows fail at NAMED stages at HEAD, and this one does not — it fails at HEAD only for
  the wrong reason (shape-only validation, the forge). As a pin it kills any impl that widens the
  schema while the hardening lands the real (referent) control elsewhere.
- **R6 injection limitation.** The openBaton deployment's driver is private (`#driver`), and the
  raw-application harness cannot run workflows to completion (dispatch never advances without the
  resident loop), so `driver.coordination.recordDriver` injection is unavailable for staging a
  true pre-hardening record. R6 is therefore behavioral: it forges a shape-only gate-shaped record
  through the public `workflow.sendFeedback` facade — the same durable path a pre-hardening
  deployment would have written. At HEAD the forge records it and the read surfaces it
  (itemCount 1 → RED); after hardening the admission refuses it (R1) so no record exists and
  itemCount 0 (→ GREEN). The exclusion assertion is tolerant of either the refuse or the
  replace-as-derived outcome, but the forged bytes never surface.
- **Workflow rows are behavioral, not injective.** Because the driver is private, R1–R4/R6 cannot
  stage a pre-existing gate event or packet through the store; they emit the REAL gate event
  through the EmittableAdapter (durable, per-worker `seq`, matching `runId`+`taskId`) and read the
  honest referent back through `workflow.debug()` — the exact shape the forged verdict spoofs.

## Suite-law hygiene (verified)

- **Hermetic**: every deployment is a `mkdtempSync` repo + `mkdtempSync` deployment root torn down
  by `t.after`; adapters are MockAdapter subclasses; verification is the brief's `true` command;
  no network, no real provider spawns.
- **Red-first at named stages**: each RED row's first failing assertion is the named-stage failure;
  the stage names live in the header row inventory AND in each row's assertion message (confirmed
  by the six distinct `stage:` strings in the failure output). 6 RED rows / 7 PINs, stable across
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
