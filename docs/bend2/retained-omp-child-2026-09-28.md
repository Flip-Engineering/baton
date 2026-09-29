# Retained OMP child workflow, 2026-09-28

A real OMP worker completed a documentation task and a queued correction through
`recruit`, one registered `receive` endpoint, and `message-file`. Its first Bend
receive observer was killed during a controlled tool call. The original keeper
and native process survived, completed the task, delivered its full report, and
then ran the queued correction in the same native conversation. The original
acceptance completed in **136.065 seconds**. This covers recruitment, native
work, report acceptance and process exits; it excludes clone/copy, build and the
later source-review correction.

The [measurement artifact](measurements/2026-09-28-retained-omp-child.json)
retains source and executable pins, command arguments, task text, native identity,
process ordering, receipts, usage and hashes of the raw evidence. This run used
one worker and a local parent endpoint that recorded message acceptance. Source
review followed that acceptance; root composition and landing are separate work.

## Source and task

| Item | Recorded value |
|---|---|
| Task repository base | `a3cfa0039a86e39e781450d30f7dbcb2564a97a0` |
| Task repository tree | `dcd2d9f04f93698feef8558f0a65d3e7c9854b62` |
| Runtime source | `08ee671b62528888a2facd0d3a8ce2af34e5ef98` |
| Coordinator SHA-256 | `c1fc3aa2c1396989cd79bb214d93cf786aeae22370ad6d1532d363899c82aed4` |
| Compiler | Bend 2.0.25 |
| Requested and observed model | OMP `deepseek/deepseek-flash` |
| Requested effort | `low` |
| OMP executable | `/opt/homebrew/Cellar/omp/17.4.0/bin/omp` |
| Worker and parent IDs | `worker`, `root` |
| Native conversation | `01a0ea8c-3acc-7000-ac0f-61881e909a94` |

The task base has the same `bend2/src` files as the runtime source. The supplied
binary matched its retained build and gate record: 223 law checks, two production
mutation controls, 226 compiles with no failures, 128 Python tests across 11
suites, and two Bend Git suites. This run copied that executable and build log;
it performed no rebuild. Its before and after executable hashes match.

The useful change corrected `docs/bend2/target-architecture.md`. Its explicit
stop and native-interaction claims were recorded in the
[cutover finding](https://github.com/Flip-Engineering/baton/issues/539#issuecomment-5881193208)
before dispatch. The missing session stop/cancel command is tracked in
[#639](https://github.com/Flip-Engineering/baton/issues/639). The queued correction
clarified acceptance versus review and landing, plus the
[synchronous endpoint wait](https://github.com/Flip-Engineering/baton/issues/539#issuecomment-5881233363).
Both tasks required source inspection, one-file commits and `git diff --check`.

## Dispatch and observer loss

The driver cloned the task base into private scratch and recruited a worker
branch and worktree. It followed the retained OMP recipe introduced by
`ed388949`: read the stored session, register a receiver with empty model, effort
and workspace arguments, then start `message-file` in a background process. The
receiver resolved the saved route and workspace. The parent endpoint read each
report from SQLite and acknowledged its complete body.

The worker's first tool command contacted a loopback checkpoint. The driver
identified the native process, its keeper, and the keeper's parent receive
observer. It checked the observer's executable, database, session arguments and
process start before sending SIGKILL to that observer. The checkpoint returned
after the fault injection and queued retry checks; there was no duration-based
pause or agent cutoff.

| Observation | Result |
|---|---|
| Killed receive observer | PID `93588`, kernel wait status `9`, exit `-9` |
| Surviving keeper | PID `93627` |
| Original OMP process | PID `93673`, remained alive after observer loss |
| Normal receive retry during original work | `{"session":"worker","status":"queued"}` |
| Native launches before the retry completed | One |
| Queued correction process | PID `5802`; original native PID absent before launch |
| Native identity after the correction | Same recorded conversation |
| Parent reports from the two tasks | Two, full bodies equal to native terminal text |
| Task and report receipts | All recorded; both inboxes empty |
| Owned processes at acceptance completion | None |

The first tool call ran once. Recovery replayed retained output without sending
the initial task again. The log continued growing after observer loss. A frozen
log prefix preserves the original acceptance's SHA-256 even though the same
registered log later received a source-review turn.

## Source review and final documentation

The original two-task acceptance produced commits `baa94e47` and `1e6259a6`.
Review found an incorrect generalization of `receive` to other harnesses and an
incorrect causal link between approval flags and native question handling. The
reviewer sent a guidance message through the existing worker endpoint.

That message was sent **after** the original acceptance finished. It started a
third receive invocation, PID `79421`, in the same native conversation. OMP
recorded a successful native `steer` receipt in that invocation. This timing does
not establish an interruption of the second turn. The correction completed in
48.582 seconds and produced `1b99b4b2`; its full report also reached the parent.

A separate reviewer commit, `27dab67b321dfdb45e3e451fd11071cb7a20486a`, corrected
an incomplete sentence and made queued continuation and landing-result wording
precise. It preserved the three native commits. The final tree was
`aae80d72b6b6a771472dccfbd4c7cdab8a88f597`, with only
`docs/bend2/target-architecture.md` changed and a clean worker worktree. The
existing candidate-pass and unjudged-target landing policy remained unchanged.
Source checks covered the actual parser, dispatch, receive, guidance, harness
arguments and Git landing outcomes. `git diff --check` passed.

After review, all three full parent reports matched the native terminal text;
both task messages, the guidance message and all reports had receipts. Both
inboxes were empty and no owned processes remained. The persistent OMP
conversation contained 47 unique assistant messages. Its counters reported
77,565 input tokens, 4,105,088 cached input tokens, 28,393 output tokens and
4,211,046 total tokens, with native-reported cost `0.081971628`. Reasoning tokens
are retained separately in the artifact. Usage was summed from unique persisted
message IDs because observer replay repeats some streamed frames.

## Reproduction and scope

The retained scratch driver is an OMP adaptation of
`bend2/scripts/accept-receive-recovery.py`. Its exact path and SHA-256 are in the
artifact. A provider-free preflight exercised the same dispatch and fault
injection before the real run. With that driver, a source checkout whose runtime
files match the pinned executable, and the existing OMP configuration:

```sh
python3 /path/to/accept-retained-omp-child.py \
  --source /path/to/source --revision a3cfa0039a86e39e781450d30f7dbcb2564a97a0 \
  --coordinator /path/to/pinned/baton2 --build-log /path/to/build-native.log \
  --output /path/to/new/private-run \
  --omp /opt/homebrew/Cellar/omp/17.4.0/bin/omp \
  --model deepseek/deepseek-flash --effort low
```

The command starts two real model turns. The later source-review guidance and
reviewer edit are recorded separately and are not replayed by that command.
Credentials and global configuration were unchanged. The run excludes a native
root/lead review hierarchy, checked landing, publication, keeper loss, host
restart, direct-turn recovery and Muse receive. Native question/approval reply
handling and explicit stop/cancel remain outside the implemented command set.
