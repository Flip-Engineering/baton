# First subscription worker through the Bend2 supervisor

On 2026-09-26, the coordinator launched OMP 17.4.0 with the operator's
HOME-relative subscription configuration. The launch wrapper set
`HOME=/Users/wahargis` and executed `/opt/homebrew/bin/omp`. No credential
contents were read or copied. OMP ran with `--print --mode json`, model
`zai/glm-5.3-flash`, thinking `high`, and approval mode `yolo`.

The worker added `ask` and `ask-file` to the coordinator, with parent routing,
matching-retry behavior, full file/stdin question bodies, two behavioral tests,
and a README update. Its branch is `baton/bend2-live-ask`, starting at
`3bcfd59b541b1670264e659274932eff62102088`. Its commit is
`ed87de64afe4b9a3a7b7e6db7bc1f42a23d67555`. The worker ran
`BEND=<installed compiler> sh bend2/scripts/check-native.sh`: both native
builds succeeded and 25 tests passed on that branch. Review of its diff
confirmed that its four changed files implement the requested commands.

The supervisor registered `ask-worker` under `root`, sent its task, drained
native output, and exited 0 after OMP exited. Native session:
`01a0db93-eed9-7000-98e7-71ec13f7a7ea`. Assistant events identified provider
`zai` and model `glm-5.3-flash`. The terminal `agent_end` produced report
`ask-turn-1`, sender `ask-worker`, recipient `root`. Comparing the final
assistant text to the stored report found exact equality. The native event is
also retained in the `turns` table.

The retained evidence is under `.scratch/bend2/live-omp/` in the architect's
worktree: `state.db`, `turn.jsonl`, `turn.jsonl.stderr`, `supervisor.out`,
`task.txt`, and `worker/`. The stderr file was empty. The transcript SHA256 is
`1d356b35043d6d5bd516f717cd5c95befb59c8687e88ab0467b5e2f827eba958`.

The live run used the first OMP adapter build. The committed supervisor at
`0fe82b72f518dab31977df1f146cdfaf269ecd47` also records the provider prefix,
keeps a stable session directory across output-log changes, and refuses a
turn ID already assigned to another worker. Its native check command passed
25 tests. The identity regression first reproduced the wrong-worker replay
before the fix.

The report's receipt was null when this run ended, and native root acceptance
was not observed by it. The worker branch and checkout are retained.
Worktree creation for this run used Git directly. This record establishes a
real supervised turn and stored report.

## Landing and publishing the retained branch

On 2026-09-27 the coordinator landed and published the retained branch
end to end. The worker above was registered from this record (harness `omp`,
model `zai/glm-5.3-flash`, workspace its retained checkout, branch
`baton/bend2-live-ask`, base `3bcfd59b`), and

```sh
baton2 state.db land-checked ask-worker REPO landed-target CHECK bend2/test/coordinator.py
baton2 state.db push REPO landed-target e2e-remote
```

landed the branch and published it. `land-checked` answered
`{"status":"landed","target":"landed-target","commit":"28cb9c6b…"}`, and the
landed target's tree is identical to the worker branch's tree: the gated
squash carried the worker's whole change. `push` answered
`{"status":"pushed","branch":"landed-target","remote":"e2e-remote"}`, and
`git ls-remote` read the remote's advertised `refs/heads/landed-target` back
at the landed commit. A remote moved independently makes the next `push`
answer `{"status":"rejected","reason":"… non-fast-forward …"}` while the
remote keeps the commit that moved it.

CHECK is the Git lane's `bend2/scripts/check-unittest.sh`, passed by absolute
path: the worker's tree predates that script, which arrived in `2daa03bb`.
The landing commits its squash at run time, so a re-run of the same branch
makes a different commit id.

The run is `.scratch/e2e-land-publish.sh` with its transcript
`.scratch/e2e-land-publish.out` in the Git seat's worktree; the target repo is
a scratch clone and the declared remote is a scratch bare repository, so the
run publishes to no network remote.
