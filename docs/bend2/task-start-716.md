# Dispatch input

Issue [#716](https://github.com/Flip-Engineering/baton/issues/716) assigns task
input and routine native setup to one product operation. This source proposal
requires remote validation, release integration and installed CLI/MCP
qualification before the issue can be closed.

## Public operation

The proposed entry point accepts one complete text argument, stdin or a UTF-8
file. File extensions have no special meaning. `--text` accepts text beginning
with `--`. A pipe with no explicit input argument supplies stdin.

```sh
baton dispatch 'Review the assigned source.' --route review
baton dispatch --stdin --route review
baton dispatch --file /absolute/path/existing-task.txt --route review
baton --project /absolute/path/checkout dispatch 'Review the assigned source.' --route review
baton /absolute/path/state.db dispatch --stdin --project /absolute/path/checkout --route review
baton dispatch --to principal --text 'Continue the same assignment.'
```

`dispatch` is the primary operation; `task` remains a compatibility alias.
`--to SESSION` selects a conversation, with `--session` as its compatibility
alias. Input files are optional user-supplied UTF-8 sources. Complete dispatch
source is retained in the database. Scratchpad creation is a deliberate action
for working notes. Automatic task-source file creation is prohibited.

The operation resolves the canonical project and its registered database.
Linked Git worktrees use their shared Git common directory. A non-Git project
uses its canonical directory and admits recorded workspaces under that path.
An explicit database must match the project's recorded pointer. A new project
receives a database pointer after its route and setup prerequisites resolve.

A new task receives generated message, request and session identities.
`--dispatch-id` and `--to` retain explicit message and session identities;
`--task-id` and `--session` remain compatibility aliases. `--new` requires an
unused session. `--to ID` automatically queues `task-continuation` input when that conversation
has an open assignment and preserves the original assignment. A parentless
Conductor keeps its retained operator assignment. `--continue` remains an optional
assertion that an existing open assignment is required. The native message route preserves
operator and parent authority: an attached parent supplies worker input through
the MCP tool, and an operator supplies its parentless Conductor's input.

## Defaults and overrides

Route precedence for each field is:

1. Explicit `--harness`, `--model` or `--effort`.
2. The explicitly selected `--route NAME` in project settings.
3. The recorded field of the explicitly selected existing session.

A new session requires a named route or complete explicit harness, model and
effort. The settings schema has no default-route selector. Missing fields
produce a refusal with the required next action.

New-session executables resolve through the current `PATH`: `codex`, `omp`,
`muse`, or `claude` for the selected harness. `--command` selects an explicit
executable. Existing sessions retain their recorded receiver until an explicit
command changes it. A model change uses the recorded native command and log;
the native configuration operation applies its current-attempt, stop and
expected-route rules. An existing working directory requires an explicit
receiver relocation before task input can use a different directory.

A named route's optional subscription profile resolves against the final
selected harness and the saved subscriptions. Setup binds the external store
before admitting task input. Credentials remain in the provider's external
store. Project settings and context fields remain stored unchanged.

The strict named-route reader is derived from
`bend2/harness/project-settings.mjs` at
`25f29f0d294031f3c0aab5d90ea877130b8ba9f3`, the corrected source for original
assignment `root-project-settings-703-20261012`. This proposal consumes its
schema and read functions. The original #703 source request, configuration
surface, fallback-account behavior and installed acceptance remain with
`semantic-controls-next`.

## Results and partial failures

The JSON result contains complete input, message, request and session identities,
project resolution, route-field provenance, setup command results and literal
inspect commands. Every setup command retains its actual exit status or signal,
complete stdout and stderr, and physical spawn cause. The database retains the
complete input request and setup outcome through `task-input-record` and
`task-input-result`. `task-input-read --current` selects the current actor's latest
request and returns both records. `--session SESSION` selects a semantic actor;
an explicit request ID remains available for historical inspection. Request
input includes its source and complete body; invalid UTF-8 retains the original
bytes as hexadecimal text. The frontend sends complete JSON over standard input
to these native operations. Native transcript paths are generated for new sessions
and retained for existing receivers.

The native batch admission result preserves admission, wake, delivery and
receipt facts. A pending wake or delivery snapshot remains pending in the task
result. Recipient receipts and coordinator decisions establish handling and
completion after admission. Explicit stops remain effective.

Setup can apply configuration before a later physical operation fails. The
result inspects the current session after that failure and retains the original
input for review. Retrying requires checking that state and its next action;
the result does not imply an atomic rollback.
Database write failures report `inputRecordError` or `resultRecordError` with
their actual cause. An unavailable database leaves its attempted write unfinished.

## MCP and qualification

`baton2_dispatch` accepts `text` or `file`, the same route and setup options, and an
optional `to` selecting an existing conversation. Baton selects its current
assignment and continuation mode automatically. `session` aliases `to`, and `baton2_task`
remains the compatibility tool. The attached session supplies sender
identity. Project context comes from the supplied project or that attached
session's recorded workspace. The tool calls the installed native dispatch entry;
complete text travels on stdin and its requests and outcomes are retained in the
same database. The adapter preserves support for an older executable advertising
only the task alias.

`bend2/test/task-start.py` exercises native argument, stdin and plain file input,
Unicode and BOM preservation, named-route overrides, installed executable
discovery, profile binding, project isolation, non-Git nested workspaces,
original assignment and receiver preservation, stops, physical setup failures,
partial configuration and packaged MCP task input. The retained provider fixture
records complete prompts, transcripts, messages and coordinator decisions.
`bend2/test/mcp-command.py` verifies complete text forwarding and attached sender
identity. Compiler, native, selected target/candidate and installed package
checks remain remote qualification requirements.
