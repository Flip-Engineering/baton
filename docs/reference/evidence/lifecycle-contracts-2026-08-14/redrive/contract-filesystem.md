# ROW CONTRACT — row-lc-fs: the filesystem lifecycle of the wave-lifecycle package (③)

`[attempt: a8f2584a-3282-4825-b1d0-5aa4a6b69067 row-lc-fs]`

The implementation contract for the FILESYSTEM-lifecycle rung of package ③ (the `waves.run`
operator surface): the workflow base commit (#168), the snapshot index discipline (#172), and
member confinement + the settle sweep (#185). It is a **Ring-2 contract** (ground truths →
decisions → refusal vocabulary → red-first acceptance pins → open questions). It **specifies
behavior**; it does not amend implementation in this artifact. The campaign evidence — today's
four base-commit captures, two index.lock reaps, two member scope escapes — is the requirement
source; every ground truth is re-verified against the real code at HEAD this session.

- **Date:** 2026-08-14
- **Version:** v1 (redrive rd1). The original wave-a row did not land a contract under this name;
  this is the redrive row's first draft. Fold inputs will be recorded in the `## Fold record` at
  the end as they arrive.
- **Status:** DRAFT v1 — implementation contract (red-first; no code lands in this artifact).
- **Verification HEAD:** `1ff8335` ("Baton private effective-tree snapshot"). Every `file:line`
  citation below was re-verified this session with `grep -an`/`sed -n`/`Read` at this HEAD, not
  inherited. NUL-bearing files (`application.mjs`, `coordination-store.mjs`) are grep/sed-verified
  only; `workflow-interpreter.mjs`, `worktree.mjs`, `coordinator.mjs`, `application-deployment.mjs`,
  `adapter.mjs`, `path-scope.mjs`, and the red suite were read directly (NUL-free).
- **Brief:** `row-lc-fs.md` (same parent dir) — read fully; `foundry-brief.md` (same parent dir) —
  the shared frame, read first. The frame's laws bind: Ring-2 form, citation discipline,
  attempt-echo in the first five lines, no clocks as controls, sorted-key literals ACTUAL order,
  verdict-grade pins RED at HEAD.
- **Deliverable path resolution (judgment call, recorded):** the parent wavefile
  (`lifecycle-contracts-2026-08-14/lifecycle-contracts.wavefile:15`) declares `report
  "…/contract-filesystem.md"` and harvests `…/contract-filesystem.md` mustContain "#168"
  (`:44`). This redrive row's dispatch scopes to `docs/reference/evidence/
  lifecycle-contracts-2026-08-14/redrive/**` and names the deliverable
  `redrive/contract-filesystem.md`. The `redrive/` directory is the redrive wave's own workspace
  (same pattern as `honesty-package-2026-08-14/redrive/`). **This contract lives at the redrive
  path** — the more specific, later dispatch governs over the parent wavefile's top-level path.
  If the parent wave's harvest later re-targets the top-level file, the fold can copy it
  (recorded, not silent).
- **Brief citation-drift note (judgment call, recorded):** the row brief cites "the base-commit
  line at workflow-interpreter.mjs:525"; the actual block is `:533-541` with the `git add -A` at
  `:539` and the forged commit at `:540`. The contract cites what was verified.
- **Scope of the rung, in one sentence:** the wave's base provisioning must never capture the
  operator's dirty working-tree state onto the operator's branch (#168); every snapshot/commit
  path must run against a per-process sideband index and refuse a stale `.git/index.lock` with a
  typed code, never raw stderr (#172); and member raw-fs writes outside the member's worktree
  must be visible to the capture-time scope check and refused, with the interpreter's own
  main-tree write channel (harvest materialization) the ONLY sanctioned main-checkout write path
  (#185) — all while the D6 receipt keeps EXACTLY its seven sorted keys (F14).

---

## Ground truths (verified this session at `1ff8335`)

- **G1 — the interpreter provisions a base commit by sweeping the OPERATOR's repo with `git
  add -A`, then forging a Baton commit onto the operator's branch (#168).** The wave's base
  block (`workflow-interpreter.mjs:533-541`) commits the current working-tree state so the base
  is clean: the comment at `:533-536` states the intent ("The wave provisions each member's
  worktree from a clean base commit; the worktree manager refuses a dirty working tree
  (pinBaseSha's DirtyRepoError). The lane's objective/spec files are written into the tree as
  inputs — commit the current working-tree state so the base is clean."), then
  `execFileSync('git', ['add', '-A'], { cwd: repoRoot, … })` at `:539` stages EVERYTHING in the
  operator's repo, and `execFileSync('git', ['-c','user.name=Baton','-c','user.email=baton@local',
  'commit', '-q', '-m', \`baton workflow base ${spec.idempotencyKey}\`], { cwd: repoRoot, … })` at
  `:540` commits it to the operator's current branch. `repoRoot` defaults to `baton.repoRoot`
  (`:501-503`) — the operator's main checkout, not a member worktree. `pinBaseSha` refuses a
  dirty tree (`worktree.mjs:1047-1054`, `DirtyRepoError` at `:1050`) — that refusal is what the
  sweep exists to circumvent.
- **G2 — the sweep really does capture operator dirty state; the evidence is in master's
  history.** 12 `baton workflow base …` commits exist on the current branch (`git log --oneline
  --grep="baton workflow base"`). Today's FOUR captures: `055c6cc` (review-foundry wave-a) swept
  `impl-79-notes.md`, `impl-79-receipt.json`, **and `impl/src/adapter.mjs` (a source file, +6
  lines)** — proof the sweep carries operator source edits into a commit; `cd555ca`
  (fold-foundry wave-b) swept blind-waits contract edits + `fold-164.md`; `a176f39` (blue-team
  wave-a) swept `suite-notes-163.md` + `workflow.json` (a #185 escape, see G7); `04bd28f`
  (suite-fold-170 wave-a) swept `blueteam-161.md` (the other #185 escape). Each is a commit on
  the operator's branch authored as `Baton <baton@local>`.
- **G3 — the base SHA is pinned ONLY in on-disk JSON, never a git ref.** `createFromBase`
  (`worktree.mjs:1074-1155`) adds the worktree at `baseSha`; the base is recorded in `writeMeta`
  (`worktree.mjs:165-171`, called at `:1151`) as a JSON `baseSha` field validated by
  `validateOwnedWorktree` (`:984`, `:1005-1006` reads `meta.baseSha` via
  `merge-base --is-ancestor`). `changedPathsFromBase` (`:936-946`) reads ONLY the worktree's own
  cached diff, working-tree diff, and untracked files — everything relative to `baseSha`. So a
  corrupted/reaped owner file silently destroys the `changedPathsFromBase` anchor. The
  kernel-honesty audit row 6 (same-session evidence) proposes the sideband ref
  `refs/baton/base/<taskId>` (`kernel-honesty-audit.md:48,62`, citing `worktree.mjs:1080,1113,
  1005-1006`).
- **G4 — the snapshot machinery abandons `.git/index.lock` because two paths run bare
  git against a shared real index (#172).** (a) The interpreter base commit above
  (`workflow-interpreter.mjs:539-540`) runs `git add -A` + `git commit` in the operator's
  `repoRoot` with the real index. (b) `captureCommit` (`worktree.mjs:1205-1227`) runs
  `sh('git', ['add','-A'], dir)` at `:1209` and `sh('git', ['commit', …])` at `:1225` against the
  worktree's real index; `sh` surfaces raw `execFileSync` stderr (`worktree.mjs:67-73`). A crashed
  prior snapshot leaves `.git/index.lock`; the next bare add/commit fails with raw stderr — no
  typed refusal, no holder, no recovery hint. Today's two reaps were holderless + fixed-mtime.
- **G5 — the deployment snapshot already proves the correct pattern: a per-process sideband
  index (`GIT_INDEX_FILE`), which sidesteps the index.lock class entirely (#172 contrast).**
  `application-deployment.mjs:210-246`: a unique sideband index path
  `snapshot-index-${process.pid}-${randomBytes(8)}` (`:212`), `gitEnv = { GIT_INDEX_FILE: indexPath,
  … }` (`:216`), then `read-tree`/`add -A`/`update-index --force-remove`/`write-tree`/`commit-tree`
  all under that env (`:225-233`), with `rmSync(indexPath)` in `finally` (`:244`). No `index.lock`
  is ever possible because the shared `.git/index` is never touched. The kernel-honesty audit row 7
  (same-session) names the typed refusal for the un-coached case: `worker_index_lock_stale` with
  `{path, holderPid | 'stale', next}` (`kernel-honesty-audit.md:47`, citing `worktree.mjs:1205-1227,
  78-83`; contrast `application-deployment.mjs:214-220`).
- **G6 — member worktrees are git worktrees INSIDE the operator's repo, so a raw-fs escape lands
  in the operator's tree (#185 topology).** `AUTHORITY_ROOTS = new Set(['integrate','verify','wt'])`
  (`worktree.mjs:96-101`); worktrees live at `.baton/wt/<taskId>` inside the repo (`createFromBase`,
  `:1094`). A member writing via raw fs (not via the baton-surface write lane) can therefore touch
  ANY path in the operator's checkout — including outside its declared scope.
- **G7 — the write-scope machinery covers baton-surface ops, not raw fs; the two escapes prove
  it (#185 mechanism).** The machinery has three layers: (a) admission-time scope class
  (`workflow-interpreter.mjs:186-204`) rejects NUL/absolute/backslash/`..` scope entries and bare
  directories at admission (path-scope.mjs:6-7); (b) the prompt-level instruction
  (`adapter.mjs:128` — "Write only inside the assigned Baton worktree…") is a prompt, not
  enforcement; (c) the capture-time scope check (`coordinator.mjs:13502-13530`) filters
  `captured.changedPaths` through `pathInScope` and throws `worker_path_scope_violation` for
  out-of-scope paths (`:13519-13521`). BUT `changedPaths` come from `_captureTrustWorktree` →
  `changedPathsFromBase` (G3), which reads only the WORKTREE's own diff — a raw-fs write to the
  MAIN checkout is invisible to that diff until the NEXT wave's base commit `git add -A` sweeps
  it. The escapes: commit `d578320` records "row-bt161 stopped mid-flight but its report escaped
  to the main tree — the scope-escape instance, filed separately"; base commit `a176f39` swept
  `suite-notes-163.md` + `workflow.json`; base commit `04bd28f` swept `blueteam-161.md`. The
  pathInScope gate is also permissive at capture: `pathInScope(scopes, path)` returns `true` when
  scopes is empty/non-array (`coordinator.mjs:618-622`) — the escape is gated only by whatever
  `pathScope` the dispatch carried.
- **G8 — the interpreter's own main-checkout write channel is harvest materialization, and it is
  already path-scoped — the model for what raw fs may NOT do (#185 contrast).**
  `harvestOne` (`workflow-interpreter.mjs:636-673`) refuses paths escaping the repo
  (`pathEscapes` at `:645`), reads the recovered bytes from the run's authoritative result sha via
  `git show` (never the live worktree), and `materializeToDisk(repoRoot, path, bytes)`
  (`:679-686`) writes ONLY the declared harvest path into the main checkout. The `mustContain`
  lane additionally verifies the attempt marker + substring before materializing (`:659-669`).
  This is the sole sanctioned main-tree write channel; a member raw-fs write is an unsanctioned
  channel with no path-scope check.
- **G9 — the D6 receipt is EXACTLY seven keys in ACTUAL sorted order (F14).**
  `workflow-as-data-red.test.mjs:704` asserts `Object.keys(receipt) ===
  ['basis','harvest','manifestDigest','outcomes','steering','verdict','waveId']`. The verdict enum
  is closed: `WAVE-OK` / `WAVE-INCOMPLETE` (`workflow-interpreter.mjs:620-621`), `basis` is
  `'completed'` or `manifestDigest` (`:622`). Any new evidence the rung adds must ride inside
  `steering[]`/`outcomes[]`, never a new top-level key.

---

## D1 — the workflow base commit must not capture the operator's dirty state (#168)

The interpreter's base block exists so each member worktree provisions from a clean base
(G1). Today that intent is met by sweeping the operator's whole tree onto the operator's branch.
The contract: **the base commit stages ONLY the lane's declared inputs, commits to a private
sideband ref, and refuses a dirty operator tree instead of sweeping it.**

- **D1.1 — scoped staging, never `git add -A` on `repoRoot`.** The base commit stages the lane's
  own declared input paths (the member objective/spec files the comment names at
  `workflow-interpreter.mjs:535`), NOT `git add -A` (`:539`). Operator dirty files that happen to
  sit in the tree are not swept; if a declared input path itself is dirty, that is surfaced (see
  D1.3), not committed.
- **D1.2 — the base commit lands on a sideband ref, never the operator's branch.** Adopt the
  kernel-honesty row-6 proposal: `refs/baton/base/<taskId>` pinned in `createFromBase`
  (`worktree.mjs:1074-1155`) and verified by `validateOwnedWorktree`/`captureCommit` instead of
  trusting only the JSON `meta.baseSha` (G3). The operator's branch history is never extended by
  a `baton workflow base` commit; the 12 commits already on the branch are the RED state this
  pin removes.
- **D1.3 — a dirty operator tree refuses, it does not get committed.** `pinBaseSha` already has
  the refusal (`DirtyRepoError`, `worktree.mjs:1047-1054`). The interpreter's catch-and-continue
  (`workflow-interpreter.mjs:541` — "nothing to commit, or commits unavailable") must not convert
  that refusal into a silent sweep. Behavior: with no commitable lane inputs AND a dirty tree,
  the wave surfaces the base-state issue rather than fabricating a base from operator state.

## D2 — every snapshot/commit path runs under a per-process sideband index; stale locks refuse with a typed code (#172)

The deployment snapshot already proves the sideband pattern (G5). The contract generalizes it:
**no git add/commit against a shared real index anywhere in the interpreter/capture path.**

- **D2.1 — the interpreter base commit and `captureCommit` adopt `GIT_INDEX_FILE`.** Both the
  base block (`workflow-interpreter.mjs:539-540`) and `captureCommit` (`worktree.mjs:1209,1225`)
  run under a per-process sideband index (`GIT_INDEX_FILE: <unique path>`, created + removed
  like `application-deployment.mjs:210-216,244`). A crashed prior snapshot can then never leave a
  stale `.git/index.lock` blocking the next capture.
- **D2.2 — a detected stale lock refuses typed.** When a stale `.git/index.lock` is nonetheless
  detected before a capture, the refusal is `worker_index_lock_stale` naming `{path, holderPid |
  'stale', next}` (kernel-honesty row 7) — never raw `execFileSync` stderr (G4). `next` names the
  recovery step (remove after owner death, or wait), satisfying the "actionable refusal" law.
- **D2.3 — the sideband path itself never collides.** The unique index path follows the
  deployment snapshot's shape (`snapshot-index-${pid}-${randomBytes(8)}`, `application-deployment
  .mjs:212`) — no bare constant, no reuse across processes.

## D3 — member confinement + the settle sweep: raw-fs writes to the main checkout are visible and refuse (#185)

Today a member raw-fs escape is invisible to the capture-time scope check (G7) and is swept by the
next base commit (G1). The contract: **the capture-time check must see the main checkout too, and
the interpreter's harvest channel is the only sanctioned main-tree write.**

- **D3.1 — the capture-time scope check covers the operator's main checkout, not just the
  worktree diff.** `_captureTrustWorktree` (coordinator.mjs:2714) / the scope check
  (`coordinator.mjs:13502-13530`) gains a main-checkout sweep: paths in the operator's tree
  changed since the wave's base SHA (G3 anchor) that are NOT declared harvest paths are
  out-of-scope changed paths and throw `worker_path_scope_violation` naming the escaped path.
  This makes the #185 escapes (blueteam-161.md, suite-notes-163.md) refuse at capture, before a
  later base commit can absorb them.
- **D3.2 — the interpreter's harvest materialization is the ONLY sanctioned main-checkout write
  channel.** `materializeToDisk` (`workflow-interpreter.mjs:679-686`) already path-scopes via
  `pathEscapes` (`:645`). The settle sweep (D3.1) treats harvested paths as in-scope by
  declaration — the sweep's allowlist is exactly the declared `harvest.paths`, nothing else.
- **D3.3 — pathInScope's empty-scope permissiveness is closed for the sweep.** `pathInScope`
  returns `true` for empty/non-array scopes (`coordinator.mjs:618-622`) — fine for legacy
  dispatch, but the main-checkout sweep must not inherit it: a member with no declared scope must
  not get implicit main-checkout write authority. The sweep applies the member's declared
  `pathScope`; absent a scope, the only allowed main-tree writes are declared harvest paths.

## D4 — receipt integrity under the new evidence (F14)

The fixes add evidence but must not change the receipt grammar. **All new evidence rides inside
`steering[]`/`outcomes[]`; the D6 key-set stays EXACTLY `['basis','harvest','manifestDigest',
'outcomes','steering','verdict','waveId']` (G9).** The settle-sweep refusal surfaces as a
`steering[]` entry carrying `{ role, evidence: 'worker_path_scope_violation', … }` in the
existing receipt shape — no new top-level key, no new verdict value. `WAVE-OK`/`WAVE-INCOMPLETE`
remain the closed verdict enum (`workflow-interpreter.mjs:620-621`).

---

## Refusal vocabulary

Closed, typed, surface-constant. The rung introduces ONE new typed refusal
(`worker_index_lock_stale`) and reuses the existing scope machinery for the main-checkout sweep;
the base-commit confinement (D1) reuses the existing `DirtyRepoError` and the admission class.

| Code / value | Kind | Source | Context |
|---|---|---|---|
| `worker_index_lock_stale` | typed refusal | NEW (D2.2; kernel-honesty row 7) | A stale `.git/index.lock` detected before a capture — `{path, holderPid \| 'stale', next}`. Replaces raw `execFileSync` stderr. |
| `worker_path_scope_violation` | typed refusal | reused (`coordinator.mjs:13520`) | Out-of-scope changed paths at capture — now ALSO covers main-checkout changes outside declared harvest paths (D3.1). Shape unchanged: `pathScopeEvidence` with digests. |
| `path_scope_invalid` | typed refusal | reused (`path-scope.mjs:2`) | Malformed scope pattern at admission (NUL/absolute/backslash/`..`/bare-dir). Unchanged. |
| `worker_sparse_metadata_invalid` | typed refusal | reused (`worktree.mjs:1005`) | Owned-worktree base metadata disagrees with the admitted base. Unchanged. |
| `DirtyRepoError` | typed refusal | reused (`worktree.mjs:1050`) | `pinBaseSha` on a dirty tree — the base-commit confinement's honest surface (D1.3). |
| `harvest_miss` | named evidence line | reused (`workflow-interpreter.mjs:650`) | A declared harvest path with no authoritative blob / failed marker check. Unchanged. |
| `steering_message_undelivered` | named evidence line | reused | Existing steering channel (the G7 sibling per contract-163's OQ1). Unchanged. |

The closed vocabulary is complete: one new refusal code, zero new verdict values, zero new
top-level receipt keys. Should OQ3 later resolve to a distinct sweep code (vs. reusing
`worker_path_scope_violation`), it would be named in that resolution — deliberately NOT part of
this rung's vocabulary today.

---

## Red-first acceptance pins

RED = fails at HEAD (`1ff8335`); GREEN = passes only after this rung lands correctly. Each pin
names its failure stage at HEAD. Shallow-greenability is a defect: every pin has a
counterexample that a wrong impl cannot relabel through.

| Pin | Assertion | At HEAD |
|---|---|---|
| A1 *(D1.1 — scoped staging)* | The interpreter's base provisioning stages ONLY the lane's declared input paths. A correct impl's base commit tree contains the member objective/spec files and nothing else. **Counterexample:** a base commit whose tree also contains `impl/src/adapter.mjs` (operator source) or any operator file not declared as a lane input fails — no `git add -A` anywhere on `repoRoot`. | **RED** — `workflow-interpreter.mjs:539` runs `git add -A` on `repoRoot`; `055c6cc` swept `impl/src/adapter.mjs` into master today. |
| A2 *(D1.2 — sideband ref)* | `createFromBase` pins `refs/baton/base/<taskId>` at `baseSha`, and `captureCommit`/`validateOwnedWorktree` verify the base from that ref (falling back to JSON only with a documented mismatch). No `baton workflow base` commit ever advances the operator's branch. **Counterexample:** a run that creates a worktree without a `refs/baton/base/<taskId>` ref (only `meta.baseSha`) fails — a wrong impl that keeps only the JSON pin cannot pass. | **RED** — baseSha lives only in on-disk `writeMeta` JSON (`worktree.mjs:1151,984,1005-1006`); no sideband ref exists; 12 base commits sit on the operator's branch. |
| A3 *(D1.3 — refuse-dirty)* | A wave whose operator tree is dirty (uncommitted operator changes) AND which has nothing to stage as lane inputs refuses at base provisioning (typed `DirtyRepoError` surface), never committing operator state. **Counterexample:** a wave that commits operator dirty state "because the base must be clean" fails — the sweep is the bug, not the fix. | **RED** — the sweep commits operator state deliberately (`:539-540`); `pinBaseSha`'s refusal is circumvented. |
| A4 *(D2.1 — sideband index)* | Both the interpreter base block and `captureCommit` run under a per-process `GIT_INDEX_FILE`; no `git add`/`git commit` in the capture path uses the shared real index. **Counterexample:** a capture that runs `git add -A` without a sideband index fails — the index.lock class is only closed when the shared index is never touched. | **RED** — `captureCommit` (`worktree.mjs:1209,1225`) and the base block (`:539-540`) run bare; only the deployment snapshot uses sideband (`application-deployment.mjs:216`). |
| A5 *(D2.2 — typed stale-lock refusal)* | A stale `.git/index.lock` before a capture yields `worker_index_lock_stale` with `{path, holderPid \| 'stale', next}` — never raw stderr. **Counterexample:** a capture that fails with bare `execFileSync` output (no code, no holder, no `next`) fails the pin. | **RED** — `sh` surfaces raw stderr (`worktree.mjs:67-73`); no typed lock refusal exists. |
| A6 *(D3.1 — main-checkout sweep)* | At capture/settle, paths in the operator's main checkout changed since the base SHA that are NOT declared harvest paths refuse with `worker_path_scope_violation` naming the escaped path. **Counterexample (kills relabel-greenability):** a wave whose ONLY change is a main-checkout file matching a declared harvest path is NOT refused (harvest channel is legal), while `blueteam-161.md` / `suite-notes-163.md`-style escapes ARE — the sweep must discriminate by declaration, not by "any change in the repo". | **RED** — `changedPathsFromBase` reads only the worktree diff (`worktree.mjs:936-946`); both escapes were swept by later base commits (`a176f39`, `04bd28f`) — invisible at their own capture. |
| A7 *(D3.2/D3.3 — sweep allowlist + empty-scope closure)* | The sweep's main-tree allowlist is EXACTLY the declared `harvest.paths`; a member with no declared `pathScope` has NO implicit main-checkout write authority. **Counterexample:** a member with empty scope whose main-checkout change passes the sweep (via `pathInScope`'s empty-scope `true`, `coordinator.mjs:618-622`) fails. | **RED** — `pathInScope` returns `true` for empty scopes; no sweep exists at all. |
| A8 *(D4 — receipt integrity)* | The landed rung adds NO top-level receipt key and NO new verdict value; all settle-sweep evidence rides `steering[]`/`outcomes[]`; the D6 key-set stays EXACTLY `['basis','harvest','manifestDigest','outcomes','steering','verdict','waveId']`. **Counterexample:** an impl that adds a top-level `sweep`/`scopeEvidence` key or a `WAVE-REFUSED` verdict fails — F14 is invariant. | **RED** — the sweep machinery does not exist, so no sweep evidence is emitted at all; the pin asserts the LANDED state preserves the exact seven-key receipt while ADDING the D3 evidence inside the arrays. |

---

## Open questions

- **OQ1 — the `shared` scratchpad publish is RED at this HEAD (#158); the durable file is the
  only channel.** The frame requires publishing the final draft to `shared`
  (`foundry-brief.md:23`). Verified THIS session with fresh anchors: (a) the agent-facing facade
  dispatches `run.scratchpad.read` / `run.scratchpad.elevate` only
  (`application-cli.mjs:30`; `grep -rn "run.scratchpad.append|run_scratchpad_append|
  scratchpad_append"` across `impl/` returns nothing); (b) the worker write lane
  (`writeScratchpad`, coordination-store.mjs:14064) hardcodes `const scope =
  \`worker:${fields.workerId}\`` (`:14103`) — a worker-scoped write can never land in `shared`;
  (c) the `shared` settlement path is orchestrator-only: `createAndClaimSettlementTask` refuses
  unless `auth.actor === 'orchestrator'` (`:12497`). A row worker therefore has NO executable
  `shared`-publish channel at this HEAD. The `shared` write verb is itself what sibling issue
  #158 is drafting — RED at this HEAD. The durable-file fallback is THIS contract (recorded so
  the coordinator can note it in `contract-qa.md` rather than treat `shared` as authoritative).
  **Refusal recorded (evidence: #158; anchors `application-cli.mjs:30`,
  `coordination-store.mjs:14103`, `:12497`):** the shared post is absent; this file is the
  deliverable.
- **OQ2 — the sideband base ref's lifecycle owner.** `refs/baton/base/<taskId>` (D1.2) is
  created by `createFromBase`; who prunes it — the worktree reap path (`worktree.mjs:1175-1180`
  removes the meta file) or the interpreter's close? Authority-class ambiguity between the
  worktree manager (owns the worktree) and the interpreter (owns the base commit). **DECISION
  REQUEST with options:** (a) worktree reap prunes the ref alongside the meta (cohesive with the
  worktree lifecycle); (b) the interpreter prunes at `wave.close` (cohesive with the base
  commit's author). Not resolved in this rung; the fold should decide before the sideband ref
  ships, else reaped worktrees leak refs.
- **OQ3 — a distinct sweep code vs. reusing `worker_path_scope_violation`.** D3.1 reuses the
  existing code. A separate `worker_main_checkout_escape` would give a reviewer a direct signal
  that the escape was via raw fs into the main tree (vs. an in-worktree scope breach). The rung
  keeps the reused code for surface-constancy; the coordinator may prefer the distinct code — the
  fold can name it without changing any other pin.
- **OQ4 — the sweep's cost boundary.** A main-checkout sweep per capture adds a tree read against
  `baseSha`. For long waves with many captures this is bounded by the base anchor (G3) but could
  be a per-capture diff of the whole repo. Options: sweep at settle only (once per wave), or per
  capture. The rung pins the per-capture sweep (A6); a settle-only variant is a possible
  follow-on if the per-capture cost proves material — recorded, not resolved.

---

## Cross-references

- `workflow-interpreter.mjs:533-541` (base block), `:539-540` (add/commit), `:541` (catch),
  `:620-622` (verdict/basis), `:636-673` (harvestOne), `:679-686` (materializeToDisk).
- `worktree.mjs:67-73` (`sh` raw stderr), `:96-101` (AUTHORITY_ROOTS), `:936-946`
  (changedPathsFromBase), `:984/1005-1006` (meta.baseSha validation), `:1047-1054`
  (pinBaseSha DirtyRepoError), `:1074-1155` (createFromBase), `:1205-1227` (captureCommit).
- `coordinator.mjs:618-622` (pathInScope empty-scope permissiveness), `:13502-13530`
  (capture-time scope check, `worker_path_scope_violation` at `:13519-13521`).
- `application-deployment.mjs:210-246` (sideband index — the D2 precedent).
- `adapter.mjs:128` (prompt-level write authority), `path-scope.mjs:2,6-7` (scope class).
- `workflow-as-data-red.test.mjs:704` (F14 receipt key-set pin).
- `kernel-honesty-2026-08-13/kernel-honesty-audit.md:47` (row 7 — `worker_index_lock_stale`),
  `:48,62` (row 6 — sideband base ref).
- `contract-foundry-2026-08-13/contract-163.md` (Ring-2 exemplar; OQ1's shared-publish refusal
  pattern).

## Campaign-law constraints

- **No clocks as controls.** The sweep and base-confinement use commit/hash anchors
  (`baseSha`, the sideband ref) — no wall-clock comparisons, no numeric timeouts. Consistent
  with the #163 de-clocking law.
- **No arbitrary numeric limits.** The sideband index path uniqueness uses the deployment
  snapshot's `pid + randomBytes(8)` shape — derived from process identity + entropy, not a
  hardcoded ceiling.
- **Sorted-key literals ACTUAL order.** The F14 receipt literal appears exactly as
  `['basis','harvest','manifestDigest','outcomes','steering','verdict','waveId']` (G9) — verified
  against `workflow-as-data-red.test.mjs:704`, never re-sorted by hand.
- **Attempt echo.** `[attempt: a8f2584a-3282-4825-b1d0-5aa4a6b69067 row-lc-fs]` appears verbatim
  in the first five lines of this file.
- **Citation discipline.** Every anchor re-verified at HEAD `1ff8335` this session (G1-G9).

## Fold record (v1)

- **v1 (2026-08-14, redrive rd1):** initial draft. Ground truths G1-G9 verified at HEAD
  `1ff8335`; decisions D1 (base-commit confinement: scoped staging + sideband ref + refuse-dirty),
  D2 (sideband index + typed stale-lock refusal), D3 (member confinement + settle sweep),
  D4 (receipt integrity); one new typed refusal (`worker_index_lock_stale`); pins A1-A8 (all RED
  at HEAD, each with a counterexample); OQ1 (shared-publish refusal, evidence #158), OQ2
  (sideband ref lifecycle — DECISION_REQUEST with options), OQ3, OQ4. Deliverable path resolved
  to `redrive/contract-filesystem.md` (recorded in the header). No fold inputs have arrived yet.
