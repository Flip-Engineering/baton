# Service lifetime for keepers, database owners and queue clients (#1368)

## Incident

At about 19:55:41 PDT on 2026-10-29, root orchestration commands, five Claude
conversations and five independent queue supervisors ended during a correlated SSH
session shutdown. The host stayed up. The journal records
`sudo -u batonci kill -TERM -1668023` at 19:55:41.647875 from SSH session
16262, and fourteen Mac-origin SSH connections logged protocol reason 11 about
42 ms later. The initiating controller and any causal link between those
records are unproven. Execution rows kept the phase `running` after the
processes were gone.

The process-group TERM, a session-scope shutdown and an unrelated cause all fit
the observed disappearance. The records added by this change are meant to
separate those cases the next time one occurs. They do not decide the cause of
the 2026-10-29 event.

## Source facts at `1dd115741`

- `bend2/src/host/process-spawn.c` creates keeper process groups with
  `posix_spawn` (`br_spawn`) and native process groups with a gated fork
  (`br_spawn_gated`). Both keep the Linux cgroup of the process that launched
  them.
- `bend2/src/host/posix.c` starts the compile supervisor with `setsid` and keeps
  its wait status.
- The compile queue treats an owner token as live while the requesting client
  process (PID plus start time) lives. `.github/scripts/queue-native-checks.py`
  starts that client as its child and cancels the owner when the adapter
  receives SIGINT, SIGTERM or SIGHUP.

## Service placement

On Linux, a keeper, a database owner and a queue client start under
`systemd-run --user --scope`. systemd-run moves itself into a new transient
scope and then execs the program, so the program keeps its PID, process group,
start time, inherited descriptors, conversation identity, manifest, owner tokens
and logs. The native process and the recovery observer are children of the
keeper and stay in its scope. The scope sets no memory, runtime or task limit.

| Launch | Code | Role in the unit name |
| --- | --- | --- |
| Retained attempt keeper | `br_retain` in `process-spawn.c` | `keeper` |
| Database owner | `br_instance_spawn` in `process-spawn.c` | `owner` |
| Queue client | `.github/scripts/queue-native-checks.py` through `.github/scripts/service-run.py` | `queue-client` |

A caller that starts a queue client directly can use the same helper:

```sh
python3 .github/scripts/service-run.py --role queue-client --record DIR -- \
  baton-compile-queue -- run --token TOKEN --receipt RECEIPT ...
```

Settings, read from the environment of the launching process:

- `BATON_SERVICE_PLACEMENT=auto` (default) places the launch when a throwaway
  scope started by `systemd-run --user --scope -- true` succeeds, and launches
  without a scope otherwise. The launch record keeps the reason.
- `BATON_SERVICE_PLACEMENT=off` launches without a scope.
- `BATON_SERVICE_PLACEMENT=require` refuses the launch when placement is not
  possible (the helper exits 75; the C launcher returns `ENOTSUP`).
- `BATON_SYSTEMD_RUN` names the systemd-run program.

Any other value is refused.

The keeper and owner are re-executed through `/proc/PID/exe` of the launching
process, so the loaded image runs even when its path was replaced after the
launcher started.

### Host requirements

A user scope needs a systemd user manager for the account that runs Baton, with
`XDG_RUNTIME_DIR` pointing at its runtime directory. For a service account
without a login, an administrator enables it with
`loginctl enable-linger ACCOUNT`. The manager then outlives SSH sessions, and
the scopes it holds outlive them too. Stopping the user manager (for example
`systemctl stop user@UID.service`) or an explicit `systemctl --user stop` of a
scope ends the processes in it.

On the homelab account `batonci`, a probe run from a session of that account
reported `Failed to connect to bus: No such file or directory`
because `/run/user/986` does not exist. Until the user manager is enabled, `auto`
launches without a scope and records that reason.

### Limit

Placement changes the cgroup that holds a process. It does not change who may
signal it. Processes of one Unix user are inside that user's signal authority,
and a same-user `kill` reaches a placed keeper, native process or queue client.
Lifecycle actions (stop, signal, recovery, cancellation) continue to address a
process by PID plus birth and by its custody token or owner token. A bare PID
or process-group number is not sufficient authority.

## Evidence

Each record names the process it describes with PID, start time (`birth`),
parent, process group, session, controlling terminal, UID and cgroup.

Retained attempt directory (`ATTEMPT`):

| File | Written by | Content |
| --- | --- | --- |
| `service-launch` | launcher, before the keeper starts | requested mode, `placement=scope` with the unit name, or `placement=none` with the reason; launcher identity |
| `service-keeper` | keeper, at start | keeper identity and cgroup after the scope move; `keeper.scope=1` when the cgroup is a Baton keeper scope |
| `service-native` | keeper, after the native start | native identity and whether it shares the keeper cgroup |
| `signal-requests` | keeper, before it signals the native | one line per owner, observer or control request: time, signal, route, requester PID and birth |
| `keeper-signals` | keeper signal handler | one line per TERM, HUP, INT or QUIT received by the keeper: time, signal, `si_code`, sender PID and UID; the keeper then terminates as before |
| `exit-evidence` | keeper, with the `status` file | wait status decoded as exit code or signal and core flag, count and last signal of the keeper's own signal requests, keeper cgroup |

The database owner has no attempt directory. Its launch record is
`IPC/KEY.log.service` beside the owner log. Queue requests keep
`service/service-launch.json` and `service/service-inside.json` in the request
directory, and `request.json` gains `service_record`. When the adapter receives
SIGINT, SIGTERM or SIGHUP, `request.json` also records `interrupt` with the
signal and the adapter's own identity before it cancels the owner.

### Reading the records

These comparisons separate the cases that were indistinguishable on
2026-10-29. Each one is evidence, and a reader still has to decide.

- Explicit owner cancellation: the keeper's `signal-requests` has a line with a
  requester PID and birth, and `exit-evidence` shows the matching signal.
  A queue request with `interrupt` and `cancel_requested_ns` shows a
  synchronous caller cancelling its own owner.
- Signal from outside Baton: `exit-evidence` shows `exit=signaled` with
  `baton_signal_requests=0`, or `keeper-signals` has a sender PID that is not a
  Baton process. The sender's birth in the line identifies it if it still runs.
- Provider exit: `exit-evidence` shows `exit=exited` or a signal such as
  SIGSEGV without a Baton request or an external sender.
- Caller shutdown or scope teardown: `service-launch` shows the cgroup of the
  launcher (a session scope) and `service-keeper` shows a different cgroup when
  the placement worked. A keeper in the launcher's cgroup that disappears with
  other processes of that scope matches a scope kill. Native and queue-client
  records give the same comparison.
- Runtime loss: no `status` and no `exit-evidence`, and the recorded native
  birth no longer matches a live process. The existing recovery records
  `unknown after keeper loss` for this case.

## Explicit cancellation

The synchronous adapter route still cancels its owner on SIGINT, SIGTERM and
SIGHUP, unchanged. The queue client now runs in its own scope, so a caller that
is killed without a catchable signal (for example SIGKILL, or its session scope
being killed) leaves the client and its owner token alive until the client
finishes. Cancelling that request then uses `queue-native-checks.py cancel` or
the client's `cancel` action with the exact key and token.

## Stale `running` rows (#712)

`executions.phase` and `status` are stored values. They change when a receiver
observes the exit, or when recovery finds the native gone and records
`unknown after keeper loss`. That recovery leaves the assignment open and keeps
pending input available, so a missing PID does not complete an assignment.
Between the process loss and the next receive recovery, `commands.bend` and the
Orchestra status projection show the stored `running` phase. Showing a proven
gone native in that interval needs a host-side custody read in the status path,
which is the scope of #712 and is not part of this change.

## Not covered

- Caller-independent submission with a retained receipt (#1132). The adapter
  still waits for the client. The helper above starts a client that survives its
  caller; a status command that reads the receipt later is not written.
- A user manager is required for placement. Without one, launches behave as
  before and record why.
- `systemctl --user stop`, a user manager restart and a host restart end the
  scopes.
