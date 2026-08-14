CONTRACT-QA v1

[attempt: d2371308-6fa9-4b7d-b88f-42c655337599 coordinator]

Coordinator QA — the lifecycle-contracts four-row foundry, redrive 4 (package ③, wave
`lifecycle-contracts-2026-08-14-wave-a-rd4`). Every claim below is cited evidence (on-disk
reads: `sed -n` / `grep -an` / `git log` / `ls` of sibling worktrees and reservation records) or
an explicitly named absence. No clocks, no fabrication. This file is written INCREMENTALLY: the
prep audit and boundary skeleton below are final; the four per-contract verdicts are filled in
when each row's contract lands on disk (status table tracks it).

## Signal + on-disk status (the #174 law — silence is not death)

| Lane | Expected (wavefile) | State |
|---|---|---|
| messageOnSpawn `brief` | read objectiveRef + foundry-brief | RECEIVED mid-session (message `c7db717f…`); both read in full |
| signalOnMembersDone `result` | fires when `row-lc-fs,row-lc-launch,row-lc-members,row-lc-ledger` all settle | NOT RECEIVED as a message — but ALL FOUR deliverables VERIFIED ON DISK (the #174 law satisfied by direct verification; see table below) |

On-disk verification (re-checked before each verdict is written):

- FINAL STATE, all four rows delivered and read in full at the shared base `5ae2c7e5`:
  `contract-filesystem.md` at `ws-38353b60…`, `contract-launch.md` at `ws-544b2d73…`,
  `contract-members.md` (+ its `shared/` publish) at `ws-c850c76e…`, `contract-ledger.md` at
  `ws-79bb06cd…` — the last at the WRONG (`redrive3/`) path, per prep finding P0 (see F-L1).
  Three of four rows explicitly recorded the P0 path ruling (wavefile governs); the ledger row
  ruled the other way and is the one that landed wrong — the finding and its mechanical fold are
  below.
- Rows were LIVE throughout: the operator repo's `.baton/capacity/reservations.json` showed
  worker reservations MATERIALIZED at this base (`5ae2c7e5…`; first at 15:12:02Z, still accruing
  at 15:34:47Z — 20+ entries across the session, this seat `ws-e0b1ea1a…` among them).

## Prep citation audit (run this session against HEAD `5ae2c7e5`, the base the rows share)

The row briefs are seeds; the contracts inherit their anchors and must re-verify them. Audited
fresh now so wrong seed anchors are already known. NOTE: the base has moved TWICE since the
redrive-3 contracts were verified (`09200e9` → `cda6355b` async/skip-if-clean base commit →
`8ec52a6c` hardCap rip / quiescence verdicts → `5ae2c7e5` docs-only) — redrive-3's own verified
anchors are NOT inherited facts; every one must be re-derived at this head.

| Anchor (seed brief) | Verified at HEAD `5ae2c7e5` | Result |
|---|---|---|
| `workflow-interpreter.mjs:525` — "the base-commit line" (#168) | the base-commit block is now ASYNC + skip-if-clean (`cda6355b`): status probe `:596`, `git add -A` `:599`, `git commit -m "baton workflow base …"` `:600`, silent catch `:601` | ✗ off by ~70 lines AND behavior-changed: the commit is now CONDITIONAL on a dirty status probe (a clean tree skips it) — but still on-branch in `repoRoot`, still author `Baton`, still swallowed by the catch. An fs pin grounded on "unconditional" must be re-grounded on "conditional-on-dirty, still on-branch" |
| `workflow-interpreter.mjs:39` — 64 KiB objectiveRef admission (#207) | `const OBJECTIVE_REF_MAX_BYTES = 64 * 1024; // D5` at `:42`; enforced `:343-344` | ✗ off by 3 lines (substance intact) |
| `application.mjs:11631-11646` — "waves.run is synchronous for the wave's whole lifetime" (#173) | `const detach = request.detach !== false;` at `:11695`; detach is DEFAULT, sync only via `detach:false`; acceptance branch `workflow-interpreter.mjs:721-740` | ✗ stale (same class as redrive-3's finding): a pin merely demanding detach is GREEN at HEAD → shallow-greenable. Pins must target the residual gaps (settlement unreadable, startError dropped, detach unreachable from transports) |
| `workflow-interpreter.mjs:534-609` — "the drive" | `:534-541` is now `matchDecision`; the drive/settle span has moved down ~60-100 lines (settle outcomes build ~`:663-698`, seven-key receipt `:708-718`) | ✗ off; contracts must cite fresh line numbers |
| `limits.mjs:56` — `run.objective` 4096-byte cap (#207) | `'run.objective': { … value: 4096 … graceful: 'spill-digest-citation' … }` exactly at `:56`; `wave.member.objective` `:57` | ✓ accurate |
| `wave.mjs` startError never reaches the receipt (#207) | captured `wave.mjs:235/250` (start) and `:317/331/334` (attach); reaches handle projections `:353` and settle outcomes `:472`; the interpreter rebuilds outcomes WITHOUT `error` (~`:676-681`) and `void stopReceipt;` (~`:707`) | ✓ accurate at HEAD |
| #199 — creation failures emit no store events | `wave.member_start_failed` does NOT exist at HEAD (grep zero in `impl/src`); `startError` still dies in the in-memory handle | ✓ still red — the members row's target is live |
| #194/#205 — spill artifact / decision ledgering | `spill.body` 1 MiB ceiling intact (`limits.mjs` registry); NO `decision.*` record event kind minted anywhere in `impl/src` (grep zero) | ✓ consistent — the ledger row's target is live |

### Impl deltas since `09200e9` the contracts MUST absorb (a contract citing redrive-3 anchors verbatim is a wrong-citation finding)

- **D-A (base commit, `cda6355b`):** async + skip-if-clean. The #168 mechanism (on-branch
  `add -A` + `commit`, silent catch) SURVIVES but only fires on a dirty probe. An fs contract
  grounding "four captures / unconditional commit" without noting the clean-tree skip is stale.
- **D-B (quiescence, `8ec52a6c`):** verdict enum is now `WAVE-OK | WAVE-INCOMPLETE |
  WAVE-QUIESCED` (`workflow-interpreter.mjs:~700-704`), and quiesced outcomes carry optional
  `quiescenceLastMeaningfulAt` / `quiescenceSilenceMs` / `progressClass: 'silent'` keys
  (`:683-692`). Settle-receipt "EXACTLY seven keys" still holds at TOP level (`:708-718`);
  outcome-row keys are NOT closed. fs's FS-P4/P5 verdict-degradation pins remain viable but must
  cite the new enum.
- **D-C (steering index, `85519556`):** `_runIdForWaveMember` is now index-first
  (`application.mjs:11985-12001`, `index.byWaveRole`) with the event-log scan as fallback.
  RESOLVED this session: the index build is ALSO first-match (`_runWaveIndex`,
  `application.mjs:11592-11609` — `if (!roles.has(p.waveRole)) roles.set(p.waveRole, p.runId)`
  at `:11605-11606`), and the fallback scan returns the first `steering.registered` match
  (`:11994-11999`). Stale-first resolution holds at BOTH paths at HEAD; the members row's
  D2.2/A3 target survives with fresh anchors (`:11605-11606` / `:11994-11999`).
- **D-D (settlement record):** `wave.settled` kind EXISTS and is minted
  (`application.mjs:145`, record at `:11699-11705`) — but NO waves.* verb returns it (grep:
  `settlement` hits in waves handlers absent; `settlementDigest` hits are unrelated context-lane
  machinery). Launch's GT-L3 "durable but unreadable" claim remains TRUE at HEAD; the pin must
  cite `:11699` mint + absence-of-read, not "never minted".

### P0 — seed-brief deliverable-path defect (recorded; watch item)

Every redrive-4 row brief's Deliverable line names
`docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive3/contract-*.md` — the PREVIOUS
drive's path — while the wavefile's scope/report/harvest rows for this wave all name `redrive4/`
(`lifecycle-contracts.wavefile:6-47`), and the dispatch constraint reads "Work only within:
…/redrive4/**". A row following its brief's Deliverable line literally writes OUTSIDE its wave
scope and FAILS its own harvest. The QA's rule: a redrive4 contract landing at the `redrive3/`
path in a sibling tree is BOTH a scope violation and a harvest failure — recorded as a finding
against the row, with the seed-brief defect named as the cause. As of this write no tree is
dirty, so no row has taken that branch.

## Boundary map (the four contracts share the wave lifecycle — seams declared from the briefs; overlaps/gaps re-confirmed per landed contract)

Declared seams:

- **fs** — base-commit dirty-state capture (#168) · snapshot index.lock reaps (#172) · member
  raw-fs confinement + settle sweep (#185). Surface: `workflow-interpreter.mjs` base-commit path
  (now `:592-602`), the snapshot machinery, the write-scope fence.
- **launch** — detach/acceptance-receipt (#173, residual gaps per prep finding above) · response
  shapes (#202) · objectiveRef-admission alignment + startError on the wire + spill graceful
  path (#207). Surface: `application.mjs` runWorkflow (`:11695+`), the interpreter
  settle/acceptance spans, `limits.mjs`, `wave.mjs` startError.
- **members** — creation failures emit typed events, never phantom (#199) · task-id namespacing
  (#200) · drain-restart (#204) · the #218 addendum (seat_queued ledgered state, spawn-stage hop
  events, admission-time serialization honesty; the #221 reconciliation). Surface:
  `coordination-store.mjs` creation/event tables, task-id derivation, the resident drain, adapter
  seat ceilings.
- **ledger** — model-visible-means-logged + durable no-step turn (#194) · decision ledgering
  (#205). Surface: `coordination-store.mjs` log/spill seam, the `decision.*` lane.

Known overlap seams (must be reconciled at fold — one owner each, others cite):

1. `spill-digest-citation` — launch (#207: the receipt carries the spill) × ledger (#194: the
   spilled artifact is reconstructable). Same `limits.mjs` rows (`:54-57`).
2. objectiveRef path seam — fs (#168/#185: the path is captured/confined) × members (#200: the
   path derives the task id).
3. Response shape — launch (#202: closed JSON receipt) × ledger (#194: served context
   reconstructable from the store). The same wire bytes.
4. startError truth — launch (wire half: receipt carries the cause) × members (store half: the
   `wave.member_start_failed`-class record). Fold law from redrive-3 stands: the captured
   `error.code` must be IDENTICAL at both seams.
5. seat/queue truth — members (WRITES the `seat_queued` ledger) × telemetry (#146 read surface,
  `impl-telemetry-2026-08-14/redrive1/row-telemetry-brief.md:26`) × fs D4 settle sweep (escape
   attribution when a queued member's spawn is the writer).

Known gaps to check per landed contract: `attachWave`/re-drive (`wave.mjs:275-344` region), the
wave-side `evidence()` trace vs the store-side ledger, and the ledger row's reaction to fs's
`member_fs_escape` store event (redrive-3 fold check F-B1, never closed — redrive-3 shipped no
ledger contract).

## Per-contract verdicts (filled when the contract lands on disk — none fabricated before then)

### contract-filesystem.md (row-lc-fs — #168 · #172 · #185)

**VERDICT: SOUND.** Read on disk at `ws-38353b60…` (this round's row-lc-fs worktree), attempt-echo
at line 3 ✓, harvest token `#168` present ✓, deliverable at the `redrive4/` path ✓ (the row
RECORDED the seed-brief's stale `redrive3/` deliverable line and ruled the wavefile governs —
judgment call 2, exactly the right discipline; disposes of prep finding P0 for this row).

**Spot-check record (16 anchors read fresh in the shared base; NUL-bearing files not
load-bearing for this contract):**

| Contract anchor | Verified | Result |
|---|---|---|
| `workflow-interpreter.mjs:597/:599/:600/:602` — status probe / `add -A` / base commit / silent catch | read line-exact | ✓ (and the contract correctly re-anchors the seed brief's `:525` AND absorbs D-A — async, skip-if-clean, conditional-on-dirty; its G1 heading says "whenever the tree is dirty", the corrected form) |
| `worktree.mjs:1047/:1053` — `pinBaseSha` / `DirtyRepoError` throw; class `:30-32`; no-options caller `index.mjs:567` | read line-exact | ✓ |
| `application-deployment.mjs:201/:204/:216/:225/:230/:233` — untracked probe / credential paths / `GIT_INDEX_FILE` / `read-tree` / `write-tree` / `commit-tree` | read line-exact | ✓ |
| `worktree.mjs:1209/:1225` — `captureCommit` bare add/commit | read line-exact | ✓ |
| `workflow-interpreter.mjs:707-715` — EXACTLY seven sorted receipt keys, D6 comment `:706` | read line-exact | ✓ |
| `workflow-interpreter.mjs:701-703` — verdict computation incl. `driveExit === 'quiesced'` | read line-exact | ✓ (D-B absorbed: FS-P4's `≠ WAVE-OK` and FS-P5's `IS WAVE-OK` are grounded against the three-value enum) |
| `workflow-interpreter.mjs:741/:775/:778/:784` — `harvestOne` / materialize calls / `materializeToDisk` | read | ✓ |
| `coordinator.mjs:13501-13515` — scope filter pair `:13501-13502`, `worker_path_scope_violation` throw `:13505` (code `:13506`) | read line-exact | ✓ |
| `adapter.mjs:751/:761/:773/:787` — codex card + `danger-full-access` argv, claude card + unverified-containment, `GlmAdapter extends ClaudeAdapter` | read; boundary strings verbatim substrings of the source | ✓ |
| `worktree.mjs:995/:1006` — `validateOwnedWorktree` / JSON-only `merge-base` anchor | read | ✓ |
| `kernel-honesty-audit.md:47/:48` — stale-lock row + base-commit-pinning row | `sed -n` | ✓ both rows |
| `PROGRESS.md:36` — #172 filing | `sed -n` | ✓ |
| G2 four captures (`055c6cc`/`cd555ca`/`a176f39`/`04bd28f`) | `git show --stat` re-run by the row; shas/messages corroborated by this repo's history and the redrive-3 QA's independent re-run | ✓ |

**Acceptance pins (shallow-greenability):** FS-P1's clause (c) dirt-survives blocks
stash/reset escapes and clause (d) success-on-dirty blocks refuse-dirty-trees laziness; FS-P2's
fixture (no HEAD) stays red under the NEW skip-if-clean form because the probe itself fails
silently (the contract's own drift note — correct); FS-P3 carries the no-lock control side;
FS-P4/P5 jointly pin presence-on-escape AND presence-empty-on-clean; FS-P6 pins the ref against
a forged owner JSON. No clocks (mtimes observed, never asserted). Two drafting notes, neither
blocking: (a) FS-P5's fixture should state the roster fully settles AND harvests green — at
HEAD a merely-quiesced clean wave receipts `WAVE-QUIESCED`, not `WAVE-OK`, so the fixture must
exclude the quiesced exit for the assertion to be about the escape knob alone; (b) FS-P4's
RED-at-HEAD rationale should name the three-value enum explicitly (it cites `:701-703`, which
does carry it — cosmetic).

**Refusal vocabulary:** four new codes (`workflow_base_unavailable`, `worker_index_lock_stale`,
`member_fs_escape`, `worker_base_ref_invalid`), typed, payload-keyed, coached, declared COMPLETE
and surface-constant; frozen existing surfaces named with anchors (`DirtyRepoError`,
`worker_path_scope_violation`, `harvest_ok`/`harvest_miss`, seven receipt keys). Closed ✓.

**Boundary conduct:** D6 again cedes receipt-shape authority to the launch row and escalates as
DECISION_REQUEST with options + recommendation (b — store event + verdict downgrade). §5.5 names
the capacity-row lock-tombstone seam for this QA: see boundary finding B-1 below. The
`member_fs_escape` store event still needs the ledger row's acknowledgment (fold check F-B1 —
carried).

### contract-launch.md (row-lc-launch — #173 · #202 · #207)

**VERDICT: SOUND.** Read on disk at `ws-544b2d73…` (this round's row-lc-launch worktree),
attempt-echo at line 3 ✓, harvest token `#173` present ✓, deliverable at the `redrive4/` path ✓
(judgment call 1 records the stale-brief path ruling — P0 disposed for this row).

**Spot-check record (18 anchors read fresh at the shared base):**

| Contract anchor | Verified | Result |
|---|---|---|
| `application.mjs:11691-11695` — #173 landing comment + `const detach = request.detach !== false` | read line-exact | ✓ (the seed brief's "synchronous" claim re-anchored, per prep finding; the pins target the residual gaps — no shallow-greenable "demand detach" pin exists) |
| `application.mjs:11698-11708` — `wave.settled` mint; `workflow_settle_failed` `:11701`; key `wave.settled:<waveId>` `:11705` | read line-exact | ✓ (D-D absorbed: GT-L3 grounds "durable but unreadable" on minted-but-never-read, and its grep claim held under this QA's independent grep — `wave.settled` appears only at mint/constant/comments) |
| `workflow-interpreter.mjs:32-36` — the declared closed five | read line-exact | ✓ |
| `workflow-interpreter.mjs:552` — `workflow_facade_invalid` (NEW finding this redrive) | read line-exact | ✓ GT-L15's second undeclared code is real; the family-closure count moves to seven (D9) — verified below |
| `mcp-northbound.mjs:609-615` — `baton_waves_run` schema admits only `repoId/spec/specDsl`; handler `:1917-1921` forwards `spec` only; `unknown_argument_field` `:1020-1022` | read line-exact | ✓ detach is unreachable from MCP |
| `application-cli.mjs:1370-1373` — CLI sends `{specPath}` | read line-exact | ✓ no sync flag |
| `mcp-northbound.mjs:409/:539/:559` — advertised `maxLength: FRAME_LIMITS[...]` (4096) on the exact graceful lanes | read line-exact | ✓ GT-L7 accurate (the row even improved the citation to the symbolic `FRAME_LIMITS` form) |
| `application.mjs:4519-4541` — spill admission: ceiling check `:4526-4528`, `mintSpill` key `:4532`, `[SPILLED {citation}]` `:4538` | read line-exact | ✓ |
| `workflow-interpreter.mjs:42/:343-344` — `OBJECTIVE_REF_MAX_BYTES` + enforcement | read line-exact | ✓ (seed `:39` re-anchored) |
| `mcp-northbound.mjs:196-199/:2274/:264` — `toolResult` envelope, non-record sanitize pass-through, `workflow_*` prefix arm | read line-exact | ✓ GT-L10's two degrade seams are verbatim real |
| `wave.mjs:250` startError capture; interpreter outcome rebuild `:663-696`, `void stopReceipt` `:705` | read | ✓ |
| `application-client.mjs:1555` — facade `waves.start` → `createWave` | read line-exact | ✓ (the two-lane split GT-L12's binding) |
| `coordination-store.mjs:14130/:14169` — `writeScratchpad` + `worker:` scope hardcode | read line-exact | ✓ (#158 publish refusal grounded) |

**Acceptance pins (shallow-greenability):** all twelve pins verified RED at HEAD against the
cited behavior — the pre-registered shallow-green traps from prep are all dodged: PIN-L1 pins
NO-acceptance-minted (not a verdict flip), PIN-L2 asserts code EQUALITY with the run.start
refusal (generic synthesis fails), PIN-L3 asserts the DURABLE record and idempotent re-read (a
live-computed verdict fails), PIN-L4's non-boolean clause accepts either typed refusal but not
coercion, PIN-L5's second clause (admit-with-spill behavior) is the substance over schema-number
fiddling, PIN-L7 drives an ARBITRARY string through the seam (grep-the-corpse greens nothing),
PIN-L8 distinguishes unknown from empty-but-real, PIN-L9 asserts BOTH doors refuse (unifying
downward fails), PIN-L10 asserts against the live registry, PIN-L11 requires the `admitted` key,
PIN-L12 requires the typed refusal over coercion. GT-L17 correctly scopes the outcome-key
closure to the EXTENDED set (quiescence keys included) — D6's `error` is the only addition.

**Refusal vocabulary:** existing codes table re-anchored and verified; NEW set closed at FOUR
(`wave_start_all_members_failed`, `wave_unknown`, `workflow_request_invalid`,
`deployment_readiness_invalid`) with shapes; the `workflow_*` family declared at SEVEN (D9 —
including the two previously undeclared mints). Lineage note honestly records redrive-3's
three→four growth. No prose-string refusals, no clocks ✓.

**Boundary conduct:** §7 names the fs/members/ledger seams and carries the D7c asymmetry to the
members row as OQ-L6 (DECISION_REQUEST if the members fold lands a different law) — the
startError code-identity law ("IDENTICAL in both") is stated. OQ-L7 hands the quiescence
outcome-key enumeration to whichever row pins outcome shape — see boundary finding B-2.

### contract-members.md (row-lc-members — #199 · #200 · #204 + the #218 addendum)

**VERDICT: SOUND — with a named citation-correction fold (F-M1 below; mechanical, no
substantive blocker).** Read on disk at `ws-c850c76e…` (this round's row-lc-members worktree),
attempt-echo at line 2 ✓, harvest token `#199` present ✓, deliverable at the `redrive4/` path ✓
(read-order names the wavefile's report row — P0 disposed), shared publish
`redrive4/shared/contract-members.md` verified ON DISK in the row's tree ✓ (the drive-3 publish
claim's non-landing is honestly flagged by the row itself).

**Spot-check record (~28 anchors read fresh; this QA's own prep independently pre-measured the
index block, which caught F-M1):**

| Contract anchor | Verified | Result |
|---|---|---|
| `wave.mjs:207-208` waveId mint · `:250-252` startError catch · `:353`/`:472` failed projections | read line-exact | ✓ |
| `workflow-interpreter.mjs:574` salt · `:608` waves.start · `:628-631` #163 no-clock law · `:639` driveExit · `:648` preOutcome `'failed'` · `:656-683` outcomes build · `:707-715` seven keys · `:721-729` acceptance | read line-exact | ✓ all (the `8ec52a6c` re-anchoring from `:590/:599-620/:631-639/:643-652` is exact) |
| `application.mjs:11985-11999` — fallback scan first-match | read line-exact | ✓ (matches this QA's D-C resolution) |
| `application.mjs:11582-11607` / `:11599-11602` / `:11586-1188` — `_runWaveIndex` block, keep rule, first-match-wins comment | read line-exact | ✗ **F-M1: the index anchors are OFF** — function `:11592-11609`, keep rule `if (!roles.has(p.waveRole))` `:11605`, comment `:11590-11591`. Substance CORRECT (both paths stale-first; the comment names first-match-wins intent), but all four citations of this block (GT10, D2.2, A3, judgment call 5) carry wrong lines — the drive's headline NEW material is the one region not re-measured |
| `coordinator.mjs:2922-2926` — #221 ruling comment | read | ✗ off by 2 — comment `:2920-2924`, dispatch `:2925` (pass opens `:2911` ✓; the silent `continue` at `:2919` ✓) |
| `impl/scripts/baton.mjs:43-47` — SignalLifecycleOwner construction | read | ✗ off — construction at `:48` (import `:9`) |
| `wave-driver.mjs:359-367`/`:376-379` — salt mint/render, ritual re-attach | read | ✓ (`:361`/`:365` exact; the re-attach comment begins `:379` — range's tail, borderline-acceptable) |
| `coordinator.mjs:2919` bare continue via `router.mjs:202-203` null | read | ✓ (eligible-filter + null-return exact) |
| `coordinator.mjs:3416/:3464/:3490-3496/:3514/:4678/:4776` — provider-turn events, fail-admission, task.claimed, reserveCapacity calls | read line-exact | ✓ |
| `index.mjs:371/:1554-1558/:1592-1611` — reserveCapacity, driver_capacity_active, coordinator_drain_incomplete | read line-exact | ✓ |
| `application-host.mjs:81/:190` · `application-deployment.mjs:1394-1402` `#occupancyFor` | read line-exact | ✓ |
| `coordination-store.mjs:13252-13268` deferTaskDispatch (dead API) · `:12757-12775` mapOperationalEvent/evidence.mapped | read | ✓ |
| `application.mjs:1562-1567` deliberate-exclusion comment · `:3346-3354` runId digest · `:11756-11772`/`:11782-11786`/`:11804-11830` startWave refs · `:11491-11493`/`:11521-11523` attach refusals | read | ✓ (the `85519556`/launch re-anchorings are exact) |
| GT4 closed `_append` kind set, no `wave.member_*` | this QA's grep agrees (`wave.member_start_failed` zero at HEAD) | ✓ |

**Acceptance pins (shallow-greenability):** A1's anti-shallow demands store replay + BOTH ports
minting; A2 drives `saltObjectives:false` so salting-the-objective cannot fake namespacing; A3 —
strengthened this drive over redrive-3 — drives BOTH the index-served and fallback-served reads
(a one-path fix stays red) and admits the typed-collision alternative; A4 asserts (a)(b)(d) so
swallow-and-exit-0 stays red; A5 asserts the #221 law negatively (any synthetic pre-cap is a
pin failure) and demands the payload truths (position + holders); A6 requires events to TRAIL
physical effects (crash-between-effect-and-mint expectation); A7 demands `estOrder` and the
admission-vs-live labeling. No clocks anywhere — D3/OQ3/OQ7 explicitly bind to the #163
event-derived discipline (GT26). No shallow-green path found.

**Refusal vocabulary:** new kinds/codes closed and enumerated (`wave.member_start_failed`,
`wave_member_task_collision`, `task.seat_queued`, four hop kinds, `wave_admission_fenced`,
`drain_restart_incomplete`); reused-unchanged table re-anchored (one off-by-2 inside
`coordinator_draining`'s fence cites — within F-M1's correction set). The MCP allowlist claim
(`mcp-northbound.mjs:214-241,266`) is consistent with the launch row's `:264` prefix arm.

**Boundary conduct:** exemplary — the row explicitly does NOT re-litigate #207 (launch's), does
not amend scope/harvest (fs's), flags D6's acceptance-key addition against LAUNCH's shape
authority as DR2, hands the seat READ surface to telemetry, and pins the #194 visibility seam
as OQ4 for the ledger row. GT25 correctly files the v18 launch-blockade material as launch/fs
context.

**Fold instruction F-M1 (mechanical citation corrections — apply before the suite pins land):**
1. `_runWaveIndex` block: `application.mjs:11582-11607` → `:11592-11609` (comment block
   `:11585-11591`).
2. Index keep rule: `:11599-11602` → `:11605` (with the `byRunId` first-match at `:11599-11601`
   as the sibling rule).
3. First-match-wins comment: `:11586-1188` → `:11590-11591`.
4. #221 ruling comment: `coordinator.mjs:2922-2926` → `:2920-2924` (dispatch `:2925`).
5. SignalLifecycleOwner construction: `impl/scripts/baton.mjs:43-47` → `:48`.
No pin's red-first validity or anti-shallow construction depends on the wrong lines; the
corrections are required because the contract's own provenance clause claims exact-line
re-verification, and GT10 is the block the fold will read first.

### contract-ledger.md (row-lc-ledger — #194 · #205)

**VERDICT: SOUND ON CONTENT — with one blocking deliverable-path defect (F-L1 below; mechanical
relocation, no substantive blocker in the contract text).** Found on disk at `ws-79bb06cd…`
(this round's row-lc-ledger worktree) at the WRONG PATH —
`redrive3/contract-ledger.md`, the stale seed-brief path — exactly the failure mode prep
finding P0 pre-registered. Attempt-echo at line 3 ✓, harvest token `#194` present ✓ (but the
harvest itself FAILS as landed — see F-L1). Audited from zero: redrive-3 shipped no ledger
contract, so this is the row's first delivered text; every pre-registered check ran.

**Spot-check record (11 anchors read fresh at HEAD; all exact — no F-M1-class findings):**

| Contract anchor | Verified | Result |
|---|---|---|
| `decision.*` grep-zero (GT-D8) | grep `_append('decision` over `coordination-store.mjs` re-run by this QA | ✓ zero matches — #205's target is live, as pre-registered |
| `limits.mjs:54` message.send.body 2048 graceful / `:59` decision.question hard `graceful: null` | `sed -n` line-exact | ✓ both |
| `application.mjs:11694-11709` wave.settled mint, best-effort catch | read; `workflow_settle_failed` at `:11701`, catch at `:11708` | ✓ (span-tail 11709 includes the closing brace — defensible; launch's `:11698-11708` and this `:11694-11709` co-describe the same block) |
| `coordinator.mjs:2551-2560` — `turn.wait_noted` minted by the deliberate no-op | read line-exact (kind at `:2554`) | ✓ |
| `application.mjs:61` DEFAULT_TURN_NUDGE_MESSAGE + `:12463-12478` input arm (`?? DEFAULT` at `:12471`) | read line-exact | ✓ GT-D7's unrecorded-message finding is real |
| `coordination-store.mjs:13789-13801` — `recordMessage` guards kind/idempotency only, NO size admission | read line-exact | ✓ GT-D4's alias-lane bypass is real |
| `coordination-store.mjs:14169` — `worker:` scope hardcode | read line-exact | ✓ (#158 refusal grounded; agrees with launch/members/fs) |
| `coordinator.mjs:7766-7777` — `message.sent` full body inline + best-effort swallow at `:7776` | read line-exact | ✓ |
| `coordinator.mjs:10347-10366` — stale-fence discard + no-live-worker shortcut, no store event on either arm | read line-exact | ✓ GT-D10's mechanism is real |
| `coordinator.mjs:13900-13906` — `_pending` "reconstructed purely from the durable log" | read line-exact | ✓ the replay-resurrection claim holds |
| byte-identity claim (judgment call 2): `coordinator.mjs`/`coordination-store.mjs`/`limits.mjs` identical `09200e9`→`5ae2c7e5` | `git diff --stat` re-run: EMPTY | ✓ |

**Acceptance pins (shallow-greenability):** PIN-D1 asserts digest EQUALITY with the captured
ADAPTER input (recording `task.brief` instead of the served composition fails — the sharpest
anti-shallow in the pack); PIN-D2's trap explicitly blocks refuse-the-oversize (a wall in front
of a spill lane) and demands ADMIT-with-spill — composes with launch's PIN-L5; PIN-D3 drives a
crash between effect and confirm and requires the pre-effect record to already reconstruct;
PIN-D4's clause (b) blocks the controlId-conditioned logging (HEAD's exact shape); PIN-D5
requires the DEFAULT nudge message recorded identically (eliding the default fails); PIN-D6's
reader is a bare store replay with no operational resolver (digest-only pointers fail) AND the
closed-shape validation clause blocks the `driver.recorded` envelope shortcut; PIN-D7 keys
reconstruction on exactly `requestId`/`disposition`; PIN-D8 asserts BOTH the success-path
closure AND byte-unchanged refusal shapes (weakening the refusals to "close the asymmetry"
fails). No clocks. No shallow-green path found.

**Refusal vocabulary:** three new codes (`dispatch_ledger_unavailable`,
`decision_record_invalid`, `decision_ledger_conflict`), typed, payload-keyed, closed; existing
surfaces re-anchored and frozen (incl. the `decision_*_exceeded` family and
`message_lane_invalid`/`conflict`, both verified in this QA's reads); result-code family
correctly kept RESULT codes, not refused-as-vocabulary. ✓

**Boundary conduct:** exemplary and pre-registered-complete — GT-D12/§3 ACKNOWLEDGE fs's
`member_fs_escape` store event with vocabulary discipline applied, cited not re-owned (**fold
check F-B1 from redrive-3 is now CLOSED**: a ledger contract exists and answers the record);
OQ-D4 picks up launch's OQ-L2 handoff exactly (receipt shape = launch, reconstructability =
ledger, one spill economy — overlaps 1/3 agree); OQ-D5 names the members-row kind-disjointness
check; OQ-D3 hands operational-log retention to fs as a natural joint pin.

**Fold instruction F-L1 (blocking, mechanical — the path defect):** the wavefile pins this
row's report (`lifecycle-contracts.wavefile:36`) and harvest (`:47`,
`redrive4/contract-ledger.md` mustContain `#194`) to the **redrive4** path; the dispatch
constraint scopes the row to `redrive4/**`. The landed file is at `redrive3/contract-ledger.md`
in `ws-79bb06cd…` — as landed it (a) FAILS its own harvest (the pinned path does not exist in
its tree) and (b) writes outside its wave scope. The row's judgment call 1 ("the task and the
brief BOTH name redrive3… the twice-named path wins") counted the stale brief and the task
boilerplate but OVERLOOKED the wavefile's two namings — which sit in its own tree and are the
later, more specific dispatch artifact; the fs, launch, and members rows all ruled the opposite
way on the identical discrepancy this same wave. The fold MUST relocate (git-mv, history
preserved) `redrive3/contract-ledger.md` → `redrive4/contract-ledger.md` in that tree before
harvest runs, or the row fails. Seed-brief defect (P0) named as the cause; the row's ruling is
the wrong resolution of it, recorded here, not silently.

## Boundary findings (B-1 · B-2 — the seams the per-row verdicts reference)

- **B-1 — lock-tombstone vocabulary: fs × the capacity/worktree-reap discipline (fs §5 OQ5).**
  fs's D3 splits baton git-lock handling into BORROWED ground (the operator's repo: never
  auto-reap, refuse `worker_index_lock_stale` with holder/mtime coaching) vs OWNED ground
  (`.baton/` authority roots, where auto-reap may be legitimate), and asks whether that split
  matches the capacity-row's lock-tombstone reap discipline. RULING FOR THE FOLD: the split is
  COHERENT and should be adopted as the wave-wide law — the capacity rows already reap
  `.baton/`-internal stale state by design (the worktree-capacity reservation lifecycle this
  session's own `reservations.json` churn demonstrates), while the operator repo is exactly the
  ground fs's G5 incident put at risk (two manual reaps of a holderless `.git/index.lock`).
  One vocabulary, two grounds: `worker_index_lock_stale` (borrowed: coach, never reap) vs the
  capacity lane's existing reap discipline (owned: reap is sanctioned). No contract
  contradicts this; fs's OQ5 + D3 need only cite the capacity row's discipline as the owned-
  ground precedent at fold.
- **B-2 — quiescence outcome-key enumeration: ownership assigned (launch OQ-L7 × members
  OQ7 × fs D-B absorption).** Three rows touch the `8ec52a6c` (#163) outcome-key growth:
  launch GT-L17/D6 pins the CLOSED extended set (`{role, phase, terminal, resultSha, error}` +
  the existing optional report/verifiedBy/quiescence keys — `error` the only addition) and
  explicitly scoped OQ-L7 to "whichever row pins outcome shape"; fs's FS-P4/P5 ground verdict
  degradation against the three-value enum without pinning outcome keys; members OQ7 names the
  resident-side quiescence question but defers to the #163 event-derived discipline. RULING FOR
  THE FOLD: LAUNCH owns the enumeration (it is the only row that pinned the closed set); fs and
  members cite it. No conflict exists as written — all three rows' citations of the enum agree
  with this QA's independent read (`workflow-interpreter.mjs:701-703` verdict, `:683-692`
  quiescence keys, seven-key top level `:707-715`). Recorded so the fold does not re-litigate.

## Four-way coherence statement (the cross-contract synthesis)

The four contracts compose with NO substantive contradiction; every declared overlap seam has a
named owner on both sides and a one-shape law:

1. **startError truth (launch × members, overlap 4):** launch PIN-L2 asserts code EQUALITY with
   the run.start refusal on the wire; members D1 mints `wave.member_start_failed` preserving the
   inner `cause.code`. Both rows state the identity law ("IDENTICAL at both seams") verbatim.
   Coherent.
2. **spill-citation economy (launch × ledger, overlaps 1/3):** one admission per economy —
   launch's PIN-L5 admit-with-spill behavior + ledger's PIN-D2 admit-with-spill at the alias
   lane, both citing the same `limits.mjs` lanes (`:54-57`, ceiling `:86`), both naming the
   same anti-pattern (a wall in front of a spill lane) as a trap. Ledger OQ-D4 picks up launch
   OQ-L2's handoff verbatim. Coherent.
3. **`member_fs_escape` (fs × ledger, fold check F-B1):** CLOSED this drive — the ledger
   contract exists, acknowledges the event (GT-D12/§3), and imposes its vocabulary discipline
   without re-owning it. Coherent.
4. **seat/queue truth (members × telemetry × fs, overlap 5):** members WRITES the
   `task.seat_queued` ledger and names telemetry the READ surface; fs's D4 sweep attributes
   escapes without touching the queue lane. Coherent.
5. **Store event-table growth (all rows):** members' five new task-lane kinds, ledger's
   `decision.*` + served-context records, fs's `member_fs_escape` — ledger OQ-D5 names the
   disjointness check; no two rows mint the same kind. Coherent, with the fold-level check
   named.
6. **Receipt-shape authority (launch, cited by all):** fs D6 escalates rather than deciding;
   members D6/DR2 flags its acceptance-key addition against launch's authority; launch D7c/OQ-L6
   hands the asymmetry law to the members fold. The one genuine cross-row DECISION on the table
   is members DR2 (does `serialization` join the acceptance key set?) — launch's contract pins
   the acceptance shape `{accepted, manifestDigest, members, schemaVersion, verdict, waveId}`
   as closed, so members' option (a) requires amending launch's closed set; the fold must
   decide (b) — payload-under-`members` — is the zero-conflict default. ESCALATED below.

**Gaps found (the pre-registered checks):** none new beyond F-M1/F-L1. The redrive-3 gap
(no ledger contract) is closed by this drive's ledger row; the launch-blockade/`wave.settled`
readability gap is pinned by launch PIN-L3/L14; the #221 residual silent vector is pinned by
members A5.

**DECISION_REQUEST to the orchestrator (authority-class, one item):** members DR2 vs launch's
closed acceptance key set — options: (a) `serialization` joins the acceptance keys (amends
launch's closed set; members' default), (b) serialization truth rides under existing `members`
rows (no key-set change; this QA's recommendation — zero conflict with launch's pins), (c) a
separate admission receipt verb. Recommendation: (b).

## Residual register (final)

1. **Fold instructions outstanding (2):** F-M1 (members citation corrections — mechanical, five
   line-number fixes) and F-L1 (ledger deliverable relocation `redrive3/` → `redrive4/` in
   `ws-79bb06cd…` — blocking for that row's harvest). Neither requires re-verification of any
   pin's substance.
2. **Seed-brief staleness recorded (P0 et al.)** — inputs to the rows, not row output. Three of
   four rows resolved P0 correctly (wavefile governs); the ledger row's contrary ruling is
   finding F-L1's cause. The briefs themselves should be regenerated before any redrive 5.
3. **DECISION_REQUEST outstanding (1):** members DR2 / launch acceptance key set — options and
   recommendation in the coherence statement above.
4. **Drafting notes, non-blocking:** fs FS-P5 fixture must exclude the quiesced exit
   (`WAVE-QUIESCED` ≠ `WAVE-OK` at HEAD); fs FS-P4's RED rationale may name the three-value
   enum explicitly (cosmetic); launch/ledger's co-describing spans on the `wave.settled` mint
   (`:11698-11708` vs `:11694-11709`) should be normalized to one citation at fold.

## Publish (final record)

**Published ON DISK** to `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive4/shared/contract-qa.md`
(inside this seat's own `redrive4/**` scope — the members row's precedent: the `shared`
DIRECTORY inside one's scope is writable; the store's `shared` SCOPE is not). The #158
store-lane refusal stands as the three member rows recorded it, re-verified by this QA at
`coordination-store.mjs:14169` (the `worker:` scope hardcode): a member-row publish to the
store's `shared` scope is silently admitted into the worker partition, not refused — no typed
refusal string exists to quote. Fabricating a store-scope publish was not an option.

**Verdict roll-up:** filesystem SOUND · launch SOUND · members SOUND (fold F-M1) · ledger SOUND
on content (fold F-L1, blocking for harvest). The suite is fit to gate its impl wave once
F-L1 is executed and F-M1 applied.
