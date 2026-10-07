# REFLEX-2 decisions contract — orchestrator-controlled task boards (F8/F9/F10 resolved)

Ground truth: docs/32 §3.2 (docs/32-reflexive-orchestration.md:133-158), issue #17, the red-team
report in this directory (reflex-redteam.md findings F8, F9, F10, and corrections #8, #9 lines
330-337). Code: the scratch family in `impl/src/coordination-store.mjs`
(`claimScratch` :11597-11607, `expireScratchClaim` version-CAS :11609-11617,
`activeScratchClaims` :11619-11623, `checkScratch` full-scan :11625-11633, `readScratch`
evented-read :11636-11641, `scratchFactOracleTarget` ledger-derived binding :11564-11585,
reserved-field guard `_knowledgePayload` :11648-11651); the coordinator scratch surface
(`claimScratch` worker-fence trap :8833-8847, `_expireScratchClaims` :6986-6994 and its
terminal/provider-failure hooks :6771, :9591, :9869, :9952, :10602, :10805); the fence authority
(`FenceTable` per-worker only, `issue/check/bumpTurn/bumpHuman` :10-50); content-address recompute
(`normalizeContextManifest` deletes and recomputes `digest`, context-program.mjs:183-192); RunView
bounds (`MAX_RUN_VIEW_BYTES`/`MAX_RUN_VIEW_WORKERS`, application.mjs:42-44; worker-count ceiling
:1429). All the machinery the doc says boards "reuse" carries a live defect (F8/F9/F10); this
contract pins each before the wave starts.

## Part A — item identity and claim lifecycle (F8)

**Decision: immutable items with successor versions + an explicit claim-migration rule.** The
alternative (mutable items with a digest only at close) is rejected: content-addressing plus
replay-exactness (§3.2 lines 153-155, "item digests are content-addressed … replayed from the
log") require a stable digest *for every in-flight state*, not only at close — evidence refs and
`cell:` citations (§3.4) must bind an item that cannot change bytes under them. The scratch and
manifest precedents both content-address at write and re-derive on replay (`claimScratch` stamps
`version: 1` and CASes on it, coordination-store.mjs:11604, 11614; `normalizeContextManifest`
deletes the supplied `digest` and recomputes, context-program.mjs:183-192), so immutable-with-
successors is the house pattern; mutable-until-close would be the only content-addressed object in
the system whose digest lies while it is being worked.

1. **Immutable item, versioned identity.** `BoardItem = exact{ itemId, itemVersion: positive int,
   board, title, detail:null|bounded, state, owner:null|SafeId, evidence: refs[0..8],
   ordinal: positive int, itemDigest }`. `itemId` is the stable lineage key (minted at
   `board.item_posted`, never reused); `itemDigest = H(everything except itemDigest)` computed by
   the hub with the delete-and-recompute discipline (context-program.mjs:183-192), never accepted
   from a submitter. A submitted `itemDigest` that disagrees is a loud refusal
   (`board_item_digest_mismatch`), not a silent overwrite — the same integrity stance as the
   scratch oracle (`scratch_oracle_integrity`, coordination-store.mjs:11574-11575).
2. **Edit = successor version.** `board.item_retitled` / `board.item_reordered` mint
   `itemVersion+1` with a new `itemDigest` under the **same** `itemId`; the prior version is
   retained (replay-exact history, never relabeled). `board.item_closed`/`_dropped` transition
   `state` (also a successor version). No field of an existing (itemId, itemVersion) is ever
   mutated in place — mirrors "New content = new digest; never mutation in place" (§3.3 line 180).
3. **Claim-migration (benign edit must not invalidate a claim).** A granted claim is keyed to
   `itemId`, not `(itemId, itemVersion)`. When the orchestrator retitles/reorders an item a worker
   holds `claimed`, the hub emits `board.claim_migrated {itemId, fromVersion, toVersion}` carrying
   the claim forward; the worker is NOT forced to re-claim. This directly answers F8's retry-storm
   objection ("stale claims rejected at the item's current fence … makes any benign edit a
   claim-invalidating event", reflex-redteam.md:172-175): board-fence staleness (Part B) guards
   *concurrent transition ordering*, not claim liveness. A `board.report_submitted` binds the
   **exact** `(itemId, itemVersion, itemDigest)` the worker observed, so a report's evidence is
   never silently re-pointed by a later retitle.
4. **Claim release/expiry on worker death.** Claims gain the scratch death lifecycle verbatim: a
   `board.claim_expired {itemId, expectedClaimVersion}` path mirroring `expireScratchClaim`'s
   version-CAS (coordination-store.mjs:11609-11617), driven from the coordinator by a
   `_expireBoardClaims(handle, task, reason)` sibling of `_expireScratchClaims`
   (coordinator.mjs:6986-6994) invoked from the **same** terminal hooks that already reap scratch
   claims — provider failure (:9591), task terminalization (:6771, :9869, :9952), replay-failed
   and claimed-without-spawn (:10602, :10805). Without this the item wedges in `claimed` on worker
   death — the per-item deadlock F8 names (reflex-redteam.md:176-178). Expiry returns the item to
   `open` at a bumped board fence (Part B), never to a phantom `done`.

## Part B — board fence: board-scoped, replay-derivable (F9)

5. **Not the worker fence.** The only fence authority today is per-worker (`FenceTable`,
   fence.mjs:10-50) and the scratch code misuses it as the claim fence: `claimScratch` checks
   `expectedFence` against the *worker* and stores `check.current.fence`
   (coordinator.mjs:8839-8847), so a routine nudge/steer that calls `bumpTurn`/`bumpHuman`
   (fence.mjs:39-49) invalidates that worker's in-flight claims — the livelock F9 warns of
   (reflex-redteam.md:186-190). Boards MUST NOT reuse `FenceTable`. A board fence is a **new,
   board-scoped counter**, decoupled from every worker fence; bumping a worker's turn fence never
   touches any board fence.
6. **Replay-derivable counter.** `boardFence(board)` is defined as the count of admitted
   orchestrator-authority events for that board in the log — it is *derived*, not stored as
   mutable state, so replay reconstructs it exactly by re-counting (the same "replayed from the
   log" guarantee as §3.2 line 153, without a separate durable cell to drift).
7. **Enumerate what bumps it (and what does not).** Only **orchestrator authority transitions**
   advance the board fence: `board.item_posted`, `board.item_reordered`, `board.item_retitled`,
   `board.item_closed`, `board.item_dropped`. Worker reports — `board.claim_requested`,
   `board.report_submitted`, and hub-applied `board.claim_migrated`/`board.claim_expired` — do
   **not** bump it. This is the explicit divergence from the scratch trap: claims are guarded but
   claim/report traffic is not self-invalidating, so N workers reporting on a board never livelock
   each other.
8. **Claim CAS at the board fence.** `board.claim_requested` carries `expectedBoardFence`; the hub
   applies exactly-once (first claim wins) only if `expectedBoardFence === boardFence(board)` at
   apply time, else `stale_board_fence` (rejected, re-read cheap — Part C cache) — the fence-check
   shape of `claimScratch` (coordinator.mjs:8838-8840) but scoped to the board, not the worker. A
   granted claim stores the `boardFence` it won at; migration (rule 3) advances the stored fence
   with the item, it does not reject the claim.

## Part C — read cost: cached projections, no evented reads (F10)

9. **Never the `readScratch` precedent.** `readScratch` appends a durable `scratch.read` event on
   *every* read (coordination-store.mjs:11636-11641) and `checkScratch` full-scans all claims and
   facts per call (:11625-11633); N workers polling a board that way is O(N × board-size) plus a
   ledger write per poll — write amplification on the replay-critical log (F10,
   reflex-redteam.md:195-200). Board reads MUST be **non-evented**: no `board.read` event kind
   exists, and a board poll never appends to the ledger.
10. **Cached per-worker projection.** A `BoardProjection` is cached keyed by
    `(board, workerId, boardFence(board))` and recomputed **only** when the board fence advances
    (Part B) — otherwise served from cache. The projection is the per-worker filtered slice §3.2
    specifies (shared items owned by the worker + the worker's own board; orchestrator sees all,
    lines 149-152), built from an indexed per-board item map (not the `checkScratch` full scan).
11. **Bounds and polling budget.** Board surfaces get RunView-style ceilings, since
    `MAX_RUN_VIEW_BYTES`/`MAX_RUN_VIEW_WORKERS` (application.mjs:42-44, :1429) do not cover a
    board (F10, reflex-redteam.md:200-202): `MAX_BOARD_VIEW_BYTES` (bounded projection, truncates
    with an explicit `boardViewTruncated` story, never silent) and `MAX_BOARD_ITEMS` per board. A
    per-worker minimum poll interval / read budget throttles cache-miss recomputation; exceeding
    it serves the last cached projection rather than forcing a rescan.
12. **Sanitized, provenance-marked projection.** Every worker-authored field on the projection —
    `title`, `detail`, and `board.report_submitted` bodies — routes through the
    `boundedAttentionText`/`SECRET_SHAPED_TEXT` discipline (application.mjs:196-203) and carries
    untrusted-prose provenance marking (F14, reflex-redteam.md:282-294); report bodies are worker
    content, never hub-styled.

## Part D — red tests first (`impl/test/reflex2-boards-red.test.mjs`)

F8: retitle mints a successor `itemVersion` under a stable `itemId`; a submitted `itemDigest`
mismatch is refused loudly; an open claim survives a benign retitle via `board.claim_migrated`
(no re-claim, no retry storm); a report binds the exact observed `(itemVersion, itemDigest)`; a
worker death expires its board claims through the terminal hook and returns items to `open` (item
never wedges in `claimed`). F9: a worker turn-fence bump (nudge/steer) does not invalidate that
worker's board claim; the board fence advances only on the five authority events and replays to
the same value by re-counting; a claim against a stale `expectedBoardFence` is rejected while a
current one wins exactly-once. F10: a board poll appends no ledger event; the projection is served
from cache while the board fence is unchanged and recomputed only on advance; projection bytes and
item count honor `MAX_BOARD_VIEW_BYTES`/`MAX_BOARD_ITEMS` with an explicit truncation story;
per-worker slices exclude items the worker cannot see. Sanitization: title/detail/report bodies
are redacted and provenance-marked.

## Part E — boundaries

Boards are ledger state replayed from the log; no board mutates content in place (immutable
versions only). No reuse of `FenceTable` for board fences. No `board.read` event kind — reads are
non-evented and cached. No new fence authority in `fence.mjs`. Not Goal/Plan: boards coordinate
work-in-flight, never dispatch topology (§3.2 lines 156-158); dispatch may consume a board, never
the reverse. No credentials on boards; no auto-close, no auto-claim. No git commits, no
scratch/log writes anywhere (including /tmp).

## Part F — validation

Focused suite green, then the full suite `node impl/scripts/run-suite.mjs` green from the worktree
root; the wave-driver reviewer contract (`node --test impl/test/wave-driver-red.test.mjs`, exit 0)
stays green.
