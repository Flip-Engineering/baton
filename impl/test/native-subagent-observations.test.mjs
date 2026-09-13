// native-subagent-observations.test.mjs
// Execution: node --test impl/test/native-subagent-observations.test.mjs
//
// Fixtures are grounded in actual installed binary evidence and JSON schema:
//   OMP 17.4.0: /opt/homebrew/Cellar/omp/17.4.0/bin/omp (Mach-O arm64 binary strings)
//   Claude 2.1.269: ~/.local/bin/claude (Mach-O arm64 binary strings)
//   Codex 0.154.0: codex app-server generate-json-schema --experimental
//     → /tmp/baton-native-codex-schema-20260913/v2/ThreadReadResponse.json

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_PHASE,
  normalizeOmpTaskFrame,
  projectOmpParallelTasks,
  normalizeClaudeToolProgressFrame,
  normalizeCodexFrame,
} from '../src/native-subagent-observations.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// OMP task tool_execution_start (binary: if (Ye.toolName === "task") {...})
const OMP_TASK_START = {
  type: 'tool_execution_start',
  toolCallId: 'tcid-001',
  toolName: 'task',
  args: { agent: 'claude-sonnet', context: 'Implement feature X' },
};

// OMP Bash tool_execution_start — must return null (ordinary tool, not a child)
const OMP_BASH_START = {
  type: 'tool_execution_start',
  toolCallId: 'tcid-bash-1',
  toolName: 'Bash',
  args: { command: 'ls -la' },
};

// OMP task tool_execution_end (sync, no async, no error)
// Binary: details: { jobId: _, work: s, sessionFile: x }
const OMP_TASK_END_SYNC = {
  type: 'tool_execution_end',
  toolCallId: 'tcid-001',
  toolName: 'task',
  result: {
    details: {
      sessionFile: '/tmp/omp-sessions/session-abc.json',
      jobId: 'job-42',
      work: 'done',
    },
  },
  isError: false,
};

// OMP task tool_execution_end with async.state = 'running' (binary: async:{state:"running",...})
// This means the job is STILL IN-FLIGHT — phase must be STARTED, not COMPLETED.
const OMP_TASK_END_ASYNC_RUNNING = {
  type: 'tool_execution_end',
  toolCallId: 'tcid-002',
  toolName: 'task',
  result: {
    details: {
      async: { state: 'running', jobId: 'async-job-7', type: 'eval' },
    },
  },
  isError: false,
};

// OMP task tool_execution_end with async.state = 'completed'
const OMP_TASK_END_ASYNC_COMPLETED = {
  type: 'tool_execution_end',
  toolCallId: 'tcid-003',
  toolName: 'task',
  result: {
    details: {
      async: { state: 'completed', jobId: 'async-job-8', type: 'eval' },
      sessionFile: '/tmp/omp-sessions/session-xyz.json',
    },
  },
  isError: false,
};

// OMP task tool_execution_end with async.state = 'failed'
const OMP_TASK_END_ASYNC_FAILED = {
  type: 'tool_execution_end',
  toolCallId: 'tcid-004',
  toolName: 'task',
  result: {
    details: {
      async: { state: 'failed', jobId: 'async-job-9', type: 'bash' },
    },
  },
  isError: false,
};

// OMP task tool_execution_end with isError=true
const OMP_TASK_END_ERROR = {
  type: 'tool_execution_end',
  toolCallId: 'tcid-005',
  toolName: 'task',
  result: { details: null },
  isError: true,
};

// OMP batch task: result.details.results[] present
// Binary: details: { projectAgentsDir: null, results: [], totalDurationMs: 0 }
const OMP_TASK_END_BATCH = {
  type: 'tool_execution_end',
  toolCallId: 'tcid-006',
  toolName: 'task',
  result: {
    details: {
      projectAgentsDir: null,
      results: [
        { exitCode: 0, status: 'completed', sessionFile: '/tmp/omp-sessions/s-1.json' },
        { exitCode: 0, status: 'completed', sessionFile: '/tmp/omp-sessions/s-2.json' },
        { exitCode: 1, status: 'cancelled', sessionFile: '/tmp/omp-sessions/s-3.json' },
      ],
      totalDurationMs: 4200,
    },
  },
  isError: false,
};

// Parent context
const PARENT = { worker: 'worker-1', sessionId: 'omp-session-parent-X' };

// Claude Code tool_progress with subagent_type (subagent delegation)
// Binary: subagent_type:e.data.agentType
const CLAUDE_SUBAGENT_PROGRESS = {
  type: 'tool_progress',
  tool_use_id: 'toolu_abc123',
  tool_name: 'Task',
  parent_tool_use_id: 'toolu_parent_456',
  elapsed_time_seconds: 0,
  session_id: 'sess-claude-parent',
  uuid: 'uuid-ef01',
  subagent_type: 'claude',
};

// Claude tool_progress with subagent_retry present (still in-flight)
// Binary: ...e.data.resolved!==!0&&{subagent_retry:{agent_id,attempt,max_retries,...}}
const CLAUDE_SUBAGENT_PROGRESS_RETRY = {
  type: 'tool_progress',
  tool_use_id: 'toolu_abc999',
  tool_name: 'Task',
  parent_tool_use_id: 'toolu_parent_456',
  elapsed_time_seconds: 0,
  session_id: 'sess-claude-parent',
  uuid: 'uuid-ef02',
  subagent_type: 'claude',
  subagent_retry: { agent_id: 'ag-1', attempt: 2, max_retries: 3 },
};

// Claude tool_progress without subagent_type (Bash progress — must return null)
// Binary: type:"tool_progress", ..., task_id:e.data.taskId — NO subagent_type
const CLAUDE_BASH_PROGRESS = {
  type: 'tool_progress',
  tool_use_id: 'toolu_bash1',
  tool_name: 'Bash',
  parent_tool_use_id: 'toolu_parent_789',
  elapsed_time_seconds: 1.5,
  task_id: 'task-bash-1',
  session_id: 'sess-claude-parent',
  uuid: 'uuid-bash-1',
};

// Claude tool_progress heartbeat (heartbeat:true, no subagent_type — must return null)
const CLAUDE_HEARTBEAT = {
  type: 'tool_progress',
  tool_use_id: 'toolu_hb1',
  tool_name: 'Task',
  session_id: 'sess-claude-parent',
  uuid: 'uuid-hb-1',
  heartbeat: true,
};

// Claude non-progress frames — all must return null (not subagent evidence)
const CLAUDE_ASSISTANT_FRAME = { type: 'assistant', message: { content: [] } };
const CLAUDE_TOOL_USE_FRAME = { type: 'tool_use', id: 'toolu_xyz', name: 'Bash', input: {} };

const CLAUDE_PARENT = { worker: 'w-claude', sessionId: 'claude-sess-parent' };

// Codex collabAgentToolCall item/completed params
// Schema: v2/ThreadReadResponse.json → CollabAgentToolCallThreadItem
// Required: id, tool, status, senderThreadId, receiverThreadIds, agentsStates, type
const CODEX_COLLAB_SPAWN = {
  item: {
    type: 'collabAgentToolCall',
    id: 'collab-call-id-001',
    tool: 'spawnAgent',
    status: 'inProgress',
    senderThreadId: 'thread-parent-1',
    receiverThreadIds: ['thread-child-A'],
    agentsStates: {
      'thread-child-A': { status: 'pendingInit', message: null },
    },
  },
  threadId: 'thread-parent-1',
  turnId: 'turn-42',
};

// Codex collabAgentToolCall with completed invocation and running child
// Demonstrates invocation status ≠ child status
const CODEX_COLLAB_COMPLETED_RUNNING_CHILD = {
  item: {
    type: 'collabAgentToolCall',
    id: 'collab-call-id-002',
    tool: 'sendInput',
    status: 'completed',
    senderThreadId: 'thread-parent-1',
    receiverThreadIds: ['thread-child-B', 'thread-child-C'],
    agentsStates: {
      'thread-child-B': { status: 'running', message: null },
      'thread-child-C': { status: 'completed', message: null },
    },
  },
  threadId: 'thread-parent-1',
  turnId: 'turn-43',
};

// Codex collabAgentToolCall failed invocation
const CODEX_COLLAB_FAILED = {
  item: {
    type: 'collabAgentToolCall',
    id: 'collab-call-id-003',
    tool: 'interruptAgent',
    status: 'failed',
    senderThreadId: 'thread-parent-2',
    receiverThreadIds: ['thread-child-D'],
    agentsStates: {
      'thread-child-D': { status: 'interrupted', message: 'timed out' },
    },
  },
  threadId: 'thread-parent-2',
  turnId: 'turn-44',
};

// Codex collabAgentToolCall interrupted (maps to STARTED — still in-flight)
const CODEX_COLLAB_INTERRUPTED = {
  item: {
    type: 'collabAgentToolCall',
    id: 'collab-call-id-004',
    tool: 'closeAgent',
    status: 'interrupted',
    senderThreadId: 'thread-parent-2',
    receiverThreadIds: ['thread-child-E'],
    agentsStates: {
      'thread-child-E': { status: 'interrupted', message: null },
    },
  },
  threadId: 'thread-parent-2',
  turnId: 'turn-45',
};

// Codex non-collabAgentToolCall items — must return null
const CODEX_OTHER_ITEM = {
  item: { type: 'agentMessage', content: 'hello', threadId: 't1' },
  threadId: 't1', turnId: 'turn-1',
};

const CODEX_PARENT = { worker: 'codex-worker-1', sessionId: 'codex-sess-parent' };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function parseKey(key) {
  return JSON.parse(key);
}

// ---------------------------------------------------------------------------
// NATIVE_PHASE
// ---------------------------------------------------------------------------

describe('NATIVE_PHASE', () => {
  it('exports frozen vocabulary', () => {
    assert.strictEqual(NATIVE_PHASE.STARTED, 'started');
    assert.strictEqual(NATIVE_PHASE.COMPLETED, 'completed');
    assert.strictEqual(NATIVE_PHASE.FAILED, 'failed');
    assert.strictEqual(NATIVE_PHASE.UNKNOWN, 'unknown');
    assert.throws(() => { NATIVE_PHASE.NEW = 'new'; });
  });
});

// ---------------------------------------------------------------------------
// normalizeOmpTaskFrame
// ---------------------------------------------------------------------------

describe('normalizeOmpTaskFrame — null returns', () => {
  it('returns null for null', () => {
    assert.strictEqual(normalizeOmpTaskFrame(null, PARENT), null);
  });

  it('returns null for non-object', () => {
    assert.strictEqual(normalizeOmpTaskFrame('string', PARENT), null);
    assert.strictEqual(normalizeOmpTaskFrame(42, PARENT), null);
  });

  it('returns null for array', () => {
    assert.strictEqual(normalizeOmpTaskFrame([], PARENT), null);
  });

  it('returns null for wrong frame type', () => {
    assert.strictEqual(
      normalizeOmpTaskFrame({ type: 'some_event', toolCallId: 'x', toolName: 'task' }, PARENT),
      null,
    );
  });

  it('returns null for Bash tool_execution_start (not a child)', () => {
    assert.strictEqual(normalizeOmpTaskFrame(OMP_BASH_START, PARENT), null);
  });

  it('returns null for Read tool_execution_start', () => {
    assert.strictEqual(
      normalizeOmpTaskFrame({ type: 'tool_execution_start', toolCallId: 'r1', toolName: 'Read', args: {} }, PARENT),
      null,
    );
  });

  it('returns null for Write tool_execution_end', () => {
    assert.strictEqual(
      normalizeOmpTaskFrame(
        { type: 'tool_execution_end', toolCallId: 'w1', toolName: 'Write', result: {}, isError: false },
        PARENT,
      ),
      null,
    );
  });

  it('returns null for tool_execution_start with toolName missing', () => {
    assert.strictEqual(
      normalizeOmpTaskFrame({ type: 'tool_execution_start', toolCallId: 'x1' }, PARENT),
      null,
    );
  });
});

describe('normalizeOmpTaskFrame — start frames', () => {
  it('returns observation for task tool_execution_start', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    assert.ok(obs !== null);
    assert.strictEqual(obs.harness, 'omp');
    assert.strictEqual(obs.nativeFrameType, 'tool_execution_start');
    assert.strictEqual(obs.phase, NATIVE_PHASE.STARTED);
    assert.strictEqual(obs.provenance, 'wire_frame');
  });

  it('start invocationKey uses JSON tuple encoding', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    const parts = parseKey(obs.invocationKey);
    assert.deepStrictEqual(parts, ['omp', 'worker-1', 'omp-session-parent-X', 'tcid-001']);
  });

  it('start carries toolCallId and taskAgent', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    assert.strictEqual(obs.toolCallId, 'tcid-001');
    assert.strictEqual(obs.taskAgent, 'claude-sonnet');
  });

  it('start gaps include completion_unknown and child_session_id_unknown', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    assert.ok(obs.gaps.includes('completion_unknown'));
    assert.ok(obs.gaps.includes('child_session_id_unknown'));
    assert.ok(obs.gaps.includes('process_ownership_unknown'));
  });

  it('controls is always empty array', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    assert.deepStrictEqual(obs.controls, []);
  });

  it('does NOT retain full args in the record', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    assert.strictEqual(obs.args, undefined);
  });

  it('handles missing context: null parentContext', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, null);
    assert.strictEqual(obs.parentWorker, null);
    assert.strictEqual(obs.parentSessionId, null);
    const parts = parseKey(obs.invocationKey);
    assert.strictEqual(parts[1], null);
    assert.strictEqual(parts[2], null);
    assert.ok(obs.gaps.includes('parent_session_id_unknown'));
  });

  it('handles missing context: empty object', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, {});
    assert.strictEqual(obs.parentWorker, null);
    assert.strictEqual(obs.parentSessionId, null);
  });

  it('taskAgent is null when args lacks agent field', () => {
    const frame = { ...OMP_TASK_START, args: { context: 'no agent here' } };
    const obs = normalizeOmpTaskFrame(frame, PARENT);
    assert.strictEqual(obs.taskAgent, null);
  });
});

describe('normalizeOmpTaskFrame — end frames: synchronous', () => {
  it('sync end maps to COMPLETED when no error and no async field', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    assert.ok(obs !== null);
    assert.strictEqual(obs.phase, NATIVE_PHASE.COMPLETED);
    assert.strictEqual(obs.ok, true);
  });

  it('sync end carries childSessionFile and jobId', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    assert.strictEqual(obs.childSessionFile, '/tmp/omp-sessions/session-abc.json');
    assert.strictEqual(obs.jobId, 'job-42');
  });

  it('sync end invocationKey matches start invocationKey for same toolCallId', () => {
    const startObs = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    const endObs = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    assert.strictEqual(startObs.invocationKey, endObs.invocationKey);
  });

  it('isError true maps to FAILED and ok=false', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_ERROR, PARENT);
    assert.strictEqual(obs.phase, NATIVE_PHASE.FAILED);
    assert.strictEqual(obs.ok, false);
  });

  it('end gaps include start_frame_not_retained', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    assert.ok(obs.gaps.includes('start_frame_not_retained'));
  });

  it('does NOT retain result payload in the record', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    assert.strictEqual(obs.result, undefined);
  });
});

describe('normalizeOmpTaskFrame — end frames: async state', () => {
  it('async.state=running → STARTED (job still in-flight)', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_ASYNC_RUNNING, PARENT);
    assert.ok(obs !== null);
    assert.strictEqual(obs.phase, NATIVE_PHASE.STARTED,
      'tool_execution_end with async.state=running must remain STARTED, not COMPLETED');
  });

  it('async.state=running → ok is false (not settled)', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_ASYNC_RUNNING, PARENT);
    assert.strictEqual(obs.ok, false);
  });

  it('async.state=running → gap async_job_in_flight present', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_ASYNC_RUNNING, PARENT);
    assert.ok(obs.gaps.includes('async_job_in_flight'),
      'async_job_in_flight gap must be present when job is still running');
  });

  it('async.state=running → asyncState field preserved', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_ASYNC_RUNNING, PARENT);
    assert.strictEqual(obs.asyncState, 'running');
    assert.strictEqual(obs.jobId, 'async-job-7');
  });

  it('async.state=completed → COMPLETED', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_ASYNC_COMPLETED, PARENT);
    assert.strictEqual(obs.phase, NATIVE_PHASE.COMPLETED);
    assert.strictEqual(obs.ok, true);
  });

  it('async.state=completed → no async_job_in_flight gap', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_ASYNC_COMPLETED, PARENT);
    assert.ok(!obs.gaps.includes('async_job_in_flight'));
  });

  it('async.state=failed → FAILED and ok=false', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_ASYNC_FAILED, PARENT);
    assert.strictEqual(obs.phase, NATIVE_PHASE.FAILED);
    assert.strictEqual(obs.ok, false);
  });

  it('isError takes priority over async state for FAILED', () => {
    const frame = {
      ...OMP_TASK_END_ASYNC_RUNNING,
      isError: true,
    };
    const obs = normalizeOmpTaskFrame(frame, PARENT);
    // isError overrides async.state — always FAILED when isError=true
    assert.strictEqual(obs.phase, NATIVE_PHASE.FAILED);
  });
});

describe('normalizeOmpTaskFrame — batch results', () => {
  it('batch: batchResultCount matches results array length', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_BATCH, PARENT);
    assert.ok(obs !== null);
    assert.strictEqual(obs.batchResultCount, 3);
  });

  it('batch: does NOT retain the results array itself', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_BATCH, PARENT);
    assert.strictEqual(obs.result, undefined);
    assert.ok(!('results' in obs));
  });

  it('batch: phase is COMPLETED when no error (sync, no async field)', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_BATCH, PARENT);
    assert.strictEqual(obs.phase, NATIVE_PHASE.COMPLETED);
  });

  it('non-batch end has no batchResultCount', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    assert.ok(!('batchResultCount' in obs));
  });
});

describe('normalizeOmpTaskFrame — invocationKey collision prevention', () => {
  it('same toolCallId in different parent sessions → different keys', () => {
    const parentA = { worker: 'w1', sessionId: 'sess-A' };
    const parentB = { worker: 'w1', sessionId: 'sess-B' };
    const obsA = normalizeOmpTaskFrame(OMP_TASK_START, parentA);
    const obsB = normalizeOmpTaskFrame(OMP_TASK_START, parentB);
    assert.notStrictEqual(obsA.invocationKey, obsB.invocationKey);
  });

  it('same toolCallId in different workers → different keys', () => {
    const parentA = { worker: 'w1', sessionId: 'sess-X' };
    const parentB = { worker: 'w2', sessionId: 'sess-X' };
    const obsA = normalizeOmpTaskFrame(OMP_TASK_START, parentA);
    const obsB = normalizeOmpTaskFrame(OMP_TASK_START, parentB);
    assert.notStrictEqual(obsA.invocationKey, obsB.invocationKey);
  });

  it('key parts containing colons are unambiguous via JSON tuple encoding', () => {
    // A toolCallId with a colon must not produce a key that collides with
    // another combination when using naive colon concatenation
    const frameColon = { ...OMP_TASK_START, toolCallId: 'w1:sess-X:extra' };
    const parentSplit = { worker: 'w1', sessionId: 'sess-X' };
    const parentNormal = { worker: 'w1:sess-X', sessionId: 'extra' };
    const obsA = normalizeOmpTaskFrame(frameColon, parentSplit);
    const obsB = normalizeOmpTaskFrame({ ...OMP_TASK_START, toolCallId: 'tcid-001' }, parentNormal);
    // Different logical meanings — must not collide
    assert.notStrictEqual(obsA.invocationKey, obsB.invocationKey);
  });
});

describe('normalizeOmpTaskFrame — unknown field capture', () => {
  it('captures extra top-level fields not in known set', () => {
    const frame = { ...OMP_TASK_START, undocumentedField: 'future_value' };
    const obs = normalizeOmpTaskFrame(frame, PARENT);
    assert.ok(obs.unknownFields);
    assert.strictEqual(obs.unknownFields.undocumentedField, 'future_value');
  });

  it('no unknownFields when all fields are known', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    assert.strictEqual(obs.unknownFields, undefined);
  });
});

// ---------------------------------------------------------------------------
// projectOmpParallelTasks
// ---------------------------------------------------------------------------

describe('projectOmpParallelTasks', () => {
  it('returns empty buckets for empty input', () => {
    const result = projectOmpParallelTasks([]);
    assert.deepStrictEqual(result.active, []);
    assert.deepStrictEqual(result.completed, []);
    assert.deepStrictEqual(result.failed, []);
    assert.deepStrictEqual(result.orphanEnds, []);
    assert.deepStrictEqual(result.gaps, []);
  });

  it('start-only → active', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    const result = projectOmpParallelTasks([obs]);
    assert.strictEqual(result.active.length, 1);
    assert.strictEqual(result.completed.length, 0);
  });

  it('start + sync end → completed, removes completion_unknown gap', () => {
    const start = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    const end = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    const result = projectOmpParallelTasks([start, end]);
    assert.strictEqual(result.completed.length, 1);
    assert.strictEqual(result.active.length, 0);
    const merged = result.completed[0];
    assert.ok(!merged.gaps.includes('completion_unknown'));
    assert.ok(!merged.gaps.includes('start_frame_not_retained'));
  });

  it('start + end with async.state=running → active (still in-flight)', () => {
    const startFrame = { ...OMP_TASK_START, toolCallId: 'tcid-002' };
    const start = normalizeOmpTaskFrame(startFrame, PARENT);
    const end = normalizeOmpTaskFrame(OMP_TASK_END_ASYNC_RUNNING, PARENT);
    const result = projectOmpParallelTasks([start, end]);
    assert.strictEqual(result.active.length, 1,
      'async.state=running must remain active, not completed');
    assert.strictEqual(result.completed.length, 0);
    assert.ok(result.active[0].gaps.includes('async_job_in_flight'));
  });

  it('start + error end → failed', () => {
    const startFrame = { ...OMP_TASK_START, toolCallId: 'tcid-005' };
    const start = normalizeOmpTaskFrame(startFrame, PARENT);
    const end = normalizeOmpTaskFrame(OMP_TASK_END_ERROR, PARENT);
    const result = projectOmpParallelTasks([start, end]);
    assert.strictEqual(result.failed.length, 1);
    assert.strictEqual(result.active.length, 0);
  });

  it('orphan end (no prior start) → orphanEnds', () => {
    const end = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    const result = projectOmpParallelTasks([end]);
    assert.strictEqual(result.orphanEnds.length, 1);
    assert.ok(result.orphanEnds[0].gaps.includes('start_frame_missing'));
    assert.ok(result.gaps.some((g) => g.startsWith('orphan_end:')));
  });

  it('duplicate start records gap, last start wins', () => {
    const start1 = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    const start2 = normalizeOmpTaskFrame({ ...OMP_TASK_START }, PARENT);
    const end = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    const result = projectOmpParallelTasks([start1, start2, end]);
    assert.ok(result.gaps.some((g) => g.startsWith('duplicate_start:')));
    assert.strictEqual(result.completed.length, 1);
  });

  it('multiple independent tasks split into correct buckets', () => {
    const startA = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    const endA = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);

    const startFrame2 = { ...OMP_TASK_START, toolCallId: 'tcid-002' };
    const startB = normalizeOmpTaskFrame(startFrame2, PARENT);
    const endB = normalizeOmpTaskFrame(OMP_TASK_END_ASYNC_RUNNING, PARENT);

    const startFrame5 = { ...OMP_TASK_START, toolCallId: 'tcid-005' };
    const startC = normalizeOmpTaskFrame(startFrame5, PARENT);
    const endC = normalizeOmpTaskFrame(OMP_TASK_END_ERROR, PARENT);

    const result = projectOmpParallelTasks([startA, endA, startB, endB, startC, endC]);
    assert.strictEqual(result.completed.length, 1);
    assert.strictEqual(result.active.length, 1);
    assert.strictEqual(result.failed.length, 1);
  });

  it('skips null entries without throwing', () => {
    const obs = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    const result = projectOmpParallelTasks([null, obs, undefined]);
    assert.strictEqual(result.active.length, 1);
  });

  it('merged record preserves taskAgent from start frame', () => {
    const start = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    const end = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    const result = projectOmpParallelTasks([start, end]);
    assert.strictEqual(result.completed[0].taskAgent, 'claude-sonnet');
  });

  it('merged record has childSessionFile from end frame', () => {
    const start = normalizeOmpTaskFrame(OMP_TASK_START, PARENT);
    const end = normalizeOmpTaskFrame(OMP_TASK_END_SYNC, PARENT);
    const result = projectOmpParallelTasks([start, end]);
    assert.strictEqual(result.completed[0].childSessionFile, '/tmp/omp-sessions/session-abc.json');
  });

  it('skips non-omp observations without throwing', () => {
    const result = projectOmpParallelTasks([{ harness: 'claude-code', invocationKey: '[]' }]);
    assert.strictEqual(result.active.length, 0);
  });
});

// ---------------------------------------------------------------------------
// normalizeClaudeToolProgressFrame
// ---------------------------------------------------------------------------

describe('normalizeClaudeToolProgressFrame — null returns', () => {
  it('returns null for null', () => {
    assert.strictEqual(normalizeClaudeToolProgressFrame(null, CLAUDE_PARENT), null);
  });

  it('returns null for non-object', () => {
    assert.strictEqual(normalizeClaudeToolProgressFrame('text', CLAUDE_PARENT), null);
  });

  it('returns null for array', () => {
    assert.strictEqual(normalizeClaudeToolProgressFrame([], CLAUDE_PARENT), null);
  });

  it('returns null for Bash progress (no subagent_type)', () => {
    assert.strictEqual(normalizeClaudeToolProgressFrame(CLAUDE_BASH_PROGRESS, CLAUDE_PARENT), null);
  });

  it('returns null for heartbeat frame (no subagent_type)', () => {
    assert.strictEqual(normalizeClaudeToolProgressFrame(CLAUDE_HEARTBEAT, CLAUDE_PARENT), null);
  });

  it('returns null for assistant frame type', () => {
    assert.strictEqual(normalizeClaudeToolProgressFrame(CLAUDE_ASSISTANT_FRAME, CLAUDE_PARENT), null);
  });

  it('returns null for tool_use frame type', () => {
    assert.strictEqual(normalizeClaudeToolProgressFrame(CLAUDE_TOOL_USE_FRAME, CLAUDE_PARENT), null);
  });

  it('returns null for tool_progress with subagent_type=true (not string)', () => {
    const frame = { ...CLAUDE_SUBAGENT_PROGRESS, subagent_type: true };
    assert.strictEqual(normalizeClaudeToolProgressFrame(frame, CLAUDE_PARENT), null);
  });

  it('returns null for tool_progress with subagent_type=null', () => {
    const frame = { ...CLAUDE_SUBAGENT_PROGRESS, subagent_type: null };
    assert.strictEqual(normalizeClaudeToolProgressFrame(frame, CLAUDE_PARENT), null);
  });
});

describe('normalizeClaudeToolProgressFrame — subagent frames', () => {
  it('returns observation when subagent_type is a string', () => {
    const obs = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, CLAUDE_PARENT);
    assert.ok(obs !== null);
    assert.strictEqual(obs.harness, 'claude-code');
    assert.strictEqual(obs.nativeFrameType, 'tool_progress');
    assert.strictEqual(obs.phase, NATIVE_PHASE.STARTED);
    assert.strictEqual(obs.provenance, 'wire_frame');
  });

  it('invocationKey uses JSON tuple encoding', () => {
    const obs = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, CLAUDE_PARENT);
    const parts = parseKey(obs.invocationKey);
    assert.deepStrictEqual(parts, ['claude-code', 'w-claude', 'claude-sess-parent', 'toolu_abc123']);
  });

  it('carries toolUseId and subagentType', () => {
    const obs = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, CLAUDE_PARENT);
    assert.strictEqual(obs.toolUseId, 'toolu_abc123');
    assert.strictEqual(obs.subagentType, 'claude');
  });

  it('carries parentToolUseId', () => {
    const obs = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, CLAUDE_PARENT);
    assert.strictEqual(obs.parentToolUseId, 'toolu_parent_456');
  });

  it('completion_unknown gap always present', () => {
    const obs = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, CLAUDE_PARENT);
    assert.ok(obs.gaps.includes('completion_unknown'));
    assert.ok(obs.gaps.includes('process_ownership_unknown'));
    assert.ok(obs.gaps.includes('child_session_id_unknown'));
  });

  it('controls is always empty array', () => {
    const obs = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, CLAUDE_PARENT);
    assert.deepStrictEqual(obs.controls, []);
  });

  it('subagentRetry present when frame has subagent_retry', () => {
    const obs = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS_RETRY, CLAUDE_PARENT);
    assert.ok(obs.subagentRetry !== null);
    assert.strictEqual(obs.subagentRetry.attempt, 2);
  });

  it('subagentRetry null when frame lacks subagent_retry (resolved)', () => {
    const obs = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, CLAUDE_PARENT);
    // Binary: ...e.data.resolved!==!0&&{subagent_retry:...}  — absent means resolved
    assert.strictEqual(obs.subagentRetry, null);
  });

  it('handles missing parentContext gracefully', () => {
    const obs = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, null);
    assert.strictEqual(obs.parentWorker, null);
    assert.strictEqual(obs.parentSessionId, null);
    assert.ok(obs.gaps.includes('parent_session_id_unknown'));
  });

  it('does NOT retain raw frame fields outside known set', () => {
    const obs = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, CLAUDE_PARENT);
    assert.strictEqual(obs.tool_name, undefined);
    assert.strictEqual(obs.elapsed_time_seconds, undefined);
  });
});

describe('normalizeClaudeToolProgressFrame — invocationKey collision prevention', () => {
  it('same tool_use_id from different parent sessions → different keys', () => {
    const parentA = { worker: 'w-c', sessionId: 'sess-A' };
    const parentB = { worker: 'w-c', sessionId: 'sess-B' };
    const obsA = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, parentA);
    const obsB = normalizeClaudeToolProgressFrame(CLAUDE_SUBAGENT_PROGRESS, parentB);
    assert.notStrictEqual(obsA.invocationKey, obsB.invocationKey);
  });
});

// ---------------------------------------------------------------------------
// normalizeCodexFrame
// ---------------------------------------------------------------------------

describe('normalizeCodexFrame — null returns', () => {
  it('returns null for null', () => {
    assert.strictEqual(normalizeCodexFrame(null, CODEX_PARENT), null);
  });

  it('returns null for non-object', () => {
    assert.strictEqual(normalizeCodexFrame('hello', CODEX_PARENT), null);
  });

  it('returns null for frame without item', () => {
    assert.strictEqual(normalizeCodexFrame({ threadId: 't1', turnId: 'turn-1' }, CODEX_PARENT), null);
  });

  it('returns null for item with wrong type', () => {
    assert.strictEqual(normalizeCodexFrame(CODEX_OTHER_ITEM, CODEX_PARENT), null);
  });

  it('returns null for agentMessage item', () => {
    assert.strictEqual(
      normalizeCodexFrame({ item: { type: 'agentMessage', content: 'hi' }, threadId: 't1', turnId: 'T1' }, CODEX_PARENT),
      null,
    );
  });
});

describe('normalizeCodexFrame — spawnAgent inProgress', () => {
  it('returns observation for collabAgentToolCall spawnAgent', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.ok(obs !== null);
    assert.strictEqual(obs.harness, 'codex');
    assert.strictEqual(obs.nativeFrameType, 'collabAgentToolCall');
    assert.strictEqual(obs.provenance, 'wire_frame');
  });

  it('invocationKey uses JSON tuple encoding with item.id', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    const parts = parseKey(obs.invocationKey);
    assert.deepStrictEqual(parts, ['codex', 'codex-worker-1', 'codex-sess-parent', 'collab-call-id-001']);
  });

  it('collabToolCallId set from schema field item.id (NOT agentThreadId)', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.strictEqual(obs.collabToolCallId, 'collab-call-id-001');
    // Schema does NOT have agentThreadId — must not appear
    assert.strictEqual(obs.agentThreadId, undefined);
  });

  it('tool field set from schema item.tool (NOT kind)', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.strictEqual(obs.tool, 'spawnAgent');
    // Schema does NOT have kind — must not appear
    assert.strictEqual(obs.kind, undefined);
  });

  it('invocationStatus set from schema item.status', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.strictEqual(obs.invocationStatus, 'inProgress');
  });

  it('inProgress → STARTED phase', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.strictEqual(obs.phase, NATIVE_PHASE.STARTED);
  });

  it('receiverThreadIds populated from schema field', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.deepStrictEqual(obs.receiverThreadIds, ['thread-child-A']);
  });

  it('agentsStates populated from schema field (CollabAgentState per child)', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.deepStrictEqual(obs.agentsStates, {
      'thread-child-A': { status: 'pendingInit', message: null },
    });
  });

  it('senderThreadId populated', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.strictEqual(obs.senderThreadId, 'thread-parent-1');
  });

  it('adapter_seam_missing gap always present', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.ok(obs.gaps.includes('adapter_seam_missing'));
  });

  it('controls is always empty', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.deepStrictEqual(obs.controls, []);
  });

  it('threadId and turnId carried from params', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.strictEqual(obs.threadId, 'thread-parent-1');
    assert.strictEqual(obs.turnId, 'turn-42');
  });

  it('schema payload fields (prompt/model) NOT extracted into observation', () => {
    const frameWithPayload = {
      ...CODEX_COLLAB_SPAWN,
      item: { ...CODEX_COLLAB_SPAWN.item, model: 'gpt-4o', prompt: 'do something' },
    };
    const obs = normalizeCodexFrame(frameWithPayload, CODEX_PARENT);
    assert.strictEqual(obs.model, undefined);
    assert.strictEqual(obs.prompt, undefined);
  });

  it('schema field agentPath NOT used (absent from JSON schema)', () => {
    // agentPath was a false positive from Rust serde debug strings — not in JSON schema
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.strictEqual(obs.agentPath, undefined);
  });
});

describe('normalizeCodexFrame — invocation status vs child status separation', () => {
  it('completed invocation with running child: invocationStatus=completed, child running in agentsStates', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_COMPLETED_RUNNING_CHILD, CODEX_PARENT);
    assert.ok(obs !== null);
    // Invocation-level status
    assert.strictEqual(obs.invocationStatus, 'completed');
    assert.strictEqual(obs.phase, NATIVE_PHASE.COMPLETED);
    // Child-level status (separate — agentsStates snapshot may be stale)
    assert.strictEqual(obs.agentsStates['thread-child-B'].status, 'running');
    assert.strictEqual(obs.agentsStates['thread-child-C'].status, 'completed');
  });

  it('multiple receiverThreadIds all preserved', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_COMPLETED_RUNNING_CHILD, CODEX_PARENT);
    assert.deepStrictEqual(obs.receiverThreadIds, ['thread-child-B', 'thread-child-C']);
  });

  it('failed invocation → FAILED phase', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_FAILED, CODEX_PARENT);
    assert.strictEqual(obs.invocationStatus, 'failed');
    assert.strictEqual(obs.phase, NATIVE_PHASE.FAILED);
  });

  it('failed invocation: child interrupted status in agentsStates with message', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_FAILED, CODEX_PARENT);
    assert.strictEqual(obs.agentsStates['thread-child-D'].status, 'interrupted');
    assert.strictEqual(obs.agentsStates['thread-child-D'].message, 'timed out');
  });

  it('interrupted invocation → STARTED phase (still in-flight, not completed)', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_INTERRUPTED, CODEX_PARENT);
    assert.strictEqual(obs.invocationStatus, 'interrupted');
    assert.strictEqual(obs.phase, NATIVE_PHASE.STARTED);
  });
});

describe('normalizeCodexFrame — CollabAgentTool enum coverage', () => {
  const tools = ['spawnAgent', 'sendInput', 'resumeAgent', 'wait', 'closeAgent',
    'sendMessage', 'followupTask', 'interruptAgent', 'listAgents'];

  for (const toolName of tools) {
    it(`normalizes tool=${toolName}`, () => {
      const frame = {
        item: {
          ...CODEX_COLLAB_SPAWN.item,
          id: `collab-${toolName}`,
          tool: toolName,
          status: 'completed',
        },
        threadId: 'thread-parent-1',
        turnId: 'turn-99',
      };
      const obs = normalizeCodexFrame(frame, CODEX_PARENT);
      assert.ok(obs !== null);
      assert.strictEqual(obs.tool, toolName);
      assert.strictEqual(obs.phase, NATIVE_PHASE.COMPLETED);
    });
  }
});

describe('normalizeCodexFrame — invocationKey collision prevention', () => {
  it('same collab id from different parent sessions → different keys', () => {
    const parentA = { worker: 'cw', sessionId: 'codex-sess-A' };
    const parentB = { worker: 'cw', sessionId: 'codex-sess-B' };
    const obsA = normalizeCodexFrame(CODEX_COLLAB_SPAWN, parentA);
    const obsB = normalizeCodexFrame(CODEX_COLLAB_SPAWN, parentB);
    assert.notStrictEqual(obsA.invocationKey, obsB.invocationKey);
  });
});

describe('normalizeCodexFrame — missing parentContext', () => {
  it('handles null parentContext', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, null);
    assert.strictEqual(obs.parentWorker, null);
    assert.strictEqual(obs.parentSessionId, null);
    assert.ok(obs.gaps.includes('parent_session_id_unknown'));
  });
});

describe('normalizeCodexFrame — unknown field capture', () => {
  it('captures unknown item fields', () => {
    const frame = {
      ...CODEX_COLLAB_SPAWN,
      item: { ...CODEX_COLLAB_SPAWN.item, futureField: 'future_val' },
    };
    const obs = normalizeCodexFrame(frame, CODEX_PARENT);
    assert.ok(obs.unknownFields);
    assert.strictEqual(obs.unknownFields.futureField, 'future_val');
  });

  it('no unknownFields for clean item', () => {
    const obs = normalizeCodexFrame(CODEX_COLLAB_SPAWN, CODEX_PARENT);
    assert.strictEqual(obs.unknownFields, undefined);
  });
});

// ---------------------------------------------------------------------------
// Cross-harness namespace isolation
// ---------------------------------------------------------------------------

describe('cross-harness namespace isolation', () => {
  it('same id string in OMP and Claude produces different invocationKeys', () => {
    const sharedId = 'shared-id-001';
    const ompStart = { ...OMP_TASK_START, toolCallId: sharedId };
    const claudeProgress = { ...CLAUDE_SUBAGENT_PROGRESS, tool_use_id: sharedId };

    const ompObs = normalizeOmpTaskFrame(ompStart, { worker: 'w', sessionId: 's' });
    const claudeObs = normalizeClaudeToolProgressFrame(claudeProgress, { worker: 'w', sessionId: 's' });

    assert.notStrictEqual(ompObs.invocationKey, claudeObs.invocationKey);
    const ompParts = parseKey(ompObs.invocationKey);
    const claudeParts = parseKey(claudeObs.invocationKey);
    assert.strictEqual(ompParts[0], 'omp');
    assert.strictEqual(claudeParts[0], 'claude-code');
  });

  it('same id string across OMP, Claude, Codex → three distinct invocationKeys', () => {
    const id = 'universal-id';
    const ctx = { worker: 'w1', sessionId: 'sess1' };
    const ompObs = normalizeOmpTaskFrame({ ...OMP_TASK_START, toolCallId: id }, ctx);
    const claudeObs = normalizeClaudeToolProgressFrame({ ...CLAUDE_SUBAGENT_PROGRESS, tool_use_id: id }, ctx);
    const codexObs = normalizeCodexFrame({
      ...CODEX_COLLAB_SPAWN,
      item: { ...CODEX_COLLAB_SPAWN.item, id },
    }, ctx);
    const keys = new Set([ompObs.invocationKey, claudeObs.invocationKey, codexObs.invocationKey]);
    assert.strictEqual(keys.size, 3);
  });
});
