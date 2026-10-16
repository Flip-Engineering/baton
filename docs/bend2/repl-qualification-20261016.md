# Bend2 REPL qualification

The implementation for [#778](https://github.com/Flip-Engineering/baton/issues/778)
requires coordinator runtime, installed package and native multi-Conductor
acceptance. Those gates remain pending.

## Required installation payload

Standard packages and source installations stage the locked Bend2 frontend,
Base/effect source, Bun runtime and notices. The dependency manifest records
`language: "Bend2"`; the package manifest marks the dependency as required.
The shipped `check-install.py` verifies the required file inventory and runs
the packaged Bun before checking the system C compiler and SQLite development
files. Installation instructions run this check before activating command links.

## Remote package and compiler evidence

The immutable source tree `e8f33ba65261c8a394270cc173d3692904b9c57f`
was tested on the Linux validation host on 2026-10-16. Its source manifest has
SHA256 `70689cc31c6a45dec2fecdf489d8cc2ee95c622dfbfbb4e89273e7b2cf2d83a5`.
Run `baton-mandatory-package-v2-20261016T190853Z`, invocation
`65c2dae0dff346b7a68fd79cf22799fc`, completed naturally at 19:09:49 UTC:

- 16 package tests passed, including absent required payload and changed runtime
  refusals.
- 43 MCP command tests passed.
- Source installation staging completed. The shipped checker compiled, linked
  and ran its SQLite probe after the original source directory was moved.
- 17 packaged compiler checks passed, including Bend2 inference, affine/type
  refusals, Unicode native output and native exit status. JavaScript and Python
  source fragments received canonical compiler refusals.

This run used the immutable Main11 coordinator as a staging input. Its binary
SHA256 was `d5bbd1b2dc80bff38580855ede525487609a85e0c695904d8f6e49056ae56f4b`.
The run records `coordinator_runtime_qualified: false`.

The subsequent Python-only prerequisite change adds an actual packaged
`bun --version` invocation and an unusable executable refusal test. Tree
`b8b4e99a7ffddb0f090189b9eff486159fe2614b`, run
`baton-mandatory-package-v3-20261016T191222Z`, invocation
`f9fc2db897414351b5d9adc247ff7a16`, completed naturally at 19:12:36 UTC.
All 17 package tests passed. Source staging and the shipped prerequisite checker
passed with the source directory unavailable; Bun reported 1.3.14, Clang reported
19.1.1, and the SQLite probe reported 3.45.1. The checker SHA256 was
`2671e4e7054267330c56885ceed3951f6a1f2d473119c1349662c52853fd1169`.

Full source checks for trees `61e676b9322b47f8b63fe737949e3817dea65000`
and `e8f33ba65261c8a394270cc173d3692904b9c57f` exited 1 naturally. Both
reported that `repl-source.parent_reversed` consumed `rest` in both eager
`Bool.pick` branches. The pattern now explicitly permits copying that string
tail. The full coordinator check below covers the corrected source.

The next full check, tree `bea2e9c2282d7f4499fb5a587346ab2b79478d69`,
exited 1 naturally at 19:15:42 UTC because an earlier helper referenced the
later `drain` declaration. A focused check reproduced that error. The drain
and interactive loops now pass continuations into their earlier helpers.

Subsequent focused checks retained these natural failures:

| Source tree | Ended UTC | Compiler finding |
| --- | --- | --- |
| `f526663eceb323289ff7b53cc10dbc8a82d2ccd6` | 19:18:31 | Nested promoted tuple pattern could not infer the Sigma family. |
| `8728a4915aab9243f542a1f88e213b4004b39a5b` | 19:24:16 | A completed Result was supplied to IO.try. |
| `652e6dd57a823cabd16241e17090eedf6749e31b` | 19:26:44 | Option validation supplied a shared list to an affine-list parameter. |
| `ac9b1130f267aec5c2b26567602bfd40f272e199` | 19:29:17 | The command parser tried to promote an affine argument-list tail. |

The corrected source uses the existing typed wake-value destructuring form,
`IO.pass` for completed results, and `D.affine_strings` at the membership call.
Parser selection consumes its argument tail once through a Bool match.
The original stdout, stderr, wait status, resource measurements and immutable
source manifests remain retained for every check.

Focused run `baton-repl-focused-v12-20261016T193041Z`, invocation
`3fd3dec20efe42079112f09664d1329d`, checked tree
`999b371abef36b5afaff054dccf869315db10997`. The source helper check passed.
The complete REPL module check exited 0 naturally at 19:32:40 UTC after
109.482 seconds, with maximum RSS 13,270,828 KiB and empty stderr. This
establishes the focused canonical frontend check for that Bend source closure.
The focused check completed before the full coordinator check below.

Full coordinator run `baton-combined-check-v13-20261016T193342Z`, invocation
`c84bbe374afc4442b4c6aaa28a481827`, checked tree
`0d518d6099af97485315d177c94ac4dd75c05fc9`. It exited 0 naturally at
19:37:26.813 UTC after 214.251 seconds, with maximum RSS 28,083,960 KiB
and empty stderr. Its result SHA256 is
`7a8eb8fc4c23d26b853479b879867eebde50de8294baaef3fbcbd376e007f148`.

The single admitted native build is
`baton-combined-main-v13-20261016T193951Z`, invocation
`37ab2cfc3c774e478b9a77e4dfccc572`. C generation began at 19:40:05.576 UTC
on the same tree. Admission recorded 139,211,340 KiB available memory, zero
memory pressure averages, and no existing owned compiler or native model
process. Its original wait and complete outputs remain retained.

That C-generation process ended at 20:31:17.194666 UTC with SIGTRAP,
return code -5 and raw wait status 133. The original wait completed after
3071.617683 seconds, with maximum RSS 139,774,760 KiB. The result records
`original_wait_completed: true` and `natural_exit: false`. Cgroup OOM counters
and the kernel OOM-kill counter were zero. The crash cause remains under
investigation. No retry has been admitted.

The retained root is
`/run/baton2-native-homelab/retained/baton-combined-main-v13-20261016T193951Z`.
It contains `c-generation/result.json` and `failure.json`. The retained stderr
contains 24,710,137 bytes with SHA256
`cd260293c1f510bef4457c82b63f2a0dc62388f96e64c8be623a1ecd5a831b22`.
Object compilation, native linking, the candidate handoff, installation and
candidate runtime acceptance remain pending.

The original result SHA256 is
`2f5d9b5d3fbb0c5c8f7ba6d3f04c961fbb5462ba62e9b80caa80053d0b87ccef`.
The kernel journal records an `int3` trap in `bun[110881]` at 20:30:48 UTC.
Apport could not resolve the executable in its namespace and recorded a zero
core limit; no saved Bun core was found. The 38-file failure metadata archive
contains 314,564 bytes with SHA256
`bc92877863ced8aac9d73a674da42efda056ba840d5f6cbf46e5a384d993b209`.
The complete diagnostic stream and source archive remain retained remotely.

The final test overlay has tree
`dec7ea352fa1d7a77a5637229a209237d0c98ec9`. It changes
`receive.py`, `root-wake.py` and `agent-input.py` from the checked tree. The tests report
controlled child exits while waiting for metadata admission or a recovered
native connection. Recovered-connection waits check terminal custody before
reporting a settled failure. New ordinary-delivery cases unwind their controlled
fixture after the first failed admission assertion. The earlier waits are
retained as incomplete fixture runs,
with their databases, WAL files, output and process identities captured before
scoped interruption of the controlled Python test drivers.

The retained exact-target baseline completed 18 groups and 446 cases, with
68 failed assertion items and five passing groups. The target was
`e18f003bf07180994fff2c295c5c8e87a276400f`; its native binary SHA256 was
`b27bf926e06beb94e5bb7bba03cecdf6f7d720f0a396e3016683f3a11a272c10`.
All 18 selected test files match the final overlay. Each group records its actual
shared fixture files and hashes. Earlier groups used shared fixture revisions
that differ from the final closure. These runs establish an exploratory target
baseline; the normal paired target and candidate workflow remains pending.

Five earlier controlled Python fixture runs remain interrupted and incomplete.
Their wrapper exit labels do not establish a natural fixture result. The final
AgentInput rerun completed naturally at 20:03:01.669 UTC, judged all 22 cases and
recorded one assertion failure in original native-conversation preservation.
The final matrix SHA256 is
`5a847f8d6dbbf49ee12b1475ef5206cfb9fd317ea989ef12aff4af29bc6e3351`.
Independent review verified all 371 captured files and the group counts.

The CI reuse verifier accepts the current combined Main handoff after checking
the source snapshot, complete source manifest, full source check, three original
natural process waits and stable C/object/binary artifacts. A separate CI
reference binds unchanged original handoff bytes and explicit evidence path
mappings. The compiler archive closure is verified during reuse; the original
handoff records the compiler executable hash. Remote synthetic validation passed
16 acceptance and refusal cases, including direct and mapped combined handoffs,
legacy evidence, changed files, incomplete waits and invalid path mappings.
The validation executed no compiler. Its result SHA256 is
`24ba9e3777966cc25bd8d733b13229b5c9c9c426733ab650054640e2001f5ac8`.

The exact target evidence is retained at
`/mnt/nvme4tb/ci-runners/baton2-target-main-evidence-20261016T2040Z`.
Both CI users, UID 986 and UID 985, completed reuse preparation, generated-C
staging and transfer verification naturally. Each verified target commit
`e18f003bf07180994fff2c295c5c8e87a276400f` and generated C SHA256
`ca552285e64a7cfad67bc657b7e81a32d6c0c3b80eb6a9628c4de512a369c202`.
These checks executed no compiler. The shared handoff binds the unchanged
original handoff and preserves the original files and permissions. The 37-file
local evidence capture has archive SHA256
`3576503d7fd4082f57e61480c5a91870889d4eda5d065ccc42dcd68f88f58c3b`.
The candidate workflow remains pending a complete candidate Main handoff.

Remote Darwin dependency preflight run
[`38956455653`](https://github.com/Flip-Engineering/baton/actions/runs/38956455653)
used source `2b4683454b813e5a338b64582b0a0774249394bc`. Required source and
runtime staging completed. Its direct Clang SQLite probe failed because the
sanitized environment did not select the SDK include path. The selected SDK
contained the required header and library stub. The corrected run below checks
explicit SDK selection and the packaged compiler's native IO path.
This preflight does not establish normal archive or installed CLI acceptance.

The Darwin dependency preflight found that a resolved Clang path needs an
explicit SDK path to locate SQLite headers. The staged compiler adapter now
checks `/usr/bin/xcrun --sdk macosx --show-sdk-path`, retains its process
diagnostics and supplies `-isysroot` to native builds. The locked upstream
source files retain their original bytes.

Linux regression run `baton-mandatory-package-v4-20261016T194440Z`, invocation
`6cc151efbf364ab2b5aed448f9dff5a2`, checked packaging tree
`9e12b5fb55a413f6931386e47df2549ab63f5927`. It completed naturally at
19:45:01 UTC with 17 package tests, source staging, the installed prerequisite
checker and 17 packaged frontend checks passing. Native Unicode IO and
exit-status checks used the staged compiler after the source directory was
moved. This run records `coordinator_runtime_qualified: false`.

Corrected remote Darwin dependency preflight
[`38957558704`](https://github.com/Flip-Engineering/baton/actions/runs/38957558704)
used producer source `ce7d42b8401dc179bc5fb46f2c9f5c202e44e222` and completed
naturally at 19:48:26.059 UTC. All five recorded producer inputs match the
integrated package source at `a06333b7587e1a22755c1e9c1aecb8c6118bf3cb`.
The extracted dependency archive has SHA256
`08f49744c333fded07475caa9609ddaabb66291409fb378ee3cc43f8a6cb8eb9`.
Its 83 packaged files matched their recorded sizes and hashes.

With the original checkout, staged payload and source inputs moved away,
packaged pure Bend2 evaluation returned 42. Native Bend2 IO compiled, linked
against SQLite and produced the complete expected two-line Unicode output.
The run recorded Apple Clang 17.0.0, macOS SDK 15.5 and SQLite 3.43.2.
Four invalid type or source inputs returned the expected compiler refusals.
The result SHA256 is
`f44ac8c972a10282781cc1fbf98780678f60331bfe1705ba74de2e7fba89666c`.
This establishes the required Darwin compiler dependency and frontend check.
Normal coordinator archive, installed CLI and live adoption acceptance remain
pending.

## Remaining acceptance

The candidate C/object/link build must complete on the recorded production
closure. Candidate validation must cover notebook
recovery, the controlled observer-loss case, ordinary delivery, managed resume,
and the four output-generation recovery cases. Installed Darwin qualification
must exercise the normal archive, prerequisite check, pure and native IO
evaluation, interactive input, and unsupported input/option refusals.

The multi-Conductor test must use actual native model turns, import the original
complete shared declaration message, and verify owned-read receipts through
native turn settlement. CLI and MCP fixtures establish their respective command
contracts; full issue completion also requires this native acceptance.
