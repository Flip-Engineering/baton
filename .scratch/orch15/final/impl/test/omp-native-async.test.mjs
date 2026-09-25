// omp-native-async.test.mjs
// Execution: node --test impl/test/omp-native-async.test.mjs
//
// Adapter-level contract for native OMP background-task visibility, grounded in the LIVE
// 2026-09-13 probe (real `omp --mode rpc` child, raw frames captured) and rpc.md:
//   tool_execution_start(task) → tool_execution_update(task, async running) ×N
//   → tool_execution_end(task, async running) → subagent_lifecycle(started)
//   → subagent_lifecycle(completed | failed)   ← the raw terminal child event
// The subscription is an OMP-owned control Baton merely invokes; ordinary tools are never
// children; an end frame with async.state='running' never becomes a completion claim.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OmpRpcCli, OMP_SUBAGENT_SUBSCRIPTION_LEVEL } from '../src/omp-rpc.mjs';
import { normalizeOmpTaskFrame, normalizeOmpSubagentFrame } from '../src/native-subagent-observations.mjs';
import { nativeSubagentView } from '../src/native-subagent-view.mjs';

function receiver() {
  const adapter = Object.create(OmpRpcCli.prototype);
  const events = [];
  adapter._emit = (_session, kind, payload) => events.push({ kind, payload, seq: events.length + 1, ts: '2026-09-13T21:14:48.000Z' });
  return { adapter, events };
}

const SESSION = { worker: 'w-parent', observedSessionId: 'omp-parent-session' };
const CALL_ID = 'call_00_liveprobe0000000000';
const CHILD_FILE = '/sessions/2026-09-13T21-14-48Z/ProbeAgent.jsonl';

const taskStart = { type: 'tool_execution_start', toolCallId: CALL_ID, toolName: 'task', args: {} };
const taskEndRunning = {
  type: 'tool_execution_end', toolCallId: CALL_ID, toolName: 'task', isError: false,
  result: { details: { projectAgentsDir: null, results: [], totalDurationMs: 0,
    async: { state: 'running', jobId: 'ProbeAgent', type: 'task' } } },
};
const taskUpdateRunning = {
  type: 'tool_execution_update', toolCallId: CALL_ID, toolName: 'task', args: {},
  partialResult: { content: [{ type: 'text', text: 'Running background task ProbeAgent...' }],
    details: { progress: [], async: { state: 'running', jobId: 'ProbeAgent', type: 'task' } } },
};
const lifecycle = (status, id = 'ProbeAgent', parentToolCallId = CALL_ID) => ({
  type: 'subagent_lifecycle',
  payload: { id, index: 0, agent: 'task', agentSource: 'bundled', status, detached: true,
    sessionFile: CHILD_FILE, parentToolCallId },
});

const observed = (events) => events.filter((event) => event.kind === 'native.subagent_observed');

test('ordinary tool updates are never children: bash/rw updates emit nothing', () => {
  const { adapter, events } = receiver();
  const session = { ...SESSION };
  adapter._onFrame(session, { type: 'tool_execution_update', toolCallId: 'b1', toolName: 'bash', args: {},
    partialResult: { content: [], details: { async: { state: 'running', jobId: 'b1', type: 'bash' } } } });
  adapter._onFrame(session, { type: 'tool_execution_update', toolCallId: 'r1', toolName: 'read', args: {},
    partialResult: { content: [], details: {} } });
  assert.equal(observed(events).length, 0);
  assert.equal(events.filter((event) => event.kind === 'content.tool_call').length, 0,
    'update frames are not tool-call completions either');
});

test('the live-probe frame chain produces started observations only until the terminal lifecycle', () => {
  const { adapter, events } = receiver();
  const session = { ...SESSION };
  adapter._onFrame(session, taskStart);
  adapter._onFrame(session, taskEndRunning);
  adapter._onFrame(session, taskUpdateRunning);
  adapter._onFrame(session, lifecycle('started'));
  let phases = observed(events).map((event) => event.payload.phase);
  assert.deepEqual(phases, ['started', 'started', 'started', 'started'],
    'end-with-async-running, updates, and a started lifecycle never claim completion');

  adapter._onFrame(session, lifecycle('completed'));
  phases = observed(events).map((event) => event.payload.phase);
  assert.equal(phases[phases.length - 1], 'completed', 'the terminal lifecycle is the completion event');

  const view = nativeSubagentView(observed(events));
  assert.equal(view.agents[0].state, 'completed');
  assert.equal(view.agents[0].sessionFile, CHILD_FILE);
  const invocation = view.invocations.find((row) => row.invocationOk === true);
  assert.ok(invocation, 'management invocation completion stays visible');
  assert.equal(invocation.jobTerminal.state, 'completed');
  assert.equal(invocation.jobTerminal.seq, observed(events).at(-1).seq,
    'jobTerminal is stamped with the terminal lifecycle event');
});

test('a failed lifecycle surfaces failed job truth through the adapter lane', () => {
  const { adapter, events } = receiver();

  adapter._onFrame({ ...SESSION }, lifecycle('failed', 'DoomedAgent', 'call_other'));
  const rows = observed(events);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.phase, 'failed');
  assert.equal(rows[0].payload.ok, false);
  assert.equal(rows[0].payload.status, 'failed');
});

test('progress frames are in-flight observations carrying no child prompt or output text', () => {
  const { adapter, events } = receiver();
  adapter._onFrame({ ...SESSION }, {
    type: 'subagent_progress',
    payload: { index: 0, agent: 'task', agentSource: 'bundled',
      task: 'SECRET-TASK-wire', assignment: 'SECRET-ASSIGNMENT-wire',
      parentToolCallId: CALL_ID, detached: true,
      progress: { index: 0, id: 'ProbeAgent', status: 'running', recentOutput: ['SECRET-OUTPUT-wire'] },
      sessionFile: CHILD_FILE },
  });
  const rows = observed(events);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.phase, 'started');
  assert.equal(JSON.stringify(rows).includes('SECRET-TASK-wire'), false);
  assert.equal(JSON.stringify(rows).includes('SECRET-OUTPUT-wire'), false);
});

test('agent_end isTerminal:false and subagent_event frames are not child observations', () => {
  const { adapter, events } = receiver();
  const session = { ...SESSION };
  adapter._onFrame(session, { type: 'agent_end', messages: [], isTerminal: false });
  adapter._onFrame(session, { type: 'subagent_event', payload: { id: 'ProbeAgent', event: { type: 'message' } } });
  assert.equal(observed(events).length, 0,
    'rpc.md: isTerminal:false means async delivery scheduled more work — not child completion');
});

test('tool_execution_update is provider traffic and flips transport liveness exactly once', async () => {
  assert.equal(OMP_SUBAGENT_SUBSCRIPTION_LEVEL, 'progress',
    ' Baton requests lifecycle+progress, never events-level child conversation frames');
  const { adapter, events } = receiver();
  const session = { ...SESSION, providerTrafficObserved: false, lastProviderTrafficAt: null };
  adapter._onFrame(session, taskUpdateRunning);
  adapter._onFrame(session, { ...taskUpdateRunning });
  const liveness = events.filter((event) => event.kind === 'lifecycle.transport_liveness');
  assert.equal(liveness.length, 1);
  assert.equal(liveness[0].payload.providerTraffic, true);
  await adapter.prompt('w-parent', 'x').then(
    () => assert.fail('unknown worker must not resolve ok'),
    () => {},
  ).catch(() => {});
});
