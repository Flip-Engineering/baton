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

## Completed native with a retained observer

Issue #708 includes an original DS receive process that retained its session
lock and output reader after its keeper disappeared. Its native status file
recorded exit 0, its control socket was absent, and eighteen messages remained
pending while the observer continued using CPU.

`baton2 DATABASE recover-observer SESSION OBSERVER_PID` replaces that selected
observer after the retained native exit status is recorded. The operator supplies
the observed receive PID. The command sends TERM and CONT to that PID and waits
on its process exit notification. An orphan attempt is adopted under its existing
session lock.

For an available keeper, the command requests the selected observer's handoff
through the existing attachment request. The keeper matches the supplied PID to
its connected observer, replaces that socket, and transfers the existing session
guard. Receive retains the successful attachment while restoring the attempt.
An older keeper uses ordinary attachment after the selected observer exits. Its
automatic recovery can attach first; that actual `EBUSY` is returned to the caller.

The observer restores the retained checkpoint, reads remaining output and
publishes the original report with its original inbox cutoff. It uses the
recorded native conversation for pending continuation and honors terminal
session stops. Retained native status, attempt arguments, output and messages
remain available. The existing checkpoint restoration behavior retains an
unusable-checkpoint diagnostic and replays the output when necessary.

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
direct-turn resumption after complete process loss. It also records the #626
integration failure at `276b62b5`: retained receive left input pending when OMP
refused a missing conversation.

## Retained receive fallback

Revision `d8a4454840db7d8d8087c6a6d72254c19a6fc744` composes the repair onto
`d0c06fad840008a7c9b263ba1be2a9a259f32b4d`. Both the original observer and its
recovery command check the refused attempt's stderr and original resume value.
A confirmed refusal enters one SQLite transaction: record a recovery input with
the workspace's Git status, clear the refused identity on that first insertion,
and record `<attempt>:recovery` for the parent. The original task stays pending.

After native exit and this transaction, the observer releases ownership and
invokes ordinary receive. The fresh retained attempt reads both pending inputs
and records its native identity through observation. The old owner remains
available until continuation and parent notice delivery finish. If the observer
dies during the fresh attempt, its owner retains that native process and starts
another observer. Replaying the refused attempt reads the existing recovery
input and preserves the fresh identity. Fresh completion has a new attempt ID.

Each retained attempt has a separate `native.stderr` file. Missing-result parent
diagnostics name that file. This keeps refusal classification tied to the native
process that produced it.

The added receive tests cover worker and root fallback, pending task and workspace
context, fresh identity recording, complete parent receipts, repeated observer
loss during the fresh turn, and an unrelated provider failure after an older
refusal. The workspace checks preserve an existing tracked-file change and append
the final step. All owned fixture processes exit after completion.

## Composed-tree validation

The composed revision above passed `check-native.sh`: 127 Python tests, including
22 receive tests, and both Bend Git suites. Its native executable SHA-256 is
`54c67e34ae4c8c015a8e9dcb79c921637d2bfa7f25f54a88f946245aa327f64f`.
The following probes used this executable after the build:

```sh
python3 docs/bend2/examples/probe-supervisor-loss.py --harness codex \
  --output .scratch/issue625/composed/supervisor-codex.json
python3 docs/bend2/examples/probe-supervisor-loss.py --harness omp \
  --output .scratch/issue625/composed/supervisor-omp.json
python3 docs/bend2/examples/probe-recovery-real-models.py --harness omp \
  --output .scratch/issue625/composed/real-omp
```

Both controlled supervisor-loss probes passed. The immediate retry and the retry
after terminal output returned `queued`; each original native process survived
the observer kill. Output written after that kill and both completed reports
were retained. Parent receipts were recorded, pending input drained, and every
owned process exited. Neither probe started a duplicate native process.

The real OMP run used `deepseek/deepseek-flash` with low thinking. It killed all
three processes in its owned initial turn tree and requested conversation
`01a0e991-d173-7000-a5f8-d901024e7c34`. OMP refused that resume. The fallback
started without `--resume`, recorded
`ompsession-turn-1:recovery`, and completed under fresh identity
`01a0e991-eace-7000-8321-b490d50b2722`. The turn exited 0 with `agent_end`.
Only `journal.txt` changed; it contained exactly the three requested lines in
order. No killed process survived and no owned process remained after completion.
Elapsed time was 22.529 seconds, including probe setup and model work. The binary
hash was unchanged before and after the run.

This real run exercises explicit direct-turn recovery after complete process
loss. Its journal did not exist before the kill. Preservation of existing edits
and observer loss during a fresh retained attempt are covered by the controlled
receive tests described above. The earlier real Codex measurements retain their
original source and executable pins.

The [composed measurement record](measurements/2026-09-28-receive-626-composition.json)
contains process IDs, native launch arguments, source and executable hashes, and
evidence file hashes. Local artifacts are under `.scratch/issue625/composed/`,
including `check-native.log` and `real-omp/evidence.json`.

## Application ownership laws

[receive-laws.bend](../../bend2/src/coordinator/receive-laws.bend) states the receive ownership obligations
under M-8's exclusive-claim clause. For a canonical coordinator database and
session, a surviving keeper retains native ownership until native exit. A busy
receive reports `queued`; recovery attaches to the recorded attempt.

The equations import `coordinator/receive.bend` and `host/session-lock.bend`. The first constrains
`Receive.acquired` for every launch argument and continuation when acquisition
returns no lock. The second constrains `Receive.attach_recorded`: it invokes
`ProcessChild.attach` with the supplied attempt directory and passes the returned
handle to its continuation. `Receive.recover` uses this attachment function and
the existing output observation and pending-input continuation. The third
constrains `SessionLock.acquire_session`: canonicalize the database, acquire the
supplied session under that canonical path, and pass the exact database and lock
result to the continuation. Both receive and direct turns use this helper.

The coordinator entry imports `coordinator/laws.bend`, which imports these
ownership laws. Every entry compile verifies them. `laws-check.py` checks the
entry and the documentation import. Four negative controls mutate the runtime:
execute a continuation while busy, launch a process during recovery, substitute
another session, or bypass database canonicalization. Each entry compile must
fail at its named law with expected and observed terms. The mutation copies retain
the runtime import graph. The native law checker also removes each runtime law's
proof and requires the entry compile to fail.

```sh
python3 docs/bend2/laws-check.py /path/to/bend
node bend2/scripts/laws-check.mjs /path/to/bend
```

The compiler reports the equations' foreign dependencies. Kernel file-lock
exclusivity, descriptor inheritance, native exit status and release ordering are
host obligations covered by the process tests and probes. These application
equations constrain Bend dispatch under that host contract.

Revision `85666255213e39b1e4111af615dd30e35f424e73` passed all 27 law checks,
including both production-source negative controls. The native suite passed
127 Python tests and both Bend Git suites. Both supervisor-loss probes passed
again with native executable SHA-256
`a9f12a8fc78d9aee14197cb6faae96b1b169236e660b7ab06038d822457d9452`.
They retained the original native completion, drained pending input, notified
the parent and exited all owned processes.

The real OMP process-loss probe also passed on this binary in 15.728 seconds.
It requested the recorded identity, handled its refusal with fresh recovery,
and completed the exact three-line journal. The journal was empty before the
restart. The [ownership-law measurement record](measurements/2026-09-28-receive-ownership-laws.json)
contains the compiler diagnostics for both negative controls and the validation
artifact hashes. Local artifacts are under `.scratch/issue625/ownership-laws/`.

## Entry-enforced composition

Source `e037d1dd8401c15f4d6416eb3f0b84413026d65c` is based on
`12c050a8bde15dfe40f87dd698d43e8eabcb75de` of `bend2-rewrite`. Its tree is
`f7b3b81b08f870fc4f8719db8a7af8a574f6ba52`. The coordinator entry imports the
operative laws and the three receive/session ownership laws described above.
The native binary SHA-256 is
`75389905515f464f4cd5d054166408d0d75fc6c2cc4839dc0235287633471a73`.

The composed entry initially rejected the older M-17 statement because retained
attempts supply a separate stderr path. That law now quantifies the actual stderr
argument and checks the parent diagnostic against it. The proof-removal checker
also stops when its baseline entry fails to compile; its isolated failure control
produced one failed baseline row and no per-law results.

Both law checkers passed. `laws-check.py` passed 30 checks, including four
production mutations rejected by entry compilation. `laws-check.mjs` passed its
baseline and all 50 proof-removal controls, including the three ownership laws.
`check-native.sh` built the entry with its laws, then passed 127 Python tests,
including 22 receive tests, and both Bend Git suites.

The reference reproduction used commit `1f88f957761a2b2437e1e7a0cc670ba135315ebe`.
Its tree `f8e382e7776254ef536628c5fcda5730a7d90817` and rebuilt binary SHA-256
`7f301c9fd79555f0a0f6bfa5726d16fef13370d5799d91a696b7058434e3b632`
exactly match bend2-git10's composed-tree measurement.

| Probe | Reference tree | Entry-enforced composition |
| --- | --- | --- |
| Controlled Codex supervisor loss | Passed, 1.925 s | Passed, 2.191 s |
| Controlled OMP supervisor loss | Passed, 2.105 s | Passed, 2.202 s |
| Real OMP process-loss recovery | Passed, 19.385 s | Passed, 18.997 s |
| Retained receive with missing conversation | Exit 1, input pending, 5.356 s | Exit 0, fallback completed, 1.971 s |

These durations describe single validation runs. The composed probes overlapped
other native suite stages. Both final supervisor-loss probes kept retries queued,
retained the original native output and completion, drained pending input and
notified the parent. Each original native process exited before continuation.

The retained-receive probe preserved an existing tracked edit, launched fresh
without `--resume`, supplied the pending task and Git status, recorded the new
identity, and delivered both the recovery notice and completed turn to the parent.
Both inboxes emptied. The same probe on the reference tree reproduced the missing
fallback, with one refused launch and the original task still pending.

The real OMP run used `deepseek/deepseek-flash` with low thinking. It refused
recorded conversation `01a0e9b8-fc19-7000-a5e8-b91705fdb4d0`, recorded
`ompsession-turn-1:recovery`, and finished under fresh conversation
`01a0e9b9-1943-7000-885a-7981f4dbdbf6`. The task produced each of its three
required lines once, in order. Only `journal.txt` changed. That journal was empty
before the kill; the controlled receive probe supplies the existing-edit evidence.
All final probes exited their owned processes, and independent process audits
found no survivors. Source and binary hashes remained unchanged during the runs.

The [entry-law measurement](measurements/2026-09-28-receive-entry-laws.json)
records commands, source and executable hashes, negative-control diagnostics,
native identities, process audits and artifact hashes. Final local artifacts are
under `.scratch/issue625/consolidation/`. The reference artifacts are under
`.scratch/issue625/reference/` in
`/Users/wahargis/Development/Experiments/baton-bend2-f8-reference`.
The earlier real Codex subscription runs retain their original source and binary
pins. This composition's Codex supervisor-loss probe uses a controlled harness.
