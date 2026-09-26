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

The report's receipt remains null. Native root acceptance has not been
observed. The worker branch and checkout are retained for landing through
the new Git module. Worktree creation for this run used Git directly. This
record establishes a real supervised turn and stored report; root wake and
Bend2 Git landing remain required for the complete slice.
