# Agent commands

Baton uses the database and session bound when the agent was launched. Existing
Codex conversations resolve their session through the current project's registered
database and native conversation ID.

```sh
baton inbox
baton report 'The checks passed.'
baton ask 'Which target should receive the change?'
baton send reviewer 'The change is ready for review.'
baton guide worker 'Check the remaining failure.'
baton finish 'The assigned work is complete.'
baton confirm worker
```

`inbox` returns complete pending bodies. Baton records each complete owned read
against the current native turn. A successful completed turn records handling
and creates the first receipt automatically. Failed turns and unread input remain
pending. The first receipt remains stored.

`report` and `ask` address the recorded coordinator. `send PLAYER TEXT` sends a
report; `guide PLAYER TEXT` sends guidance. Baton creates the action identities.
The named forms retain explicit kinds and independent message clauses:

```sh
baton send parent --text 'Result.' and reviewer --kind guidance --text 'Review this result.'
```

Each message retains its own admission, wake and receipt outcome. A malformed
command returns before admission. Existing `--id`, `--text` and `--file` forms
remain available for explicit integrations; `--file -` reads standard input.
`read ID...` selects complete stored messages in argument order, including
messages that already have receipts. Administrative `acknowledge` and `ack`
forms remain available for an explicitly selected historical message.

Complete UTF-8 input preserves a valid leading BOM and trailing whitespace.
Invalid UTF-8 and embedded NUL produce a refusal with the byte offset. Standard
input is read once per invocation and captured in memory. Every explicit stdin
reference in that invocation reads those same complete bytes. A native context
query import retains its context request artifact.

Select another registered project or an explicit actor when needed:

```sh
baton --project /path/to/project inbox
baton as worker inbox
baton help send
```

Read session, Player and assignment state through the same launch context:

```sh
baton session
baton player worker
baton players
baton assignment
```

`session` and `assignment` accept an optional session ID. Their output uses the
existing session projection, including `taskCompletion`. `player` reads one
registered Player and `players` reads the current Players projection.
The positional forms retain these JSON shapes. Explicit named inspection forms,
such as `session --session worker` or `assignment --id worker`, use the named
action result array described below.

Workers send a completion request with a complete report body. A coordinator
confirms the selected worker's current owned request:

```sh
baton finish 'The assigned work is complete.'
baton confirm worker
baton guide worker 'Continue the assigned work and report the result.'
```

The completion request uses the current session's recorded parent. A parentless
session receives a structured refusal. The coordinator can use `guide` to send
further work. Each decision action uses the ordinary message admission result,
wake result and retained delivery. Baton selects the current request addressed
to the coordinator and constructs its confirmation. The compatibility command
`completion-confirmed --request ID --to PLAYER` selects an exact retained request
from that worker addressed to the current coordinator. `confirm` without a Player
selects the sole current request.
The named completion commands retain explicit body and identity options.

## Teams and branching

A Principal Conductor coordinates the whole assignment; an Associate Conductor
coordinates a delegated subtask. An Ensemble records a team owner and members.
Configure loose coupling for parent-child and Conductor-descendant messaging.
Tight coupling additionally permits non-operator peers sharing the Ensemble to
exchange messages, including peers with different parents. Peers have no ancestor
relationship; operators use the top-level Conductor route. The recorded Ensemble
owner manages membership. A Section supplies capability labels and member subsets
for work organization; routing, knowledge visibility and branching use Ensemble
and session records.

Branching compares alternatives on a team with either coupling: snapshot a
settled agent's workspace, start fresh conversations in separate worktrees, evaluate,
select, then continue the selected conversation. Omit `--ensemble` only for a
Conductor's sole owned Ensemble. `--from SESSION` defaults to the latest selected
Player in that Ensemble, or the current Conductor before any selection; the
source needs a recorded Git workspace and settled native custody. `evaluate`
records evidence; `select` without `--player` chooses the unique accepted best
score after every branch settles successfully. Direction defaults to `max`.

Use `baton help role`, `baton help ensemble`, `baton help section` and
`baton help branch` for usage. `baton branch --help` also shows branch usage.
The [branching guide](branching-ensembles.md) describes selection and recovery.

## Named action batches

Named operations use the same project and actor context. `--session SESSION`
selects another recorded session for an operation that addresses a session.
Each complete operation can be followed by `and` or `--and` and another named
operation. Context resolves once for the invocation. Operations execute in
argument order, and each item returns its actual process result. A malformed
later clause returns before any operation starts.

```sh
baton session --and player --session worker --and assignment --id worker
baton players --and attempt --and outbox
baton completion-request --text 'The assigned checks passed.' --and assignment
baton completion-confirmed --to worker --and player --session worker
baton guide --to worker --text 'Review the remaining source changes.' --and pending --and orchestra
baton attempt --and attempts --and outbox
```

Inspections, completion decisions, guidance and the native operations below
can share one batch. Session, Player and assignment clauses use `--session` or
`--id` to select a recorded target; omission selects the current actor. Each
item retains complete `stdout`, `stderr`, actual `waitStatus` and command
arguments. Its process status reports `completed`, `failed` or `refused`.
Decision stdout contains the ordinary per-message admission result, including
a structured authority refusal when the child process completed that refusal.
File and process failures preserve the results of later items.

Completion and guidance items invoke the same contextual handlers used by their
single forms. They resolve the recorded parent or retained request author and
enforce the current coordinator and explicit recipient checks. Complete bodies
travel to the child command through UTF-8 JSON standard input. Multiple explicit
stdin file references share the invocation's complete captured text. MCP contextual
arguments travel directly as a complete JSON array over standard input. One
`baton2_action` call names one top-level contextual CLI action. Its `arguments`
can contain the named batch grammar above; compact positional forms use their
own grammar. A branch operation uses one `branch` call with subcommand arguments.
The tool supports contextual inspections, dispatch, knowledge and team controls
as well as messaging. `action: "help", arguments: []` discovers the surface;
`action: "help", arguments: ["branch"]` reads complete branch usage.

## Native operations

```sh
baton receiver --command /path/to/harness --output-log /path/to/turn.jsonl
baton configure --session worker --effort high
baton resume --session worker
baton stop --session worker --reason-file stop.txt
baton continue-task --session worker
```

`attempt` reads the selected session's execution and assignment state.
`attempt --id INPUT_ID` reads the stored input and its related attempt. `attempts`
reads complete turn history, and `outbox` reads authored messages and their
recipient receipts. These reads retain the existing task and receipt state.

`status` and `orchestra` read their existing database projections. `pending`
reads complete pending input. `pending --index` enables native metadata filters:
`--sender`, `--recipient`, `--kind`, `--state`, `--after-seq` and `--through-seq`.
Native sequence bounds and stopped-input disposition apply to these reads.
`--pretty` selects the existing formatted projection for named session, Player,
Players, assignment, status, pending and Orchestra reads.

`receiver` records an executable and output log for ordinary receive. Its
optional `--cwd PATH` sets the workspace; omission preserves the recorded
workspace. `configure` defaults harness, model, effort and expected route to
the selected recorded session. An omitted command and log use its recorded
native receiver. Explicit fields take precedence. The native configuration
operation enforces the expected route, current attempt and explicit stop rules.

`resume --lift-stop` explicitly lifts an existing stop and resumes its recorded
conversation. `force-stop` selects the session's existing stop operation.
`stop` generates an identity for a new stop and reuses a recorded stop when
present; the native operation checks its complete reason. Explicit `--id` remains
available for exact compatibility.
`recover-observer --observer PID` uses the existing observer recovery path.
`continue-task` sends an explicit continuation through the existing assignment
operation. Each action accepts `--session SESSION`.

```sh
printf '%s\n' 'Review the assigned source and report the result.' |
  baton turn --command /path/to/harness --file - --output-log turn.jsonl
baton receive --session worker
baton profile-bind --profile work --store /path/to/profile
baton connect --endpoint '["/path/to/receiver"]'
baton bind --harness codex --model model-key --effort high
```

`turn` uses the selected session's model, effort, workspace and native identity
for omitted fields. `receive` uses its recorded receiver and native defaults.
The `turn --file PATH` compatibility form imports an existing caller-authored
UTF-8 file. Use `dispatch` for routine task input and native setup.
`profile-bind` binds an existing named account through the native profile
operation; an omitted harness selects the recorded harness. `connect` and
`bind` preserve the native identity when `--native` is omitted. An explicit
empty endpoint disconnects it.

`baton dispatch "task text"`, `baton dispatch --stdin` and
`baton dispatch --file PATH` own complete task input and routine native setup.
Use `--to SESSION` for an existing assignment; Baton selects continuation
automatically. Use `--route NAME` for a
named saved route, and explicit provider fields to override it. The result names
the complete input request and setup outcome retained in the database.
`task-input-read --current` selects the actor's latest request without copying
its identity. Native
transcripts are runtime files; scratchpads are deliberately authored working
notes. Automatic task-source file creation is prohibited. `baton dispatch --help`
describes the options, and `task` remains a compatibility alias.

```sh
baton report --file result.txt
baton ask --text 'Review this result.'
baton native-reply --to worker --file response.json
baton as parent dispatch --to worker --text 'Review the source.'
```

`report` and `ask` address the current actor's recorded coordinator.
`native-reply` selects the unique pending unanswered native request addressed
to the actor. `--to WORKER` selects a worker when several requests are pending;
absent or ambiguous requests produce a refusal. An explicit `--request ID`
remains available.
The named contextual `dispatch --to WORKER` action admits complete input
from the current actor and wakes the recipient through the ordinary message
operation. Its omitted kind is `task`. Explicit `as SESSION` selects that actor;
Baton generates the action identity. Optional `--id` retains an explicit identity
for this contextual action; the product dispatch frontend uses `--dispatch-id`
for an explicit message identity.

## Workspaces and publication

```sh
baton recruit --session worker --harness codex --model model-key --effort high \
  --repo /path/to/repo --branch worker-change --path /path/to/worktree --base COMMIT
baton join --session worker --harness codex --model model-key --effort high \
  --path /path/to/existing-workspace
baton worktree --session worker
baton land --session worker --repo /path/to/repo --target main \
  --check /path/to/check --files 'src/changed.py'
baton remote-tip --repo /path/to/repo --branch main --remote origin
baton push --repo /path/to/repo --branch main --remote origin
```

An omitted recruit or join parent is the current actor. `land` calls the native
workspace landing operation. `--check` and `--files` together select checked
landing; `--commit COMMIT` names a specific commit. Workspace ownership,
remote publication and selected checks retain their native requirements.

## Knowledge and project reads

```sh
baton report --text 'Complete source, command, output and status evidence.'
baton knowledge record --id observation-one --kind observation \
  --claim-file claim.txt --evidence report --limits-file limits.txt
baton knowledge read
baton knowledge relate --source file:src/example.py \
  --relation Supports --target finding:observation-one
baton knowledge promote --from worker --to parent \
  --finding observation-one
baton knowledge search --scope all --query-file query.txt
baton knowledge traverse --scope all --reference finding:observation-one \
  --direction both --recursive
baton project register --path /path/to/project
baton project settings
baton project sessions --path /path/to/project
```

Knowledge record fields accept complete literal text or their corresponding
`--claim-file`, `--evidence-file`, `--limits-file` and `--links-file` arguments.
`--evidence report` selects the unique report authored by the current actor to
its recorded coordinator after the current assignment. An absent assignment,
missing report or several matching reports returns a refusal. Explicit evidence
references retain their complete supplied values for deliberate selections.
Baton generates record, relation and promotion operation identities when omitted.
Links use the existing authored JSON relation array; omitted link identities
derive from the finding identity and link position. Explicit identities remain
available. Relationship sources, targets and finding references select semantic
objects and remain explicit when needed. `knowledge read` accepts
`--id ID` or `--index`, and scoped reads use `--scope` and `--subject`.
An omitted scope is `worker` and an omitted subject is the current actor.
Search accepts `--query` or `--query-file`. Promotion preserves the existing
source holding, destination owner and notice delivery rules. Bare `knowledge`
reads the actor's visible findings.

## Roles and groups

```sh
baton role --session worker
baton role --session worker --role associate-conductor
baton ensemble --id review-team --coupling tight
baton ensemble-member --id review-team --player worker --action add
baton section --ensemble review-team --id review --capability 'Source review'
baton section-member --ensemble review-team --id review --player worker --action add
baton ensemble --id review-team --and orchestra
```

`role` reads the selected session role; `--role` assigns an existing session.
Principal Conductor and operator require no parent; Associate Conductor requires
a parent. Assignment updates the responsibility used by message routing and
Conductor operations. Parentage, Ensemble ownership, live work and accepted input
remain retained. `ensemble --id ID` reads a group. `--owner SESSION` ensures it
for the named owner, and `--coupling loose|tight` creates or configures its coupling. An omitted
configuration owner selects the current actor. `section` reads the named Section;
`--capability TEXT` creates or configures it for `--owner`, which also defaults
to the current actor. Membership actions require `--player` and `--action add|remove`.
Native recorded-owner, role, Ensemble membership and Section membership checks
apply to every item. An ownership refusal retains the group and later batch
results.

## Project settings

Project settings and session reads default to the actor's recorded workspace.
`--path PATH` selects a project explicitly. `project settings` returns the
complete saved `baton2/settings.json` body, its canonical path and JSON syntax
and schema validation through the shipped strict settings reader. Malformed
settings retain their complete body and refusal cause. Invalid UTF-8 retains
the original bytes as `bytesHex`. Inspection preserves the saved settings.

## Context and logs

Context operations use `context engines`, `context install --module ID --path
PATH`, `context query --file PATH` and `context result`. Baton generates query
identities and selects the latest query owned by the current actor for its result.
An explicit `--id ID` selects a retained query.
`models`, `observed-usage` and `logs` select the current session, with an optional
`--session SESSION`; `logs --level LEVEL` uses the native log configuration.
`models --all` reports one observation per recorded session with a harness. Each
entry carries its source session, harness, command, model and recorded workspace,
so it reads as that session's own models read. A session without a recorded
harness has no entry in this read; account-wide usable models remain unknown.

## Bend2 REPL

`baton repl` evaluates Bend2 expressions and retains checked definitions in the
current actor's notebook. The standard installation includes the required
compiler and Bun runtime. `define`, `eval`, `bind`, `read`, `recover`, `share`,
`import` and `interactive` accept the named arguments in
[the REPL design](repl.md). The compiler infers expression types; `--type`
supplies an expected type. IO evaluation uses the actor's native process
authority and records complete stdout, stderr and the actual wait status.

## Results and compatibility

Named action batches return a JSON array with one result per item. `argv` records the
actual child dispatch and `nativeArgv` records its complete expanded
native arguments. Complete arguments travel as a JSON string array over stdin. Native operation
identities are generated or selected in the canonical database. Agents select
semantic targets and supply authored content; Baton resolves inferable control
state.
The item preserves full stdout, stderr, its retained stderr path and the actual
exit or signal status. Physical input, process and output failures retain their
causes. A failed item permits the remaining independently parsed items to run.
Project settings use the installed strict inspection helper and retain its
complete decoded or refused result in stdout.
Values equal to `and` or `--and` remain literal when a named argument consumes
them.

Project registration also uses `baton2 DATABASE project PATH`. Missing registration
reports that command and the pointer path. Action help works before project registration.
The existing database-first commands remain available. `BATON_DATABASE` and
`BATON_SESSION` are bound in the child process environment by Baton. An explicit
project or actor takes precedence over that part of the launch context. Missing
context reports how to launch or select an actor before applying the command.

The contextual action words listed by `baton help` select contextual commands.
Session IDs such as `read`, `inbox` and `send` remain ordinary named values.
Address a database file named with a contextual command word through `./NAME`
or its full path, for example
`baton2 ./session player worker`.

Use `baton help ACTION` or `baton ACTION --help` for the action's named arguments.
Compound actions also accept `baton knowledge record --help`,
`baton project settings --help` and the corresponding context action help.
