# #73 blue-team — feedback-forge-hardening red suite, adversarial verification

Contract: `docs/reference/evidence/feedback-forge-hardening-2026-08-07/feedback-forge-hardening-contract.md`
(v1.1, fold HEAD `7518367ad5e09eef78c33fd0444c6c89190c3ff8`) via `contract-fold.md`. Suite:
`impl/test/feedback-forge-hardening-red.test.mjs` (13 rows: 6 RED / 7 PIN). Verified at THIS
HEAD `eab4db5` ("Baton private effective-tree snapshot"), 2026-08-12, node v25.8.0. NUL
discipline honored: `application.mjs` and `coordination-store.mjs` (3 NUL bytes each) were
read only via `grep -an` / `sed -n`; every citation below re-verified at this HEAD.

**Verdict: NEEDS-FOLD.** The suite is honestly red today (7 pass / 6 fail, every red row fails
at its NAMED stage, hermetic, deterministic) and every red fixture is green-side mintable under
a correct v1.1 implementation (axis 1 SOUND). The refuse-outright attack on the forged-verdict
rows is dead (R2 requires the derived record to exist, so an all-gate-shaped-refuser fails),
and the one derived-flag model is pinned for BOTH pairings — verdict `derived:true` +
`gateEventSeq: <seq>` (R2) and coaching `derived:false` + `gateEventSeq: null` (R3), plus the
12-field closed literal (R5). But the suite's **red-keeping power has five load-bearing holes**
across two axes: **shallow-greenability** — S1 (HIGH) the candidate-scoped `runId`+`taskId`
referent boundary (the contract's own "cross-run verdict laundering is blocked by construction"
claim) is unpinned: no row drives a second run, so a worker-wide/run-wide referent scan greens
every row; S2 (MEDIUM) the `SECRET_SHAPED_TEXT` guard on the coaching branch is asserted
nowhere; S3 (MEDIUM) GREEN-4's render half (a distinct verdict line in the revision objective,
a non-`undefined` summary in the feedback section) is never asserted — R4 pins no-crash only;
**missing rows** — M1 (HIGH) B5's per-record degradation + migration step is NOT behaviorally
pinned (R6 post-hardening reduces to R1's refusal: nothing is ever stored, so the "exclude a
persisted pre-hardening record per-record" code path is never reached); M2 (HIGH) B4's
replay-stability is unpinned (no row emits a second gate event after recording and asserts the
read-back still re-projects the BOUND event); M3 (LOW) the new `application_workflow_feedback_gate_unbound`
code's source/facade surface constancy (D4) is unpinned. Each finding carries a concrete fold.

---

## 0. Run record (exact)

Run from the repo root (`node --test impl/test/feedback-forge-hardening-red.test.mjs`), at THIS
HEAD `eab4db5`:

```
tests 13 · pass 7 · fail 6 · cancelled 0 · skipped 0 · todo 0
```

The 7 passes are exactly the PIN rows **P1–P7**; the 6 failures are exactly the RED rows
**R1–R6**, each failing at its named stage (from the failure output):

| Row | Stage | HEAD failure seam |
|---|---|---|
| R1 | `expect_typed_refusal` | no typed refusal — the forge records the caller's bytes (submission resolves `ok:true`) |
| R2 | `expect_derived_record` | `packet.derived` is absent (never hub-set `true`) |
| R3 | `expect_coaching_derived_false` | `packet.derived` is absent (never `false`), `gateEventSeq` absent |
| R4 | `select_candidate_no_crash` | `_workflowRevisionEligibility` TypeError `packet.feedback.findings.some` (`application.mjs:6860`) |
| R5 | `literal_12_field_closed` | `_workflowFeedback` projects the 10-field literal (`application.mjs:6360-6362`), got the 10 fields, not the 12 |
| R6 | `expect_pre_hardening_record_excluded` | the shape-only record surfaces in the read (`itemCount 1`) |

The split matches the suite header and every prior recorded run (draft-notes runs + this
session's re-runs): 7/6, stable and deterministic.

## 1. Axis 4 first — hermeticity / #7-class: SOUND (verified)

- **No clocks as controls.** No `setTimeout`/wall-clock/timeout logic anywhere in the suite;
  workflow progress is driven by openBaton's resident dispatch loop, never a timer. The
  workflow adapters' scenario edits carry `delayMs: 0`, and the edit executor guards on
  `if (edit.delayMs)` (`adapter.mjs:670`) — falsy 0 means `haltableDelay` is never scheduled, so
  no real timer is a control. `Date.now()` appears nowhere in the test file.
- **Hermetic.** Every deployment is a `mkdtempSync` repo + `mkdtempSync` deployment root, torn
  down by `t.after` (the DG-1b harness `test:206-212`; the workflow harness `test:315-319`);
  adapters are `MockAdapter` subclasses; verification is the brief's `true` command; no network,
  no real provider spawns. The only external call is `execFileSync('git', [...])` for local repo
  init — deterministic and local.
- **NUL discipline honored in the report.** `application.mjs` carries 3 literal NUL bytes; all
  manual inspection above used `grep -an` / `sed -n`. The suite itself reads sources with
  `readFileSync(..., 'utf8')` + string scanning (NUL-tolerant), so the 3-NUL files are read
  faithfully, not through binary-blind `grep`.
- **No order-dependence.** Each test constructs its own harness; no cross-test state.

**Verdict: SOUND** — no real timers, no host state, no `/tmp`-escape.

## 2. Axis 1 — green-side blockers: SOUND (every red row CAN go green under a correct v1.1 impl)

I drove the fixtures the RED rows depend on and confirmed each seam a correct v1.1
implementation needs is reachable at HEAD:

- **R1 (forged verdict, no referent → typed refusal).** The workflow harness produces a real
  verified Candidate (`candidateFor(workflow, 'builder')` resolves with `evidence.verification.worker`).
  D1 slots at the verified-Candidate step (`application.mjs:6733-6745`: `_isWorkflowRun` `:6733`,
  candidate lookup `:6740`, `assertWorkflowFeedbackAnchors` `:6745`). `assertWorkflowFeedbackAnchors`
  short-circuits on `feedback.gate !== undefined` (`:1685`), so the gate-shaped payload clears
  path-anchoring and reaches the referent step — the D1 `debugGateRefusal(events)` over the
  candidate-scoped (run+task) event set returns `null` (no gate event), refusing
  `application_workflow_feedback_gate_unbound`. `assertWorkflowFeedbackAnchors` is verified at
  `:1683`, gate short-circuit at `:1685`. Green-side mintable.
- **R2 (validated-or-replaced, derived:true + seq-bound).** Verified live: the preconditions
  PASS at HEAD — `emitScopeGateEvent` through the `EmittableAdapter` writes a durable per-worker
  `error {code:'worker_path_scope_violation', phase:'trust_gate', pathScopeEvidence}` event with
  the runId/taskId stamped on the Candidate's stream; `readWorkerGateSeq` (test:348-357) reads it
  back from `<deploymentRoot>/state/<workerId>.jsonl` with a positive `seq`; the `run.debug`
  failure leg projects the exact `{gate:'scope', detail:{digests, counts}}` referent
  (`debugGateRefusal`, `application.mjs:993-1010`; scope project at `:949-990`). A correct D1
  mints the derived `{gate, detail}` with `derived:true` and `gateEventSeq` = the source event's
  per-worker `seq` (the #79 `gate:${event.seq}` binding precedent,
  `worker-delivery-push-contract.md:294`), and replaces a mismatched submission. The read-back
  integrity (`application.mjs:6389` `digest(normalized) !== digest(core.feedback)`, extended per
  D3/B4) re-projects the bound event. Green-side mintable.
- **R3 (coaching derived:false / null).** The coaching branch is the real normalization
  (`normalizeWorkflowFeedback`, `application.mjs:1645-1652` dispatch; coaching `:1651-1682`),
  already exercised by the suite's own P6; D3 adds `derived:false` + `gateEventSeq:null` at the
  record. Green-side mintable.
- **R4 (select/revise no crash).** The B3 fold is the exact seam: `_workflowRevisionFeedbackRows`
  (`:6789-6807`) must carry `derived` through; `workflow-revision.mjs` must accept `derived` on
  the packet (`:120` exact set) and a gate-shaped `feedbackBody` (`:59-77`); `_workflowRevisionEligibility`
  must skip `.findings.some` on `derived:true` packets (`:6860`); `renderWorkflowRevisionObjective`
  (`:1780-1795`, `:1781`, `:1789`) must branch. All are seams a correct impl can reach — R4
  drives `select` and `revise` through the public facade against a real recorded verdict.
  Green-side mintable (the render-output half is unpinned — S3).
- **R5 (12-field closed literal).** A source-scan row; the amended literal replaces the 10-field
  set at `application.mjs:6360-6362` and the exact-set check at `:6380` follows. Green-side
  trivial.
- **R6 (pre-hardening excluded, itemCount 0).** Green under a correct v1.1 — but ONLY via the
  R1 refusal (nothing is stored), which is the M1 gap; the honest per-record exclusion of a
  PERSISTED legacy record is a different path that no fixture stages. See M1.

**Verdict: SOUND** — no green-side blocker; the G2 shape-boundary fixtures drive `run.feedback`
through the real normalization and reach the admission seam (R2's precondition literally passes
at HEAD).

## 3. Axis 2 — shallow-greenability: NEEDS-FOLD

The refuse-outright attack is dead: **R2** requires the stored packet to exist with
`derived:true` and `gateEventSeq === gateSeq` (test:581-593), so an impl that refuses every
gate-shaped submission fails R2 at `expect_derived_record` (no packet to read back). The
candidate-vs-worker identity is pinned: **P2** binds the referent keys to
`candidate.evidence.verification.worker`/`.workerSeq` (`application.mjs:6247-6248`,
`evidenceCore.verification` `:6264-6267`) and **R2** requires the gate event to be on THAT
worker's stream. What remains unpinned:

### S1 (HIGH) — the candidate-scoped `runId`+`taskId` referent boundary is never exercised: cross-run laundering greens the suite

- **Row/gap.** D1's referent is candidate-scoped by construction: the projection filters
  `event.runId === current.goal.runId && event.taskId === candidate.taskId` (the `_debugMember`
  scope, `application.mjs:11303-11308`), and the contract calls out that "a REAL gate event on a
  DIFFERENT run/worker is never a referent — cross-run verdict laundering is blocked by
  construction." Every workflow row runs in a SINGLE fresh deployment with a single workflow:
  there is exactly one gate event total in R2/R4, and it is always on the right worker's stream.
  **No row drives a second run (or a second task) whose stream carries a gate event that must NOT
  be the referent.**
- **Attack.** A wrong implementation that resolves the referent from a **worker-wide** scan
  (drop the `runId`+`taskId` filter: `driver.log.read(workerId)` unfiltered) — or a run-wide
  `debugGateRefusal(events)` reuse (the `run.debug` caller shape, `application.mjs:11325`) —
  mints the derived payload from a gate event on a DIFFERENT run/task of the same worker, and
  greens R1 (empty deployment → nothing found → refuse), R2, and R4 (the only event present is
  the right one). The cross-run laundering the contract says is "blocked by construction" is
  unobserved by the suite.
- **Fix.** Add a second-run isolation row in the workflow harness: after R2's flow (run R1
  records a verdict bound to worker W's gate event), open a SECOND workflow on the SAME
  deployment whose builder's task stream has NO gate event, and submit the gate-shaped payload
  for it. Correct D1 refuses `application_workflow_feedback_gate_unbound` (no referent on that
  candidate's own run+task stream). Two arms:
  1. **Different-worker arm** — R2's builder uses a different worker: a run-any/worker-any scan
     finds R1's event and mints, failing the refusal assertion. Pins the `runId` filter.
  2. **Same-worker arm** — R2's builder is the same workerId as R1's: a worker-wide
     (taskId-ignoring) scan finds R1's event and mints, failing the refusal assertion. Pins the
     `taskId` filter. (The fixture must reuse the worker identity across the two workflows; if
     the openBaton harness cannot, note it as a harness constraint and land arm 1, which still
     kills the run-wide/worker-any class.)
  Both arms assert the submission is REFUSED and that no record is appended (`itemCount 0`).

### S2 (MEDIUM) — the `SECRET_SHAPED_TEXT` guard on the coaching branch is asserted nowhere

- **Row/gap.** The coaching normalization is `SECRET_SHAPED_TEXT`-guarded: a secret-shaped
  `summary` or finding `message` refuses `application_workflow_feedback_invalid`
  (`application.mjs:1658` summary, `:1668` message; the literal at `:327-331`). The suite's
  coaching rows (P6, R3) send benign prose only. No row in this suite — and none of the
  `sendFeedback`-driving suites (phase79/phase80/phase80-revision-restart-stop, grep-verified)
  — submits a secret-shaped coaching payload through `run.feedback` and asserts the refusal.
  The #73 hardening is contractually allowed to touch the coaching branch (D3 adds
  `derived:false` + `gateEventSeq:null` to coaching records), which is exactly the branch an
  implementer could weaken.
- **Attack.** An impl that removes or relaxes the coaching-branch `SECRET_SHAPED_TEXT` check
  (while keeping the rest of the shape validation) passes all 13 rows. A secret-shaped coaching
  payload would then be durably recorded.
- **Fix.** Add a row that submits `{summary: 'sk-proj-…', findings: [...]}` (a shape that is
  otherwise schema-valid, 1..32 findings, closed kinds/severities) through `workflow.sendFeedback`
  and asserts the typed `application_workflow_feedback_invalid` refusal and that nothing is
  appended. Include the `summary` arm and a finding-`message` arm; the guard must fire on both
  (`:1658`, `:1668`).

### S3 (MEDIUM) — GREEN-4's render half is unpinned: R4 pins no-crash, never the verdict line or the non-undefined summary

- **Row/gap.** GREEN-4's letter is two-parted: no-crash AND `renderWorkflowRevisionObjective`
  renders a `derived:true` packet as a distinct verdict line (`:1780-1795`, `:1781`, `:1789`) AND
  the `feedback` section renders a non-`undefined` summary (`:10578` `summary: packet.feedback.summary`).
  R4 (test:647-678) asserts only `selected.ok === true` and `revised.ok === true` — no-crash. It
  never reads `workflow.feedback()` to assert the section summary, and never inspects the
  rendered revision objective for a verdict line. The draft notes even name the render
  requirement in R4's checklist ("the feedback section renders a non-undefined summary") — the
  test does not assert it.
- **Attack.** An impl that fixes only the eligibility crash (optional chaining on
  `packet.feedback.findings?.some`) and leaves the renders broken — emitting `Feedback: undefined`
  in the revision objective and `summary: undefined` in the feedback section for verdict packets —
  greens R4. The "distinct verdict line" branch (OQ2's pin: "a distinct verdict line, not the
  prose") is entirely unobserved.
- **Fix.** Extend R4 (or add a sibling row): after the successful `select`/`revise`, assert
  (a) `workflow.feedback()` section item for the verdict packet carries a non-`undefined`
  `summary` (and no `'undefined'` string anywhere in the rendered feedback section), and
  (b) the revision objective rendered during `revise` contains a distinct verdict line for the
  `derived:true` packet — e.g. the objective text contains the gate (`'scope'`) or a verdict
  marker, and never the literal `Feedback: undefined`.

**Verdict: NEEDS-FOLD** — refuse-outright and candidate-vs-worker identity are pinned, but S1
(load-bearing for the contract's headline laundering claim), S2, and S3 each admit a plausible
wrong implementation that greens the suite.

## 4. Axis 3 — missing rows: NEEDS-FOLD

### M1 (HIGH) — B5's per-record degradation + migration step is NOT behaviorally pinned; R6 reduces to R1 after hardening

- **Row/gap.** B5's letter: a packet that fails the extended D3 check (a pre-hardening record,
  or a packet whose bound event is absent) is EXCLUDED **per-record** from the read projection,
  never a map-wide `application_workflow_integrity` throw; and a deployment/migration step "must
  name which" of re-derive-and-mark vs exclude it applies to pre-hardening coaching records. R6
  (test:690-713) forges a shape-only gate-shaped record via the public `workflow.sendFeedback`
  facade and asserts `itemCount 0`. After hardening this is satisfied by the R1 **refusal** — the
  submission is refused, nothing is stored, the read is empty. The per-record exclusion path (a
  record that EXISTS in the store and fails the extended check) is never reached, and the
  migration step is asserted nowhere. The draft notes concede the limitation ("R6 injection
  limitation … the openBaton deployment's driver is private (`#driver`,
  `application-deployment.mjs:1242`), and the raw-application harness cannot run workflows to
  completion, so `driver.coordination.recordDriver` injection is unavailable for staging a true
  pre-hardening record").
- **Attack.** A wrong implementation that (a) refuses gate-unbound submissions (satisfying R6's
  `itemCount 0`) but on read THROWS a map-wide `application_workflow_integrity` when a
  pre-hardening packet is present, or (b) has no migration step, greens every row — the
  per-record degradation and the migration are simply unobserved. R6's assertion is a
  near-duplicate of R1's post-refusal state (both: gate-shaped no-referent → `itemCount 0`; R1
  adds the typed code).
- **Fix.** Land a deployment seam that can stage a genuine pre-hardening record (e.g. expose a
  `recordDriver`-capable staging path on the deployment facade, or build the deployment from
  `createDriver` + a real workflow loop so `driver.coordination` is reachable), then add a row
  that (1) stages a legacy 10-field gate-shaped `application.workflow_feedback_recorded` record
  for the run (a shape the pre-hardening forge actually produced), (2) asserts the read EXCLUDES
  it per-record with `itemCount 0` and does NOT throw map-wide `application_workflow_integrity`,
  and (3) drives the migration step and asserts the store is left readable (the record either
  re-derived-and-marked `derived:false`/`gateEventSeq:null` or excluded — the row must pin WHICH,
  per B5's "at minimum the deployment step must name which"). The row must be RED at HEAD
  (the staged record surfaces, `itemCount ≥ 1`).

### M2 (HIGH) — B4's replay-stability is unpinned: no row emits a second gate event after recording

- **Row/gap.** B4 exists precisely because the task stream can GROW a later gate event after a
  verdict is recorded, and the read-back must re-project the BOUND event
  (`gateEventSeq`), not the `.at(-1)` latest projection (`feedback-forge-hardening-contract.md`
  §3 D3/B4; the drift would otherwise throw `application_workflow_integrity` on an honest
  record). R2 emits exactly ONE gate event; the read-back happens against the same single event.
  A `.at(-1)` implementation and a seq-bound implementation are indistinguishable on R2 — the
  latest IS the bound event.
- **Attack.** An impl that re-projects the latest gate event at read-back (B4 violation) greens
  every row: no fixture ever records a verdict and then emits a second gate event, so "latest"
  never diverges from "bound".
- **Fix.** Extend R2: after the record is verified (stage `expect_derived_record`), emit a SECOND
  `error {phase:'trust_gate', code:'worker_path_scope_violation'}` on the SAME worker with
  DIFFERENT digests (it lands at `seq N+1`), then assert `workflow.feedback()` still returns the
  ORIGINAL record byte-equal to the FIRST event's projection — `derived:true`, `gateEventSeq === N`,
  `feedback.gate === 'scope'` with the first event's digests. A `.at(-1)` impl re-projects event
  N+1, the D3 read-back check (`:6389`, extended) fails against the bound `gateEventSeq === N`,
  and the record is either excluded (B5) or throws — the assertion fails. This is the honest B4
  oracle; the read is already keyed to the durable store (`readWorkerGateSeq` proves the emit
  path is repeatable).

### M3 (LOW) — the NEW refusal code's source/facade surface constancy (D4) is unpinned

- **Row/gap.** P7 (source-scan) pins the four EXISTING refusal codes in `application.mjs` and
  deliberately omits `application_workflow_feedback_gate_unbound` (absent at HEAD). D4 names the
  MCP/web facade constancy explicitly (`mcp-northbound.mjs:206` `application_*` passthrough;
  `web-northbound.mjs:201-203` fallthrough). No row asserts the new code is (a) typed in
  `application.mjs`, or (b) forwarded unchanged through a northbound surface. R1 catches the
  code through the workflow facade (BatonRun → `application.command`, not through MCP/web).
- **Attack.** An impl that throws the new code from the workflow seam but breaks the web-northbound
  fallthrough (or un-types the code so it never surfaces verbatim through MCP/web) greens every
  row — R1 never exercises a northbound surface.
- **Fix.** Add a P7-style source-scan RED row for `application_workflow_feedback_gate_unbound`
  (typed in `application.mjs`), plus a facade passthrough assertion that the refusal
  `{code, message}` is preserved through `web-northbound.mjs` (and/or the MCP error mapper) —
  matching how `phase16-mcp-northbound.test.mjs` drives `fleet_run_feedback`.

**Sub-verdicts on the brief's specific axis-3 probes:**
- **One derived-flag model: SOUND.** R2 asserts BOTH verdict flags (`derived === true` AND
  `gateEventSeq === gateSeq`, test:583-592) and R3 asserts BOTH coaching flags (`derived === false`
  AND `gateEventSeq === null`, test:635-644); R5 pins both fields in the closed 12-field literal.
  At HEAD the `derived` assertion throws first and masks the second (both fields are absent), but
  the rows cannot go green without BOTH — a partial impl (derived only, or gateEventSeq only)
  fails the sibling assertion. Both pairings are pinned.
- **Migration pin (pre-hardening records replay honestly): NOT pinned** — M1 above. R6 is
  behavioral only; a true pre-hardening record cannot be staged today and the migration step is
  unpinned.

**Verdict: NEEDS-FOLD** — the one derived-flag model is SOUND, but B5 (M1), B4 (M2), and D4's
surface constancy for the new code (M3) each admit a plausible wrong implementation.

## 5. Per-pin verdicts (false-green hunt)

| Pin | Verdict | Evidence |
|---|---|---|
| P1 workflow-gate-discriminator | **SOUND** | `normalizeGateCauseFeedback` (`application.mjs:1594-1643`, closed `exactObject(['gate','detail'])` `:1597`) accepts the shape; the non-workflow run refuses at the workflow gate `application_workflow_feedback_unavailable` (`:6733-6735`) — never the shape code. Kills a shape-reject impl. |
| P2 referent-binding | **SOUND** | `candidate.evidence.verification` is `{worker, workerSeq, verdictDigest, changedPathsDigest}` (`:6264-6267`); worker/workerSeq at `:6247-6248`; `:6249` verifies the workerSeq resolves to the accepted `verify.reverified` event. The closed `_closedVerdictProjection` returned literal (`:10508-10532`) carries no `worker`. Kills a `candidate.verification`-bound impl. |
| P3 caller-derived-refused | **SOUND** | `exactObject(value, ['gate','detail'], 'application_workflow_feedback_invalid')` (`:1597`) refuses a caller `derived` key. Kills a schema-widening impl. |
| P4 debug-failure-shape | **SOUND** | The `run.debug` failure leg projects exactly `{kind, code, message, gate, detail:{digests, counts}}` (`debugGateRefusal` `:993-1010`); the fixture includes adversarial `offendingPaths` and asserts no path string leaks. |
| P5 push-derived-free | **SOUND** | The D6 push-contract text (`worker-delivery-push-contract.md` `### D6`) and the push red-suite `gate_verdict` literal carry no `derived`; `gate:${event.seq}` requestId keying (`:294`) verified. |
| P6 coaching-authored | **SOUND** | Coaching rides the real normalization (`:1651-1682`) and is read back intact through the feedback section — the authored `summary`/`findings` asserted verbatim. |
| P7 refusal-vocabulary-typed | **SOUND** | The four existing codes are typed in `application.mjs` (source-scan). Its deliberate omission of the NEW code is the M3 gap. |

**Net: 7/7 SOUND.** No vacuous or staged-wrong pin.

## 6. Deployment verification

```
Executable: "true" · Args: [] · Cwd: "." · Expected exit: 0
```

Verified at this HEAD: `true` in the worktree root → exit 0.

## 7. Closing verdict

**NEEDS-FOLD.** The suite's current red state is honest — 6/6 RED rows fail at their named
stages (confirmed at this HEAD), 7/7 PINs are sound, hermetic, deterministic, and every red
fixture is green-side mintable (axis 1 SOUND; axis 4 SOUND). But as a gate on the
implementation wave it is under-pinned exactly where the contract's two headline guarantees
live:

- **S1 (HIGH)** — the candidate-scoped `runId`+`taskId` referent boundary is never exercised,
  so the contract's "cross-run verdict laundering is blocked by construction" is a construction
  claim with no behavioral oracle.
- **M1 (HIGH)** — B5's per-record degradation + migration is unpinned; R6 post-hardening is the
  R1 refusal, never the exclude-a-persisted-legacy-record path.
- **M2 (HIGH)** — B4's seq-bound read-back (vs `.at(-1)` drift) is unpinned; a second gate event
  after recording is never staged.
- **S2 / S3 (MEDIUM)** — the coaching-branch `SECRET_SHAPED_TEXT` guard and GREEN-4's render
  half (distinct verdict line, non-undefined summary) are unasserted.
- **M3 (LOW)** — the new refusal code's source/facade surface constancy is unpinned.

Fold S1, M1, M2 before the implementation wave is held to this suite; S2, S3, and M3 close the
remaining seams.
