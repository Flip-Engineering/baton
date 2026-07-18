# Worker Isolation — git worktrees (spec)

*How each worker gets its own isolated copy of the repo, how the coordinator manages them, and how they connect to the trust gate and merging. This is load-bearing plumbing, not a nicety: it's what lets workers run in parallel without colliding, and it's what the re-verification step checks against. Plain language, real git commands.*

## Why worktrees (three jobs, not one)

1. **Isolation.** Several workers run at once. Each must edit, build, and test without seeing or clobbering another's half-finished work. A git *worktree* gives each worker its own working directory and its own branch, while sharing one copy of the repo's history underneath (cheap).
2. **The trust gate depends on it.** When a worker says "done," the coordinator re-runs the tests itself — but **not in the worker's own worktree** (which could contain a doctored test file or uncommitted junk). It builds a *fresh* worktree at the worker's committed result and checks there. No worktrees, no trustworthy re-verification.
3. **Merge is defined by it.** Each worker's result is a branch. Integrating accepted work is a branch merge; conflicts between two workers are visible and resolvable, not silent overwrites.

## What the worker sees vs. what the coordinator does

The worker (Codex/Claude/GLM) just sees **a normal repo in a normal directory** and works as usual. All the worktree bookkeeping is the coordinator's job — the worker doesn't need to know it's in a worktree. The coordinator:

- creates the worktree before spawning the worker and points the worker's working directory at it,
- gives the worker that directory as its repository/collision boundary and working directory;
  containment is a separate harness or external-OS policy and is never inferred from Git,
- tracks every worktree in its registry (rebuilt from the log, so it survives a coordinator restart),
- cleans up when the task is done or the worker dies.

## Lifecycle (with the real commands)

```
CREATE  (on spawn)
  # pin a clean base commit first, so every worker starts from a known, reproducible state
  base=$(git rev-parse HEAD)                       # or an explicit target; stash if the main tree is dirty
  git worktree add -b baton/<task-id> .baton/wt/<task-id> $base
  # -> a fresh checkout on its own branch; shares the object store, so history isn't re-copied
  spawn worker with cwd = .baton/wt/<task-id>

WORK
  # the worker edits/builds/tests/commits normally, on its own branch, in its own directory.
  # git refuses to check out the same branch in two worktrees, so isolation is enforced by git itself.

CAPTURE  (on "done")
  # the unit of result is a COMMIT, never a dirty working tree.
  # if the worker left uncommitted changes, the coordinator commits a snapshot:
  git -C .baton/wt/<task-id> add -A && git -C .baton/wt/<task-id> commit -m "baton: worker snapshot" || true
  result_sha=$(git -C .baton/wt/<task-id> rev-parse HEAD)

VERIFY  (the trust gate — in a FRESH worktree, not the worker's)
  git worktree add --detach .baton/verify/<task-id> $result_sha
  run the PINNED verification in .baton/verify/<task-id>   # clean; worker never touched this dir
  git worktree remove --force .baton/verify/<task-id>

MERGE   (only if verify passed and the orchestrator accepts)
  git checkout <integration-branch>
  git merge --no-ff baton/<task-id>        # or leave as a branch / open a PR for human review
  # conflicts surface HERE; see "avoiding merge collisions" below

CLEANUP
  git worktree remove --force .baton/wt/<task-id>
  git branch -D baton/<task-id>            # if abandoned; keep if merged and you want the history
```

## The engineering considerations (the parts that bite)

- **Pin a clean base.** Every worker branches from one specific commit. If the main working tree is dirty, stash or commit it first — otherwise workers start from an unreproducible state, replay breaks, and the trust gate loses meaning. The base commit is recorded in the log so any run is reproducible.
- **Disk cost is real but bounded.** Worktrees share history (one object store) but each is a full checkout of the working files. Handfuls of workers on a normal repo is fine; a huge monorepo × many workers is not. Mitigations, in order: keep the fleet small (it already is); **sparse-checkout** each worktree to just the task's path scope (`git worktree add` + `git sparse-checkout set <paths>`); and note that the shared *code-search index* is built once for the whole fleet, so it isn't duplicated even when checkouts are.
- **Workers run their own git — handle it.** A worker may `git commit` (good — that's how work is captured), `git branch` (fine — the coordinator keys off the worktree's HEAD commit, never an assumed branch name), or `git push` (**dangerous** — a push escapes the fence and can't be undone by interrupting). Push and other outside-world git actions are **approval-gated**, matching the honest limit in the interrupt/steer design: keep irreversible side effects behind approval.
- **Attribution.** Each worker commits as itself — author set to `baton-worker-<vendor>` with a trailer naming the vendor, model version, and task id — so `git blame` across the fleet answers "which worker wrote this, under whose direction," and the routing stats can be tied to real outcomes.
- **Interrupt interaction (ties to confirm-it-stopped).** When you interrupt a worker, its worktree may have a half-written file or an in-flight `git` operation. The coordinator must **not** touch or reap a worktree until the worker has *confirmed it stopped* (the two-phase-stop rule) — otherwise two writers corrupt the index. Worktree cleanup is gated on confirmed-stop.
- **Zombie worktrees.** If a worker crashes, its worktree is left behind. The coordinator's registry (from the log) knows which worktrees should exist; on boot it reconciles — `git worktree prune` for git's stale admin files, plus removing directories for tasks that ended. Nothing is left to rot.
- **Don't collide with the user's own worktrees.** Everything baton creates lives under `.baton/` (git-ignored, and ideally outside the main working tree) so it never clashes with worktrees the developer already uses, and never recurses into itself.
- **Non-git projects.** Fallback: a plain directory copy per worker (degraded — no cheap history sharing, no branch merge, so integration is a manual diff apply). The isolation property still holds. Flag it as a lesser mode.

## Avoiding merge collisions before they happen

Isolation stops workers colliding *while running*; it doesn't stop their *merges* from conflicting if two workers edited the same code. Two mechanisms keep merges clean:

1. **Path leases.** Before a worker starts, its brief declares a path scope, and it claims that scope on the shared scratchpad (the fast-memory layer). Two workers aren't given overlapping scopes for the same batch, so their branches touch different files and merge cleanly. This is decomposition working *with* isolation.
2. **Merge by meaning, later.** For the cases where scopes must overlap, textual merge is the MVP (and conflicts go to the human or a dedicated merge step). The future upgrade is merging by *behavior* rather than by text lines (the semantic-diff/merge idea) — a genuine bet, deferred, but this is exactly the setting where it would pay off.

## MVP scope

For the smallest driver: create a worktree per worker from a pinned base, confine the worker to it, capture the result as a commit, **re-verify in a fresh worktree at that commit**, and clean up on done/crash. Round-robin two workers on non-overlapping path scopes so textual merge is trivial. Sparse-checkout, semantic merge, and non-git fallback are later. The one non-negotiable from day one: **verification never runs in the worker's own worktree** — that's the line that makes "done" trustworthy.
