import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { nativeSubagentView } from '../src/native-subagent-view.mjs';

function receiver(Adapter) {
  const adapter = Object.create(Adapter.prototype);
  const events = [];
  adapter._emit = (_session, kind, payload) => events.push({ kind, payload, seq: events.length + 1, ts: '2026-09-13T00:00:00.000Z' });
  return { adapter, events };
}

test('Codex item notifications expose actual child state independently of collab invocation completion', () => {
  const { adapter, events } = receiver(CodexAppServerCli);
  adapter._isTerminalTurn = () => false;
  const session = { worker: 'w-parent', threadId: 'parent-thread' };
  // Exact collabAgentToolCall variant from the installed app-server JSON schema.
  const item = { type: 'collabAgentToolCall', id: 'spawn-call', tool: 'spawnAgent', status: 'inProgress',
    senderThreadId: 'parent-thread', receiverThreadIds: ['child-thread'],
    agentsStates: { 'child-thread': { status: 'pendingInit' } } };
  adapter._onNotification(session, 'item/started', { threadId: session.threadId, turnId: 'turn-1', item });
  adapter._onNotification(session, 'item/completed', { threadId: session.threadId, turnId: 'turn-1', item: {
    ...item, status: 'completed', agentsStates: { 'child-thread': { status: 'running' } },
    undocumentedCredentials: 'secret-that-must-not-be-retained',
  } });
  const view = nativeSubagentView(events);
  assert.equal(view.agents.length, 1);
  assert.equal(view.agents[0].nativeId, 'child-thread');
  assert.equal(view.agents[0].state, 'running');
  assert.equal(view.invocations.length, 1);
  assert.equal(view.invocations[0].phase, 'completed');
  assert.deepEqual(view.agents[0].controls, []);
  assert.equal(JSON.stringify(view).includes('secret-that-must-not-be-retained'), false);
  assert.deepEqual(nativeSubagentView(JSON.parse(JSON.stringify(events))), view);
  adapter._onNotification(session, 'item/completed', { threadId: session.threadId, turnId: 'turn-1', item: {
    ...item, id: 'send-call', tool: 'sendInput', status: 'completed', agentsStates: {},
  } });
  const afterSend = nativeSubagentView(events);
  assert.equal(afterSend.agents[0].state, 'running', 'an invocation without a new state retains the last known child observation');
  assert.equal(afterSend.agents[0].stateSeq, view.agents[0].stateSeq);
  assert.equal(afterSend.invocations.length, 2);
});

test('OMP task observations preserve background work after its tool call returns', () => {
  const { adapter, events } = receiver(OmpRpcCli);
  adapter._observeTransportLiveness = () => {};
  const session = { worker: 'w-parent', observedSessionId: 'omp-session' };
  adapter._onFrame(session, { type: 'tool_execution_start', toolName: 'bash', toolCallId: 'ordinary' });
  assert.equal(events.some((row) => row.kind === 'native.subagent_observed'), false);
  adapter._onFrame(session, { type: 'tool_execution_start', toolName: 'task', toolCallId: 'delegate', args: { agent: 'reviewer' } });
  adapter._onFrame(session, { type: 'tool_execution_end', toolName: 'task', toolCallId: 'delegate',
    result: { details: { sessionFile: '/native/child.jsonl', async: { state: 'running', jobId: 'job-1' } } } });
  const view = nativeSubagentView(events);
  assert.equal(view.invocations.length, 1);
  assert.equal(view.invocations[0].phase, 'started');
  assert.equal(view.agents[0].workPhase, 'started');
  assert.equal(view.agents[0].state, 'unknown', 'a job observation does not prove native session lifetime');
  assert.deepEqual(view.agents[0].controls, []);
});

test('Claude progress reveals delegation without inventing a child identity or completion', () => {
  const { adapter, events } = receiver(ClaudeSessionCli);
  const session = { worker: 'w-parent', sessionIdWire: 'claude-parent' };
  adapter._handleWireObject(session, { type: 'tool_progress', tool_use_id: 'bash', tool_name: 'Bash' });
  assert.equal(events.length, 0);
  adapter._handleWireObject(session, { type: 'tool_progress', tool_use_id: 'agent-tool', tool_name: 'Agent',
    subagent_type: 'Explore', session_id: 'claude-parent', elapsed_time_seconds: 4 });
  const view = nativeSubagentView(events);
  assert.equal(view.agents.length, 0, 'a tool invocation ID is not a child session ID');
  assert.equal(view.invocations.length, 1);
  assert.ok(view.invocations[0].gaps.includes('child_session_id_unknown'));
});
