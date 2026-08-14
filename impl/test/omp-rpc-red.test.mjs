import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { EventEmitter } from 'node:events';

// #228 red-first pins. RED at the pre-implementation head means: no OmpRpcCli existed.
// These pins defend the two operator laws the adapter was built under:
//   1. TERMINALITY: evidence-only — no clock/turn/cap ever fails a member.
//   2. TRANSPORT RECOVERY: timeouts retry with backoff; only the process-exit fact
//      (with its death-cert fields) terminalizes.

class FakeStream extends EventEmitter {
  setEncoding() { /* fake */ }
  write() { return true; }
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new FakeStream();
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.pid = 424242;
    this.killed = false;
    this.kill = (signal) => { this.killed = signal ?? true; };
  }
}

const READY = JSON.stringify({ type: 'ready', protocolVersion: 1 }) + '\n';

function makeAdapter(child, { requestTimeoutMs = 1_000 } = {}) {
  const adapter = new OmpRpcCli({
    requestTimeoutMs,
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['low'] },
    spawnFn: () => child,
    versionProbe: () => 'omp test',
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  return { adapter, events };
}

// spawn + immediate ready emission (the session registers synchronously inside spawn
// before waitReady — emitting READY right after the call unblocks setup deterministically).
function spawnReady(adapter, worker) {
  const promise = adapter.spawn(worker, { goal: 'g' }, {
    model: 'deepseek/deepseek-v4-flash', reasoningEffort: 'low', worktree: '/tmp',
    processGeneration: 1,
  });
  adapter._sessions.get(worker).process._onStdout(READY);
  return promise;
}

const emitFrame = (adapter, worker, frame) => {
  adapter._sessions.get(worker)?.process._onStdout(JSON.stringify(frame) + '\n');
};

test('card: the omp harness card carries native-provider posture and no synthetic seat caps', () => {
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 1_000,
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['low', 'high'] },
    versionProbe: () => 'omp test',
  });
  const card = adapter.card();
  assert.equal(card.harness, 'omp');
  assert.equal(card.modelSelection.family, 'omp');
  assert.equal(card.modelSelection.mode, 'exact');
  assert.deepEqual(card.modelSelection.available, ['deepseek/deepseek-v4-flash']);
  assert.equal(card.concurrencyCeiling, 4, 'no synthetic 1x seat cap (the #221 law)');
});

test('TERMINALITY: a mute transport NEVER fails the member — no fate clock exists', async () => {
  const child = new FakeChild();
  const { adapter, events } = makeAdapter(child, { requestTimeoutMs: 30 });
  const spawnOutcome = adapter.spawn('w-test', { goal: 'g' }, {
    model: 'deepseek/deepseek-v4-flash', reasoningEffort: 'low', worktree: '/tmp',
    processGeneration: 1,
  });
  // The mute child never reaches ready; the 30ms transport wait fires many times over.
  // The adapter must hold the member alive — patience is not evidence.
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.ok(adapter._sessions.get('w-test'), 'session held while the child lives');
  const fatal = events.filter((event) => ['lifecycle.crashed', 'lifecycle.process_closed'].includes(event.kind));
  assert.deepEqual(fatal, [], 'no crash/close while the child lives — no fate clock');
  child.emit('exit', 0, null);
  await spawnOutcome.catch(() => {});
});

test('TRANSPORT RECOVERY: a LATE ready frame (post-stall) still completes setup', async () => {
  const child = new FakeChild();
  const { adapter, events } = makeAdapter(child, { requestTimeoutMs: 30 });
  const spawnPromise = adapter.spawn('w-late', { goal: 'g' }, {
    model: 'deepseek/deepseek-v4-flash', reasoningEffort: 'low', worktree: '/tmp',
    processGeneration: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  // NOW the ready frame arrives — absurdly late by any clock standard, still accepted:
  adapter._sessions.get('w-late').process._onStdout(READY);
  const outcome = await spawnPromise;
  assert.equal(outcome.ok, true, 'late ready accepted — setup completed across retries');
  const ready = events.find((event) => event.kind === 'lifecycle.process_ready');
  assert.ok(ready, 'process_ready emitted');
  assert.deepEqual(events.filter((event) => event.kind === 'lifecycle.crashed'), [],
    'the slow start never crashed the member');
  await adapter.kill('w-late');
});

test('TERMINALITY: agent_end isTerminal:false NEVER settles the turn', async () => {
  const child = new FakeChild();
  const { adapter, events } = makeAdapter(child);
  const outcome = await spawnReady(adapter, 'w-term');
  assert.equal(outcome.ok, true);
  await adapter.prompt('w-term', 'do the work', 'turn');
  emitFrame(adapter, 'w-term', { type: 'agent_end', isTerminal: false });
  assert.deepEqual(
    events.filter((event) => event.kind === 'lifecycle.turn_completed'),
    [],
    'non-terminal agent_end does NOT complete the turn',
  );
  assert.ok(events.find((event) => event.payload?.note === 'agent_end_non_terminal'),
    'the continuation is surfaced as evidence');
  emitFrame(adapter, 'w-term', {
    type: 'agent_end', isTerminal: true,
    telemetry: { usage: { input: 10, output: 5 }, cost: 0.001 },
  });
  const done = events.filter((event) => event.kind === 'lifecycle.turn_completed');
  assert.equal(done.length, 1, 'terminal agent_end settles exactly once');
  assert.equal(done[0].payload.usageSeal.tokens, 'reported', 'usage seal from terminal telemetry');
  await adapter.kill('w-term');
});

test('DEATH CERT: process exit mid-turn carries the exit code (#225 field)', async () => {
  const child = new FakeChild();
  const { adapter, events } = makeAdapter(child);
  const outcome = await spawnReady(adapter, 'w-cert');
  assert.equal(outcome.ok, true);
  await adapter.prompt('w-cert', 'work', 'turn');
  child.emit('exit', 137, null);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const crash = events.find((event) => event.kind === 'lifecycle.crashed');
  assert.ok(crash, 'crash emitted on real process exit');
  assert.equal(crash.payload.exitCode, 137, 'the death cert names the exit code');
  assert.equal(crash.payload.phase, 'process_exit');
});

test('UI tolerance: extension_ui_request is answered cancelled, never fatal (#228 anomaly pin)', async () => {
  const child = new FakeChild();
  const { adapter, events } = makeAdapter(child);
  const outcome = await spawnReady(adapter, 'w-ui');
  assert.equal(outcome.ok, true);
  let answered = null;
  child.stdin.write = (line) => { answered = line; return true; };
  emitFrame(adapter, 'w-ui', { type: 'extension_ui_request', id: 'ui_1', method: 'confirm' });
  assert.ok(answered && answered.includes('"cancelled":true'), 'UI request answered cancelled over stdin');
  assert.deepEqual(events.filter((event) => event.kind === 'lifecycle.crashed'), [],
    'a UI frame never kills the member');
  await adapter.kill('w-ui');
});
