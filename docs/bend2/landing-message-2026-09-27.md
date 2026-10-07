# Landing messages for multi-commit workers

The root's 2026-09-27 ruling specifies the message of a checked squash landing.
One worker commit above the merge-base with the target retains its full message.
Several commits use the tip commit's subject and put every branch commit's
subject in the body, with the worker branch named. The implementation lists
subjects oldest first in topological order and retains the dropped-path note.

The implementation reads the merge-base of the resolved worker commit and the
observed target commit. It reads the subjects in that range through Git argv
calls. A single subject selects the existing full-message read; multiple
subjects supply the title and body. A failed history read reports a landing
failure before committing the candidate or advancing the target.

## Native regression

Row K in `bend2/tests/land.bend` checks exact messages for both a one-commit
branch and a branch ending in a separate correction commit. It also checks the
worker file is present and ignored build output is dropped. Against the old
implementation, the revised row reported:

```text
FAILURES:
land K: candidate message differs from the branch history
```

With the implementation, the native landing test reported `land checks: all
green` and exited 0. Both the test entry and coordinator were rebuilt using the
existing Bend 2.0.25 compiler through `bend2/scripts/build-native.sh`.
`python3 -m unittest bend2.test.land` passed all 13 targeted tests. No whole or
near-whole suite ran.

## Real worker proof

A real OMP `deepseek/deepseek-flash` worker ran through the coordinator in native
session `01a0e24e-77b6-7000-bfe7-6d1f0098e359`. Its branch
`bend2/multi-message` started at `2aad832f0065382c4a8adc2e92be7edde031aaa5`
and produced two commits:

- `5b3f8d5bedcf2e39f33b3a7de5c71056247caa4c`: `Implement the data change`.
- `a969f571897d4f8e3989f84d62f3d28314d0e5e6`: `Correct the data wording`.

The rebuilt coordinator's `land-checked` command ran a nonempty-file check on
`data.txt` in both checked trees and landed
`37104ff4d2080b6c146d9bf49f2e64ae1cb6ad24`. Its complete message was:

```text
Correct the data wording

Implement the data change
Correct the data wording

landed from bend2/multi-message
```

The proof compared the complete message, the target parent and both tree IDs.
The parent equals the starting target. The worker and landed tree IDs both
equal `c94d88fb29fd0886e040f49911e9a7ae33efad71`.

The proof used a local scratch repository and a harness wrapper that stored
native state within the assigned checkout. The 2026-09-27 scratch cleanup
retained the task, native output, worker report, database, proof driver and
`evidence.json` in `.scratch/retained-evidence/bend2-evidence.tar.gz`, under their
original `.scratch/bend2/architect15-message/` paths. Compact Git commit metadata
is in `.scratch/retained-evidence/proof-commits.json`. The scratch Git repository
and disposable native session caches were removed. The proof changed no live
trial files or processes and published no remote branch.

## Trial landing confirmation

The #617 trial lane exercised the message rule through a worker-to-lead landing
and a lead-to-root landing.
The worker branch contained these commits above the lane base
`4dcdc34cce9c9d4d75c832b3ea7583923ab2cfbc`, oldest first:

- `84f424e37f68e6efbeae078ea8fc32ae1fee536e`: `Issue #617: a landing whose target moved re-judges only the tests the move can affect`.
- `aecc7c06b287d89a22b82ddda930f5b4fe843034`: `Issue #617: pin the gate invocation count and the re-judged revision in the target-move test`.

The lead's checked landing produced
`be1eb1921b75fc809441eb31587ab310c32a3518`. Its complete message is:

```text
Issue #617: pin the gate invocation count and the re-judged revision in the target-move test

Issue #617: a landing whose target moved re-judges only the tests the move can affect
Issue #617: pin the gate invocation count and the re-judged revision in the target-move test

landed from bend2/issue-617-worker-impl
```

The root's checked landing produced
`ea30fdd703123cd3619f812aec6d8b4a3f018c78` on `bend2-trial`. The lead branch
contained one commit above the base, so the root retained that complete message
and appended `landed from bend2/issue-617-lead` after a blank line.

Recovery inspection on 2026-09-27 compared both complete messages against the
rule using the trial repository's Git objects. Both matched. The worker, lead
and trial commits all have tree
`c48d4d0036e40c8bdbfe71935eb7bc407b00b7a5`. Both landing commits have the lane
base as their parent. This establishes the message behavior in the trial's own
history. The independent review in
`contribution-eb6959b8896b7f90bfaf4b9814b95974` records the selected-test
reproduction and both levels' checked landing evidence.

## Root command evidence

The #617 root landing log contains the successful `landed` answer and commit
`ea30fdd703123cd3619f812aec6d8b4a3f018c78`. It contains no command line.
Commit `0c5e961f3d819e8ec2defda9d1f02f4d56be272b` adds an instruction to
record the root's exact command line beside its answer in
`$TRIAL_STATE/issue-N-root-land-checked.log`.

At the 2026-09-27 recovery inspection, the live kit was at `0c5e961f` and the rendered
`root-instructions.md` contained that instruction. A SQLite `mode=ro` read
showed nine sessions and latest message sequence 37,
`issue-617-landed-ea30fdd7`. The only root landing log was the #617 file.
The later #620 landing exercised the instruction, as recorded below.

These recovery checks read the live trial's Git objects, database, instructions
and landing log. They changed only the evidence document and scratch evidence
inside the assigned workspace. No new native or JS test run was performed for
this documentation correction. The generic deployment verification command
was not run.

## Issue 620 command and message confirmation

The 2026-09-28 recovery inspection read
`state/trial.db.trial/issue-620-root-land-checked.log` in the operator's
`bend2-trial` directory. It contains the full command line followed by this
answer:

```json
{"status":"landed","target":"bend2-trial","commit":"cd721550d4125fa7e07809664e7956c37740e11a"}
```

The command names `issue-620-lead`, target `bend2-trial`, the kit's absolute
`check-node-test.sh` path, and these selected files:

- `impl/test/issue620-unregistered-workspace.test.mjs`
- `impl/test/issue568-worktree-reclamation.test.mjs`
- `impl/test/workspace-preservation.test.mjs`

The root commit's parent is the previous trial tip
`ea30fdd703123cd3619f812aec6d8b4a3f018c78`. The worker tip
`5d97a7eca57ea5b77c663cfeeabe81f720acde6f`, final lead tip
`6c078da9a25140f3764cab98aff741ad75e9e932` and root landing all have tree
`b46189d157046e6d90d5164d7f4e63d63d93375f`.

The worker and lead branches share the first two commit objects, `ddb0db42`
and `00caa2a9`. Each branch has three commits above the previous trial tip.
Reading that range in topological order, oldest first, reproduces the complete
root message:

```text
Issue #620: read tracked differences beneath an attested dependency root

Issue #620: reclaim an administration-less workspace of an ended seat
Issue #620: keep an ambient GIT_* variable out of the fixture's Git calls
Issue #620: read tracked differences beneath an attested dependency root

landed from bend2/issue-620-lead
```

The separate `issue-620-lead-land-checked.log` records the earlier `00caa2a9`
landing. Its command, result and test summary apply to that intermediate
revision. The final lead landing must be read from the native tool log and
branch history; `contribution-da1dedb4ca515cfd9a2eb1e5c1b54c86` records that
review and its selected-test reproduction. The root log establishes the
command-and-answer evidence required by `0c5e961f`.

This recovery check compared the complete root message, parsed the recorded
command and answer, and checked commit parents and tree IDs with read-only Git
commands. Its result is `.scratch/recovery18/landing-evidence.json` in the
assigned checkout. No native or JS suite was rerun for this documentation
change. Deployment verification remains unperformed.

## Issue 621 landing and scratch cleanup

The #621 trial landed as `0f32037b41378c6c300aa8d5597fb3249b20db0a`,
with parent `cd721550d4125fa7e07809664e7956c37740e11a`. The worker tip
`b944569969e7e0815a063eef6bf193afba1e347a`, lead landing
`3e8d26e8d93296635f9676a2a32224f2a5cddf2f` and root landing all have tree
`999a15f2ecdb02d4eb34e695dbefc8c2786977fa`.

The worker has two commits above the lane base. The lead landing's complete
message matches their subjects in topological order, oldest first, with the
tip subject as its title and the worker branch trailer. The root retains that
message and appends the lead branch trailer. Both landing parents equal the
lane base. Read-only assertions verified both complete messages, parents and
tree IDs on 2026-09-28.

`state/trial.db.trial/issue-621-root-land-checked.log` contains the root command
on its first line and the successful landing answer on its second line. The
lead's native record is:

```text
state/trial.db.session-69737375652d3632312d6c656164/
  2026-09-28T09-12-34-248Z_01a0e749-94c8-7000-847b-15d87ecef0c6.jsonl
```

Tool call `call_00_avyr0N6x5jSpSddMG6EW6798` invokes `land-checked` for
`issue-621-worker-impl` onto `bend2/issue-621-lead`. Its matching result contains
the successful `3e8d26e8` landing answer. The Git lane reported the root's ruling
that this native tool record supplies the lead-level evidence. The generated
`issue-621-lead-task.md` still requested a separate landing file; the kit's root
instructions now direct task assignments and reviews to the native record.

The kit checkout was at `9e008263` when inspected. The trial repository's
`.scratch` directory was empty, and Git registered no `.scratch/bend2-land-*`
worktree. The Git lane's earlier observations establish the cleanup during the
landing: both lead checkouts existed while checks ran and were removed when
the command answered. That report is
`contribution-cb27c9741bba1d1c17e9d19aac4b70ef` (seq 347333). It also records
63 passing tests in the landed tree's seven selected files and 59 passing tests
in the base's six pre-existing files.

The architect's read-only verification is retained at
`.scratch/recovery18/issue621-evidence.json`. It matched the native call and
result by tool-call ID and parsed the root command and answer. This documentation
and instruction change reran no native or JS suite and changed no live trial
file or process. Deployment verification remains unperformed.
