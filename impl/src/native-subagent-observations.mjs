// native-subagent-observations.mjs — pure normalization/projection helper for native harness
// subagent observations.
//
// Baton observes native-harness child sub-executions through the PARENT session's wire frames
// only. This module normalizes those frames into honest observation records without inventing
// independently controllable Baton workers, guessing completion, or retaining raw frames.
//
// Wire evidence (installed binaries + JSON schema, 2026-09-13):
//
//   OMP 17.4.0 binary strings (/opt/homebrew/Cellar/omp/17.4.0/bin/omp, Mach-O arm64):
//     `toolName === 'task'` is the subagent discriminator.
//     Binary: `if (Ye.toolName === "task") {...}` / `const a = e.toolName === "task" && t === "running"`
//     All other toolNames (Bash, Read, Write, Grep, Edit, …) are ordinary tool calls — return null.
//     tool_execution_start: {type, toolCallId, toolName:'task', args:{agent?,context?,tasks?}}
//     tool_execution_end:   {type, toolCallId, toolName:'task', result, isError}
//     Single-task result:   result.details.{sessionFile, jobId, work}
//     Async/backgrounded:   result.details.async.{state:'running'|'completed'|'failed', jobId, type}
//       When details.async.state === 'running': tool returned but job still in-flight — phase STARTED.
//     Batch result:         result.details.{projectAgentsDir, results:[], totalDurationMs}
//       tool_execution_end fires once for whole batch; details.results has per-sub-task outcomes.
//     Binary: `details: { jobId: _, work: s, sessionFile: x }`
//     Binary: `async: { state: "running", jobId: e, type: "eval" }` (still in-flight)
//
//   Claude Code 2.1.269 binary strings (~/.local/bin/claude → Mach-O arm64):
//     `tool_progress` WITH `subagent_type` is the subagent discriminator.
//     Binary: `subagent_type:e.data.agentType` — absent from Bash/REPL/heartbeat progress frames.
//     Binary: `...e.data.resolved!==!0&&{subagent_retry:{agent_id,attempt,max_retries,...}}`
//     tool_progress (subagent):  {type:'tool_progress', tool_use_id, tool_name, parent_tool_use_id,
//                                  elapsed_time_seconds, session_id, uuid, subagent_type, subagent_retry?}
//     tool_progress (Bash/REPL): lacks subagent_type — return null
//     tool_progress (heartbeat): heartbeat:true, no subagent_type — return null
//     claude-session.mjs currently drops tool_progress (falls to default in _handleWireObject).
//
//   Codex 0.154.0 — JSON schema: codex app-server generate-json-schema
//     v2/ThreadReadResponse.json definitions.CollabAgentToolCallThreadItem (index 10 in ThreadItem.oneOf):
//     Required: id (tool call ID), tool, status, senderThreadId, receiverThreadIds, agentsStates
//     CollabAgentTool enum: spawnAgent|sendInput|resumeAgent|wait|closeAgent|sendMessage|
//                           followupTask|interruptAgent|listAgents
//     CollabAgentToolCallStatus enum: inProgress|completed|failed|interrupted
//     agentsStates: { [childThreadId]: CollabAgentState }
//     CollabAgentState: { status: CollabAgentStatus, message?: string|null }
//     CollabAgentStatus enum: pendingInit|running|interrupted|completed|errored|shutdown|notFound
//     Optional: model, prompt, reasoningEffort  (NOT in identity record — payload only)
//     NOT present: agentThreadId, agentPath, kind  (those were binary-string false positives)
//     Adapter item/started and item/completed notifications feed these observations.
//
// IDENTITY CONSTRAINTS (enforced, never invented):
//   - OMP tool_execution_start with toolName:'task' is a known child delegation, not completion.
//   - OMP tool_execution_end is NOT a whole child-session exit (parent OMP session continues).
//   - OMP tool_execution_end with details.async.state='running' means job still in-flight.
//   - Claude tool_progress with subagent_type is a known delegation — completion not observable.
//   - Codex collabAgentToolCall: invocation status (item.status) ≠ per-child status (agentsStates).
//   - No Baton controls exist for native-managed sub-executions.
//   - No polling, no provider calls, no journals, no new dependencies.

// Stable phase vocabulary
export const NATIVE_PHASE = Object.freeze({
  STARTED: 'started',
  COMPLETED: 'completed',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Composite invocation key using JSON-tuple encoding. Colon-concat would silently collide if
// any part contains a colon; JSON encoding is unambiguous for arbitrary string values.
function makeInvocationKey(harness, parentWorker, parentSessionId, invocationId) {
  return JSON.stringify([harness, parentWorker ?? null, parentSessionId ?? null, invocationId ?? null]);
}

// Record the presence of unknown protocol fields without retaining their values.
// Undocumented values may contain credentials, prompts or full tool results.
function captureUnknownFields(obj, knownFields) {
  const unknown = {};
  for (const key of Object.keys(obj)) {
    if (!knownFields.has(key)) Object.defineProperty(unknown, key, { value: true, enumerable: true });
  }
  return Object.keys(unknown).length > 0 ? unknown : null;
}

// OMP task frame known fields (top-level only; `args` and `result` are payload, not enumerated)
const OMP_TASK_START_KNOWN = new Set(['type', 'toolCallId', 'toolName', 'args']);
const OMP_TASK_END_KNOWN = new Set(['type', 'toolCallId', 'toolName', 'result', 'isError']);

// Claude tool_progress known fields (binary-verified set)
const CLAUDE_TOOL_PROGRESS_KNOWN = new Set([
  'type', 'tool_use_id', 'tool_name', 'parent_tool_use_id', 'elapsed_time_seconds',
  'session_id', 'uuid', 'subagent_type', 'subagent_retry', 'heartbeat', 'task_id',
]);

// Codex collabAgentToolCall item known fields (from v2/ThreadReadResponse.json schema)
// prompt/model/reasoningEffort are optional payload and are not identity fields — excluded
const CODEX_ITEM_PARAMS_KNOWN = new Set(['item', 'threadId', 'turnId']);
const CODEX_COLLAB_ITEM_KNOWN = new Set([
  'type', 'id', 'tool', 'status', 'senderThreadId', 'receiverThreadIds', 'agentsStates',
  'model', 'prompt', 'reasoningEffort',
]);

// ---------------------------------------------------------------------------
// OMP 17.4.0
// ---------------------------------------------------------------------------

// Derive OMP end-frame phase from the result field.
// Binary: when details.async.state === 'running' the job is still in-flight even though
// tool_execution_end fired (the tool call returned early via the async backgrounding path).
function ompEndPhase(isError, details) {
  if (isError) return NATIVE_PHASE.FAILED;
  const asyncState = details?.async?.state;
  if (typeof asyncState === 'string') {
    if (asyncState === 'running') return NATIVE_PHASE.STARTED;  // still in-flight
    if (asyncState === 'failed') return NATIVE_PHASE.FAILED;
    if (asyncState === 'completed') return NATIVE_PHASE.COMPLETED;
    // unknown async state — treat as UNKNOWN
    return NATIVE_PHASE.UNKNOWN;
  }
  // No async field: synchronous task returned — completed
  return NATIVE_PHASE.COMPLETED;
}

/**
 * Normalize a single OMP wire frame into a subagent observation record.
 *
 * Returns null for any frame that does not signal `task` tool delegation:
 *   - wrong frame type (not tool_execution_start or tool_execution_end)
 *   - toolName !== 'task' (Bash/Read/Write/Grep/Edit/… are ordinary tools, never children)
 *
 * Returns a normalized record for task tool frames only. Start frames carry
 * a `completion_unknown` gap — no end frame has arrived yet. End frames reflect
 * the async state: details.async.state='running' means still in-flight (STARTED),
 * not COMPLETED.
 *
 * @param {object} frame - raw OMP wire frame (JSONL-parsed object from omp-rpc.mjs)
 * @param {{ worker?: string|null, sessionId?: string|null }} parentContext
 * @returns {object|null}
 */
export function normalizeOmpTaskFrame(frame, parentContext) {
  if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) return null;
  if (frame.type !== 'tool_execution_start' && frame.type !== 'tool_execution_end') return null;
  // Binary evidence: `if (Ye.toolName === "task")` — only task tool spawns a child session.
  // Bash/Read/Write/Grep/Edit/… must return null.
  if (frame.toolName !== 'task') return null;

  const worker = typeof parentContext?.worker === 'string' ? parentContext.worker : null;
  const parentSessionId = typeof parentContext?.sessionId === 'string' ? parentContext.sessionId : null;
  const toolCallId = typeof frame.toolCallId === 'string' && frame.toolCallId.length > 0
    ? frame.toolCallId : null;

  // JSON-tuple key prevents colon-containing values from producing collisions.
  const invocationKey = makeInvocationKey('omp', worker, parentSessionId, toolCallId);

  const gaps = [];
  if (!toolCallId) gaps.push('no_stable_child_id');
  if (!parentSessionId) gaps.push('parent_session_id_unknown');

  if (frame.type === 'tool_execution_start') {
    // Extract minimal identification from args (agent type only — full args may contain
    // large context/prompt payloads and are not retained).
    const taskAgent = frame.args !== null && typeof frame.args === 'object' && !Array.isArray(frame.args)
      ? (typeof frame.args.agent === 'string' ? frame.args.agent : null)
      : null;
    const unknownFields = captureUnknownFields(frame, OMP_TASK_START_KNOWN);
    return {
      harness: 'omp',
      invocationKey,
      parentWorker: worker,
      parentSessionId,
      toolCallId,
      taskAgent,
      // Start alone does not constitute a known completion, session file, or process ownership.
      phase: NATIVE_PHASE.STARTED,
      nativeFrameType: 'tool_execution_start',
      provenance: 'wire_frame',
      gaps: [...gaps, 'completion_unknown', 'process_ownership_unknown', 'child_session_id_unknown'],
      controls: [],
      ...(unknownFields ? { unknownFields } : {}),
    };
  }

  // tool_execution_end: the task tool call settled. This is NOT a parent-session exit.
  // Binary evidence: `details: { jobId: _, work: s, sessionFile: x }`
  // Async backgrounded: `details.async.{state, jobId, type}` — 'running' means still in-flight.
  const details = frame.result !== null && typeof frame.result === 'object'
    ? (frame.result.details !== null && typeof frame.result.details === 'object'
      ? frame.result.details : null)
    : null;
  const childSessionFile = typeof details?.sessionFile === 'string' ? details.sessionFile : null;
  const jobId = details?.jobId ?? details?.async?.jobId ?? null;
  const normalizedJobId = typeof jobId === 'string' || (typeof jobId === 'number' && Number.isFinite(jobId))
    ? jobId : null;
  const asyncState = typeof details?.async?.state === 'string' ? details.async.state : null;
  const isError = frame.isError === true;

  // Batch mode: result.details.results[] contains per-sub-task outcomes.
  // We do not retain the full array (may be large) but record the count.
  const batchResultCount = Array.isArray(details?.results) ? details.results.length : null;

  const phase = ompEndPhase(isError, details);

  const endGaps = [...gaps, 'start_frame_not_retained', 'process_ownership_unknown'];
  if (!childSessionFile) endGaps.push('child_session_id_unknown');
  // When async.state='running', the job is still in-flight despite tool_execution_end firing.
  if (asyncState === 'running') endGaps.push('async_job_in_flight');

  const unknownFields = captureUnknownFields(frame, OMP_TASK_END_KNOWN);
  return {
    harness: 'omp',
    invocationKey,
    parentWorker: worker,
    parentSessionId,
    toolCallId,
    childSessionFile,
    jobId: normalizedJobId,
    asyncState,
    ...(batchResultCount !== null ? { batchResultCount } : {}),
    phase,
    nativeFrameType: 'tool_execution_end',
    provenance: 'wire_frame',
    ok: phase === NATIVE_PHASE.COMPLETED ? true : phase === NATIVE_PHASE.FAILED ? false : null,
    invocationOk: !isError,
    gaps: endGaps,
    controls: [],
    ...(unknownFields ? { unknownFields } : {}),
  };
}

// ---------------------------------------------------------------------------
// OMP parallel-task projection
// ---------------------------------------------------------------------------

/**
 * Project a sequence of normalized OMP task observations into a parallel-task snapshot.
 *
 * Merges start+end pairs by invocationKey. Handles:
 *   - Out-of-order delivery: an end before its start is an orphan
 *   - Duplicate starts: contradictory gap recorded, last start wins
 *   - Contradictory ends: duplicate_end gap recorded
 *   - Incremental completion: partial results before all ends arrive
 *
 * Pure function — no side effects, no external state.
 *
 * @param {object[]} observations - records from normalizeOmpTaskFrame (nulls skipped)
 * @returns {{ active: object[], completed: object[], failed: object[], orphanEnds: object[], gaps: string[] }}
 */
export function projectOmpParallelTasks(observations) {
  const byInvocationKey = new Map();
  const orphanEnds = [];
  const projectionGaps = [];

  for (const obs of observations) {
    if (obs === null || typeof obs !== 'object') continue;
    if (obs.harness !== 'omp') continue;

    const key = obs.invocationKey;

    if (obs.nativeFrameType === 'tool_execution_start') {
      if (byInvocationKey.has(key)) {
        projectionGaps.push(`duplicate_start:${obs.toolCallId ?? 'no_id'}`);
      }
      byInvocationKey.set(key, obs);

    } else if (obs.nativeFrameType === 'tool_execution_end') {
      const prior = byInvocationKey.get(key);
      if (prior && prior.nativeFrameType === 'tool_execution_start') {
        // Merge: combine start + end, remove transient gaps from each side
        const mergedGaps = [
          ...prior.gaps.filter((g) => g !== 'completion_unknown'),
          ...obs.gaps.filter((g) => g !== 'start_frame_not_retained'),
        ];
        byInvocationKey.set(key, {
          ...prior,
          // End-frame fields override start-frame fields for final state
          phase: obs.phase,
          nativeFrameType: 'tool_execution_end',
          childSessionFile: obs.childSessionFile,
          jobId: obs.jobId,
          asyncState: obs.asyncState,
          ...(obs.batchResultCount !== null && obs.batchResultCount !== undefined
            ? { batchResultCount: obs.batchResultCount } : {}),
          ok: obs.ok,
          gaps: [...new Set(mergedGaps)],
          ...(obs.unknownFields ? { unknownFieldsEnd: obs.unknownFields } : {}),
        });
      } else if (prior && prior.nativeFrameType === 'tool_execution_end') {
        projectionGaps.push(`duplicate_end:${obs.toolCallId ?? 'no_id'}`);
      } else {
        // End arrived with no matching start: orphan
        orphanEnds.push({ ...obs, gaps: [...obs.gaps, 'start_frame_missing'] });
        projectionGaps.push(`orphan_end:${obs.toolCallId ?? 'no_id'}`);
      }
    }
  }

  const active = [];
  const completed = [];
  const failed = [];

  for (const obs of byInvocationKey.values()) {
    switch (obs.phase) {
      case NATIVE_PHASE.STARTED:
      case NATIVE_PHASE.UNKNOWN:
        active.push(obs);
        break;
      case NATIVE_PHASE.COMPLETED:
        completed.push(obs);
        break;
      case NATIVE_PHASE.FAILED:
        failed.push(obs);
        break;
      default:
        active.push(obs);
    }
  }

  return { active, completed, failed, orphanEnds, gaps: projectionGaps };
}

// ---------------------------------------------------------------------------
// Claude Code 2.1.269
// ---------------------------------------------------------------------------

/**
 * Normalize a Claude Code `tool_progress` wire frame into a subagent observation record.
 *
 * Binary evidence: only `tool_progress` frames that contain `subagent_type` represent
 * native subagent delegation. Regular Bash/REPL/heartbeat progress frames lack this field
 * and must return null.
 *
 * Returns null for:
 *   - any frame type other than 'tool_progress'
 *   - tool_progress frames without a string `subagent_type` (Bash, REPL, heartbeat)
 *   - assistant / tool_use / result / system frames (never subagent evidence in this module)
 *
 * claude-session.mjs calls this at its wire boundary, before ordinary tool handling.
 *
 * @param {object} frame - raw Claude Code stream-json wire frame
 * @param {{ worker?: string|null, sessionId?: string|null }} parentContext
 * @returns {object|null}
 */
export function normalizeClaudeToolProgressFrame(frame, parentContext) {
  if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) return null;
  if (frame.type !== 'tool_progress') return null;
  // Binary evidence: `subagent_type:e.data.agentType` — absent from Bash/REPL/heartbeat frames.
  // A tool_progress frame is a subagent delegation ONLY if it carries a string subagent_type.
  if (typeof frame.subagent_type !== 'string') return null;

  const worker = typeof parentContext?.worker === 'string' ? parentContext.worker : null;
  const parentSessionId = typeof parentContext?.sessionId === 'string' ? parentContext.sessionId : null;
  const toolUseId = typeof frame.tool_use_id === 'string' && frame.tool_use_id.length > 0
    ? frame.tool_use_id : null;

  // JSON-tuple key: stable per-invocation handle, namespace-safe across parent sessions.
  const invocationKey = makeInvocationKey('claude-code', worker, parentSessionId, toolUseId);

  const gaps = [];
  if (!toolUseId) gaps.push('no_stable_child_id');
  if (!parentSessionId) gaps.push('parent_session_id_unknown');

  // Binary evidence: `...e.data.resolved!==!0&&{subagent_retry:{agent_id,attempt,max_retries,...}}`
  // subagent_retry present → subagent is being retried or still in flight
  // subagent_retry absent → subagent resolved (outcome not observable from progress frame alone)
  const subagentRetry = frame.subagent_retry !== undefined
    ? (typeof frame.subagent_retry === 'object' && frame.subagent_retry !== null
      ? Object.fromEntries(['agent_id', 'attempt', 'max_retries'].flatMap((key) => {
        const value = frame.subagent_retry[key];
        return typeof value === 'string' || Number.isSafeInteger(value) ? [[key, value]] : [];
      })) : null)
    : null;

  const unknownFields = captureUnknownFields(frame, CLAUDE_TOOL_PROGRESS_KNOWN);

  return {
    harness: 'claude-code',
    invocationKey,
    parentWorker: worker,
    parentSessionId,
    toolUseId,
    parentToolUseId: typeof frame.parent_tool_use_id === 'string' ? frame.parent_tool_use_id : null,
    subagentType: frame.subagent_type,
    // session_id in the frame is the emitting (parent) session's context, not the child session.
    // Stored for reference; child session identity is not observable from progress frames alone.
    sessionId: typeof frame.session_id === 'string' ? frame.session_id : null,
    uuid: typeof frame.uuid === 'string' ? frame.uuid : null,
    subagentRetry,
    // tool_progress is an in-flight observation; final outcome is not determinable here.
    phase: NATIVE_PHASE.STARTED,
    nativeFrameType: 'tool_progress',
    provenance: 'wire_frame',
    gaps: [...gaps, 'completion_unknown', 'process_ownership_unknown', 'child_session_id_unknown'],
    controls: [],
    ...(unknownFields ? { unknownFields } : {}),
  };
}

// ---------------------------------------------------------------------------
// Codex 0.154.0
// ---------------------------------------------------------------------------

// Map CollabAgentToolCallStatus to NATIVE_PHASE.
// Schema: inProgress|completed|failed|interrupted
function collabStatusToPhase(status) {
  if (status === 'completed') return NATIVE_PHASE.COMPLETED;
  if (status === 'failed') return NATIVE_PHASE.FAILED;
  if (status === 'inProgress' || status === 'interrupted') return NATIVE_PHASE.STARTED;
  return NATIVE_PHASE.UNKNOWN;
}

/**
 * Normalize a Codex `item/completed` notification params into a subagent observation.
 *
 * Schema source: codex app-server generate-json-schema --experimental
 *   v2/ThreadReadResponse.json → definitions.ThreadItem → oneOf[10] (CollabAgentToolCallThreadItem)
 *
 * Required schema fields: id, tool, status, senderThreadId, receiverThreadIds, agentsStates
 * The `frame` parameter is the JSON-RPC `item/completed` notification params:
 *   { item: { type:'collabAgentToolCall', id, tool, status, senderThreadId,
 *             receiverThreadIds, agentsStates }, threadId, turnId }
 *
 * Field semantics (from schema descriptions):
 *   id:               Unique identifier for this collab tool call → stable invocation ID
 *   tool:             Name of the collab tool (spawnAgent/sendInput/resumeAgent/…)
 *   status:           Invocation status (inProgress/completed/failed/interrupted)
 *   senderThreadId:   Thread ID of the agent issuing the collab request
 *   receiverThreadIds: Thread IDs of the receiving agents
 *   agentsStates:     Last known status of the target agents {[childThreadId]: {status, message?}}
 *
 * NOTE: invocation status (item.status) and per-child status (agentsStates[id].status) are
 * separate. A completed invocation may still show children with running/pendingInit status
 * if the snapshot is stale. Both are preserved in the observation.
 *
 * Returns null for all other frame types.
 *
 * codex-appserver.mjs calls this for item/started and item/completed notifications.
 *
 * @param {object} frame - JSON-RPC item/completed params from Codex app-server
 * @param {{ worker?: string|null, sessionId?: string|null }} parentContext
 * @returns {object|null}
 */
export function normalizeCodexFrame(frame, parentContext) {
  if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) return null;
  const item = frame.item;
  // Schema: type discriminant for collabAgentToolCall variant.
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (item.type !== 'collabAgentToolCall') return null;

  const worker = typeof parentContext?.worker === 'string' ? parentContext.worker : null;
  const parentSessionId = typeof parentContext?.sessionId === 'string' ? parentContext.sessionId : null;

  // Schema: `id` is the unique identifier for this collab tool call. Required field.
  const collabToolCallId = typeof item.id === 'string' && item.id.length > 0 ? item.id : null;
  // JSON-tuple key using the tool call ID as the stable per-invocation handle.
  const invocationKey = makeInvocationKey('codex', worker, parentSessionId, collabToolCallId);

  // Schema: `tool` — CollabAgentTool enum value
  const tool = typeof item.tool === 'string' ? item.tool : null;
  // Schema: `status` — CollabAgentToolCallStatus (invocation level, not child level)
  const invocationStatus = typeof item.status === 'string' ? item.status : null;
  // Schema: `senderThreadId` — required string
  const senderThreadId = typeof item.senderThreadId === 'string' ? item.senderThreadId : null;
  // Schema: `receiverThreadIds` — required array of strings; child target identities
  const receiverThreadIds = Array.isArray(item.receiverThreadIds)
    ? item.receiverThreadIds.filter((id) => typeof id === 'string' && id.length) : [];
  // Schema: `agentsStates` — required object; { [childThreadId]: {status, message?} }
  // Per-child status is SEPARATE from invocation status — both are preserved.
  const agentsStates = item.agentsStates !== null && typeof item.agentsStates === 'object' && !Array.isArray(item.agentsStates)
    ? Object.fromEntries(Object.entries(item.agentsStates).map(([id, state]) => [id, {
      status: typeof state?.status === 'string' ? state.status : 'unknown',
      ...(typeof state?.message === 'string' || state?.message === null ? { message: state.message } : {}),
    }])) : {};

  const gaps = [];
  if (!collabToolCallId) gaps.push('no_stable_child_id');
  if (!parentSessionId) gaps.push('parent_session_id_unknown');

  const itemUnknownFields = captureUnknownFields(item, CODEX_COLLAB_ITEM_KNOWN);
  const paramsUnknownFields = captureUnknownFields(frame, CODEX_ITEM_PARAMS_KNOWN);

  return {
    harness: 'codex',
    invocationKey,
    parentWorker: worker,
    parentSessionId,
    collabToolCallId,
    tool,
    // Invocation-level status (inProgress/completed/failed/interrupted).
    // Not the same as per-child status in agentsStates.
    invocationStatus,
    senderThreadId,
    // Target children (populated from receiverThreadIds per schema description:
    // "Thread ID of the receiving agent, when applicable.")
    receiverThreadIds,
    // Per-child status snapshot (CollabAgentState: {status, message?}).
    // CollabAgentStatus enum: pendingInit|running|interrupted|completed|errored|shutdown|notFound
    agentsStates,
    turnId: typeof frame.turnId === 'string' ? frame.turnId : null,
    threadId: typeof frame.threadId === 'string' ? frame.threadId : null,
    // Phase derived from invocation status. Child-level completion is tracked in agentsStates.
    phase: collabStatusToPhase(invocationStatus),
    nativeFrameType: 'collabAgentToolCall',
    provenance: 'wire_frame',
    gaps,
    controls: [],
    ...(itemUnknownFields ? { unknownFields: itemUnknownFields } : {}),
    ...(paramsUnknownFields ? { unknownParamsFields: paramsUnknownFields } : {}),
  };
}
