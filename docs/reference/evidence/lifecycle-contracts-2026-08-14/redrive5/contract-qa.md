CONTRACT-QA v1

[attempt: 8850892d-e966-4377-a86f-f1c45f9160af coordinator]

Coordinator QA — the lifecycle-contracts four-row foundry, redrive 5 (package ③, wave
`lifecycle-contracts-2026-08-14-wave-a-rd5`). Every claim below is cited on-disk evidence
(`sed -n` / `grep -an` / `git show` / `ls` sweeps of the 14 sibling worktrees at `../../wt/ws-*/`
and the reservation record) or an explicitly named absence. No clocks, no fabrication. HEAD for
all anchor work: `5ae2c7e5` (the v19 flood base the rows share).

## 1. Signal + on-disk status (the #174 law — silence is not death)

The `signalOnMembersDone result` was RECEIVED this session ("All four rows settled — you are the
remaining member, the pinned #175 semantics"). The law says verify on disk anyway. Verified:

- 14 sibling worktrees swept at `../../wt/ws-*/` (`git worktree list`, base `5ae2c7e5`):
  `ws-01bf259f`, `ws-101caf8c`, `ws-13591126`, `ws-1632ab1b`, `ws-2a24f9dc`, `ws-2c91835d`,
  `ws-356f1f01`, `ws-398f8a11` (this seat), `ws-55a71049`, `ws-7b7397e1`, `ws-babffae0`,
  `ws-db224cbb`, `ws-e41fbd0e`, `ws-f416788e`.
- `.baton/capacity/reservations.json` (parent) shows worker reservations MATERIALIZED at this base
  (`baseSha 5ae2c7e5…`, owner `a48f8308…`) — the rows are live, not died (the #174 distinction).
- Deliverable sweep under `docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive5/`:

| Lane | Expected | On-disk state |
|---|---|---|
| `row-lc-fs` → `contract-filesystem.md` | landed | **FOUND** — `ws-2a24f9dc` (331 lines; attempt `d2371308-6fa9-4b7d-b88f-42c655337599 row-lc-fs`) |
| `row-lc-launch` → `contract-launch.md` | landed | **ABSENT** — no such file in any of the 14 worktrees |
| `row-lc-members` → `contract-members.md` | landed | **ABSENT** — no such file in any of the 14 worktrees |
| `row-lc-ledger` → `contract-ledger.md` | landed | **ABSENT** — no such file in any of the 14 worktrees |

**Signal ≠ disk.** The `signalOnMembersDone` message asserts all four rows settled; on-disk
verification finds exactly one contract. This is the finding the #174 law exists to surface — the
signal is not faithful to the filesystem, and the three absent rows cannot be cross-checked
because their deliverables do not exist. No verdict below is fabricated for an absent contract.

## 2. Prep citation audit (seed anchors vs HEAD `5ae2c7e5`)

The row briefs are seeds; the contracts inherit their anchors. Audited fresh now so wrong seed
anchors are known before the three absent contracts land:

| Seed anchor | Verified at HEAD | Result |
|---|---|---|
| `limits.mjs:56` — `run.objective` 4096-byte cap, graceful `spill-digest-citation` (#207) | `'run.objective': { … value: 4096 … graceful: 'spill-digest-citation' … }` at :56 (`wave.member.objective` :57, `spill.body` 1 MiB substrate :86) | ✓ accurate |
| `workflow-interpreter.mjs:39` — 64 KiB objectiveRef admission (#207) | `const OBJECTIVE_REF_MAX_BYTES = 64 * 1024` is now at **:42** (enforced at :343–344) | ✗ **drift +3** — any contract citing `:39` is a wrong-citation finding |
| `workflow-interpreter.mjs:525` — "the base-commit line" (#168) | :525 is no longer the base commit; the block is now at **:587–603** (async + skip-if-clean after `cda6355c`): status probe :597, `add -A` :599, commit :600, silent catch :602 | ✗ **drift** — the fs contract re-anchored correctly (see §4) |
| `application.mjs:11631-11646` — "waves.run is synchronous" (#173) | `application.mjs` (13,593 lines) contains **zero** `wave` occurrences — the waves.run surface MOVED to `application-client.mjs` / `application-semantics.mjs` / `workflow-lane.mjs` (`export { runWorkflow } from './workflow-interpreter.mjs'`). `runWorkflow` now detaches only on `options.detach === true` (`workflow-interpreter.mjs:718`), else `return settle()` | ✗ **dead anchor** — the launch contract must ground #173 at the new surface, and a "still synchronous" pin would be green-at-HEAD shallow |
| `wave.mjs` startError never reaches the receipt (#207) | `startError` captured at `wave.mjs:235/250/317/331/334`, projected :353, settle :472; **zero** `startError` occurrences in `workflow-interpreter.mjs` | ✓ accurate |
| `index.lock` — no handling (#172) | `grep -rn 'index.lock' impl/src/*.mjs` → zero matches | ✓ accurate |
| `decision.*` record kinds — never ledgered (#205) | `coordination-store.mjs` event stream mints `task.created`/`wave.started`/`wave.settled`/… but **no** `decision.*` record kind; the decision lane round-trips only at the adapter/session layer (`adapter.mjs:499/645`, `coordinator.mjs:10403`) | ✓ accurate |
| G2 four base-commit captures (#168) | `git show -s` re-run: `055c6cc`/`cd555ca`/`a176f39`/`04bd28f` all present, author `Baton`, message `baton workflow base <key>` | ✓ accurate |

## 3. Boundary map (the four share the wave lifecycle — seams from the briefs; overlaps/gaps)

Declared seams (package ③, the `waves.run` operator surface):

- **fs** — base-commit dirty-state capture (#168) · snapshot index.lock reaps (#172) · member
  raw-fs confinement + settle sweep (#185). Surface: `workflow-interpreter.mjs` base step, the
  snapshot machinery, `coordinator.mjs` path-scope gate, `adapter.mjs` spawn boundary.
- **launch** — detach/acceptance-receipt (#173) · response shapes (#202) · objectiveRef-admission
  alignment + startError on the wire + spill-digest graceful path (#207). Surface: the
  waves.run detach receipt, `limits.mjs`, `wave.mjs` startError.
- **members** — creation failures emit typed events, never phantom (#199) · task-id namespacing
  (#200) · drain-restart (#204). Surface: `coordination-store.mjs` creation/event tables, task-id
  derivation, the resident drain.
- **ledger** — model-visible-means-logged + durable no-step turn (#194) · decision ledgering
  (#205). Surface: `coordination-store.mjs` log/spill seam, the `decision.*` lane.

Known overlap seams (reconciled at fold — one owner each, others cite):

1. `spill-digest-citation` — launch (#207: receipt carries the spill) × ledger (#194: spilled
   artifact reconstructable). Same `limits.mjs` rows (`:54–57`, `:86`).
2. objectiveRef path — fs (#168/#185: path captured/confined) × members (#200: path derives the
   task id).
3. Response shape — launch (#202: closed JSON receipt) × ledger (#194: served context
   reconstructable from the store). Same wire bytes.

Gap noted at this sweep: **three of the four owners have no landed contract**, so the ledger
lane (#194/#205) and the members lane (#199/#200/#204) currently have no boundary voice. The
fs contract (§5) explicitly hands one seam off — see §4.

## 4. Per-contract verdicts

### contract-filesystem.md (row-lc-fs — #168 · #172 · #185) — VERDICT: SOUND

Read on disk at `ws-2a24f9dc/…/redrive5/contract-filesystem.md` (331 lines). Attempt-echo at
line 3 ✓ (`d2371308… row-lc-fs`). Harvest token `#168` present ✓. Ring-2 form complete: ten
ground truths (G1–G11, all cited) → six decisions (D1–D6) → closed refusal vocabulary (four new
codes) → six red-first pins (FS-P1–P6) → five open questions.

**Spot-check record (11 anchors read line-exact at HEAD `5ae2c7e5`):**

| Contract anchor | Verified | Result |
|---|---|---|
| base comment block `:587–594` / status probe `:597` / `add -A` `:599` / commit `:600` / silent catch `:602` | `sed -n 586,608p workflow-interpreter.mjs` | ✓ all line-exact |
| receipt seven keys `:707–715` (`basis,harvest,manifestDigest,outcomes,steering,verdict,waveId`), D6 `:706`, verdict `:701–703`, detach `:718`, `WAVE-ADMITTED` `:726` | `sed -n 701,727p` | ✓ line-exact |
| `pinBaseSha` dirty throw `DirtyRepoError` `:1053` (opts default `:1047`) | `sed -n 1047,1056p worktree.mjs` | ✓ (throw at :1053) |
| sole production caller no-options `index.mjs:567` | `sed -n 567p index.mjs` → `pinBaseSha(repoRoot, {})` | ✓ |
| codex `danger-full-access` `adapter.mjs:761`; claude `bypassPermissions` + "unverified" boundary `:773` | `sed -n '761p;773p' adapter.mjs` | ✓ |
| scope gate `coordinator.mjs:13501–13502` filter, out-of-scope `worker_path_scope_violation` `:13504–13506` | `sed -n 13501,13506p coordinator.mjs` | ✓ |
| sideband `GIT_INDEX_FILE` `application-deployment.mjs:216`, `commit-tree … -p head` `:233` | `sed -n '216p;233p'` | ✓ |
| G2 four captures `055c6cc`/`cd555ca`/`a176f39`/`04bd28f` | `git show -s` re-run (author + message) | ✓ all four |

**Acceptance-pin quality (shallow-greenability):** FS-P1 anti-shallow clauses (c) blocks
stash/reset escapes, (d) blocks refuse-dirty-tree escapes; FS-P3 carries a same-pin control (no
lock → success, no lock left) against always-refuse impls; FS-P4/FS-P5 jointly pin
presence-on-escape AND absence-on-clean. Pins name their stages and their RED-at-HEAD rationale
against the cited HEAD behavior. No clocks (mtimes observed, never asserted). Sound.

**Refusal vocabulary:** four new codes (`workflow_base_unavailable`, `worker_index_lock_stale`,
`member_fs_escape`, `worker_base_ref_invalid`), typed, payload-keyed, coached, declared COMPLETE
and surface-constant; existing surfaces frozen with anchors. Closed ✓.

**Boundary conduct:** exemplary — D6 explicitly cedes receipt-shape authority to the launch row
(#202) and escalates via DECISION_REQUEST with options + recommendation ((b) store-event +
verdict-downgrade, seven-key receipt preserved); §5.5 names the capacity-row lock-tombstone seam
for this QA pass; §6 records the #158 shared-publish refusal rather than fabricating a
shared-scope publish.

**Non-blocking nits (recorded for fold):** (1) judgment-call #2 mis-describes the redrive-5
wavefile as pinning `redrive4/**` — the wavefile I read (`ws-2a24f9dc/…/redrive5/lifecycle-contracts.wavefile`)
pins `redrive5/**` / `redrive5/contract-filesystem.md`; the "redrive-4 seat" self-label is
copy-forward staleness, harmless to the contract's substance but the internal path citations
should read `redrive5` at fold. (2) G5 provenance correctly flags the two #172 reaps as
campaign-record (not re-verifiable from a worktree) — proper epistemic honesty, not a defect.

### contract-launch.md (row-lc-launch — #173 · #202 · #207) — VERDICT: needs-fold

**Blocker: deliverable absent on disk** — no `redrive5/contract-launch.md` in any of the 14
sibling worktrees at this sweep. Cannot citation-audit, pin-check, or boundary-check text that
does not exist; a verdict on content would be fabrication. Pre-registered finding from the prep
audit the launch contract MUST address when it lands: the seed anchor `application.mjs:11631-11646`
is DEAD (the waves.run surface moved out of `application.mjs`), and `runWorkflow` now detaches
only on `options.detach === true` (`workflow-interpreter.mjs:718`) — a pin reading "waves.run is
still synchronous" is green at HEAD and would be shallow. Its red-first pins must name the
residual gaps (acceptance-receipt mint on failure paths, closed receipt keys, startError on the
wire, spill-digest graceful path) against the new surface.

### contract-members.md (row-lc-members — #199 · #200 · #204) — VERDICT: needs-fold

**Blocker: deliverable absent on disk** at this sweep (all 14 worktrees). Prep-audit anchors for
#199/#200 held in the `coordination-store.mjs` task-topology machinery were re-confirmed present
(`task.created` validation `:1498`, topology identity checks, task-id derivation `:10926–10956`
region) but no contract text to cross-check.

### contract-ledger.md (row-lc-ledger — #194 · #205) — VERDICT: needs-fold

**Blocker: deliverable absent on disk** at this sweep. Prep audit confirms the #205 anchor
(no `decision.*` record kind in the store event stream — the lane round-trips but never ledgers)
and the #194 spill seam (`spill.body` 1 MiB substrate `limits.mjs:86`, enforced at
`coordination-store.mintSpill`) — but there is no contract to verdict.

## 5. Fold instruction set

1. **launch/members/ledger rows: land the three absent deliverables** under
   `redrive5/contract-launch.md`, `contract-members.md`, `contract-ledger.md`. Each must carry:
   attempt-echo in the first five lines (#171); ground truths re-verified at HEAD `5ae2c7e5`
   (using the §2 drift table — do NOT copy the stale `application.mjs:11631` / `:39` / `:525`
   anchors); D-numbered decisions; a closed, typed, surface-constant refusal vocabulary;
   red-first pins each RED at HEAD at a named stage.
2. **Re-run this QA pass** against the three landed contracts: citation spot-check (≥3 anchors
   each), shallow-greenability of every pin, refusal-vocabulary closure, and the §3 boundary
   reconciliation (overlap seams 1–3, plus the fs D4 `member_fs_escape` store event → ledger-lane
   acknowledgment).
3. **Carry the fs-contract nit** (redrive-4 self-label path drift) into the fold record.
4. **Answer the fs D6 DECISION_REQUEST** (receipt-shape home for escape detail) — options (a)
   eighth receipt key, (b) store event + verdict only, (c) both; fs recommends (b).

## 6. DECISION_REQUEST (escalated — authority-class)

**Q:** `signalOnMembersDone` asserts all four rows settled; on-disk verification finds 1 of 4.
Does this QA seat fold on the verified subset, or hold for the remainder?

- **(a) Fold on the verified subset (recommended).** Verdict the one landed contract SOUND,
  mark the three absent contracts needs-fold with "absent on disk" as the named blocker, and hand
  a concrete fold instruction set up. Honors no-fabrication and #174; the signal/disk divergence
  is recorded as the finding, not papered over.
- **(b) Hold (do not finalize).** Requires a re-drive/watcher until the three land; this seat is
  a single invocation with no advertised watcher surface, so holding is a stall (claim-on-stall
  territory).
- **(c) Treat the signal as authoritative and verdict all four.** REJECTED — verdicting absent
  text violates the no-fabrication law.

Recommendation: **(a)**. Proceeding on (a) unless overridden.

## 7. Publish to `shared` — recorded

Instructed to publish to `shared`. No publish surface is advertised to this seat and the
deployment constraint restricts writes to `redrive5/**`; the prior rounds pinned the reason a
member/coordinator publish cannot reach a true shared scope (`writeScratchpad` hardcodes the
worker partition, no typed refusal — the #158 write-scope hardcode). This QA is therefore
published ON DISK (`redrive5/contract-qa.md`, the wavefile harvest target for this member) and
the shared-scope refusal is recorded here for the fold to carry. Fabricating a shared-scope
publish was not an option.
