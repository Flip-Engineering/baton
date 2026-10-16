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
tail. The corrected full source check remains pending.

## Remaining acceptance

The full coordinator check and candidate C/object/link build must complete on
the recorded production closure. Candidate validation must cover notebook
recovery, the controlled observer-loss case, ordinary delivery, managed resume,
and the four output-generation recovery cases. Installed Darwin qualification
must exercise the normal archive, prerequisite check, pure and native IO
evaluation, interactive input, and unsupported input/option refusals.

The multi-Conductor test must use actual native model turns, import the original
complete shared declaration message, and verify owned-read receipts through
native turn settlement. CLI and MCP fixtures establish their respective command
contracts; full issue completion also requires this native acceptance.
