# CONTRACT-FILESYSTEM v1 — the filesystem lifecycle (#168 · #172 · #185)

[attempt: d2371308-6fa9-4b7d-b88f-42c655337599 row-lc-fs]
Package ③ (wave lifecycle), the FILESYSTEM row. Gates its suite + impl.

Provenance and discipline: this is the redrive-4 seat of row-lc-fs (redrive-3's contract, attempt
`9a07d8eb…`, exists one directory up and is superseded by this one). Every citation below was
re-read THIS session against HEAD `5ae2c7e5` with `sed -n`/`grep -an` on
`impl/src/workflow-interpreter.mjs`, `impl/src/worktree.mjs`, `impl/src/coordinator.mjs`,
`impl/src/adapter.mjs`, `impl/src/application-deployment.mjs`, `impl/src/index.mjs`
(`application.mjs`/`coordination-store.mjs` are NUL-bearing — not load-bearing here, not opened).
Git history read via `git show --stat` in this worktree. No clocks in any pin; key literals in
ACTUAL source order.

**Recorded judgment calls (three):**
1. **Anchor drift at HEAD.** The row brief pins "the base-commit line at
   workflow-interpreter.mjs:525". At HEAD :525 is a QUIESCENCE constant. The base block moved to
   **workflow-interpreter.mjs:587–603** after commit `cda6355c` ("async base-commit +
   skip-if-clean", 2026-08-14) — the block is now async and skips add+commit when the tree is
   clean. This contract cites the fresh anchors and treats the HEAD behavior, not the brief's
   snapshot, as ground truth. The #168 MECHANISM (on-branch capture of the operator's dirty tree)
   survives the fix unchanged; only its trigger condition narrowed.
2. **Deliverable path.** The row brief's deliverable line says `redrive3/contract-filesystem.md`
   (stale boilerplate copied forward); the wavefile pins this member's scope and report to
   `redrive4/**` / `redrive4/contract-filesystem.md`, and the deployment constraint says work
   only within `redrive4/**`. The wavefile governs; the deliverable is THIS file.
3. **D6 receipt-shape authority** — escalated as DECISION_REQUEST (see §2/§5).

---

## 1. Ground truths (cited)

**G1 — the base commit is an unconditional on-branch commit in the operator's repo whenever the
tree is dirty.** `runWorkflow` probes `git status --porcelain` at `repoRoot`
(`impl/src/workflow-interpreter.mjs:597`); if ANY line comes back it runs `git add -A` (:599)
then `git commit -q -m "baton workflow base <idempotencyKey>"` with author override
`Baton <baton@local>` (:600) — directly on whatever branch the operator has checked out, before
`waves.start`. The `catch { /* nothing to commit, or commits unavailable — the wave will surface
any real base issue */ }` at :602 swallows EVERY failure silently — including git being broken or
absent — so a wave can launch from an unpinned base with no record of the failure. The comment
block :587–594 states the design intent in its own words: "commit the current working-tree state
so the base is clean."

**G2 — four captures landed on master on 2026-08-13 (the #168 evidence).** Verified this session
via `git show --stat --format`: `055c6cc` 01:31 (575 lines: uncommitted edits to
`impl/src/coordinator.mjs`, `wave-driver.mjs`, `messages.mjs`, `adapter.mjs` and more plus two
notes files), `cd555ca` 05:05 (1,627 lines: nine contract/fold files plus an edit to
`impl/test/error-actionability-red.test.mjs`), `a176f39` 09:15 (173 lines:
`suite-notes-163.md` + `workflow.json`), `04bd28f` 11:53 (251 lines: `blueteam-161.md`). All
four: author `Baton`, message `baton workflow base <key>`. None of this content was reviewed or
authored by the operator; all of it is now indelible master history.

**G3 — the base commit exists to satisfy `pinBaseSha`'s clean-tree demand.** The comment at
`workflow-interpreter.mjs:587–589` says so ("the worktree manager refuses a dirty working tree
(pinBaseSha's DirtyRepoError) … commit the current working-tree state so the base is clean").
`pinBaseSha` throws `DirtyRepoError` on a dirty tree unless `{autoStash:true}` —
`impl/src/worktree.mjs:1047–1055` (throw at :1053, class at :30–32) — and the only production
caller passes no options: `impl/src/index.mjs:567` (`await worktreeMod.pinBaseSha(repoRoot, {})`).
The operator's tree is held hostage: clean it or lose the wave.

**G4 — the non-invasive snapshot discipline already exists in the codebase.** The deployment
snapshot builds an effective-tree commit WITHOUT touching the shared index and WITHOUT moving any
branch: `git status --porcelain=v1 --untracked-files=all` probe
(`impl/src/application-deployment.mjs:201`), sideband `GIT_INDEX_FILE` under the state root
(`snapshot-index-<pid>-<rand>` path join at :207–216), then `read-tree HEAD` (:225) → `add -A` →
`write-tree` (:230) → `commit-tree <tree> -p HEAD` (:233) — the whole discipline spans
:199–236. The workflow base step (G1) does not use it. (The #169 kernel audit row at
`docs/reference/evidence/kernel-honesty-2026-08-13/kernel-honesty-audit.md:47` cites this
contrast as the sanctioned mitigation for the lock class; row :48 of the same table is the
provenance for D2's ref pinning.)

**G5 — baton locks the operator's shared index and abandons it on death (#172).** The base
step's `git add -A` runs against the operator's real `.git/index`
(`workflow-interpreter.mjs:599`); `captureCommit`'s snapshot likewise runs bare `git add -A` /
`git commit` against the member worktree's real index (`impl/src/worktree.mjs:1209` and :1225).
A kill/crash mid-add abandons `index.lock` with no typed refusal — `sh()` surfaces raw
`execFileSync` stderr (`worktree.mjs:67–72`). The #169 kernel audit pinned this class
("the stale `index.lock` class is untyped and uncoached in the worktree capture path",
`kernel-honesty-audit.md:47`, fix: a typed refusal naming path/holder/next). Campaign record
(row brief; `docs/PROGRESS.md:36` files #172 as "index.lock abandonment"): two manual reaps of a
holderless, fixed-mtime `.git/index.lock` in the operator's repo on 2026-08-13. Provenance note:
the reaps happened in the live operator repo and are cited from the campaign record, not
re-verifiable from this worktree; the MECHANISM is grounded in code above.

**G6 — baton intentionally dirties the operator's tree, then the next wave commits the dirt.**
`harvestOne` materializes recovered bytes INTO the operator's working tree via
`materializeToDisk(repoRoot, path, bytes)` (`workflow-interpreter.mjs:775` and :778`, writer at
:784). So after every wave the operator tree is dirty by baton's own design, and the NEXT wave's
base commit (G1) sweeps that dirt — plus any escaped member writes — onto master. This is the
loop that made G2 inevitable. (The skip-if-clean probe at :597 makes a wave following a
harvest-dirtied tree DIRTY by definition — harvest guarantees the next base commit fires.)

**G7 — the write-scope machinery sees only the worktree's captured diff.** Scope enforcement
filters `captureCommit`'s `changedPaths` (paths INSIDE the member worktree) through `pathInScope`
— `impl/src/coordinator.mjs:13501–13502`, out-of-scope throw `worker_path_scope_violation` with
`pathScopeEvidence` at :13504–13515, `pathInScope` at :618–620, `globRegex` at :600. A raw-fs
write that bypasses the worktree (absolute path into the main checkout) never appears in that
diff: the worktree captures clean, the gate passes, the write is invisible. The row brief's
phrasing is exact: the machinery covers baton-surface ops, not raw fs.

**G8 — the #185 escapes are captured-in-history facts.** `blueteam-161.md` (251 lines) and
`suite-notes-163.md` (148 lines) each exist in this repository's master history ONLY inside Baton
base commits — `04bd28f` and `a176f39` respectively (G2, re-verified via `git show --stat` this
session). Those are member deliverables that belonged in member worktrees (to be recovered via
result pins and harvested per `workflow-interpreter.mjs:741–780`); instead they were written raw
into the main checkout and then committed by the next wave's base commit — the #185 escape and
the #168 capture are one mechanism, two issues.

**G9 — member spawn is uncontained by construction, and the cards say so.** The codex adapter
runs `--sandbox danger-full-access` (`impl/src/adapter.mjs:761`) with the card boundary
"containment is a separate deployment boundary" (:751); the claude adapter runs
`bypassPermissions` with boundary "host filesystem and network containment are unverified"
(:773). Confinement therefore CANNOT be assumed at spawn; if it is to be claimed at all it must
be VERIFIED at settle. (The GLM adapter inherits the claude card — `GlmAdapter extends
ClaudeAdapter`, `adapter.mjs:787`.) Note this seat's own deployment constraint ("work only
within: …redrive4/**") is enforced by the BRIEF, not by the spawn boundary — the same gap #185
exploited.

**G10 — confinement machinery that DOES work is authority-path confinement of baton's own
surfaces.** `authorityRoot`/`authorityChild` reject symlinked, escaping, or non-owned paths
(`impl/src/worktree.mjs:98–129`), and `validateOwnedWorktree` re-verifies worktree
path/branch/base/ancestor identity (:995–1010; the `merge-base --is-ancestor` JSON-only anchor at
:1006). The gap is exactly the member's raw fs writes outside any baton surface — nothing
watches the main checkout during a wave.

**G11 — there is no settle sweep and no home for filesystem truth in the receipt.** The settle
path (`workflow-interpreter.mjs:632–715`) reads member views, materializes result shas
(`materializeSha`, :651), closes the wave (:667), computes outcomes (:671–693), harvests (:694),
and returns a receipt with EXACTLY the seven sorted keys `basis, harvest, manifestDigest,
outcomes, steering, verdict, waveId` (:707–715, the D6 comment at :706; verdict at :701–703,
detach acceptance shape `WAVE-ADMITTED` at :718–727). At no point does it inspect the operator's
working tree for wave-window modifications; the receipt cannot express them.

---

## 2. Decisions (D-numbered; judgment calls recorded)

**D1 — the base never lands on the operator's branch (#168).** The on-branch `git add -A` +
`git commit` at `workflow-interpreter.mjs:599–600` is REPLACED by the deployment-snapshot
discipline (G4): sideband `GIT_INDEX_FILE` under `.baton` state, `read-tree HEAD` → `add -A` →
`write-tree` → `commit-tree -p HEAD`, and member worktrees provision from that snapshot sha. The
checked-out branch never moves; the operator's dirty state REMAINS dirty and uncommitted in their
tree (their edit surface is inviolable). The skip-if-clean probe (:597) may stay as a fast path
(clean tree → snapshot IS `HEAD`, source `'head'` — the deployment snapshot already models this,
`application-deployment.mjs:206–207`). If the snapshot cannot be built, refuse typed
(`workflow_base_unavailable`, §3) — never the silent catch at :602, never a fallback to the
on-branch commit.

**D2 — the base is pinned as a sideband git ref, not only JSON (#168; adopts the #169 audit's
concrete fix, `kernel-honesty-audit.md:48`).** `createFromBase` (`worktree.mjs:1074–1190`) writes
`refs/baton/base/<taskId>` at `baseSha`; `captureCommit`/`validateOwnedWorktree` verify the ref
against `meta.baseSha` instead of trusting the owner JSON alone (today the anchor is only
`meta.baseSha` + `merge-base --is-ancestor`, `worktree.mjs:1005–1006`). A reaped/corrupted owner
file can no longer silently destroy the `changedPathsFromBase`/sparse anchor.

**D3 — own-index discipline (#172).** Every baton-driven git WRITE against a repo it does not
own for the duration (the operator root during the base step) uses a private index file — the
G4 discipline generalized; baton never holds the operator's shared `.git/index` lock. Where any
baton git write meets a PRE-EXISTING `index.lock` (the operator's root or a worktree), it fails
as the typed refusal `worker_index_lock_stale` (§3) naming path, holder, and mtime — never raw
`execFileSync` stderr (G5). Baton does not auto-reap a lock it does not own in the operator's
repo; the refusal coaches, the operator decides.

**D4 — the settle sweep (#185).** At admission `runWorkflow` records the operator tree's
`git status --porcelain` state (the probe at :597 already runs — its output becomes the
admission digest instead of a capture trigger); at settle (after `wave.close` :661, before the
receipt :707) it re-runs the status and diffs. Any path newly modified/created during the wave
window that is NOT (a) inside a member worktree root (`.baton/wt/`, `.baton/verify/`,
`.baton/integrate/`) or (b) a harvest-materialized path (D5) is an ESCAPE: recorded as a typed
`member_fs_escape` store event naming the paths and the wave, and the verdict degrades from
`WAVE-OK`. Because spawn-time confinement is unverified (G9), settle-time verification is
MANDATORY, not advisory. Escaped bytes are never auto-reverted (the operator's tree is the
operator's; the sweep records and refuses, it does not delete).

**D5 — harvest materialization stays the ONLY sanctioned interpreter write to the operator tree,
and it is exempt from the sweep by construction.** `harvestOne`'s `materializeToDisk` writes
(`workflow-interpreter.mjs:775/:778`) remain, but every materialized path is recorded in the
sweep's exemption set, so the sanctioned surface and the escape detector can never disagree. Any
other main-checkout write by interpreter or member is out of contract — an escape.

**D6 — receipt shape is NOT this row's to change (recorded DECISION_REQUEST).** The sweep's
verdict degradation needs no new receipt key (`verdict` already exists, :713), but the escape
DETAIL needs a home. Options: **(a)** an eighth receipt key `filesystem` — breaks "EXACTLY the
seven contract keys" (:706–715), a shape owned by the launch row (#202); **(b)** a typed store
event `member_fs_escape` + verdict downgrade only, receipt stays seven-keyed; **(c)** both.
Recommendation: **(b)** — smallest blast radius, the store is the durable truth lane, and the
launch row keeps receipt-shape authority. Escalated per the foundry law; impl proceeds on (b)
unless overridden.

---

## 3. Refusal vocabulary (closed, typed, surface-constant)

New codes — this is the COMPLETE set added by this contract; once shipped they never rename
(surface-constant), and payloads are sorted-key literals:

| Code | Site | Payload | Next-action coached |
|---|---|---|---|
| `workflow_base_unavailable` | `runWorkflow` base step, replacing the silent catch at `workflow-interpreter.mjs:602` | `{cause, idempotencyKey}` | name the git failure; the wave does not launch from an unpinned base |
| `worker_index_lock_stale` | any baton git write meeting a pre-existing `index.lock` (base step; `captureCommit` `worktree.mjs:1209/:1225`) | `{holder: <pid>\|'stale', lockMtime, next, path}` | "remove after owner death or wait" (the #169 audit's coaching, `kernel-honesty-audit.md:47`, extended with `lockMtime`) |
| `member_fs_escape` | settle sweep (D4), as a store event + verdict downgrade | `{exemptPaths, paths, waveId, worktreeRoots}` | name the escaped paths; verdict is not `WAVE-OK` until reconciled |
| `worker_base_ref_invalid` | `captureCommit`/`validateOwnedWorktree` when `refs/baton/base/<taskId>` is absent or ≠ `meta.baseSha` (D2) | `{baseRef, expectedSha, taskId}` | the JSON anchor is untrusted; re-pin or reap the worktree |

Existing surfaces this contract FREEZES unchanged (boundary agreement, not redefinition):
`DirtyRepoError` + its `pinBaseSha` message (`worktree.mjs:30–32, :1053`),
`worker_path_scope_violation` + `pathScopeEvidence` (`coordinator.mjs:13504–13515`),
`harvest_ok`/`harvest_miss` (`workflow-interpreter.mjs:760, :776, :779`), and the seven receipt
keys (`workflow-interpreter.mjs:707–715`).

---

## 4. Red-first acceptance pins

Each pin names its stage, is RED at HEAD (verified against the cited HEAD behavior), and is
written so a wrong or shallow impl cannot go green. Fixture discipline: real git repos, no
clocks (mtimes are observed evidence, never assertion inputs), no mocking of git.

**FS-P1 — the base never commits the operator's tree.** Stage: base
(`workflow-interpreter.mjs:593–603`). Fixture: repo with one dirty tracked file + one untracked
file on the checked-out branch. Drive `runWorkflow`'s base step. Assert: (a) `git rev-parse HEAD`
of the branch is unchanged; (b) no commit whose message starts `baton workflow base` exists;
(c) `git status --porcelain` still lists both dirty paths; (d) the base step SUCCEEDS and yields
a snapshot sha whose tree carries the dirty file's content (verifiable via `git show
<sha>:<path>`). RED at HEAD — :599–600 commit them (the skip-if-clean probe at :597 does not
fire: the tree is dirty by fixture), so (a)–(c) fail outright (G1/G2). Anti-shallow: (c) blocks
an impl that "avoids the commit" by stashing or resetting the operator's files away — the dirt
must SURVIVE untouched; (d) blocks the lazier escape of merely refusing dirty trees (deleting
the base step without building the sideband snapshot would fail every dirty-tree wave — exactly
what #168 made painful).

**FS-P2 — a broken base refuses typed, never silently.** Stage: base. Fixture: `repoRoot`
pointing at a directory where git cannot produce a status/snapshot (e.g. no HEAD). Assert:
`runWorkflow` throws `workflow_base_unavailable` naming the idempotencyKey. RED at HEAD — the
catch at :602 swallows the probe's failure and the wave proceeds from an unpinned base (G1).
(The `cda6355c` skip-if-clean rework made this WORSE, not better: a broken git now fails inside
the status probe, still silently.)

**FS-P3 — the stale lock is a typed, coached refusal.** Stage: snapshot
(`worktree.mjs:1191–1241`) and base step. Fixture: plant a holderless `index.lock` with a fixed
mtime in the target git dir before the operation. Assert: the operation fails with
`worker_index_lock_stale` carrying `{holder: 'stale', lockMtime, next, path}` — and specifically
NOT an untyped Error whose message is raw git stderr. RED at HEAD — `sh()` bubbles raw stderr,
no typed class exists (G5). Control side (same pin): with no lock present, the operation
succeeds and leaves no `index.lock` behind — an impl that "passes" by always refusing is blocked.

**FS-P4 — an escape degrades the verdict and is recorded.** Stage: settle
(`workflow-interpreter.mjs:632–715`). Fixture: a driver-injected member effect that writes one
file into the main checkout outside any `.baton/` root and outside the harvest set, during the
wave window. Assert: (a) a `member_fs_escape` record exists naming that path; (b) the receipt's
`verdict` ≠ `WAVE-OK`. RED at HEAD — settle never inspects the operator tree and the verdict is
computed only from driveExit + member terminality + harvest (:701–703, G7/G11), so both
assertions fail. Anti-shallow: FS-P5.

**FS-P5 — a clean wave still earns WAVE-OK (the anti-shallow-green control for FS-P4).**
Stage: settle. Fixture: identical wave with NO escape, harvest green. Assert: verdict IS
`WAVE-OK` and the escape record set is EMPTY. RED at HEAD — no escape record exists at all, so
"empty and present" fails. Blocks an impl that downgrades every verdict to satisfy FS-P4.

**FS-P6 — the base ref is pinned and authoritative.** Stage: snapshot (`worktree.mjs:1074–1190`,
`:1191–1241`). Assert: (a) after `createFromBase`, `refs/baton/base/<taskId>` exists and equals
`meta.baseSha`; (b) after corrupting the owner JSON's `baseSha`, `captureCommit` fails
`worker_base_ref_invalid` rather than computing `changedPathsFromBase` against the forged base.
RED at HEAD — no such ref is written and the JSON field is trusted unconditionally
(`worktree.mjs:1005–1006`, G10/D2).

---

## 5. Open questions

1. **Sweep attribution (D4):** the admission→settle diff cannot distinguish a member escape from
   the operator's own concurrent edit during the wave window. Proposed stance: record both
   classes under `member_fs_escape` with the paths named, and let a human reconcile — silence is
   the only alternative and #185 is what silence costs. Confirm or refine at fold.
2. **DECISION_REQUEST (D6, escalated):** escape-detail home — (a) eighth receipt key, (b) store
   event + verdict only, (c) both. Recommendation (b); launch row (#202) owns receipt shape.
3. **Holder detection limits (#172):** a holderless fixed-mtime `index.lock` is detected by age +
   absence of a matching live git process — both heuristics. Is a heuristic holder verdict
   acceptable in the payload (`holder: 'stale'`), or must baton refuse to classify and always
   name the check it ran? Lean: always name the check (the payload's `next` already coaches
   either way).
4. **Untracked files in the sideband base (D1):** the deployment snapshot folds untracked files
   in (`--untracked-files=all`, `application-deployment.mjs:201`); the workflow base must too
   (member objective/spec inputs are written untracked pre-wave — and the HEAD probe at :597
   counts them dirty by default). Confirm the snapshot's credential-exclusion list
   (`SNAPSHOT_CREDENTIAL_PATHS`, :204) does NOT silently apply to the workflow base — different
   purpose, probably different exclusions; decide at fold.
5. **Reap of baton-abandoned locks (D3):** this contract forbids auto-reaping in the OPERATOR's
   repo. For locks abandoned by baton inside `.baton/` authority roots (baton-owned ground),
   auto-reap may be legitimate — does that split (owned vs borrowed ground) match the
   capacity-row's lock-tombstone vocabulary (`worktree-capacity` reap discipline)? Cross-row
   boundary check for the QA pass.

---

## 6. Publish to `shared` — the refusal, recorded (#158 law)

Instructed to publish to `shared` on completion. No publish surface is advertised in this
Brief — the deployment constraint restricts this seat to tools named in the Brief and to writes
under `redrive4/**` only — and the redrive-3 launch row already pinned WHY a member-row publish
to `shared` cannot happen even where the lane exists: `writeScratchpad` hardcodes the worker
scope (`coordination-store.mjs:14169`, cited from `redrive3/contract-launch.md` GT-L11, not
re-opened this session — NUL-bearing file), so a member publish is silently admitted into the
worker partition, not refused. This contract is therefore published ON DISK (here) and the
refusal is recorded for the fold to carry; fabricating a shared-scope publish was not an option.

---

## Appendix — anchor verification record

Every citation re-grepped this session (`grep -an`/`sed -n`, exact-line confirmation) against
HEAD `5ae2c7e5`. Confirmed exact: `workflow-interpreter.mjs` — base comment block :587–594,
`if (repoRoot)` :595, status probe :597, `add -A` :599, base commit :600, silent catch :602,
`pinFloorMs` :607, `waves.start` :608, settle fn :632, `wave.close` :661, harvest map :694,
verdict :701–703, D6 comment :706, receipt return :707–715 (`waveId` :714), detach :718,
`WAVE-ADMITTED` :726, `harvestOne` :741, pathEscapes check :747, `harvest_miss` :760/:770/:773,
materialize :775/:778, `harvest_ok` :776/:779, `materializeToDisk` :784, `pathEscapes` :793.
`worktree.mjs` — `DirtyRepoError` :30, `sh` :67, `authorityRoot` :98 (with `authorityChild`,
block :98–129), `validateOwnedWorktree` :995, `merge-base` anchor :1006, `pinBaseSha` :1047,
dirty throw :1053, `createFromBase` :1074, `captureCommit` :1191, bare add :1209, bare commit
:1225. `coordinator.mjs` — `globRegex` :600, `pathInScope` :618, filter pair :13501–13502,
out-of-scope gate :13504–13515 (mint :13506). `adapter.mjs` — codex card :751, danger-full-access
argv :761, claude card :773, `GlmAdapter` :787. `application-deployment.mjs` —
`repositorySnapshot` :199, untracked flag :201, credential paths :204, `GIT_INDEX_FILE` :216,
`read-tree` :225, `write-tree` :230, `commit-tree` :233. `index.mjs` — no-autoStash call :567.
`kernel-honesty-audit.md` — stale-lock row :47, base-ref row :48. `PROGRESS.md` — #172 filing
:36. Git: four captures re-verified via `git show --stat` (`055c6cc`/`cd555ca`/`a176f39`/
`04bd28f`, authors + messages + line counts as cited in G2). Corrections made while finalizing
(recorded for the audit trail): base block re-anchored :537→:587–603 after `cda6355c` (the
redrive-3 anchors were STALE at this HEAD — the mechanism survived, the lines did not); settle
:577→:632; harvest/materialize shifted +50–74 lines throughout `harvestOne`. No outstanding
drift.
