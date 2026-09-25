import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpJsonRpcProcess } from '../src/acp-json-rpc-process.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-kimi-acp.mjs', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wireLog = () => join(mkdtempSync(join(tmpdir(), 'acp-control-truth-')), 'wire.ndjson');
const readWire = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const settleState = (promise, ms) => Promise.race([
  promise.then(() => 'settled', () => 'settled'),
  delay(ms).then(() => 'pending'),
]);
const spawned = (extra = {}) => new AcpJsonRpcProcess({
  command: process.execPath, args: [fixture, '--serve'], setupTimeoutMs: 1000, ...extra,
}).start();

// A PID no kernel can hold (macOS caps pids far below this), so the owned-group signal is a real
// ESRCH path while the fake child stays fully under test control.
const ABSENT_PID = 2 ** 30;

class FakeStream extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.writableEnded = false; }
  setEncoding() {}
  destroy() { this.destroyed = true; return this; }
  write(_chunk, callback) { if (typeof callback === 'function') callback(null); return true; }
}

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.pgid = pid;
    this.detached = true;
    this.stdin = new FakeStream();
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.signals = [];
  }
  kill(signal) { this.signals.push(signal); return true; }
}

test('control truth: a timed-out effect is never replayed and the child stays live', async () => {
  const log = wireLog();
  const acp = spawned({ env: { ...process.env, FAKE_KIMI_MODE: 'prompt-hang', FAKE_KIMI_LOG: log } });
  try {
    const opened = await acp.request('session/new', { cwd: process.cwd(), mcpServers: [] });
    assert.equal(typeof opened.sessionId, 'string');

    const timedOut = await acp.request('session/prompt', { sessionId: opened.sessionId, prompt: [] }, { timeoutMs: 150 })
      .then(() => null, (error) => error);
    assert.equal(timedOut?.name, 'AcpSetupTimeoutError');
    assert.equal(timedOut?.code, 'timeout');

    // Longer than the retired replay ladder's first rung (250ms) plus a fresh attempt window: a
    // replayed effect would show up as a second `session/prompt` on the wire.
    await delay(600);
    const prompts = readWire(log).filter((frame) => frame.method === 'session/prompt');
    assert.equal(prompts.length, 1, 'one timed-out effect = exactly one wire request');
    assert.equal(alive(acp.child.pid), true, 'a timeout never stops the child');
    assert.equal(acp.failure, null);

    // Productive transport work continues on the live child, with fresh correlation.
    const initialized = await acp.request('initialize', { protocolVersion: 1 });
    assert.equal(initialized.agentInfo.name, 'Kimi Code CLI');

    // An explicit caller retry is the caller's decision and takes a fresh id — never a settled one.
    await acp.request('session/prompt', { sessionId: opened.sessionId, prompt: [] }, { timeoutMs: 150 })
      .then(() => null, (error) => error);
    await delay(50);
    const retried = readWire(log).filter((frame) => frame.method === 'session/prompt');
    assert.equal(retried.length, 2, 'the explicit retry is a second wire request');
    assert.notEqual(retried[0].id, retried[1].id, 'a retry never reuses a settled id');
  } finally { await acp.kill(); }
});

test('control truth: a late response to an abandoned id is ignored, not fatal', async () => {
  const log = wireLog();
  const acp = spawned({ env: { ...process.env, FAKE_KIMI_MODE: 'out-of-order', FAKE_KIMI_LOG: log } });
  try {
    const timedOut = await acp.request('slow', {}, { timeoutMs: 10 }).then(() => null, (error) => error);
    assert.equal(timedOut?.code, 'timeout');

    // The fixture answers `slow` 30ms later, after the caller already gave up on the id.
    await delay(120);
    assert.equal(acp.failure, null, 'the abandoned response must not fail the transport');
    assert.equal(alive(acp.child.pid), true);

    const answer = await acp.request('initialize', { protocolVersion: 1 });
    assert.equal(answer.agentInfo.name, 'Kimi Code CLI');
  } finally { await acp.kill(); }
});

test('control truth: an abandoned request never disturbs a concurrent correlated response', async () => {
  const acp = spawned({ env: { ...process.env, FAKE_KIMI_MODE: 'out-of-order' } });
  try {
    const [slow, fast] = await Promise.allSettled([acp.request('slow', {}, { timeoutMs: 5 }), acp.request('fast')]);
    assert.equal(slow.status, 'rejected');
    assert.equal(slow.reason.code, 'timeout');
    assert.equal(fast.status, 'fulfilled');
    assert.deepEqual(fast.value, { method: 'fast' });

    await delay(80); // the abandoned frame's late answer lands here
    assert.equal(acp.failure, null);
    assert.equal(alive(acp.child.pid), true);
  } finally { await acp.kill(); }
});

test('control truth: an unobserved death stays unconfirmed instead of reporting a stop', async () => {
  const child = new FakeChild(ABSENT_PID);
  const acp = new AcpJsonRpcProcess({
    command: 'fake-acp', setupTimeoutMs: 50, reapTimeoutMs: 60,
    spawnFn: () => child,
    reapOwnedProcessGroup: () => new Promise(() => {}),
  }).start();
  assert.deepEqual(child.signals, [], 'start never signals');

  const outcome = await acp.kill({ kind: 'kill.confirmed', payload: {} });
  assert.equal(outcome.confirmed, false, 'kill must not report a confirmation it never observed');
  assert.equal(outcome.reason, 'close_pending');
  assert.equal(acp.closed, false);
  assert.equal(acp.processClose.confirmed, false);
  assert.ok(child.signals.length >= 1, 'bounded owned cleanup still signalled the owned group');
  assert.equal(await settleState(acp.closePromise, 30), 'pending', 'the terminal never becomes a confirmed stop');
});

test('control truth: a delayed death confirms only after the exact group reap is observed', async () => {
  const child = new FakeChild(ABSENT_PID);
  const reaps = [];
  let confirmReap;
  let closedEvents = 0;
  let stopEvents = 0;
  const acp = new AcpJsonRpcProcess({
    command: 'fake-acp', setupTimeoutMs: 50, reapTimeoutMs: 500,
    spawnFn: () => child,
    reapOwnedProcessGroup: (processGroupId, opts) => {
      reaps.push({ processGroupId, timeoutMs: opts?.timeoutMs });
      return new Promise((resolve) => { confirmReap = resolve; });
    },
    onProcessClosed: () => { closedEvents += 1; },
    onStopConfirmed: () => { stopEvents += 1; },
  }).start();

  const stopping = acp.kill({ kind: 'kill.confirmed', payload: { terminalCause: 'setup' } });
  assert.equal(await settleState(stopping, 100), 'pending', 'kill does not confirm before the exit is observed');

  child.emit('close', null, 'SIGKILL');
  await delay(20);
  assert.equal(await settleState(acp.closePromise, 40), 'pending', 'the retained close fact awaits its exact reap');
  assert.equal(reaps.length, 1);
  assert.deepEqual(reaps[0], { processGroupId: ABSENT_PID, timeoutMs: 500 });
  assert.equal(closedEvents, 0);
  assert.equal(stopEvents, 0);

  confirmReap({ confirmed: true, reason: null });
  const settled = await stopping;
  assert.deepEqual(settled, { confirmed: true, reason: null, code: null, signal: 'SIGKILL', pid: ABSENT_PID });
  assert.equal(await acp.closePromise, settled);
  assert.equal(closedEvents, 1);
  assert.equal(stopEvents, 1);
  assert.equal(acp.processClose.confirmed, true);
});

test('control truth: an unconfirmed reap publishes no stop and an explicit kill retries it', async () => {
  const child = new FakeChild(ABSENT_PID);
  const reaps = [];
  const reapFailures = [];
  let confirmReap;
  let closedEvents = 0;
  let stopEvents = 0;
  const acp = new AcpJsonRpcProcess({
    command: 'fake-acp', setupTimeoutMs: 50, reapTimeoutMs: 200,
    spawnFn: () => child,
    reapOwnedProcessGroup: () => { reaps.push(1); return new Promise((resolve) => { confirmReap = resolve; }); },
    onProcessClosed: () => { closedEvents += 1; },
    onStopConfirmed: () => { stopEvents += 1; },
    onProcessReapUnconfirmed: (payload) => { reapFailures.push(payload.reason); },
  }).start();

  const stopping = acp.kill({ kind: 'kill.confirmed', payload: {} });
  child.emit('close', null, 'SIGKILL');
  await delay(20);
  confirmReap({ confirmed: false, reason: 'deadline' });

  const settled = await stopping;
  assert.deepEqual(settled, { confirmed: false, reason: 'deadline' });
  assert.equal(closedEvents, 0, 'an unconfirmed reap never publishes process_closed');
  assert.equal(stopEvents, 0, 'an unconfirmed reap never publishes kill.confirmed');
  assert.deepEqual(reapFailures, ['deadline']);
  assert.equal(acp.processClose.pending, true, 'the exact close fact is retained for an explicit retry');
  assert.equal(acp.processClose.confirmed, false);
  assert.equal(await settleState(acp.closePromise, 30), 'pending');

  // Explicit caller retry: the next kill runs one new bounded reap, which can then confirm.
  const retry = acp.kill();
  assert.equal(reaps.length, 2, 'the retry is a new physical reap attempt');
  confirmReap({ confirmed: true, reason: null });
  const confirmed = await retry;
  assert.equal(confirmed.confirmed, true);
  assert.equal(acp.processClose.confirmed, true);
  assert.equal(closedEvents, 1);
  assert.equal(stopEvents, 1);
});
