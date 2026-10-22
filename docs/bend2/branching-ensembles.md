# Branching Ensembles

Issue [#751](https://github.com/Flip-Engineering/baton/issues/751) adds explicit
branch boundaries to a Conductor-owned Ensemble. Each boundary records the source
Player, workspace snapshot, complete task inputs, selected scratchpad findings,
native configuration and evaluator command. Baton generates round, Player and
evaluation identities.

Use branching to compare alternative solutions and continue the selected Player's
existing conversation. Configure loose or tight coupling on the Ensemble; both
support branching. `help branch` and `branch --help` show the same complete usage.

## Commands

The current Conductor can create an Ensemble and start branches from one of its
Players:

```sh
baton ensemble --id experiments --coupling tight
baton branch start --ensemble experiments --from researcher --count 3 \
  --text 'Complete the assigned change and retain its validation evidence.' \
  --evaluator '["python3","evaluate.py"]' --direction max
baton branch status --ensemble experiments
baton branch evaluate --ensemble experiments
baton branch select --ensemble experiments
baton branch continue --ensemble experiments
```

Omit `--ensemble` when the current Conductor owns exactly one Ensemble. With
zero or several owned Ensembles, select an owned Ensemble explicitly; unresolved
selection refuses with `Select --ensemble NAME for one Ensemble owned by this
Conductor.` Commands default to the latest round within that Ensemble;
`--round` selects recorded historical work.

`--from SESSION` selects a source agent. Its default is the latest selected Player
in this Ensemble, including score-based and explicit selections. Before any
selection it uses the current Conductor. Either source needs a recorded Git
workspace and settled native custody.

Start inherits the source's recorded task and native configuration. `--text` or
`--file` supplies task text; Baton stores the complete text in the database.
`--harness`, `--model`, `--effort` and `--command` select explicit native
configuration. A source attached to an external conversation may require
`--command` when its registered endpoint does not contain a native executable.

## Workspace and input boundary

Start requires settled physical custody of the source. A private Git index
captures tracked files and nonignored untracked files without changing the
source's index or HEAD. `--include '["path"]'` adds explicitly selected ignored
inputs. Each child receives a separate worktree at the recorded snapshot and a
fresh native conversation. Existing native initialization records retain its
generated seed and complete guidance.

The task includes the source's recorded assignment and subsequent task guidance,
plus findings selected with `--knowledge '["finding"]'`. Finding selection uses
the source Player's and Ensemble's existing visibility rules. Existing native
identity, receipt and communication rules apply to each child.

## Evaluation and selection

The evaluator is a JSON argv array. Baton runs it in a separate snapshot checkout
of a settled branch and retains its complete stdout, stderr and actual wait
status. Successful evaluator output is one JSON object:

```json
{"accepted": true, "score": 12.5}
```

`branch evaluate` records the workspace snapshot, evaluator argv, observed native
attempt and result. Then `branch select` without `--player` performs score-based
selection. Every branch needs successful native settlement, no explicit stop and
an accepted current evaluation, with one unique best score. Start defaults to
`--direction max` for the highest score; `min` selects the lowest. Missing settlement remains visible as
unknown. Evaluation alone records evidence. Failed, partial and tied outcomes
require an explicit Conductor decision:

```sh
baton branch select --ensemble experiments --player PLAYER --reason 'Decision evidence.'
```

Continue dispatches guidance to the selected Player's existing conversation and
workspace. Its default guidance is the stored complete task. A subsequent explicit
start uses the selected Player as its default source and creates fresh branches.
All branch artifacts, reports, pending input and evaluator evidence remain
retained. Resource usage is observational; a Conductor chooses when to start,
evaluate, select or continue work.

## Recovery and stops

`branch recover` retries recorded setup and owed input, including interrupted
worktree creation and registration. Existing seven-field assignments constrain
registration recovery. Explicit session stops remain effective through recovery.
`branch stop --reason TEXT` uses the supported session stop operation; `--player`
selects one child. A stopped selected Player requires the supported explicit
`resume --lift-stop` operation before continuation.

## Research reference

[Fork-and-Flush](https://arxiv.org/html/2610.07447v1) describes retaining a workspace
while starting fresh agent conversations, evaluating parallel continuations and
continuing selected work. Baton records these operations at explicit Conductor
boundaries. Native lifecycle, scoped authority and the project's runtime rules
govern execution.
