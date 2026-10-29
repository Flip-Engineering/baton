# Pending-input candidates and wake

The coordinator derives pending-input candidates from its recorded database.
`stall` reports every candidate with its recorded state. `stall-wake` sends
stalled candidates and exited candidates with claimed wakes and runnable
endpoints through the existing wake driver. Both commands classify from
recorded database state.

## Recorded state

| Field | Source |
|---|---|
| pending count | `messages` rows with `recipient = session` and no recipient-owned row in `message_reads` |
| attempt | `executions.id` and `executions.phase` for the session; both empty when no execution row is recorded |
| endpoint present | `sessions.endpoint`, using the coordinator's `json_valid` / `json_type` / `json_array_length` check |
| stop | a `session_stops` row for the session |
| wake claim | `wake_claims.state` for the session |

The report reads the claim table when the coordinator schema provides it. A
database without that table reports an empty claim state and classifies no
candidate as `claimed`.

The state is derived again on each invocation from the recorded attempt,
endpoint, stop and claim rows.

`executions.session` is the primary key, so the report's left join adds at
most one attempt row. A pending session with no recorded attempt appears once
with an empty attempt id and phase and is classified `blocked`.

## Classification

| State | Recorded evidence |
|---|---|
| `active` | pending input and an attempt whose phase is not `exited` |
| `stalled` | pending input, an `exited` attempt, a present endpoint, no stop and no `claimed` wake claim |
| `blocked` | pending input, an `exited` attempt and no present endpoint, or no execution row |
| `stopped` | a `session_stops` row |
| `claimed` | `wake_claims.state = 'claimed'` |

The stop and claim checks take precedence in the report. A pending candidate
with a live attempt is `active`. The wake command also submits an exited
candidate with a claimed wake and a runnable endpoint to the wake driver, which
checks recorded host custody under the session lock.

## Report

```sh
baton2 DATABASE stall
```

The command prints `{"candidates":[...]}`. Each row contains `id`, `pending`,
`attempt` (`id` and `phase`), `endpointPresent` (0 or 1), `owedMessage`,
`stopped` (0 or 1), `claim` (the recorded state or an empty string), and
`state`.

`attempt.id` and `attempt.phase` are empty strings for a session with no
recorded execution row.

## Wake

```sh
baton2 DATABASE stall-wake
```

The command selects candidates whose state is `stalled`, plus exited candidates
with a claimed wake and a runnable endpoint. It calls `Wake.drive_id` once per
selected candidate with its oldest owed message. `Wake.drive_id`
uses `Receive.wake_due`: it takes the session lock, re-reads the pending count,
observes the claim and host custody, and launches the message through the
delivery path. Its claim and custody checks keep a repeated invocation safe.

## Silent native

A session reports to its coordinator when all of these hold:

| Condition | Source |
|---|---|
| a `claimed` wake | `wake_claims.state` |
| owed input | `messages` rows owed to the session, as in the pending count |
| a live attempt | `executions.phase` is not `exited` and `executions.directory` is set |
| no stop | no `session_stops` row |
| no output for 900 seconds | modification time of `DIRECTORY/stdout`, read with `Files.stat`, against `Clock.millis` |

`silence.bend` holds the check. The report is sent from the session to its
coordinator as a committed report and is delivered through `Delivery.deliver`.
Its text names the session, the attempt, the native pid (read from
`DIRECTORY/native.pid`; the receiver is the native's parent and no receiver pid
is recorded), the last output time in UTC and the owed input count. Its
identity is `ATTEMPT:silent:MTIME:OWED`, so one silence is reported once for
each owed count. A check that finds the row does not commit or deliver again.
After a crash the check derives the same condition and finds the same row.

The check covers two shapes. The native stops writing mid-turn while input is
owed, as in the ten-hour stall of `runtime-1177-live-usage-recovery-20261028`.
The native ends its turn with a `result` event, its stdin is closed, and it
stays alive for background commands while input stays owed, as in
`compiler-queue-970-claude-20261028`. Any write to `stdout`, including
`tool_progress` heartbeats, moves the modification time and ends the silence.

The report does not stop, restart or signal the native. A background command
that a native started keeps running, and the coordinator chooses whether to
wait, nudge, stop or replace the native. Stopping a native cancels the queue
requests its background commands hold.

### When the check runs

- The observer in `turn.bend` runs it for its own session when a commit notice
  wakes it with no output line. Its delivery runs in a forked task.
- `stall-wake` runs it for every session after the stalled candidates are
  driven. Nothing on the host runs `stall-wake` on a schedule.

The observer waits in `br_read_awake_probe` (`bend2/src/host/process-spawn.c`)
with `poll(waits,2,-1)`, which has no timeout. A silent native in a database
that commits nothing gives the observer no wake, so the check does not run
then. A timed wait needs a variant of `ProcessChild.read_awake_span` that takes
a timeout in milliseconds and returns a notice of kind `timeout`; the observer
would run the check on each timeout and each commit notice.

Every query in the check is handled as a result. A failed query ends that
check and not the observer.

## Boundaries

`stall.bend` reads the coordinator database through `Sql.query`. `report` prints
the candidate array. `stall-wake` writes only through `Wake.drive_id`; all process starts go through
that route.

## Production entry and package

The production command entry is `bend2/src/coordinator/main.bend`, installed as
`bin/baton2` with the `bin/baton-full` alias by
`bend2/scripts/package-native.py` and `bend2/scripts/stage-native-install.py`.
The `stall` and `stall-wake` commands are `C.Stall{}` and `C.StallWake{}` in
`bend2/src/coordinator/commands.bend`, dispatched by `main.bend` to
`Stall.report` and `Stall.wake_stalled`.

No separate stall package exists. The qualified focused consumer
`bend2/test/stall-evidence-entry.bend` is a test entry; it is not installed and
is not a deployment artifact. Deployment requires the normal coordinator
artifact and the full Main acceptance. The focused qualification does not
authorize deployment on its own.

## Focused fixtures

`bend2/src/coordinator/stall-laws.bend` pins the query text, the row object, the
nine-field row transport, empty and malformed line handling, and the wake
address for each state.

`bend2/test/stall.py` creates six live coordinator rows and exercises both
commands:

- an active attempt with owed input renders `active` and is not driven;
- an exited attempt with owed input and a present endpoint renders `stalled`
  and is driven;
- an explicit stop renders `stopped` and remains in `session_stops`;
- an exited attempt with no endpoint renders `blocked` and is not driven;
- an exited attempt with an existing `claimed` wake claim renders `claimed`;
  `stall-wake` checks its host custody through `Wake.drive_id`.
- a pending session with no execution row renders `blocked` with an empty
  attempt and is not driven.

`bend2/test/stall-evidence-entry.bend` builds as a standalone consumer. Its
`init`, `report`, `wake` and `parse` modes drive the same commands and handlers
without coordinator Main. The wake driver launches that same executable with
`--dispatch-message DB ID`; the entry handles that mode by calling
`Delivery.deliver`, so the wake path reaches the recorded endpoint.

`bend2/test/stall-evidence-fixture.py` inserts the same six states for the
standalone entry.

`bend2/test/stall-silent.py` runs the silence check on a binary built from
`bend2/test/stall-evidence-entry.bend` (`BATON2_STALL_EVIDENCE`). Its cases
cover a silent native, a native that keeps writing, `tool_progress` heartbeats,
the idle-after-result shape with 14 owed inputs, a repeated check, a changed
owed count, sessions without a claim, with an exited attempt or with a stop,
and a missing output file. The entry also handles `--instance-owner` and
`--instance-shutdown` so that committed reports publish.

## Verification

The three-file port at `3e42c349` passed the focused 16 GiB gate on
`385f1a41`:

| Check | Result |
|---|---|
| `--check-only bend2/src/coordinator/stall.bend` | exit 0, `All terms check` with the three foreign-code definitions named |
| `--check-only bend2/src/coordinator/stall-laws.bend` | exit 0, `All terms check` |
| cgroup | `memory.max = 17179869184`, `memory.swap.max = 0`, `rlimit_as = unlimited` |
| peak memory | 7,324,880,896 bytes; no swap |

Receipts are under
`rowsjson-current-main-20261018/run-root-20261018T051013Z` in the retained
assignment directory. The successor commit adds the two CLI commands and the
live fixtures; its focused check receipts are recorded with that run.

## Current-main port verification

The port targets main `bcfa6785a37088f0e2c42d82d001a31775f944c0`. The compiler
is the guarded Bend 2.0.25 release `2.0.25-27629713-20261018`. Each run executed
inside `/sys/fs/cgroup/system.slice/rewrite-recovery-deepseek-native-20261019.scope`
with `memory.max = 17179869184`, `memory.swap.max = 0`, and an unlimited
`RLIMIT_AS`.

| Check | Result |
|---|---|
| `--check-only bend2/src/coordinator/commands.bend` | exit 0, `All terms check` |
| `--check-only bend2/src/coordinator/stall.bend` | exit 0, `All terms check`, four unsafe or foreign defs |
| `--check-only bend2/src/coordinator/stall-laws.bend` | exit 0, `All terms check` |
| `--check-only bend2/test/stall-evidence-entry.bend` | exit 0, `All terms check`, four unsafe or foreign defs |

## Bounded focused qualification

The never-started candidate was qualified at `11cbe6a4b9` in the root-managed
unit `baton-stall-evidence-11cbe6a4-20261019.service` with
`memory.max = 25769803776`, `memory.swap.max = 0`, unlimited `RLIMIT_AS` and no
build timeout. The receipt is
`/mnt/nvme4tb/retained-root-builds-20261019/baton-stall-evidence-11cbe6a4-20261019/receipt.json`.

| Step | Result |
|---|---|
| check-only | exit 0, 134.25 s, five unsafe or foreign defs |
| build | exit 0, 579.376 s, binary sha256 `302378ff0bb3ede96882e46c772a592565686f1acd3096915d72d309d1b72821`, generated C sha256 `2e8d98f16a3e03ab89e608720ab8a05337ffcb03bb666dee6a8d6cfc68c23a29` (17,081,954 B) |
| init, fixture build, report, check-report | exit 0; six states, `never` blocked |
| wake, marker wait, check-wake | exit 0; only `exited` delivered; `never` not delivered |
| parse | exit 0; both commands selected |

The check-report output includes `CASE report-never: blocked`; the check-wake
output includes `CASE wake-never-claim: missing` and
`CASE wake-other-delivered: no`.

The evidence-entry check does not import `stall-laws.bend`. A separate current
`--check-only bend2/src/coordinator/stall-laws.bend` is pinned in
`stall-laws-check.json` and pending; the source is ready for root review once
that check passes.

The prior `8a9c52f7db` run peaked at 6,467,044 kB. No run used swap.
A law body must be an equality; the claimless query law asserts
`String.contains(Stall.stalled_rows_sql(False{}),"wake_claims") == False{}`.

The following gates need build and runtime capacity:

- build `.scratch/bend2/baton2` and run `python3 -m unittest bend2/test/stall.py`;
- `--check-only bend2/src/coordinator/main.bend` with a full-class admission
  receipt;
- the remote CI checks for the opened PR.
