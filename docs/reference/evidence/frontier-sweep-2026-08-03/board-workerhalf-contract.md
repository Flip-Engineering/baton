# Epic #78 — Board worker-half contract (v1.0)

Fold: post-red-team v1.0 — the verdicts of
`docs/reference/evidence/frontier-sweep-2026-08-03/board-workerhalf-redteam.md` are folded in
place on 2026-08-03 (0 confirmed holes, 14 amendments A1-1…A8-2 applied, 0 verdicts rejected).
File:line citations added by this fold were re-verified against `impl/src/` on 2026-08-03.

Status: implementation contract, red-team-folded. This epic is the
Lane-A L2 consumer of the Bidirectional-v3 L1 spine. It specifies behavior; it does not amend
implementation in this artifact.

## Seed

The frontier sweep names #78 as the small board-worker-half lane: make `board.claim` and
`board.report` real, allow bounded worker-scoped board reads, and let `waves.send` carry the
claim grant. It depends on L1's authenticated read/message conventions and feeds #74's
worker-orchestrated triage loop
(`docs/reference/evidence/frontier-sweep-2026-08-03/frontier-sweep.md:40-43`). The first real
consumer is explicit: a coordinator-worker decomposes work, swarm members execute it, the
coordinator triages through claim/report, and large questions still reach the orchestrator
through `DECISION_REQUEST` (`frontier-sweep.md:85-93`).

The downstream worker review scored boards 2/5 because the orchestrator half is real while
the worker half remains a registry ghost (`docs/PROGRESS.md:463-471`). The BD3 synthesis calls
the board the shared-task-list and handoff substrate #74 needs, while retaining the system's
directionality law: worker identity is stream-bound, down-channel prose is framed, and lateral
coordination remains mediated
(`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:96-108,131-159`).

The campaign control law is binding here: controls over agent work are eval-able,
constructive, or conversational, never turn limits or primary clock windows
(`bidirectional-v3-decisions.md:111-121`). Therefore this contract adds no claim TTL, grant
TTL, poll interval, response deadline, or turn budget. Authority and liveness change on durable
events. The existing S-2 session lease may expire as a security credential; its expiry is not
used to judge worker progress.

## Code-verified ground truth

The anchors below were checked in this worktree with NUL-safe `grep -an` searches and targeted
`sed -n` reads. Line numbers refer to the inspected source as of 2026-08-02.

1. The S-2 authority proof is a closed v1 shape
   `{authorityDigest, expiresAt, orchestratorLeaseId, schemaVersion}`
   (`impl/src/application-semantics.mjs:1165-1170`). Transported `board.read` presently requires
   the run-orchestrator lease; the five orchestrator mutations require S-2 authority and, where
   applicable, a board-fence CAS (`application-semantics.mjs:1176-1191`).

2. The orchestrator board rows are live on embedded and MCP. `board.read` requires
   `sessionAuthority`, `runId`, and `board`; its viewer is server-derived
   (`application-semantics.mjs:1348-1405`). In contrast, `board.claim` and `board.report` have
   `profile: 'worker'` and `surfaces: []`; their schemas also carry no authority or
   idempotency field (`application-semantics.mjs:1407-1419`).

3. S-2's store seam closes the envelope before lookup, proves the active orchestrator lease,
   recovers the principal instead of accepting one, checks board-to-Run binding, rejects a
   closed Run, digest-binds an idempotency key, and repeats the board-fence/item-parent check in
   the append's before-write gate
   (`impl/src/coordination-store.mjs:13619-13799`). Its refusal order prevents an unproven caller
   from learning whether a board or item exists (`coordination-store.mjs:13674-13715`).

4. The underlying worker-side store machinery exists. A claim checks an open item, first-active
   claimant, and `expectedBoardFence === boardFence(board)` before appending
   `board.claim_requested` (`coordination-store.mjs:13903-13920`). A report binds an exact
   historical `(itemId, itemVersion, itemDigest)` and a bounded body before appending
   `board.report_submitted` (`coordination-store.mjs:13924-13938`). Closed message factories
   already validate those public payload shapes (`impl/src/messages.mjs:339-366`).

5. Those direct store methods are not a worker authority boundary. They return any prior event
   found under the supplied key before comparing request content; `submitBoardReport` does not
   require an active claim, the claim's owner, or a claim-version CAS
   (`coordination-store.mjs:13905-13918,13925-13938`). The Coordinator wrapper improves identity
   by deriving `owner` and `ownerTask` from a live/paused worker handle, but still accepts only an
   arbitrary idempotency string as authority (`impl/src/coordinator.mjs:9965-9989`).

6. The fence laws are intentionally different. `boardFence(board)` is replay-derived and counts
   only the five orchestrator-authority item transitions
   (`coordination-store.mjs:13590-13602,8259-8284`). Claim/report/migration/expiry events do not
   bump it (`coordination-store.mjs:8285-8298`). Worker death already expires active board claims
   with a claim-version CAS through the same terminal lifecycle as scratch claims
   (`coordinator.mjs:7717-7733`; `coordination-store.mjs:13942-13950`).

7. Claim/report nevertheless change what readers must see. The store explicitly counts
   `board.claim_requested`, `board.claim_expired`, and `board.report_submitted` in the
   replay-derived `projectionInputFence`
   (`coordination-store.mjs:140-146,8579-8589`). `boardSnapshot` returns all items, active claims,
   and reports, and appends no board-domain read event
   (`coordination-store.mjs:13963-13979`).

8. The current projection is not yet suitable for a shared worker task list. Its cache key is
   only `(board, role/workerId, boardFence)` and therefore can remain stale across claim/report
   traffic. It also shows a worker only items already owned by that worker or items on a board
   named exactly for that worker, hiding unowned open work on a shared board
   (`impl/src/application.mjs:476-500`). The renderer does already bound the view to 512 items
   and 256 KiB, marks truncation, and frames worker-authored titles, details, and report bodies
   as untrusted prose (`application.mjs:57-63,500-525`).

9. Ordinary MCP reads consume the caller's S-2 session authority and project the orchestrator
   view (`impl/src/mcp-northbound.mjs:1418-1425`). This is the path whose authority must remain
   unchanged; the worker relaxation belongs to the authenticated L1 worker-read lane, not to an
   uncredentialed ordinary `board.read` call.

10. The landed worker-up pattern is constructive: `SCRATCHPAD_WRITE` accepts no worker, task, or
    Run identity, because the adapter scans a closed payload on an authenticated per-worker
    stream (`impl/src/claude-session.mjs:85-105`); Coordinator then attributes the write and
    emits a typed result (`impl/src/coordinator.mjs:11033-11048`). BD3-A specifies the matching
    `CONTEXT_READ`/`context.read_result` lane and requires server-derived board-to-Run scope,
    closed rendering, zero promotion weight, and no TG2 progress credit
    (`bidirectional-v3-decisions.md:10-35,205-227`).

11. Current wave steering has an embedded `send(role, message, options)` handle which delegates
    to the member Run (`impl/src/wave.mjs:350-358`). In the inspected registry, the only
    `waves.*` row is `waves.attach` (`application-semantics.mjs:1527-1541`); `grep -an` finds no
    `waves.send` row in `application-semantics.mjs`, `application.mjs`, or
    `mcp-northbound.mjs`. The packaging contract owns landing the detached ordinary
    `waves.send` surface; #78 owns the optional claim-grant semantics that ride it.

12. Existing board reports are evidence, not completion. Reporting appends a report record;
    only the orchestrator-authority `board.item_closed`/`board.item_dropped` transitions change
    item state, and a benign retitle/reorder migrates an active claim
    (`coordination-store.mjs:13823-13871,13890-13900`). #78 must not silently turn a worker report
    into an orchestrator close.

## Contract question

Can the orchestrator use `waves.send` to mint and deliver a non-transferable, member-bound grant
for one shared board; can that worker then read, claim, and report through its authenticated L1
lane with the correct board-fence and claim-version CAS; and can both an orchestrator and an
authorized coordinator-worker read a fresh, bounded, provenance-framed envelope of the swarm's
claims/reports — without disclosing the orchestrator's S-2 lease, weakening ordinary board
authority, creating a bearer token, or using a clock/turn limit as control?

## Decisions

### 1. The worker is the claim/report actor; reachability is profile-scoped

`board.claim` and `board.report` become real **worker-profile** operations. Their registry rows
gain the embedded worker surface and live methods; the provider adapters expose them through two
closed text frames on the already-authenticated worker event stream:

```text
BOARD_CLAIM: {"grantId":"...","itemId":"...","expectedBoardFence":7,"idempotencyKey":"..."}
BOARD_REPORT: {"grantId":"...","itemId":"...","itemVersion":2,"itemDigest":"<64hex>","expectedClaimVersion":1,"body":"...","idempotencyKey":"..."}
```

The scanner accepts exactly those keys and the existing field bounds. The discipline is the
`scanForScratchpadWrite` exact-key + first-balanced-JSON rule
(`impl/src/claude-session.mjs:86-105`): any extra key, any second frame in one scan window, or
any identity/scope field is rejected before any state lookup. It accepts no `workerId`,
`owner`, `ownerTask`, `actor`, `taskId`, `runId`, `waveId`, `board`, `boardRunId`, or
`sessionAuthority`. Coordinator derives worker, task, task version, member Run, provider session,
and process generation from the authenticated stream; the live task-status gate admits exactly
`working | input_required | paused` (`impl/src/coordinator.mjs:9972,9985`). The durable
claim/report event's actor is that worker principal. The orchestrator is the grantor, never a
caller-named substitute actor;
the hub/system actor remains limited to migration and version-CAS expiry.

Every attempt produces `board.claim_result` or `board.report_result` on the same worker stream,
including typed refusals. A valid result is also durable in the worker operational stream so a
lost provider frame is inspectable. These operations do not list on ordinary operator MCP, Web,
or CLI inventories. An eventual worker-authenticated MCP transport may project the same worker
profile, but an ordinary orchestrator MCP connection never impersonates it.

A claim/report result receipt is hub-admission evidence only: it must **not** feed
`_observeSteeringCycle` or any TG2/TG3 liveness arm. The `scratchpad.write_result` block this
lane is modeled on does feed TG2 (`impl/src/coordinator.mjs:11045-11048`; today the only call
sites are `coordinator.mjs:9145,9275,10658,11048`, none for a board op); that wiring is
deliberately not copied. Claim/report are not steering-cycle work (Decisions 5 and 8).

**Defended as written (red-team D1):** the no-identity scanner and stream-derived attribution
resist the caller-named-identity, sibling-handle, and paused-trailing-write targets as specified
(`impl/src/claude-session.mjs:86-105`; `impl/src/coordinator.mjs:11041-11044`).

**Red-team targets:** caller-named worker/owner/task fields; an orchestrator invoking a worker row;
a sibling process writing through another worker's handle; a paused-at-boundary trailing write
being mistaken for terminal; malformed or multiple frames; a protocol adapter that bypasses the
canonical registry/live admission path; a copied scratchpad result block letting a no-op
claim/report arm TG2/TG3 steering liveness.

### 2. `waves.send` mints the claim grant; it never sends S-2 authority to a worker

The detached ordinary `waves.send` transport input gains one optional, closed `claimGrant`
request:

```text
claimGrant: {boardRunId, board}
```

The caller does not name a grantee. The server first resolves the requested role to a member Run
server-side — rejecting an unmatched target rather than forwarding a caller-named `role` (the
embedded handle takes a caller-named role today, `impl/src/wave.mjs:350-358`) — then authorizes
the wave and exact target member
(wave id, role/member Run, current task, task version, worker, and process generation), then
injects the authenticated orchestrator principal's `sessionAuthority` into the internal
admission envelope and passes `sessionAuthority + boardRunId + board` through S-2's
proof/run/binding checks. As with today's MCP board tools, lease proof is server context, not an
extra client-selected grant field. The board may be bound to a designated coordination Run
rather than the target member Run only when both Runs are server-proven members of the same live
wave. This explicit wave relation is the sole cross-Run relaxation; same-repository identity is
mandatory.

After those checks, the hub durably mints one closed grant:

```text
{schemaVersion:1, grantId, grantDigest, waveId, board, boardRunId, memberRunId,
 workerId, taskId, taskVersion, processGeneration,
 permissions:<orchestrator-selected subset of "read"|"claim"|"report">,
 mintedEvent, state:"active"}
```

The minting orchestrator selects the permission subset at `waves.send` time; the server records
it on the grant and the caller can neither name nor widen it. Executor members receive
`{read,claim,report}`; a coordinator-worker that only triages receives `{read}`, so "reads,
doesn't claim" (Decision 7) is enforced by the grant itself, not by self-restraint. The
admission seam checks the recorded permission in step 4 of Decision 3, before item existence.

The worker receives this as a hub-computed fact adjacent to the framed steer body. The steer
never contains `sessionAuthority`, its digest, its lease id, its expiry, the grantor's session,
or any reusable wave-control authority. Possession of `grantId` is not sufficient: every use is
rebound to the authenticated worker stream and all recorded member coordinates.

Grant liveness is event-based. It ends on explicit revoke, member task reassignment, process
generation replacement, member Run/wave stop, task terminalization, or board Run close. It has no
TTL and does not expire at a turn boundary. A new generation needs a newly minted grant.
Termination is durable: every terminator appends one `board.grant_revoked` event naming the
cause, and replay derives `active`/`revoked` solely from the mint and revoke events — exactly as
claims derive state from `board.claim_requested`/`board.claim_expired`
(`impl/src/coordination-store.mjs:8285-8295`; no grant event kinds exist in the store today, so
both are new). Worker (re)attachment likewise appends a durable generation-record event (e.g.
`worker.generation_bound`) carrying `workerId`, `processGeneration`, and the member coordinates:
`processGeneration` is currently only an in-memory worker-handle property
(`impl/src/coordinator.mjs:110,125,144`), so without this event replay cannot derive which
grants a replacement generation invalidates.
`waves.send` appends the grant before making the steer deliverable; there is no state in which a
worker sees a usable grant that replay cannot reconstruct.

**Defended as written (red-team D2):** the bearer-token defense — S-2 authority as server context,
never a client-selected field — and the authorize-then-mint, persist-before-deliver ordering
(`impl/src/mcp-northbound.mjs:1405,1416`; `impl/src/coordination-store.mjs:13674-13689`).

**Red-team targets:** forwarding the orchestrator `sessionAuthority` as a bearer lease; minting
before wave/member/board scope checks; granting a foreign or merely similarly named Run;
caller-named grantee or permissions; reuse after reattachment under a new process generation;
delivery-before-persistence; one `waves.send` fan-out minting authority for untargeted members;
a coordinator-worker over-grant via hardcoded permissions; replay unable to reconstruct a
revoked grant or a stale process generation.

### 3. Worker mutations enter one S-2-shaped admission seam

All adapters call one `admitWorkerBoardCommand`-equivalent store seam. It follows S-2's envelope
conventions without pretending the worker holds the S-2 lease:

1. close and size-check the wire mutation before any state lookup;
2. resolve `grantId`, then prove it against the authenticated worker/task/session/generation;
3. derive board, board Run, member Run, wave, owner, and owner task from that grant;
4. verify repository, active member lifecycle, board binding, grant permission, and Run/wave
   state before item existence — including that the grant's `boardRunId` equals the board's
   recorded binding (`_boardRunBindings.get(board).runId`,
   `impl/src/coordination-store.mjs:13703-13706`), so a same-named board on a different Run
   cannot satisfy a grant for the intended board;
5. normalize a request digest covering both submitted content and every derived authority
   coordinate;
6. perform replay adjudication only after current principal/scope authorization; and
7. repeat the mutation's final CAS in the append's before-write gate.

An absent, revoked, foreign, or generation-stale grant receives the same constant
`board_worker_scope_refused` before board/item lookup. Within a valid grant, normal typed results
(`board_item_not_found`, `board_item_not_open`, `conflict`, `stale_board_fence`, and report
binding/CAS codes) are reachable. The worker never submits the upstream `sessionAuthority`.

This seam, not the existing convenience wrappers, is the only live call path from the registry
or worker scanner to `requestBoardClaim`/`submitBoardReport`. Direct store methods remain kernel
machinery and confer no transported authority. The digest-vs-prior adjudication (Decision 6,
rule 3) is nevertheless enforced *inside* the kernel methods
`requestBoardClaim`/`submitBoardReport`/`expireBoardClaim` — all three open with a blind
`_byKey` return today, before any content comparison
(`impl/src/coordination-store.mjs:13905,13925,13944`) — so no future kernel caller (a settlement
hook, a migration tool, a test fixture) can regress to returning old success for changed
content. The seam additionally performs authority-before-replay (Decision 6, rule 1).

**Defended as written (red-team D3):** the seven-step ordering and the constant pre-existence
refusal mirror S-2's verified ordering, and the in-append CAS re-check closes the
validate/append window (`impl/src/coordination-store.mjs:13658-13715,13772`).

**Red-team targets:** proof after item lookup; idempotency replay before authority; grant-id
possession treated as authority; a second adapter calling the raw methods; board Run/member Run
confusion; interleaving between validation and append; distinct refusal text leaking a foreign
board, item, wave, or worker; a future kernel caller regressing to the blind `_byKey` return; a
same-named board bound to a different Run satisfying the grant.

### 4. Claim CAS and report CAS are deliberately different

The fence law is normative:

- **Claim:** `expectedBoardFence` is the board-scoped, replay-derived orchestrator-mutation fence.
  It is checked again at the final append. First active claim wins. Worker turn/session fences and
  `projectionInputFence` are never claim authority.
- **Report:** `expectedClaimVersion` is the active-claim CAS. Admission proves the claim is active
  and owned by the derived `(workerId, taskId)` under the same grant, then proves the submitted
  historical `(itemId, itemVersion, itemDigest)`. It repeats claim-version/owner/activity checks
  at the final append. `boardFence` is not report CAS: reports do not mutate board item ordering
  or identity, and an orchestrator's benign edit may migrate a live claim. Report admission also
  requires the item's current state is `open` (Decision 8).
- **Migration:** retitle/reorder continues to migrate the active claim under stable `itemId`.
  The worker may report the exact older version it observed; the envelope never re-points that
  evidence to the successor.
- **Completion:** report submission leaves the item and claim state unchanged. The orchestrator
  reads and evaluates the report, then uses S-2 `board.close`, `board.drop`, another steer, or an
  explicit claim revoke/expiry event. Worker death/reassignment expires the claim by its version.

This adds `expectedClaimVersion` to the canonical report schema and projects `claimVersion` in
claim results/reads. It does not make worker traffic bump `boardFence`. Note that `claimVersion`
is monotonic only across the active→expired transition and resets to 1 on re-claim
(`impl/src/coordination-store.mjs:8287,8295`), so `expectedClaimVersion` alone cannot distinguish
a resurrected or reassigned caller from the current owner. The report CAS is therefore necessary
but not sufficient: admission rejects primarily on the active-claim owner `(workerId,taskId)`
match, with `expectedClaimVersion` as the concurrent-close guard.

**Defended as written (red-team D4 — the strongest decision):** the fence law matches the shipped
reducers exactly — `boardFence` bumps only on the five orchestrator transitions; claim,
migration, expiry, and report never bump it; migration preserves the claim's version and
activity (`impl/src/coordination-store.mjs:8271-8296`).

**Red-team targets:** using worker turn fence for claim; using board fence for report; report by a
worker with no active claim; report after claim expiry/reassignment; report against another
worker's claim; close-on-report authority escalation; benign retitle forcing a retry storm;
claim/report events self-invalidating every concurrent claimant; a resurrected or reassigned
caller version-matching the successor claim (`claimVersion` resets to 1).

### 5. Worker board reads are grant-scoped L1 reads, not lease-free ordinary reads

The worker reads through BD3-A's authenticated lane:

```text
CONTEXT_READ: {"query":{"kind":"board","grantId":"...","cursor":null},
               "expectedFence":"current","idempotencyKey":"..."}
```

The query cannot carry board, Run, wave, worker, task, role, viewer, or projection mode. Those are
derived from the active grant. Ordinary `board.read` keeps its existing S-2 session-authority
requirement unchanged.

A valid grant means “read this one shared task board,” so the view contains every item on that
exact board, including unowned open items, active claims, and reports. It does not use today's
“already owned or board named for worker” filter. This is the minimum relaxation workers need to
discover claimable work and a coordinator-worker needs to triage swarm members. It grants no
other board, private scratchpad partition, message stream, KG horizon, member output, or board
mutation.

Each response is a stable page of at most 16 items and at most 32 KiB serialized. Ordering is by
the board's stable `(ordinal,itemId)` order; report continuation is stable by `eventSeq`. If more
data exists, `nextCursor` is non-null and `truncated: true`; there is no terminal item whose
reports can force an empty, permanently unpageable view. Per-item report pressure is bounded the
same way: a page carries the item row plus its earliest N reports by `eventSeq`, with N chosen so
the serialized page stays within 32 KiB; when an item has further reports, `nextCursor` carries
an in-item report continuation keyed by `(itemId, lastReportSeq)` in addition to the board page
position. An item whose own row exceeds 32 KiB is itself truncated with `truncated: true` and a
typed `board_oversize_item` marker — never an empty page. (Today's renderer sheds only trailing
items and has no per-item report cap, `impl/src/application.mjs:523`.) The server-minted cursor
digest binds
grant digest, board, board Run, member Run, page position, `boardFence`, and
`projectionInputFence`. A changed component refuses continuation with `board_cursor_stale`; the
caller starts a fresh read. Nonexistent and unauthorized boards share
`board_worker_scope_refused`.

The snapshot/result projects at least `{board, boardRunId, boardFence, projectionInputFence,
observedSeq, items, nextCursor, truncated}`. Cache identity includes both `boardFence` and
`projectionInputFence`; thus a claim, report, or claim expiry invalidates the old view even though
it correctly leaves claim CAS unchanged. The existing board item count/byte limits remain a
defense-in-depth ceiling above this smaller L1 page.

Every model-authored title, detail, and report body crosses the one BD3 closed renderer and stays
`wrapProse`/UNTRUSTED-framed. Hub facts (ids, versions, fences, state, owner coordinates, digests,
event sequence) remain facts. The read creates only the L1 `context.read` audit/result receipt,
not a `board.read` domain event; it changes neither board fence. It has zero promotion weight and
never answers a TG2/TG3 progress judgment.

**Defended as written (red-team D5):** the one-board scope relaxation, the dual-fence cache and
cursor binding, and the non-evented zero-weight read resist the smuggling, staleness, and
cursor-reuse targets (`impl/src/application.mjs:493,504-506`;
`impl/src/coordination-store.mjs:140-145,8585-8588`).

**Red-team targets:** board or viewer smuggling in the query; using the grant as a project-wide
read token; cross-wave and cross-repository reads; hiding unowned open items; cache staleness
after a non-board-fence-bumping claim/report; oversize first item/report starvation, including a
report-heavy single item starving every page; cursor reuse
after scope or fence change; raw report body injection; reads counted as progress or knowledge
truth; a read append perturbing claim CAS.

### 6. Idempotency and replay bind content and authority

Claim, report, grant mint, and read-result delivery use server-namespaced idempotency keys. The
effective replay key is `<opKind>:<grantDigest>:<callerKey>` with opKind ∈ `{board.claim,
board.report, grant.mint, context.read}`, mirroring the MCP prefix convention
(`impl/src/mcp-northbound.mjs:1720`), because the replay index is a single global Map keyed by
the raw caller key (`impl/src/coordination-store.mjs:1081,1307,1375,1453`); cross-worker and
cross-operation key-string collisions therefore cannot occur, and the request digest (rule 3)
remains the authoritative content/authority comparison. The
durable request digest includes the submitted closed payload plus derived repository, wave,
board/board Run, member Run, worker, task/version, process generation, and grant digest. Rules:

1. Current caller/grant/scope authorization occurs before looking up or returning a prior
   receipt. A foreign worker cannot discover or replay another worker's key.
2. An exact authorized retry returns the original event/result and appends no duplicate event.
3. The same effective key with changed content or changed derived authority refuses
   `board_replay_conflict`; it never returns the old success and never executes the new request.
   This digest-vs-prior adjudication is enforced inside the kernel store methods (Decision 3),
   not only in the seam, so exact-retry vs `board_replay_conflict` is independent of call path.
4. After authorization and exact replay matching, the original result wins over later live-state
   changes. Thus a lost successful report receipt can be recovered after the orchestrator closes
   the item, while a revoked/foreign grant still cannot replay it.
5. Two distinct authorized claim keys race normally: one wins at the final board-fence/active
   claim gate; the other receives `conflict` or `stale_board_fence` from the actual serialized
   state. A retry cannot convert either outcome into a second claim.
6. Replay reconstructs grants, claims, claim expiry/migration, reports, both read-freshness fence
   components, and request digests byte-identically across store restart.
7. For reads, repeating an idempotency key returns the same page receipt; asking for current
   state uses a new key. Continuation cursors still fail stale rather than masquerading as fresh.

**Defended as written (red-team D6):** authority-before-receipt, exact-retry-wins-over-live-state,
and race-at-the-final-gate mirror S-2's verified ordering and replay branch
(`impl/src/coordination-store.mjs:13703-13715,13754-13761`).

**Red-team targets:** the existing blind `_byKey` return; key collision between workers or
operation kinds; changed body/item/grant under one key; replay after grant revocation; duplicate
grant/steer on `waves.send` retry; restart losing the claim/report freshness fence; a read retry
silently relabeled current.

### 7. The claim/report envelope is what orchestrators and coordinator-workers triage

Board views expose a closed, CAS-auditable projection:

```text
claim  = {itemId,itemVersion,boardFence,claimVersion,ownerWorkerId,ownerTaskId,
          grantDigest,createdEvent,active}
report = {itemId,itemVersion,itemDigest,claimVersion,ownerWorkerId,ownerTaskId,
          grantDigest,body,eventSeq}
```

The orchestrator sees the envelope through its existing S-2 `board.read`. That projection is
extended, not only the new worker lane: `projectBoardView` (`impl/src/application.mjs:488`) today
emits `claim:{owner,itemVersion,boardFence}` and `reports:[{itemVersion,itemDigest,owner,body}]`
with no `claimVersion`, no `grantDigest`, and no `createdEvent`/`eventSeq`
(`impl/src/application.mjs:516-520`), and its cache key is `(board, role/workerId, boardFence)`
only (`impl/src/application.mjs:493`). #78 owns extending it to emit the full claim/report
envelope above and to key its cache on both `boardFence` and `projectionInputFence`, so an
orchestrator re-read after a claim/report observes the new envelope even though `boardFence` did
not move. A worker with the exact
board grant sees it through Decision 5. The projection uses server-owned claim/report records;
clients cannot submit these attribution fields. `body` is always visibly untrusted worker prose.
No result is described as read or acted-on merely because it was delivered; worker result frames
mean “hub admitted/refused,” and board presence means only “durably recorded.”

The #74 loop is therefore executable:

1. The orchestrator S-2-posts granular items on a wave coordination board.
2. It targets each member with `waves.send(..., claimGrant)`; each member receives a persisted,
   stream-bound board grant.
3. Members `CONTEXT_READ` the shared board and claim items using the returned `boardFence`.
4. Winners work and report against their active claim version and exact observed item digest.
5. A coordinator-worker with its own grant repeatedly reads fresh pages, sees every member's
   claims/reports, and reports triage recommendations through its own board item or the BD3
   reply/decision lane.
6. The orchestrator remains the actor that steers other members and closes/reorders/drops items;
   large questions still use `DECISION_REQUEST`.

This is mediated lateral coordination. The board is the shared envelope; scratchpad/context packs
remain the payload. A coordinator-worker does not gain `waves.send`, arbitrary member messaging,
S-2 mutation authority, or nested-orchestrator status merely by reading the board.

**Defended as written (red-team D7):** server-owned attribution, prose-framed bodies, and
delivery-≠-consumption match the shipped `UNTRUSTED_WORKER_TITLE` framing in `boardSnapshot`
(`impl/src/coordination-store.mjs:13965-13980`).

**Red-team targets:** forged claim/report attribution in the read model; treating delivery as
consumption; coordinator-worker escalating itself to wave control; direct free worker-to-worker
messages; report body executed as instruction; closed/dropped item presented as claimable;
triage cache failing to observe a report because `boardFence` did not move (now closed on both
the worker lane and the orchestrator projection).

### 8. Lifecycle and control remain event-based

The grant and claim state machines are driven by durable, evaluable events:

```text
grant: minted -> active -> revoked   (mint append + durable `board.grant_revoked`; replay
                                      derives state from those events alone)
claim: absent -> active -> expired   (`board.claim_requested` / `board.claim_expired`)
item:  open -> successor(open) | closed | dropped
```

Active grant predicates are constructive facts: same authenticated member identity, active task
version/generation, live member Run/wave, live board Run, and no revoke. Active claim predicates
are the exact owner/task and claim version. Terminal/reassignment/stop events revoke grants and
version-CAS-expire claims; replay derives the same state, and the durable generation record of
Decision 2 lets replay derive which grants a replacement generation invalidates. A report is
conversational evidence for the next orchestration decision, not a progress timer. Silence
causes no state transition.

Orchestrator close/drop is a claim terminator too. Today `board.close`/`board.drop` write only
the item successor (and, on close, the Finding) and never touch the claim — the migration branch
fires only for retitle/reorder (`impl/src/coordination-store.mjs:13844-13866,13890-13896`) — and
claim expiry is reachable only from the six worker-side `_expireBoardClaims` hooks
(`impl/src/coordinator.mjs:7492,11285,11593,11681,12433,12667`; body `coordinator.mjs:7720-7728`).
This contract closes that gap: an orchestrator `board.close`/`board.drop` expires the item's
active claim in the same batch — a `board.claim_expired` sibling event with actor `policy` and
key `board.claim_expired:<itemId>:<version>:item_<closed|dropped>`, mirroring
`_expireBoardClaims` (`impl/src/coordinator.mjs:7724-7726`;
`impl/src/coordination-store.mjs:13943-13952`). Symmetrically, report admission requires the
item's current state is `open` (Decision 4), so a terminal item stops accepting evidence.

No acceptance criterion depends on elapsed time, number of turns, polling cadence, or “report by
N.” Resource byte/item/page ceilings are legitimate circuit breakers, not judgments about agent
progress. The upstream S-2 credential's existing `expiresAt` remains a security-authority check
only at grant mint and ordinary orchestrator operations; it is never copied into the worker grant
or used to expire a healthy claim.

**Defended as written (red-team D8):** the control-law posture — no clock/turn/cadence control
over agent work, lease `expiresAt` confined to security authority — and the worker-side
claim-reap machinery are honored and grounded (`impl/src/coordinator.mjs:7720-7728`;
`impl/src/coordination-store.mjs:13943-13952`).

**Red-team targets:** hidden grant/claim TTL; revoke on every turn completion; poll frequency as
liveness; report deadlines as progress gates; session lease expiry retroactively falsifying a
properly minted worker grant; terminal worker leaving a wedged active claim; replay resurrecting a
revoked grant or expired claim; an orchestrator close/drop leaving an orphaned active claim that
keeps admitting reports against a terminal item.

## Non-goals

- No ordinary operator impersonation of `board.claim`/`board.report`; ordinary MCP/Web/CLI keeps
  the worker-profile rows absent.
- No weakening or replacement of S-2 orchestrator authority, board-to-Run binding, refusal
  precedence, or in-append board CAS.
- No free worker-to-worker messaging, arbitrary worker addressing, nested orchestration, or
  coordinator-worker possession of `waves.send`.
- No worker authority to post, retitle, reorder, close, or drop board items.
- No automatic item close, KG promotion, trust verdict, or “done” claim from a report.
- No expansion from one granted board into project boards, private scratchpads, arbitrary KG
  nodes, context packages, member logs, or secrets.
- No replacement of scratchpad/context-pack payloads; the board is the task/claim/report
  envelope.
- No claim priority, scheduling/fairness algorithm, speculative claim, multi-item transaction,
  or cross-wave board federation in v1.
- No new clocks, turn limits, claim/report deadlines, or polling-cadence controls.
- No implementation edits in this contract-authoring epic; the implementation and red-first
  suite are subsequent campaign rungs.

## Red-first acceptance

Implementation begins by adding a focused red suite (suggested home:
`impl/test/board-workerhalf-red.test.mjs`) and demonstrating that its positive rows fail against
the current registry ghosts/authority gaps. Existing board, S-2, BD3, MCP, wave, grammar, replay,
and trust-gate suites remain unchanged and green; no existing assertion is weakened to admit the
new behavior.

| ID | Red state to prove first | Green acceptance oracle |
| --- | --- | --- |
| BW-01 | Registry rows have `surfaces: []` and no live worker dispatch. | Both rows are reachable only through the worker profile/embedded authenticated lane; ordinary operator MCP/Web/CLI inventory still cannot invoke them. |
| BW-02 | A claim frame can caller-name identity or reach a raw wrapper without a grant. | Closed scanning rejects extra identity/scope fields; no active exact grant yields `board_worker_scope_refused` before item lookup. |
| BW-03 | A `waves.send` claim grant could carry/reveal S-2 lease material. | Grant mint consumes S-2 authority server-side; delivered worker fact contains none of `sessionAuthority`, lease/session ids, authority digest, or expiry. |
| BW-04 | A grant can be confused across board Run, member Run, wave, repo, task version, generation, or recorded permission. | Every mismatch returns the constant scope refusal; a server-proven same-wave board Run/member Run succeeds. |
| BW-05 | A `waves.send` retry can mint/deliver two grants. | Exact retry returns the same grant/steer receipt and one durable grant event; changed board/member content conflicts. |
| BW-06 | Claim checks can race an orchestrator mutation between preview and append. | An injected in-append interleave advances `boardFence`; the claim refuses stale and no claim event lands. |
| BW-07 | Worker turn-fence changes invalidate claims, or claim traffic bumps `boardFence`. | Turn/session fence changes do not affect claim CAS; N claims/reports leave `boardFence` unchanged while their projection freshness component advances. |
| BW-08 | A worker can report without an active owned claim, or against a closed/dropped item (the current store allows both). | Missing, foreign, expired, reassigned, wrong-version, or terminal-item claim/report refuses; valid owner/task/grant plus exact claim version on an open item succeeds. |
| BW-09 | A benign retitle loses the claim or silently rebinds a report. | Claim migrates under stable item id; a report binds the exact historical version/digest it observed and never the successor by implication. |
| BW-10 | Report submission can be mistaken for close/done. | Report leaves item state and claim state unchanged; only an authorized S-2 successor command closes/drops it. |
| BW-11 | Existing blind `_byKey` behavior returns success for changed claim/report content. | Exact authorized retries append once and return the original receipt; changed content/authority under the effective key returns `board_replay_conflict`; foreign authority learns no receipt. The effective key is namespaced `<opKind>:<grantDigest>:<callerKey>` and the digest adjudication holds in the kernel methods themselves, not only the seam. |
| BW-12 | Restart can lose grants (mint/revoke), generation bindings, claims, reports, expiry/migration, or read freshness. | Replay reconstructs byte-identical envelopes, state, request digests, `boardFence`, and `projectionInputFence`; exact retry remains exactly-once. |
| BW-13 | Today's worker projection hides unowned open shared items. | A granted worker reads every item on that exact shared board, including unowned claimable work, and cannot read a second board. |
| BW-14 | Today's cache can serve a pre-claim/pre-report view forever because only `boardFence` keys it. | Claim, report, and expiry each change the worker/orchestrator view freshness key; the next fresh read observes them without changing claim CAS. |
| BW-15 | Oversize or report-heavy boards can yield an unpageable/unsafe frame. | Pages contain at most 16 items and 32 KiB, expose a stable continuation, frame every prose leaf, and either continue or return a typed stale-cursor refusal—never silent loss. A report-heavy item paginates in-item by `(itemId, lastReportSeq)` continuation; an oversize item row truncates with `truncated: true` and a typed `board_oversize_item` marker rather than starving the page. |
| BW-16 | A worker can supply board/viewer/run fields or replay a cursor outside its grant. | Wire schema rejects those fields; cursor is digest-bound to authority and both fence components; forbidden/nonexistent scopes share one refusal. |
| BW-17 | Reads — or claim/report result receipts — can append a board event, alter a fence, count as TG2/TG3 progress, or gain promotion weight. | Only the zero-weight L1 read audit/result receipt is emitted; board fences/state are unchanged and progress/evidence gates ignore it. A `board.claim_result`/`board.report_result` receipt never feeds `_observeSteeringCycle` (unlike `scratchpad.write_result`). |
| BW-18 | Worker death/reassignment — or an orchestrator close/drop — can leave a claim or grant live. | The durable lifecycle transition revokes the grant and version-CAS-expires every owned claim; an orchestrator close/drop expires the item's active claim in the same batch; a new generation cannot use either and replay cannot resurrect them. |
| BW-19 | Orchestrator view lacks enough CAS/provenance data to triage. | S-2 `board.read` and granted L1 reads expose the closed claim/report envelopes, both freshness fences, event attribution, and untrusted report body. |
| BW-20 | #74 still requires prose relay to know who owns/reported each row. | Live acceptance: orchestrator posts at least two real rows, grants two wave members, members read/contend/claim/report, and a coordinator-worker reads both admitted envelopes and emits a triage decision; one orchestrator close follows the selected report. |
| BW-21 | The implementation introduces TTLs, turn limits, or cadence-dependent truth. | Static/source assertions and event-driven tests show no new time/turn field or timer controls grant, claim, report, read freshness, or triage completion. |

The end-to-end BW-20 receipt must record: wave/member binding proof, grant mint/delivery digest,
worker-attributed claim and report events, losing-claim typed outcome, both read-freshness fence
components, coordinator-worker read receipt, and the orchestrator's final S-2 close receipt. Its
assertions key on durable ids/digests/events and content/state predicates, never sleep duration,
turn count, or polling count.
