# Native installation

The native coordinator is built from `bend2-rewrite`. The source build and a
staged executable were [qualified on macOS 27.0 arm64](native-installation-2026-10-02/README.md).
The original npm package and its smoke checks are retained with the original
implementation in Git history. [Native development artifacts](native-artifacts.md)
use their own build, law controls, native checks and extracted-use procedure.

## Build and stage

Build dependencies are an installed Bend 2.0.25 compiler with its library files,
clang, and SQLite development headers and libraries. From the source checkout:

```sh
BEND=/path/to/bend/bin/bend sh bend2/scripts/build-native.sh
```

The entry imports its operative laws. This build verifies their proofs and
creates `.scratch/bend2/baton2`. The [build and check instructions](../../bend2/README.md#build-and-check)
describe the negative controls and native checks used for acceptance.

Copy the executable to a prefix you own:

```sh
BATON2_PREFIX="$HOME/.local"
mkdir -p "$BATON2_PREFIX/bin"
cp .scratch/bend2/baton2 "$BATON2_PREFIX/bin/baton2"
chmod 755 "$BATON2_PREFIX/bin/baton2"
export PATH="$BATON2_PREFIX/bin:$PATH"
```

The measured staged prefix contained only `bin/baton2`. Its original build
source path was unavailable during use. The executable linked system SQLite and
libSystem on the qualified host. Other operating systems and architectures need
their own build and execution qualification.

## Runtime paths and dependencies

Commands use `baton2 DATABASE COMMAND ARGS`. Use an absolute database path and
absolute paths for registered receive endpoints, native harness executables,
workspaces and logs. The retained owner reexecutes the selected coordinator.

```sh
baton2 /absolute/path/state.db status
```

Git must be available on PATH for repository operations. A checked landing needs
the caller's check program and its dependencies. Each native harness remains an
external installation with its own dependencies and conversation storage. Codex
uses the ChatGPT subscription login in the qualified workflow; the launch wrapper
forces that login method and removes API-key variables. Kimi K3 runs through
OMP's `kimi-code` provider on this host. The [native turn and receive commands](../../bend2/README.md#native-turns)
describe the explicit harness arguments. [Harness setup](harness-setup.md)
describes the qualified routes and subscription wrapper.

## Retained state

Retain the database, its companion files, native conversation storage, output
logs, repository and Player worktrees at their recorded paths. Completion and landing
retain the Player's branch and workspace. Reuse the recorded native identity
when continuing its conversation. The [architecture](architecture.md#recovery-and-current-limits)
states the implemented recovery boundaries and the fresh-conversation fallback.
