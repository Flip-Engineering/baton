# Two workers, one moving target, through the coordinator

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
