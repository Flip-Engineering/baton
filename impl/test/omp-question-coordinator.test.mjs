import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

// #255, native OMP 17.4.0 protocol: input/select read value; confirm reads confirmed;
// select options are strings; cancel has a fresh id plus the pending question's targetId.
// Exercise the actual Coordinator and durable attention, not an adapter-only event alias.
class Stream extends EventEmitter { setEncoding() {} end() {} }
class Child extends EventEmitter {
  constructor() {
    super();
    this.pid = 424242;
    this.written = [];
    this.stdin = new Stream(); this.stdout = new Stream(); this.stderr = new Stream();
    this.stdin.write = (line) => {
      const frame = JSON.parse(line); this.written.push(frame);
      if (frame.id && frame.type !== 'extension_ui_response') queueMicrotask(() => this.frame({
        type: 'response', id: frame.id, command: frame.type, success: true, data: {},
      }));
      return true;
    };
  }
  frame(frame) { this.stdout.emit('data', `${JSON.stringify(frame)}\n`); }
  kill() { queueMicrotask(() => { this.emit('exit', 0, null); this.emit('close', 0, null); }); return true; }
  responses(id) { return this.written.filter((frame) => frame.type === 'extension_ui_response' && frame.id === id); }
}

async function fixture(t, { model = 'm', governed = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-omp-questions-'));
  const children = [];
  const adapter = new OmpRpcCli({
    modelCatalog: { [model]: ['high'] }, versionProbe: () => '17.4.0-fixture', requestTimeoutMs: 1000,
    reapOwnedProcessGroup: async () => ({ confirmed: true, reason: null }),
    spawnFn: () => {
      const child = new Child(); children.push(child);
      queueMicrotask(() => child.frame({ type: 'ready', protocolVersion: 1 })); return child;
    },
  });
  const log = new Log(join(root, 'log'));
  const coordination = coordinationForLog(log);
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { omp: adapter }, repoRoot: root,
    worktrees: {
      create: async () => ({ path: root, branch: 'fixture', baseSha: 'base' }),
      capture: async () => ({ sha: 'result' }), remove: async () => {}, reconcile: async () => {},
      createVerifyWorktree: async () => ({ path: root }), removeVerifyWorktree: async () => {},
      worktreeAvailable: () => true,
    },
    referee: async () => ({ reverified: true, passed: true, observedExit: 0 }),
    ...(governed ? { providerGovernance: {
      schemaVersion: 1, maxWireFrameBytes: 2 * 1024 * 1024,
      maxProviderCallsPerTurn: 10, maxToolCallsPerTurn: 10,
      routes: [{ harness: 'omp', model, effort: 'high', mode: 'observe',
        terminalReserve: { tokens: 100, usd: 0.01 } }],
    } } : {}),
    route: () => 'omp', now: Date.now, approvalTimeoutMs: 60000, stopDeadlineMs: 1000,
  });
  t.after(async () => {
    for (const child of children) child.kill();
    await Promise.all([...adapter._sessions.values()].map((session) => session.process.closePromise));
    await coordination.releaseWriterLease?.();
    rmSync(root, { recursive: true, force: true });
  });
  const handle = await coordinator.spawn('omp', {
    goal: 'Answer questions', constraints: [], pathScope: ['**'], definitionOfDone: 'Question answered',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 10000, usd: 1, wallMin: 10 },
  }, { model, effort: 'high' });
  await new Promise((resolve) => setImmediate(resolve));
  await coordinator._workers.get(handle.id).nativeSpawnPromise;
  assert.ok(children[0], 'Coordinator launched the native adapter boundary');
  return { adapter, coordinator, coordination, log, handle, child: children[0] };
}

async function ask(fx, request) {
  fx.child.frame({ type: 'extension_ui_request', ...request });
  await Promise.resolve();
  const event = fx.log.read(fx.handle.id).find((entry) => entry.kind === 'question.asked' && entry.payload.nativeRequestId === request.id);
  assert.ok(event, 'native question reached the canonical durable question.asked lane');
  const requestId = event.payload.requestId;
  assert.notEqual(requestId, request.id, 'native ids are namespaced to their worker/process');
  assert.equal(fx.coordinator.interactionStatus(requestId).state, 'pending');
  assert.equal(fx.coordination.task(fx.handle.taskId).status, 'input_required');
  const digest = await fx.coordinator.wait(1);
  const attention = digest.attention.find((item) => item.requestId === requestId);
  assert.equal(attention?.type, 'question', 'actual Coordinator attention owns the question');
  return { requestId, payload: event.payload, attention };
}

for (const row of [
  { method: 'input', title: 'Which route?', placeholder: 'model name', answer: { text: 'glm/glm-5.3' }, wire: { value: 'glm/glm-5.3' } },
  { method: 'confirm', title: 'Proceed?', message: 'Use this route', answer: { text: 'yes' }, wire: { confirmed: true } },
  { method: 'confirm', title: 'Proceed?', message: 'Use this route', answer: { text: 'false' }, wire: { confirmed: false } },
  { method: 'select', title: 'Which route?', options: ['deepseek/deepseek-v4-flash', 'glm/glm-5.3'], answer: { text: 'glm/glm-5.3' }, wire: { value: 'glm/glm-5.3' } },
]) test(`#255 native ${row.method} ${JSON.stringify(row.answer)}: Coordinator attention to native answer exactly once`, async (t) => {
  const fx = await fixture(t);
  const { answer, wire, ...request } = row;
  const { requestId, payload, attention } = await ask(fx, { id: 'native-1', ...request });
  assert.equal(payload.method, row.method); assert.equal(payload.title, row.title);
  if (row.options) assert.deepEqual(attention.payload.options, row.options, 'all native options survive durable attention');
  assert.deepEqual(fx.child.responses('native-1'), []);
  const [first, duplicate] = await Promise.all([
    fx.coordinator.respond(requestId, answer), fx.coordinator.respond(requestId, answer),
  ]);
  assert.equal(first.result, 'applied'); assert.equal(duplicate.result, 'already_resolved');
  assert.deepEqual(fx.child.responses('native-1'), [{ type: 'extension_ui_response', id: 'native-1', ...wire }]);
  assert.equal(fx.coordinator.interactionStatus(requestId).state, 'resolved');
  assert.equal(fx.coordination.task(fx.handle.taskId).status, 'working');
  assert.ok(fx.log.read(fx.handle.id).some((event) => event.kind === 'question.answered' && event.payload.requestId === requestId));
});

test('#255 invalid selection and ambiguous confirmation preserve pending questions without writing', async (t) => {
  const fx = await fixture(t);
  for (const request of [
    { id: 'select', method: 'select', title: 'Pick one', options: ['a', 'b'], invalid: 'c', valid: 'b' },
    { id: 'confirm', method: 'confirm', title: 'Proceed?', invalid: 'maybe', valid: 'no' },
  ]) {
    const { requestId } = await ask(fx, request);
    assert.equal((await fx.coordinator.respond(requestId, { text: request.invalid })).result, 'delivery_refused');
    assert.equal(fx.coordinator.interactionStatus(requestId).state, 'pending');
    assert.deepEqual(fx.child.responses(request.id), []);
    assert.equal((await fx.coordinator.respond(requestId, { text: request.valid })).result, 'applied');
  }
});

test('#255 notifications do not block; native cancel settles its exact pending question', async (t) => {
  const fx = await fixture(t);
  for (const method of ['notify', 'setStatus', 'setWidget', 'setTitle']) {
    fx.child.frame({ type: 'extension_ui_request', id: method, method, message: 'visible UI notice' });
  }
  assert.equal(fx.log.read(fx.handle.id).filter((event) => event.kind === 'question.asked').length, 0);
  assert.equal(fx.coordinator.list()[0].pendingQuestionId, null);
  const { requestId } = await ask(fx, { id: 'cancel-target', method: 'input', title: 'No longer needed' });
  fx.child.frame({ type: 'extension_ui_request', id: 'cancel-notification', method: 'cancel', targetId: 'cancel-target' });
  await Promise.resolve();
  assert.notEqual(fx.coordinator.interactionStatus(requestId).state, 'pending');
  assert.equal(fx.coordination.task(fx.handle.taskId).status, 'working');
  assert.equal(fx.coordinator.list()[0].pendingQuestionId, null);
  assert.notEqual((await fx.coordinator.respond(requestId, { text: 'too late' })).result, 'applied');
  assert.deepEqual(fx.child.responses('cancel-target'), [], 'cancelled requests receive no late wire answer');
  assert.deepEqual(fx.child.responses('cancel-notification'), [], 'cancel notifications are not answered');
});

test('#255 duplicate native ids cannot overwrite options; unknown or consumed answers never write', async (t) => {
  const fx = await fixture(t);
  const request = { id: 'duplicate', method: 'select', title: 'Pick', options: ['original'] };
  const { requestId } = await ask(fx, request);
  fx.child.frame({ type: 'extension_ui_request', ...request, options: ['substituted'] });
  assert.equal(fx.log.read(fx.handle.id).filter((event) => event.kind === 'question.asked').length, 1);
  assert.equal((await fx.coordinator.respond(requestId, { text: 'original' })).result, 'applied');
  assert.equal((await fx.adapter.answer(fx.handle.id, requestId, { text: 'again' })).notSent, true);
  assert.equal((await fx.adapter.answer(fx.handle.id, 'unknown', { text: 'x' })).notSent, true);
  assert.equal(fx.child.responses('duplicate').length, 1);
  assert.deepEqual(fx.child.responses('unknown'), []);
});

test('#255 a refused stdin write leaves the request pending for a real retry', async (t) => {
  const fx = await fixture(t);
  const { requestId } = await ask(fx, { id: 'retry', method: 'input', title: 'Answer me' });
  const write = fx.child.stdin.write;
  fx.child.stdin.write = () => { throw new Error('fixture write refused'); };
  assert.equal((await fx.coordinator.respond(requestId, { text: 'answer' })).result, 'delivery_refused');
  assert.equal(fx.coordinator.interactionStatus(requestId).state, 'pending');
  fx.child.stdin.write = write;
  assert.equal((await fx.coordinator.respond(requestId, { text: 'answer' })).result, 'applied');
  assert.equal(fx.child.responses('retry').length, 1);
});

test('#255 pending questions are retained beyond the former 32-request eviction boundary', async (t) => {
  const fx = await fixture(t);
  const { requestId } = await ask(fx, { id: 'first', method: 'input', title: 'Keep this pending' });
  for (let i = 0; i < 40; i += 1) fx.child.frame({
    type: 'extension_ui_request', id: `other-${i}`, method: 'input', title: 'Another pending question',
  });
  assert.equal((await fx.coordinator.respond(requestId, { text: 'original answer' })).result, 'applied');
  assert.deepEqual(fx.child.responses('first'), [{ type: 'extension_ui_response', id: 'first', value: 'original answer' }]);
});

test('#255 a request from an earlier native turn cannot write into its successor', async (t) => {
  const fx = await fixture(t);
  const { requestId } = await ask(fx, { id: 'earlier-turn', method: 'input', title: 'Old question' });
  fx.adapter._startTurn(fx.adapter._sessions.get(fx.handle.id), 'successor turn');
  assert.equal((await fx.adapter.answer(fx.handle.id, requestId, { text: 'stale' })).notSent, true);
  await fx.coordinator.respond(requestId, { text: 'stale' });
  assert.deepEqual(fx.child.responses('earlier-turn'), []);
});

test('OMP discovers peer-message syntax and emits fragmented initiated/reply frames exactly once', async (t) => {
  const fx = await fixture(t);
  const events = [];
  const coordinatorEvent = fx.adapter._cb;
  fx.adapter.onEvent((event) => { events.push(event); coordinatorEvent(event); });
  const prompt = fx.child.written.find((frame) => frame.type === 'prompt');
  assert.match(prompt.message, /MESSAGE_SEND/u, 'worker brief teaches the reachable message lane');
  const initiated = { to: { workerId: 'known-peer' }, body: 'Can you check this?', kind: 'query' };
  const reply = { inReplyTo: `message:${'a'.repeat(64)}`, body: 'I checked it.' };
  const text = `MESSAGE_SEND: ${JSON.stringify(initiated)}\nMESSAGE_SEND: ${JSON.stringify(reply)}\n`;
  for (const delta of [text.slice(0, 8), text.slice(8, 35), text.slice(35, 65), text.slice(65)]) {
    fx.child.frame({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } });
  }
  fx.child.frame({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Ordinary trailing text.' } });
  assert.deepEqual(events.filter((event) => event.kind === 'message.send').map((event) => event.payload), [initiated, reply]);
});

test('OMP interrupt through Coordinator suppresses acceptance and delays follow-up until abort confirmation', async (t) => {
  const fx = await fixture(t);
  let abortFrame;
  let abortWritten;
  const ready = new Promise((resolve) => { abortWritten = resolve; });
  const write = fx.child.stdin.write;
  fx.child.stdin.write = (line) => {
    const frame = JSON.parse(line);
    if (frame.type !== 'abort') return write(line);
    fx.child.written.push(frame);
    abortFrame = frame;
    abortWritten();
    return true;
  };
  let captures = 0;
  fx.coordinator._runTrustGate = async () => { captures += 1; };
  const stopping = fx.coordinator.interrupt(fx.handle.id, 'Continue with revised scope.');
  await ready;
  fx.child.frame({ type: 'agent_end', isTerminal: true, messages: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(captures, 0, 'the interrupted turn never enters contribution acceptance');
  assert.equal(fx.log.read(fx.handle.id).filter((e) => e.kind === 'lifecycle.turn_completed').length, 0);
  assert.equal(fx.child.written.filter((frame) => frame.type === 'prompt').length, 1);
  fx.child.frame({ type: 'response', command: 'abort', id: abortFrame.id, success: true });
  const result = await stopping;
  assert.equal(result.ok, true);
  assert.equal(fx.child.written.filter((frame) => frame.type === 'prompt').length, 2);
  assert.equal(fx.child.written.filter((frame) => frame.type === 'prompt').at(-1).message, 'Continue with revised scope.');
  assert.equal(fx.coordinator._workers.get(fx.handle.id).turnInFlight, true);
  assert.equal(fx.coordinator.list().find((worker) => worker.id === fx.handle.id).status, 'working');
  assert.equal(captures, 0);
});


test('OMP native accounting reaches Coordinator budgets, route observation and governed terminal seals', async (t) => {
  const model = 'deepseek/deepseek-v4-flash';
  const fx = await fixture(t, { model, governed: true });
  let captures = 0;
  fx.coordinator._runTrustGate = async () => { captures += 1; };
  const native = {
    role: 'assistant', provider: 'deepseek', model: 'deepseek-v4-flash',
    timestamp: 100, content: [{ type: 'text', text: 'Implemented.' }], stopReason: 'stop',
    usage: { input: 5, output: 7, cacheRead: 11, cacheWrite: 0, totalTokens: 23,
      cost: { total: 0.001 } },
  };
  fx.child.frame({ type: 'message_start', message: { role: 'assistant' } });
  fx.child.frame({ type: 'message_end', message: native });
  const handle = fx.coordinator._workers.get(fx.handle.id);
  assert.deepEqual(handle.budgetUsed, { tokens: 23, usd: 0.001 });
  assert.equal(handle.modelObserved, model);
  assert.equal(handle.modelMismatch, undefined);
  assert.equal(handle.turnInFlight, true);
  fx.child.frame({ type: 'tool_execution_start', toolCallId: 'native-tool', toolName: 'read' });
  fx.child.frame({ type: 'tool_execution_end', toolCallId: 'native-tool', toolName: 'read', isError: false });
  assert.equal(handle.providerTurn.toolCalls, 1);
  assert.notEqual(handle.providerTelemetryFailed, true);
  fx.child.frame({ type: 'agent_end', isTerminal: true, messages: [native] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(handle.budgetUsed, { tokens: 23, usd: 0.001 });
  assert.equal(handle.providerTerminalSeal.tokens, 'reported');
  assert.equal(handle.providerTerminalSeal.usd, 'reported');
  assert.notEqual(handle.providerTelemetryFailed, true);
  // A-G2 (#281): the OMP card declares `turnCompletion: 'pausable'`, so an ordinary completed
  // turn PARKS as a claimable checkpoint instead of dispatching the gate (coordinator.mjs
  // `_admitPauseRecord`). The gate this row measures still runs — on the explicit claim, which is
  // the only act that may spend a verdict, exactly as the pause contract says.
  const task = fx.coordinator._tasks.get(fx.handle.taskId);
  assert.equal(task.status, 'paused', 'the completed turn parks — no implicit claim');
  assert.equal(captures, 0, 'no gate dispatch at the checkpoint');
  const rows = fx.coordinator.pausedTurns({ taskId: fx.handle.taskId });
  assert.equal(rows.length, 1, 'the checkpoint is visible to the orchestrator');
  const claimed = await fx.coordinator.claimTurn(rows[0].pauseId, { actor: 'orchestrator' });
  assert.equal(claimed.ok, true);
  assert.equal(captures, 1, 'complete observed usage satisfies the configured observation gate');
});
