import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { usdToNanos } from '../src/usd.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { validateProviderGovernanceCard } from '../src/provider-governance.mjs';

function fixture() {
  const adapter = new OmpRpcCli({ requestTimeoutMs: 1000, versionProbe: () => '17.4.0-fixture' });
  const events = [];
  const session = {
    worker: 'w-usage', turnEpoch: 0, turnSequence: 0, processGeneration: 1,
    terminalTurns: new Set(), pendingInterrupt: null,
    modelRequested: 'deepseek/deepseek-v4-flash', effortRequested: 'high',
    process: { send: async () => ({ success: true }), notify: () => true },
  };
  adapter._sessions.set(session.worker, session);
  adapter.onEvent((event) => events.push(event));
  adapter._startTurn(session, 'work');
  return { adapter, session, events,
    frame: (frame) => adapter._onFrame(session, frame),
    usage: () => events.filter((event) => event.kind === 'resource.tokens'),
    complete: () => events.filter((event) => event.kind === 'lifecycle.turn_completed'),
  };
}
function message(overrides = {}) {
  return {
    role: 'assistant', provider: 'deepseek', model: 'deepseek-v4-flash',
    timestamp: 100, content: [{ type: 'text', text: 'Working' }], stopReason: 'stop',
    usage: { input: 2, output: 3, cacheRead: 7, cacheWrite: 5, totalTokens: 17, cost: { total: 0.001 } },
    ...overrides,
  };
}
function call(fx, value) {
  fx.frame({ type: 'message_start', message: { role: value.role, timestamp: value.timestamp } });
  fx.frame({ type: 'message_end', message: value });
}

test('OMP native usage reaches budgets and qualified model observation before the turn ends', () => {
  const fx = fixture();
  const first = message();
  call(fx, first);
  assert.equal(fx.complete().length, 0);
  assert.equal(fx.usage().length, 1);
  assert.equal(fx.usage()[0].payload.tokens, 17, 'the native total already includes cache dimensions');
  assert.equal(fx.usage()[0].payload.usd, 0.001);
  assert.equal(fx.usage()[0].payload.modelObserved, 'deepseek/deepseek-v4-flash');
  assert.equal(fx.usage()[0].payload.effortObserved, undefined);
  const second = message({ timestamp: 101, usage: { totalTokens: 4, cost: { total: 0.002 } } });
  call(fx, second);
  fx.frame({ type: 'agent_end', isTerminal: true, messages: [first, second], telemetry: { usage: { tokens: 21 }, cost: 0.003 } });
  assert.equal(fx.usage().reduce((sum, event) => sum + (event.payload.tokens ?? 0), 0), 21);
  assert.equal(fx.usage().reduce((sum, event) => sum + (event.payload.usd ?? 0), 0), 0.003);
  const seal = fx.complete()[0].payload.usageSeal;
  assert.equal(seal.tokens, 'reported');
  assert.equal(seal.usd, 'reported');
  assert.equal(seal.counterId, fx.usage()[0].payload.counterId);
  assert.equal(seal.tokenMetric, fx.adapter.card().governance.usage.tokenMetric);
  assert.doesNotThrow(() => validateProviderGovernanceCard(fx.adapter.card()));
});

test('OMP repeated end frames do not duplicate a message boundary or its terminal receipt', () => {
  const fx = fixture();
  const value = message();
  call(fx, value);
  fx.frame({ type: 'message_end', message: value });
  assert.equal(fx.usage().length, 1);
  call(fx, value); // a real subsequent boundary may legitimately cost the same amount
  assert.equal(fx.usage().length, 2);
  const end = { type: 'agent_end', isTerminal: true, messages: [value, value] };
  fx.frame(end); fx.frame(end);
  assert.equal(fx.usage().length, 2);
  assert.equal(fx.complete().length, 1);
});

test('OMP assistant identity is independent of usage, and user metadata is never provider authority', () => {
  const fx = fixture();
  call(fx, message({ role: 'user', model: 'forged' }));
  assert.equal(fx.usage().length, 0);
  call(fx, message({ usage: undefined }));
  assert.equal(fx.usage()[0].payload.modelObserved, 'deepseek/deepseek-v4-flash');
  assert.equal(Object.hasOwn(fx.usage()[0].payload, 'tokens'), false);
  assert.equal(Object.hasOwn(fx.usage()[0].payload, 'usd'), false);
  call(fx, message({ provider: 'glm', model: 'glm-5.2', usage: undefined }));
  assert.equal(fx.usage().at(-1).payload.modelObserved, 'glm/glm-5.2', 'later native route changes remain observable');
});

for (const stopReason of ['error', 'aborted']) {
  test(`OMP native ${stopReason} retains incurred usage and never claims successful completion`, () => {
    const fx = fixture();
    const value = message({ stopReason, errorMessage: 'native failure' });
    call(fx, value);
    fx.frame({ type: 'agent_end', isTerminal: true, messages: [] });
    assert.equal(fx.usage()[0].payload.tokens, 17);
    assert.equal(fx.complete()[0].payload.status, 'failed');
    assert.equal(fx.complete()[0].payload.failure.code, `omp_${stopReason}`);
  });
}

test('OMP terminal messages provide fallback usage without inventing unsupported telemetry dimensions', () => {
  const fx = fixture();
  fx.frame({ type: 'agent_end', isTerminal: true, messages: [message()] });
  assert.equal(fx.usage().reduce((sum, event) => sum + (event.payload.tokens ?? 0), 0), 17);
  const previous = fx.complete()[0].payload.usageSeal.counterId;
  fx.adapter._startTurn(fx.session, 'another task');
  call(fx, message({ usage: { totalTokens: 0, cost: { total: 0 } } }));
  fx.frame({ type: 'agent_end', isTerminal: true });
  assert.equal(fx.usage().at(-1).payload.tokens, 0, 'native zero is a real report');
  assert.notEqual(fx.complete().at(-1).payload.usageSeal.counterId, previous);
  fx.adapter._startTurn(fx.session, 'missing native usage');
  fx.frame({ type: 'agent_end', isTerminal: true, telemetry: { usage: { tokens: 99 }, cost: 100 } });
  assert.equal(fx.complete().at(-1).payload.usageSeal.tokens, 'unavailable');
  assert.equal(fx.complete().at(-1).payload.usageSeal.usd, 'unavailable');
});

test('OMP native nonterminal segments continue usage observation within the same Baton turn', () => {
  const fx = fixture();
  call(fx, message());
  fx.frame({ type: 'agent_end', isTerminal: false, messages: [message()] });
  assert.equal(fx.complete().length, 0);
  fx.frame({ type: 'agent_start' });
  call(fx, message({ timestamp: 101 }));
  fx.frame({ type: 'agent_end', isTerminal: true });
  assert.equal(fx.usage().reduce((sum, event) => sum + (event.payload.tokens ?? 0), 0), 34);
  assert.equal(fx.complete().length, 1);
});


test('OMP captured native review stream accounts each call and native price once', () => {
  const captured = JSON.parse(readFileSync(new URL('./fixtures/omp-native-usage.json', import.meta.url)));
  const fx = fixture();
  for (const frame of captured.frames) fx.frame(frame);
  assert.equal(fx.complete().length, 1);
  assert.equal(fx.usage().length, captured.expected.assistantCalls);
  assert.equal(fx.usage().reduce((total, event) => total + event.payload.tokens, 0), captured.expected.tokens);
  assert.equal(fx.usage().reduce((total, event) => total + usdToNanos(event.payload.usd), 0), captured.expected.usdNanos);
  assert.equal(fx.complete()[0].payload.usageSeal.tokens, 'reported');
  assert.equal(fx.complete()[0].payload.usageSeal.usd, 'reported');
});


test('OMP partial streaming coverage preserves known usage without certifying the full turn', () => {
  const fx = fixture();
  const first = message();
  call(fx, first);
  fx.frame({ type: 'agent_end', isTerminal: true, messages: [first, message({ timestamp: 101 })] });
  assert.equal(fx.usage().reduce((total, event) => total + event.payload.tokens, 0), 17);
  assert.equal(fx.complete()[0].payload.usageSeal.tokens, 'unavailable');
});


// TERMINAL COMPLETENESS: a member under provider governance validates the usage seal on
// EVERY terminal event, so an omitted seal reads as `usage_seal_invalid` telemetry — the
// Coordinator then fails the task as a provider-governance violation and hard-stops it. A
// session that died before its first turn observed no usage; that is exactly the unavailable
// seal, stated. A setup failure is a process-exit cause, never a fabricated accounting breach.
test('OMP setup process-exit crash states an unavailable usage seal instead of omitting it', async () => {
  const child = new EventEmitter();
  child.pid = 4243;
  child.stdin = { write: () => true };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 5_000,
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['high'] },
    versionProbe: () => 'omp test',
    reapOwnedProcessGroup: async () => ({ confirmed: true, reason: null }),
    spawnFn: () => {
      setImmediate(() => child.emit('exit', 1, null));
      return child;
    },
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  const ack = await adapter.spawn('w-setup', { goal: 'setup' }, {
    worktree: '/tmp', model: 'deepseek/deepseek-v4-flash', reasoningEffort: 'high',
  });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'setup_process_exit');
  const crashed = events.find((event) => event.kind === 'lifecycle.crashed' && event.payload?.phase === 'setup');
  assert.ok(crashed, 'the setup process exit is the terminal event');
  const seal = crashed.payload.usageSeal;
  assert.ok(seal, 'a terminal event must state its usage seal, never omit it');
  assert.deepEqual(Object.keys(seal).sort(), ['counterId', 'tokenMetric', 'tokens', 'usd']);
  assert.equal(seal.tokens, 'unavailable', 'no turn began, so no usage was observed');
  assert.equal(seal.usd, 'unavailable');
  assert.equal(seal.counterId, null);
  assert.equal(seal.tokenMetric, null);
});
