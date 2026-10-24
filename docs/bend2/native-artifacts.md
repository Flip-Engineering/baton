# Native artifacts

`bend2/scripts/package-native.py` builds the production coordinator and packages a Darwin arm64 development or release archive. The package contains the native executable, harness adapters, Git helper, Orchestra UI, required Bend2 REPL compiler and Bun runtime, selected context providers, notices, and a manifest. The manifest records the source commit, target platform, selected module identities, required REPL dependency hashes, system prerequisites, build command and log paths, and compiler archive used for license notices. `SHA256SUMS` records the archive checksum.

## Build and package

Build dependencies are Python 3, Git, clang, SQLite development files, and Bend 2.0.25. Install Bend with the versioned [toolchain installer](reference/toolchain/install-2.0.25.sh). The installer verifies the official compiler archive. Compilation and checks execute on remote validation hosts.

On Darwin arm64, run:

~~~sh
BATON2_RUN=/absolute/new/owned/run
BATON2_SOURCE=/absolute/source
mkdir -p "$BATON2_RUN/toolchain"
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/bendlang/bend/releases/download/v2.0.25/bend-2.0.25-darwin-arm64.tar.gz \
  -o "$BATON2_RUN/toolchain/bend-2.0.25-darwin-arm64.tar.gz"
printf 'c5bb22ba029d5909da9c6db82aa037278a66d1cf8a5572f433879f7dcd866c31  %s\n' \
  "$BATON2_RUN/toolchain/bend-2.0.25-darwin-arm64.tar.gz" | shasum -a 256 -c -
test ! -e "$BATON2_RUN/toolchain-home"
BEND_HOME="$BATON2_RUN/toolchain-home" \
  sh "$BATON2_SOURCE/docs/bend2/reference/toolchain/install-2.0.25.sh"
BATON2_REPL_RUNTIME=/absolute/path/to/verified/darwin-arm64/bun
BATON2_REPL_RUNTIME_SHA256='<verified-platform-runtime-sha256>'
BATON2_REPL_NOTICES=/absolute/path/to/complete/Bun-NOTICES
python3 "$BATON2_SOURCE/bend2/scripts/package-native.py" \
  --output "$BATON2_RUN/package" \
  --bend "$BATON2_RUN/toolchain-home/bin/bend" \
  --compiler-archive "$BATON2_RUN/toolchain/bend-2.0.25-darwin-arm64.tar.gz" \
  --repl-runtime "$BATON2_REPL_RUNTIME" \
  --repl-runtime-sha256 "$BATON2_REPL_RUNTIME_SHA256" \
  --repl-runtime-notices "$BATON2_REPL_NOTICES"
~~~

The checked-in REPL compiler source is verified against
`bend2/compiler/repl-upstream.lock.json`. The platform Bun executable and its
complete distribution notices are required build inputs; packaging fails when
they are absent or invalid. The manifest records the required
`bend2-repl-compiler` dependency and the host system prerequisites.

The package command runs [build-native.sh](../../bend2/scripts/build-native.sh) once. `--generated-c /path/to/baton2.c` compiles an existing production C translation unit with the package host's compiler and links its native entry point. The build record includes the supplied C path, command, status, and stdout and stderr paths.

`--context-typescript-package /path/to/node_modules/typescript` includes an installed TypeScript package and its source analysis provider. Packaging copies the compiler package into the selected module. Installed module discovery reads its declaration; a selected invocation uses Node module resolution to load the available compiler and records its actual version, path and digest. The provider analyzes TypeScript or JavaScript source and returns definitions, types, references, calls, callers, dependencies, diagnostics, flow and exceptions with captured source identities. Node.js 22.15 or newer runs the provider. The selected-context package fixture exercises TypeScript 5.9.3; `BATON2_CONTEXT_TYPESCRIPT` supplies its installed compiler package.

For direct native builds, `BEND_GENERATED_C=/path/to/baton2.c` selects this input. Native runtime checks are available through `check-native.sh`:

~~~sh
sh bend2/scripts/check-native.sh
~~~

## Exercise the extracted artifact

The native workflow moves its owned build source directory, then runs [smoke-native-artifact.py](../../bend2/scripts/smoke-native-artifact.py) against the archive and manifest. The smoke checks the archive checksum and member paths, then starts the extracted coordinator from a separate working directory with the source path unavailable. A controlled OMP fixture exercises recruitment, receive-owner reexecution, report delivery and acknowledgment, repository commit and public landing. The workflow then runs [repl-package.py](../../.github/scripts/repl-package.py) `smoke` against the extracted prefix. That check verifies the required REPL dependency, evaluates Bend2 definitions and expressions through the bundled compiler, exercises interactive input and native IO, and retains each command's stdout, stderr and wait status.

For a manual smoke, use the archive filename, SHA256 from SHA256SUMS, and manifest produced by packaging:

~~~sh
BATON2_ARCHIVE_NAME=$(awk 'NR==1 {print $2}' "$BATON2_RUN/package/SHA256SUMS")
mv "$BATON2_SOURCE" "$BATON2_RUN/source-retained"
python3 "$BATON2_RUN/source-retained/bend2/scripts/smoke-native-artifact.py" \
  --archive "$BATON2_RUN/package/$BATON2_ARCHIVE_NAME" \
  --sha256 "$(awk '{print $1}' "$BATON2_RUN/package/SHA256SUMS")" \
  --manifest "$BATON2_RUN/package/manifest.json" \
  --unavailable-source "$BATON2_SOURCE" --output "$BATON2_RUN/smoke"
mv "$BATON2_RUN/source-retained" "$BATON2_SOURCE"
~~~

The archive root is `baton2-development-darwin-arm64` by default. `--release-version 2.0.0` selects `baton2-2.0.0-darwin-arm64` and records `2.0.0` in the manifest. Release versions start with a letter or digit and contain letters, digits, dots, underscores, plus signs or hyphens. Release packaging requires the project root LICENSE.

## Package contents and distribution terms

The archive contains identical executable entries at `bin/baton` and `bin/baton2`, manifest.json, notices/, and libexec/baton2/. The task input, project settings and managed Codex inbox helpers are included in libexec/baton2/. The adapters select the archive's executable by default. The output directory also contains build logs, generated C when available, the manifest, archive, and archive checksum.

Packaging copies the project LICENSE and NOTICE when present, and retains the pinned Bend compiler/runtime license, reference license, and license or notice files in the verified compiler archive. The manifest records the notice paths and their sources. A source snapshot without a root license is marked as unresolved for public distribution.

## Continuous integration

[.github/workflows/bend2-native.yml](../../.github/workflows/bend2-native.yml) runs the complete native checks on the exact candidate source using a remote Linux host and the pinned Linux Bend compiler. It records the affected Python test outcomes during that complete suite. An independent job builds the exact target and runs the candidate test contracts against the target production executable and helpers. The comparison names each file, test and failure type; skipped, missing or incomplete results refuse qualification. Pull requests select their actual head commit.

The Darwin job verifies the generated C checksum, producer source tree and every tracked source file against its package checkout. It compiles that C with Darwin clang, includes TypeScript 5.9.3, and packages the complete producer results and target comparison under `share/baton2/generated-c-provenance`. The extracted-artifact smoke runs on `macos-15` with the owned build path unavailable. Each job retains complete command streams and actual results.

Pushes and pull requests produce development artifacts. To qualify an immutable candidate for Baton 2.0.0, supply its branch and the exact target commit:

~~~sh
gh workflow run bend2-native.yml --ref '<candidate-branch>' \
  -f release_version=2.0.0 -f target_commit='<40-character-target-commit>' \
  -f linux_runner=homelab
~~~

The manual workflow selects the existing `baton2-native-linux-x64` homelab runner by default. Its runner group permits exact trusted workflow references. `linux_runner=hosted` selects hosted Ubuntu; automatic pushes and pull requests use hosted Ubuntu. Candidate and target jobs run independently and share the available runner capacity. Leaving `release_version` blank produces a development archive. The uploaded Darwin artifact name includes the selected version, source commit and run attempt. Inspect the full native result, selected comparison, generated-C provenance, package and smoke before publishing. Real-provider execution, installed use and release publication retain their own results.

`target_build_run` selects a completed exact target build from an earlier workflow artifact. The target job verifies the recorded source, successful build result, pinned compiler, C checksum and binary checksum, then restores that binary into a fresh target checkout. It runs every current selected test contract against the restored target and its exact source helpers. The new artifact retains the original build evidence and the current comparison results.

## Publish a qualified release

Fast-forward `main` to the accepted candidate and verify the actual remote advertisement. Publish the same commit as the source tag and upload the qualified archive with its matching sidecars:

~~~sh
BATON2_SOURCE='<qualified-commit>'
BATON2_PACKAGE=/absolute/path/to/qualified/package
gh release create baton2-v2.0.0 --repo Flip-Engineering/baton \
  --target "$BATON2_SOURCE" --latest --title 'Baton 2.0.0' \
  --notes-file /absolute/path/to/release-notes.md \
  "$BATON2_PACKAGE/baton2-2.0.0-darwin-arm64-$BATON2_SOURCE.tar.gz" \
  "$BATON2_PACKAGE/manifest.json" "$BATON2_PACKAGE/SHA256SUMS"
~~~

Read back the tag, public latest release and downloaded assets. Verify the downloaded archive checksum and manifest source against the accepted commit. The [installation procedure](installation.md) selects the complete payload while retaining existing process custody and recorded state.
