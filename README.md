# Baton 2.0

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

Save a task in a Markdown file. Choose a model available through your configured
Codex client, then replace `MODEL` and the absolute paths below:

```sh
.scratch/bend2/baton2 /absolute/path/state.db start principal codex /absolute/path/codex \
  MODEL high /absolute/path/repository /absolute/path/principal-native.jsonl \
  task-1 /absolute/path/task.md
.scratch/bend2/baton2 /absolute/path/state.db inbox operator --pretty
```

`start` registers a parentless coordinating agent as `principal` and a separate
`operator` identity, configures the agent's receiver, and dispatches the task to
a native session. Reports route to the operator inbox. Use the
[command guide](bend2/README.md) to inspect turns and receipts, send further
instructions, and manage contributions.

## Documentation

- [Command guide](bend2/README.md): CLI commands and examples.
- [Messaging](docs/bend2/messaging.md): delivery, acknowledgments, and retries.
- [Shared knowledge](docs/bend2/knowledge-context-2026-10-01.md): findings, scopes,
  review, and promotion.
- [Architecture](docs/bend2/architecture.md): coordinator and subsystem design.
- [Terminology](docs/bend2/terminology.md): agent roles and team names.
- [Contributing](CONTRIBUTING.md): development and validation requirements.

## License

Baton source is licensed under the [Apache License 2.0](LICENSE).
[NOTICE](NOTICE) records project attribution. The Bend compiler and runtime retain
their [upstream license](docs/bend2/reference/upstream/LICENSE).
