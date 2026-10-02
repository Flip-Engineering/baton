# Native artifacts

`bend2/scripts/package-native.py` creates a Darwin arm64 archive from committed,
clean source. Its default artifact is a development build. It runs these complete
gates in order:

```sh
sh bend2/scripts/build-native.sh
node bend2/scripts/laws-check.mjs
sh bend2/scripts/check-native.sh
```

The coordinator entry imports its operative laws. The negative-control gate
removes each proof and exercises its implementation mutations. The native gate
runs the Bend fixtures and every Python suite selected by `check-native.sh`.
Every command must exit successfully on the same source commit and tree. The
compiler, its installed library bytes, C compiler and host observations must
remain unchanged across those gates. Full gate output and command receipts remain
in the output directory when a command fails.

## Toolchain and archive

Build dependencies are Python 3.11 or later, Node 22, Git, clang, SQLite development files
and the complete Bend 2.0.25 installation. The packaging and extraction smoke
procedures use the host's `lipo`, `otool`, `sw_vers`, Python and Git executables.

Preserve the official compiler archive before invoking the tracked installer.
Use a new directory you own as `BEND_HOME`. The installer changes files within
that directory. The Darwin arm64 release archive is pinned to SHA256
`c5bb22ba029d5909da9c6db82aa037278a66d1cf8a5572f433879f7dcd866c31`:

```sh
BATON2_RUN=/absolute/new/owned/run
mkdir -p "$BATON2_RUN/toolchain"
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/bendlang/bend/releases/download/v2.0.25/bend-2.0.25-darwin-arm64.tar.gz \
  -o "$BATON2_RUN/toolchain/bend-2.0.25-darwin-arm64.tar.gz"
printf 'c5bb22ba029d5909da9c6db82aa037278a66d1cf8a5572f433879f7dcd866c31  %s\n' \
  "$BATON2_RUN/toolchain/bend-2.0.25-darwin-arm64.tar.gz" | shasum -a 256 -c -
test ! -e "$BATON2_RUN/toolchain-home"
BEND_HOME="$BATON2_RUN/toolchain-home" BEND_NO_TELEMETRY=1 \
  sh docs/bend2/reference/toolchain/install-2.0.25.sh
```

The installer downloads and verifies its own copy. Packaging verifies the
preserved archive and compares its compiler and library members with the selected
installation. It records the full member inventory and retains any license and
notice files found in the archive.

## Package and exercise

Use a fresh owned clone for the build. Keep the output and toolchain outside
that clone so its original path can be made unavailable during runtime use:

```sh
BATON2_SOURCE=/absolute/clean/source
BATON2_COMMIT=$(git -C "$BATON2_SOURCE" rev-parse HEAD)
git clone --no-hardlinks --no-checkout "$BATON2_SOURCE" "$BATON2_RUN/build-source"
git -C "$BATON2_RUN/build-source" checkout --detach "$BATON2_COMMIT"
BEND_NO_TELEMETRY=1 python3 "$BATON2_RUN/build-source/bend2/scripts/package-native.py" \
  --output "$BATON2_RUN/package" --bend "$BATON2_RUN/toolchain-home/bin/bend" \
  --compiler-archive "$BATON2_RUN/toolchain/bend-2.0.25-darwin-arm64.tar.gz"
mv "$BATON2_RUN/build-source" "$BATON2_RUN/build-source-retained"
python3 "$BATON2_SOURCE/bend2/scripts/smoke-native-artifact.py" \
  --archive "$BATON2_RUN/package/baton2-development-darwin-arm64-$BATON2_COMMIT.tar.gz" \
  --sha256 "$(awk '{print $1}' "$BATON2_RUN/package/SHA256SUMS")" \
  --provenance "$BATON2_RUN/package/manifest.json" \
  --unavailable-source "$BATON2_RUN/build-source" --output "$BATON2_RUN/smoke"
mv "$BATON2_RUN/build-source-retained" "$BATON2_RUN/build-source"
```

The smoke procedure checks archive safety, all manifested file hashes, and the
exact sidecar/internal manifest bytes before executing the extracted coordinator.
It uses an unrelated directory and a fresh repository and database. Its controlled
OMP fixture exercises recruitment, retained receive-owner reexecution, complete
parent report delivery and acknowledgment, a repository commit and public landing.
It records process completion. Its native harness is a provider-free fixture;
real-model qualification has separate evidence. Preserve the output and restore
the owned build clone after a failed smoke as well.

The default archive root is `baton2-development-darwin-arm64`. It contains `bin/baton2`,
`manifest.json`, notices and complete gate logs. The manifest records source
commit/tree and file hashes, compiler archive and installed library hashes,
tool executables and versions, host and runner metadata, generated C and binary
hashes, Mach-O load-command observations and gate results. Generated C is retained
beside the archive. Credentials, conversation stores, databases and Player
workspaces are outside the archive selection.

The archive includes the Codex, OMP and MCP Conductor adapters under
`libexec/baton2/`. Canonical files use `*-conductor.mjs`; the corresponding
`*-root.mjs` files forward existing endpoints. With no explicit executable
argument, the adapters select the archive's `bin/baton2`. The manifest hashes
all six files. Node 22 supports these Conductor controls.

Extracted smoke invokes the staged MCP Conductor adapter and checks canonical
Player inspection, the Principal Conductor role, Ensemble and Section membership
and the nested Orchestra snapshot. These checks complement native retained
receive, complete reports, acknowledgment and Git landing.

Packaging copies the root `LICENSE` and `NOTICE` into `notices/baton2-LICENSE`
and `notices/baton2-NOTICE` when those files exist. The manifest records their
source paths, archive paths, byte sizes and SHA256 hashes, and includes the root
files in its source inventory. A historical snapshot without a root `LICENSE`
has a null `baton_root_license` entry and identifies its distribution terms as
unresolved. A missing root `NOTICE` has a null `baton_root_notice` entry.
Before writing the manifest, the packager requires project terms to match both
the source inventory and the archived files. The extraction smoke verifies the
resulting archive's file bytes against the manifest.

`--release-version 1.0.0` selects archive root `baton2-1.0.0-darwin-arm64` and
filename `baton2-1.0.0-darwin-arm64-<source-commit>.tar.gz`. Its manifest records
`kind: release` and `version: 1.0.0`. A release version starts with a letter or
digit and contains letters, digits, dots, underscores, plus signs or hyphens.
Release packaging requires a root `LICENSE` before running the gates. Use the
selected archive filename in the extraction smoke command. Publishing a release
requires the completed gate and extracted-artifact evidence for its exact source.

`--gate-receipt SUMMARY --gate-receipt-sha256 SHA256` reuses a completed receipt
from the same clean source directory. Packaging verifies every gate command,
successful exit, source snapshot, complete log hash, compiler hash and final
binary binding before creating the archive. Earlier receipts from the root's
exact-tree verifier lack pre-gate library, C compiler and host observations;
the manifest identifies those fields as captured after the supplied gates.
The default procedure captures these inputs before and after gate execution.

## CI and acceptance boundaries

[`.github/workflows/bend2-native.yml`](../../.github/workflows/bend2-native.yml)
runs on pull requests targeting `bend2-rewrite` and pushes to that branch.
It installs the pinned compiler into a fresh owned directory, runs
the complete packaging gates once in an owned clone, moves that clone to a
retained sibling path and runs the extracted-artifact smoke from the Actions
checkout. The workflow retains the archive, SHA256, manifest, compiler archive
and full gate and smoke evidence, including failure output and the controlled
smoke repository's Git objects and worktree metadata.

The declared runner is GitHub's `xcode-27` arm64 public preview. On 2026-10-02 its
[published image metadata](https://raw.githubusercontent.com/actions/runner-images/main/images/macos/xcode-27-arm64-Readme.md)
declared macOS 27.0 build `26A428`, image `20260928.0222.1` and Clang 21. Each run
records its actual host and toolchain. Runner availability establishes a
configuration target; hosted execution qualification requires its successful
job and retained artifact evidence. Other operating systems and architectures
need separate execution qualification.

The CI procedure creates development artifacts. Baton2 uses
[Apache License 2.0](../../LICENSE), with project attribution in the root
[NOTICE](../../NOTICE).
The [versioned Bend 2.0.25 compiler/runtime license](https://raw.githubusercontent.com/bendlang/bend/v2.0.25/LICENSE),
SHA256 `0beb288abd3d067e231f3fbe7df1f8ee37344061fc67f22018150a19e4b26c35`,
has the same bytes as the tracked reference license. Packaging verifies that pin
and retains both attributions and any actual compiler-archive notices with their
scope. Artifact generation and smoke success do not
establish a version 1.0 release, real provider qualification, package-manager
installation, signing or public release-asset delivery.
