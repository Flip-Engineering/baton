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

The assigned checkout retains the task, native output, worker report, database,
Git repository, proof driver and `evidence.json` under
`.scratch/bend2/architect15-message/`. The proof uses a local scratch repository
and the carried harness wrapper, which stores native state within this assigned
checkout. It changes no live trial files or processes and publishes no remote
branch.

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

At the recovery inspection, the live kit was at `0c5e961f` and the rendered
`root-instructions.md` contained that instruction. A SQLite `mode=ro` read
showed nine sessions and latest message sequence 37,
`issue-617-landed-ea30fdd7`. The only root landing log was the #617 file.
The instruction's effect remains to be checked on the next trial landing.

These recovery checks read the live trial's Git objects, database, instructions
and landing log. They changed only the evidence document and scratch evidence
inside the assigned workspace. No new native or JS test run was performed for
this documentation correction. The generic deployment verification command
was not run.
