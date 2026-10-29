# Contributing to Baton

Develop the native coordinator on `main`. Earlier native branch heads are
retained in Git history and annotated archive tags. Read
[AGENTS.md](AGENTS.md) for the code and writing rules, and
[the architecture](docs/bend2/architecture.md) for module responsibilities.
Coordinate changes on the selected integration branch. Preserve other agents'
source, branches, worktrees, uncommitted work and retained execution evidence.
The [Baton todo](docs/bend2/todo.md) links current implementation and
qualification follow-up work to its GitHub issues.

Baton project source is licensed under the [Apache License 2.0](LICENSE).
Preserve [project attribution](NOTICE) and the vendored Bend reference's upstream
license notices in distributions.

## Build dependencies

Install Bend 2.0.25 with its library files, clang, SQLite development headers
and libraries, Python 3, Node and Git. The
[pinned installer](docs/bend2/reference/toolchain/install-2.0.25.sh) installs the
compiler and its libraries. Use a fresh owned `BEND_HOME` when installing a
qualification toolchain. Set `BEND` to the selected compiler's absolute path.
The [installation procedure](docs/bend2/installation.md) describes native output
and runtime dependencies.

## Validation

Run compilation, builds and tests on remote validation runners. Select checks
for the changed commands and host behavior. The native build and test commands
are:

```sh
BEND=/absolute/path/to/bend sh bend2/scripts/build-native.sh
BEND=/absolute/path/to/bend sh bend2/scripts/check-native.sh
BEND=/absolute/path/to/bend sh bend2/scripts/check-entry.sh bend2/test/focused-codex-inbox-entry.bend
```

`check-entry.sh` checks one Bend entry through the repository queue adapter.
`BEND` selects the compiler distribution; the shared queue client and state
come from `queue-entry.sh`. An explicit queue configuration preserves an
intentional historical toolchain selection. Check-only requests use the
`check` kind and retain their exit status and streams without a C artifact.

`check-native.sh` runs the native tests, host-effect fixtures and Node context/UI suites. Retain the
commands, source revision, toolchain identity, complete outputs and actual exit
statuses. Record unfinished checks with their causes and retained execution.

A selected repository landing uses `land-checked`. The check program runs on
both the target and candidate. A candidate failure that passes on the target
blocks landing. A target movement requires a new checked landing against the
current target. Preserve the Player's committed and uncommitted work during
review and conflict correction.

## Publication

Review the final diff and the results for affected behavior. Fetch the current
remote branch and integrate its changes before publishing. Publish `main` with
a fast-forward push. Verify the actual remote advertisement and distinguish local
checks, source publication, hosted CI, artifact installation and a release.

Native workflow qualification uses the harnesses' existing logins.
[Harness setup](docs/bend2/harness-setup.md) documents the subscription-only Codex
native adapter and the measured OMP and Muse routes, with the immutable 1.0
wrapper requirement scoped to that release. Run owned real-agent workflows
separately from external compilation, tests and benchmarks. Keep failed runs
and missing observations explicit in their evidence.

## Original implementation and historical records

The original JavaScript implementation and prototype are retained in Git
history and the `archive/javascript` branch. The preserved `evidence/pre-native-only-f85647cc`
source also contains their branch-local tree before removal. Use a separate
checkout at an explicit revision when comparing the JavaScript and native implementations.
The comparison driver takes `--old-repo` and `--old-ref` and reads that source.
The JS landing adapter reads the target repository's runner and selected tests.

Earlier design and measurement records under `docs/`, `spec/` and `reviews/`
retain their original source paths and revision pins. Read those paths at the
recorded revision. The current design is
[docs/bend2/architecture.md](docs/bend2/architecture.md), the current command
entry is [bend2/README.md](bend2/README.md), and the current qualification status
is [docs/bend2/readiness.md](docs/bend2/readiness.md).
