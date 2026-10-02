# Contributing to Baton2

Develop the native coordinator on `bend2-rewrite`. Read
[AGENTS.md](AGENTS.md) for the code and writing rules, and
[the architecture](docs/bend2/architecture.md) for module responsibilities.
Use a separate owned branch and worktree for each change. Preserve other agents'
source, branches, worktrees, uncommitted work and retained execution evidence.

Baton2 project source is licensed under the [Apache License 2.0](LICENSE).
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

## Laws and checks

The coordinator entry imports `bend2/src/coordinator/laws.bend`. State an
operative invariant over the actual implementation functions and prove it in
that module. A build must verify every imported proof. Add runtime checks for
host effects when the change needs them; compiler proofs and host execution
have distinct boundaries.

Run all three acceptance commands on the exact clean, committed tree:

```sh
BEND=/absolute/path/to/bend sh bend2/scripts/build-native.sh
BEND=/absolute/path/to/bend node bend2/scripts/laws-check.mjs
BEND=/absolute/path/to/bend sh bend2/scripts/check-native.sh
```

`laws-check.mjs` removes individual proofs and mutates operative implementations
in copied source trees. It requires each affected compilation to fail.
`check-native.sh` runs the native tests and host-effect fixtures. Retain the
commands, source revision, toolchain identity, complete outputs and exit statuses
for acceptance. A changed tree requires its own acceptance result.

A selected repository landing uses `land-checked`. The check program runs on
both the target and candidate. A candidate failure that passes on the target
blocks landing. A target movement requires a new checked landing against the
current target. Preserve the Player's committed and uncommitted work during
review and conflict correction.

## Publication

Review the final diff, verify the three exact-tree gates, fetch the current
remote branch and integrate its changes before publishing. Push `bend2-rewrite`
fast-forward only. Verify the actual remote advertisement and distinguish local
checks, source publication, hosted CI, artifact installation and a release.

Native workflow qualification uses the harnesses' existing logins.
[Harness setup](docs/bend2/harness-setup.md) documents the subscription-only Codex
wrapper and the measured OMP and Muse routes. Run owned real-agent workflows
separately from external compilation, tests and benchmarks. Keep failed runs
and missing observations explicit in their evidence.

## Original implementation and historical records

The original JavaScript implementation and prototype are retained in Git
history and the `master` branch. The preserved `evidence/pre-native-only-f85647cc`
source also contains their branch-local tree before removal. Use a separate
checkout at an explicit revision when comparing original Baton with Baton2.
The comparison driver takes `--old-repo` and `--old-ref` and reads that source.
The JS landing adapter reads the target repository's runner and selected tests.

Earlier design and measurement records under `docs/`, `spec/` and `reviews/`
retain their original source paths and revision pins. Read those paths at the
recorded revision. The current design is
[docs/bend2/architecture.md](docs/bend2/architecture.md), the current command
entry is [bend2/README.md](bend2/README.md), and the current qualification status
is [docs/bend2/readiness.md](docs/bend2/readiness.md).
