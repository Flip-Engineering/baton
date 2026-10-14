# Agent commands

Baton uses the database and session bound when the agent was launched. Existing
Codex conversations resolve their session through the current project's registered
database and native conversation ID.

```sh
baton inbox
baton read message-one message-two
baton acknowledge message-one message-two --receipt 'Read and handled.'
```

`read` returns complete stored deliveries in argument order, including messages
that already have receipts. Each ID has its own result. `acknowledge` updates each
owned message separately and returns its retained receipt. The first receipt
remains stored. Reading preserves pending receipts.

Send several independent messages with `and` or `--and` between complete clauses:

```sh
baton send parent --kind report --text 'Result.' --id report-one \
  and parent --kind report --file result.txt --id report-two
```

Each clause has a recipient, kind and text or file body. `--id` applies to that
clause; an omitted ID is generated and returned. Explicit IDs use Baton's existing
exact retry and conflict rules. Each item reports admission, wake and receipt
separately. File, admission and wake failures retain their individual causes and
the results of other items. A malformed command returns before message admission.
`--file -` reads standard input.

Complete UTF-8 input preserves a valid leading BOM and trailing whitespace.
Invalid UTF-8 and embedded NUL produce a refusal with the byte offset. Standard
input is read once per invocation and retained as an input artifact. Every
explicit stdin reference in that invocation reads those same complete bytes.

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

Workers send a completion request with a complete report body. A coordinator
confirms a request by sending its exact message ID as the confirmation body:

```sh
baton completion-request --text 'The assigned work is complete.'
baton completion-confirmed --request completion-request-id
baton guide --to worker --text 'Continue the assigned work and report the result.'
```

The completion request uses the current session's recorded parent. A parentless
session receives a structured refusal. The coordinator can use `guide` to send
further work. Each decision action uses the ordinary message admission result,
wake result and retained delivery. A confirmation names the request ID consumed
by the existing task-completion projection. Use `--file PATH` for a complete
text body and `--id ID` to choose a message ID. `completion-confirmed` resolves
the target from the retained request. An optional `--to PLAYER` must match its
author; the request must be addressed to the current session.

## Native operations

Named operations use the same project and actor context. `--session SESSION`
selects another recorded session for an operation that addresses a session.
Each complete operation can be followed by `and` or `--and` and another named
operation. Context resolves once for the invocation. Operations execute in
argument order, and each item returns its actual process result. A malformed
later clause returns before any operation starts.

```sh
baton attempt --and attempts --and outbox
baton receiver --command /path/to/harness --output-log /path/to/turn.jsonl
baton configure --session worker --effort high
baton resume --session worker
baton stop --session worker --id operator-stop --reason-file stop.txt
baton continue-task --session worker --id next-turn
```

`attempt` reads the selected session's execution and assignment state.
`attempt --id INPUT_ID` reads the stored input and its related attempt. `attempts`
reads complete turn history, and `outbox` reads authored messages and their
recipient receipts. These reads retain the existing task and receipt state.

`receiver` records an executable and output log for ordinary receive. Its
optional `--cwd PATH` sets the workspace; omission preserves the recorded
workspace. `configure` defaults harness, model, effort and expected route to
the selected recorded session. An omitted command and log use its recorded
native receiver. Explicit fields take precedence. The native configuration
operation enforces the expected route, current attempt and explicit stop rules.

`resume --lift-stop` explicitly lifts an existing stop and resumes its recorded
conversation. `force-stop --id STOP_ID` names the existing stop operation.
`recover-observer --observer PID` uses the existing observer recovery path.
`continue-task` sends an explicit continuation through the existing assignment
operation. Each action accepts `--session SESSION`.

```sh
baton turn --id direct-turn --command /path/to/harness \
  --file task.txt --output-log turn.jsonl
baton receive --session worker --message pending-input-id
baton profile-bind --profile work --store /path/to/profile
baton connect --endpoint '["/path/to/receiver"]'
baton bind --harness codex --model model-key --effort high
```

`turn` uses the selected session's model, effort, workspace and native identity
for omitted fields. `receive` uses its recorded receiver and native defaults.
`profile-bind` binds an existing named account through the native profile
operation; an omitted harness selects the recorded harness. `connect` and
`bind` preserve the native identity when `--native` is omitted. An explicit
empty endpoint disconnects it. `task TEXT`, `task --stdin` and `task --file PATH`
use the product task interface described by `baton task --help`.

```sh
baton report --id report-one --file result.txt
baton ask --id question-one --text 'Review this result.'
baton native-reply --request native-request-id --file response.json
baton dispatch --id task-one --to worker --file task.txt
```

`report` and `ask` address the current actor's recorded coordinator.
`native-reply` answers the retained request as the current coordinator.
`dispatch` admits complete input from the current actor and wakes the recipient
through the ordinary message operation. Its omitted kind is `task`.

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
baton knowledge record --id observation-one --kind observation \
  --claim-file claim.txt --evidence message:report-one --limits-file limits.txt
baton knowledge read --id observation-one
baton knowledge relate --id support-one --source message:report-one \
  --relation Supports --target finding:observation-one
baton knowledge promote --id promotion-one --from worker --to parent \
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
Links use the existing authored JSON relation array. `knowledge read` accepts
`--id ID` or `--index`, and scoped reads use `--scope` and `--subject`.
An omitted scope is `worker` and an omitted subject is the current actor.
Search accepts `--query` or `--query-file`. Promotion preserves the existing
source holding, destination owner and notice delivery rules. Bare `knowledge`
reads the actor's visible findings.

Project settings and session reads default to the actor's recorded workspace.
`--path PATH` selects a project explicitly. `project settings` returns the
complete saved `baton2/settings.json` body, its canonical path and JSON syntax
and schema validation through the shipped strict settings reader. Malformed
settings retain their complete body and refusal cause. Invalid UTF-8 retains
the original bytes as `bytesHex`. Inspection preserves the saved settings.

Context operations use `context engines`, `context install --module ID --path
PATH`, `context query --id ID --file PATH` and `context result --id ID`.
`models`, `observed-usage` and `logs` select the current session, with an optional
`--session SESSION`; `logs --level LEVEL` uses the native log configuration.

## Results and compatibility

Named native operations return one JSON result per item. `argv` records the
actual child dispatch and `nativeArgv` records its complete expanded
native arguments. Complete arguments travel as a JSON string array over stdin.
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
