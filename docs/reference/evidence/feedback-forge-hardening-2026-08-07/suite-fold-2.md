# #73 suite-fold — blue-team NEEDS-FOLD folded into the feedback-forge-hardening red suite

Authority: `suite-blueteam.md` (NEEDS-FOLD — axis 1 SOUND; five load-bearing holes S1–S3, M1–M3)
via `suite-fold-2-brief.md`. Suite: `impl/test/feedback-forge-hardening-red.test.mjs` — folded
from **13 rows (7 PIN / 6 RED)** to **16 rows (8 PIN / 8 RED)**. Contract: `feedback-forge-hardening-contract.md`
v1.1 (no v1.2 movement required — every fold lands as a row in the EXISTING red-first suite;
no contract section needed amendment).

## The six findings → resolution

| Finding | Severity | Folded row | Stage(s) | RED/PIN at HEAD | What the fold pins |
|---|---|---|---|---|---|
| **S1** candidate-scoped `runId`+`taskId` referent boundary | HIGH | **R7** (new) — second-run isolation | `expect_second_run_refused` | RED (run-1 verdict records; run-2 same-shaped submission accepted at HEAD) | the contract's "cross-run verdict laundering is blocked by construction" becomes a behavioral law: a gate event on run-1's builder must NOT bind run-2's same-shaped submission — the refusal is the typed `application_workflow_feedback_gate_unbound` and nothing is appended |
| **M1** B5 per-record degradation + migration | HIGH | **R6** (rewritten) — staged genuine pre-hardening record | `expect_pre_hardening_record_excluded` | RED (the staged record surfaces: `itemCount 1`) | the per-record exclusion path is REACHED, not vacuous: a PERSISTED 10-field pre-hardening record (staged via the M1 seam) is excluded per-record while a later coaching record still projects; reading never throws map-wide `application_workflow_integrity` |
| **M2** B4 replay-stability | HIGH | **R2** (extended) — second gate event after recording | `expect_replay_stable` | RED (second gate event never staged at HEAD; the bound-vs-latest projection is indistinguishable) | a second `worker_path_scope_violation` event on the SAME worker (different digests, seq N+1) must NOT move the bound projection: read-back re-projects the FIRST event (`gateEventSeq === N`, first digests), never the `.at(-1)` latest |
| **S2** `SECRET_SHAPED_TEXT` guard on the coaching branch | MEDIUM | **P8** (new) — coaching-branch guard | — (PIN) | GREEN (the guard already exists at application.mjs:1665/:1675) | a secret-shaped coaching `summary` or finding `message` through `workflow.sendFeedback` refuses `application_workflow_feedback_invalid` and appends nothing — the guard must fire on BOTH arms |
| **S3** GREEN-4's render half | MEDIUM | **R4** (extended) — render assertions | `expect_render_verdict_summary`, `expect_render_verdict_line` | RED (R4 fails at `select_candidate_no_crash` first; the render half runs only post-hardening) | the feedback section renders a non-`undefined` verdict `summary` (no `'undefined'` literal in the section), and the revision objective carries a distinct verdict line (the gate `'scope'`), never `Feedback: undefined` |
| **M3** gate-unbound code surface constancy (D4) | LOW | **R8** (new) — source scan | `expect_gate_unbound_typed` | RED (the code is absent from application.mjs at HEAD) | `application_workflow_feedback_gate_unbound` is typed in application.mjs AND preserved verbatim through the web-northbound `application_*` fallthrough and the mcp-northbound error mapper |

## Before / after

```
BEFORE (13 rows):  tests 13 · pass 7 · fail 6   (P1–P7 green; R1–R6 red at named stages)
AFTER  (16 rows):  tests 16 · pass 8 · fail 8   (P1–P8 green; R1–R8 red at named stages)
```

Verified at HEAD (two consecutive runs from the repo root, both stable):

```
Run 1: 8 passed / 8 failed   (P1–P8 green; R1–R8 red)
Run 2: 8 passed / 8 failed   (P1–P8 green; R1–R8 red)
```

Every RED row still fails at its NAMED first stage; every PIN row is green at HEAD. The fold
adds rows and stages, it does not move any existing stage.

## The M1 seam (how a genuine pre-hardening record is staged)

The blue-team M1 gap: R6 post-hardening reduced to R1's refusal — nothing was ever stored, so the
per-record exclusion path was never reached. The blocker was the openBaton deployment's private
`#driver` (`application-deployment.mjs`), which made `driver.coordination.recordDriver` injection
unavailable.

The seam: `openBatonDeployment(rawOptions, createDriver)` (application-deployment.mjs:1719)
accepts the driver factory as parameter 2; `openBaton(options)` is just
`openBatonDeployment(options, createDriver)` (index.mjs:50-52). Passing a wrapper
`(driverOpts) => { const d = createDriver(driverOpts); captured = d; return d; }` captures the
driver WITHOUT touching the private `#driver` field, while the deployment still runs its resident
dispatch loop. `openWorkflow(t, { captureDriver: true })` lands this seam and returns `driver`.

R6 then stages a GENUINE pre-hardening record — the exact 10-field
`application.workflow_feedback_recorded` shape `sendWorkflowFeedback` writes at HEAD — via
`driver.coordination.recordDriver(KIND, {...core, feedbackDigest: digest(core)}, {actor, key})`,
where `core` = `{schemaVersion:1, repoId, runId, planDigest, definitionDigest, feedbackId,
source, target, feedback, prefix:{throughSeq, goalDigest, planDigest, definitionDigest}}`. All
inputs are derivable: `runId` from `workflow.id`, `goalDigest` from the `goal.version_defined`
event, `feedbackId`/`target.treeIdentityDigest` from the local canonical `digest()` helper. The
staged record SURFACES at HEAD (`itemCount 1`) — the RED seam is confirmed, so the migration code
path will be REACHED under a correct v1.1 implementation, not vacuous.

## Per-finding seam notes

- **S1 — harness constraint respected.** Per the blue-team brief, the same-worker arm requires
  reusing a worker identity across two workflows; the openBaton harness derives worker IDs per
  task (run-unique), so the fold lands **arm 1** (different-worker): run-2's builder stream has
  NO gate event on its own run — a run-any/worker-any scan that borrowed run-1's gate would mint
  and fail the refusal assertion. The precondition asserts the run-2 builder stream has zero gate
  events (`event.runId === w2.id && event.taskId === taskId2`), and run-1's bound verdict is
  asserted to exist first — so the refusal is a scoping fact, not a void.
- **S3 — ordered stages.** The render-half assertions run only after the earlier
  `select_candidate_no_crash` stage is green; at HEAD the row fails at `select_candidate_no_crash`
  (the `packet.feedback.findings.some` TypeError) before the render half is reached. The fold's
  red-keeping power is in the combined row: no-crash AND render.
- **M3 — facade assertions are PINs.** `application_workflow_feedback_gate_unbound` is absent
  from every surface at HEAD, so the source-typing assertion is the RED seam; the web/mcp
  fallthrough assertions (web-northbound.mjs:206-209, mcp-northbound.mjs:206) are already true at
  HEAD and pin the preservation mechanism the new code must ride.

## Suite-law hygiene (unchanged, re-verified)

- **Red-first at named stages**: 8 RED rows / 8 PIN rows; each RED row's first failing assertion
  is the named-stage failure (stage strings live in the header row inventory AND in each row's
  assertion message).
- **Hermetic**: every deployment is a `mkdtempSync` repo + `mkdtempSync` deployment root torn down
  by `t.after`; adapters are MockAdapter subclasses; verification is `command: 'true'`; no network,
  no real provider spawns.
- **No clocks as controls**: no `setTimeout`/wall-clock/timeout logic; workflow progress is driven
  by openBaton's resident dispatch loop.
- **NUL discipline**: sources read with `readFileSync(..., 'utf8')` + string scanning only.
- **Sorted-key literals ACTUAL order**: the B2 12-field closed literal and every key set are
  asserted against frozen constants in actual sorted order; no `localeCompare`.
- **`watchdog.stallMs` valid-positive** in every fixture; `stallAction` only from the contract
  vocabulary.
- **Namespace discipline**: no invented imports — the M1 seam uses the real
  `openBatonDeployment` export and the real `createDriver`; the invented surfaces
  (`application_workflow_feedback_gate_unbound`, `derived`/`gateEventSeq`) are probed through real
  entry points and string literals only.
