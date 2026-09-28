# Native receive recovery

## Failure reproduced

Issue [#625](https://github.com/Flip-Engineering/baton/issues/625) concerns a
receive process killed while its native process remains alive. The original
probe at `455d6ea74805932ee980868f644055346d36560d` reproduced the defect in this
workspace. Receive PID 52914 exited with signal 9. Native PID 52922 survived.
A retry started native PID 53645 with `exec resume native-parent` while the
original process was still alive. The probe recorded
`duplicateNativeSession: true`.

The baseline binary SHA-256 was
`8cc2f966f1b33578633ba002ed67563b5a04460b76e7a9e018d6b998ce6d7aa1`.
Its build, process observations and source manifest are retained under
`.scratch/issue625/baseline/` in the repair workspace.

## Attempt ownership

Receive selects the pending inbox cutoff, report ID, native command and prompt
while holding the session lock. A retained-process owner stores the attempt
arguments and starts the native process. It holds a duplicate of the session
lock, writes initial input once, retains stdin for OMP, and records native exit
status. Native stdout writes to a regular file for that attempt. The Bend
observer reads this file and performs the existing session observation,
guidance, terminal parsing and report operations.

An observer connection identifies the process consuming the attempt. When that
connection closes before acknowledgment, the owner starts the recorded recovery
command. The replacement observer attaches to the existing attempt and reads
its output from the beginning. It uses the original report ID and inbox cutoff.
Normal receive retries return `queued` while the session lock is held.

Native exit and completion delivery are separate steps. After native exit, the
observer reconstructs the terminal event and commits completion diagnostics.
It releases the session lock, delivers the parent report and checks for newer
pending input. Parent delivery and continuation can run concurrently. The
retained-process owner remains available until these operations finish and the
observer acknowledges the attempt.

The native transport owns process descriptors, output storage and process exit.
Bend owns inbox selection, native protocol parsing, reports and continuation.
The ordinary `turn` path shares the receive session lock.

## Regression fixes

The first combined receive check exposed two regressions. A missing native
executable ended the receive command before its parent diagnostic was recorded.
The retained start result now distinguishes a verified failure before native
launch from an attached native attempt and an uncertain transport failure.
Verified startup failures use the existing parent-report path.

A failed root turn followed by an explicit retry of the same unacknowledged
input reused its attempt directory. Receive IDs now include a random attempt
identifier. Recovery retains that identifier; a later explicit retry receives a
new one.

A further probe killed the observer after its first OMP native process exited,
while parent delivery and a later native turn remained active. Replaying the
first attempt tried to send current guidance to its closed stdin. A second
probe held the original native process alive after terminal output and stdin
closure, then queued guidance and killed the observer. Recovery reported
`Broken pipe` while replaying the original output.

Guidance now checks whether the retained process has closed its input or exited
before sending pending input. The owner retains input closure across observer
connections. Replay still records accepted guidance receipts and reconstructs
completion. Guidance queued after closure remains pending for the next turn.
The observed shutdown failure is retained under
`.scratch/issue625/terminal-guidance-replay/`.

## Recovery boundary

These checks kill the Bend receive observer while its process owner and native
process survive. The process owner must remain alive to supply native exit status
and restart observation. Loss of that owner while its native process survives
requires separate recovery work and validation. Direct `turn` retains its existing
process lifetime behavior. Recovery after loss of all coordinator and harness
processes is covered by the separate [process-loss record](host-restart-2026-09-28.md).
Host reboot and power-loss durability remain unvalidated.

## Validation commands

```sh
BEND=/path/to/bend sh bend2/scripts/check-native.sh
python3 docs/bend2/examples/probe-supervisor-loss.py --output probe.json
python3 docs/bend2/examples/probe-supervisor-loss.py --harness omp --no-retry
python3 docs/bend2/examples/probe-supervisor-loss.py --terminal-before-loss
```

The controlled probe kills its own Bend receive process. It checks original
native process survival, output written after the kill, the original completion
report, parent notification and receipt, and queued-input continuation using the
same native session. It also checks that terminal output leaves the lock held
until the native process exits. Codex and OMP fixtures run these checks with and
without an explicit retry.

## Controlled result

The repaired probe ran at source
`589ea5cec0a24a0bf0ceee81938a3f171fb0fbba`, which includes upstream
`c79eed0f86175497edb871f49a34070eb39f292f`. Its native binary SHA-256 was
`2f0397100b793a87b180068434526b2f0963c6e8e8258338455fa56876702f30`.

Receive PID 8202 exited with signal 9. Original native PID 8227 and its retained
process owner PID 8223 survived. Both the immediate retry and the retry after
terminal output returned `queued`. The probe recorded
`duplicateNativeSession: false`. Output written by the original native process
after the kill reached the native log. Its original report and the later queued
work report received parent receipts. Both inboxes emptied, and the retained
processes exited after completion acknowledgment.

The pinned observation is `.scratch/issue625/closure-probe.json`. The integrated
`check-native.sh` run passed all 123 Python tests and both Bend Git suites. This
includes all 18 receive test methods with Codex and OMP subcases, completed-attempt
replay with live guidance, guidance after stdin closure, startup diagnostics and
failed-root retry. The probe used the binary from that check. The full output is
`.scratch/issue625/check-native-closure.log`.

All local artifact paths in this record are relative to
`/Users/wahargis/Development/Experiments/baton-bend2-supervisor-loss-625`.

## Real Codex result

The live run used the same source and binary, with `gpt-6-astra` and medium
reasoning. The native CLI reported `Logged in using ChatGPT`. Its launcher
removed `OPENAI_API_KEY` and `CODEX_API_KEY` and set
`forced_login_method="chatgpt"` for every invocation.

The driver killed receive PID 85399 during the first native tool call. Original
Codex PID 85466 survived under process owner PID 85452. The normal retry returned
`queued`. Codex then created and committed a receive usage example in the scratch
clone. Its full final text reached the registered parent endpoint.

The queued follow-up started Codex PID 92107 after PID 85466 exited. It resumed
native session `01a0e8a1-c7b0-7bd1-a8de-2ad6d77456a7`, extended the example and
committed the update. The scratch commits are
`c64a5001fc8deef8800329bfd29fe9807bb28858` and
`89f6a14842411025a5707f023764b5dda5cb7ec4`. Their sole changed file is
`docs/bend2/receive-recovery-example.md`.

Both parent report bodies matched the complete native final messages. Both task
messages and both reports have receipts, both inboxes are empty, and every owned
process exited. The driver measured 93.756 seconds from run initialization to
final verification. This interval excludes the coordinator build and source
clone. It includes model work and coordinator delivery.

The parent endpoint was a local process that recorded and acknowledged full
reports. The run exercised one real Codex conversation across two native
invocations. It performed no branch landing or remote publication.

An earlier attempt selected `gpt-5.4`. The subscription endpoint rejected that
route before fault injection. Both failure diagnostics reached the parent and
all owned processes exited. Its retained evidence is under
`.scratch/issue625/live/run-1/`. The successful run is under
`.scratch/issue625/live/run-4/`. The driver now requires an explicit `--model`.

Reproduce with a currently supported subscription model:

```sh
BEND=/path/to/bend sh bend2/scripts/build-native.sh > build.log 2>&1
python3 bend2/scripts/accept-receive-recovery.py \
  --source "$PWD" --revision 276b62b5baef6e6aae17f60c364957b96a08cf35 \
  --coordinator .scratch/bend2/baton2 --build-log build.log \
  --output /path/to/new-run --model gpt-6-astra --effort medium
```

The [measurement record](measurements/2026-09-28-receive-recovery.json) contains
source and executable hashes, process IDs, report-body hashes and artifact paths.
The full live evidence also records the runtime source manifest, process start
identity, native launch arguments and complete parent receipts. The two native
usage frames remain in that evidence with their original counter values.

## Integration with the process-loss repair

The reproduction command above uses the integrated revision `276b62b5`, based on
upstream `cd2310af`. Its native binary SHA-256 is
`6b7f8f7c0207a92198de12f2bfacbac17398a015155ed8665120d3c9c7691c91`.
The supervisor-loss probe passed again, and the combined native suite passed
124 Python tests and both Bend Git suites. The original real observer-loss run
above remains pinned to its measured revision and binary.

[The additional Codex record](codex-process-loss-2026-09-28.md) validates explicit
direct-turn resumption after complete process loss. It also records a remaining
#626 integration gap: retained receive does not apply the direct-turn fallback
when OMP refuses a missing conversation.
