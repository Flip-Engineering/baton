# Native installation

Baton is developed on `main`. The Darwin arm64 archive contains the native
executable, packaged Conductor adapters, Git identity helper, Bend2 REPL compiler
and Bun runtime, selected context providers, notices and source/build manifest. Build logs are retained in the
package output directory. Hosted CI also retains the smoke logs.
The [historical 1.0 scope](release-1.0.md)
records the supported platform and qualifications of that archive.
A source installation stages the compiled executable and its required runtime
payload for other hosts and architectures. The original npm package and its smoke checks
are retained with the original implementation in Git history.
[Native development artifacts](native-artifacts.md) describe archive packaging,
the extracted smoke procedure and hosted CI.

## Install or update a published release

Select the published version and download its complete Darwin arm64 payload.
The procedure uses an unused prefix and retains the downloaded evidence:

```sh
set -eu
BATON2_VERSION=2.0.0
BATON2_DOWNLOAD="$(mktemp -d "${TMPDIR:-/tmp}/baton2-release-download.XXXXXX")"
gh release download "baton2-v$BATON2_VERSION" --repo Flip-Engineering/baton \
  --pattern '*.tar.gz' --pattern manifest.json --pattern SHA256SUMS \
  --dir "$BATON2_DOWNLOAD"
BATON2_SOURCE="$(python3 - "$BATON2_DOWNLOAD/manifest.json" "$BATON2_VERSION" <<'PY'
import json, re, sys
manifest = json.load(open(sys.argv[1]))
assert manifest['kind'] == 'release' and manifest['version'] == sys.argv[2]
assert manifest['platform']['artifact'] == 'darwin-arm64'
assert re.fullmatch(r'[0-9a-f]{40}', manifest['source']['commit'])
print(manifest['source']['commit'])
PY
)"
BATON2_ARCHIVE_NAME="baton2-$BATON2_VERSION-darwin-arm64-$BATON2_SOURCE.tar.gz"
(
  cd "$BATON2_DOWNLOAD"
  shasum -a 256 -c SHA256SUMS
)
BATON2_PREFIX="$HOME/.local/share/baton2/releases/$BATON2_VERSION-$BATON2_SOURCE"
BATON2_COMMAND="$HOME/.local/bin/baton2"
BATON_COMMAND="$HOME/.local/bin/baton"
mkdir -p "$HOME/.local/share/baton2/releases" "$HOME/.local/bin"
mkdir "$BATON2_PREFIX"
tar -xzpf "$BATON2_DOWNLOAD/$BATON2_ARCHIVE_NAME" -C "$BATON2_PREFIX" --strip-components=1
chmod 755 "$BATON2_PREFIX"
cmp "$BATON2_PREFIX/manifest.json" "$BATON2_DOWNLOAD/manifest.json"
python3 - "$BATON2_PREFIX" <<'PY'
import hashlib, json, pathlib, sys
prefix = pathlib.Path(sys.argv[1])
manifest = json.loads((prefix / 'manifest.json').read_text())
assert hashlib.sha256((prefix / 'bin/baton2').read_bytes()).hexdigest() == manifest['binary']['sha256']
assert manifest['binary']['alias'] == 'bin/baton'
assert (prefix / 'bin/baton').read_bytes() == (prefix / 'bin/baton2').read_bytes()
PY
python3 "$BATON2_PREFIX/libexec/baton2/check-install.py" \
  --output "$BATON2_DOWNLOAD/installation-check"
ln -s "$BATON2_PREFIX/bin/baton2" "$BATON2_COMMAND.next"
mv -f "$BATON2_COMMAND.next" "$BATON2_COMMAND"
ln -s "$BATON2_PREFIX/bin/baton" "$BATON_COMMAND.next"
mv -f "$BATON_COMMAND.next" "$BATON_COMMAND"
export PATH="$HOME/.local/bin:$PATH"
```

The selected tag and manifest identify the release source. Verify that source
against the published tag and retained qualification. Keep the complete prefix,
including selected modules and generated-C provenance, and retain earlier
prefixes used by running receivers. Subsequent CLI commands use the selected
executable. Existing owners, observers and recorded receivers keep their
admitted executable paths and state.

`baton` and `baton2` select the same native coordinator. The short agent commands
resolve the registered project database and the active native session. `baton
help` describes named arguments and batch clauses; explicit project and session
arguments select another recorded context.

Verify ordinary read commands against the existing database. After each actor's
owned turn completes, refresh its receiver using the procedure below. Preserve
the recorded native identity, parent, workspace, pending input, receipts and
explicit stops. Record any process that continues to use an earlier prefix;
selecting the command symlink does not reload that process.

The preactivation check verifies the required REPL files and recorded hashes.
It also compiles and runs a SQLite probe using Apple Command Line Tools and the
macOS SDK. If those prerequisites are absent, install them with
`xcode-select --install`, select a valid macOS SDK and repeat the check before
changing command symlinks. The complete [REPL compiler payload](repl.md#bundled-compiler)
is part of the standard installation.

## Install the historical 1.0 archive

The archive published as `baton2-v1.0.0` targets macOS 27 arm64 from immutable source
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
(
  cd "$BATON2_PACKAGE"
  shasum -a 256 -c SHA256SUMS
)
mkdir -p "$HOME/.local/share/baton2/releases" "$HOME/.local/bin"
mkdir "$BATON2_PREFIX"
tar -xzpf "$BATON2_ARCHIVE" -C "$BATON2_PREFIX" --strip-components=1
chmod 755 "$BATON2_PREFIX"
cmp "$BATON2_PREFIX/manifest.json" "$BATON2_PACKAGE/manifest.json"
python3 "$BATON2_PREFIX/libexec/baton2/check-install.py" \
  --output "$BATON2_PACKAGE/installation-check"
ln -s "$BATON2_PREFIX/bin/baton2" "$BATON2_COMMAND.next"
mv -f "$BATON2_COMMAND.next" "$BATON2_COMMAND"
export PATH="$HOME/.local/bin:$PATH"
```

Keep the complete extracted prefix, including `lib/context/modules` and
`libexec/baton2`. The executable resolves its Conductor adapters and selected
context providers there. The compiled coordinator manages Codex inbox delivery
through the native proxy transport. Keep the earlier prefix available
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

## Install a source build

Run the native build on the qualified host with the recorded Bend compiler.
Then stage its installation prefix with the exact platform Bun runtime and its
verified SHA256 and complete distribution notices. The checked-in compiler
source under `bend2/compiler/upstream` is required and verified against its lock.

```sh
set -eu
sh bend2/scripts/build-native.sh
BATON2_PREFIX=/absolute/path/to/new/native-prefix
BATON2_REPL_RUNTIME=/absolute/path/to/verified/platform/bun
BATON2_REPL_RUNTIME_SHA256='<verified-platform-runtime-sha256>'
BATON2_REPL_NOTICES=/absolute/path/to/complete/Bun-NOTICES
python3 bend2/scripts/stage-native-install.py \
  --binary .scratch/bend2/baton2 --prefix "$BATON2_PREFIX" \
  --repl-runtime "$BATON2_REPL_RUNTIME" \
  --repl-runtime-sha256 "$BATON2_REPL_RUNTIME_SHA256" \
  --repl-runtime-notices "$BATON2_REPL_NOTICES"
python3 "$BATON2_PREFIX/libexec/baton2/check-install.py" \
  --output "$BATON2_PREFIX.installation-check"
mkdir -p "$HOME/.local/bin"
ln -s "$BATON2_PREFIX/bin/baton2" "$HOME/.local/bin/baton2.next"
mv -f "$HOME/.local/bin/baton2.next" "$HOME/.local/bin/baton2"
ln -s "$BATON2_PREFIX/bin/baton" "$HOME/.local/bin/baton.next"
mv -f "$HOME/.local/bin/baton.next" "$HOME/.local/bin/baton"
```

The staging command records the executable, required REPL dependency, context
modules, system prerequisites and notices. Keep the complete prefix. The native
build output is an intermediate executable; source installation requires the
staged payload. The installed REPL resolves its compiler under
`libexec/baton2/repl/compiler` in that prefix. Linux installations require Clang
14 or later and SQLite development headers and library. The preactivation check
reports the missing prerequisite and its remedy.

## Install a context module

Acquire a module from a locally supplied, already-built module directory or an
extracted Baton distribution:

```sh
baton2 /absolute/path/state.db context-install typescript /absolute/path/distribution
baton2 /absolute/path/state.db context-engines SESSION
```

A distribution source contains the module under `lib/context/modules`; a module
directory contains `native-provider.declaration.json` and its dependency closure.
The command copies that directory into the executing coordinator's installation
and publishes the completed copy. The result names its source and installed path.
An existing module returns `present` and keeps its files. Project settings and
active providers remain in place. Installing another version uses the qualified
development archive procedure above.

The Conductor MCP tool `baton2_context_install` accepts `{module, path}` for the
same operation. A supplied module must contain its already-built dependencies.
Missing sources and filesystem errors are reported by the command. A remote
module artifact catalog remains unimplemented. Elixir, Rust, Go and Python
provider payloads remain future module work.

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

## Dispatch a task

The complete installed package accepts task text, standard input or an existing
UTF-8 file. Select a named saved route or supply harness, model and effort:

```sh
baton dispatch 'Review the assigned source and report the result.' \
  --project /absolute/path/repository --harness codex --model MODEL --effort high
baton --project /absolute/path/repository as operator inbox
baton dispatch --stdin --project /absolute/path/repository --route review
baton dispatch --file /absolute/path/existing-task.txt \
  --project /absolute/path/repository --route review
```

`dispatch` owns routine session, receiver and native transcript setup. Complete
input requests and setup outcomes are retained in the database, and the result
returns literal commands for the request, message, session and turns. For an
existing open assignment, use `--to SESSION`; Baton selects continuation
automatically. In the actor context, `task-input-read --current` reads its latest
complete dispatch input and setup outcome. Its native conversation,
parent, workspace, pending input, receipts and explicit stops remain recorded.
Create a scratchpad deliberately when working notes need a file. Dispatch source
is retained as database text. Native transcripts remain separate runtime files.
The [dispatch interface](task-start-716.md) describes defaults, authority and
partial failures. `task` remains a compatibility alias.

An attached coordinator uses `baton2_dispatch` with text or an existing file to
assign independent work through its recorded identity. Existing native controls
including `start`, `receiver`, `dispatch-file` and `dispatch-turn` remain
available for explicit session setup and file-based operations.

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
