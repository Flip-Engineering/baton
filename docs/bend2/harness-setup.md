# Native harness setup

Baton2 launches an external harness executable for each session. Install and
authenticate the harness under the account that runs the coordinator. Keep its
configuration and conversation storage available across turns. Use absolute
executable, database, workspace and output-log paths when registering an endpoint.

## Qualified routes

The [native hierarchy qualification](native-qualification-2026-10-02/README.md)
used these routes on macOS 27.0 arm64:

| Role | Harness | Requested model | Effort | Native observation |
| --- | --- | --- | --- | --- |
| Principal Conductor | Codex | `gpt-6-astra` | `low` | Session identity; model absent from its events. |
| Associate Conductor | OMP | `kimi-code/k3` | `high` | `kimi-code/k3` from `get_state`. |
| Player | OMP | `deepseek/deepseek-flash` | `low` | `deepseek/deepseek-flash` from `get_state`. |
| Player | Muse | `muse-spark-1.3-contributor` | `low` | Model from `run.model.configured`. |

The qualification summary pins each launched executable's hash. Those results
apply to the measured executables and protocols. Check a replacement harness
against its required protocol before assigning it live work. The coordinator
also has a Claude Code adapter; this hierarchy did not qualify that route.

## Codex subscription login

Use the existing ChatGPT subscription login. Select the native executable
explicitly and check its login method:

```sh
BATON_CODEX_NATIVE=/absolute/path/to/codex
env -u OPENAI_API_KEY -u CODEX_API_KEY "$BATON_CODEX_NATIVE" \
  -c forced_login_method=chatgpt login status
```

The successful status is `Logged in using ChatGPT`. Create a launch wrapper at
a retained absolute path, substituting the selected native executable:

```sh
#!/bin/sh
unset OPENAI_API_KEY CODEX_API_KEY
exec /absolute/path/to/codex -c forced_login_method=chatgpt "$@"
```

Make the wrapper executable and use its path as `HARNESS_COMMAND` for every
Codex `turn` and registered `receive` endpoint. The
[trial launcher](../../bend2/scripts/trial-start.sh) creates this wrapper and
removes the API-key variables from its launch environment. The native adapter
uses `exec --json` and `exec resume SESSION`, with the task on stdin.

## OMP and Muse

OMP requires an existing provider configuration for the selected `provider/model`
route. Configure its keys through OMP's own configuration. Keep credentials
outside task files, committed documentation and qualification artifacts. Kimi
K3 in the qualified workflow uses OMP's `kimi-code` provider. The native OMP
adapter launches `--mode rpc`, queries `get_state` and retains conversation
files beside the coordinator database.

Muse uses its existing authenticated installation. The native adapter requires
`exec --json --prompt-file` and resumes through `--session-id`. Preserve Muse's
conversation storage when reconnecting the recorded native identity.

The [trial launcher](../../bend2/scripts/trial-start.sh) accepts `BATON_CODEX`,
`BATON_OMP` and `BATON_MUSE` executable overrides. Its defaults resolve the
corresponding commands on PATH. OMP and Codex are required by that launcher;
Muse is required when assigning its route to a Player.

Its arguments are `REPOSITORY BEND2_CHECKOUT DATABASE CHECK_PROGRAM`. Select
`bend2/scripts/check-unittest.sh` for Python or `bend2/scripts/check-node-test.sh`
for an external JS repository with the required typed suite verdict. Each issue
task must name its selected test paths. Set `BEND` to an installed compiler
when selected checks under `bend2/test/` need to build the coordinator in
their checked trees; the launcher resolves it to an absolute executable path
in the emitted shell settings.

## First use and recovery

Follow [installation](installation.md) for the coordinator and host dependencies.
Use [native root delivery](../../bend2/README.md#native-root-delivery) to register
the receiver, then send the assigned task through the public message command.
Use public `recruit` for subordinate sessions and record the returned workspace
and base. Read `session SESSION` for the saved native identity before continuing
the conversation. The registered endpoint must use the subscription wrapper for
a Codex session.

Inspect complete parent reports, native logs and acceptance receipts before
landing work. `ack` records message acceptance; Git review and landing have
their own results. Concurrent workers use separate logical sessions. Active
OMP workers accept native guidance; other harnesses receive further instructions
through their next explicitly started turn.

Retain the database and companion files, native output logs, harness conversation
storage, repository, branches and worker worktrees. The
[recovery example](receive-recovery-example.md) describes observer loss with a
surviving process owner and native child. The
[current recovery qualification](native-recovery-qualification-2026-10-02/README.md)
also records explicit process-loss resume and OMP's fresh-conversation fallback.
Owner loss with a surviving child, host reboot and power-loss durability require
separate qualification. Reconnect existing sessions with their recorded identity
and route; inspect the pending inbox before issuing additional work.
