# Native task launcher qualification

## Scope

The public trial launcher accepts a caller-selected check program and preserves
an explicit Bend compiler in its emitted shell settings. This qualification
uses controlled login and report endpoints, actual Bend compilation, native
coordinator commands and checked landing at both hierarchy levels.

The measured source is `61ecfc4a4562e80bc9c7efe332bfcbcf5c74ced7`.
Its coordinator sources and build script match the published `f85647cc`
implementation. Exact final-tree acceptance and hosted artifacts have their own
gates.

## Observed failure and repair

At `463f2b4c`, the launcher always selected `check-node-test.sh`. The probe
committed the existing `bend2/test/recruit.py` selection into its target and
candidate. The emitted adapter refused that selection with exit 2 because its
contract requires `impl/test/` paths. Public checked landing answered `blocked`;
the target and worker commits remained unchanged.

Commit `6a51fbf0` adds the fourth `CHECK_PROGRAM` argument, checks its file before
creating state or invoking login/build, and resolves an explicit `BEND` to an
absolute executable. The emitted settings and task instructions carry the
selected program and issue-selected test paths. Seven focused fixture tests
passed; the two landing cases passed again after being changed to use the
emitted coordinator path. These fixtures reused an existing binary and a
controlled build-output program.

The native-only source removal also exposed two comparison tests that assumed
original Baton source in the current checkout. Commit `92c61ac9` moves the real
original integration to `bend2/test/external/compare-original.py`, with required
`--old-repo`, `--old-ref` and `--output`. Eight self-contained native comparison
tests passed. The separate historical integration passed both cases on
`6ccb2a6daf396fb9ce050cc91476ac49791b64c9`; a startup-failure control retained
complete helper output, diagnostics and process exit records. Available installed
dependencies were recorded separately and were unpinned to that source revision.

## Actual compiler and landing run

The run used an owned clone with an unchecked-out `bend2-trial` target. The
launcher invoked a login-status fixture with the forced ChatGPT login argument
and API-key environment variables removed. It built the actual coordinator and
emitted the selected `check-unittest.sh`, compiler, database and executable paths.
No model turn was started.

A recruited Player committed one regression assertion: reading its registered
session from an unrelated directory returns the complete recruitment row.
The selected `bend2/test/recruit.py` suite ran in four distinct checked trees
through public Player-to-Associate and Associate-to-Principal landing. Each tree
compiled `bend2/src/coordinator/main.bend`, which imports its operative laws.
Recorded compiler and clang wrappers executed the pinned real tools. Every
recorded invocation matched the same 60 native source files. The five
retained generated C files, including the initial build, have SHA256
`f724c1604610883f11907366630cbbb2c828fa5d551ec221e92b727fcb247f9d`.

| Result | Commit |
| --- | --- |
| Player change | `71e17214cef7279b2b313ca69332874bb92b87bb` |
| Checked Associate branch | `7d1cabfacea71ed77703eb4edb20cb91c1fab02b` |
| Checked trial target | `f3d3d8f81dc3324c562ffb4080e57317d2843b59` |

Both landing results were `landed`. The final target contained the exact Player
file; its branch and clean workspace remained intact. The Player report reached
its Associate Conductor, the Associate report reached its Principal Conductor,
and the Principal report reached the operator. Each recipient acknowledged its
report. The driver
exited 0 after 107.169 seconds; its 52 captured command/tool/login PIDs were
absent. The reviewed regression was imported into `bend2-rewrite` as `24f93c59`.

## Evidence and limits

Retained root output is `.scratch/native-entry-qualification-61ecfc4a/`.
Its summary SHA256 is
`f4bec503087de7aaa4e374800c32fcabf7203a58424f182d69bbc48627c79202`;
its 86-file command, generated-source and controller manifest SHA256 is
`885e412118437633c20b9e265af509d466748ae687929d936b289827b7ccacf9`.
The frozen driver SHA256 is
`fe445353827202067ffe700caccdf7db706e58ed99f13bddddd84fb5f3251b08`.
The initial emitted executable SHA256 is
`462c2e0b9c1ffb4bc2bcf3c93ea089f17717d47b50acab7be1d1722ac257274b`.

Successful landing removed its temporary checked trees. Their final executable
bytes and individual inner wait statuses were not retained. Two configuration
commands share empty stream files in the frozen preparation; their recorded
stream hashes are identical and no nonempty output was lost. The corrected
preparation is retained separately and was not used for this run.

This proves provider-free launcher use, actual law-bearing compilation and
selected checked landing. Real native harness behavior is covered by the
[separate native qualification](native-qualification-2026-10-02/README.md).
