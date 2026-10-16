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
tail. Later corrected checks are recorded below.

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
Full coordinator run `baton-combined-check-v13-20261016T193342Z`, invocation
`c84bbe374afc4442b4c6aaa28a481827`, checked tree
`0d518d6099af97485315d177c94ac4dd75c05fc9`. Its original wait completed
naturally with exit 0 at 19:37:26 UTC after 214.251 seconds, with maximum
RSS 28,083,960 KiB and empty stderr. The complete retained evidence archive
has SHA256 `0cc118de796aa59f570081aa442f789a0ab614b758b53a236eea52356bb1c233`.
One native candidate build started at 19:40:05 UTC for that exact source tree;
its C generation, object build and link results remain pending.

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
moved. This run records `coordinator_runtime_qualified: false`; Darwin SDK
execution remains pending.

## Remaining acceptance

The candidate C/object/link build must complete on the checked production
closure. Candidate validation must cover notebook
recovery, the controlled observer-loss case, ordinary delivery, managed resume,
and the four output-generation recovery cases. Installed Darwin qualification
must exercise the normal archive, prerequisite check, pure and native IO
evaluation, interactive input, and unsupported input/option refusals.

The multi-Conductor test must use actual native model turns, import the original
complete shared declaration message, and verify owned-read receipts through
native turn settlement. CLI and MCP fixtures establish their respective command
contracts; full issue completion also requires this native acceptance.
