# Terminal session stop validation, 2026-09-28

The #639 implementation stopped one real retained OMP worker after it wrote an
unfinished source review. Its queued correction remained visible and unconsumed.
The parent received the stop report and process diagnostics. The native process,
its observed children, keeper and observer all exited. The run used the shared
keeper controls introduced for #641.

The [measurement artifact](measurements/2026-09-28-session-stop.json) records source
and executable pins, process identities, messages, receipts, usage and raw artifact
hashes. Raw files remain under
`/Users/wahargis/Development/Experiments/baton-bend2-session-stop-639/.scratch/issue639/real-omp-1`.

## Source and route

| Item | Recorded value |
| --- | --- |
| Live source | `e7ecde14255ebcb7ffe66565108cd84cf9e8e78a` |
| Live tree | `864265d60d185d237bc7e83a807144e2b88f67b9` |
| Binary SHA-256 | `7b7c0095fc67a2e51671df8c07f41e855b600eeddef556eb0705a953e66017c0` |
| Compiler | Bend 2.0.25 |
| Harness | OMP 17.4.0 |
| Requested route | `deepseek/deepseek-flash`, effort `low` |
| Native observation | `get_state`: provider `deepseek`, model `deepseek-flash`, thinking level `low` |
| Worker and parent | `worker` and local deterministic receiver `root` |
| Native conversation | `01a0eac8-4871-7000-985b-9d5267e45977` |
| Attempt | `receive:worker:1:5b0ab8bb89938755e4ecab4b10bd8cd3` |

The coordinator's `observedEffort` field was empty; the effort observation above
comes from the retained native frame. The artifact includes a hash for every
`bend2/src` file and the exact build log, driver, wrapper and source audit helper.

## Task and stop sequence

The worker read `stop.bend`, its receive integration and `native-interactions.md`,
then wrote uncommitted `stop-review.md`. It acknowledged `stop-task` with
`accepted-stop-task`. The review covered execution ownership, receipts and
concrete documentation or result discrepancies.

A read-only source audit tool reported its PID, parent, process group and review
hash through local IPC. It then waited for the authorized stop injection. This
explicit milestone established that useful work existed and the native process
had an active tool. The driver queued `stop-correction` before invoking:

```sh
baton2 "$DB" stop worker operator-stop \
  'Preserve the unfinished source review at its audit milestone.'
```

The stop command returned in **56.947 ms**, with status `requested`, requested and
submitted signal 15, and no native status. The original message writer returned
**31.261 seconds after that answer**. Its full interval was **116.000 seconds**,
including source review, the controlled helper wait, stop and parent delivery;
build, clone and recruitment are excluded. These timings describe this lifecycle
acceptance run. The controlled wait prevents a task-throughput interpretation.

| Observed role | PID | Parent PID | Process group |
| --- | ---: | ---: | ---: |
| Receive observer | 40133 | 40070 | 40070 |
| Keeper | 40163 | 40133 | 40070 |
| OMP native | 40168 | 40163 | 40168 |
| Configured SSH child | 46194 | 40168 | 40168 |
| Source audit tool | 73973 | 40168 | 73973 |

The host submitted TERM to the native process group. OMP exited with actual wait
status `exit 143`. Its separately grouped audit tool also exited. That tool exit
establishes OMP cleanup in this run; arbitrary escaped descendants and remote SSH
server processes remain outside this audit. No force request or failure cleanup
was used. All five recorded processes were absent after completion.

## Preserved work and delivery

The 6,430-byte review remained uncommitted with identical SHA-256
`7aa646b8c0cd4e9462cd200e8edc2f14d802e7736ab4262dd4908df806912c19`.
Git status contained only `?? stop-review.md`. The queued correction retained its
original body, null receipt and `executionDisposition: stopped`. Its requested
marker was absent from the review. A subsequent task was refused without being
committed. The native identity stayed unchanged, with one launch and no recovery
input or fallback launch.

OMP emitted no native terminal result. The parent received three reports: the
structured `session-stopped` report, the missing-native-result diagnostic and the
exit-status diagnostic. All three stored bodies matched delivery and had receipt
`Parent retained report`; the parent's inbox was empty. The original message
writer returned 1 for the interrupted native outcome. The acceptance driver
returned 0 after verifying that outcome and retained state.

Fourteen emitted assistant usage records totaled 36,371 input tokens, 12,285
output tokens and 409,728 cache-read tokens: 458,384 total tokens. The separately
reported 8,543 reasoning tokens are included in the native accounting and are not
added again. OMP reported total cost 0.028111668; billing was not independently
verified.

## Focused checks and final result correction

On the live runtime, the focused suites passed: 9 stop, 27 receive, 14 turn and
19 coordinator tests. Stop fixtures covered retained OMP and Codex, a tool child,
explicit force after observer loss, idle stop, direct-turn refusal, stopped-parent
notices, pending native-answer rejection and first-reply schema migration.
Nine stop proof-removal controls and nine implementation mutations passed their
expected rejection checks against the real entry. These equations bind command
and IO construction; process, filesystem and SQLite behavior remains a host
obligation exercised by the fixtures and this live run.

The native review identified the idle stop's displayed default signal and missing
`stoppedInputs` documentation. Final source `5fc3ffb7d3940a96a0cf04a97afc4c913756ad56`
returns a null requested signal for an idle stop and omits it from the session
projection. It documents unacknowledged task, guidance and recovery input counts
and the exact higher-parent notice condition. Native stopping mechanics are
unchanged. That source built successfully, passed all 9 stop tests in 3.746 seconds,
and passed ten proof removals plus the new result-query mutation. The live run
remains pinned to `e7ecde14`; no additional model run was made for this correction.

## Reproduction and scope

The retained local driver is `.scratch/issue639/accept-real-stop.py`. Build the
recorded live source using `BEND=/Users/wahargis/Development/Experiments/bend2-trial/.bend/bin/bend`,
then run from the source worktree with a fresh output path:

```sh
python3 .scratch/issue639/accept-real-stop.py \
  --source "$PWD" --revision e7ecde14255ebcb7ffe66565108cd84cf9e8e78a \
  --exe .scratch/bend2/baton2 --build-log .scratch/issue639/build-law-final.log \
  --output .scratch/issue639/real-omp-new
```

This proof covers one real retained OMP child and a deterministic local parent.
Live Codex stop, native parent review, recursive stopping and Git landing are
outside this run. It made no remote publication or resident/trial changes. Final
composed publication gates are recorded separately by the root integration.
