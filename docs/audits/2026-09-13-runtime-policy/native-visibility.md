# Native harness subagent visibility

2026-09-13. A Claude Code participant implemented the initial normalization helpers through Baton. Root corrected the protocol assumptions against installed harness evidence, reviewed the helpers, and integrated the adapter and swarm observation paths.

## Protocol evidence

- OMP 17.4.0 exposes task-tool invocation frames. Ordinary Bash/Read/Write calls are not children. An asynchronous task may return while `details.async.state` is still `running`; that return does not mean delegated work or its session has ended. Session-file and job identifiers are retained when the wire provides them. A batch count does not invent individual child identities.
- Claude Code 2.1.269 exposes `tool_progress` frames with `subagent_type`. A tool-use ID identifies an invocation, not a child session. Progress alone does not reveal completion. A native agent ID from a retry observation is retained as observed identity; no process ownership is inferred.
- Codex 0.154.0 was checked using `codex app-server generate-json-schema --experimental`. The `CollabAgentToolCallThreadItem` variant has `id`, `tool`, `status`, `senderThreadId`, `receiverThreadIds` and `agentsStates`. Its invocation status and each child's status are separate fields. Earlier guessed fields such as `agentThreadId` and `kind` were rejected during review.

## Integrated behavior

The OMP, Claude and Codex adapter wire handlers emit `native.subagent_observed`. The coordinator maps those observations into the existing durable log; `swarm.inspect` exposes each participant's observed native agents and invocations. Replay uses the same pure projection. There is no additional journal or polling controller.

`native-subagent-observations.mjs` normalizes known fields. Unknown protocol field presence may be reported, but unknown values and whole raw frames are not retained. Composite identities use JSON tuples so punctuation in session or invocation IDs cannot collide.

`native-subagent-view.mjs` separates observed agents from management-tool invocations. A completed Codex spawn, send or wait call cannot mark a child complete. OMP delegated-work completion does not prove a child session has ended. Missing native identities remain unidentified observations rather than fabricated workers. Native children advertise no Baton-owned stop controls; their harness retains control and custody.

## Validation and remaining gaps

Focused tests exercise actual adapter notification handlers with schema-grounded frames, durable coordinator mapping, replay, ordinary-tool exclusion, background OMP tasks, and completed Codex invocations whose children remain running. Unknown-field values do not appear in the resulting view. These tests are distinct from live native-child acceptance.

Coverage is explicitly `observed_only`. It is not a census of every native child. OMP batch children and Claude child completion need stronger native observations; native controls remain with the parent harness. Native participants retain their harness tools and can use those controls directly. The live DeepSeek custody-review participant invoked native OMP task delegation twice. Baton recorded each start and its asynchronous return with named jobs still running; no child session IDs were invented for those initial frames. Completion and individual batch children still require follow-up native observations.
