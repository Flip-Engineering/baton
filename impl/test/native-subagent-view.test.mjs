// native-subagent-view.test.mjs
// Execution: node --test impl/test/native-subagent-view.test.mjs
//
// Fixtures are grounded in the LIVE 2026-09-13 OMP 17.4.0 RPC probe (bounded background
// task delegation through a real `omp --mode rpc` child) and `omp read omp://rpc.md`.
// The view must keep MANAGEMENT INVOCATION completion (invocationOk) separate from the
// ASYNC JOB / CHILD terminal truth (jobTerminal, agent state) — never conflating them,
// never inventing completion the wire did not send.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOmpTaskFrame, normalizeOmpSubagentFrame } from '../src/native-subagent-observations.mjs';
import { nativeSubagentView } from '../src/native-subagent-view.mjs';

const PARENT = { worker: 'w-omp-1', sessionId: 'omp-parent-session' };
const CALL_ID = 'call_00_probe0123456789';
const CHILD_FILE = '/sessions/2026-09-13T21-14-48Z/ProbeAgent.jsonl';

function eventsFrom(frames) {
  return frames.filter((frame) => frame !== null).map((frame, index) => ({
    kind: 'native.subagent_observed',
    seq: index + 1,
    ts: '2026-09-13T21:14:48.000Z',
    payload: frame,
  }));
}

const chainFrames = () => [
  normalizeOmpTaskFrame({ type: 'tool_execution_start', toolCallId: CALL_ID, toolName: 'task', args: { agent: 'general' } }, PARENT),
  normalizeOmpTaskFrame({
    type: 'tool_execution_end', toolCallId: CALL_ID, toolName: 'task', isError: false,
    result: { details: { projectAgentsDir: null, results: [], totalDurationMs: 0,
      async: { state: 'running', jobId: 'ProbeAgent', type: 'task' } } },
  }, PARENT),
  normalizeOmpTaskFrame({
    type: 'tool_execution_update', toolCallId: CALL_ID, toolName: 'task', args: {},
    partialResult: { content: [{ type: 'text', text: 'Running background task ProbeAgent...' }],
      details: { async: { state: 'running', jobId: 'ProbeAgent', type: 'task' } } },
  }, PARENT),
  normalizeOmpSubagentFrame({
    type: 'subagent_lifecycle',
    payload: { id: 'ProbeAgent', index: 0, agent: 'task', agentSource: 'bundled', status: 'started',
      detached: true, sessionFile: CHILD_FILE, parentToolCallId: CALL_ID },
  }, PARENT),
];

test('a terminal lifecycle gives the agent real native status and the invocation jobTerminal', () => {
  const frames = [
    ...chainFrames(),
    normalizeOmpSubagentFrame({
      type: 'subagent_lifecycle',
      payload: { id: 'ProbeAgent', index: 0, agent: 'task', agentSource: 'bundled', status: 'completed',
        detached: true, sessionFile: CHILD_FILE, parentToolCallId: CALL_ID },
    }, PARENT),
  ];
  const view = nativeSubagentView(eventsFrom(frames));

  assert.equal(view.invocations.length, 1);
  const invocation = view.invocations[0];
  assert.equal(invocation.phase, 'started', 'the management invocation ended with the job in flight');
  assert.equal(invocation.invocationOk, true, 'the tool call itself returned ok');
  assert.equal(invocation.asyncState, 'running');
  assert.deepEqual(invocation.jobTerminal, { state: 'completed', seq: 5 },
    'async terminal job state is captured separately from management completion');
  assert.equal(invocation.controls.length, 0);

  assert.equal(view.agents.length, 1);
  const agent = view.agents[0];
  assert.equal(agent.state, 'completed', 'the native child status is the agent state');
  assert.equal(agent.sessionFile, CHILD_FILE, 'actual child identity only when the wire supplied it');
  assert.equal(agent.workPhase, 'completed');
  assert.equal(agent.ownership, 'native_harness');
  assert.deepEqual(agent.controls, []);
});

test('a failed child records failed job truth without inventing an invocation failure', () => {
  const frames = [
    ...chainFrames(),
    normalizeOmpSubagentFrame({
      type: 'subagent_lifecycle',
      payload: { id: 'ProbeAgent', index: 0, agent: 'task', agentSource: 'bundled', status: 'failed',
        detached: true, sessionFile: CHILD_FILE, parentToolCallId: CALL_ID },
    }, PARENT),
  ];
  const view = nativeSubagentView(eventsFrom(frames));
  assert.equal(view.invocations[0].jobTerminal.state, 'failed');
  assert.equal(view.invocations[0].invocationOk, true, 'the tool call did not error; the job did');
  assert.equal(view.agents[0].state, 'failed');
});

test('without a retained end frame, terminal child truth still surfaces on the invocation', () => {
  const frames = [
    normalizeOmpSubagentFrame({
      type: 'subagent_lifecycle',
      payload: { id: 'SoloAgent', index: 0, agent: 'task', agentSource: 'bundled', status: 'completed',
        detached: true, sessionFile: CHILD_FILE, parentToolCallId: CALL_ID },
    }, PARENT),
  ];
  const view = nativeSubagentView(eventsFrom(frames));
  const invocation = view.invocations.find((row) => row.jobTerminal);
  assert.ok(invocation, 'terminal truth is never silently dropped');
  assert.deepEqual(invocation.jobTerminal, { state: 'completed', seq: 1 });
  assert.equal(view.agents[0].state, 'completed');
});

test('a child observed only through lifecycle keying stays identified, not unidentified', () => {
  const frames = [chainFrames()[3]];
  const view = nativeSubagentView(eventsFrom(frames));
  assert.equal(view.unidentified.length, 0);
  assert.equal(view.agents.length, 1);
});

test('child prompt/progress text never reaches the view, and the view JSON round-trips', () => {
  const probeText = 'SECRET-ASSIGNMENT-TEXT-view-must-not-leak';
  const frames = [
    ...chainFrames(),
    normalizeOmpSubagentFrame({
      type: 'subagent_progress',
      payload: { index: 0, agent: 'task', agentSource: 'bundled', task: probeText, assignment: probeText,
        parentToolCallId: CALL_ID, detached: true,
        progress: { index: 0, id: 'ProbeAgent', status: 'running', recentOutput: [probeText] },
        sessionFile: CHILD_FILE },
    }, PARENT),
  ];
  const events = eventsFrom(frames);
  const view = nativeSubagentView(events);
  assert.equal(JSON.stringify(view).includes(probeText), false);
  assert.deepEqual(nativeSubagentView(JSON.parse(JSON.stringify(events))), view);
});

test('ordinary tool frames produce no view content, and cross-harness keys stay isolated', () => {
  const bashOnly = [
    normalizeOmpTaskFrame({ type: 'tool_execution_start', toolCallId: 'b1', toolName: 'bash', args: {} }, PARENT),
    normalizeOmpTaskFrame({ type: 'tool_execution_end', toolCallId: 'b1', toolName: 'bash', isError: false,
      result: { details: {} } }, PARENT),
  ];
  const view = nativeSubagentView(eventsFrom(bashOnly));
  assert.deepEqual(view, { coverage: 'observed_only', agents: [], invocations: [], unidentified: [] });

  const codex = nativeSubagentView(eventsFrom([
    { harness: 'codex', invocationKey: '["codex","w","s","c1"]', parentWorker: 'w', parentSessionId: 's',
      collabToolCallId: 'c1', receiverThreadIds: ['child-thread'], agentsStates: { 'child-thread': { status: 'running' } },
      phase: 'started', nativeFrameType: 'collabAgentToolCall', gaps: [], controls: [] },
  ]));
  assert.equal(codex.agents[0].nativeId, 'child-thread');
  assert.equal(codex.agents[0].state, 'running');
});
