# Native harness subagent visibility

Audit date: 2026-09-13. Covers `impl/src/native-subagent-observations.mjs` and its
integration seams with existing adapter modules.

## Purpose

Native harnesses (OMP, Claude Code, Codex) can recruit their own scouts — child
sub-executions that the harness manages internally. Baton must observe those children
through the parent session's wire frames without:

- Inventing independently controllable Baton workers for them
- Claiming known process ownership or completed session states
- Treating a tool-execution-start alone as a full child record
- Treating a tool-execution-end as a whole child-session exit
- Retaining full raw frames in normalized events

`native-subagent-observations.mjs` provides a pure, dependency-free normalization and
projection layer that translates actual native wire frames into honest observation records.

## Wire evidence base (installed binaries + JSON schema, 2026-09-13)

### OMP 17.4.0 (`/opt/homebrew/Cellar/omp/17.4.0/bin/omp`, Mach-O arm64)

`toolName === 'task'` is the subagent discriminator.

Binary evidence:
```
if (Ye.toolName === "task") { ... }
const a = e.toolName === "task" && t === "running";
details: { jobId: _, work: s, sessionFile: x }
const t = e.result.details?.async?.state;
// async: { state: "running", jobId: e, type: "eval" }
// batch: details: { projectAgentsDir: null, results: [], totalDurationMs: 0 }
```

`OmpRpcCli._onFrame()` emits `tool_execution_start`/`tool_execution_end` for ALL tool
calls (Bash, Read, Write, Grep, Edit, and task). Only `toolName === 'task'` signals a
child sub-execution. All other toolNames are ordinary tools and must return null.

Wire frame shapes:
```
tool_execution_start (task): {type, toolCallId, toolName:'task', args:{agent?,context?,tasks?}}
tool_execution_end (task):   {type, toolCallId, toolName:'task', result, isError}
task result details:         result.details.{sessionFile, jobId, work}
async result:                result.details.async.{state:'running'|'completed'|'failed', jobId, type}
batch result:                result.details.{projectAgentsDir, results:[], totalDurationMs}
```

**Async phase distinction (critical):** When `tool_execution_end` fires with
`result.details.async.state === 'running'`, the task tool call returned early via the
async backgrounding path but the underlying job is still in-flight. Phase must be
`STARTED` (not `COMPLETED`) with gap `async_job_in_flight`. Only `async.state === 'completed'`
maps to `COMPLETED`; `async.state === 'failed'` maps to `FAILED`; no async field at all
means synchronous task settled → `COMPLETED`.

Child session identity is available only in the end frame's `result.details.sessionFile`.
Async task identity uses `result.details.async.jobId`. `tool_execution_start` alone carries
no session file — `child_session_id_unknown` gap is always present on start observations.

`tool_execution_end` is NOT a parent-session exit. The OMP session continues after the
task tool returns.

Integration seam: `OmpRpcProcess.onFrame` option (`omp-rpc.mjs:138`). Root attaches at
this callback to feed raw frames to `normalizeOmpTaskFrame()`.

### Claude Code 2.1.269 (`~/.local/bin/claude`, Mach-O arm64)

`tool_progress` with `subagent_type` field is the subagent discriminator.

Binary evidence:
```javascript
// Subagent progress frame (has subagent_type):
type:"tool_progress", tool_use_id:e.toolUseID, tool_name:ht,
  parent_tool_use_id:e.parentToolUseID, elapsed_time_seconds:0,
  session_id:X(), uuid:e.uuid, subagent_type:e.data.agentType,
  ...e.data.resolved!==!0&&{subagent_retry:{agent_id,attempt,max_retries,...}}

// Bash/REPL progress (no subagent_type — NOT a subagent):
type:"tool_progress", tool_use_id:e.toolUseID,
  tool_name:e.data.type==="bash_progress"?"Bash":"PowerShell",
  parent_tool_use_id:e.parentToolUseID, elapsed_time_seconds:e.data.elapsedTimeSeconds,
  task_id:e.data.taskId, session_id:X(), uuid:e.uuid

// Heartbeat (heartbeat:true, no subagent_type — NOT a subagent):
type:"tool_progress", ..., heartbeat:true
```

A `tool_progress` frame IS a subagent delegation only when `subagent_type` is a string.
Regular Bash, REPL, and heartbeat progress frames lack `subagent_type` and must return null.
`assistant` frames and `tool_use` blocks are NOT the subagent signal in this module.

`subagent_retry` absent in a progress frame means the subagent resolved (binary:
`e.data.resolved!==!0` gates the field). Final outcome (success/failure) is not
determinable from a `tool_progress` frame — `completion_unknown` gap always present.

Current status: `claude-session.mjs._handleWireObject()` drops `tool_progress` frames
(falls to `default` in the switch). The integration seam requires intercepting the raw
stream before or alongside `_handleWireObject`. The `tool_progress` observer should be
wired into `_onData` by wrapping or subclassing.

### Codex 0.154.0 — JSON schema (`codex app-server generate-json-schema --experimental`)

`collabAgentToolCall` IS present in the Codex 0.154.0 wire protocol. The authoritative
field list comes from the generated JSON schema at
`/tmp/baton-native-codex-schema-20260913/v2/ThreadReadResponse.json`.

Schema source: `definitions.CollabAgentToolCallThreadItem` (index 10 in `ThreadItem.oneOf`):

```json
{
  "required": ["agentsStates","id","receiverThreadIds","senderThreadId","status","tool","type"],
  "properties": {
    "type":             { "enum": ["collabAgentToolCall"] },
    "id":               { "description": "Unique identifier for this collab tool call.", "type": "string" },
    "tool":             { "$ref": "#/definitions/CollabAgentTool" },
    "status":           { "$ref": "#/definitions/CollabAgentToolCallStatus" },
    "senderThreadId":   { "description": "Thread ID of the agent issuing the collab request.", "type": "string" },
    "receiverThreadIds":{ "description": "Thread IDs of the receiving agents.", "type": "array", "items": {"type":"string"} },
    "agentsStates":     { "description": "Last known status of the target agents.", "type": "object",
                          "additionalProperties": { "$ref": "#/definitions/CollabAgentState" } },
    "model":            { "type": ["string","null"] },
    "prompt":           { "type": ["string","null"] },
    "reasoningEffort":  { "anyOf": [{"$ref":"#/definitions/ReasoningEffort"},{"type":"null"}] }
  }
}
```

`CollabAgentTool` enum: `spawnAgent | sendInput | resumeAgent | wait | closeAgent |
sendMessage | followupTask | interruptAgent | listAgents`

`CollabAgentToolCallStatus` enum: `inProgress | completed | failed | interrupted`

`CollabAgentStatus` enum: `pendingInit | running | interrupted | completed | errored |
shutdown | notFound`

`CollabAgentState`: `{ status: CollabAgentStatus, message?: string | null }`

**Field semantics (schema descriptions):**
- `id` — Unique identifier for this collab tool call (stable invocation ID)
- `tool` — Name of the collab tool that was invoked
- `status` — Current status of the collab tool call (invocation-level, NOT child-level)
- `senderThreadId` — Thread ID of the agent issuing the collab request
- `receiverThreadIds` — Thread IDs of the receiving agents (target children)
- `agentsStates` — `{ [childThreadId]: { status: CollabAgentStatus, message? } }`

**IMPORTANT — invocation status ≠ child status**: `item.status` (inProgress/completed/
failed/interrupted) describes the collab tool call itself. `agentsStates[id].status`
describes each child's last known state (pendingInit/running/interrupted/completed/
errored/shutdown/notFound). A completed invocation may still show children in `running`
if the snapshot is stale. Both are preserved in the observation record.

**Fields NOT in the schema**: `agentThreadId`, `agentPath`, `kind` are not in the JSON
schema and must NOT be used. Earlier binary string analysis produced false positives from
Rust serde debug strings that do not correspond to the app-server JSON protocol.

Wire item: `item/completed` notification, `params.item.type === 'collabAgentToolCall'`

**Integration seam missing**: `codex-appserver.mjs._onNotification()` drops
`collabAgentToolCall` items in the `default` case — these frames never reach Baton's event
bus in the current adapter. The `adapter_seam_missing` gap is always present on Codex
observations returned by `normalizeCodexFrame`. Root must add a case in `_onNotification`
(without editing this module) if live observation is required.

## Module exports

`impl/src/native-subagent-observations.mjs` exports:

| Export | Description |
|--------|-------------|
| `NATIVE_PHASE` | Frozen phase vocabulary: `started`, `completed`, `failed`, `unknown` |
| `normalizeOmpTaskFrame(frame, parentContext)` | OMP: only task tool frames → observation or null |
| `projectOmpParallelTasks(observations)` | Merge start+end pairs → parallel task snapshot |
| `normalizeClaudeToolProgressFrame(frame, parentContext)` | Claude: only `tool_progress` with `subagent_type` → observation or null |
| `normalizeCodexFrame(frame, parentContext)` | Codex: `collabAgentToolCall` item/completed params → observation or null |

### Observation record common fields

```
{
  harness: 'omp'|'claude-code'|'codex',
  invocationKey: string,       // JSON-tuple: JSON.stringify([harness, parentWorker, parentSessionId, childId])
  parentWorker: string|null,
  parentSessionId: string|null,
  phase: NATIVE_PHASE.*,
  nativeFrameType: string,
  provenance: 'wire_frame',
  gaps: string[],
  controls: [],                // always empty — no Baton controls on native children
  unknownFields?: object,      // top-level unknown frame fields not in known-fields set
}
```

OMP task-specific fields:
- Start: `toolCallId`, `taskAgent` (from args.agent)
- End: `toolCallId`, `childSessionFile`, `jobId`, `asyncState`, `batchResultCount?`, `ok`

Claude tool_progress-specific fields:
- `toolUseId`, `parentToolUseId`, `subagentType`, `sessionId`, `uuid`, `subagentRetry`

Codex collabAgentToolCall-specific fields:
- `collabToolCallId` (from `item.id`), `tool`, `invocationStatus`, `senderThreadId`,
  `receiverThreadIds`, `agentsStates`, `threadId`, `turnId`

### Composite invocation key encoding

`invocationKey = JSON.stringify([harness, parentWorker ?? null, parentSessionId ?? null, childId ?? null])`

JSON tuple encoding is used instead of colon concatenation. Colon-concat silently collides
when any part contains a colon (e.g. UUIDs with embedded colons, thread IDs). JSON encoding
is unambiguous for arbitrary string values and prevents namespace collisions across concurrent
parent sessions.

### Gap vocabulary

| Gap | Meaning |
|-----|---------|
| `no_stable_child_id` | No toolCallId / toolUseId / collab id in the frame |
| `parent_session_id_unknown` | parentContext.sessionId was null |
| `completion_unknown` | Sub-execution observed but no termination signal in this frame |
| `start_frame_not_retained` | End frame observed; no prior start available to merge |
| `process_ownership_unknown` | Harness manages the subprocess; Baton cannot observe it |
| `child_session_id_unknown` | No child session file or session ID available in this frame |
| `async_job_in_flight` | OMP: tool_execution_end fired but async.state='running' means job still running |
| `start_frame_missing` | (projectOmpParallelTasks orphan) End arrived without matching start |
| `adapter_seam_missing` | (Codex only) collabAgentToolCall frames dropped by codex-appserver.mjs |

## Adapter integration seams (read-only)

The following seams exist in existing modules. This module does NOT edit them.

### `omp-rpc.mjs` — `OmpRpcProcess.onFrame`

Line 138. The `onFrame` option fires for every non-ready, non-response frame. Root attaches
here to receive raw OMP wire objects and passes them to `normalizeOmpTaskFrame()`. The
`tool_execution_start`/`tool_execution_end` frames for `toolName:'task'` are the only ones
this module acts on — all other toolNames return null silently.

### `claude-session.mjs` — `_handleWireObject()`

`tool_progress` frames currently fall to `default` (dropped). Root must intercept the raw
stream at `_onData` or by wrapping `_handleWireObject` to observe `tool_progress` frames
before the switch drops them. Only frames with `subagent_type` (string) are fed to
`normalizeClaudeToolProgressFrame()`.

### `codex-appserver.mjs` — `_onNotification()`

`collabAgentToolCall` items in `item/completed` notifications currently fall to `default`
(silently ignored). Root must add a case in `_onNotification` for `item/completed` with
`item.type === 'collabAgentToolCall'` and pass the full `params` object to
`normalizeCodexFrame()`. The `adapter_seam_missing` gap marks all Codex observations until
this seam is wired.

## What this module guarantees

1. **No invented workers**: Observations record wire-visible sub-executions, not new Baton
   workers. The `controls` field is always empty.
2. **No guessed completion**: `tool_execution_start` and `tool_progress` frames produce
   `phase:'started'` with `completion_unknown`. Only a matching `tool_execution_end`
   advances the OMP phase.
3. **No guessed async completion**: OMP `tool_execution_end` with `async.state='running'`
   remains `phase:'started'` with `async_job_in_flight` gap. The task backgrounded; Baton
   cannot know when it finishes without polling (which this module does not do).
4. **No guessed session exit**: OMP `tool_execution_end` produces `phase:'completed'|'failed'`
   for the sub-execution's tool call, not a lifecycle exit for the parent session.
5. **Separate invocation and child status (Codex)**: `invocationStatus` reflects the collab
   tool call; `agentsStates` reflects each child's last known state. They are independent.
6. **Stable composite IDs**: `invocationKey` uses JSON tuple encoding, preventing namespace
   collisions across concurrent parent sessions even when IDs contain special characters.
7. **No raw frame retention**: Only specific identity fields are extracted; full args,
   result payloads, and prompt content are not stored in normalized records.
8. **Unknown fields preserved**: Top-level frame fields not in the known-fields set are
   captured in `unknownFields` so future protocol additions are not silently discarded.
9. **Honest Codex evidence**: The JSON schema from `codex app-server generate-json-schema`
   is the authoritative source. Fields absent from the schema (`agentThreadId`, `agentPath`,
   `kind`) are NOT used regardless of binary string matches in the native executable.
10. **No provider calls, polling, journals, or new dependencies**: Pure synchronous functions
    operating on already-received frame objects.
