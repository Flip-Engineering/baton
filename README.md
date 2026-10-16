# Baton

Baton is a command-line tool for coordinating coding agents on one host. A
coordinating agent assigns tasks, receives reports, reviews changes, and integrates
completed work into a Git repository. Agents can coordinate their own teams for
delegated tasks.

Baton works with native Claude Code, Codex, Muse, and OMP sessions. Each client
provides its model access, authentication, and conversation history. Baton records
the session's client, model, workspace, and parent agent in a SQLite database.

## Capabilities

- **Task coordination:** send tasks, guidance, questions, and reports between
  agents. Messages retain their complete bodies and recipient acknowledgments.
- **Agent teams:** recruit agents into Git worktrees and organize teams with
  explicit membership and communication permissions.
- **Branching Ensembles:** start parallel agents from a workspace snapshot,
  evaluate their results, and continue a selected agent's conversation.
- **Git integration:** prepare a candidate, run selected checks on the target and
  candidate, update the target branch, and publish to a specified remote.
- **Shared knowledge:** record findings with evidence, control their visibility,
  and promote them to a coordinating agent or team.
- **Inspection:** read sessions, messages, turns, and repository operations through
  the CLI, MCP tools, and optional Orchestra browser view.

## Build from source

The native coordinator is written in Bend. Building requires Bend 2.0.25 with its
library files, clang, and SQLite development headers and libraries. Repository
operations require Git. The packaged Git helper requires Node.js 22.15 or later;
the Orchestra browser view also runs through Node.js.

```sh
git clone https://github.com/Flip-Engineering/baton.git
cd baton
BEND=/absolute/path/to/bend sh bend2/scripts/build-native.sh
.scratch/bend2/baton2 "$PWD/.scratch/baton.db" status --pretty
```

See the [installation guide](docs/bend2/installation.md) for toolchain setup,
packaged artifacts, and installation. The [harness setup guide](docs/bend2/harness-setup.md)
covers native client configuration.

## Start a task

Choose a model available through your configured Codex client, then start a task
from its complete text, standard input or a UTF-8 file. With the published
release installed, replace `MODEL` and the absolute paths below:

```sh
baton dispatch 'Review the assigned source and report the result.' \
  --project /absolute/path/repository \
  --harness codex --model MODEL --effort high
baton --project /absolute/path/repository as operator inbox
```

`dispatch` stores the complete input and setup outcomes in the project database,
selects a named project route and explicit settings, configures the agent's
receiver, and sends the task to a native session. Its result names the recorded
session, message and input request, with commands to inspect them. Use
`--stdin` for piped input or `--file PATH` for an existing UTF-8 file.
`--to SESSION` adds input to the same recorded assignment automatically.
In the selected actor context, `task-input-read --current` reads its latest
complete dispatch input and setup outcome.
Reports route to the coordinating agent or operator inbox. Use the
[command guide](bend2/README.md) to inspect turns and receipts, send further
instructions, and manage contributions.

Agents read complete owed input with `baton inbox` and carry out the assigned
work. Successful native turns record handling of their consumed input;
`baton acknowledge` records explicit handling. `baton report --text TEXT` sends a
result to the recorded coordinator. A worker uses `baton completion-request --text
SUMMARY` to request review of its completed assignment. A coordinator uses `baton
completion-confirmed --to PLAYER` or `baton guide --to PLAYER --text TEXT` for its
decision. Baton resolves the current project, actor, request and handling receipt.
Named arguments and independent batch clauses also cover receiver controls,
worktrees, knowledge and project settings. The [agent command
guide](docs/bend2/agent-commands.md) describes context selection, optional selected
message reads and each action.

## Documentation

- [Command guide](bend2/README.md): CLI commands and examples.
- [Messaging](docs/bend2/messaging.md): delivery, acknowledgments, and retries.
- [Branching Ensembles](docs/bend2/branching-ensembles.md): workspace snapshots,
  fresh conversations, evaluation, and selection.
- [Shared knowledge](docs/bend2/knowledge-context-2026-10-01.md): findings, scopes,
  review, and promotion.
- [Architecture](docs/bend2/architecture.md): coordinator and subsystem design.
- [Terminology](docs/bend2/terminology.md): agent roles and team names.
- [Contributing](CONTRIBUTING.md): development and validation requirements.

## License

Baton source is licensed under the [Apache License 2.0](LICENSE).
[NOTICE](NOTICE) records project attribution. The Bend compiler and runtime retain
their [upstream license](docs/bend2/reference/upstream/LICENSE).
