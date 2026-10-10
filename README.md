# Baton2

Baton2 coordinates native coding agents on one host. A Principal Conductor
recruits agents, sends tasks and guidance, receives reports, reviews committed
changes, lands them onto a Git branch and publishes that branch to an explicit
remote. Associate Conductors coordinate delegated teams.

`players` lists agents and their Conductor responsibilities. Ensembles record
team membership and coupling; Sections group an Ensemble's Players by
capability. `orchestra` reads the coordinated system's state. The
[terminology guide](docs/bend2/terminology.md) describes these commands.

The native coordinator is implemented in Bend 2.0.25 and stores coordination
state in SQLite. Native harnesses provide model access and conversation storage
through their existing logins.

## Installation and use

The qualified host is macOS 27.0 arm64. Building requires Bend 2.0.25 with its
library files, clang and SQLite development headers and libraries. Git supplies
repository operations.

```sh
BEND=/absolute/path/to/bend sh bend2/scripts/build-native.sh
.scratch/bend2/baton2 /absolute/path/to/state.db status --pretty
```

Follow [installation](docs/bend2/installation.md) to stage the coordinator and helper and
retain its state, and [harness setup](docs/bend2/harness-setup.md) to configure
native launch paths. The [command guide](bend2/README.md) describes recruitment,
turns, receive endpoints, acknowledgments, knowledge and Git operations.

With the staged development build, save the Principal's task in a file and start
its native subscription Codex session:

```sh
baton2 /absolute/path/state.db start principal codex /absolute/path/codex \
  gpt-6-astra high /absolute/path/repository /absolute/path/principal-native.jsonl \
  principal-task-1 /absolute/path/principal-task.md
baton2 /absolute/path/state.db inbox operator --pretty
```

`start` records the Principal and operator, configures its receiver and starts
detached task delivery. Inspect reports, receipts and turns for completion.
The immutable 1.0 archive retains its version-specific interface and launch
requirements in the installation guide.

## Coordination

Agent sessions record parentage and an explicit route. Conductors send messages
to descendants; subordinate agents send messages to their immediate parent.
Non-operator peers with no ancestor relationship communicate through explicitly
designated tight Ensembles. New Ensembles default to loose coupling.
The [messaging guide](docs/bend2/messaging.md) describes admission and retries.

Reports retain their complete bodies and native acceptance receipts. Registered
receive endpoints deliver committed messages to Conductors. Retained receive
owners preserve a native turn across observer loss and continue queued input.
The [recovery guide](docs/bend2/receive-recovery-example.md) describes the tested
boundary and pending-input behavior.

Agents record evidence-backed knowledge in session scopes. Explicit promotion
notifies the destination owner, who decides further distribution to Ensembles.
[Shared knowledge](docs/bend2/knowledge-context-2026-10-01.md) describes recording,
review, visibility and promotion.

Checked landing prepares a candidate, runs selected checks on the target and
candidate, and advances the target through a compare-and-swap update. Conductors
integrate completed contributions and publish the target branch. After a Player's
owned turn finishes, its Conductor can move the same session to the shared checkout
with `receiver SESSION HARNESS_COMMAND OUTPUT_LOG CWD`, then retire its clean,
inactive task worktree and fully integrated branch. Active checkouts, unfinished
changes, native conversations and explicit stops remain available. The
[architecture](docs/bend2/architecture.md) describes subsystem responsibilities
and recovery limits.

[Contributing](CONTRIBUTING.md) covers source acceptance.
[Readiness](docs/bend2/readiness.md) records qualification and remaining release
requirements. The [1.0 scope](docs/bend2/release-1.0.md) states the supported
workflow and recovery boundaries. Development uses the `bend2-rewrite` branch.

## License

Baton2 project source is licensed under the [Apache License 2.0](LICENSE).
[NOTICE](NOTICE) records project attribution. The [upstream Bend reference](docs/bend2/reference/upstream/LICENSE)
and compiler/runtime retain their separate license notices.
