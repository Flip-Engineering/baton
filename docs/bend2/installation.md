# Native installation

The native coordinator is built from `bend2-rewrite`. Baton2 1.0 ships as a
versioned Darwin arm64 archive that carries the complete native payload: the
executable, the packaged Conductor adapters, the Git identity helper, notices,
complete gate logs and the source/build manifest. [Baton2 1.0 scope](release-1.0.md)
states the supported platform and the finite qualifications of the released
workflow. A source build produces a native executable and remains the procedure
for other hosts and architectures. The original npm package and its smoke checks
are retained with the original implementation in Git history.
[Native development artifacts](native-artifacts.md) describe archive packaging,
the extracted smoke procedure and hosted CI.

## Install the released archive

Baton2 1.0 ships for macOS 27 arm64 from immutable source
`ea514a28e080317b223414af9a2327a6b53384e6`. The procedure downloads the archive
and its two sidecar files, verifies the frozen digests, extracts the complete
payload under a version prefix and creates the ordinary `~/.local/bin/baton2`
symlink. It stops when a `baton2` command or the selected prefix already exists.
Review an existing installation before changing it.

Keep the entire archive root: `bin`, `libexec`, `notices`, `logs` and
`manifest.json`. Put mutable databases, logs and native conversation storage
outside the versioned prefix.

```sh
set -eu
BATON2_SOURCE='ea514a28e080317b223414af9a2327a6b53384e6'
BATON2_ARCHIVE_NAME='baton2-1.0.0-darwin-arm64-ea514a28e080317b223414af9a2327a6b53384e6.tar.gz'
BATON2_ARCHIVE_URL='https://api.github.com/repos/Flip-Engineering/baton/releases/assets/607665235'
BATON2_SUMS_URL='https://api.github.com/repos/Flip-Engineering/baton/releases/assets/607665231'
BATON2_SUMS_SHA256='63c318f1130d63a49b29524cb0f575fa193b8d5e3b13620dac2ca767a1203f9f'
BATON2_MANIFEST_URL='https://api.github.com/repos/Flip-Engineering/baton/releases/assets/607665232'
BATON2_MANIFEST_SHA256='328f189d70404cbbb9ea436dbc39946aedc59808546b7c81cde4529a8724ba16'

BATON2_RELEASES="$HOME/.local/share/baton2/releases"
BATON2_PREFIX="$BATON2_RELEASES/1.0.0-$BATON2_SOURCE"
BATON2_COMMAND="$HOME/.local/bin/baton2"
test -z "$(command -v baton2 || true)"
test ! -e "$BATON2_COMMAND"
test ! -L "$BATON2_COMMAND"
test ! -e "$BATON2_PREFIX"
test ! -L "$BATON2_PREFIX"
BATON2_DOWNLOAD="$(mktemp -d "${TMPDIR:-/tmp}/baton2-1.0.0-download.XXXXXX")"
curl --proto '=https' --tlsv1.2 -fsSL -H 'Accept: application/octet-stream' \
  "$BATON2_ARCHIVE_URL" -o "$BATON2_DOWNLOAD/$BATON2_ARCHIVE_NAME"
curl --proto '=https' --tlsv1.2 -fsSL -H 'Accept: application/octet-stream' \
  "$BATON2_SUMS_URL" -o "$BATON2_DOWNLOAD/SHA256SUMS"
curl --proto '=https' --tlsv1.2 -fsSL -H 'Accept: application/octet-stream' \
  "$BATON2_MANIFEST_URL" -o "$BATON2_DOWNLOAD/manifest.json"
printf '%s  %s\n' "$BATON2_SUMS_SHA256" "$BATON2_DOWNLOAD/SHA256SUMS" \
  "$BATON2_MANIFEST_SHA256" "$BATON2_DOWNLOAD/manifest.json" \
  | shasum -a 256 -c -
(
  cd "$BATON2_DOWNLOAD"
  shasum -a 256 -c SHA256SUMS
)
mkdir -p "$BATON2_RELEASES" "$HOME/.local/bin"
mkdir "$BATON2_PREFIX"
tar -xzpf "$BATON2_DOWNLOAD/$BATON2_ARCHIVE_NAME" \
  -C "$BATON2_PREFIX" --strip-components=1
chmod 755 "$BATON2_PREFIX"
cmp "$BATON2_PREFIX/manifest.json" "$BATON2_DOWNLOAD/manifest.json"
ln -s "$BATON2_PREFIX/bin/baton2" "$BATON2_COMMAND"
export PATH="$HOME/.local/bin:$PATH"
BATON2_STATE="$(mktemp -d "$HOME/.local/share/baton2/first-use.XXXXXX")"
baton2 "$BATON2_STATE/state.db" status
```

`SHA256SUMS` carries the archive digest
`af2d69af83d58838f0e66e57daf06cf1194dc940babf518afa1c82f7ded66527`. The
procedure checks the two sidecar files against the frozen digests above and the
archive against the extracted `SHA256SUMS`. `tar -p` preserves the recorded file
modes: `bin/baton2` is mode 755 and `libexec/baton2/git-series.py` is mode 644
and runs under `python3`. The extraction sets the prefix directory to mode 755.
The extracted `manifest.json` must equal the downloaded sidecar. The `PATH`
change applies to this shell.

The asset URLs are the GitHub release asset API endpoints and follow GitHub's
documented
[binary download response](https://docs.github.com/en/rest/releases/assets#get-a-release-asset),
which requires the `Accept: application/octet-stream` request header. Retain the
download directory, the versioned prefix and the fresh state directory. The
first-use `status` command creates its database outside the immutable prefix.

[Harness setup](harness-setup.md) covers the native routes and the released 1.0
subscription wrapper. Retain existing native profiles and credentials at their
configured paths.

## Source build and staging

Build dependencies are an installed Bend 2.0.25 compiler with its library files,
clang, and SQLite development headers and libraries. From the source checkout:

```sh
BEND=/path/to/bend/bin/bend sh bend2/scripts/build-native.sh
```

The entry imports its operative laws. This build verifies their proofs and
creates `.scratch/bend2/baton2`. The [build and check instructions](../../bend2/README.md#build-and-check)
describe the negative controls and native checks used for acceptance.

Stage the executable and current Git identity helper in an unused prefix you own:

```sh
BATON2_PREFIX=/absolute/path/to/unused-prefix
test ! -e "$BATON2_PREFIX"
mkdir -p "$BATON2_PREFIX/bin" "$BATON2_PREFIX/libexec/baton2"
cp .scratch/bend2/baton2 "$BATON2_PREFIX/bin/baton2"
cp bend2/harness/git-series.mjs "$BATON2_PREFIX/libexec/baton2/git-series.mjs"
chmod 755 "$BATON2_PREFIX/bin/baton2"
export PATH="$BATON2_PREFIX/bin:$PATH"
```

The [historical installation qualification](native-installation-2026-10-02/README.md)
measured an earlier source build and staged only `bin/baton2`. Its original build
source path was unavailable during use. The
released archive above carries the complete payload. The executable
linked system SQLite and libSystem on the qualified host. Other operating
systems and architectures need their own build and execution qualification.

## Runtime paths and dependencies

Commands use `baton2 DATABASE COMMAND ARGS`. Use an absolute database path and
absolute paths for registered receive endpoints, native harness executables,
workspaces and logs. The retained owner reexecutes the selected coordinator.

```sh
baton2 /absolute/path/state.db status
```

Git must be available on PATH for repository operations. A checked landing needs
the caller's check program and its dependencies. Each native harness remains an
external installation with its own login, configuration and conversation storage.
Current development source enforces Codex's ChatGPT subscription login in its
native adapter and removes API-key variables. The public 1.0 archive requires the
version-specific subscription wrapper in [harness setup](harness-setup.md).
Kimi K3 runs through OMP's `kimi-code` provider on this host.

## Start a Principal from current development source

The commands below require the development build; the immutable 1.0 archive
retains its original control interface. Save the task in a file and run:

```sh
baton2 /absolute/path/state.db start principal codex /absolute/path/to/codex \
  gpt-6-astra high /absolute/path/repository /absolute/path/principal.jsonl \
  initial-task /absolute/path/task.md
baton2 /absolute/path/state.db status --pretty
baton2 /absolute/path/state.db inbox operator --pretty
```

`start` assigns the Principal Conductor role and creates the parentless `operator`
identity when absent. A compatible existing Principal keeps its native conversation,
pending input and repository assignment. A conflicting assignment is refused.
The launch result names the detached delivery PID; inspect messages, turns and
logs for acceptance and completion.
The native terminal result is recorded in `turns PRINCIPAL --pretty` and sent
to the operator inbox. Acknowledge each reviewed report with `ack`.

Recruit subordinate Players with `recruit`. Configure Codex, OMP, Muse and Claude Code receivers
with `receiver SESSION HARNESS_COMMAND OUTPUT_LOG [CWD]`, then use
`dispatch-file ID SENDER RECIPIENT task TASK_FILE` for independent work.
`dispatch-turn PLAYER TURN_ID HARNESS_COMMAND OUTPUT_LOG TASK_FILE` starts a
Claude Player using its recorded model, effort, workspace and native ID.

An existing model Git registry at `~/.config/baton/github-apps/series.json` is
applied to native receiver and detached turn launches. `BATON2_GIT_REGISTRY`
selects a different registry. This requires the packaged Node Git identity helper
and Node 22.15 or later. Keep the registry and its credentials outside task files.

## Retained state

Retain the database, its companion files, native conversation storage, output
logs, repository and Player worktrees at their recorded paths. Completion and
landing retain the Player's branch and workspace. Reuse the recorded native
identity when continuing its conversation. The [architecture](architecture.md#recovery-and-current-limits)
states the implemented recovery boundaries and the fresh-conversation fallback.
