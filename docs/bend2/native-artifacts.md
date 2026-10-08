# Native artifacts

`bend2/scripts/package-native.py` builds the production coordinator and packages a Darwin arm64 development or release archive. The package contains the native executable, harness adapters, Git helper, Orchestra UI, selected context providers, notices, and a manifest. The manifest records the source commit, target platform, selected module identities, build command and log paths, and compiler archive used for license notices. `SHA256SUMS` records the archive checksum.

## Build and package

Build dependencies are Python 3, Git, clang, SQLite development files, and Bend 2.0.25. Install Bend with the versioned [toolchain installer](../reference/toolchain/install-2.0.25.sh). The installer verifies the official compiler archive.

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
python3 "$BATON2_SOURCE/bend2/scripts/package-native.py" \
  --output "$BATON2_RUN/package" \
  --bend "$BATON2_RUN/toolchain-home/bin/bend" \
  --compiler-archive "$BATON2_RUN/toolchain/bend-2.0.25-darwin-arm64.tar.gz"
~~~

The package command runs [build-native.sh](../../bend2/scripts/build-native.sh) once. `--generated-c /path/to/baton2.c` compiles an existing production C translation unit with the package host's compiler and links its native entry point. The build record includes the supplied C path, command, status, and stdout and stderr paths.

For direct native builds, `BEND_GENERATED_C=/path/to/baton2.c` selects this input. Native runtime checks are available through `check-native.sh`:

~~~sh
sh bend2/scripts/check-native.sh
~~~

## Exercise the extracted artifact

The native workflow moves its owned build source directory, then runs [smoke-native-artifact.py](../../bend2/scripts/smoke-native-artifact.py) against the archive and manifest. The smoke checks the archive checksum and member paths, then starts the extracted coordinator from a separate working directory with the source path unavailable. A controlled OMP fixture exercises recruitment, receive-owner reexecution, report delivery and acknowledgment, repository commit and public landing.

For a manual smoke, use the archive filename, SHA256 from SHA256SUMS, and manifest produced by packaging:

~~~sh
mv "$BATON2_SOURCE" "$BATON2_RUN/source-retained"
python3 "$BATON2_RUN/source-retained/bend2/scripts/smoke-native-artifact.py" \
  --archive "$BATON2_RUN/package/baton2-development-darwin-arm64-<commit>.tar.gz" \
  --sha256 "$(awk '{print $1}' "$BATON2_RUN/package/SHA256SUMS")" \
  --manifest "$BATON2_RUN/package/manifest.json" \
  --unavailable-source "$BATON2_SOURCE" --output "$BATON2_RUN/smoke"
mv "$BATON2_RUN/source-retained" "$BATON2_SOURCE"
~~~

The archive root is baton2-development-darwin-arm64 by default. --release-version 1.0.0 selects baton2-1.0.0-darwin-arm64 and records the release version in the manifest. Release versions start with a letter or digit and contain letters, digits, dots, underscores, plus signs or hyphens. Release packaging requires the project root LICENSE.

## Package contents and distribution terms

The archive contains the native executable, manifest.json, notices/, and libexec/baton2/. The adapters select the archive's executable by default. The output directory also contains build logs, generated C when available, the manifest, archive, and archive checksum.

Packaging copies the project LICENSE and NOTICE when present, and retains the pinned Bend compiler/runtime license, reference license, and license or notice files in the verified compiler archive. The manifest records the notice paths and their sources. A source snapshot without a root license is marked as unresolved for public distribution.

## Continuous integration

[.github/workflows/bend2-native.yml](../../.github/workflows/bend2-native.yml) builds and packages the Darwin arm64 artifact on `macos-15`, runs the extracted-artifact smoke, and retains the package, build output and smoke output.

The workflow produces development artifacts. Real-provider execution, installation, signing, and release publication have separate delivery records.
