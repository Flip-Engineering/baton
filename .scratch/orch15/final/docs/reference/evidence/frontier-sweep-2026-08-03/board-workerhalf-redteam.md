# Epic #78 — Board worker-half contract: adversarial red-team

> **Reviewer:** board-workerhalf-reviewer · **Attempt:** abfa7cd4-4266-47f1-a09e-5acc4073766c
> **Target:** `docs/reference/evidence/frontier-sweep-2026-08-03/board-workerhalf-contract.md` (v1.0, epic #78, codex-drafted)
> **Mode:** read-only review. The only write target is this file. No `impl/` file was edited.
> **Sourcing convention:** every code claim is grounded `file:line`. Both implementation sources are
> NUL-containing (`impl/src/application-semantics.mjs`, 1991 lines; `impl/src/coordination-store.mjs`,
> 15689 lines), so all reads used `grep -an` / `sed -n` — no whole-file read exceeded 1500 lines.

---

## 0. Verdict (TL;DR)

| Axis | Result |
| --- | --- |
| Ground truth (the 12 anchors) | **12 / 12 VERIFIED ACCURATE.** The contract's empirical foundation is sound; no fabricated or drifted citation. |
| Campaign control law (binding) | **HONORED everywhere** in the contract text. One *tension* noted (the S-2 lease `expiresAt` clock gates grant mint) — the contract correctly scopes it to security-authority and never to worker progress. |
| Per-decision verdicts | **0 CONFIRMED-HOLE** at the contract level. All eight decisions are **DEFENDED** in intent and shape, with **14 NEEDS-AMENDMENT** items (clarifications + one genuine lifecycle gap + two robustness gaps). |
| Strongest | D4 (the fence law) and D8 (the control law) — both match the shipped code precisely and resist every listed red-team target. |
| Weakest | D2 (grant lifecycle event kinds + hardcoded permissions), D6 (idempotency-key namespace), D5 (per-item report pagination). |
| Headline missed hole | **Closing or dropping a board item does not expire its active claim.** The store's close/drop path appends the item successor and the close-Finding and returns without touching `_boardClaims`; `expireBoardClaim` is reachable only from **worker-side** lifecycle hooks (death, task-reassignment, turn-fail, terminalization — 7 call sites in `coordinator.mjs`), never from orchestrator `board.close`/`board.drop`. The contract's report admission checks *active claim + ownership + historical version* but never *item-open* — so a report against a now-closed/dropped item would be admitted. See §5.2. |

**Bottom line:** the contract is red-team-ready in the sense that its authority model, refusal ordering, fence law, and control-law discipline are correct and code-verified. It is *not* yet implementation-ready: the grant state machine names a `revoked` terminal without a revoke *event kind*, the grant `permissions` array is hardcoded (no read-only coordinator-worker grant), the idempotency key namespace is unspecified against a global `_byKey`, per-item report pagination is unresolved, and the close/drop→claim-expiry gap is unaddressed. None of these defeats the contract's security posture; all are addressable by amendment without re-architecting.

---

## 1. Method, scope, and source-handling

**Scope.** The artifact under review is the *contract* (a behavior specification for a future
implementation rung), not the implementation. The red-team therefore asks two questions of each
decision: (a) is the contract's *ground truth* about the shipped code accurate, and (b) is the
contract's *prescription* sound — does it close the hole it names, resist the red-team targets it
lists, honor the binding control law, and omit nothing material? A decision is **CONFIRMED-HOLE**
only if the contract *as written* leaves a defeatable authority/lifecycle path; **DEFENDED** if the
prescription is correct (possibly with clarifying amendments); **NEEDS-AMENDMENT** if it is correct
in spirit but under-specified, ambiguous, or incomplete in a way an implementer could get wrong.

**Source handling.** `grep -l $'\0'` confirms both implementation files contain NUL bytes
(`application-semantics.mjs`, `coordination-store.mjs`), so no line-oriented whole-file read is
safe; every citation was produced by `grep -an` (line-numbered, NUL-safe) or targeted
`sed -n 'A,Bp'`. No single read exceeded ~180 lines (well under the 1500-line ceiling). The
sibling files `coordinator.mjs`, `application.mjs`, `wave.mjs`, `mcp-northbound.mjs`,
`claude-session.mjs`, `messages.mjs` were read the same way for the lane anchors.

**What was *not* done.** No `impl/` file was modified. Cross-document citations inside the contract
(e.g. to `bidirectional-v3-decisions.md` line ranges) were not exhaustively re-verified — this review
audits the contract *against the codebase*, and the control-law provenance was spot-checked only
where it changes a verdict.

---

## 2. Ground-truth verification (the 12 anchors)

All twelve "Code-verified ground truth" anchors were re-checked against the cited line ranges.
**Every one is accurate.** This is the single most important finding: the contract is built on real,
current code, not aspiration.

| # | Contract claim (anchor) | Verified at | Result |
| --- | --- | --- | --- |
| 1 | S-2 authority proof is closed v1 `{authorityDigest, expiresAt, orchestratorLeaseId, schemaVersion}` | `application-semantics.mjs:1166-1170` (`sessionAuthoritySchema`) | ✅ exact |
| 1 | `board.read` requires run-orchestrator lease; five mutations require S-2 + board-fence CAS | `application-semantics.mjs:1183-1191` (`SURFACING_MATRIX_AUTHORITY`) | ✅ exact |
| 2 | `board.read` requires `sessionAuthority, runId, board`; viewer server-derived | `application-semantics.mjs:1401-1405` | ✅ exact |
| 2 | `board.claim`/`board.report` are `profile:'worker'`, `surfaces:[]`, no authority or idempotency field | `application-semantics.mjs:1407-1419` (the ghost rows) | ✅ exact — confirmed ghosts |
| 3 | S-2 seam closes envelope, proves lease, recovers principal, checks board-Run binding, rejects closed Run, digest-binds idempotency, repeats CAS in append gate | `coordination-store.mjs:13621-13791` (`admitBoardCommand`) | ✅ exact |
| 3 | Refusal order hides board/item existence from an unproven caller | `coordination-store.mjs:13658-13706` (lease/binding/run-stop all precede the item lookup at `13707-13710`) | ✅ exact |
| 4 | Claim checks open item + first-active claimant + `expectedBoardFence===boardFence(board)` | `coordination-store.mjs:13908-13918` (`requestBoardClaim`) | ✅ exact |
| 4 | Report binds exact `(itemId,itemVersion,itemDigest)` + bounded body | `coordination-store.mjs:13925-13938` (`submitBoardReport`) | ✅ exact |
| 4 | Closed message factories validate those payload shapes | `messages.mjs:339-366` (`createBoardClaimRequest`/`createBoardReport`) | ✅ exact |
| 5 | Direct store methods return any prior under the key *before* comparing content; `submitBoardReport` requires no active claim/owner/CAS | `coordination-store.mjs:13905,13925` (blind `this._byKey.get(auth?.key)` first line of each) | ✅ exact — the kernel holes are real |
| 5 | Coordinator wrapper derives `owner`/`ownerTask` from a live/paused handle but accepts only an idempotency string as authority | `coordinator.mjs:9965-9989` (`workerId` is a caller-supplied **parameter**; authority is `opts.idempotencyKey`) | ✅ exact |
| 6 | `boardFence` is replay-derived, counts only the five orchestrator transitions | `coordination-store.mjs:13594-13596` (def) + `8271,8283` (the bump sites) | ✅ exact |
| 6 | Claim/report/migration/expiry do not bump `boardFence`; worker death expires claims by version CAS | `coordination-store.mjs:8285-8298` (claim/migrate/expire/report reducers) + `coordinator.mjs:7723-7731` (`_expireBoardClaims`) | ✅ exact |
| 7 | `projectionInputFence` counts `claim_requested`/`claim_expired`/`report_submitted`; `boardSnapshot` appends no read event | `coordination-store.mjs:140-145` (`PROJECTION_INPUT_NONKG_EVENTS`) + `8585-8588` (bump) + `13968-13980` (`boardSnapshot`) | ✅ exact |
| 8 | Projection cache key is `(board, role/workerId, boardFence)` only → stale across claim/report; worker filter hides unowned open items; renderer bounds 512 items / 256 KiB and frames prose | `application.mjs:474-500` (cache key + filter) + `57-63` (renderer bounds, cited via `MAX_BOARD_*`) | ✅ exact |
| 9 | Ordinary MCP reads consume caller S-2 authority, project orchestrator view | `mcp-northbound.mjs:1418-1425` (`_boardAuthorityContext(principal)` is server-context; `projectBoardView(...,'orchestrator'...)`) | ✅ exact |
| 10 | Worker-up pattern is constructive: scanner accepts closed payload, no identity; Coordinator attributes + emits typed result | `claude-session.mjs:85-105` (`scanForScratchpadWrite`, exact-key `{entry,expectedFence,idempotencyKey}`) + `coordinator.mjs:11033-11048` (`scratchpad.write_result` via `appendAttributed`) | ✅ exact |
| 11 | Embedded `send(role,message,options)` delegates to member Run; no `waves.send` row exists | `wave.mjs:350-358` + `grep -an 'waves.send'` returns nothing in the three named files | ✅ exact |
| 12 | Reports are evidence, not completion; only `item_closed`/`item_dropped` change state; benign edit migrates a claim | `coordination-store.mjs:13823-13871` (`_boardSuccessor`) | ✅ exact |

**Additional greenfield confirmations** (things the contract says it will *add*, verified absent
today so the contract is not claiming shipped behavior): `admitWorkerBoardCommand` — absent; any
grant machinery (`grantId`/`grantDigest`/`claimGrant`/`mintGrant`) — absent; `expectedClaimVersion`
in any report schema/admission — absent (it appears only inside the `board.claim_expired` *event
payload* at `coordination-store.mjs:13949`); `waves.send` registry row — absent. The contract
correctly frames D2/D3 and the report-CAS addition as new work.

---

## 3. Campaign control-law audit (the binding law)

The law (contract Seed, citing `bidirectional-v3-decisions.md:111-121`): *controls over agent work
are eval-able, constructive, or conversational — never turn limits or primary clock windows.*
Therefore the contract adds no claim TTL, grant TTL, poll interval, response deadline, or turn
budget.

**Clause-by-clause scan of the contract for forbidden controls:**

| Location | Language | Verdict |
| --- | --- | --- |
| Seed | "adds no claim TTL, grant TTL, poll interval, response deadline, or turn budget" | ✅ honored |
| D2 | "It has no TTL and does not expire at a turn boundary. A new generation needs a newly minted grant." | ✅ honored (generation is a constructive fact, not a timer) |
| D4 | "Worker turn/session fences and `projectionInputFence` are never claim authority" | ✅ honored |
| D5 | page ceilings "16 items / 32 KiB" framed as "defense-in-depth ceiling," cursor staleness is fence-driven | ✅ honored (byte/item caps are resource circuit-breakers, explicitly permitted) |
| D8 | "No acceptance criterion depends on elapsed time, number of turns, polling cadence, or 'report by N.'" | ✅ honored |
| D8 | "The upstream S-2 credential's existing `expiresAt` … is never copied into the worker grant or used to expire a healthy claim" | ✅ honored |
| Non-goals | "No new clocks, turn limits, claim/report deadlines, or polling-cadence controls" | ✅ honored |
| BW-21 | red-first test asserting no new time/turn field | ✅ honored (the suite *enforces* the law) |

**The one tension (DEFENDED, not a violation).** The S-2 proof check the worker grant-mint reuses is
clock-gated: `admitBoardCommand` refuses when `Date.parse(this._clock()) >= Date.parse(lease.expiresAt)`
(`coordination-store.mjs:13660`). So a wall-clock *does* gate a constructive operation — minting a
grant. The contract resolves this correctly and explicitly: the lease `expiresAt` is a
**security-credential** expiry (a principal proving who it is), not a **work-progress** judgment,
and it gates *only* grant mint + ordinary orchestrator ops — never a healthy claim, never a report's
admissibility, never triage completion (D8; Seed). Existing grants and claims outlive the lease.
This is the right reading of the law (security authority may expire on a clock; agent work may not
be judged on one), and it is stated plainly enough that an implementer will not mistake it. **No
amendment required**; flagged only because a clock appears inside a path the contract reuses.

**Net:** the contract honors the control law everywhere it is binding.

---

## 4. Per-decision red-team (D1–D8)

Format per decision: **verdict**, the code evidence that fixes it, a disposition of each
contract-listed red-team target (✅ resisted / ⚠️ resisted-but-needs-text), and any amendment.

### 4.1 Decision 1 — worker is the claim/report actor; reachability is profile-scoped

**Verdict: DEFENDED (2 amendments).**

The constructive pattern this decision rests on is real and verified: `scanForScratchpadWrite`
accepts exactly `{entry, expectedFence, idempotencyKey}` and "Identity is deliberately absent"
(`claude-session.mjs:88-105`); the hub then attributes via the authenticated stream and emits a typed
result back on it (`coordinator.mjs:11040-11048`, `appendAttributed({...kind:'scratchpad.write_result',
actor:'hub'})`). The proposed `BOARD_CLAIM`/`BOARD_REPORT` closed frames are the faithful sibling.

Red-team-target disposition:

- ✅ *caller-named worker/owner/task* — the scanner-accepts-no-identity discipline is exactly the
  `scanForScratchpadWrite` precedent; the store kernel hole it replaces is real
  (`coordinator.mjs:9965` takes `workerId` as a caller **parameter** and `requestBoardClaim`/`submitBoardReport`
  accept `fields.owner` at `coordination-store.mjs:13916,13934`).
- ✅ *sibling process through another worker's handle* — resolved by deriving identity from the
  authenticated stream + grant, not the handle the caller hands in.
- ✅ *paused-at-boundary trailing write mistaken for terminal* — **already mitigated in the shipped
  wrapper**: `requestBoardClaim`/`submitBoardReport` admit `['working','input_required','paused']`
  (`coordinator.mjs:9970,9983`, "Issue #31 §2.1(3): `paused` is live, not terminal"). The new seam
  must preserve this set verbatim.
- ⚠️ *malformed/multiple frames* — the contract says "accepts exactly those keys"; fine, but see
  amendment A1-1 (state the exact-key discipline is the `scanForScratchpadWrite` rule, incl. balanced-JSON extraction).

**Amendment A1-1 (clarification).** Add to D1: "The scanner follows the `scanForScratchpadWrite`
exact-key + first-balanced-JSON rule (`claude-session.mjs:88-105`): any extra key, any second frame
in one scan window, or any identity/scope field (`workerId`,`owner`,`ownerTask`,`actor`,`taskId`,
`runId`,`waveId`,`board`,`boardRunId`,`sessionAuthority`) is rejected before any state lookup. The
live task-status gate admits exactly `working | input_required | paused` (`coordinator.mjs:9970`)."

**Amendment A1-2 (the forward-looking TG2 hole — also listed in §5.3).** The result-emission block
this decision models itself on (`coordinator.mjs:11044-11048`) feeds a successful `ok:true` receipt
into `_observeSteeringCycle(...)` as **TG2/TG3 steering liveness**. Today `_observeSteeringCycle` is
called only for `interaction`, `turn_started`, and `scratchpad.write` (`coordinator.mjs:9145,9275,
10658,11048`) — *not* for any board op. An implementer copying the scratchpad `write_result` block
verbatim for `board.claim_result`/`board.report_result` would silently make a no-op claim/report
satisfy the armed steering cycle. D8 says a report "is conversational evidence … not a progress
timer," but D1 never says the result lane must **not** call `_observeSteeringCycle`. Add to D1:
"A `board.claim_result`/`board.report_result` receipt is hub-admission evidence only and **must not**
feed `_observeSteeringCycle` / any TG2/TG3 liveness arm, unlike `scratchpad.write_result`. Claim/report
are not steering-cycle work." (Cross-ref D5's zero-weight rule, extended from reads to claim/report.)

### 4.2 Decision 2 — `waves.send` mints the claim grant; never sends S-2 authority

**Verdict: DEFENDED on the bearer-token defense; NEEDS-AMENDMENT on grant lifecycle (3 amendments).**

The core defense is correct and code-grounded. S-2 authority is **server context**, not a
client-selected grant field — the precedent is `mcp-northbound.mjs:1419`
(`this._boardAuthorityContext(principal)`) and `admitBoardCommand`'s proof-recovery
(`coordination-store.mjs:13658-13668`: lease looked up by `orchestratorLeaseId`, digest compared to
`lease.session.authorityDigest`, never trusted from the wire beyond shape). So "the orchestrator
injects `sessionAuthority` into the internal admission envelope" is the right shape, and the steer
carrying none of `{sessionAuthority, authorityDigest, orchestratorLeaseId, expiresAt, grantor
session}` is enforceable. "Delivery-before-persistence" is correctly inverted: the grant is appended
*before* the steer is made deliverable (mirroring S-2's `if (!prior) gate()` before construction,
`coordination-store.mjs:13756`).

Red-team-target disposition:

- ✅ *forwarding S-2 as a bearer lease*; ✅ *caller-named grantee/permissions*; ✅ *foreign /
  similarly-named Run*; ✅ *reuse after reattachment under a new generation*; ✅ *fan-out minting
  authority for untargeted members* — all resisted by server-side derivation + the non-transferable
  rebind-to-stream rule.
- ⚠️ *minting before wave/member/board scope checks* — D2 orders authorization-then-mint correctly,
  but see A2-1.
- ❌ *one `waves.send` fan-out* — the embedded `send(role,message,options)` (`wave.mjs:350-358`)
  takes a **caller-named `role`** today. The detached transport must resolve role→memberRun
  server-side and reject an unmatched target rather than forward `role`. D2 says this in prose
  ("authorizes the wave and exact target member"); A2-2 makes it explicit.

**Amendment A2-1 (grant revoke needs an event kind).** D8's state machine draws
`grant: minted -> active -> revoked`, and D2 lists "explicit revoke" as a liveness terminator, but
**no revoke event kind is named** and none exists in the codebase (`grep` for `grant`/`revoke` event
kinds is empty). Claims have `board.claim_expired` (`coordination-store.mjs:13949`); grants need an
equivalent durable kind or replay cannot reconstruct revocation (D6 rule 6 promises byte-identical
grant reconstruction). Add: "A grant terminates by a durable `board.grant_revoked` event (and only
by the named constructive terminators). Replay derives `active`/`revoked` solely from the minted and
revoked events, exactly as claims derive state from `board.claim_requested`/`board.claim_expired`."

**Amendment A2-2 (permissions are hardcoded → no read-only coordinator-worker grant).** The minted
grant hardcodes `permissions:["read","claim","report"]` (D2 envelope). D7 requires a
coordinator-worker that *reads* to triage but "does not gain … S-2 mutation authority" and reports
through *its own* item — i.e. it should **not** claim. With permissions fixed, the
coordinator-worker's grant confers claim/report, so "coordinator-worker does not claim" is enforced
only by self-restraint, not by the grant. Make permissions **orchestrator-selected,
caller-unforgeable**: add "The minting orchestrator selects a subset of `{read,claim,report}`;
executor members receive `{read,claim,report}`, a coordinator-worker receives `{read}`. The
permission set is server-recorded on the grant and checked in D3 step 4; the caller cannot name it."

**Amendment A2-3 (process generation must be durably recorded).** `processGeneration` exists today
only as an in-memory worker-handle property (`coordinator.mjs:110,125,144`). D6 rule 6 promises
replay reconstructs grants byte-identically, and D2 makes generation-replacement a grant terminator —
but there is no durable event recording a generation change, so replay cannot derive staleness. Add:
"Worker (re)attachment appends a durable generation-record event (e.g. `worker.generation_bound`)
carrying `workerId`, `processGeneration`, and member coordinates, so replay reconstructs which grants
a new generation invalidates."

### 4.3 Decision 3 — worker mutations enter one S-2-shaped admission seam

**Verdict: DEFENDED (2 amendments).**

The 7-step ordering is the right mirror of `admitBoardCommand`, and the code proves the ordering is
enforceable: envelope-shape → mutation-shape → proof → lease → principal-recovery → run/binding/
stop → **then** item lookup (`coordination-store.mjs:13658-13710`), with the final CAS repeated in
the append's `appendGate` via `_boardAdmissionInterleave` (`coordination-store.mjs:13770-13779`,
"an injected interleave advances the replay-derived fence before the compare and therefore loses
CAS"). Constant `board_worker_scope_refused` before item lookup is the right existence-hiding
discipline and matches the S-2 refusal-precedence comment (`coordination-store.mjs:13619-13622`).

Red-team-target disposition:

- ✅ *proof after item lookup*; ✅ *grant-id possession treated as authority* (resolved to
  grantId-then-prove-against-stream, step 2); ✅ *board Run/member Run confusion* (step 4 + D2's
  same-wave proof); ✅ *interleaving between validation and append* (the `appendGate` re-check);
  ✅ *distinct refusal text leaking a foreign board/item/wave/worker* (constant refusal).
- ⚠️ *a second adapter calling the raw methods* — resisted **only if** the seam is the sole live
  path; see A3-1.

**Amendment A3-1 (the kernel blind `_byKey` must be fixed at the source, not only routed around).**
D3 says "Direct store methods remain kernel machinery and confer no transported authority." That is
true for *worker* authority (they carry no grant/stream binding). But it is **not** true for the
**blind replay return**: `requestBoardClaim`, `submitBoardReport`, and `expireBoardClaim` all open
with `const prior = this._byKey.get(auth?.key); if (prior) return {ok:true,result:'idempotent',…}`
*before any content comparison* (`coordination-store.mjs:13905,13925,13944`). So any future kernel
caller (a settlement hook, a migration tool, a test fixture) re-introduces the changed-content-returns-
old-success bug that D6 exists to kill. D6's digest-compare must therefore live **in the kernel
methods** (or the contract must explicitly forbid any non-seam caller and gate it with an assertion).
Add: "The digest-vs-prior adjudication (D6 rule 3) is enforced *inside* `requestBoardClaim`/
`submitBoardReport`/`expireBoardClaim`, not only in the worker seam, so no kernel caller can regress
to the blind `_byKey` return. The seam additionally performs authority-before-replay (D6 rule 1)."

**Amendment A3-2 (board-id cross-Run collision is prevented by the binding check — cite it).**
Board ids are caller-chosen 1–128-char strings (`SAFE_BOARD_ID`, `coordination-store.mjs:389`) and
`_boardRunBindings` is keyed by bare board id (`coordination-store.mjs:1109,13703`). Two Runs *could*
pick the same board id; the first post binds it (`8268`) and a later different-Run post is refused
`board_session_mismatch` (`13704-13706`). The worker seam's boardRunId derivation (step 3) must
compare the grant's `boardRunId` against `_boardRunBindings.get(board).runId`. Add: "The seam rejects
when the derived `boardRunId` ≠ the board's recorded binding runId (`coordination-store.mjs:13703`),
so a same-named board on a different Run cannot satisfy a grant for the intended board."

### 4.4 Decision 4 — claim CAS and report CAS are deliberately different

**Verdict: DEFENDED — the strongest decision, with one clarifying amendment.**

The fence law is normative *and* matches the shipped reducers exactly:

- `boardFence` bumps only on the five orchestrator transitions
  (`coordination-store.mjs:8271,8283`); `board.claim_requested`/`_migrated`/`_expired`/`report_submitted`
  do not (`8285-8296`). ✅ matches D4 "does not make worker traffic bump `boardFence`."
- Claim migration under stable `itemId`: `board.claim_migrated` carries `{fromVersion,toVersion,
  boardFence}` and updates the claim's `itemVersion`/`boardFence` but **leaves `version` and
  `active` untouched** (`coordination-store.mjs:8290-8292`). ✅ matches D4 "benign retitle migrates
  the active claim."
- Report binds the historical version: `submitBoardReport` resolves the record from
  `_boardItemHistory` by exact `(itemVersion,itemDigest)` (`coordination-store.mjs:13931-13936`). ✅
  matches D4 "the worker may report the exact older version it observed."
- First-active-claimant wins: `requestBoardClaim` returns `conflict` if an active claim exists
  (`coordination-store.mjs:13915`). ✅

Red-team-target disposition — **every target resisted by the law as stated**: ✅ worker turn-fence
for claim; ✅ board fence for report; ✅ report with no active claim (D4 adds ownership+active);
✅ report after expiry/reassignment; ✅ report against another worker's claim; ✅ close-on-report
escalation; ✅ benign retitle retry storm (migration preserves the claim, no re-claim needed); ✅
self-invalidating concurrent claimants (claim/report don't bump boardFence, so a sibling claim isn't
CAS-evicted by a report).

**Amendment A4-1 (claimVersion is weak alone — state why ownership is the real teeth).** The
shipped reducer sets `version:1` at claim creation (`8286`) and bumps it **only** on expiry
(`8294`: `version: old.version + 1`); migration does not bump it (`8290-8292`). So for any *active*
claim `claimVersion === 1`, and after a worker dies and a *new* worker re-claims the same item, the
new claim is again `version:1`. Therefore `expectedClaimVersion` alone does **not** distinguish the
old owner from the new owner — a resurrected/reassigned caller passing `expectedClaimVersion:1`
would version-match the successor claim. The ownership check (D4 "owned by the derived
`(workerId,taskId)`") is what actually rejects it. D4 already requires ownership, so this is a
clarification, not a fix: add "Note `claimVersion` is monotonic only across the active→expired
transition and resets to 1 on re-claim (`coordination-store.mjs:8286,8294`); the report CAS is
therefore *necessary but not sufficient* — admission rejects primarily on the active-claim owner
`(workerId,taskId)` match, with `expectedClaimVersion` as the concurrent-close guard."
### 4.5 Decision 5 — worker board reads are grant-scoped L1 reads

**Verdict: DEFENDED on scope/freshness/cursor; NEEDS-AMENDMENT on per-item report pagination.**

The relaxation is correctly minimal and the freshness fix is real: today's worker view is keyed only
on `boardFence` and hides unowned open items (`application.mjs:483-501`:
`cacheKey='${board} ${role}:${workerId} ${boardFence}'` and filter
`role==='orchestrator' || item.owner===workerId || board===workerId`). D5 replaces the key with both
`boardFence` **and** `projectionInputFence` — and the latter genuinely moves on claim/report/expiry
(`coordination-store.mjs:140-145,8585-8588`), so BW-14's staleness hole is closable exactly as
described. The cursor digest binding both fences plus grant/board/member coordinates is sound, and
"no terminal item whose reports can force an empty unpageable view" is the right invariant.

Red-team-target disposition: ✅ board/viewer smuggling (schema rejects those fields, like
`scanForScratchpadWrite`); ✅ grant-as-project-read-token (one board only); ✅ cross-wave/cross-repo
(scope checks in D3 step 4); ✅ hiding unowned open items (D5 removes the owner/board-named filter
for granted reads); ✅ cache staleness after non-fence-bumping claim/report (dual-fence key); ✅
cursor reuse after scope/fence change (digest-bound); ✅ raw report-body injection (single BD3
renderer, `wrapProse`); ✅ reads counted as progress (zero weight, no board event — `boardSnapshot`
appends none, `coordination-store.mjs:13968-13980`); ✅ read append perturbing claim CAS (reads are
non-evented).

**Amendment A5-1 (per-item report oversize is named as a target but not resolved).** D5 caps a page
at 16 items / 32 KiB and offers "report continuation … stable by `eventSeq`," and BW-15 asserts no
silent loss — but the contract never says what happens when **one item's reports alone exceed 32
KiB**. The current renderer caps at `MAX_BOARD_ITEMS`/`MAX_BOARD_VIEW_BYTES` by shedding *trailing
items* (`application.mjs:517-524`) and has **no per-item report cap**; a report-heavy item would blow
the page and, under a naïve page loop, starve forever. Add: "A page bounds reports-per-item-per-page
(e.g. the item row plus its earliest N reports by `eventSeq`, N chosen so the serialized page stays
≤32 KiB); when an item has further reports, `nextCursor` carries an in-item report continuation keyed
by `(itemId, lastReportSeq)` in addition to the board page position. An item whose own row exceeds
32 KiB is itself truncated with `truncated:true` and a typed `board_oversize_item` marker — never an
empty page."

### 4.6 Decision 6 — idempotency and replay bind content and authority

**Verdict: DEFENDED in intent (the blind `_byKey` fix is the heart); NEEDS-AMENDMENT on namespace + locus.**

Rule 1 (authority before receipt lookup) is exactly the S-2 ordering
(`coordination-store.mjs`: proof/lease/binding/run all precede the `_byKey` read at `13711-13712`),
so a foreign worker cannot discover another's receipt. Rule 3 (changed content/authority under the
effective key → `board_replay_conflict`, never the old success) is the correct fix for the shipped
blind return (`13905,13925,13944`). Rule 4 (exact authorized retry wins over later live-state) is
consistent with S-2's `if (prior)` branch (`13756-13775`). Rule 5 (two distinct claim keys race at
the final gate) is exactly `requestBoardClaim`'s `conflict`/`stale_board_fence`
(`coordination-store.mjs:13915-13917`).

Red-team-target disposition: ✅ the blind `_byKey` return (rule 3 kills it); ✅ changed body/item/
grant under one key; ✅ replay after grant revocation (rule 1 authority-first); ✅ duplicate grant/
steer on retry; ✅ restart losing freshness fences (replay-derived, `8585-8588`); ⚠️ *key collision
between workers or operation kinds* — see A6-1; ⚠️ *a read retry silently relabeled current* — D6
rule 7 forbids it, good.

**Amendment A6-1 (effective-key namespace is unspecified; the index is global).** The replay index
is a single global `Map` keyed by the raw caller key: `this._byKey = new Map()`
(`coordination-store.mjs:1081`) and `_byKey.set(event.idempotencyKey, …)` (`1307,1375,1453`). D6
says "server-namespaced idempotency keys" but never defines the namespace. With the digest-compare
(rule 3) in place, a cross-worker/cross-operation **collision is *safe*** (it becomes
`board_replay_conflict`, not a silent wrong-receipt) — but it is a **liveness** bug: an authorized
worker B whose legitimate report happens to reuse worker A's key string is wrongly refused and must
re-key. The MCP path already namespaces (`mcp-northbound.mjs:1424`:
`'mcp.observe:'+hash({name,args,callId})`). Add: "The effective replay key is
`namespacedKey = '<opKind>:' + grantDigest + ':' + callerKey` (opKind ∈
`{board.claim,board.report,grant.mint,context.read}`), mirroring the MCP prefix convention, so
cross-worker and cross-operation key-string collisions cannot occur. The request *digest* (rule 3)
remains the authoritative content/authority comparison."

**Amendment A6-2 (where does the digest-compare live?).** Tied to A3-1: state that rule 3 is
enforced in the kernel methods, not only the seam, so the exact-retry-vs-`board_replay_conflict`
behavior is independent of call path.

### 4.7 Decision 7 — the claim/report envelope is what orchestrators/coordinator-workers triage

**Verdict: DEFENDED on shape/attribution; NEEDS-AMENDMENT to name the projection that must change.**

The envelope is closed and server-owned, `body` is visibly untrusted, and "delivery ≠ consumption" /
"presence ≠ acted-on" is the correct anti-injection stance (and matches the store-level
`UNTRUSTED_WORKER_TITLE` frame already applied in `boardSnapshot`, `coordination-store.mjs:13974`).
The #74 loop (post → grant → read/contend/claim/report → coordinator-worker triage → orchestrator
close) is executable on these primitives.

Red-team-target disposition: ✅ forged attribution (clients cannot submit claim/report fields); ✅
delivery-as-consumption; ✅ coordinator-worker self-escalating to wave control (it has no
`waves.send`); ✅ free worker-to-worker messaging (none granted); ✅ report-body-as-instruction
(prose-framed); ✅ closed/dropped item presented as claimable (state is in the envelope); ⚠️ *triage
cache failing to observe a report because boardFence did not move* — D5's dual-fence key fixes this,
but only if the **orchestrator's** projection also adopts it; see A7-1.

**Amendment A7-1 (`projectBoardView` must be extended, not only the new worker lane).** D7 lists
`claimVersion` and `grantDigest` in the envelope and BW-19 requires S-2 `board.read` to expose them —
but the shipped orchestrator projection omits both: `projectBoardView` emits
`claim:{owner,itemVersion,boardFence}` and `reports:[{itemVersion,itemDigest,owner,body}]`
(`application.mjs:505-513`) with **no `claimVersion`, no `grantDigest`, no `createdEvent`/`eventSeq`**.
D7 implies the extension but never names `projectBoardView`. Add: "The orchestrator's existing
`board.read` projection (`application.mjs:474` `projectBoardView`) is extended to emit the full D7
claim/report envelope — `claimVersion`, `grantDigest`, `createdEvent`/`eventSeq` — and to key its
cache on both `boardFence` and `projectionInputFence`, so an orchestrator re-read after a claim/
report observes the new envelope even though `boardFence` did not move. This change is in-scope for
#78, not deferred to the worker lane alone."

### 4.8 Decision 8 — lifecycle and control remain event-based

**Verdict: DEFENDED — the control law is honored everywhere; 2 carry-over amendments (event kinds).**

This is the contract's strongest section. The state machines are driven by constructive facts
(same member identity, active task version/generation, live Run/wave, no revoke) and the control law
is affirmed verbatim ("No acceptance criterion depends on elapsed time, number of turns, polling
cadence, or 'report by N'"). Worker lifecycle already does the right thing: `_expireBoardClaims`
(`coordinator.mjs:7720-7731`) is wired into seven terminal/transition hooks — task transition/
reassignment (`7491-7492`), turn-fail (`11284-11285`), terminalization (`11592-11593`), `11680-11681`,
replay-failed (`12432-12433`), claimed-without-spawn (`12666-12667`) — each version-CAS-expiring via
`expireBoardClaim` (`coordination-store.mjs:13943-13950`), the exact terminal machinery D8 prescribes
for claims. (So D8's "reassignment/terminalization expire claims" is grounded in shipped code.)

Red-team-target disposition: ✅ hidden TTL; ✅ revoke-on-every-turn; ✅ poll-frequency-as-liveness;
✅ report deadlines as progress gates; ✅ lease-expiry falsifying a properly minted grant (D8
explicitly forbids); ✅ replay resurrecting an expired claim (version CAS + replay-derived); ⚠️
*terminal worker leaving a wedged active claim* — true for **death/reassignment** (reaped), but
**not** for orchestrator close/drop; see §5.2 (the headline hole); ⚠️ *replay resurrecting a revoked
grant* — only once A2-1's revoke event exists.

**Amendment A8-1 (carry-over from A2-1).** Name `board.grant_revoked` and the generation-bound event
so the grant half of D8 is replay-complete.

**Amendment A8-2 (the close/drop lifecycle gap — headline, detailed in §5.2).** D8's claim machine
is `absent -> active -> expired`, and expiry today is reachable only from **worker-side** hooks
(`_expireBoardClaims`, the seven call sites above) — never from an orchestrator `board.close`/
`board.drop`. Closing or dropping an item does **not** expire its claim
(`coordination-store.mjs:13850-13866` close path touches only the item + Finding; migration branch
`13867-13872` fires only for retitle/reorder). D4's report admission checks *active claim + ownership
+ historical version* but never *item-open* — so an orphaned active claim on a closed/dropped item
keeps admitting reports. Add to D8: "An orchestrator `board.close`/`board.drop` transition expires
the item's active claim in the same batch (a `board.claim_expired` sibling event, owner=`policy`,
key=`board.claim_expired:<itemId>:<version>:item_<closed|dropped>`), mirroring `_expireBoardClaims`;
and report admission additionally requires the item's current state is `open`."

---

## 5. Cross-cutting attack axes

### 5.1 Authority — identity derivation, injection lanes, replay/idempotency, scope leaks

- **Identity derivation.** Sound. The contract consistently replaces the shipped caller-supplied
  identity (`coordinator.mjs:9965` `workerId` parameter; `coordination-store.mjs:13916,13934`
  `fields.owner`) with stream+grant-derived identity, on the verified `scanForScratchpadWrite`
  template (`claude-session.mjs:88-105`, "Identity is deliberately absent"). No lane lets a worker
  name another worker.
- **Injection lanes.** Sound and symmetric. The down-channel worker→hub lane is the closed-text
  scanner (BOARD_CLAIM/BOARD_REPORT); the hub→worker result lane is `appendAttributed`
  (`coordinator.mjs:11040-11048`). The one gap is A1-2: the result lane must **not** be wired to
  `_observeSteeringCycle` for claim/report (today it is, for scratchpad). Without A1-2 a worker could
  satisfy armed-steering liveness (TG2) with a no-op report — a liveness-injection, not a privilege
  escalation.
- **Replay/idempotency.** Sound *given* A3-1/A6-1/A6-2. Authority-before-receipt is verified against
  S-2; the digest-compare kills the shipped blind return. The residual risk is namespace
  under-specification (A6-1) and the locus of the digest-compare (A3-1) — both robustness, not
  authority, gaps.
- **Scope leaks.** Sound. One-board grants, constant `board_worker_scope_refused` before existence
  lookup, boardRunId-vs-binding check (A3-2), and no `waves.send`/nested-orchestration for workers.
  The one scope concern is A2-2: hardcoded `permissions` over-grants a coordinator-worker
  (read+claim+report where only read is intended) — a scope **widening**, mitigatable only by
  making permissions orchestrator-selected.

### 5.2 Lifecycle — ordering, crash recovery, retention, freshness

- **Ordering.** Sound. D3's 7-step ordering is the verified S-2 ordering; the in-append CAS re-check
  (`_boardAdmissionInterleave`, `coordination-store.mjs:13770-13779`) closes the check-then-write
  window BW-06 targets.
- **Crash recovery / replay.** Sound for claims/reports/migration/expiry and both freshness fences
  (all replay-derived, `8285-8296,8585-8588`). **Incomplete for grants**: A2-1 (no revoke event) and
  A2-3 (no durable generation record) mean grant state is not yet replay-reconstructible as D6
  rule 6 promises. Without them, a store restart cannot derive `active`/`revoked` or
  generation-staleness — the single most material correctness gap.
- **Freshness.** Sound. `projectionInputFence` moves on exactly the non-fence-bumping claim/report
  traffic the cache must observe (`coordination-store.mjs:140-145,8585-8588`); D5's dual-fence key
  closes BW-14 — *provided* the orchestrator projection adopts it too (A7-1).
- **Retention (the headline hole).** ⚠️ **Closing/dropping an item does not retire its claim.**
  `closeBoardItem`/`dropBoardItem` → `_boardSuccessor` writes the item successor + (on close) the
  Finding and returns; the migration branch fires only for retitle/reorder
  (`coordination-store.mjs:13850-13872`), and the close path never touches `_boardClaims`. This is
  structural, not incidental: the store has **no back-reference to the coordinator's reap machinery**
  (`grep -an '_expireBoardClaims\|coordinator\.' coordination-store.mjs` → nothing), so an
  orchestrator S-2 close/drop — a pure store mutation — has no path to retire a worker claim. The
  claim-reap pattern itself is mature and well-wired on the *worker* side: `_expireBoardClaims`
  (`coordinator.mjs:7720-7731`) is invoked from seven hooks — task transition `7491-7492`
  (`task_${to}`, i.e. **reassignment**), turn-fail `11284-11285`, terminalization `11592-11593`
  (`task_${terminalStatus}`), `11680-11681`, replay-failed `12432-12433`, and
  claimed-without-spawn `12666-12667` — each version-CAS-expiring via `expireBoardClaim`
  (`coordination-store.mjs:13943-13950`). So D8's "reassignment/terminalization expire claims" is
  *grounded*, not invented. What is conspicuously absent is an **orchestrator-side** reap on
  `board.close`/`board.drop`. Net: a closed/dropped item can carry an **orphaned active claim**, and
  because `submitBoardReport` checks history-binding + (after D4) active-claim + ownership but
  **never item-open**, a report against a terminal item would be admitted. D4 says reports "leave
  item state unchanged" and only an S-2 successor closes — but it does not say report admission
  requires the item be open, nor that close/drop expires the claim. **Fix: A8-2** (expire-on-close +
  item-open report gate). Because the reap pattern already exists seven times over, the amendment is
  a low-risk, well-precedented addition rather than new machinery. This is the one finding that could
  let stale/terminal evidence enter the triage envelope; it is a retention/freshness defect, not an
  authority bypass.

### 5.3 Completeness — what the contract forgot

Ranked by materiality:

1. **Close/drop does not expire the item's active claim, and report admission never checks item-open**
   (A8-2). The contract's own invariant "only `item_closed`/`item_dropped` change item state" is
   preserved, but the *consequence* — that a terminal item should stop accepting reports — is
   unstated and unenforced. **Most material.**
2. **Claim/report result must not feed TG2 steering liveness** (A1-2). The scratchpad precedent
   wires `ok`→`_observeSteeringCycle`; copying that block for claim/report creates a no-op-liveness
   lane. The contract forbids it *in spirit* (D8 "not a progress timer") but not *in the lane spec*.
3. **Grant permissions are hardcoded** (A2-2) — no read-only grant, so the coordinator-worker's
   "reads, doesn't claim" property is unenforceable at the grant layer.
4. **Grant revoke + generation-change have no durable event** (A2-1/A2-3/A8-1) — grants are not
   replay-reconstructible as promised.
5. **Idempotency effective-key namespace unspecified** (A6-1) against a verified-global `_byKey` —
   a liveness (false-conflict) gap, safe-but-fragile.
6. **Per-item report pagination unresolved** (A5-1) — a report-heavy item can starve a page.
7. **Kernel blind `_byKey` fixed only at the seam, not the source** (A3-1) — a latent regression
   for any future kernel caller.
8. **`projectBoardView` extension not named** (A7-1) — the orchestrator's own read won't gain the
   CAS/provenance fields unless #78 explicitly owns it.

None of (1)–(8) is a defeatable authority path. (1) is a genuine lifecycle gap; (2)–(8) are
spec-completeness gaps that an implementer could otherwise get wrong.

---

## 6. Amendment register (consolidated, deduplicated)

Fourteen items. Each is a proposed *addition* (the contract's existing text is correct; these make
it implementation-proof). Citations are the code evidence; the "Add:" text is suggested contract
language.

| ID | Decision | Theme | Amendment (summary) |
| --- | --- | --- | --- |
| A1-1 | D1 | scanner discipline | Cite `scanForScratchpadWrite` exact-key + balanced-JSON rule; admit task-status `working\|input_required\|paused`. |
| A1-2 | D1/D8 | **missed hole** | `board.claim_result`/`board.report_result` must **not** call `_observeSteeringCycle`/feed TG2 (unlike `scratchpad.write_result`). |
| A2-1 | D2/D8 | **missed hole** | Name a durable `board.grant_revoked` event; replay derives grant `active`/`revoked` from mint+revoke only. |
| A2-2 | D2/D7 | **missed hole** | Make grant `permissions` orchestrator-selected (executor=`{read,claim,report}`, coordinator-worker=`{read}`); caller-unforgeable. |
| A2-3 | D2/D8 | **missed hole** | Add a durable generation-bound event so replay reconstructs generation-staleness of grants. |
| A3-1 | D3/D6 | kernel safety | Enforce the digest-vs-prior adjudication *inside* the kernel store methods, not only the seam. |
| A3-2 | D3 | cite mechanism | Reject when derived `boardRunId` ≠ `_boardRunBindings.get(board).runId` (`coordination-store.mjs:13703`). |
| A4-1 | D4 | clarify | `claimVersion` is monotonic only across active→expired and resets on re-claim; ownership `(workerId,taskId)` is the real report-CAS teeth. |
| A5-1 | D5 | **missed hole** | Bound reports-per-item-per-page + in-item `eventSeq` continuation; truncate (not empty-page) an oversize item row. |
| A6-1 | D6 | namespace | Effective key = `<opKind>:<grantDigest>:<callerKey>` (mirror MCP prefix); digest remains authoritative. |
| A6-2 | D6 | locus | Digest-compare enforced in-kernel (ties to A3-1). |
| A7-1 | D7 | cite mechanism | Extend `projectBoardView` (`application.mjs:474`) to emit `claimVersion`/`grantDigest`/`eventSeq` and dual-fence its cache; in-scope for #78. |
| A8-1 | D8 | (≡A2-1) | Name revoke + generation events for replay-complete grant state. |
| A8-2 | D8 | **headline hole** | `board.close`/`board.drop` expires the item's active claim in-batch (`board.claim_expired`, owner `policy`); report admission additionally requires item state `open`. |

---

## 7. Final verdict and readiness call

**Authority posture: holds.** No CONFIRMED-HOLE. The contract's identity-derivation,
authority-before-replay ordering, refusal precedence, in-append CAS, bearer-token resistance,
non-transferable grant rebind, and one-board scope discipline are all correct and grounded in
verified code. The ghost rows (`application-semantics.mjs:1407-1419`), the blind `_byKey` kernel
returns (`coordination-store.mjs:13905,13925,13944`), the lease-as-only-authority wrapper
(`coordinator.mjs:9965-9989`), and the `boardFence`-only/stale projection (`application.mjs:474-501`)
are exactly the defects the contract sets out to close, and each is closed by the corresponding
decision as written.

**Control law: honored.** No clock/turn/cadence controls agent work anywhere in the contract; the
one clock (S-2 lease `expiresAt`) is correctly confined to security-authority and explicitly
excluded from worker grant/claim/report/triage.

**Readiness: conditionally green.** The contract is **red-team-ready but not yet
implementation-ready**. Before the red-first suite (BW-01…BW-21) can honestly go green, fold in the
fourteen amendments above. The non-negotiable ones — the four that change behavior, not just text —
are:

- **A8-2** (close/drop must expire the claim + report requires item-open) — closes the terminal-item
  evidence leak, the review's headline finding;
- **A2-1 / A2-3 / A8-1** (durable revoke + generation events) — without these, grant state is not
  replay-reconstructible and BW-12 cannot pass honestly;
- **A2-2** (selectable permissions) — without this the coordinator-worker over-grant is
  unenforceable and BW-13/BW-19's "coordinator-worker reads but does not claim" is only
  self-imposed;
- **A1-2** (no TG2 credit for claim/report) — without this a worker can satisfy armed-steering
  liveness with a no-op report, contradicting D8.

The remaining ten are clarifications/citations that protect an implementer from regressing the
kernel (`A3-1`, `A6-2`), mis-keying replay (`A6-1`), starving pages (`A5-1`), or leaving the
orchestrator projection stale (`A7-1`).

**One-line summary for the campaign ledger:** *#78's authority model is sound and fully
code-grounded (12/12 anchors verified, 0 confirmed holes, control law honored); it needs fourteen
amendments — four behavioral (close-expires-claim, durable grant revoke/generation events, selectable
permissions, no-TG2-for-claim/report) and ten clarifying — before its red-first suite can go green
honestly.*
