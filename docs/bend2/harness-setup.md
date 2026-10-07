# Native harness setup

Baton2 launches an external harness executable for each session. Install and
authenticate the harness under the account that runs the coordinator. Keep its
configuration and conversation storage available across turns.

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
  -c 'forced_login_method="chatgpt"' login status
```

The successful status is `Logged in using ChatGPT`. Current development source
uses that executable directly as `HARNESS_COMMAND`. Its native Codex adapter
removes `OPENAI_API_KEY` and `CODEX_API_KEY` and adds
`forced_login_method="chatgpt"` for new and resumed turns. It uses `exec --json`
and `exec resume SESSION`, with the task on stdin.

### Released 1.0 launch requirement

The immutable Baton2 1.0 archive, source
`ea514a28e080317b223414af9a2327a6b53384e6`, requires this subscription wrapper
at a retained absolute path, substituting the selected native executable:

```sh
#!/bin/sh
unset OPENAI_API_KEY CODEX_API_KEY
exec /absolute/path/to/codex -c 'forced_login_method="chatgpt"' "$@"
```

Make the wrapper executable and use its path as `HARNESS_COMMAND` for every
Codex `turn` and registered `receive` endpoint of that release. Development
source `6a7df0eedd57c7ce9c59cb836a405cc0dc658880` qualified direct native
subscription enforcement with the earlier Python Git helper. That measured
route and the public 1.0 archive retain their original source-specific scope.

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

## Native controls

Follow [installation](installation.md) for the coordinator and host dependencies.
The following commands require current development source. Save the assigned
task in a file and start its Principal:

```sh
baton2 /absolute/path/orchestra.db start principal codex /absolute/path/codex \
  gpt-6-astra high /absolute/path/repository /absolute/path/principal-native.jsonl \
  principal-task-1 /absolute/path/principal-task.md
```

`start` registers the Principal and operator, configures the native receiver and
dispatches the task file. A compatible existing Principal keeps its native
conversation, pending input and repository assignment. The result records a
launched delivery PID. Inspect turns and reports to establish completion.

Use `recruit` for subordinate sessions and retain the returned workspace and
base. Configure a Codex, OMP or Muse session with
`receiver SESSION HARNESS_COMMAND OUTPUT_LOG`; the command generates the
receiver endpoint using its recorded model, effort and workspace and preserves
its native identity. Send its task with
`dispatch-file ID SENDER RECIPIENT task TASK_FILE`.

`dispatch-turn PLAYER TURN_ID HARNESS_COMMAND OUTPUT_LOG TASK_FILE` launches a
recruited Muse or Claude Player using its recorded assignment and saved native
identity. Independent dispatches run concurrently; turns within one session
are serialized.

An existing registry at `~/.config/baton/github-apps/series.json`, or the path
selected by `BATON2_GIT_REGISTRY`, applies the recipient's Git identity to each
native receiver or detached turn. The coordinator selects the packaged
`libexec/baton2/git-series.mjs` helper. Node 22.15 or later is required for this
configured identity route. See [series Git identities](git-series-identities.md)
for registry configuration and publication authority.

## Status and report inspection

The native read commands support `--pretty` and retain complete stored fields:

```sh
baton2 /absolute/path/orchestra.db status --pretty
baton2 /absolute/path/orchestra.db player worker1 --pretty
baton2 /absolute/path/orchestra.db orchestra --pretty
baton2 /absolute/path/orchestra.db inbox principal --pretty
baton2 /absolute/path/orchestra.db turns worker1 --pretty
baton2 /absolute/path/orchestra.db delivery REPORT_ID --pretty
```

`delivery` returns the complete message, receipt and recipient endpoint.
`turns` includes native turn history and report bodies. Inspect complete parent
reports, native logs and acceptance receipts before landing work. `ack` records
message acceptance; Git review and landing have their own results. Capture
complete stdout when a harness tool display truncates a long report.

## Recovery

Retain the database and companion files, native output logs, harness conversation
storage, repository, branches and Player worktrees. Read `session SESSION` and
the pending inbox before continuing a conversation. Active OMP Players accept
native guidance; other harnesses receive further instructions through their next
explicitly started turn.

The [recovery example](receive-recovery-example.md) describes observer loss with
a surviving process owner and native child. The
[recovery qualification](native-recovery-qualification-2026-10-02/README.md)
records explicit process-loss resume and OMP's fresh-conversation fallback.
Controlled keeper-loss tests cover retained output, completion and pending
input; host reboot and power-loss durability require separate qualification.
