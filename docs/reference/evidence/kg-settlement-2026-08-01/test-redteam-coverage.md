# KG settlement red-first suite — red-team: COVERAGE MAP (2026-08-01)

**Attacker role:** `coverage-mapper` (attempt `94c2086e-f1dc-456d-a455-86334583a4cb`).
**Target:** `impl/test/kg-settlement-red.test.mjs` (KS1–KS10, 17 red rows + 1 green pin).
**Contract:** `docs/reference/evidence/kg-settlement-2026-08-01/kg-settlement-decisions.md` v1.0 (post-fold),
plus `redteam-authority.md` and `redteam-lifecycle.md` (the two v0.9 verdicts every amendment folds in).
**Method:** map **every** v1.0 decision point (D1–D5, incl. the authority/lifecycle amendment sub-points) to the
row(s) that would force it red against a partial implementation; classify MISSING-ROW / WEAK-ROW / COVERED.
**Grounding:** every claim is `file:line` against the current worktree.

## Verdict summary

| # | Finding | Verdict |
|---|---------|---------|
| C1 | `_activeRunOrchestratorLease` codes: 3 of 7 asserted; `run_orchestrator_lease_revoked` (named in the acceptance) untested | MISSING-ROW |
| C2 | D1 id/runId pin is never enforced by a row (fixture passes the pinned values in) | MISSING-ROW |
| C3 | `knowledge.settlement_lease`: server-side session derivation, return shape, command→promote end-to-end all unasserted | MISSING-ROW |
| C4 | `scratchpad.elevate` / `scratchpad.settle`: command-level mapping has no behavioral row (KS3 is presence-only) | MISSING-ROW |
| C5 | D3 sweep: reason `review_window_expired` unasserted; driver-triggered path untested | WEAK-ROW |
| C6 | D3 title derivation (120B, control-stripped) has no row | MISSING-ROW |
| C7 | D3 receipt: `settlement.errors`, outline surfacing, refusal-never-aborts-close unasserted | WEAK-ROW |
| C8 | KS9 MCP half is vacuous (MCP tools are registry-derived, not source strings); CLI + recursive gates unasserted | WEAK-ROW |
| C9 | `link` kind never exercised anywhere | MISSING-ROW |
| C10 | resumable-teardown partial-state windows (crash between admit/revoke/complete) untested | WEAK-ROW |
| C11 | D3.1 default-on masked by test helper; D5 no-auto-admission unasserted | WEAK-ROW |
| C12 | `_assertRunAdmissionOpen` (run_stopping) admission path has no row | MISSING-ROW |

**Net:** 7 decision points with NO row, 5 rows too weak to fail under a partial implementation, and 1 green pin
(KS9) that is half-vacuous. The suite's spine (D1 API existence, D2 dispatch, D2.7 typed codes ×3, KS7 composite,
D4 note+plan lanes, KS10 framing) is soundly red for the right reasons; the load-bearing *security* properties of
v1.0 — the D1 id pin, the D2.6 server-side session derivation, the revoked-lease admission code, the sweep reason,
the structural surface gate — are exactly the points with the weakest or no coverage.

## Method & scope

Read the suite (`kg-settlement-red.test.mjs`, KS1–KS10), the v1.0 contract, both red-team reports, and the
`impl/src/` primitives the contract amends: `coordination-store.mjs` (`_activeRunOrchestratorLease` :1670–1686,
`admitWorkflowFinding` :14539–14572, `issueRunOrchestratorLease` :1770, `_assertRunAdmissionOpen` :7234,
`runOrchestrationView` :11253, `boardSnapshot` :13838), `run-lineage.mjs` (capabilities :14–16, revocation
reasons :18–20), `application-semantics.mjs` (the four registry rows :1436–1487), `application.mjs`
(`authorizeReplay` recursive gate :3110–3123), `mcp-northbound.mjs` (registry-derived tool table :69–73, :663),
and `wave-driver.mjs` (`freezePolicy` :69–117, settle window :669–676). Every row was classified twice: (a) does
it exist, and (b) could a partial implementation that satisfies the contract's *outcome* but not its *mechanism*
still pass it. Suite state at review: 17 red / 1 green (KS9), exit 1 — confirmed red for the right reasons.

Row-to-test index (all in `impl/test/kg-settlement-red.test.mjs`):

| Row | Test |
|-----|------|
| KS1.1 | createAndClaimSettlementTask mints the atomic pair with a hub-fixed brief (:121) |
| KS1.2 | the API refuses caller-authored brief content and non-orchestrator actors (:137) |
| KS1.3 | plan-mandatory is bypassed and replay is exactly-once (:149) |
| KS2.1 | expired lease refused `run_orchestrator_lease_expired` (:168) |
| KS2.2 | non-working parent refused `run_orchestrator_parent_inactive` (:178) |
| KS2.3 | foreign session refused `run_orchestrator_session_mismatch` (:185) |
| KS2.4 | acquiring session admits (control) (:193) |
| KS3.1 | application.command knows the four settlement commands (:206) |
| KS3.2 | knowledge.promote registry row names `admitWorkflowFinding` (:217) |
| KS4.1 | kg-ritual wave elevates note+plan, candidacies notes w/ full text, surfaces receipt block (:227) |
| KS4.2 | settlement:none performs zero ritual writes (:257) |
| KS4.3 | empty partition is honest-empty with the ritual ON (:267) |
| KS5.1 | re-drive mints no duplicate lease/items/elevations (:278) |
| KS6.1 | sweep revokes expired un-admitted lease w/ `review_window_expired` (:296) |
| KS7.1 | knowledge.promote admits, revokes, completes, replays exactly (:314) |
| KS8.1 | doubt+link never elevated; plan never candidates (:362) |
| KS9.1 | four commands stay out of MCP and the recursive allowlists (:379) — **green pin** |
| KS10.1 | board reads frame worker-authored titles UNTRUSTED (:392) |

## D1 — Store: one dedicated atomic settlement-task API

| DP | v1.0 decision point (source) | Row | Verdict | Why |
|----|------------------------------|-----|---------|-----|
| D1.1 | API exists on the coordination store | KS1.1 (`typeof … === 'function'`) | COVERED | |
| D1.2 | atomic pair: one `task.created`+`task.claimed` batch | KS1.1 (`status 'working'`, `result 'claimed'`) | **WEAK-ROW** | Post-conditions only; a two-step create-then-claim implementation (two batches, externally visible intermediate `pending` task) passes. To force atomicity the row must assert a single batch (e.g. one event/batch, or no observable `task.pending` state between). |
| D1.3 | relation `'settlement'` | KS1.1 (`relation === 'settlement'`) | COVERED | |
| D1.4 | brief capabilities exactly `['baton_orchestrator']` | KS1.1 (`deepEqual`) | COVERED | |
| D1.5 | orchestrator actor only | KS1.2 (`actor 'worker'` → `settlement_task_invalid`) | COVERED* | *Only the `'worker'` label is tried. `promotionActor` elsewhere admits `'operator:*'`; the D1 gate must refuse those too. Low priority — add `auth(key, 'operator:someone')` to the refusal row. |
| D1.6 | bypasses plan-mandatory exactly as recovery refinements | KS1.3 (store under `goalPlanPolicy(true)` succeeds) | COVERED* | *Outcome-level. A bypass that also applies to non-settlement relations passes, but the API is new and scoped, so acceptable. |
| D1.7 | hub-fixed objective: caller supplies NO objective; constant templates only authority-less identifiers | KS1.1 (`objective.includes(WAVE_ID)`), KS1.2 (caller objective refused) | **WEAK-ROW** | Both halves are asserted, but the *constant* half is loose: `.includes(WAVE_ID)` passes for any objective that merely contains the wave id (e.g. caller-derived prose with the wave id spliced in). Assert the full template (`settlement task for wave ${waveId}`) or at least that no caller field survives into the brief. |
| D1.8 | closed fields `{id, runId, reservedWorkerId}`; `id` PINNED `settlement-task:<waveId>`, `runId` PINNED `run-settlement:<waveId>` | KS1.1 (passes the already-pinned constants in) | **MISSING-ROW** | No row ever hands the API a **non**-pinned `id`/`runId` and expects refusal. KS1.1 *supplies* `SETTLEMENT_TASK_ID`/`SETTLEMENT_RUN_ID` (both derived from `WAVE_ID`), so an implementation that accepts any caller `id`/`runId` passes every row. The pin is the load-bearing half of "stable lease identity across re-drive" (lifecycle A5.2) and it is never enforced. |
| D1.9 | idempotency by caller key, replay-exact | KS1.3 (same key+same fields → `'idempotent'`, `event.seq` equal) | **WEAK-ROW** | Only same-key-same-fields is tested. "Replay-exact" also implies same-key-**different**-fields must conflict (`_appendBatch` rejects dup keys; `issueRunOrchestratorLease` rejects `requestDigest` mismatch :1773–1777). A replay-anything implementation passes. Add a same-key-different-runId conflict row. |

## D2 — Application: four settlement commands

| DP | v1.0 decision point (source) | Row | Verdict | Why |
|----|------------------------------|-----|---------|-----|
| D2.1 | four commands wired through `application.command` | KS3.1 (code ≠ `application_command_unavailable`) | **WEAK-ROW** | Presence-only. The assertion excludes exactly one error code; a command that dispatches to the wrong method, or throws any *other* code (validation, missing args), passes. Also `serverDerived: ['actor']` / orchestrator actor is never asserted — no row inspects the store event's `actor` after a command. |
| D2.2 | `scratchpad.elevate` → `coordinator.elevateTaskScratchpad(taskId, entryIds)` | — (KS4 goes through the *driver*, KS3 is presence-only) | **MISSING-ROW** | No row calls `application.command('scratchpad.elevate', …)` with real args and asserts elevation behavior. The registry row's `liveMethod` is already correct (`elevateTaskScratchpad`, application-semantics.mjs:1445), so a partial implementation could leave the command a stub that returns an outline and KS4 would still fail — but *only* because the driver path needs it. If an implementation wired the driver directly to the coordinator (skipping the command layer), the suite could not tell. |
| D2.3 | `scratchpad.settle` → `coordinator.settleWorkflowScratchpad(runId, {expectedScratchpadFence, skips})` | — | **MISSING-ROW** | Zero coverage. D3 deliberately REMOVED the settle-at-close, so nothing in the suite ever exercises `scratchpad.settle` behaviorally. A command that returns `{ok:true}` and does nothing passes KS3.1. The command must exist and dispatch per D2 — a row must invoke it against a settled shared partition and assert disposal/expiry. |
| D2.4 | `knowledge.promote` = admit + independently-idempotent teardown (revoke-if-not-revoked, complete-if-not-completed) | KS7.1 (full path + full replay) | **WEAK-ROW** | The happy path and the *fully-complete* replay are covered. The amendment's core — "each step checks state and no-ops independently, so a crash anywhere is resolved by re-issuing the SAME command" (authority §4) — is only covered in the trivial case. No row constructs a partial state (admit done / lease active / task working; or admit+revoke done / task working) and re-issues the command. |
| D2.5 | `knowledge.promote` registry row `liveMethod` → `admitWorkflowFinding` | KS3.2 (source slice) | COVERED | Source-text assertion, precise to the row slice. |
| D2.6 | NEW `knowledge.settlement_lease`: materializes run+task+lease; **session derived server-side from the CALLING PRINCIPAL**; returns `{runId, taskId, lease:{id,digest,issuedEvent}}`; idempotent per waveId | KS4.1 (lease active), KS5.1 (lease identity stable) | **MISSING-ROW** | The **session-derivation** half is never asserted: no row reads the issued lease's `session.principalId/sessionId` and checks it equals the calling principal. A partial implementation that takes a caller-supplied session (the bearer-credential hole authority §2 closed) passes every row. The **return shape** is never asserted: no row calls the command directly and consumes `{runId, taskId, lease}`. The **end-to-end** "coordinates feed knowledge.promote directly" (acceptance) is untested: KS7 hand-builds its lease from `issueRunOrchestratorLease`; KS4 never promotes. |
| D2.7 | admission routes through `_activeRunOrchestratorLease` semantics: expiry / parent-liveness / `_assertRunAdmissionOpen` / session binding | KS2.1/2.2/2.3/2.4 | **WEAK-ROW** | 3 of the gate's codes are asserted (expired, parent_inactive, session_mismatch — each correctly targeted per the check order :1670–1686). Missing: `run_orchestrator_lease_revoked` (named in the acceptance), `run_orchestrator_lease_not_found`, `run_orchestrator_parent_stale`, and the `_assertRunAdmissionOpen` (`run_stopping`) path. See refusal-code section. |
| D2.8 | v1 surface honesty: structural embedded-only gate — MCP tool table + CLI command map do not contain the four; not in the recursive-dispatch gate or `RUN_ORCHESTRATOR_CAPABILITIES` | KS9.1 | **WEAK-ROW** | The MCP half is **vacuous**: MCP tool names are derived at runtime (`deriveSurfaceNames` → `baton_<snake>`, application-semantics.mjs:1776) and the tool table is registry-filtered (`mcp-northbound.mjs:69–73`, `:663`), so the four names never appear in `mcp-northbound.mjs` source even after a partial implementation flips `surfaces` to `['embedded','mcp']`. KS9 greps source strings — it pins nothing about the real surface. `RUN_ORCHESTRATOR_CAPABILITIES` is asserted (sound; the recursive gate at application.mjs:3119–3123 is capability-backed). The CLI command map (registry-derived via `surfaces.includes('cli')`, application-cli.mjs:842) is unasserted. |

## D3 — Wave driver: the settle-window hook

| DP | v1.0 decision point (source) | Row | Verdict | Why |
|----|------------------------------|-----|---------|-----|
| D3.1 | policy field `settlement: 'kg-ritual'\|'none'`, **default `'kg-ritual'`** | KS4.1/4.2/4.3 | **WEAK-ROW** | The helper `ritualWave` *always* passes an explicit `settlement` (`driverPolicy.settlement ?? 'kg-ritual'`, test :501), so the implementation default is never exercised. A driver that defaults to `'none'` passes every row. Add a row (or drop the `??` in the helper) that drives a wave with NO settlement field and asserts the ritual runs. |
| D3.2 | sweep step 0: revoke expired leases past TTL with **`review_window_expired`** (added to `RUN_ORCHESTRATOR_REVOCATION_REASONS`), cancel tasks, retire candidates, expire facts; ≤16/sweep; idempotent | KS6.1 | **WEAK-ROW** | KS6 asserts `swept.revoked >= 1`, `leaseStates.revoked === 1`, task cancelled, item retired — but never the **reason**. A partial implementation revoking with `'operator'` or `'parent_terminal'` passes. The `review_window_expired` revocation reason (lifecycle A2, the contract's own name for the reaper) is asserted nowhere, and `RUN_ORCHESTRATOR_REVOCATION_REASONS` is not pinned. **Driver-triggered** is untested: KS6 calls `store.sweepSettlementLeases?.(…)` directly; no wave is driven with a stale prior lease. The ≤16 bound and idempotency (sweep twice) are unasserted. |
| D3.3 | per member: `recordDriver('steering.registered', {runId})` idempotent | — | **MISSING-ROW** | No row asserts a `steering.registered` event exists after the hook. |
| D3.4 | per member with **store-terminal** task (re-read, not the driver's `claimed` flag) + non-empty partition: elevate selecting exactly note+plan; `scratchpad_settlement_not_ready` **recorded, never dropped** | KS4.1/KS8.1 (selection outcome) | **WEAK-ROW** | Selection outcome is covered. The store-status re-read is untested (no row distinguishes a store-terminal vs driver-claimed member), and no row forces the `scratchpad_settlement_not_ready` refusal path to prove it lands in `settlement.errors` and does not abort close (lifecycle A1 minor). |
| D3.5 | if ANY member elevated ≥1 note: `knowledge.settlement_lease` once per wave | KS4.1 (active), KS4.3 (empty → none), KS5.1 (stable count) | COVERED | |
| D3.6a | per elevated note ONE item on `wave-settlement:<waveId>`; **idempotencyKey pinned `board.candidacy:<waveId>:<sharedEntryId>`** (authority §5) | KS5.1 (re-drive dedups, stable lease count) | **WEAK-ROW** | KS5 re-drives the SAME writes in the SAME order, so any stable key (position-based, constant, digest-of-count) passes. The pin exists to survive a re-drive that recomputes selection order. Force it: re-drive with a different write ORDER and assert item count holds; or assert the posted event's idempotencyKey equals `board.candidacy:<waveId>:<sharedEntryId>`. |
| D3.6b | title = note's first 120 bytes, **control characters stripped** (authority §3) | — | **MISSING-ROW** | No row asserts the title at all. KS4 asserts `state`/`detail`; KS10 asserts `frame`. A worker-injection title (the authority §3 hole) is not exercised. |
| D3.6c | detail = note's FULL text bounded to the store detail cap (lifecycle XC) | KS4.1 (`detail.includes(full note text)`) | COVERED* | *Full-text is asserted; over-cap truncation to the detail cap is not (no over-cap note written). Low priority. |
| D3.6d | candidacy note-only (doubts/plans never candidate) | KS4.1 (one item), KS4.1 (plan no fact), KS8.1 | COVERED | |
| D3.7 | receipt + terminal **outlines** gain `knowledge.candidatesAwaitingAdmission` (0 as 0), `knowledge.settlementRunId` when lease materialized, `settlement.errors` bounded ≤8 `{member, step, code}`; typed refusal never aborts close | KS4.1 (receipt count + runId), KS4.2/4.3 (0 as 0) | **WEAK-ROW** | Receipt surfacing is covered. The **outline** surfacing (acceptance: "counts in receipt + outlines") is unasserted. `settlement.errors` shape/bound and the never-aborts-close property have no row (nothing forces a typed refusal through the hook). |
| D3.8 | **no shared settle at close** (XC); facts stay live through the review window; sweep expires them after TTL | KS4.1 (shared entries survive the wave) | **WEAK-ROW** | KS4 implicitly forces no-settle-at-close (the shared entries must still exist post-wave). But the live-facts half is unasserted: no row queries the elevated note's scratch fact after the wave (only the shared *entry*), and no row asserts the sweep expires those facts. |
| D3.9 | cross-wave growth bound: one item per note; sweep's candidate retirement is the bound | KS6.1 (retirement), KS4.1/KS8.1 (one item) | COVERED | |
| D3.10 | real pre-stop invariant (XA): ritual runs while partitions are live; runs stop AFTER all of it | KS4.1 (implicitly: a post-stop ritual finds empty partitions) | **WEAK-ROW** | The "runs stopped after all of it" acceptance clause is never asserted (no member run-status assertion after the wave). KS4 would catch a *wrong-order* implementation (partitions reaped → elevation empty → shared kinds empty), so the ordering is indirectly pinned — but the acceptance's explicit run-status clause has no row. |

## D4 — Elevation selection rule v1

| DP | v1.0 decision point (source) | Row | Verdict | Why |
|----|------------------------------|-----|---------|-----|
| D4.1 | elevate `note` + `plan` | KS4.1 (`kinds` deep-equal `['note','plan']`) | COVERED | |
| D4.2 | skip `doubt` + `link`; **`orchestrator_skipped` dispositions receipted** | KS4.1 (doubt absent), KS8.1 (doubts never elevate) | **WEAK-ROW** | Absence from shared is asserted, but the disposition *events* are not. A partial implementation that silently drops doubts (no `orchestrator_skipped` ledger entry) passes KS4.1/KS8.1. |
| D4.3 | notes carry observations: scratch-fact + candidacy | KS4.1 (plan has NO fact) | **WEAK-ROW** | The note's `scratchFactId` being **non-null** is never asserted — only the plan's null. A partial implementation that elevates notes without minting facts passes KS4.1. |
| D4.4 | plans → non-candidacy method lane (shared entry, no fact, no board item, no Finding) | KS4.1 (plan no fact; one item), KS8.1 (plan never candidates) | COVERED | |
| D4.5 | doubts NOT elevated in v1; doubt review path filed at acceptance | KS8.1 | COVERED (behavior) | The "filed at acceptance" follow-up is an action, not a test — verify an issue exists at acceptance time. |
| D4.6 | links remain skipped | — | **MISSING-ROW** | The `link` scratchpad kind is never written by any fixture (grep: no `kind: 'link'` in the suite). |

## D5 — non-goals → row map

| DP | v1.0 decision point | Row | Verdict | Why |
|----|---------------------|-----|---------|-----|
| D5.1 | **no auto-admission anywhere**; admission is D2's explicit command only | — | **MISSING-ROW** | No row asserts that after a full kg-ritual wave with NO `knowledge.promote` call, zero knowledge nodes carry `promotion.trigger === 'workflow.admitted'`. KS4.1 asserts `candidatesAwaitingAdmission === 1` (implying not admitted), but an implementation that auto-admits AND reports a stale count passes. The strongest guard is an explicit node scan. |
| D5.2 | no nested/`sessionAuthority`-context dispatch (v1 top-level only) | KS9.1 (`RUN_ORCHESTRATOR_CAPABILITIES` unchanged) | COVERED | The recursive gate (application.mjs:3119–3123) is capability-backed; pinning the capability list pins the gate. |
| D5.3 | no worker-facing read port, no REPL/context changes, no MCP/CLI enablement | KS9.1 (MCP half) | **WEAK-ROW** | MCP half vacuous (see D2.8); CLI half unasserted. |
| D5.4 | no change to `promoteKnowledgeBatch` | — | **MISSING-ROW** | No row pins the untouched causal path. A partial implementation that reroutes `promoteKnowledgeBatch` through the new admission path passes. Low priority — hard to assert "no change" without an oracle; a light pin (the batch path still promotes without a lease) suffices. |
| D5.5 | no trust-gate changes (#64 its own issue) | — | n/a | Out of suite scope; not a settlement-surface decision. |
| D5.6 | no doubt review path (follow-up) | KS8.1 | COVERED (behavior) | No elevation is the surface the suite can pin. |
| D5.7 | no session binding beyond `_activeRunOrchestratorLease` semantics | — | n/a | Negative, untestable; covered by D2.7's typed-code rows. |

## Refusal-code precision (`_activeRunOrchestratorLease` :1670–1690)

The gate throws, in order (:1670–1686):

| # | Code | line | Asserted? | Row |
|---|------|------|-----------|-----|
| 1 | `run_orchestrator_lease_not_found` | :1672 | ✗ | — |
| 2 | `run_orchestrator_lease_revoked` | :1673 | ✗ | **named in the v1.0 acceptance** ("expired, revoked, or foreign-session lease fails with the typed code") |
| 3 | `run_orchestrator_lease_expired` | :1674 | ✓ | KS2.1 |
| 4 | `run_orchestrator_session_mismatch` | :1677 | ✓ | KS2.3 |
| 5 | `run_orchestrator_parent_inactive` | :1680 | ✓ | KS2.2 |
| 6 | `run_orchestrator_parent_stale` | :1682 | ✗ | — |
| 7 | `_assertRunAdmissionOpen` → `run_stopping` | :1684 | ✗ | — |

The three asserted codes are each targeted correctly against the check order: KS2.1 advances the clock past
`expiresAt` (lease still `active`) so `expired` fires before `session`; KS2.3 uses a foreign session with a live
lease so `session_mismatch` fires before the parent check; KS2.2 cancels the parent task so `parent_inactive`
fires after expiry/session pass. Good precision.

Gaps worth a row, in priority order:
1. **`run_orchestrator_lease_revoked`** — the acceptance explicitly names it; the natural fixture is: issue lease,
   revoke it (`revokeRunOrchestratorLease`, reason `'operator'`), then `admitWorkflowFinding` with a **fresh**
   auth.key (a re-used key would hit the store replay at `admitWorkflowFinding` :14551 and short-circuit before the
   lease check — KS7's second call is exactly this replay, so it cannot double as the revoked test).
2. **`run_orchestrator_lease_not_found`** — admission with `lease: { id: 'run-orchestrator-lease:<nonexistent>' }`
   and a matching digest shape → :1672.
3. **`run_stopping`** — stop the settlement run, then admit. Note the design tension: ground-truth #6 says the
   settlement run is synthetic and "never stops", so this path may be unreachable for the settlement lease by
   construction — the contract should either accept that (doc-level) or the test must synthesize a stopped run
   (e.g. a `run.stop` recorded for the settlement runId) and assert `_activeRunOrchestratorLease` refuses.
4. **`run_orchestrator_parent_stale`** — bump the parent task version while keeping it `working`; low priority
   (hard to construct without a version-bumping no-op transition).

## v1.0 acceptance — testability per clause

| Acceptance clause | Testable as written? | Asserted today |
|-------------------|----------------------|----------------|
| note+plan elevated — "**shared fence moved**, dispositions receipted" | Yes, but "fence moved" and "dispositions receipted" need concrete projections | KS4.1 (kinds present); fence value ✗; disposition events ✗ |
| candidacy materialized — "candidate **Findings queued**, full text in detail, counts in **receipt + outlines**" | Yes | full text ✓ (KS4.1), receipt count ✓ (KS4.1), candidate Finding nodes ✗, outline count ✗ |
| "settlement lease materialized with **session bound to the calling principal**" | Yes | lease exists ✓ (KS4.1); session bound ✗ |
| "stale leases swept (**`review_window_expired`**)" | Yes | swept ✓ (KS6.1); reason ✗ |
| "**runs stopped after all of it**" | Yes (member run-status assertion) | ✗ |
| "re-drive exactly-once (stable `leaseId`, no duplicate items/**elevations** — **crash walks 1+2**)" | Yes, but crash-resume needs a synthesized mid-hook state | leaseId ✓ (KS5.1), items ✓ (KS5.1); elevation-event count ✗; crash-walk resume ✗ (clean re-drive only) |
| "`knowledge.promote` promotes exactly the candidate, enforces expiry/parent-liveness/session binding (typed codes), auto-revokes, completes the task, idempotent-replayed" | Yes | ✓ (KS7.1 + KS2.1–2.3) |
| "admission with an **expired, revoked, or foreign-session** lease fails typed code" | Yes | expired ✓, foreign ✓, **revoked ✗** |
| "Doubts **and links** never elevated; plan entries never mint facts/items/Findings" | Yes | doubts ✓ (KS8.1), **links ✗** (no fixture), plans ✓ |

Every acceptance clause is testable as written — the suite just doesn't assert every testable half.

## Gap ledger (verdict + row text to add)

**MISSING-ROW — C1 revoked-lease admission (acceptance-critical).**
> `KS2.5: a revoked lease is refused at admission with run_orchestrator_lease_revoked` — build the KS2 fixture,
> `store.revokeRunOrchestratorLease({ leaseId: lease.id, leaseDigest: lease.digest, reason: 'operator', schemaVersion: 1 }, auth('run.orchestrator_lease.revoke:<leaseId>'))`, then assert
> `refusalCode(() => store.admitWorkflowFinding(repoId, SETTLEMENT_RUN_ID, candidateFindingId, policy, sessionAuth('<fresh key>', session), lease)) === 'run_orchestrator_lease_revoked'`.
> A fresh auth.key is mandatory — a key already used for admission replays at `admitWorkflowFinding` :14551 before
> the lease check is reached.

**MISSING-ROW — C1 not-found admission.**
> `KS2.6: a lease id that does not exist is refused with run_orchestrator_lease_not_found` — `admitWorkflowFinding`
> with `lease: { id: 'run-orchestrator-lease:deadbeef', digest: lease.digest, issuedEvent: lease.issuedEvent }`.

**MISSING-ROW — C2 D1 id/runId pin.**
> `KS1.4: the D1 API pins id/runId to waveId-derived constants` — assert
> `refusalCode(() => store.createAndClaimSettlementTask({ id: 'settlement-task:<other-wave>', runId: SETTLEMENT_RUN_ID, reservedWorkerId: SETTLEMENT_WORKER_ID }, auth(...)))`
> is a typed refusal, and the reciprocal (pinned id, foreign runId) too; and that the store *derives* the pinned
> id from the runId when the caller's id matches the wave (`run-settlement:<X>` ⇒ `settlement-task:<X>`).

**MISSING-ROW — C3 settlement_lease session derivation + return shape.**
> `KS3.3: knowledge.settlement_lease binds the lease session to the calling principal server-side and returns {runId, taskId, lease}` —
> call `application.command('knowledge.settlement_lease', { runId: SETTLEMENT_RUN_ID }, principal('wave-owner'))`;
> assert the returned shape has `runId/taskId/lease.id/lease.digest/lease.issuedEvent`, and the issued lease's
> `session.principalId === 'wave-owner'` and `session.sessionId === 'session-wave-owner'` (via
> `store.runOrchestrationView(SETTLEMENT_RUN_ID)` or `runOrchestratorLease`). This is the only row that would catch a
> caller-supplied-session implementation (authority §2).

**MISSING-ROW — C3 command→promote end-to-end.**
> `KS7.2: the settlement_lease coordinates feed knowledge.promote directly` — obtain the lease from the
> `knowledge.settlement_lease` command (not from `issueRunOrchestratorLease` as KS7 does), then pass exactly
> `{runId, taskId, lease}` into `application.command('knowledge.promote', …)` and assert admission succeeds.

**MISSING-ROW — C4 command-level mappings.**
> `KS3.4: scratchpad.elevate dispatches to elevation` — `application.command('scratchpad.elevate', {runId, taskId, workerId, expectedScratchpadFence, entryIds}, principal)` on a terminal task; assert the shared partition gains exactly `entryIds` and the event actor is `'orchestrator'` (server-derived).
> `KS3.5: scratchpad.settle dispatches to disposal` — `application.command('scratchpad.settle', {runId, expectedScratchpadFence, skips}, principal)`; assert shared entries disposed and note facts expired.

**WEAK-ROW — C4 KS3.1 (dispatching) — tighten.**
> KS3.1 excludes only `application_command_unavailable`. Add an assertion that a garbage arg shape yields a
> *validation* code (e.g. not the same "dispatch" code), or that the dispatched command performs a side effect —
> otherwise "knows the four commands" is satisfied by a stub that throws any non-unavailable code.

**WEAK-ROW — C5 sweep reason + driver-trigger.**
> `KS6.2: the sweep revokes with review_window_expired and RUN_ORCHESTRATOR_REVOCATION_REASONS carries it` — after KS6's clock advance, assert the revoke event's `payload.reason === 'review_window_expired'` (from `store.snapshot().events` or the view) and `RUN_ORCHESTRATOR_REVOCATION_REASONS.includes('review_window_expired')`.
> `KS6.3: the driver triggers the sweep in the settle window` — create a deployment with an expired un-admitted lease from a prior wave, drive a second kg-ritual wave over the same deployment, and assert the prior lease is revoked during the hook (not by a manual store call).

**MISSING-ROW — C6 title derivation.**
> `KS4.4: the candidacy title is the note's first 120 bytes with control characters stripped` — write a note whose
> text starts with `"ORCHESTRATOR: … …"` padded past 120 bytes; assert
> `board.items[0].title` has no control chars and byte-length ≤ 120 and begins with the stripped 120-byte prefix.

**WEAK-ROW — C7 settlement.errors + outlines.**
> `KS4.5: a typed step refusal is receipted in settlement.errors and never aborts close` — force a
> `scratchpad_settlement_not_ready` (or other typed refusal) during the hook; assert `receipt.settlement.errors` is
> an array ≤ 8 of `{member, step, code}` and the wave still closes with its completed outcome.
> `KS4.6: the member terminal outline carries knowledge.candidatesAwaitingAdmission` — read the member run's
> terminal outline (application view) and assert the count matches the receipt.

**WEAK-ROW — C8 KS9 MCP half vacuous — re-point at the registry.**
> Replace the `mcp-northbound.mjs` source grep with registry-derived assertions: for each of the four keys, assert
> `APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.find(op => op.key === key)?.surfaces` does not include `'mcp'`
> or `'cli'`; and assert the derived tool-name sets (`deriveSurfaceNames(key).mcp` → `baton_<snake>`, plus
> `SURFACING_MATRIX_MCP_ROWS` / `canonicalCliRenderModel()`) contain none of the four names. Also assert the four
> dotted names are absent from `application-cli.mjs`'s CLI command topics. This is the only way the "structural
> embedded-only gate" actually pins anything.

**MISSING-ROW — C9 link kind.**
> `KS8.2: link entries never elevate` — add `{ kind: 'link', label: 'l', relation: 'mentions', target: '…' }` to the
> KS8 writes; assert it is absent from shared and mints no board item.

**WEAK-ROW — C10 resumable-teardown partial states.**
> `KS7.3: knowledge.promote resumes a crash after admit` — manually `admitWorkflowFinding` (Finding exists, lease
> `active`, task `working`), then `application.command('knowledge.promote', …)`; assert lease revoked, task
> completed, `nodes.length === 1`.
> `KS7.4: knowledge.promote resumes a crash after revoke` — admit + `revokeRunOrchestratorLease` (task still
> `working`), then the command; assert task completed, lease stays revoked, one Finding.

**WEAK-ROW — C11 default-on + no-auto-admission.**
> `KS4.7: the settlement policy defaults to kg-ritual` — `createWaveDriver(baton, { …no settlement field })` and
> assert the ritual runs (or that the frozen policy's `settlement === 'kg-ritual'`).
> `KS5.2: a kg-ritual wave performs no auto-admission` — after KS4's full wave (no promote), assert
> `store.queryKnowledge({})` has zero nodes with `promotion?.trigger === 'workflow.admitted'`.

**MISSING-ROW — C12 run_stopping admission path.**
> `KS2.7: admission refuses when the settlement run is stopping` — record a run stop for `SETTLEMENT_RUN_ID`, then
> admit; assert `run_stopping`. (Flag for the contract: ground-truth #6 says the settlement run "never stops", so
> either this path is unreachable by construction and should be doc-only, or the test synthesizes the stop.)

**WEAK-ROW — D1.7 / D1.9 / D4.2 / D4.3 tightenings (minor).**
> D1.7: assert the exact hub template; D1.9: same-key-different-fields conflict; D4.2: assert `orchestrator_skipped`
> disposition events for doubt/link; D4.3: assert the elevated note's `scratchFactId` is non-null and resolvable.

## Summary & recommendations

The suite's spine is red for the right reasons against the unimplemented tree (verified: 17 red / 1 green, every
red row fails at its named missing surface — D1 API, `_activeRunOrchestratorLease` codes, command dispatch, driver
policy field, sweep API, UNTRUSTED frame). But the coverage map shows the v1.0 security properties cluster exactly
where the rows are weakest:

1. **The admission gate's typed codes are 3-of-7.** The acceptance names `revoked`; no row tests it, nor
   `not_found`/`parent_stale`/`run_stopping`. The revoked test needs a fresh auth.key (KS7's replay short-circuit
   would mask it).
2. **The D1 id/runId pin is enforced by no row.** The fixture supplies the pinned values, so an unpinned
   implementation passes. Same structural weakness in D2.6's server-side session derivation: no row reads the
   issued lease's session.
3. **The surface-honesty green pin (KS9) is half-vacuous.** MCP tools are registry-derived; grepping source strings
   pins nothing. Re-point KS9 at `APPLICATION_SEMANTIC_REGISTRY.canonicalOperations` surfaces and the derived tool
   sets, and add the CLI half.
4. **Driver-level decisions are under-pinned:** sweep reason + driver-trigger, `settlement.errors`, outline
   surfacing, `steering.registered`, store-status gating, and default-on are all asserted at the wrong layer or not
   at all.
5. **The `link` kind is never exercised** (D4.6), and the resumable-teardown crash windows (D2.4's core amendment)
   are only tested in the trivial fully-complete replay.

Priority order for new rows: C1-revoked, C2-pin, C3-session-derivation, C8-KS9-repoint, C5-sweep-reason,
C6-title, C10-partial-teardown, then the driver-level receipt/outline rows. Every acceptance clause in the
contract is testable as written; none requires a contract change to pin.
