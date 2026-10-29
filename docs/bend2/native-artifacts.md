# Native artifacts

`bend2/scripts/package-native.py` builds the production receiver layout and packages a Darwin arm64 development or release archive. The layout contains the focused receiver at `bin/baton`, the full router at `bin/baton2`, and the general CLI sibling at `bin/baton-full`, together with harness adapters, Git helper, Orchestra UI, required Bend2 REPL compiler and Bun runtime, selected context providers, notices, and a manifest. The manifest records the overall source identity, each binary's path, SHA256, entry, build mode and source commit with tree or source manifest hash, the retained full C hash when available, the full wrapper source pin, the target platform, selected module identities, required REPL dependency hashes, system prerequisites, build commands and log paths, and compiler archive used for license notices. `SHA256SUMS` records the archive checksum and the payload records executable checksums, the manifest and the install receipt.

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

The package command runs [build-native.sh](../../bend2/scripts/build-native.sh) for each required binary. The focused receiver uses `BATON2_RECEIVE_FOCUSED=1` with its native entry. The full router uses `BATON2_NATIVE_RECEIVER_ROUTER=1` and forwards internal receiver actions to the focused receiver and recovery helper. A supplied binary is accepted only with its explicit source commit and tree or source manifest hash. A general CLI from an earlier qualification may retain its earlier retained source while the current native-entry wrapper records a separate source pin. `--generated-c /path/to/baton2.c` compiles an existing production C translation unit with the package host's compiler and links its native entry point. The build record includes the supplied C path, command, status, and stdout and stderr paths.

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

## Re-register a focused receiver

Use the installed focused receiver to record its own executable as a session endpoint:

~~~sh
bin/baton DATABASE register-receiver SESSION HARNESS_COMMAND OUTPUT_LOG
~~~

The command validates and updates the endpoint through the coordinator's receiver registration path. It retains the session's model, harness, native session identity, workspace, and branch. Registration leaves pending input queued and does not start a receiver. Supply an optional working-directory argument only when updating the recorded workspace.

For an OMP session, registration runs the harness command in rpc mode with the recorded model and effort, using a fresh probe session directory beside the coordination database. The first stdout line must be a JSON object with `"type":"ready"`. A command that exits, prints another first line or prints no frame is refused, and the typed `receiver-refused` answer carries the child's `stdout` and `stderr`. The probe sends no prompt and writes no coordination row; a refusal leaves the endpoint, workspace, model, native identity and pending input as recorded, and creates no execution row and no output log.

## Package contents and distribution terms

The archive contains the focused receiver at `bin/baton`, the full router at `bin/baton2`, the identical general CLI sibling `bin/baton-full`, manifest.json, install-receipt.json, SHA256SUMS, notices/, and libexec/baton2/. The focused receiver delegates general actions to `bin/baton-full`; the full router forwards internal receiver actions to `bin/baton` and recovery actions to `bin/baton-recovery`. A missing sibling makes the operation refuse. The task input, project settings and managed Codex inbox helpers are included in libexec/baton2/. The adapters select the archive's executable by default. The output directory also contains build logs, generated C when available, the manifest, archive, and archive checksum.

Packaging copies the project LICENSE and NOTICE when present, and retains the pinned Bend compiler/runtime license, reference license, and license or notice files in the verified compiler archive. The manifest records the notice paths and their sources. A source snapshot without a root license is marked as unresolved for public distribution.

## Continuous integration

[.github/workflows/bend2-native.yml](../../.github/workflows/bend2-native.yml) runs the complete native checks on the exact candidate source using a remote Linux host and the pinned Linux Bend compiler. It records the affected Python test outcomes during that complete suite. An independent job builds the exact target and runs the candidate test contracts against the target production executable and helpers. The comparison names each file, test and failure type; skipped, missing or incomplete results refuse qualification. Pull requests select their actual head commit.

For a handoff produced from the candidate commit, the Darwin job verifies the generated C checksum, producer source tree and every tracked source file against its package checkout. It compiles that C with Darwin clang, includes TypeScript 5.9.3, and packages the complete producer results and target comparison under `share/baton2/generated-c-provenance`. The extracted-artifact smoke runs on `macos-15` with the owned build path unavailable. Each job retains complete command streams and actual results.

### Rerun attempts and artifact names

Uploaded artifacts end in the number of the workflow attempt that made them. When failed jobs are rerun, a job that already succeeded keeps its artifacts under the earlier attempt number (#1263). `.github/scripts/select-artifact-attempt.py` lists the artifacts of the current run and prints the highest attempt, not above the current one, that has an unexpired artifact with the exact name prefix. The `darwin-arm64` job uses it to find the generated-C producer artifact, and `darwin-arm64-install` uses it to find the Darwin package. A named `reuse_generated_c_producer` attempt is used as given. Each consumer still checks the downloaded files against the source commit, run and attempt recorded in them, and a checkout without the selector script keeps the current attempt.

### Main C producer for pull requests

A pull request run compares its base and head with `.github/scripts/native-producer-route.py route` before it produces Main C (#1252). The comparison covers the Main production inputs that `reuse-native-main.py` selects (the import closure of `bend2/src/coordinator/main.bend`, including foreign C inputs and quoted C includes) and the producer tooling listed in `PRODUCER_TOOLING`: the workflow, the routing, queue adapter, execution, compiler preparation and reuse scripts, `build-native.sh`, `queue-entry.sh`, `bend-lineage-guard.sh` and the `bend2/toolchain/runtime-pin.txt` that the guard reads. The job checks out only the head at depth 1; `route` fetches the exact full base SHA at depth 1 from `origin` into `refs/baton/producer-base` (using the job token when one is supplied), and a failed fetch selects the existing producer. When every one of them is equal, the `linux-candidate` job generates the base commit's Main C through the shared compilation queue. That request has the same queue key as the head's would, so it joins a completed or active execution of that key. The job writes a handoff with `producer_kind: base`, the base commit as `source_commit` and the head as `consumer_source_commit`, and no Linux binary.

The Darwin job runs `native-producer-route.py verify-base` on that handoff. It recomputes the head's production inputs and producer tooling from the package checkout and compares them with the recorded base inputs and tooling, then packages the C, the route record and the handoff under `share/baton2/generated-c-provenance` with the base commit as the producer. The package, the REPL compiler source, the qualification job and the target comparison use the head checkout. A run that is not a pull request, a checkout without the routing script (a branch cut before it existed), a base that is unavailable, an unsupported import shape, or any difference in the inputs or tooling selects the existing producer, which generates and compiles the head's own Main.

### Compiler unit cache directory

The compiler keeps emitted C units in a directory it reads from `BEND_CGEN_CACHE_DIR`. `.github/scripts/compile-cgen-exec.py` chooses that directory for every queued C generation and passes it to the compiler explicitly. A value in the job environment, and `XDG_CACHE_HOME`, are recorded and not used (#1089).

The wrapper asks the GitHub API for the run (`GET /repos/{repository}/actions/runs/{run id}` with the job token). The run shares `<queue state root>/cgen-cache/trusted` when the record shows a `workflow_dispatch` or `push` event of this repository, status `in_progress`, and the same run attempt, repository and commit as the job, and the job's own event name equals the record's. Every other run, and any run whose record cannot be read (no token, a failed request), uses `<queue state root>/cgen-cache/untrusted/<uid>`, a directory mode 0700 for the runner user. The shared directory is used only while it has the state root's group, the setgid bit and group write access; otherwise the run falls back to its private directory, and an attempt that is not inside a queue state root uses a directory in its own work area. New directories take their group from the state root and are created with the mode they need whatever the job's umask.

The token reaches the wrapper through `GITHUB_TOKEN: ${{ github.token }}` in the environment of each workflow step that runs a queued build. The wrapper writes `cache-selection.json` into the attempt directory (selected path, kind, reason, the run event, owner, group, mode and inode of the directory, and the inherited values it ignored), and `compiler-diagnostics.json` embeds it under `cgen_cache`.

The wrapper is part of the checkout that a pull request run executes, so the selection protects the shared directory from builds that follow it. It does not stop a pull request that edits the wrapper, and a separate runner user for trusted builds is the only filesystem-level separation. Every cache entry is checked against its content digest when it is read.

### Homelab runner-group preflight

Run the read-only runner-group check before dispatching a homelab validation:

~~~sh
python3 bend2/scripts/check-runner-group-readiness.py \
  --workflow-branch '<trusted-validation-branch>'
~~~

The command uses the current `gh` login. `BATON2_RUNNER_GROUP_READ_TOKEN` selects
a token from the environment when provided. The account needs the organization's
`Self-hosted runners` read permission. The check verifies that runner group 4 is named
`baton2-native-homelab`, includes repository ID `1296997100` (`Flip-Engineering/baton`),
and permits public repository access for Baton. If the group restricts workflows,
the check also requires the exact direct workflow ref
`Flip-Engineering/baton/.github/workflows/bend2-native.yml@refs/heads/<trusted-validation-branch>`.

Use a direct workflow branch ref for the runner-group pin. Pull-request merge
refs are not supported by this group policy. Dispatch the trusted workflow
branch and pass candidate and target commits as full commit IDs; this keeps the
workflow authorization ref separate from the source commits being compared.
The preflight records policy readiness at the time of its API reads. Retain the
workflow run's actual runner assignment and completed job result as execution
evidence.

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
