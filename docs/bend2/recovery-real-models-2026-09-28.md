# Recovery with real model turns, 2026-09-28

## What was asked

Start one OMP DeepSeek session and one Codex gpt-6-astra session on real tasks
that edit files, kill every coordinator and harness process mid-turn, restart,
and show that each session resumes its native conversation once and finishes
its task.

## Run

```sh
BEND=/path/to/bend sh bend2/scripts/build-native.sh
python3 docs/bend2/examples/probe-recovery-real-models.py
```

The probe owns its database and repository under `.scratch/recovery-real-models`
and never touches another deployment's state. It recruits one worktree per
session, starts each real turn with no session argument (a fresh conversation),
waits until the session's native identity is recorded and its harness process is
alive, sends `SIGKILL` to every coordinator and harness process of the run
matched by the database path plus their whole descendant closure, reaps them,
and then runs the same turn again with the identity the session held before the
kill — the way the trial's own second launches name it. The probe keeps each
launch's argv and the harness's own stderr, so the resume value is evidence.

## Result

The first launch ran fresh:

```
omp --mode rpc --model deepseek/deepseek-flash --thinking low --approval-mode yolo \
    --session-dir <scratch>/state.db.sessions
```

It was killed mid-turn with the task unfinished (`journal.txt` did not exist),
two processes were killed (the coordinator and the harness child), and no
process of the run survived.

The restart supplied the identity and the coordinator forwarded it:

```
omp --mode rpc --model deepseek/deepseek-flash --thinking low --approval-mode yolo \
    --session-dir <scratch>/state.db.sessions --resume 01a0e8a6-b00f-7000-b4b0-dee09d6a3517
```

OMP refused it. Its stderr reads:

```
Error: Session "01a0e8a6-b00f-7000-b4b0-dee09d6a3517" not found.
Run `omp --resume` without an argument to pick from recent sessions, or `omp` to start a new one.
```

It exited 1, the coordinator recorded "Worker process ended without a native
result (exit 1)", the session kept the identity it had before the kill, no
terminal event was recorded, and the task did not run.

`<scratch>/state.db.sessions` was empty before the restart and empty after it:
the killed turn persisted no conversation.

The Codex half did not run: `codex login status` answers `Not logged in`, so no
Codex session could start.

## Mechanism

OMP writes a session into the session directory it is given. A kill inside the
turn lands before that write, so the directory holds nothing to resume. The turn
path does pass the identity through (`--resume` in the argv above, and
`omp-worker.bend` falls back to the supplied session id when no session file
matches), so the refusal is OMP's own and the missing data is what causes it.
OMP documents `--resume` as taking an ID prefix, a path, or a picker; it cannot
resolve an identity it never persisted.

## What the readings mean

A mid-turn kill of a real OMP turn loses the conversation. Supplying the
identity, as the trial's launches do, is refused and runs nothing; supplying
nothing starts a new conversation, which finishes the work under a new identity
(measured when this probe passed no session argument). A session whose
conversation was persisted resumes under its identity: the earlier real
acceptance in [`native-receive-2026-09-28.md`](native-receive-2026-09-28.md)
measured OMP workers retaining their identity across two turns.

No runtime change is included here. The probe exits non-zero while either the
resume is refused or the task does not finish, so it is the regression check for
this window.

## Limits

- One OMP session. The Codex half could not run and its state is recorded, not
  repaired.
- The kill lands between the identity being recorded and the turn ending. A turn
  killed after OMP wrote its session file resumes through the same lookup.
- Processes only: the host, its filesystem and its storage keep running, so this
  says nothing about power-loss durability.
