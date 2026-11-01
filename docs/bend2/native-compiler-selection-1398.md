# Native compiler selection owned by the checked-out tree (#1398)

The workflow reads the default compiler selection from the checked-out candidate tree.

## Problem

`bend2-native.yml` supplies a default compiler archive (path and SHA256) from the revision of the workflow
file. `prepare-native-compiler.py` runs from the checked-out candidate and verifies the archive against
`COMPILER_ARCHIVES` in the candidate's `reuse-native-main.py`. A candidate that predates the verifier
entry for the workflow's default archive fails (#1381, candidate `567eea971`), and nothing in the
candidate names the default it was meant to use.

## Files and what they own

| File | Owns |
|---|---|
| `.github/native-compiler-selection.json` | The default archive path and SHA256 of this tree (new). |
| `.github/scripts/reuse-native-main.py` | `COMPILER_ARCHIVES`, the archives this tree accepts, with their binary and runtime identity. |
| `.github/scripts/prepare-native-compiler.py` | Resolving the selection, verifying it, and writing the evidence. |
| `.github/scripts/test-prepare-native-compiler.py` | The coherence checks (new). |
| `.github/workflows/bend2-native.yml` | Passing inputs through. It holds no archive path or SHA256. |

The default file and the verifier are in one tree, so a commit that changes the default must also add the
verifier entry. `RealTree.test_the_tree_default_is_a_listed_archive` fails otherwise.

## Resolution in `prepare-native-compiler.py`

The script takes `--default-selection PATH`. Without the flag its behavior is unchanged (a blank selection
downloads the upstream release; `bend2-native-focused.yml` passes no flag).

1. Both `--archive` and `--archive-sha256` given: the selection source is `input`.
2. Both blank and `--default-selection` given: the script reads `PATH` and the source is `tree-default`.
   A missing or unreadable file is refused with reason `no-tree-compiler-selection`; a file without the
   schema `baton2-native-compiler-selection-v1`, a path, and a lowercase SHA256 is refused with reason
   `malformed-tree-compiler-selection`.
3. One of the two given: refused as before (`Select both the compiler archive and its SHA256.`).
4. The selection, whatever its source, then goes through the unchanged checks: the runner must be
   `homelab`; the SHA256 must be in this tree's `COMPILER_ARCHIVES`; the archive file must hash to it
   (`The retained compiler archive changed.`); the extracted compiler and runtime must match the
   verifier's recorded identity.

A SHA256 that the verifier does not list is refused with reason `unknown-compiler-archive` for both
sources. These selection refusals write `evidence/compiler-selection-refusal.json` (reason, selection source,
candidate commit from `git rev-parse HEAD` of the checked-out tree, `GITHUB_SHA`, archive path and
SHA256, the default file path, the archives the tree lists, a detail line) and exits 78. A successful run
writes `evidence/compiler-selection-source.json` (source, candidate commit, archive and SHA256).
`generated/compiler-selection.json` is unchanged, because downstream steps hash it.

## Workflow places where a blank input resolves

All four jobs check out the candidate before they run the script, so the file and the script they read are
the candidate's.

1. Input `retained_compiler_archive`: default becomes blank.
2. Input `retained_compiler_archive_sha256`: default becomes blank.
3. Job env and call in "Prepare candidate compiler" (producer).
4. Job env and call in "Prepare qualification compiler and TypeScript runtime".
5. Job env and call in "Build exact target and measure affected candidate tests"; the script and the file
   come from the workspace checkout of the candidate.
6. Job env and call in "Create owned build clone and install pinned compiler"; the script and the file
   come from `$run/build-source`, the candidate clone.

Places 3 to 6 drop the `|| '<path>'` and `|| '<sha256>'` fallbacks, so the env variables are blank unless
an input is given. Each call is preceded by a short shell block that sets `selection=(--default-selection
<tree>/.github/native-compiler-selection.json)` when the candidate's script contains the flag. The
call passes `"${selection[@]}"`.

## What an old candidate does

- A candidate whose script has the flag but whose tree has no default file (the file was removed or never
  added): refused with `no-tree-compiler-selection`, exit 78, with the evidence file.
- A candidate whose script predates the flag, dispatched with blank inputs: the shell block writes
  `Candidate <sha> predates tree-owned compiler selection ...` to the step's stderr evidence file and exits 78
  before the old script runs. It does not fall through to the upstream download.
- The same candidate with both inputs given: the block adds no flag, and the old script verifies the pin
  against its own verifier. It is refused when its verifier does not list the pin (the traceback of the old
  script, or the refusal record on candidates that carry the previous change).

## Tests

`test-prepare-native-compiler.py` builds stand-in trees (script, verifier, optional default file, git
commit) and stand-in archives:

- the tree default is used when inputs are blank, and an explicit pin replaces it;
- an unlisted pin, an unreadable unlisted pin, and a default file that names an unlisted archive are
  refused with the candidate commit in the record;
- a changed archive is refused for a pin and for the tree default, and a listed archive with a different
  binary is refused;
- a candidate that predates the default file is refused with evidence, and still accepts a listed pin;
- a malformed default file is refused; a lone field and the wrong runner keep their messages; a blank
  selection without the flag keeps the download path;
- the real tree's default is listed in its verifier;
- workflow coverage: blank input defaults, no fallbacks, one flag and one `"${selection[@]}"`
  per call, and the shell block run against a script with and without the flag.

## Not exercised

Workflow dispatch, a real archive and a Bend build remain unrun. The workflow is checked as YAML and by the tests above.
