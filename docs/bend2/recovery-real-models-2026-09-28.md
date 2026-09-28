# Recovery with real model turns, 2026-09-28

## What was asked

Recovery after process loss, shown with real model turns: start an OMP session
on a real task that edits files, kill every coordinator and harness process
mid-turn, restart, and show that the pending input runs to completion.

## Run

```sh
BEND=/path/to/bend sh bend2/scripts/build-native.sh
python3 docs/bend2/examples/probe-recovery-real-models.py
```

The probe owns its database and repository under `.scratch/recovery-real-models`
and never touches another deployment's state. It recruits a worktree, starts a
real turn with no session argument (a fresh conversation), waits until the
session's native identity is recorded and its harness is alive, sends `SIGKILL`
to every coordinator and harness process matched by the database path plus their
whole descendant closure, reaps them, and runs the same turn again with the
identity the session held before the kill. It keeps every harness argv it sees
during the restart and the harness's own stderr.

## What OMP persists, and when

`omp --help` offers no persistence switch beyond `--session-dir` and
`--no-session`. OMP does write its session during the turn: in a run watched
second by second, `<db>.sessions/` gained the session directory and its `.jsonl`
about four seconds in, and the turn finished a few seconds later. A kill after
that write leaves a conversation the next turn resumes; a kill before it leaves
nothing, which is the window this record is about.

## Readings before the repair

The restart supplied the identity, and the coordinator forwarded it:

```
omp --mode rpc --model deepseek/deepseek-flash --thinking low --approval-mode yolo \
    --session-dir <scratch>/state.db.sessions --resume 01a0e8a6-b00f-7000-b4b0-dee09d6a3517
```

OMP refused it — `Error: Session "01a0e8a6-b00f-7000-b4b0-dee09d6a3517" not
found.` — exited 1, and the task did not run. `<db>.sessions/` was empty on both
sides of the kill. That left the session stuck: the pending input waited on a
conversation the host no longer held.

## Repair

`bend2/src/coordinator/turn.bend`, in `supervise`, which the `turn` and
`receive` paths share. When the launch carried a resume value, the run ended
without a terminal event, and the harness's stderr opens with `Error: Session`,
the recorded conversation is gone: the supervisor reports
`<turn id>:recovery`, then launches once more with no session argument, so the
harness starts a fresh conversation. The fresh prompt is the pending input plus
the workspace's current state from `git status --porcelain`, so the work
continues instead of repeating. The fresh turn records its own identity through
the ordinary observation path.

## Readings after the repair

The same run, with the same mid-turn kill:

| Reading | Value |
| --- | --- |
| first harness argv of the restart | `--session-dir … --resume 01a0e8ae-4483-7000-b422-c0f73455cfbc` |
| second harness argv of the restart | `--session-dir …` with no resume value |
| terminal event | `agent_end` |
| `journal.txt` | the three lines the task asks for |
| native identity | `01a0e8ae-4483-…` → `01a0e8ae-4c6e-7000-9f0b-4873109f2714`, recorded |
| recovery row | `ompsession-turn-1:recovery` in the parent's inbox |
| probe exit | 0, no failures |

## Codex

The seats hold no Codex login by design: `codex login status` answers `Not
logged in`, and a real `gpt-6-astra` turn gets 401 from `api.openai.com`. The
probe records that state and claims nothing about the Codex half, which is
queued to the operator's Codex session.

## Limits

- One OMP session. The mid-turn kill is aimed at the window before OMP writes
  its session; a kill after that write resumes the conversation itself, which
  the earlier real acceptance in
  [`native-receive-2026-09-28.md`](native-receive-2026-09-28.md) measured.
- Processes only: the host, its filesystem and its storage keep running, so this
  says nothing about power-loss durability.
- The probe is the regression check: it exits 0 only when the restarted turn
  reaches a terminal event, finishes the task, records an identity, and, when
  the conversation changed, records the recovery row.
