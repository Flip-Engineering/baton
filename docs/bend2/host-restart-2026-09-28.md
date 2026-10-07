# Process-loss recovery validation, 2026-09-28

## Claim validated

After the coordinator host process and its harness children are killed, a fresh
start recovers every session's worktree and branch and resumes each native
session once. The run kills processes; the host, its filesystem and its storage
keep running, so host reboot and power-loss durability remain unvalidated.

## Method

A real run through the coordinator's own commands: one database, a real Git
repository with a real base commit, one registered worktree and branch per
session, one connected native endpoint per session, one pending message per
session, and one running native turn per session started through `receive`.
The probe then sends `SIGKILL` to every supervisor and every harness child —
the loss of all coordinator and harness processes, with the operating system
and its caches still up — reads the repository and the database again through
fresh processes, and starts one `receive` per session.

Process selection includes every live command naming the probe's unique fixture
directory, including retained process owners and replacement observers. The
probe stops that set before killing it so an owner cannot launch recovery during
fault injection. It records the selected processes and verifies that none remain.
After resumption, it drains fixture turns until every owned process exits before
reading final inboxes and completion rows.

```sh
BEND=/path/to/bend sh bend2/scripts/build-native.sh
python3 docs/bend2/examples/probe-host-restart.py
```

The probe imports `bend2/test/receive.py` and adds one line to its fixture so
the fixture reports its own PID; the receive fixture itself is not edited. Its
JSON goes to stdout, and it exits non-zero when a session's worktree, branch or
single native turn does not come back.

## Readings

The run below used code revision `ba7a11dc`; this record and the probe are
added on top of it.

Before the kill, both sessions had one pending message, one running native turn,
one registered worktree on its own branch at the base commit, and a stored
native identity (`native-lead`, `native-worker`).

After the kill, `ps` found no live supervisor and no live harness child, and
`git worktree list --porcelain` still listed both worktrees with both branch
tips at the base commit.

After the restart, fresh coordinator processes over the same database answered
for each session:

| Reading | Lead | Worker |
| --- | --- | --- |
| `worktree` branch, commit, dirty | `bend2/lead`, base, false | `bend2/worker`, base, false |
| worktree directory present | yes | yes |
| registered in `git worktree list` | yes | yes |
| branch tip unchanged | yes | yes |
| `workers` row kept native, workspace, parent, base | yes | yes |
| `inbox` before the turn | 1 pending message | 1 pending message |

Each session then resumed once: one native turn started on the session's stored
identity, and its prompt carried the message that was pending when the
processes died. A second `receive` invocation while that turn ran answered
`{"status":"queued"}` and started no second native. Each turn completed, the
inbox was empty afterwards, and the turn rows were recorded.

The lead's probe invocation left one further request, which the supervisor ran
as the session's next turn after the first released the session: two sequential
turns on the same native identity. The worker recorded one turn.

## Limits

- Two sessions on one repository. Controlled harness fixtures speak the Codex
  and OMP event shapes; no model turn ran.
- The kill removes every process while the host, its filesystem and its storage
  stay up, so this validates process-loss recovery and not power-loss
  durability. A supervisor that dies while its harness child survives is
  reproduced separately in
  [`native-receive-2026-09-28.md`](native-receive-2026-09-28.md) and is tracked
  as #625.
- No runtime change accompanies this record; `receive`'s session lock is
  unchanged.
