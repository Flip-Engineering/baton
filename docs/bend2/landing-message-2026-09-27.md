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

## Published kit and remaining trial check

The recovery inspection on 2026-09-27 confirmed that `origin/bend2-rewrite`
and the live trial's `kit` checkout both resolve to
`4c2be1c463baf1676eaf5b1d4ba0caadc762ebf4`. The trial executable at
`state/trial.db.trial/baton2` has modification time
`2026-09-27T10:10:30.649941Z`.

The latest trial landing is #616 at
`4dcdc34cce9c9d4d75c832b3ea7583923ab2cfbc`. Its message retains the worker
tip's full body and the worker-branch trailer. The independent review in
`contribution-50160a4b92e56e20e0f4a38afa2dd190` records that this landing
started 14 seconds before the executable rebuild completed. That review also
probed the rebuilt executable in a scratch repository and verified the new
message behavior.

The recovery read opened the live trial database with SQLite `mode=ro`.
Its latest message remains sequence 28, `issue-616-landed-4dcdc34c`, with no
later task or landing recorded. The next multi-commit trial landing started
with the rebuilt executable can establish the message behavior in the trial's
own history. The native regression and real-worker proof above already
establish it in the assigned checkout.

The recovered source built a fresh native landing test, which printed
`land checks: all green`. The 13 Python landing tests passed again. Reading
the retained proof's Git objects confirmed its exact message, target parent
and matching worker and landed trees. These checks changed only scratch files
inside the assigned checkout. Inspection changed no live trial file or process.
The generic deployment verification command was not run.
