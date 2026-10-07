# Native delivery validation, 2026-09-28

Native `receive` runs Codex and OMP inbox turns through the coordinator's
existing harness supervision. The trial launcher and lead instructions use
this path. The supervisor holds a session file lock while its native process
runs, and checks queued input after releasing ownership. Parent delivery and
the session's next queued turn can proceed concurrently.

## Observed failure

The retained trial report `issue-620-review-data-loss` records duplicate native
processes for the same session. Its process record identifies two OMP processes
running as `issue-620-lead`. A controlled reproduction at runtime revision
`9e00826300a864a0f0cfba385ed461473d281f9e` sent two reports through the earlier
OMP adapter. Both native processes reached a socket barrier with
`--resume shared-native-session`. Both remained alive until the reproduction
released them. Their messages and later receipts remained in SQLite.

The native receiver uses one OS lock per canonical database path and session
ID. An invocation that finds an active native turn returns `queued`. The owner
checks pending input after releasing the lock. Different sessions can run
concurrently. `turn` uses the same lock and delivers its parent report after
the native process exits. SQLite retains the existing sessions, messages and
turns tables.

## Controlled validation

Runtime revision `49ceba9ad0ce32da5312f966dcde0e09946a85f0` passed
`BEND=/path/to/bend sh bend2/scripts/check-native.sh` with Bend 2.0.25 on macOS
ARM64. Both Bend Git suites and all 104 Python tests in 11 files passed.

At that revision, ten receive tests synchronize controlled native processes with sockets. They
exercise same-session serialization, independent sessions, direct `turn`
ownership, queued and self-addressed input, native exit, replay wakeups, parent
delivery failures, joined delivery, failed-start retries, OMP session-file
reuse and quoted paths. The Codex failure case follows an earlier successful
turn in the same appended log; its retained outcome describes the current
failure.

The launcher smoke uses a fresh repository and database with a controlled
Codex executable. Two launcher runs preserve the existing native ID and task
bytes, replay and acknowledge pending input, and retain the subscription
wrapper's login selection. The second launch has an empty inbox and starts no
native turn. API-key variables are absent from the controlled native process.
The launcher and documentation changes are committed at `6c5adc0a`.

The live source review identified a synchronous self-turn deadlock and an OMP
resume failure when `turn` used a database symlink and `receive` used its
canonical path. Controlled tests reproduced both failures. Revision
`8ba4b1cd8c66369db2f42949ca9cdbf1c4ad6b15` makes an overlapping direct turn
return an active-session error and uses the canonical database path for both
commands. A refused turn ID can be retried after the active process exits.
The final full check passed both Bend Git suites and 106 Python tests across
11 files, including the added self-turn and frame-retention regressions.

## Stream processing measurement

The initial real OMP reviews exposed sustained native supervisor CPU use.
Native session files already contained complete final reviews while the
coordinator was still consuming earlier output. A read-only process sample
found most active main-thread samples in Bend string construction and SQL
escaping. The receiver consumed 0.00 measured CPU seconds while its controlled
child was silent for three seconds; streamed frames produced the measured load.

The change classifies each OMP frame once for retention and observation and
constructs escaped SQL strings directly. Frame-retention tests cover malformed
frames, whitespace and key-order variations, escaped keys and embedded-NUL type values.
The retained terminal report is checked as well as frame retention.

Three sequential pairs alternated the order of the original and final
executables. Each cumulative stream contained 1,000 frames and 26,213,540 bytes.
The [measurement artifact](measurements/2026-09-28-native-stream.json) retains
every run, source and binary hashes, host observations and validation-log hash.

| Measurement | Original receiver | Final receiver |
| --- | ---: | ---: |
| Median direct process CPU, cumulative stream | 10.67 s | 3.17 s |
| CPU range, cumulative stream | 10.60–10.89 s | 3.10–3.19 s |
| Median direct process CPU, 308,000-byte stream | 0.73 s | 0.37 s |
| Measured CPU during three seconds of silence | 0.00 s | 0.00 s |

Cumulative-stream CPU decreased by 70.3%. The ten-CPU shared host's one-minute
load average was 85.31 before the paired measurements and 68.49 afterward.
Wall-time medians were 14.96 and 3.79 seconds under that load. Direct process
CPU is the primary comparison. These measurements cover controlled frame
consumption; they exclude model execution and parent review.

To repeat one variant with a retained binary:

```sh
python3 bend2/scripts/measure-omp-stream.py \
  --exe /path/to/baton2 --source-revision COMMIT --label candidate \
  --count 1000 --step 51 --output .scratch/stream-candidate
```

Use a separate output directory for each run. The source-revision argument
records the caller's build association; the script also hashes the executable.

## Real native acceptance

The focused run built revision `3ad294cc7e2f47f815bafa1eb53c9163efd6437f`
in its own clone. Its runtime source is unchanged from `8ba4b1cd`. The generated
executable's SHA-256 begins `5518f42b`, matching the executable used by the final
full check and paired measurements. The [acceptance artifact](measurements/2026-09-28-native-receive.json)
records the compiler, generated C and executable hashes, task text, message
hashes, receipts and process results.

A Codex root used the existing subscription login with requested model
`gpt-6-astra` and effort `low`. Two OMP workers used
`deepseek/deepseek-flash` with requested effort `low`; both observed model IDs
matched that route. Codex events supplied its native identity and no observed
model value.

The workers reviewed the direct-turn and path fixes, stream classification,
SQL escaping and measurement driver. Each then received a follow-up in its
existing native conversation. Four complete reports reached the root and
matched the native terminal text byte for byte. All ten messages received
acknowledgments. Six root starts retained one native ID, and each OMP worker
retained its ID across its two turns. All source checkouts remained unchanged.
The sessions and delivery checks completed in 417.72 seconds after the build.

The root assessed each report against source, qualifying claims about
transaction scope, conversation directories, SQL NULL handling and build
provenance. The source reviews found no demonstrated additional runtime defect
in this focused change. Their receipts establish reviewed messages; the
controlled tests and separate measurements establish execution behavior.

The acceptance extractor was subsequently corrected to support OMP terminal
envelopes with an empty message list by using the preceding complete assistant
message. Five extraction fixtures and a recheck of all four retained real
reports passed at `c3fff9cd`. The runtime binary remained unchanged.

This run exercises delivery and conversation reuse. It does not exercise
landing, publication or host restart. Its tasks differ from the initial broad
review, so their elapsed times provide no paired speed comparison. The initial
review exposed output backlog after native review text had already been saved;
the controlled stream measurements isolate the processing improvement.

After the focused acceptance passed, the initial run was still consuming older
output. Both of its native reviews were complete in their conversation files.
Its database, logs, full review text and process identities were retained, then
its owned receiver and completed OMP process were stopped. Their helpers and
the driver exited. That baseline run is incomplete and its driver exited 1.
The artifact retains the stop record and file hashes. Existing trial and
resident processes were outside this cleanup.

## Measurement and remaining scope

The [coordinator comparison](comparison-2026-09-28.md) measures retained
coordination operations against the old runtime. Its source pin precedes this
delivery change, and it excludes model and parent-delivery time. That run
shows lower measured coordinator memory and storage use for Bend2 and slower
median command times for its process-per-command path.

Claude's interactive channel adapter and the retained earlier Codex and OMP
entry points still require Node. Existing configurations keep those endpoints
until explicitly reconnected. The controlled tests establish process behavior
while the supervisor runs. Recovery after loss of all coordinator and harness
processes is validated separately in
[`host-restart-2026-09-28.md`](host-restart-2026-09-28.md). Host reboot and
power-loss durability remain unvalidated.
The supervisor-loss probe below records a duplicate native
session at its source revision. The [receive recovery record](receive-recovery-2026-09-28.md)
describes the repair and its validation.

## Supervisor loss with a surviving child

At revision `63c4ca4526ef3f62159944b20eb295aff8f46eeb`, a controlled Codex
fixture remains alive after its receive supervisor is killed with SIGKILL.
A second receive invocation starts another fixture with the same recorded
native ID and the same pending message. Both native processes are alive
concurrently. This reproduces a recovery defect in session ownership.

The first observation recorded supervisor PID 29812 exiting with status -9
and native PID 29849 surviving with parent PID 1. Retry supervisor PID 30889
started native PID 30931 with `exec resume native-parent`. Both native PIDs
appeared in one process observation. Message `first` remained pending until
the retry acknowledged it. The retry then recorded one completed turn. The
probe released its original fixture, and all four processes exited. The
committed reproduction script repeated the overlap with native PIDs 39566 and
40439; its supervisors and both native processes also exited after cleanup.

`bend2/src/host/session-lock.c` opens the lock with `O_CLOEXEC`. The supervisor
owns the file descriptor, so its exit releases the lock while the native child
can remain alive. `receive.bend` admits a retry through that released lock and
resumes the stored native ID. The fixture shows process overlap and repeated
input delivery; it does not measure concurrent writes by a real Codex process.

Reproduce with the installed Bend 2.0.25 compiler:

```sh
BEND=/path/to/bend sh bend2/scripts/build-native.sh
python3 docs/bend2/examples/probe-supervisor-loss.py
```

The original probe used a fresh database and controlled harness processes from the
receive test fixture. Its JSON records process IDs, the resumed native ID,
pending input and the completed turn. It requires the current coordinator
binary at `.scratch/bend2/baton2`. The original run's database, native log and
JSON observation are retained at `.scratch/recovery18/supervisor-loss/` in the
architect workspace. The current probe checks recovery; its original reproduction
remains available at revision `455d6ea7`.

A repair must preserve exclusive use of the native session across supervisor
loss and arrange continuation and parent notification for pending work. Keeping
the lock in a surviving child alone would leave queued input without the
supervisor that drains it. Recovery of the child's output and completion also
needs an owner.
