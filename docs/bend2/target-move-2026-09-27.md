# Two workers, one moving target, through the coordinator

The scenarios below record the behavior measured on 2026-09-27. The current
checked landing returns a retry instruction when the target moves and checks
the new candidate on the next invocation. See the
[2026-09-28 correction and regression](checked-landing-2026-09-28.md).

On 2026-09-27 the coordinator's landing was exercised against the failure the
JS runtime records as #596: two workers branch from the same target, the
target moves under the second landing while its gate runs, and the second
landing either lands after its candidate is rebased onto the moved target, or
names the conflict when the rebase cannot apply.

Both workers are real OMP turns through the coordinator (harness `omp`, model
`deepseek/deepseek-flash`, effort `high`), recruited into their own worktrees
of the target repository, each committing its own change and reporting to the
root. The move is staged by the gate's check: it reads the tip its tree was
prepared at, waits until the target branch differs from it, then judges the
tree. The two landings run at once, the one under test started first so its
candidate is prepared against the old tip.

## Scenario 1: the rebase applies

Target `T0` `9ffe63b5575a66e8ce01363c529ead58bacd9989`. `worker w1` on `wa`
commits `45acdab` writing `data/a.txt`; `worker w2` on `wb` commits `4f37578`
writing `data/b.txt`; both were recruited from `T0`.

```sh
baton2 state.db land-checked w2 REPO main check-move-wait.sh data/seed.txt &   # prepared at T0, waits
baton2 state.db land-checked w1 REPO main check-pass-shim.sh data/seed.txt     # lands, moving the target
```

```json
{"status":"landed","target":"main","commit":"e5831aeb89bbb84f3163db0d6539294868d4876f"}
{"status":"landed","target":"main","commit":"1823d05046ae2fc7de2a1adda0674d79f0a84251"}
```

The gate's own check recorded the move under it:
`tree 4f7c5187e0e3fef56da2198fbab9e4d44a1b375e saw the target move from
9ffe63b5… to e5831aeb…`. The target then reads

```
* 1823d05 land wb
* e5831ae land wa
* 9ffe63b seed
```

so the second landing sits directly on the first (its parent is `e5831aeb`,
the first landing's commit), and the landed tree carries both workers'
changes: `data/a.txt` is `alpha`, `data/b.txt` is `beta`.

## Scenario 2: the rebase cannot apply

Target `TA` `1823d05046ae2fc7de2a1adda0674d79f0a84251`. `worker w3` on `wc`
commits `2209c71` and `worker w4` on `wd` commits `25a5d50`, each writing
`three` and `four` into the single line of `data/shared.txt`, both recruited
from `TA`.

```sh
baton2 state.db land-checked w4 REPO main check-move-wait.sh data/seed.txt &   # prepared at TA, waits
baton2 state.db land-checked w3 REPO main check-pass-shim.sh data/seed.txt     # lands, moving the target
```

```json
{"status":"landed","target":"main","commit":"340c82b1efd99c790ff30fca2e09fcfb7d087810"}
{"status":"conflict","files":"data/shared.txt","dir":"…/.scratch/bend2-land-w4-7965139631F2C9BD"}
```

The second landing names the unmerged path and keeps its prepared tree for the
requester. The target stays at the first landing's commit `340c82b1…`, whose
`data/shared.txt` is `three`.

## Scenario 3: the conflicted worker is guided, rebases, and lands

Run the same day as its own sequence, on target `820cad9…`: `worker w3` on
`wc` commits `048d501` and `worker w4` on `wd` commits `4214b51`, each writing
the single line of `data/shared.txt`. `w4`'s landing, started first, conflicts
when `w3`'s landing moves the target:

```json
{"status":"conflict","files":"data/shared.txt","dir":"…/bend2-land-w4-B2CC4394DCB1FBA7"}
```

The target is then `024de4f6…` with `data/shared.txt` `three`. The root guides
the worker through the coordinator's own message store:

```sh
baton2 state.db message g1 root w4 guidance "Your landing onto main conflicted:
  the target moved to 024de4f6… and data/shared.txt now carries another worker's
  line. Rebase your branch onto main, resolve data/shared.txt so its single line
  is: three and four, and commit the rebase."
```

The guidance is a row the worker reads from its own inbox
(`baton2 state.db inbox w4`), and the worker's next turn resumes its native
session (`01a0e135-b640-7000-9212-d091e6124789`). That turn rebases `wd` onto
the moved target, resolves the file, and reports `done w4`; `wd` is then
`38ad70b`, whose parent is the moved target `024de4f6…`, with
`data/shared.txt` reading `three and four` and a clean worktree.

Landing the revised branch answers
`{"status":"landed","target":"main","commit":"2cf7ba1cc9a165d10f30808a837c7c64f2db9000"}`,
and the target reads

```
2cf7ba1 land wd
024de4f land wc
820cad9 seed
```

with `data/shared.txt` `three and four`: both workers' work is on the target
and the conflict is resolved in the landed content. The run is
`.scratch/conflict-resolve-run.sh` with its transcript
`.scratch/conflict-resolve-run.out`; its workers' turns are real OMP turns,
and `bend2/test/land.py` carries the same recovery as a fixture row, where the
test performs the worker's rebase in the working tree.

## Refusals seen on the way

The first attempt of this run refused every landing with `target busy: main`,
because the fixture repository's own worktree held the target branch; the
landing advances a target that no worktree holds. The run detaches that
worktree from the target, as the native cases do.

The run is `.scratch/target-move-run.sh` with its transcript
`.scratch/target-move-run.out` in the Git seat's worktree. Its workers' turns
are real: each turn's native session and its report are in the run's database,
and `bend2/test/land.py` carries the same two-worker sequence as fixture rows,
which need no harness.
