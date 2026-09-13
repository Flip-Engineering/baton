import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const adapter = new OmpRpcCli({ requestTimeoutMs: 1_000, versionProbe: () => 'test' });
  const response = deferred();
  const frames = [];
  const events = [];
  const session = {
    worker: 'w-interrupt', turnEpoch: 1, turnSequence: 1,
    activeTurn: { turnId: 'omp-1', streams: { text: '' } },
    terminalTurns: new Set(), pendingInterrupt: null,
    modelRequested: 'deepseek/deepseek-v4-flash', observedSessionId: 'native-session',
    process: {
      send: (frame) => { frames.push(frame); return frame.type === 'abort' ? response.promise : Promise.resolve({}); },
      notify: (frame) => { frames.push(frame); return true; },
      kill: async () => {},
    },
  };
  adapter._sessions.set(session.worker, session);
  adapter.onEvent((event) => events.push(event));
  return { adapter, session, response, frames, events,
    end: (extra = {}) => adapter._onAgentEnd(session, { isTerminal: true, messages: [], ...extra }),
  };
}

for (const first of ['agent_end', 'abort_response']) {
  test(`OMP interrupt waits for the target turn AND abort response: ${first} arrives first`, async () => {
    const f = fixture();
    assert.equal((await f.adapter.interrupt(f.session.worker, 'continue with revised scope')).ok, true);
    if (first === 'agent_end') f.end();
    else { f.response.resolve({ success: true }); await flush(); }
    assert.equal(f.events.filter((e) => e.kind === 'control.interrupt_confirmed').length, 0);
    assert.equal(f.events.filter((e) => e.kind === 'lifecycle.turn_completed').length, 0,
      'an interrupted target never enters contribution acceptance as an ordinary completion');
    assert.equal(f.frames.filter((frame) => frame.type === 'prompt').length, 0);
    if (first === 'agent_end') { f.response.resolve({ success: true }); await flush(); }
    else f.end();
    const confirmed = f.events.filter((e) => e.kind === 'control.interrupt_confirmed');
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].payload.sessionId, 'native-session');
    assert.equal(confirmed[0].payload.transportOpen, true);
    assert.equal(f.events.filter((e) => e.kind === 'lifecycle.turn_completed').length, 0);
    assert.deepEqual(f.frames.filter((frame) => frame.type === 'prompt').map((frame) => frame.message),
      ['continue with revised scope'], 'follow-up text is delivered once after the old abort cannot reach it');
    assert.equal(f.events.filter((e) => e.kind === 'lifecycle.turn_started').length, 1);
  });
}

test('OMP pending interrupt refuses a new turn until its abort is settled; kill abandons continuation', async () => {
  const f = fixture();
  await f.adapter.interrupt(f.session.worker, 'obsolete continuation');
  f.end();
  assert.equal((await f.adapter.prompt(f.session.worker, 'racing turn')).notSent, true);
  await f.adapter.kill(f.session.worker);
  f.response.resolve({ success: true });
  await flush();
  assert.equal(f.events.filter((e) => e.kind === 'control.interrupt_confirmed').length, 0);
  assert.equal(f.frames.filter((frame) => frame.type === 'prompt').length, 0);
});

test('OMP repeated interrupts share the pending abort and can withdraw a follow-up', async () => {
  const f = fixture();
  await f.adapter.interrupt(f.session.worker, 'withdraw me');
  await f.adapter.interrupt(f.session.worker);
  assert.equal(f.frames.filter((frame) => frame.type === 'abort').length, 1);
  f.response.resolve({ success: true });
  await flush();
  f.end();
  f.end();
  assert.equal(f.events.filter((e) => e.kind === 'control.interrupt_confirmed').length, 1);
  assert.equal(f.events.filter((e) => e.kind === 'lifecycle.turn_completed').length, 0);
  assert.equal(f.frames.filter((frame) => frame.type === 'prompt').length, 0);
});

test('OMP nudge has explicit native prompt semantics when idle and rejects unknown modes', async () => {
  const f = fixture();
  assert.equal((await f.adapter.prompt(f.session.worker, 'invalid', 'bogus')).notSent, true);
  assert.equal(f.frames.length, 0, 'an active turn cannot turn an unsupported mode into a steer');
  f.end();
  assert.equal((await f.adapter.prompt(f.session.worker, 'continue', 'nudge')).ok, true);
  assert.equal(f.frames.at(-1).type, 'prompt');
  assert.equal(f.frames.at(-1).message, 'continue');
});


test('OMP a refused abort never confirms or starts its continuation', async () => {
  const f = fixture();
  await f.adapter.interrupt(f.session.worker, 'must not start');
  f.end();
  f.response.resolve({ success: false, error: 'abort refused' });
  await flush();
  assert.equal(f.events.filter((e) => e.kind === 'control.interrupt_confirmed').length, 0);
  assert.equal(f.frames.filter((frame) => frame.type === 'prompt').length, 0);
  assert.ok(f.session.pendingInterrupt, 'unconfirmed control remains owned');
});

test('OMP an idle interrupt confirms without waiting for a nonexistent turn', async () => {
  const f = fixture();
  f.end();
  assert.equal((await f.adapter.interrupt(f.session.worker)).ok, true);
  assert.equal(f.events.filter((e) => e.kind === 'control.interrupt_confirmed').length, 1);
  assert.equal(f.frames.filter((frame) => frame.type === 'abort').length, 0);
});
