# #674 — independent reproduction and characterization (reviewer)

Reviewer: `semantic-integration-674-review`. Worktree: `codex/baton2-semantic-integration-674-review-20261005`.
Fixtures live under `.scratch/semantic-context-20261005/probes/674-review/` (`repro/` for the
`land` probe, `repro-checked/` for the `land-checked` probe). No commits were made; nothing
outside the fixture directories and this report was written.

Toolchain:

- Coordinator: `/Users/wahargis/.local/share/baton2/releases/1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561/bin/baton2`
  (release 1.1.0, commit fca7af876c8260c32d17f95f3e19bc68ee1bf561, 3,973,720 bytes, Oct 4 16:31; the binary has no version flag, so identity is the release path).
- Git: 2.50.1 (darwin arm64, macOS 27.0.0).

## 1. Reproduction: `land` advances a held target and leaves the holder stale

Fixture `probes/674-review/repro/`. One repository, `main` checked out in its primary
worktree, clean status. This is the one deviation from the existing acceptance fixtures
(`bend2/scripts/accept-git.py` `seed_repo` detaches the primary worktree, with the comment
"a landing advances a target no worktree holds").

```
git init -q -b main repo            # seed commit 94650b0 "seed" (seed.txt)
baton2 state.db attach root external '' ''
baton2 state.db role root principal-conductor
baton2 state.db recruit fixer root omp fixture-model low <repo> fb wt-fixer <seed-sha>
# in repo/wt-fixer (branch fb):
printf 'fixture\n' > fixture.txt && git add fixture.txt && git commit -q -m 'fixer writes fixture.txt'
# worker tip: 607158f "fixer writes fixture.txt", parent 94650b0
```

State before the landing: `main` = `94650b0`, primary worktree on `main`, clean; the
porcelain worktree listing carries the line `branch refs/heads/main`.

The landing:

```
baton2 state.db land fixer <repo> main
{"status":"landed","target":"main","commit":"607158fd0ec99d219806e2d41febffd0acb2f48a"}
exit 0
```

State after the landing:

```
git rev-parse main   -> 607158fd0ec99d219806e2d41febffd0acb2f48a
git rev-parse HEAD   -> 607158fd0ec99d219806e2d41febffd0acb2f48a   # holder's HEAD follows the ref
git status --porcelain -uno
 D  fixture.txt                                       # staged deletion, index still at 94650b0
git status (long form)
On branch main
Changes to be committed:
	deleted:    fixture.txt
ls <repo>            -> seed.txt wt-fixer/          # fixture.txt absent from disk
git diff --cached --stat
 fixture.txt | 1 - ; 1 file changed, 1 deletion(-)
```

The branch advanced through `update-ref`; the holder worktree's index and files stayed at
`94650b0`. `git status` in the holder now reports `deleted: fixture.txt` as a staged
change. A commit made in the holder, or any further operation that builds on its index,
would drop `fixture.txt` from the branch tip. That is issue #674.

## 2. Characterization: which landing entries the busy guard covers

The guard: `bend2/src/git/land.bend:412-421` (`ld_busy_branch`, `ld_busy_any`) matches each
line of `git worktree list --porcelain` against the literal line `branch refs/heads/<target>`.
`ld_adv_busy_go` (`:496-499`) turns a match into `FTargetBusy{target}` (`target busy: <target>`,
exit 1). The chain runs only inside `ld_advance` (`:504-511`), which is reached only from
`ld_judged_news` (`:723`), the last stage of the checked pipeline.

### `land` — affected (probe above)

`land` is wired `main.bend:114` → `coordinator/land.bend` `land_player` → `git/land.bend`
`land` (`:1001`) → `land_fast_forward` (`:190`). The fast-forward pipeline is five stages:
resolve the worker ref (`ff_stage1`), `LAlready` probe (`ff_stage2`), read the target tip
(`ff_stage3`), fast-forward check (`ff_stage4`), CAS `git update-ref refs/heads/<target>
<worker> <tip>` (`ff_stage5`, `:171-181`). None of the five stages reads the worktree
listing. The guard lives in the other pipeline, so it cannot fire. The CAS orders
publication against the ref value only; a holder worktree is invisible to it. The comment
at `git/land.bend:48-49` names the fast-forward landing "the coordinator's current entry
point", so the unguarded path is the default one.

### `land-checked` — covered (probe below)

`land-checked` is wired `main.bend:116` → `land_checked_player` → `land_checked`
(`:988`), the six-stage checked pipeline. Its publication stage is `ld_advance`, which
lists worktrees and refuses a held target. Probe `probes/674-review/repro-checked/`,
same shape as §1 (seed `2f11d59`, `main` checked out in the primary worktree, worker
branch `fc` at `02472f6` with `checker.txt`, passing check script `exit 0`):

```
baton2 state.db land-checked checker <repo> main check-pass.sh seed.txt
Preparing worktree (detached HEAD 2f11d59)     # candidate scratch
Preparing worktree (detached HEAD 2f11d59)     # target-tree scratch
target busy: main
exit 1
```

Afterwards `main` still reads `2f11d59` and the holder status is clean; the refusal keeps
the two scratch worktrees for the requester (four registered worktrees total), per
`ld_settle`. The guard fired on the exact listing line `branch refs/heads/main`.

### The reviewed-commit entry — affected by design, source read only

The candidate series on `codex/baton2-semantic-controls-structure-research-20261005`
(`368f9a4b`, `59aead3e`, `7a6e7bee`, `95d5597e`, `65dfb295`, `60887c62`) is not in the
installed 1.1.0 binary; this section is a source read of those commits.

`368f9a4b` rewires both publication sites to one shared entry, `publish_outcome`: one
local `git push --porcelain --receive-pack='git -c receive.denyCurrentBranch=updateInside
-c receive.denyNonFastForwards=true -c core.hooksPath=/dev/null receive-pack'
--force-with-lease=refs/heads/<target>:<basis> <repo> <oid>:refs/heads/<target>`. The
diff at `ld_advance` removes the `worktree list --porcelain` call and the
`ld_adv_busy` invocation entirely (the commit message confirms: "the busy probe chain"
is "kept in place and unreferenced"), and `ff_stage5` calls `publish_outcome` instead of
`update-ref`. So on the reviewed commit the guard does not fire on any entry. The
staleness is addressed by the transport instead: the receiver runs with
`receive.denyCurrentBranch=updateInstead`, so receive-pack updates the checked-out
holder's index and files itself when the push is accepted, and a lease that does not
match the basis is refused by the receiver. `59aead3e` reverts both live sites to their
previous paths (fast-forward `update-ref`, checked busy probe) after the REQUEST CHANGES
review; `7a6e7bee`, `95d5597e`, `65dfb295` and `60887c62` harden the prepared
publication-classification and holder-discovery helpers while keeping them unreferenced
by any live caller.

Why the probe's path did not fire the guard, stated once: the probe called `land`, whose
pipeline (`ff_stage1`–`ff_stage5`) never reaches `ld_advance`; the guard executes only on
the `land_checked` pipeline's publication stage.

## 3. What the candidate series already covers

- `368f9a4b` — the publication design that removes the hazard at both sites by letting the
  receiver write the holder (source-only, unverified per its own message; reverted at the
  live sites by `59aead3e` after REQUEST CHANGES).
- `59aead3e` — the revert plus hardened-but-unwired helpers; both live publication sites
  behave as 1.1.0.
- `7a6e7bee` — publication classification reads only the porcelain flag line, keeps the
  abbreviated old..new range out of identity, and re-reads the named ref as a full object
  before answering; every observation refuses while holder verification and custody do not
  exist.
- `95d5597e` — holder discovery validates the whole listing (block resets on blank lines,
  branch line without a worktree block is malformed, a second target-branch match is
  ambiguous, a listing with no worktree block is ambiguous, only a complete valid listing
  answers `HolderFound`/`HolderNone`); paths are decoded byte by byte so paths with spaces
  survive; quoted paths are malformed.
- `65dfb295` — the listing decoder as a validated state machine: duplicate means more than
  one match, an unrelated branch line is valid and contributes zero matches, the block
  being read and the selected match are separate carriers, found requires a qualified
  match, and the supported grammar is stated.
- `60887c62` — restores the `HolderState`/`HolderRead` declarations, binds discovery to an
  immutable `HolderRequest` (destination, target, exact command) so a retained observation
  cannot be reinterpreted for another target, and keeps a broken command broken through
  `VerdictBroken`.

None of these is wired into a live landing entry, so #674 reproduces on the installed
binary through the default `land` entry, as §1 shows.

## 4. What a fix must answer (review criteria for Phase 2)

1. Every landing entry that can advance `refs/heads/<target>` must leave the holder's
   branch, index and files consistent, or refuse before advancing.
2. Uncommitted changes in the holder worktree must survive an advance wherever they do not
   overlap the landed change.
3. A refusal must name the next native operation and leave the target where it was.
4. The guard's grammar must match the listing it reads (the `branch refs/heads/<target>`
   literal match, qualified against `refs/heads/<target>-other`-style collisions), and a
   listing that cannot name exactly one holder must refuse rather than guess.
5. Laws and fixtures must bind behavior — holder consistency after landing, uncommitted-work
   survival, refusal ordering — not layout or counts.
