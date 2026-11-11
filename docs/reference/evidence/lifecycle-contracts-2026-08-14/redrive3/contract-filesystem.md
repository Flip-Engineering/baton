# CONTRACT-FILESYSTEM v1 — the filesystem lifecycle (#168 · #172 · #185)

[attempt: 9a07d8eb-e52d-475f-ac64-65ffbb707813 row-lc-fs]
Package ③ (wave lifecycle), the FILESYSTEM row. Gates its suite + impl.

Provenance and discipline: every citation below was re-read this session with `sed -n`/`grep -an`
against `impl/src/workflow-interpreter.mjs`, `impl/src/worktree.mjs`, `impl/src/coordinator.mjs`,
`impl/src/adapter.mjs`, `impl/src/application-deployment.mjs`, `impl/src/index.mjs` (none of the
NUL-bearing files — `application.mjs`, `coordination-store.mjs` — is load-bearing here). Git
history was read via `git show --stat` in this worktree. No clocks in any pin; sorted-key
literals in ACTUAL source order.

Recorded judgment call (anchor drift): the row brief pins "the base-commit line at
workflow-interpreter.mjs:525". At HEAD, :525 is `objective: renderObjective(...)`; the base
commit lives at **workflow-interpreter.mjs:537–542**. This contract cites the fresh anchor.

---

## 1. Ground truths (cited)

**G1 — the base commit is an unconditional on-branch commit in the operator's repo.**
`runWorkflow` runs `git add -A` then `git commit -m "baton workflow base <idempotencyKey>"` with
author `Baton` directly in `repoRoot` before `waves.start` — `impl/src/workflow-interpreter.mjs:537–542`,
the add at :539 and the commit at :540. Whatever branch the operator has checked out (master in
the campaign) advances. The `catch { /* nothing to commit, or commits unavailable — the wave will
surface any real base issue */ }` at :541 swallows every failure silently — including git being
broken — so a wave can launch from an unpinned base with no record of the failure.

**G2 — four captures landed on master on 2026-08-13 (the #168 evidence).** Verified this session
via `git show --stat`: `055c6cc` 01:31 (575 lines: uncommitted `impl/src/coordinator.mjs`,
`wave-driver.mjs`, `messages.mjs` changes plus two notes files), `cd555ca` 05:05 (1,627 lines:
nine contract/fold files plus an edit to `impl/test/error-actionability-red.test.mjs`),
`a176f39` 09:15 (173 lines: `suite-notes-163.md` + `workflow.json`), `04bd28f` 11:53 (251 lines:
`blueteam-161.md`). All four: author `Baton`, message `baton workflow base <key>`. None of this
content was reviewed or authored by the operator; all of it is now indelible master history.

**G3 — the base commit exists to satisfy `pinBaseSha`'s clean-tree demand.** The comment at
`workflow-interpreter.mjs:533–536` says so outright ("the worktree manager refuses a dirty working
tree (pinBaseSha's DirtyRepoError) … commit the current working-tree state so the base is clean").
`pinBaseSha` throws `DirtyRepoError` on a dirty tree unless `{autoStash:true}` —
`impl/src/worktree.mjs:1047–1058` (throw at :1053, `DirtyRepoError` class at :30–32) — and the only
production caller passes no options: `impl/src/index.mjs:567`
(`await worktreeMod.pinBaseSha(repoRoot, {})`). The operator's tree is held hostage: clean it or
lose the wave.

**G4 — the non-invasive snapshot discipline already exists in the codebase.** The deployment
snapshot builds an effective-tree commit WITHOUT touching the shared index and WITHOUT moving any
branch: sideband `GIT_INDEX_FILE` under the state root (`snapshot-index-<pid>-<rand>`, `:216`),
then `read-tree` → `add -A` → `write-tree` → `commit-tree -p HEAD` (`:233`) —
`impl/src/application-deployment.mjs:199–236`. The workflow base commit (G1) does not use it.

**G5 — baton locks the operator's shared index and abandons it on death (#172).** The base
commit's `git add -A` runs against the operator's real `.git/index`
(`workflow-interpreter.mjs:539`); `captureCommit`'s snapshot likewise runs bare `git add -A` /
`git commit` against the worktree's real index (`impl/src/worktree.mjs:1209` and `:1225`). A
kill/crash mid-add abandons `index.lock` with no typed refusal — `sh()` surfaces raw
`execFileSync` stderr (`worktree.mjs:67–72`). The #169 kernel audit already pinned this class
("the stale `index.lock` class is untyped and uncoached in the worktree capture path", evidence
row citing `worktree.mjs:1205–1227`, fix: a typed refusal naming path/holder/next —
`docs/reference/evidence/kernel-honesty-2026-08-13/kernel-honesty-audit.md:47`). Campaign record
(row brief; PROGRESS.md:36 files #172 as "index.lock abandonment"): two manual reaps of a
holderless, fixed-mtime `.git/index.lock` in the operator's repo on 2026-08-13. Provenance note:
the reaps themselves happened in the live operator repo and are cited from the campaign record,
not re-verifiable from this worktree; the *mechanism* is grounded in code above.

**G6 — baton intentionally dirties the operator's tree, then the next wave commits the dirt.**
`harvestOne` materializes recovered bytes INTO the operator's working tree
(`workflow-interpreter.mjs:701` and `:704`, writer at `:710–717`). So after every wave the
operator tree is dirty by baton's own design, and the NEXT wave's base commit (G1) sweeps that
dirt — plus any escaped member writes — onto master. This is the loop that made G2 inevitable.

**G7 — the write-scope machinery sees only the worktree's captured diff.** Scope enforcement
filters `captureCommit`'s `changedPaths` (paths INSIDE the member worktree) through `pathInScope`
— `impl/src/coordinator.mjs:13501–13513` (the out-of-scope throw at `:13503–13513`),
`pathInScope`/`globRegex` at `:618–620`/`:600–614`. A raw-fs write that bypasses the worktree
(absolute path into the main checkout) never appears in that diff: the worktree captures clean,
the gate passes, the write is invisible. The row brief's phrasing is exact: the machinery covers
baton-surface ops, not raw fs.

**G8 — the #185 escapes are captured-in-history facts.** `blueteam-161.md` (251 lines) and
`suite-notes-163.md` (148 lines) each exist in this repository's master history ONLY inside Baton
base commits — `04bd28f` and `a176f39` respectively (G2). Those are member deliverables that
belonged in member worktrees (to be recovered via result pins and harvested per
`workflow-interpreter.mjs:667–706`); instead they were written raw into the main checkout and
then committed by the next wave's base commit — the #185 escape + #168 capture, one mechanism,
two issues.

**G9 — member spawn is uncontained by construction, and the cards say so.** The codex adapter
runs `--sandbox danger-full-access` (`impl/src/adapter.mjs:761`) with the card boundary
"containment is a separate deployment boundary" (`:751`); the claude adapter runs
`bypassPermissions` with boundary "host filesystem and network containment are unverified"
(`:773`). Confinement therefore CANNOT be assumed at spawn; if it is to be claimed at all it must
be VERIFIED at settle. (The GLM adapter inherits the claude card — `adapter.mjs:787–790`.)

**G10 — confinement machinery that DOES work is authority-path confinement of baton's own
surfaces.** `authorityRoot`/`authorityChild` reject symlinked, escaping, or non-owned paths with
`WorktreeCleanupError` (`impl/src/worktree.mjs:96–129`), and `validateOwnedWorktree` re-verifies
worktree path/branch/base/ancestor identity (`:1000–1010`). The gap is exactly the member's raw
fs writes outside any baton surface — nothing watches the main checkout during a wave.

**G11 — there is no settle sweep and no home for filesystem truth in the receipt.** The settle
path (`workflow-interpreter.mjs:577–641`) reads member views, materializes result shas, closes
the wave, harvests, and returns a receipt with EXACTLY seven sorted keys (`basis, harvest,
manifestDigest, outcomes, steering, verdict, waveId`, `:633–641`). At no point does it inspect
the operator's working tree for wave-window modifications; the receipt cannot express them.

---

## 2. Decisions

**D1 — the base never lands on the operator's branch (#168).** The on-branch `git add -A` +
`git commit` at `workflow-interpreter.mjs:539–540` is REPLACED by the deployment-snapshot
discipline (G4): sideband `GIT_INDEX_FILE` under `.baton` state, `read-tree HEAD` → `add -A` →
`write-tree` → `commit-tree -p HEAD`, and member worktrees provision from that snapshot sha. The
checked-out branch never moves; the operator's dirty state REMAINS dirty and uncommitted in their
tree (their edit surface is inviolable). If the snapshot cannot be built, refuse typed
(`workflow_base_unavailable`, §3) — never the silent catch at :541, never a fallback to on-branch
commit.

**D2 — the base is pinned as a sideband git ref, not only JSON (#168, adopts the #169 audit's
concrete fix).** `createFromBase` writes `refs/baton/base/<taskId>` at `baseSha`
(`worktree.mjs:1074–1179` gains the ref write); `captureCommit`/`validateOwnedWorktree` verify
the ref against `meta.baseSha` instead of trusting the owner JSON alone (today the anchor is
only `meta.baseSha` + `merge-base --is-ancestor`, `worktree.mjs:1005–1006`). A reaped/corrupted
owner file can no longer silently destroy the `changedPathsFromBase`/sparse anchor.

**D3 — own-index discipline (#172).** Every baton-driven git WRITE against a repo it does not
own for the duration (the operator root during the base step) uses a private index file; baton
never holds the operator's shared `.git/index` lock. Where any baton git write meets a
pre-existing `index.lock` (the operator's root or a worktree), it fails as the typed refusal
`worker_index_lock_stale` (§3) naming path, holder, and mtime — never raw execFileSync stderr
(G5). Baton does not auto-reap a lock it does not own in the operator's repo; the refusal
coaches, the operator decides.

**D4 — the settle sweep (#185).** At admission `runWorkflow` records a digest of the operator
tree's `git status --porcelain` state; at settle (after `wave.close`, before the receipt) it
re-runs the status and diffs. Any path newly modified/created during the wave window that is NOT
(a) inside a member worktree root (`.baton/wt/`, `.baton/verify/`, `.baton/integrate/`) or
(b) a harvest-materialized path (D5) is an ESCAPE: recorded as a typed `member_fs_escape` store
event naming the paths and the wave, and the verdict degrades from `WAVE-OK`. Because spawn-time
confinement is unverified (G9), settle-time verification is MANDATORY, not advisory. Escaped
bytes are never auto-reverted (the operator's tree is the operator's; the sweep records and
refuses, it does not delete).

**D5 — harvest materialization stays the ONLY sanctioned interpreter write to the operator
tree, and it is exempt from the sweep by construction.** `harvestOne`'s writes
(`workflow-interpreter.mjs:710–717`) remain, but every materialized path is recorded in the
sweep's exemption set, so the sanctioned surface and the escape detector can never disagree.
Any other main-checkout write by interpreter or member is out of contract — an escape.

**D6 — receipt shape is NOT this row's to change (recorded DECISION_REQUEST).** The sweep's
verdict degradation needs no new receipt key (`verdict` already exists, `:628`), but the escape
DETAIL needs a home. Options: **(a)** an eighth receipt key `filesystem` — breaks "EXACTLY the
seven contract keys" (`:632–641`), a shape owned by the launch row (#202); **(b)** a typed store
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
| `workflow_base_unavailable` | `runWorkflow` base step, replacing the silent catch at `workflow-interpreter.mjs:541` | `{cause, idempotencyKey}` | name the git failure; the wave does not launch from an unpinned base |
| `worker_index_lock_stale` | any baton git write meeting a pre-existing `index.lock` (base step, `captureCommit` `worktree.mjs:1209/:1225`) | `{holder: <pid>\|'stale', lockMtime, next, path}` | "remove after owner death or wait" (the #169 audit's coaching, extended with `lockMtime`) |
| `member_fs_escape` | settle sweep (D4), as a store event + verdict downgrade | `{exemptPaths, paths, waveId, worktreeRoots}` | name the escaped paths; verdict is not `WAVE-OK` until reconciled |
| `worker_base_ref_invalid` | `captureCommit`/`validateOwnedWorktree` when `refs/baton/base/<taskId>` is absent or ≠ `meta.baseSha` (D2) | `{baseRef, expectedSha, taskId}` | the JSON anchor is untrusted; re-pin or reap the worktree |

Existing surfaces this contract FREEZES unchanged (boundary agreement, not redefinition):
`DirtyRepoError` + its `pinBaseSha` message (`worktree.mjs:30–32, :1053`),
`worker_path_scope_violation` + `pathScopeEvidence` (`coordinator.mjs:13505–13513`),
`harvest_ok`/`harvest_miss` (`workflow-interpreter.mjs:686, :702, :705`), and the seven receipt
keys (`:633–641`).

---

## 4. Red-first acceptance pins

Each pin names its stage, is RED at HEAD (verified against the cited HEAD behavior), and is
written so a wrong or shallow impl cannot go green. Fixture discipline: real git repos, no
clocks (mtimes are observed evidence, never assertion inputs), no mocking of git.

**FS-P1 — the base never commits the operator's tree.** Stage: base (`workflow-interpreter.mjs:537–542`).
Fixture: repo with one dirty tracked file + one untracked file on the checked-out branch. Drive
`runWorkflow`'s base step. Assert: (a) `git rev-parse HEAD` of the branch is unchanged; (b) no
commit whose message starts `baton workflow base` exists; (c) `git status --porcelain` still
lists both dirty paths; (d) the base step SUCCEEDS and yields a snapshot sha whose tree carries
the dirty file's content (verifiable via `git show <sha>:<path>`). RED at HEAD — :539–540 commits
them, so (a)–(c) fail outright (G1/G2). Anti-shallow: (c) blocks an impl that "avoids the commit"
by stashing or resetting the operator's files away — the dirt must SURVIVE untouched; (d) blocks
the lazier escape of merely refusing dirty trees (deleting the base step without building the
sideband snapshot would fail every dirty-tree wave — exactly what #168 made painful).

**FS-P2 — a broken base refuses typed, never silently.** Stage: base. Fixture: `repoRoot`
pointing at a directory where git cannot produce a snapshot (e.g. no HEAD). Assert:
`runWorkflow` throws `workflow_base_unavailable` naming the idempotencyKey. RED at HEAD — the
catch at :541 swallows the git failure and the wave proceeds from an unpinned base (G1).

**FS-P3 — the stale lock is a typed, coached refusal.** Stage: snapshot (`worktree.mjs:1206–1231`)
and base step. Fixture: plant a holderless `index.lock` with a fixed mtime in the target git dir
before the operation. Assert: the operation fails with `worker_index_lock_stale` carrying
`{holder: 'stale', lockMtime, next, path}` — and specifically NOT an untyped Error whose message
is raw git stderr. RED at HEAD — `sh()` bubbles raw stderr, no typed class exists (G5). Control
side (same pin): with no lock present, the operation succeeds and leaves no `index.lock` behind —
an impl that "passes" by always refusing is blocked.

**FS-P4 — an escape degrades the verdict and is recorded.** Stage: settle (`workflow-interpreter.mjs:577–641`).
Fixture: a driver-injected member effect that writes one file into the main checkout outside any
`.baton/` root and outside the harvest set, during the wave window. Assert: (a) a
`member_fs_escape` record exists naming that path; (b) the receipt's `verdict` ≠ `WAVE-OK`.
RED at HEAD — settle never inspects the operator tree and the verdict is computed only from
member terminality + harvest (G7/G11), so both assertions fail. Anti-shallow: FS-P5.

**FS-P5 — a clean wave still earns WAVE-OK (the anti-shallow-green control for FS-P4).**
Stage: settle. Fixture: identical wave with NO escape, harvest green. Assert: verdict IS
`WAVE-OK` and the escape record set is EMPTY. RED at HEAD — no escape record exists at all, so
"empty and present" fails. Blocks an impl that downgrades every verdict to satisfy FS-P4.

**FS-P6 — the base ref is pinned and authoritative.** Stage: snapshot (`worktree.mjs:1074–1179`,
`:1191–1241`). Assert: (a) after `createFromBase`, `refs/baton/base/<taskId>` exists and equals
`meta.baseSha`; (b) after corrupting the owner JSON's `baseSha`, `captureCommit` fails
`worker_base_ref_invalid` rather than computing `changedPathsFromBase` against the forged base.
RED at HEAD — no such ref is written and the JSON field is trusted unconditionally (G10/D2).

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
   (member objective/spec inputs are written untracked pre-wave). Confirm the snapshot's
   credential-exclusion list does NOT silently apply to the workflow base — different purpose,
   probably different exclusions; decide at fold.
5. **Reap of baton-abandoned locks (D3):** this contract forbids auto-reaping in the OPERATOR's
   repo. For locks abandoned by baton inside `.baton/` authority roots (baton-owned ground),
   auto-reap may be legitimate — does that split (owned vs borrowed ground) match the
   capacity-row's lock-tombstone vocabulary (`worktree-capacity` reap discipline)? Cross-row
   boundary check for the QA pass.

---

## Appendix — anchor verification record (post-nudge pass)

Every citation re-grepped this session (`grep -an`, exact-line confirmation) after the contract
body was written; the coordinator's spot-check can sample against this record. Confirmed exact:
`workflow-interpreter.mjs` — comment tail :535 (block :533–536), add :539, commit :540, silent
catch :541, settle :577–641, verdict :628, receipt keys :633–641, `harvestOne` :667,
`harvest_miss` :686/:696/:699, materialize calls :701/:704, `harvest_ok` :702/:705,
`materializeToDisk` :710, `pathEscapes` :719. `worktree.mjs` — `DirtyRepoError` :30, `sh` :67,
`authorityRoot` :98 (with `authorityChild`, block :96–129), `merge-base` anchor :1006,
`pinBaseSha` :1047, dirty throw :1053, `createFromBase` :1074, `captureCommit` :1191, bare add
:1209, bare commit :1225. `coordinator.mjs` — `globRegex` :600, `pathInScope` :618, out-of-scope
gate :13503–13513 (mint :13506). `adapter.mjs` — codex card boundary :751, danger-full-access
argv :761, claude card boundary :773, `GlmAdapter` :787. `application-deployment.mjs` —
untracked flag :201, `GIT_INDEX_FILE` :216, `commit-tree` :233 (block :199–236). `index.mjs` —
no-autoStash call :567. `kernel-honesty-audit.md` — stale-lock row :47. Corrections made while
finalizing (recorded for the audit trail): `GlmAdapter` :776→:787, `GIT_INDEX_FILE` ranged→:216,
out-of-scope throw :13505→:13503, untracked flag :202→:201. No outstanding drift.

Post-nudge hardening: FS-P1 gained clause (d) — the base step must SUCCEED on a dirty tree and
yield a snapshot sha carrying the dirty content — closing the shallow-green path where an impl
merely refuses dirty trees instead of building the sideband base.
