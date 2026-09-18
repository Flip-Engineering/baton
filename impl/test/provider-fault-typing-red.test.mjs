import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { PROVIDER_FAULT_CODES } from '../src/provider-faults.mjs';

// #295 item 1: the provider fault is TYPED at the boundary that received it. A failed turn whose
// answer names a limit is `provider_quota_exhausted` (with the reset instant the answer carried),
// a dropped connection is `provider_socket_closed`, and anything else is the named generic
// `provider_turn_failed` — never a bare `omp_<stopReason>`, and never prose re-read downstream.
//
// The observed shape these pins close: a `429 Usage limit reached ... will reset at <time>` killed
// a participant as an anonymous dead runtime, and a closed socket was indistinguishable from any
// other turn error.

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
    this.pid = 515151;
    this.killed = false;
    this.kill = (signal) => { this.killed = signal ?? true; };
  }
}

const READY = `${JSON.stringify({ type: 'ready', protocolVersion: 1 })}\n`;
const MODEL = 'deepseek/deepseek-flash';

function makeAdapter(child) {
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 1_000,
    modelCatalog: { [MODEL]: ['low', 'high'] },
    spawnFn: () => child,
    versionProbe: () => 'omp test',
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  return { adapter, events };
}

function spawnReady(adapter, worker) {
  const promise = adapter.spawn(worker, { goal: 'g' }, {
    model: MODEL, reasoningEffort: 'high', worktree: '/tmp', processGeneration: 1,
  });
  adapter._sessions.get(worker).process._onStdout(READY);
  return promise;
}

const emitFrame = (adapter, worker, frame) => {
  adapter._sessions.get(worker)?.process._onStdout(`${JSON.stringify(frame)}\n`);
};

const failedTurn = (events) => events.findLast((event) => event.kind === 'lifecycle.turn_completed');

async function failingTurn(worker, errorMessage, extra = {}) {
  const child = new FakeChild();
  const { adapter, events } = makeAdapter(child);
  const outcome = await spawnReady(adapter, worker);
  assert.equal(outcome.ok, true);
  await adapter.prompt(worker, 'do the work', 'turn');
  emitFrame(adapter, worker, {
    type: 'agent_end',
    isTerminal: true,
    messages: [{
      role: 'assistant', stopReason: 'error', errorMessage, ...extra,
    }],
  });
  return { adapter, events, child };
}

test('PF-A: a limit answer with a reset instant types as provider_quota_exhausted and carries {route, resetAt}', async () => {
  const { events } = await failingTurn(
    'w-quota',
    '429 Usage limit reached for the deepseek provider. Your limit will reset at 2026-09-14 20:40:02',
  );
  const turn = failedTurn(events);
  assert.equal(turn.payload.status, 'failed');
  assert.equal(turn.payload.failure.code, PROVIDER_FAULT_CODES.quota,
    'the limit class is typed at the boundary, never left as omp_error');
  assert.deepEqual(turn.payload.failure.detail.route,
    { harness: 'omp', model: MODEL, effort: 'high' },
    'the fault names the exact route it is a fact about');
  // #442 item 4: this answer spelled a wall-clock with NO zone. The typed fault keeps the
  // provider's own words and derives no instant from them — reading a zone-less wall-clock as UTC
  // invented the instant that sat hours off the one the provider meant (measured 2026-09-18 on the
  // zai quota answer). The zone-qualified case is the next row.
  assert.equal(turn.payload.failure.detail.resetAt, null);
  assert.equal(turn.payload.failure.detail.resetAtText, '2026-09-14 20:40:02');
  assert.ok(!/omp_error/u.test(turn.payload.failure.code), 'no adapter-local stopReason code leaks');
});

test('PF-A: an explicit zone in the reset instant is honored, never reinterpreted', async () => {
  const { events } = await failingTurn(
    'w-quota-zone',
    'Usage limit reached; it will reset at 2026-09-14T22:40:02+02:00',
  );
  assert.equal(failedTurn(events).payload.failure.detail.resetAt, '2026-09-14T20:40:02.000Z');
});

test('PF-A: a limit answer that names no reset instant still types as quota with resetAt null', async () => {
  const { events } = await failingTurn('w-quota-open', '429 too many requests: rate limit exceeded');
  const failure = failedTurn(events).payload.failure;
  assert.equal(failure.code, PROVIDER_FAULT_CODES.quota);
  assert.equal(failure.detail.resetAt, null, 'absence is labelled absence — never an invented instant');
});

test('PF-A: a closed provider socket types as provider_socket_closed', async () => {
  const { events } = await failingTurn('w-socket', 'The socket connection was closed unexpectedly');
  const failure = failedTurn(events).payload.failure;
  assert.equal(failure.code, PROVIDER_FAULT_CODES.socket);
  assert.equal(failure.detail.resetAt, null);
  assert.deepEqual(failure.detail.route, { harness: 'omp', model: MODEL, effort: 'high' });
});

test('PF-A: an unclassifiable failed turn types as the named generic, never anonymous', async () => {
  const { events } = await failingTurn('w-generic', 'the model produced an unusable frame');
  assert.equal(failedTurn(events).payload.failure.code, PROVIDER_FAULT_CODES.generic);
});

test('PF-A: an aborted turn keeps the control code — a control act is not a provider fault', async () => {
  const { events } = await failingTurn('w-abort', '', { stopReason: 'aborted' });
  assert.equal(failedTurn(events).payload.failure.code, 'omp_aborted');
});

test('PF-B: the death cert names the typed fault and its detail — a rate-limited death is never anonymous', async () => {
  const { events, child } = await failingTurn(
    'w-cert-quota',
    '429 Usage limit reached; will reset at 2026-09-14 20:40:02',
  );
  child.emit('exit', 1, null);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const crashed = events.find((event) => event.kind === 'lifecycle.crashed');
  assert.ok(crashed, 'the process-exit fact is published as a crash cert');
  assert.equal(crashed.payload.code, PROVIDER_FAULT_CODES.quota,
    'the cert carries the class the wire already carried, not a bare phase');
  assert.equal(crashed.payload.detail.resetAt, null, 'a zone-less answer derives no instant');
  assert.equal(crashed.payload.detail.resetAtText, '2026-09-14 20:40:02');
  assert.equal(crashed.payload.detail.route.model, MODEL);
});
