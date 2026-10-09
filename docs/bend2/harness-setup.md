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

## Subscription profiles

Development `receive` supports an ordered list of Codex and Claude subscription
accounts. Authenticate each account in its own absolute configuration directory.
Keep these directories and their credentials outside the repository.

For Codex, set `cli_auth_credentials_store = "file"` in each directory's
`config.toml`, then sign in and inspect that directory's login:

```sh
env -u OPENAI_API_KEY -u CODEX_API_KEY CODEX_HOME="/absolute/private/codex-primary" \
  /absolute/path/codex -c 'forced_login_method="chatgpt"' login
env -u OPENAI_API_KEY -u CODEX_API_KEY CODEX_HOME="/absolute/private/codex-primary" \
  /absolute/path/codex -c 'forced_login_method="chatgpt"' login status
```

The [official OpenAI authentication documentation](https://learn.chatgpt.com/docs/auth#credential-storage)
describes credential storage, and the [Codex login reference](https://learn.chatgpt.com/docs/developer-commands#codex-login)
describes login and status commands. For Claude, use its native account login:

```sh
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN \
  CLAUDE_CONFIG_DIR="/absolute/private/claude-primary" /absolute/path/claude auth login
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN \
  CLAUDE_CONFIG_DIR="/absolute/private/claude-primary" /absolute/path/claude auth status
```

[Claude configuration directories](https://code.claude.com/docs/en/env-vars)
separate accounts and retained sessions. Its [CLI reference](https://code.claude.com/docs/en/cli-reference#cli-commands)
describes the authentication commands. Profiled Claude launches remove inherited
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` values
before binding the selected account; Claude documents their
[precedence](https://code.claude.com/docs/en/authentication#authentication-precedence).
Repeat the login commands with a separate directory for each account.

Create `DATABASE.profiles` beside the coordinator database. Each line contains
the harness, a unique label for that harness, and the credential directory:

```text
codex primary /absolute/private/codex-primary
codex secondary /absolute/private/codex secondary
claude-code primary /absolute/private/claude-primary
claude-code secondary /absolute/private/claude-secondary
```

The directory is the rest of the line. Write absolute paths directly; a path
containing spaces needs no quotes. The order determines the next account.

`DATABASE.profile-SESSION_HEX` records the selected label and directory, one
selection per line; `SESSION_HEX` is the UTF-8 session ID encoded as lowercase
hex. An initial line can select the account before its first turn. For a session
named `root`, the file is `DATABASE.profile-726f6f74` and its initial line can be
`primary /absolute/private/codex-primary`. A session without a record uses its
existing native login and selects the first listed account after exhaustion.

When the provider reports subscription exhaustion, `receive` records the next
account, preserves the provider's cause, and resumes the same native conversation
with its unfinished work. `DATABASE.history-SESSION_HEX` retains the history
paths prepared for that handoff. Preserve both records with the database and
native conversation files. If every listed account reports exhaustion, the
report retains the last cause and the unfinished work.

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
base. Configure a Codex, OMP, Muse or Claude Code session with
`receiver SESSION HARNESS_COMMAND OUTPUT_LOG [CWD]`; the command generates the
receiver endpoint using its recorded model, effort and workspace, preserves
its native identity and records the `CWD` argument as the directory its turns
run in. A session that records no model or working directory is refused, since
that endpoint could start no turn. Send its task with
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
