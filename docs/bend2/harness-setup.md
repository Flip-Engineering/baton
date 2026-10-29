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

For this project's Orchestra, use `gpt-6.1-sol` for OpenAI implementation and
source-review work. Use `gpt-6-luna` for focused tasks when the account's current
model catalog lists it. Reserve `gpt-6-astra` for Principal and Associate
Conductors. Confirm the selected model through the authenticated client's
`model/list` response. The [Codex model documentation](https://learn.chatgpt.com/docs/models?surface=cli)
describes account and client availability.

Change an existing Player's model with `configure` after its current attempt
ends. Keep its session identity, native conversation, assignment and workspace.
Register an executable that supports the selected model for future turns.

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

OMP binds a configured profile store through `PI_CODING_AGENT_DIR`, the supported
agent directory (default `~/.omp/agent`). The OMP profile store is the agent
directory that holds `agent.db`. Muse binds a configured profile store through
`XDG_CONFIG_HOME`, the parent of `muse/auth.json`. The selected profile
assignment overrides an inherited value. A launch with no selected profile adds
no store binding and inherits the receiver environment. `HOME`, native session
paths and the receiver UID are unchanged. OMP's preflight checks the inherited
`HOME` and the selected `PI_CODING_AGENT_DIR` directory. Muse has no preflight;
its `XDG_CONFIG_HOME` store is checked by Muse at startup. Codex and Claude bind
their configured credential directories, and DSH binds `DSH_HOME`; those
launches are unchanged.

Muse uses its existing authenticated installation. The native adapter requires
`exec --json --prompt-file` and resumes through `--session-id`. Preserve Muse's
conversation storage when reconnecting the recorded native identity.

For Muse implementer work, select `muse-spark-1.3-contributor` at `high` effort.
The native adapter passes `--contributor-mode on` for this exact model. Keep
`muse-wonder-full-1.0` available for conductor work. Muse Code Contributor mode
permits submitted content to be used for model training. Account limits still
apply. The Muse API has separate paid usage pricing. The [Muse Code subscription
documentation](https://dev.meta.ai/docs/muse-code/subscriptions) describes the
mode and training terms; [API pricing](https://dev.meta.ai/docs/pricing-rate-limits)
describes the separate API charges.

## Native controls

Follow [installation](installation.md) for the coordinator and host dependencies.
The following commands require current development source. Dispatch the complete
assignment text under the selected project:

```sh
baton dispatch 'Review the assigned source and report the result.' \
  --project /absolute/path/repository \
  --harness codex --command /absolute/path/codex --model gpt-6-astra --effort high
```

`dispatch` resolves the registered database and configured route. It retains the
complete task input and setup outcome in the database and preserves the selected
conversation's current assignment. `--to SESSION` selects an existing actor.
`--stdin` accepts complete text; `--file PATH` imports an existing UTF-8 file.
Scratchpads contain deliberately authored working notes. Baton does not generate
task-source files. Use the actor context and `task-input-read --current` to read
its latest dispatch input and outcome. Inspect turns and reports to establish
completion.

Each native execution begins its guidance with a generated 128-character random
hexadecimal seed and an instruction to use its abstract qualities when
interpreting the task. The database retains the seed, instruction and complete
guidance alongside the original authored task. Fresh-conversation and profile
retries reuse that execution's seed. Observer recovery reads the retained input.
Codex, OMP, Muse and Claude Code receive the same initialization format.

Use `recruit` for subordinate sessions and retain the returned workspace and
base. Configure a Codex, OMP, Muse or Claude Code session with
`receiver SESSION HARNESS_COMMAND OUTPUT_LOG [CWD]`; the command generates the
receiver endpoint using its recorded model, effort and workspace, preserves
its native identity and records the `CWD` argument as the directory its turns
run in. A session that records no model or working directory is refused, since
that endpoint could start no turn. Send complete task text with
`baton dispatch 'Handle the assigned change.' --to SESSION`.

`dispatch` also launches a recruited Muse or Claude Player through its recorded
route, assignment and saved native identity. Independent dispatches run concurrently; turns within one session
are serialized.

An existing registry at `~/.config/baton/github-apps/series.json`, or the path
selected by `BATON2_GIT_REGISTRY`, applies the recipient's Git identity to each
native receiver or detached turn. The coordinator selects the packaged
`libexec/baton2/git-series.mjs` helper. Node 22.15 or later is required for this
configured identity route. See [series Git identities](git-series-identities.md)
for registry configuration and publication authority.

## DeepSeek Harness

The official DeepSeek Harness CLI is `@deepseek-ai/dsh` version `0.2.1-rc.2`.
Install it once into a directory the service account can read, so a launch
needs no network:

```sh
npm install --prefix /absolute/path/dsh @deepseek-ai/dsh@0.2.1-rc.2
```

Use `/absolute/path/dsh/node_modules/.bin/dsh` as the recorded harness command.

The adapter launches the headless profile:

```sh
DSH_HOME=/absolute/path/DATABASE.dsh-home-SESSION_HEX   dsh --profile headless --patch ATTEMPT/dsh-tools.patch.yml   --patch ATTEMPT/dsh-model.patch.yml --json
```

The task is written to stdin and the positional task argument is omitted. A
recorded `session` frame supplies the native identity, and a later turn resumes
it with `--session-id SESSION`. The launcher flags precede `--json`.

`DEEPSEEK_API_KEY` is read from the launch environment. The adapter never places
it in argv and never writes it to a profile. `DEEPSEEK_BASE_URL` may select a
Messages-compatible endpoint; without it the CLI uses the provider default.

The OMP client catalog records `contextWindow: 1000000` for `deepseek-flash`;
the provider `/models` reports `1,048,576` tokens. Baton sends no context budget
and does not gate work on either value. Record the provider value as the route
fact.

This adapter is the official npm TypeScript harness. It is not the macOS `dsh`
0.1 Python workflow DSL.

The headless session store is `$DSH_HOME/sessions/WORKSPACE/SESSION_ID/`.
Sessions are scoped to the workspace that recorded them. A `--session-id` from a
different workspace is refused; Baton treats that refusal as a lost conversation
and starts a fresh turn that names the workspace state.

Provider usage for a completed step rides the `status` frame whose `phase` is
`step_end`, in its `usage` object. The `--json` stream has no usage on the
`final` frame.

The two patch overlays are independent. `dsh-tools.patch.yml` disables every
other model-facing tool plugin, keeps only `read_image` from `dsh-tool-fs`, and
inserts one persistent shell group. The composed request carries `bash`,
`read_image` and `working_directory`. `dsh-model.patch.yml` restates the
provider and model and sets `reasoningEffort`. Inspect the composed tree with
`--dump-config`; the model row, the tool-fs switches and the inserted shell
rows are visible there.

## Antigravity CLI

Install the Google Antigravity CLI for the account that runs the coordinator.
Google's installer downloads a release for the platform, checks its SHA-512
against the release manifest and copies `agy` to `~/.local/bin`:

```sh
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy --version
```

The installer ends with `agy install`, which edits shell profile files. To
avoid that, download the manifest at
`https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_amd64.json`,
fetch the `url` it names, compare the file with its `sha512`, and copy the
`antigravity` member of the archive to `~/.local/bin/agy`.

Sign in once as the coordinator's account, in a terminal: run `agy`, choose
`Google OAuth`, open the printed URL in a browser on any machine, sign in and
paste the authorization code back. The Antigravity documentation states that
the token is kept in the operating system keyring (Secret Service on Linux). A
headless account needs a keyring that stays unlocked. The alternative route is
`{"modelProvider": "gemini"}` in `~/.gemini/antigravity-cli/settings.json` with
`GEMINI_API_KEY` in the environment; it reaches only Gemini models. After
signing in, `agy models` lists the models the account can use.

Record the route with `--harness antigravity`, `--model MODEL_ID` and the tier word of
that id as `--effort`, for example `claude-sonnet-5-5-high` and `high`. The
[Antigravity CLI adapter](agy-adapter.md) lists the protocol facts and the
unverified items.

## Status and report inspection

A worker's assignment remains open across successful native turns. When its
work is ready, it sends a `completion-request` message to its immediate parent.
The parent reviews the result with `completion-confirmed --to PLAYER`, which ends
the worker's assignment, or with `completion-confirmed --to PLAYER --next TEXT`, which
confirms and dispatches the next assignment in one transaction. The parent sends
`guide --to PLAYER --text TEXT` for remaining work on the open assignment. Baton resolves the current
request addressed to that coordinator. The worker's current request remains
available while the parent reviews it. New
tasks and guidance begin further work. Stored read rows record the worker's
complete read of retained input. Explicit operator stops remain effective.
Parentless Principal Conductors follow their operator input.

Codex, OMP, Muse, DeepSeek Harness, Antigravity CLI and Claude native receivers preserve the
recorded conversation when further input arrives. Native settlement delivers the turn report to the
recorded coordinator, which decides whether further work is needed. The
managed Codex App watcher observes public turn settlement and delivers owed
input through the public turn interface. `continue-task --session PLAYER`
explicitly queues continuation input for an open assignment that has no current
completion request and wakes its recorded receiver. `resume --session PLAYER` retries
delivery of queued input through the same receiver.
`session SESSION` exposes the current assignment, request, coordinator and
confirmation in `taskCompletion`.

The native read commands support `--pretty` and retain complete stored fields:

```sh
baton2 /absolute/path/orchestra.db status --pretty
baton2 /absolute/path/orchestra.db player worker1 --pretty
baton2 /absolute/path/orchestra.db orchestra --pretty
baton2 /absolute/path/orchestra.db inbox principal --pretty
baton2 /absolute/path/orchestra.db turns worker1 --pretty
baton2 /absolute/path/orchestra.db delivery REPORT_ID --pretty
```

`delivery` returns the complete message, read state and recipient endpoint.
`turns` includes native turn history and report bodies. Inspect complete parent
reports, native logs and read records before landing work. Baton records each
complete recipient-owned read when the recipient reads the input; the record
persists when the turn later fails or is interrupted. Git review and landing
have their own results. Capture complete stdout when a harness tool display truncates a long report.

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
