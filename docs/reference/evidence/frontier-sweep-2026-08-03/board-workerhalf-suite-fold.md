# Suite fold: board worker-half red suite — blue-team blockers folded

(Authority: `board-workerhalf-blueteam.md` verdict **NOT-READY**, five numbered blockers.
Target: `impl/test/board-workerhalf-red.test.mjs`. Contract-side drift per the blue team's
§5 applied to `board-workerhalf-contract.md`. Fold executed 2026-08-03; suite re-run from the
repo root with `node --test impl/test/board-workerhalf-red.test.mjs`, node v25.8.0.)

## Split reconciliation

| | tests | pass | fail | split |
|---|---|---|---|---|
| Before fold | 21 | 3 | 18 | 18 red / 3 green (pins BW-07/09/10) |
| After fold | 24 | 3 | 21 | **21 red / 3 green** (pins BW-07/09/10) |

`duration_ms ≈ 4449`. The three pins pass for their original legitimate reasons (untouched).
Every formerly-red row still fails at the same or a sharper stage; no red row was weakened.

## Blockers → changes

### B1 — grant-permission enforcement had no oracle (A2-2; Decision 2 permissions; Decision 3 step 4)

**New row `BW-22 permissions[grant-permission-missing]`** (red today at the contract-named
prerequisite `stage[waves.send claim-grant transport missing]`, same staging as the other
grant-gated rows). Beyond the prerequisite it asserts:

- the executor member's (`exec-a`) minted grant records exactly `{read,claim,report}` and the
  triage-only member's (`coordinator-worker`) minted grant records exactly `{read}` — the
  orchestrator-selected subset is *recorded*, so a hardcoded-permissions implementation fails
  at the mint inspection (the exact over-grant the red team named);
- two claim attempts under the `{read}`-only grant (one against an existing item, one against
  a nonexistent item) both draw the constant `board_worker_scope_refused` and never
  `board_item_not_found` — the permission check precedes item lookup, no existence leak;
- no `board.claim_requested` event lands from the denied attempts;
- positive controls keep a refuse-everything seam red: the `{read}` grant still reads
  (`"ok":true` page), the executor grant still claims.

**Required staging fix in BW-20** (not a weakening): the triage member's wave role changed
`coordinator-worker` → `exec-c`, with an explanatory comment. Reason: once BW-22 pins the
contract's permission law ("a coordinator-worker that only triages receives `{read}`"), a
member registered under the triage-only role cannot also claim/report through its own board
item — and BW-20's triager must (Decision 7 step 5's board-item path needs claim+report
permission). With a closed `claimGrant` request, the member's registered wave role is the only
server-side selection signal, so the two rows must name different roles to stay simultaneously
greenable on one contract-correct implementation. All BW-20 assertions are unchanged in
strength; its red stage (`waves.send` transport) is unchanged.

### B2 — `board_oversize_item` / oversize-row truncation had no oracle (A5-1; Decision 5); also closes T7

**BW-15 extended** (renamed `…followed in-item report continuation, oversize-row
truncation…`; still red at the prerequisite `waves.send` stage):

- **T7 follow:** the report-heavy continuation chain is now *followed* (up to 4 hops from the
  first heavy page's `nextCursor`). Every continuation page must stay within 32 KiB and never
  draw `board_cursor_stale`, and the union of delivered `evidence N` reports across the chain
  must equal all 12 — a dummy non-null `nextCursor` now fails.
- **Oversize row:** kernel bounds cap title (160 B) and detail (4 KiB), so a legitimately
  >32 KiB item row is constructed through the one unbounded item field — 8 evidence refs with
  ~5 KiB `artifactId` strings (ref shape verified at `coordination-store.mjs:397-406`,
  `MAX_STORE_BOARD_EVIDENCE` 8) on a dedicated `oversize-board` with its own grant. The read
  must return a **non-empty** page (the row served truncated, never starved), within 32 KiB,
  carrying `truncated: true` and the typed `board_oversize_item` marker.
- Helper change: `s2Post` gained an `evidence = []` parameter (previously hardcoded `[]`).

### B3 — Decision 6 rule 4 had no seam-level test

**New row `BW-23 replay[replay-wins-over-live-state]`** (red today at the prerequisite
`waves.send` stage). Successful report → orchestrator S-2 close (item terminal, claim expired)
→ the exact same frame retries and must return the **original** `"ok":true` receipt with no
`/not_open|stale|conflict/` re-judgment and no duplicate `board.report_submitted` event. Then
member death revokes the grant; a respawned same-Run generation replaying the same effective
key must draw `board_worker_scope_refused` and never `"ok":true` — authority precedes replay
(rules 1/4).

### B4 — the `BOARD_CLAIM`/`BOARD_REPORT` wire scanner had no test (A1-1)

**New row `BW-24 scanner[frame-scanner-missing]`** — red today at its **own** named stage,
immediately: `typeof session.scanForBoardClaim === 'function'` fails with `'undefined'`.
`claude-session.mjs` is imported as a **namespace** (`import * as session from
'../src/claude-session.mjs'`) so the missing export fails this row instead of killing the file
at load. Mirroring `test/scratchpad-33-red.test.mjs`'s `scanForScratchpadWrite` discipline, it
then pins: exact-key acceptance and closed key sets for both frames; first-balanced-JSON
extraction with trailing prose ignored; rejection of all ten caller-named identity/scope
fields (`workerId/owner/ownerTask/actor/taskId/runId/waveId/board/boardRunId/
sessionAuthority`); **second-frame rejection** — two frames in one scan window scan to `null`,
never first-wins (Decision 1's text is explicit: "any second frame in one scan window … is
rejected"); malformed-value rejections (negative fence, non-64-hex digest) and plain prose.

### B5 — replay-derived generation invalidation had no test (A2-3; Decisions 2/8)

**BW-12 extended** (still red at the prerequisite `waves.send` stage): the member Run is now
**respawned before** the writer-lease release, so the replacement generation's attachment must
land in the frozen log. After the byte-identical replay assertions, the row asserts a durable
generation-record event (`worker.generation_*`, carrying `workerId` = the respawned worker and
a safe-integer `processGeneration`) exists in the replayed log — no such event kind exists
today — and that the old grant is replay-derived unusable: the replacement generation's
post-restart claim attempt with it (through the live lane, after reopen) receipts
`board_worker_scope_refused`. The replay-side basis is the frozen log itself (grant_revoked +
generation record), matching the phase49 `releaseWriterLease` + bare-reopen pattern — the seam
is hub-side, so the replay store is asserted at the derivation level, not through an invented
store API.

## Suite header fixes

- Row count 21 → 24; decision buckets updated (BW-22 → D2/D3, BW-23 → D6, BW-24 → D1).
- The named red-stage list now includes the unrecorded/unenforced grant permission subset
  (BW-22), the missing replay-wins-over-live-state seam adjudication (BW-23), the missing
  wire scanner (BW-24), and the missing durable generation record (BW-12).
- Harness-pattern list now names `test/scratchpad-33-red.test.mjs` and records *why* the
  namespace import is load-bearing.

## Contract drift fixes (`board-workerhalf-contract.md`; the two §5 items the report names)

1. **Ground truth 11 rewritten.** The stale "no `waves.send` row exists" claim is replaced:
   the row landed at `application-semantics.mjs:1582` (ordinary profile, surfaces
   embedded/MCP/CLI, closed schema `{runId, message, delivery}`, no `claimGrant` key), flanked
   by `waves.progress`/`waves.stop`; `waves.attach` re-cited at 1530-1549. The row now warns
   implementers not to re-land it; #78 owns only the claim-grant semantics riding it.
2. **Every drifted line citation re-verified (`grep -an`/`sed -n` only on the NUL-bearing
   files) and refreshed.** No cited *fact* changed — only numbers, matching the report's
   "cited facts all re-verified true; only the numbers moved." Highlights:
   `admitBoardCommand` seam 13619-13799 → 13766-13941; refusal order → 13819-13861; binding
   check 13703-13706 → 13848-13851; kernel methods 13903-13950 → 14049-14096
   (`requestBoardClaim` 14049, `submitBoardReport` 14069, `expireBoardClaim` 14088; blind
   `_byKey` lines 13905,13925,13944 → 14050,14070,14089); `boardSnapshot` 13963-13980 →
   14110-14125; `_boardSuccessor`/migration 13823-13900 → 13970-14018,14010-14015; close batch
   → 13989-14007; `boardFence` method 13590-13602 → 13741-13743; board reducers → 8270-8309;
   `projectionInputFence` set/increment → 144-147,8608-8614; `_byKey` replay index
   1081,1307,1375,1453 → 1089,1319,1370,1465; Coordinator board wrappers 9965-9989 →
   10470-10494; task-status gate 9972,9985 → 10477,10490; scratchpad.write TG2 block
   11033-11048 → 11560-11577 (call sites 9145,9275,10658,11048 → 9455,9585,11173,11574);
   `_expireBoardClaims` body 7720-7728 → 8030-8038 (hooks 7492,…,12667 →
   7802,11881,12189,12277,13029,13263; expire call 7724-7726 → 8033-8035); in-memory
   `processGeneration` 110,125,144 → 3365,4343,4407; `scanForScratchpadWrite` 85-105/86-105 →
   90-107; MCP ordinary board read 1418-1425 → 1721-1727; `mcp.call:` prefix cite 1720 → 1718;
   application-semantics board rows 1348-1405/1407-1419 → 1402-1409/1410-1422; matrix authority
   1176-1191 → 1188-1196. Ground-truth preamble date updated to the 2026-08-03 refresh; a
   blue-team-fold note was added to the header block. `wave.mjs:350-358`, `messages.mjs:339-366`,
   `mcp-northbound.mjs:1405,1416`, and all `application.mjs` citations re-verified still
   accurate and left unchanged.

## Not folded (report's own non-gating follow-ups, §7)

Left for the implementation wave exactly as the blue team classified them ("tracked, not
gating"): T4 (tighten BW-05's `/conflict/` to `board_replay_conflict`), T8 (anchor BW-19's
presence-only digest fields), valid-grant reachability of `board_item_not_found`/
`board_item_not_open`, D6 rule 7 read-key replay and cross-worker caller-key reuse, the
resurrected-caller report (A4-1), persist-before-deliver ordering, the durable `context.read`
audit event's existence, `boardRunId`/`observedSeq` projection fields, BW-21's static/source
half, task-status gate positives beyond `paused`, reassignment-variant lifecycle, remaining
smuggled query fields, and the §1 re-run caveat (after the claimGrant transport lands, confirm
the now-fourteen grant-gated rows go red at their own named stages). No report item was
rejected as wrong; two fixes were *implemented differently than literally sketched* and are
documented above (B2's oversize row via unbounded `artifactId` evidence refs because kernel
bounds cap title/detail below 32 KiB; B5's replay-unusability proven at the replay-derivation
level plus a live-lane post-restart attempt, because the seam is hub-side).
