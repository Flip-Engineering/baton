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

## Install a qualified development archive

Use the complete archive from a remote qualification of the selected source
commit and host platform. The [native artifact procedure](native-artifacts.md)
describes packaging and extracted-artifact execution. Retain the downloaded
package and its qualification results.

Extract the archive into an unused version prefix, then select its executable
through the existing command symlink:

```sh
set -eu
BATON2_PACKAGE=/absolute/path/to/qualified/package
BATON2_SOURCE='<qualified-commit>'
BATON2_ARCHIVE="$BATON2_PACKAGE/baton2-development-darwin-arm64-$BATON2_SOURCE.tar.gz"
BATON2_PREFIX="$HOME/.local/share/baton2/releases/development-$BATON2_SOURCE"
BATON2_COMMAND="$HOME/.local/bin/baton2"
mkdir -p "$HOME/.local/share/baton2/releases" "$HOME/.local/bin"
mkdir "$BATON2_PREFIX"
tar -xzpf "$BATON2_ARCHIVE" -C "$BATON2_PREFIX" --strip-components=1
chmod 755 "$BATON2_PREFIX"
ln -s "$BATON2_PREFIX/bin/baton2" "$BATON2_COMMAND.next"
mv -f "$BATON2_COMMAND.next" "$BATON2_COMMAND"
export PATH="$HOME/.local/bin:$PATH"
```

Keep the complete extracted prefix, including `lib/context/modules` and
`libexec/baton2`. The executable resolves its Codex inbox helper, Conductor
adapters and selected context providers there. Keep the earlier prefix available
for receivers and recovery commands that still reference it.

The command symlink selects the executable for subsequent CLI invocations.
The shared database owner and running observers retain their existing processes
and custody. Recorded receiver endpoints retain their executable paths. After
an actor's owned turn completes, register its receiver with the newly selected
CLI and its recorded harness executable and output log:

```sh
baton2 /absolute/path/state.db receiver SESSION /recorded/harness /recorded/output.jsonl
```

Omitting CWD retains the actor's workspace and branch. `receiver` retains its
native conversation, parent, model, effort, pending input and explicit stops;
stopped actors can refresh their receiver while the stop remains recorded.
`resume SESSION --lift-stop` explicitly lifts the stop and continues pending
input through the same conversation. An accepted registration for an unstopped
actor can continue its pending input. Existing observers and
attempt recovery commands finish under their admitted executable.

The [historical installation qualification](native-installation-2026-10-02/README.md)
measured an earlier source build and staged only `bin/baton2`. Its original build
source path was unavailable during use. The
released archive above carries the complete payload. The executable
linked system SQLite and libSystem on the qualified host. Other operating
systems and architectures need their own build and execution qualification.

## Runtime paths and dependencies

Commands use `baton2 DATABASE COMMAND ARGS`. Use an absolute database path and
absolute paths for registered receive endpoints, native harness executables,
workspaces and logs. The shared owner retains the executable that started it.

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
  gpt-6-sol high /absolute/path/repository /absolute/path/principal.jsonl \
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
