CONTRACT-QA v1

[attempt: 9a07d8eb-e52d-475f-ac64-65ffbb707813 coordinator]

Coordinator QA — the lifecycle-contracts four-row foundry, redrive 3 (package ③, wave
`lifecycle-contracts-2026-08-14-wave-a-rd3`). Every claim below is cited evidence (on-disk
reads: `sed -n` / `grep -an` / `git log` / `ls` of sibling worktrees and reservation records) or
an explicitly named absence. No clocks, no fabrication. This file is written INCREMENTALLY: the
prep audit and boundary skeleton below are final; the four per-contract verdicts are filled in
when each row's contract lands on disk (status table tracks it).

## Signal + on-disk status (the #174 law — silence is not death)

| Lane | Expected (wavefile) | State |
|---|---|---|
| messageOnSpawn `brief` | read objectiveRef + foundry-brief | RECEIVED — this session opened with both, read in full |
| signalOnMembersDone `result` | fires when `row-lc-fs,row-lc-launch,row-lc-members,row-lc-ledger` all settle | NOT RECEIVED at this incremental write |

On-disk verification (re-checked before each verdict is written):

- Sibling worktrees swept (`../../wt/ws-*/`, 24 at last sweep). NO `contract-filesystem.md`,
  `contract-launch.md`, `contract-members.md`, or `contract-ledger.md` under
  `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive3/` in ANY of them yet.
- Unlike the prior round (rows reserved, never materialized — see the wave-a checkpoint
  `lifecycle-contracts-2026-08-14-contract-qa.checkpoint-30401b32.patch`), THIS round's rows are
  live: `.baton/capacity/reservations.json` shows fresh worker reservations MATERIALIZED at this
  base (`baseSha 09200e9…`, e.g. `ws-df9b4abc…` 13:38:46Z, `ws-e7feafa2…` 13:39:04Z) — the
  dispatcher is moving. A background watcher polls for all four deliverables; each verdict below
  is written only after its contract is read on disk.

## Prep citation audit (run this session against HEAD `09200e9`, the base the rows share)

The row briefs are seeds; the contracts inherit their anchors and must re-verify them. Audited
fresh now so wrong seed anchors are already known:

| Anchor (seed brief) | Verified at HEAD | Result |
|---|---|---|
| `workflow-interpreter.mjs:39` — 64 KiB objectiveRef admission (#207) | `const OBJECTIVE_REF_MAX_BYTES = 64 * 1024; // D5` | ✓ accurate |
| `limits.mjs:56` — `run.objective` 4096-byte cap (#207) | `'run.objective': { … value: 4096 … graceful: 'spill-digest-citation' … }` | ✓ accurate (`wave.member.objective` :57 same shape) |
| `wave.mjs` startError never reaches the receipt (#207) | captured `wave.mjs:235/250/317/331/334`; reaches `progress()` member projection `wave.mjs:353` and settle outcomes `:472`; ZERO `startError` occurrences in `workflow-interpreter.mjs` (the waves.run receipt mint) | ✓ accurate at HEAD |
| `application.mjs:11631-11646` — "waves.run is synchronous for the wave's whole lifetime" (#173) | **STALE AT THIS HEAD**: `runWorkflow` now reads `const detach = request.detach !== false` (`application.mjs:11653`) with the `#173` comment "the bus DETACHES — waves.run returns the acceptance receipt after waves.start" at `:11650-11653`; detach is the DEFAULT, sync only via `detach:false`. The change is present ONLY as wave base-capture commit `ac0f5bc` ("baton workflow base impl-result-accessor…") — itself a live #168 specimen (a fix captured by the dirty-state base-commit machinery, no dedicated fix commit) | ✗ **the launch contract must NOT ground #173 as "synchronous at HEAD" — a pin that merely demands detach would be GREEN at HEAD → shallow-greenable. Its red-first pins must target the REMAINING gaps (see launch verdict slot)** |
| `workflow-interpreter.mjs:525` — "the base-commit line" (#168) | line 525 area is the render-objective/salt block (`const salt = randomUUID()`); the `git add -A` + `git commit -m "baton workflow base …"` capture is at `workflow-interpreter.mjs:536-542` | ✗ off by ~11 lines — any fs-contract pin citing `:525` for the base commit is a wrong-citation finding |
| `workflow-interpreter.mjs:534-609` — the drive | contains `pinFloorMs`, `waves.start`, the `#173` continuation comment + `settle()` split, `driveLane`, outcomes build | ✓ substantively accurate |
| #199 — creation failures emit no store events | `task.created` validation exists (`coordination-store.mjs:1498`); topology identity checks `:1626-1645`; the gap is the creation path not EMITTING, not a missing kind | ✓ consistent |
| #200 — task id derives from objectiveRef path, un-namespaced | task-topology `taskId` derivation `:1626-1664`, no wave namespace in the id path | ✓ consistent |
| #194 — spill artifact, never bodies-inline | `_spills` machinery + `spill.body` substrate row (`limits.mjs:86`, 1 MiB, enforced at `coordination-store.mintSpill`) | ✓ consistent |
| #205 — decision lane never ledgers | `decision.need`/`decision.rationale` admission caps enforced (`:3557-3566` → `coachingRefusal`); NO `decision.*` record event kind anywhere in `src/*.mjs` (grep: zero matches) | ✓ consistent |
| #172 — index.lock abandonment | `grep -rn 'index.lock' impl/src/` → zero matches (no handling exists) | ✓ consistent |

## Boundary map (the four contracts share the wave lifecycle — seams declared from the briefs; overlaps/gaps re-confirmed per landed contract)

Declared seams:

- **fs** — base-commit dirty-state capture (#168) · snapshot index.lock reaps (#172) · member
  raw-fs confinement + settle sweep (#185). Surface: `workflow-interpreter.mjs` base-commit path,
  the snapshot machinery, the write-scope fence.
- **launch** — detach/acceptance-receipt (#173, see stale-anchor finding above) · response shapes
  (#202) · objectiveRef-admission alignment + startError on the wire + spill-digest graceful path
  (#207). Surface: `application.mjs` waves.run, `workflow-interpreter.mjs` drive, `limits.mjs`,
  `wave.mjs` startError.
- **members** — creation failures emit typed events, never phantom (#199) · task-id namespacing
  (#200) · drain-restart (#204) · plus the #218 addendum (seat_queued first-class state,
  spawn-stage transition events, admission-time serialization honesty). Surface:
  `coordination-store.mjs` creation/event tables, task-id derivation, the resident drain, adapter
  seat ceilings.
- **ledger** — model-visible-means-logged + durable no-step turn (#194) · decision ledgering
  rides here (#205). Surface: `coordination-store.mjs` log/spill seam, the `decision.*` lane.

Known overlap seams (must be reconciled at fold — one owner each, others cite):

1. `spill-digest-citation` — launch (#207: the receipt carries the spill) × ledger (#194: the
   spilled artifact is reconstructable). Same `limits.mjs` rows (`:54-57`).
2. objectiveRef path seam — fs (#168/#185: the path is captured/confined) × members (#200: the
   path derives the task id).
3. Response shape — launch (#202: closed JSON receipt) × ledger (#194: served context
   reconstructable from the store). The same wire bytes.

Known gaps to check per landed contract: `attachWave`/re-drive (`wave.mjs:275-344` region) and
the wave-side `evidence()` trace vs the store-side ledger — assign or record out-of-scope-for-③.

## Per-contract verdicts (filled when the contract lands on disk — none fabricated before then)

### contract-filesystem.md (row-lc-fs — #168 · #172 · #185)

**VERDICT: SOUND.** Read on disk at `ws-4db665bf…` (this round's row-lc-fs worktree). Attempt-echo
at line 3 ✓. Harvest token `#168` present ✓.

**Spot-check record (13 anchors read fresh in the row's own tree; NUL-discipline files not
load-bearing there):**

| Contract anchor | Verified | Result |
|---|---|---|
| `workflow-interpreter.mjs:537–542` — add :539 / commit :540 / silent catch :541 | read line-exact | ✓ (and the contract correctly re-anchors the seed brief's wrong `:525` — recorded judgment call, exactly the right discipline) |
| `worktree.mjs:1047–1058` — `pinBaseSha` throws `DirtyRepoError` at :1053 unless `autoStash`; class :30–32; sole production caller no-options `index.mjs:567` | read line-exact | ✓ |
| `application-deployment.mjs:199–236` — sideband `GIT_INDEX_FILE` at :216, `commit-tree -p HEAD` at :233 | grep line-exact | ✓ |
| `worktree.mjs:1209/:1225` — `captureCommit` bare `git add -A` / `git commit` | read line-exact | ✓ |
| `coordinator.mjs:13501–13513` scope gate (`worker_path_scope_violation`), `pathInScope` :618–620 | read line-exact | ✓ |
| `workflow-interpreter.mjs:701–717` — `harvestOne` codes + `materializeToDisk` writes into `repoRoot` | read | ✓ |
| `adapter.mjs:751/:761/:773/:787–790` — codex `danger-full-access` + boundary text, claude `bypassPermissions` + unverified-containment boundary, GLM inherits claude card | read | ✓ |
| `worktree.mjs:96–129` `authorityRoot` symlink/escape rejection; `:1000–1010` `validateOwnedWorktree` identity checks trusting only `meta.baseSha` | read | ✓ |
| `workflow-interpreter.mjs:633–641` — EXACTLY seven sorted receipt keys | read line-exact | ✓ |
| G2 four base commits (`055c6cc`/`cd555ca`/`a176f39`/`04bd28f`) | `git show --stat` re-run | ✓ all four; line counts match (575/1627/173/251; `suite-notes-163.md` 148, `blueteam-161.md` 251). Nit: 055c6cc's "two notes files" is notes.md + receipt.json — immaterial |
| `kernel-honesty-audit.md:47` (#169 index.lock row) | `sed -n 47p` | ✓ verbatim |

**Acceptance pins (shallow-greenability):** P1 blocks stash/reset escape hatches via the
dirt-survives assertion (c); P3 carries a same-pin control (no lock → success, no lock left)
against always-refuse impls; P4/P5 jointly pin presence-on-escape AND absence-on-clean — an impl
that always emits empty records fails P4, one that never emits fails P5's presence clause. P2 and
P6 verified RED at HEAD against the cited catch-at-:541 and JSON-trust-at-:1005 behavior. No
clocks (mtimes observed, never asserted). One drafting nit, non-blocking: P5's "empty escape
record set" should say "present and empty" explicitly (its RED rationale already does).

**Refusal vocabulary:** four new codes (`workflow_base_unavailable`, `worker_index_lock_stale`,
`member_fs_escape`, `worker_base_ref_invalid`), typed, payload-keyed, coached, declared COMPLETE
and surface-constant; frozen existing surfaces named with anchors. Closed ✓.

**Boundary conduct:** exemplary — D6 explicitly cedes receipt-shape authority to the launch row
(#202) and escalates via DECISION_REQUEST with options + recommendation; §5.5 names the
capacity-row lock-tombstone seam for the QA pass. The D4 `member_fs_escape` store event touches
the ledger row's lane — ledger must ACKNOWLEDGE it (see ledger verdict slot; fold check F-B1).

### contract-launch.md (row-lc-launch — #173 · #202 · #207)

STATUS: PENDING — no deliverable on disk at last sweep. Pre-registered audit check from the prep
findings: every #173-grounded pin must be RED at HEAD `09200e9` GIVEN the detach already landed
(via base commit `ac0f5bc`). A pin reading "waves.run returns before settlement" is green at HEAD
and therefore a contract-law defect; the pin must name the residual gap (e.g. settlement-receipt
mint on failure paths, `detach:false` sync receipt shape, receipt keys closed).

### contract-members.md (row-lc-members — #199 · #200 · #204 + the #218 addendum)

STATUS: PENDING — no deliverable on disk at last sweep.

### contract-ledger.md (row-lc-ledger — #194 · #205)

STATUS: PENDING — no deliverable on disk at last sweep.

## Residual register

1. Signal not yet received at this incremental write; rows verified live (reservations
   materialized at this base). Watcher active.
2. Seed-brief staleness recorded (the `#173` sync claim and the `:525` base-commit anchor) —
   these are inputs to the rows, not row output; a contract repeating them unverified is a
   finding, the brief itself is not.
3. Publish-to-`shared`: the prior round recorded the #158 write-scope hardcode
   (`worker:<id>`-partition admission, no typed refusal) as the reason a shared publish silently
   lands in the worker partition. Re-verified this round before publishing (see final section
   once filled).
