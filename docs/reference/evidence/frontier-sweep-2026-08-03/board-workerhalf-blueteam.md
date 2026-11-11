# Blue-team: board worker-half red suite — adversarial verification

(Target: `impl/test/board-workerhalf-red.test.mjs` — 21 rows, BW-01…BW-20 with BW-18 split
18a/18b and BW-21 folded into BW-03. Verified against the v1.0 red-team-folded contract
`docs/reference/evidence/frontier-sweep-2026-08-03/board-workerhalf-contract.md`, the fold
source `board-workerhalf-redteam.md` (amendment register A1-1…A8-2, §6), and `impl/src/`
ground truth. NUL-containing sources (`application.mjs`, `coordinator.mjs`,
`coordination-store.mjs`) inspected via `grep -an`/`sed -n` only, 2026-08-03. Suite run
from repo root: `node --test impl/test/board-workerhalf-red.test.mjs`, node v25.8.0.
Two "green today" pin claims the run itself cannot reach were verified independently with
inline `node --input-type=module -e` harnesses (no files written; §6).

Verdict scale: **SOUND** = red for the named stage today (or, for pins, green for the named
reason), green only on a contract-correct implementation, and a wrong implementation cannot
pass it. **WEAK** = correctly staged and discriminating in composition, but a named wrong
implementation can pass it. **VACUOUS** = passes without exercising the named behavior.
**STAGED-WRONG** = red/green state does not track the named contract behavior.)

## 1. Run record

`node --test impl/test/board-workerhalf-red.test.mjs` from the repo root:

```text
ℹ tests 21   ℹ pass 3   ℹ fail 18   ℹ cancelled 0   ℹ skipped 0   duration_ms ≈ 2701
```

**Observed split: 18 red / 3 green — exactly the declared split.** Green: BW-07, BW-09,
BW-10 (the declared pins). Red: everything else.

First failing assertion per red row (all `AssertionError`s; line = suite line):

| Row | Fails at | Stage label in test name | Assessment |
|-----|----------|--------------------------|------------|
| BW-01 | `stage[registry ghost]: board.claim gains the embedded authenticated worker lane` (:365) | registry[ghost-rows] | **At named stage.** The pin halves (profile `worker`; absent from mcp/web/cli inventories) executed first and passed. |
| BW-02 | `stage[worker stream dispatch missing]: every BOARD_CLAIM attempt produces a board.claim_result … today no such receipt exists` (:419) | lane[stream-dispatch-missing] | **At named stage.** Fixture works (worker spawned, item posted, frames emitted); zero receipts exist. Grep confirms no `case 'board.claim'/'board.report'` on the coordinator event switch. |
| BW-03 | `stage[waves.send claim-grant transport missing]: the waves.send schema gains the optional closed claimGrant` (:449) | waves.send[claim-grant-missing] | **At named stage**, before fixture construction. The `waves.send` row exists (`application-semantics.mjs:1582`, schema `{runId, message, delivery}`) and lacks `claimGrant`. |
| BW-04, BW-05, BW-06, BW-08, BW-12, BW-13, BW-15, BW-16, BW-17, BW-18b, BW-20 | `stage[waves.send claim-grant transport missing]: waves.send must accept the closed claimGrant {boardRunId, board} request … refuses with application_wave_member_action_invalid` (in `sendGrant`, :278) | various (scope / retry-dedup / in-append-gate / report-cas / restart / read×3 / isolation / lifecycle / #74-e2e) | **At an earlier, contract-named prerequisite stage — by design, not a fixture bug.** Every fixture step before `sendGrant` (git repo, driver, S-2 lease, board post, member spawn, wave binding) succeeds; the refusal is the closed wave-member normalizer (`application.mjs:11483`), which the suite header and the `sendGrant` comment name as "the named red stage for every grant-dependent row". BW-20's header says the same ("fails today at the first missing piece"). |
| BW-11 | `Missing expected exception: stage[blind _byKey]: changed claim content under one key refuses board_replay_conflict` (:836) | replay[blind-bykey] | **At named stage.** Independently reproduced inline: a second `requestBoardClaim` with changed owner under the same key returns `{ok:true, result:'idempotent'}` — the blind `_byKey` return (`coordination-store.mjs:14050-14051`). |
| BW-14 | `stage[freshness gap]: the board snapshot/result projects projectionInputFence alongside boardFence` (:963) | freshness[cache-key-gap] | **At named stage.** `boardSnapshot` has no `projectionInputFence` field; `projectBoardView`'s cache key is `` `${board} ${role}:${workerId} ${boardFence}` `` — boardFence-only (`application.mjs:493`). |
| BW-18a | `stage[close/drop batch gap]: the orchestrator close expires the item's active claim in the same batch … today the claim is orphaned active` (1 !== 0, :1147) | close-expiry[batch-gap] | **At named stage.** Pure kernel row; `closeBoardItem`/`dropBoardItem` (`coordination-store.mjs:14035/14041`) write only the item successor. |
| BW-19 | `stage[envelope gap]: the projected claim carries itemId … today the projection emits only {owner, itemVersion, boardFence}` (:1218) | envelope[projection-gap] | **At named stage.** Source confirms `claim: {owner, itemVersion, boardFence}` and reports without `claimVersion`/`grantDigest`/`eventSeq` (`application.mjs:516-520`). |

Conclusion for run record: **18/18 red rows fail at a genuine contract-named missing
capability; none fails at a fixture defect.** One structural caveat, stated honestly: the
eleven grant-dependent rows fail at the *prerequisite* `waves.send` stage, so their own
named stages are **unproven red points** until the transport lands. That is inherent to a
stacked red suite, and every downstream fact their stages allege was independently confirmed
against current source (§3 evidence column), so the risk of a surprise green after the
transport lands is low — but the implementation wave must re-run this suite after landing
*only* the claimGrant transport and confirm all eleven are still red at their own stages.

## 2. Coverage map

### 2.1 Decisions → tests

| Contract clause | Tests | Holes |
|---|---|---|
| D1 worker-profile rows + embedded lane | BW-01 | — |
| D1 closed frames reject identity/scope fields | BW-02 (hub-side; accepts scanner-drop or typed invalid) | **The literal adapter text-frame scanning of `BOARD_CLAIM`/`BOARD_REPORT` (exact-key + first-balanced-JSON, A1-1) has no oracle** — `ScriptableAdapter.emit` injects parsed kinds, bypassing the scanner (blocker B4). |
| D1 stream-derived attribution | BW-04 (claim owner = stream worker), BW-08(d) (report owner) | — |
| D1 every attempt receipted, typed refusals | BW-02, BW-04, BW-08 | — |
| D1 live task-status gate `working\|input_required\|paused` | BW-17 (paused admitted) | `working`/`input_required` positive and terminal-status negative untested (follow-up). |
| D1 receipts never feed TG2/TG3 (A1-2) | BW-17 | — |
| D2 `waves.send` closed `claimGrant {boardRunId, board}` | BW-03 (schema + behavioral) | — |
| D2 server-side role/member resolution; caller names no grantee | BW-03 (closed schema), BW-04(d) (possession ≠ authority) | — |
| D2 S-2 authority as server context, never in the steer | BW-03 (four leak strings absent from delivered prompt) | Leak check is string-based on the prompt channel only (teeth note T3). |
| D2 closed grant shape + orchestrator-selected permissions (A2-2) | BW-03 (closed key set; subset-of `{read,claim,report}`) | **No read-only grant denied a claim; no executor-vs-triage permission differentiation — the hardcoded-permissions over-grant the red team named has no oracle (blocker B1).** |
| D2 event-based grant liveness + `board.grant_revoked` (A2-1) | BW-18b (death revokes), BW-12 (revoke survives restart) | — |
| D2 durable generation record (A2-3) | BW-16/BW-18b (behavioral staleness only) | **Replay-derived generation invalidation untested — no respawn-before-restart row (blocker B5).** |
| D2 persist-before-deliver | — | **Untested**: BW-03 sees mint and steer, never their order (follow-up). |
| D2 same-wave cross-Run relaxation; same-repo mandatory | BW-04(e) positive (board Run `run:coord` ≠ member Run, both wave-bound) | Cross-wave and cross-repo negatives untested (follow-up; BW-04's oracle names wave/repo). |
| D3 seven-step seam, constant pre-existence refusal | BW-02, BW-04(a-d), BW-13, BW-16, BW-18b | — |
| D3 `boardRunId` = recorded binding (A3-2) | BW-04(b) (foreign-board item under a real grant → constant refusal) | Same-named-board-different-Run is impossible in the store (one binding per board id); rebind-after-mint untested (follow-up). |
| D3 typed codes reachable within a valid grant | — | **`board_item_not_found` / `board_item_not_open` never exercised through a valid grant** — BW-04(c) deliberately proves their *absence* pre-lookup only (follow-up). |
| D3 in-append CAS (step 7) | BW-06 | Coupling note T5. |
| D3 kernel-enforced digest adjudication (A3-1/A6-2) | BW-11 | — |
| D3 wire close + size check (step 1) | Registry schema bounds (BW-01 field presence); kernel 4096-byte body bound exists (`coordination-store.mjs:14075`) | No oversize-frame/oversize-body attempt through the lane (follow-up). |
| D4 claim CAS = `boardFence`; turn fences never CAS | BW-07 (pin) | — |
| D4 report CAS = active owned claim + `expectedClaimVersion` + open item | BW-08(a-e), BW-20 | Resurrected-caller nuance (A4-1: `claimVersion` resets to 1 on re-claim) untested — BW-08(b) is foreign-owner without the expire/re-claim cycle (follow-up). |
| D4 migration | BW-09 (pin) | — |
| D4 completion (report ≠ close) | BW-10 (pin) | — |
| D5 grant-scoped read, every item incl. unowned | BW-13 | — |
| D5 exactly one board; scope refusal shared | BW-13 (second board absent), BW-13/BW-16 (fabricated grant) | — |
| D5 closed query (no board/Run/wave/worker/task/role/viewer/mode) | BW-16 (board, workerId, runId smuggled → invalid) | wave/task/role/viewer/mode variants untested (follow-up; the three tested cover the mechanism). |
| D5 16-item / 32 KiB page, stable `(ordinal,itemId)` cursor | BW-15 | — |
| D5 in-item report continuation `(itemId, lastReportSeq)` (A5-1) | BW-15 (heavy item: page ≤32 KiB, non-empty, cursor exists) | Continuation never *followed* — remaining reports unverified (follow-up). |
| D5 oversize item row → `truncated:true` + `board_oversize_item`, never empty page (A5-1) | — | **No test (blocker B2).** |
| D5 cursor digest-bound; changed fence → `board_cursor_stale`; revoked grant → scope refusal | BW-15 (stale cursor), BW-16 (cursor after death/new generation) | — |
| D5 snapshot projects `{board, boardRunId, boardFence, projectionInputFence, observedSeq, items, nextCursor, truncated}` | BW-14 (`projectionInputFence`), BW-20 (`boardFence` + `projectionInputFence` in page text) | `boardRunId`/`observedSeq` never asserted (follow-up). |
| D5 dual-fence cache identity | BW-14 | — |
| D5 read = zero-weight L1 audit receipt, no board event, no fence move | BW-17 | The durable `context.read` audit event's *existence* is unasserted (only the stream receipt; follow-up). |
| D6 effective key `<opKind>:<grantDigest>:<callerKey>` (A6-1) | BW-11(c) (cross-op collision), BW-05 (grant.mint changed content) | Cross-*worker* caller-key reuse at the seam (rule 1) untested (follow-up). |
| D6 rule 1 authority-before-receipt | BW-04(d) (foreign holder of the grant id, fresh key) | B-reuses-A's-exact-key scenario untested (follow-up). |
| D6 rule 2 exact retry | BW-05, BW-11(d) | — |
| D6 rule 3 changed content/authority → `board_replay_conflict` | BW-11 (claim/report/expire ×3), BW-05 | BW-05 accepts any `/conflict/` (T4). |
| D6 rule 4 original result wins over later live-state; revoked/foreign cannot replay | — | **No test (blocker B3).** |
| D6 rule 5 race at the final gate | BW-20 (loser gets `conflict`/`stale_board_fence`) | — |
| D6 rule 6 byte-identical replay | BW-12 | Generation-record replay gap (B5). |
| D6 rule 7 read-key replay; new key = fresh read | — | Untested (follow-up). |
| D7 closed claim/report envelope, both lanes | BW-19 (projection), BW-20 (triage visibility) | BW-19 anchors values for only 3 of 18 fields (T8). |
| D7 orchestrator projection extended + dual-fence cache (A7-1) | BW-14, BW-19 | — |
| D7 delivery ≠ consumption | Receipts asserted as admission outcomes only | No acted-on semantics exist to pin; acceptable, noted. |
| D7 #74 loop end-to-end | BW-20 | — |
| D7 no coordinator-worker escalation | BW-01 (worker rows off ordinary surfaces) | Worker-profile inability to call `waves.send` not pinned here (ordinary-profile authorization; owned by wave/packaging suites — noted, not a hole this lane must close). |
| D8 close/drop expires claim in-batch, actor `policy`, contract key (A8-2) | BW-18a (close **and** drop) | — |
| D8 report admission requires item open | BW-08(e) | — |
| D8 death/reassignment expires claims, revokes grants | BW-18b (+ pin verified inline, §6) | Reassignment variant untested (death covers the mechanism; follow-up). |
| D8/BW-21 no clock/turn/cadence control | BW-03 closed grant key set (no TTL/expiry field can exist) | **Static/source half of BW-21 untested** — nothing greps the lane for new timers/turn fields (follow-up). |
| S-2 lease `expiresAt` confined to security authority | BW-03 (closed key set; expiry string absent from steer) | — |

### 2.2 Refusal codes → tests

| Code | Test(s) | Status |
|---|---|---|
| `board_worker_scope_refused` | BW-02, BW-04(a-d), BW-13, BW-16, BW-18b | covered |
| `board_item_not_found` | BW-04 asserts its *absence* pre-lookup | **valid-grant reachability untested** |
| `board_item_not_open` | — | **untested** (BW-08(e) asserts refusal but names no code) |
| `conflict` / `stale_board_fence` | BW-06 (stale), BW-20 (either) | covered |
| `board_replay_conflict` | BW-11 ×3; BW-05 via broad `/conflict/` | covered (T4 note) |
| `board_cursor_stale` | BW-15 | covered |
| `board_oversize_item` | — | **untested (B2)** |
| `board_report_binding_mismatch` | BW-09 (pin, green today; code verified at `coordination-store.mjs:14080`) | covered |
| `application_wave_member_action_invalid` | the red-stage refusal itself (verified raised at `application.mjs:11483`) | covered |
| closed-grammar `*invalid*` | BW-02, BW-16 via `/invalid/` | covered (T2 note) |

### 2.3 Named surfaces → tests

`BOARD_CLAIM`/`BOARD_REPORT` frames → hub-level kinds only, scanner untested (**B4**);
`board.claim_result`/`board.report_result` → BW-02/04/08/17/18b/20; `CONTEXT_READ
{kind:"board", grantId, cursor}` → BW-13/15/16/17/20 (verified today's `contextRead`
requires `query.board` and knows no `grantId`/`cursor`, `coordinator.mjs:10320-10324` — the
lane gap is real); `context.read_result` → same rows; `waves.send` `claimGrant` →
BW-03/04/05 + all grant-gated rows; `board.grant_revoked` → BW-12/18b;
`worker.generation_bound` (contract: "e.g.") → **no direct test (B5)**; S-2 `board.read`
orchestrator projection → BW-14/19 via the real `projectBoardView`; ordinary MCP/Web/CLI
inventories → BW-01 pin halves (registry level, matching repo conventions); the
`admitWorkerBoardCommand`-equivalent seam → behavioral via BW-04/06/08 (name deliberately
unasserted — good, the contract says "equivalent").

### 2.4 Amendments (redteam §6 register) → tests

A1-1 → BW-02 hub-side only (**B4**); A1-2 → BW-17; A2-1 → BW-18b/BW-12; **A2-2 → shape
only, enforcement untested (B1)**; **A2-3 → live behavior only, replay untested (B5)**;
A3-1 → BW-11; A3-2 → BW-04(b); A4-1 → BW-08(b)(c) minus the resurrected-caller case
(follow-up); **A5-1 → report-heavy half only, oversize-row half untested (B2)**; A6-1 →
BW-11(c)/BW-05; A6-2 → BW-11; A7-1 → BW-14/BW-19; A8-1 ≡ A2-1 → covered; A8-2 →
BW-18a + BW-08(e).

## 3. Teeth check on red rows

Would a plausible wrong implementation fail the row? Per-row flags (unlisted rows have
adequate teeth as written):

- **T1 (BW-01)** — shape row by design: registry metadata alone greens it. Acceptable only
  because BW-02 guards live dispatch. No action.
- **T2 (BW-02, BW-16)** — `/invalid/` substring accepts any `*invalid*` code. The contract
  names no specific code here; acceptable. No action.
- **T3 (BW-03)** — the S-2-leak check greps the delivered prompt text for four strings
  (digest, lease id, expiry ISO, `sessionAuthority`). A leak under another encoding (a lease
  id folded into a composite digest, an epoch-ms expiry) escapes. The closed grant key set
  and closed `claimGrant` schema are the real teeth, and they are strong. Follow-up, not a
  blocker.
- **T4 (BW-05)** — changed-content-under-one-key accepts any `/conflict/`; the contract's
  code is `board_replay_conflict`. Tighten the regex. Follow-up.
- **T5 (BW-06)** — deliberately coupled to the store's shared before-write hook
  `_boardAdmissionInterleave` (exists at `coordination-store.mjs:13917`; same convention as
  `test/board-authority-red.test.mjs:211`). An implementation whose worker claim append does
  a correct CAS but does not route through the shared gate hook fails at "the in-append
  interleave actually fired". This is the established project pattern for testing in-append
  CAS; implementers must be told the hook is part of the contract surface the test pins.
  Documented here; no suite change.
- **T6 (BW-08)** — refusal codes for the negative sub-cases are unnamed (asserted "not
  ok"). A refuse-everything implementation still fails on the positive control (d), so
  refuse-all is caught. Adequate.
- **T7 (BW-15)** — the in-item report continuation is asserted to *exist*, never followed;
  a dummy non-null `nextCursor` greens that assertion. The stale-cursor and 32 KiB teeth are
  real. Follow-up (with B2).
- **T8 (BW-19)** — 6 of 9 claim fields and 7 of 9 report fields are asserted by
  `Object.hasOwn` only; `grantDigest: undefined` greens them. Value anchors exist for
  `claimVersion`/`ownerWorkerId`/`eventSeq`/body/title. Follow-up: anchor the digest fields
  against recomputed digests.

Rows confirmed to have real teeth against the named wrong implementation: BW-02 (auto-admit
without grant → claim event lands → red), BW-03 (bearer-token design → closed-schema red;
caller-named permissions → closed-schema red), BW-04 (possession-as-authority → B's attempt
claims → red; existence-leak → `board_item_not_found` string → red), BW-05 (double-mint →
event count → red; blind replay → no `/conflict/` → red), BW-06 (no in-append re-check →
claim lands → red), BW-08 (today's kernel semantics → reports land → red at (a)), BW-11
(blind `_byKey` → no throw → red — the suite's sharpest row), BW-12 (replay drift →
byte-compare red; resurrected claim → red), BW-13 (today's owned-or-named projection →
unowned titles missing → red), BW-14 (boardFence-only cache → stale view served → red),
BW-16 (cursor-as-authority → revived read answers → red), BW-17 (copied scratchpad TG2
wiring → pause settles → red; read appends board event → red), BW-18a (today's close/drop →
orphaned active claim → red), BW-18b (no revoke → red; generation reuse → red), BW-19
(today's envelope → red), BW-20 (any shortcut in the loop → durable-event assertions red).

## 4. False-green hunt on the passing pins

- **BW-07 fences[pin] — SOUND.** Two halves over the real `CoordinationStore` and the real
  `Coordinator` wrapper + `FenceTable`. Not vacuous: `boardFence` must equal 1 after the
  post (a never-bumping fence fails :645) and must *stay* 1 across claim/report/expiry; the
  projection fence must advance by exactly 1 each time (a static counter fails
  :650/:655/:658). The turn-fence half bumps real fences (`bumpTurn`/`bumpHuman` — the kill
  path itself calls `bumpHuman`, `coordinator.mjs:7639`) and asserts non-interference with
  claim CAS. Asserts on the system, not the fixture. Minor note: if the fence bumps were
  no-ops the half would pass vacuously, but they are existing, separately tested machinery.
- **BW-09 migration[pin] — SOUND.** Drives the real store through post → claim → retitle →
  report: `migrated === true`, stable `itemId`, version preserved at 1, the report binds the
  exact observed `(itemVersion, itemDigest)`, and the successor digest on the old version
  throws the real `board_report_binding_mismatch` (code verified at
  `coordination-store.mjs:14080`). A migration-loss or silent-rebind regression fails
  immediately. Not staged: every assertion is on durable store state.
- **BW-10 evidence[pin] — SOUND.** Uses the real S-2 path end-to-end (a real issued
  run-orchestrator lease via `issueRunOrchestratorLease`, real `admitBoardCommand` post and
  close). Negative half (report leaves item open, claim active, fence unmoved) and positive
  half (only the S-2 close closes) both have teeth; a close-on-report regression fails at
  :811. The fixture's authority is produced by the system under test, not asserted on.

No pin is WEAK, VACUOUS, or STAGED-WRONG.

## 5. Drift: suite header / invented surfaces vs contract and code

Header claims re-verified, all accurate: ghost rows (`surfaces: []`, and `liveMethod`
genuinely defaults to the key — `buildCanonicalOperation`,
`application-semantics.mjs:1849`; runtime-checked: `liveMethod === "board.claim"` today);
no `board.claim`/`board.report` case on the event switch; the closed wave-member normalizer
refuses `claimGrant` with `application_wave_member_action_invalid` (`application.mjs:11483`);
blind kernel `_byKey` (reproduced inline); close/drop batch gap (BW-18a red at its named
assertion); boardFence-only projection cache (`application.mjs:493`).

Name alignment: every contract-adopted name the suite uses matches — refusal codes, the
closed grant key set (BW-03 == Decision 2's shape verbatim), the envelope field names
(BW-19 == Decision 7 verbatim), the expiry key `board.claim_expired:<itemId>:1:item_closed`
and actor `policy` (BW-18a mirrors `_expireBoardClaims`,
`coordinator.mjs:8030-8037`; confirmed inline: real death-expiry key is
`board.claim_expired:<itemId>:1:task_failed` with payload `{itemId, expectedClaimVersion}`),
and the mint event is deliberately matched by prefix (`board.grant_*`, non-`_revoked`) since
the contract leaves the mint kind unnamed. The suite's stream kinds `board.claim`/
`board.report`/`context.read` follow the landed parsed-kind convention (`context.read`
precedent at `coordinator.mjs:11578`); the contract's `BOARD_CLAIM`/`BOARD_REPORT` are the
wire text frames upstream of that seam — consistent, with the scanner-test gap of B4.

Drift implementers could trip on (contract-side staleness, not suite error):

1. **Contract ground truth 11 is stale**: it states no `waves.send` row exists in the
   registry. The row has landed (`application-semantics.mjs:1582`, ordinary profile,
   schema `{runId, message, delivery}`) — the packaging lane landed it after the contract's
   2026-08-02 inspection date, as the contract anticipated. The suite correctly asserts the
   row exists. Implementers following the contract literally might try to re-land it.
2. **Contract line citations have drifted ~140 lines**: kernel methods cited at
   `coordination-store.mjs:13903-13950` now live at 14049-14094 (`requestBoardClaim` 14049,
   `submitBoardReport` 14069, `expireBoardClaim` 14088); `_expireBoardClaims` cited at
   `coordinator.mjs:7720-7728` is now 8030. Cited *facts* all re-verified true; only the
   numbers moved.

## 6. Reconciliation of the declared split

Header declares 21 rows, pins BW-07/09/10 green, the rest red. Measured exactly 18 red /
3 green with the three declared pins passing — **no divergent tests, nothing to re-judge.**

Within-row pin halves the red run cannot reach, re-checked here:

- BW-11(d) "exact retry replays (green today)": **verified green independently** — inline
  harness: exact retry returns `result:'idempotent'` with the original event seq; changed
  content under the same key returns the old success (which is also the red stage).
- BW-18b pin half "worker death version-CAS-expires owned claims (green today)": **verified
  green independently** — inline harness mirroring the suite fixture: `kill` settles
  `forced` (the stop-deadline timer is unref'd, `coordinator.mjs:7506` — the suite's
  `killMember` correctly accepts `confirmed|forced`), one `board.claim_expired` lands with
  actor `policy`, contract-key shape, `expectedClaimVersion` payload, zero active claims
  after.
- BW-14 :972 / BW-19 :1230-1231 pin assertions (fence unmoved; UNTRUSTED framing of body and
  title): unreached in this run; the framing is source-verified (`application.mjs:512-520`,
  `wrapProse` on title/detail/body) and pinned by existing board suites. Re-check on the
  first green run.

## 7. Closing verdict

**NOT-READY.**

The suite is honest — 18/18 reds fail at contract-named stages, all three pins are SOUND,
the declared split reconciles exactly, and no suite-side name drift exists. But five
contract-mandated behaviors have no oracle, each of which a compliant-but-shallow
implementation could green past — including A2-2, one of the red team’s headline missed
holes. Fix the five blockers, then this suite is a gate.

1. **Grant-permission enforcement has no test (A2-2; Decision 2 permissions; Decision 3
   step 4; BW-04's own oracle names "recorded permission").** An implementation hardcoding
   `{read,claim,report}` for every member greens the whole suite — precisely the
   coordinator-worker over-grant the fold was written to close. *Fix:* extend BW-04 (or add
   a row): mint a `{read}`-only grant for the triage-role member, attempt a claim, assert
   the constant scope/permission refusal *before item lookup*; and assert at mint that the
   orchestrator-selected subset — not a hardcoded set — is recorded (executor
   `{read,claim,report}`, triage-only `{read}`).
2. **`board_oversize_item` / oversize-row truncation has no test (A5-1; Decision 5; BW-15's
   own oracle).** An implementation that starves the page (empty page for a >32 KiB item
   row) greens the suite although the contract forbids exactly that. *Fix:* in BW-15 post
   one item whose row exceeds 32 KiB and assert `truncated: true`, the typed
   `board_oversize_item` marker, and a non-empty page; while there, follow the report-heavy
   continuation cursor once and assert the remaining reports arrive (closes T7).
3. **Decision 6 rule 4 has no seam-level test.** Nothing proves an exact authorized retry
   returns the original success after live state moved on (recover a lost report receipt
   after the orchestrator closes the item) or that a revoked grant cannot replay. A
   live-state-first replay implementation greens. *Fix:* in a BW-08/BW-11 successor row:
   successful report → S-2 close → exact retry returns the original receipt unchanged;
   revoke the grant → the same effective key draws `board_worker_scope_refused`.
4. **The closed text-frame scanner for `BOARD_CLAIM`/`BOARD_REPORT` has no test (A1-1;
   BW-02's oracle says "closed scanning rejects").** The mock adapter injects parsed kinds,
   so an implementation that wires hub dispatch but never teaches the real adapter scanner
   the two frame kinds greens the suite with a dead production lane. *Fix:* add scanner-level
   rows mirroring `test/scratchpad-33-red.test.mjs`'s `scanForScratchpadWrite` discipline —
   exact-key acceptance, first-balanced-JSON extraction, identity/scope-field rejection,
   second-frame rejection — or name the suite that owns them.
5. **Replay-derived generation invalidation has no test (A2-3; Decisions 2/8).** BW-16/18b
   pin live staleness and BW-12 pins replay of what exists, but no row respawns a member
   (new generation) *before* restart; a replay that resurrects a generation-stale grant as
   active greens. *Fix:* extend BW-12 — kill, respawn the same member Run, release the
   writer lease, reopen, and assert the old grant is replay-derived unusable (a post-restart
   claim attempt with it refuses `board_worker_scope_refused`), with the durable
   generation-record event present in the replayed log.

Non-blocking follow-ups for the implementation wave (tracked, not gating): valid-grant
reachability of `board_item_not_found`/`board_item_not_open` (D3); Decision 6 rule 7
read-key replay and cross-worker caller-key reuse (rule 1); the resurrected-caller report
after expire/re-claim (A4-1); persist-before-deliver ordering for grant mint vs steer (D2);
the durable `context.read` audit receipt's existence and the `boardRunId`/`observedSeq`
projection fields (D5); BW-21's static/source half (grep the lane for new timers/turn
fields); task-status gate positives/negative beyond `paused` (D1); reassignment-variant
lifecycle (D8); remaining smuggled query fields `wave/task/role/viewer/mode` (D5);
tighten BW-05's `/conflict/` to `board_replay_conflict` (T4) and anchor BW-19's
presence-only digest fields (T8); after the claimGrant transport lands, re-run and confirm
the eleven grant-gated rows go red at their *own* named stages (§1 caveat).
