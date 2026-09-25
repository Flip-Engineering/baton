import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { OmpRpcProcess } from '../src/omp-rpc.mjs';

// CONTROL TRUTH — omp RPC correlation identity and effect truth (omp 17.4.0).
//
// Primary protocol evidence (installed omp 17.4.0, `omp read omp://rpc.md` + the bundled
// rpc-mode implementation, packages/coding-agent/src/modes/rpc/rpc-mode.ts):
//   * "All commands accept optional `id?: string`. If provided, normal command responses echo
//     the same `id`." — correlation is by id alone.
//   * "bash is dispatched concurrently … Ordering across concurrent commands is not guaranteed
//     — clients MUST match responses on `id`, not on emission order." — replies reorder.
//   * `RpcInputDispatcher.dispatch` executes each received frame once, and rpc.md grants NO
//     general idempotency — the only operation it calls idempotent is disabling fast mode. A
//     re-sent `prompt` is a SECOND agent turn, a re-sent `compact` a second compaction.
//   * "`prompt` … may emit a later error response with the SAME id if async prompt scheduling
//     fails." — a late, uncorrelated response is a documented native shape; it keeps riding the
//     existing frame lane rather than acquiring a bespoke adapter-side error format.
//
// The old `send()` derived its id from `JSON.stringify({ payload, n })`: two concurrent
// identical commands collided (the second `_pending.set` overwrote the first waiter, orphaning
// it until exit), and every timeout re-sent the command under a fresh id — replaying timed-out
// effects forever on a claim of idempotency the protocol never made. These pins defend the
// repaired contract: per-call identity that a caller cannot displace, one wire frame per call,
// observer containment, and exit as the only settle-for-everyone fact.

const children = new Set();
test.after(() => { for (const child of children) child.exit(); });

class NativeChild extends EventEmitter {
  constructor() {
    super();
    children.add(this);
    // No pid: OmpRpcProcess then skips the exact-close reap latch, so the raw exit fact drives
    // the close promise — exactly the surface these pins need.
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.written = [];
    // A real spawned child is a live libuv handle that keeps the event loop alive; the
    // adapter's observation timers are unref'd on purpose. Hold the loop for the fixture so
    // the unref'd timers still fire, and drop it with the process-exit fact.
    this.keepalive = setInterval(() => {}, 1_000);
    this.stdin = {
      destroyed: false,
      write: (line) => {
        // Native rpc-mode framing: one unchunked JSONL command per line.
        for (const raw of String(line).split('\n')) {
          if (!raw.trim()) continue;
          this.written.push(JSON.parse(raw));
        }
        return true;
      },
      end: () => { this.stdin.destroyed = true; },
    };
  }
  frame(frame) { this.stdout.write(`${JSON.stringify(frame)}\n`); }
  exit(code = 0, signal = null) {
    children.delete(this);
    clearInterval(this.keepalive);
    setImmediate(() => this.emit('exit', code, signal));
  }
  kill(signal) { this.exit(0, signal ?? null); return true; }
  commands(type) { return this.written.filter((frame) => frame.type === type); }
}

function processFixture(options = {}) {
  const child = new NativeChild();
  const stalls = [];
  const rpc = new OmpRpcProcess({
    command: 'omp', args: ['--mode', 'rpc'], spawnFn: () => child,
    onTransportStall: (info) => stalls.push(info), ...options,
  }).start();
  return { rpc, child, stalls };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('CONTROL TRUTH: concurrent identical commands own distinct ids and resolve independently under reordered replies', async () => {
  const { rpc, child } = processFixture();
  const payload = { type: 'get_session_stats' };
  const first = rpc.send(payload);
  const second = rpc.send(payload);

  assert.equal(child.written.length, 2, 'each send writes exactly one frame');
  const [firstId, secondId] = child.written.map((frame) => frame.id);
  assert.notEqual(firstId, secondId, 'identical payloads never share a correlation identity');
  assert.deepEqual(child.written[0], { type: 'get_session_stats', id: firstId });
  assert.deepEqual(child.written[1], { type: 'get_session_stats', id: secondId });
  assert.equal(rpc._pending.size, 2, 'both waiters are independently pending — neither overwrote the other');

  // Native reorder: the SECOND command's reply lands first (bash concurrency / scheduling).
  child.frame({ type: 'response', id: secondId, command: 'get_session_stats', success: true, data: { answer: 'second' } });
  child.frame({ type: 'response', id: firstId, command: 'get_session_stats', success: true, data: { answer: 'first' } });

  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.equal(firstResponse.id, firstId);
  assert.equal(secondResponse.id, secondId);
  assert.equal(firstResponse.data.answer, 'first', 'the first call resolves with its own reply, not the reordered one');
  assert.equal(secondResponse.data.answer, 'second');
  assert.equal(rpc._pending.size, 0, 'both correlations are consumed exactly once');
  await rpc.kill();
});

test('CONTROL TRUTH: a caller-supplied payload.id cannot displace the minted correlation identity', async () => {
  const { rpc, child } = processFixture();
  const forged = { type: 'get_session_stats', id: 'caller-forged' };
  const first = rpc.send(forged);
  const second = rpc.send(forged);

  const [firstWrite, secondWrite] = child.written;
  assert.notEqual(firstWrite.id, 'caller-forged', 'the caller id never becomes the correlation identity');
  assert.notEqual(secondWrite.id, 'caller-forged');
  assert.notEqual(firstWrite.id, secondWrite.id, 'two forged-id sends still own distinct identities');
  assert.equal(rpc._pending.has('caller-forged'), false, 'no waiter is ever keyed by a caller id');
  assert.equal(rpc._pending.size, 2);

  child.frame({ type: 'response', id: secondWrite.id, command: 'get_session_stats', success: true, data: { answer: 'second' } });
  child.frame({ type: 'response', id: firstWrite.id, command: 'get_session_stats', success: true, data: { answer: 'first' } });
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.equal(firstResponse.data.answer, 'first');
  assert.equal(secondResponse.data.answer, 'second');
  await rpc.kill();
});

test('CONTROL TRUTH: a timed-out command is observed, never re-sent — the late correlated reply still settles it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { rpc, child, stalls } = processFixture({ waitAttemptMs: 40 });
  const pending = rpc.send({ type: 'prompt', message: 'do the work', streamingBehavior: 'steer' });
  const [command] = child.written;
  assert.equal(command.type, 'prompt');

  for (let observation = 0; observation < 5; observation += 1) t.mock.timers.tick(40);
  assert.equal(child.written.length, 1, 'the timed-out command is NOT re-sent — no duplicated native effect');
  assert.ok(stalls.length >= 2, `the wait is observed while the child lives (got ${stalls.length})`);
  assert.ok(stalls.every((info) => info.phase === 'command_wait' && info.id === command.id),
    'every observation is evidence for this exact correlation');
  assert.ok(stalls.every((info) => /NOT re-sent/u.test(info.note)),
    'the observation states that no re-send happened');
  assert.equal(rpc._pending.has(command.id), true, 'the waiter stays correlated across the timeout');

  // The late native reply resolves the ORIGINAL promise — no new wire command is needed.
  child.frame({ type: 'response', id: command.id, command: 'prompt', success: true });
  const response = await pending;
  assert.equal(response.id, command.id);
  assert.equal(response.success, true);
  assert.equal(child.written.length, 1, 'a late reply never mints a replacement send');

  const observed = stalls.length;
  t.mock.timers.tick(160);
  assert.equal(stalls.length, observed, 'a settled correlation is never observed again — no leaked recurring timer');
  assert.equal(rpc._pending.size, 0);
  await rpc.kill();
});

test('CONTROL TRUTH: an observer that synchronously settles the wait never leaks a recurring timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = new NativeChild();
  const stalls = [];
  let rpc = null;
  rpc = new OmpRpcProcess({
    command: 'omp', args: ['--mode', 'rpc'], spawnFn: () => child, waitAttemptMs: 30,
    onTransportStall: (info) => {
      stalls.push(info);
      if (stalls.length === 1) {
        // The observer callback synchronously delivers the correlated reply (the callback case:
        // settlement can happen INSIDE the observation, before the timer re-arms).
        rpc._onStdout(`${JSON.stringify({ type: 'response', id: info.id, command: 'get_session_stats', success: true })}\n`);
      }
    },
  }).start();

  const response = rpc.send({ type: 'get_session_stats' });
  t.mock.timers.tick(30);
  const frame = await response;
  assert.equal(frame.success, true);
  assert.equal(stalls.length, 1);
  t.mock.timers.tick(150);
  assert.equal(stalls.length, 1, 'a wait settled during its own observation is never re-armed');
  assert.equal(rpc._pending.size, 0);
  await rpc.kill();
});

test('CONTROL TRUTH: a throwing stall observer never breaks the wait — the late reply still settles it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = new NativeChild();
  let calls = 0;
  const rpc = new OmpRpcProcess({
    command: 'omp', args: ['--mode', 'rpc'], spawnFn: () => child, waitAttemptMs: 30,
    onTransportStall: () => { calls += 1; throw new Error('observer defect (fixture)'); },
  }).start();
  const pending = rpc.send({ type: 'prompt', message: 'work' });
  const [command] = child.written;

  for (let observation = 0; observation < 4; observation += 1) t.mock.timers.tick(30);
  assert.ok(calls >= 2, `the observation loop keeps running past an observer defect (got ${calls})`);
  child.frame({ type: 'response', id: command.id, command: 'prompt', success: true });
  const frame = await pending;
  assert.equal(frame.id, command.id);
  assert.equal(child.written.length, 1, 'no re-send accompanies the observation');
  await rpc.kill();
});

test('CONTROL TRUTH: process exit settles every pending waiter, and nothing is written after', async () => {
  const { rpc, child } = processFixture();
  const prompt = rpc.send({ type: 'prompt', message: 'turn one' });
  const stats = rpc.send({ type: 'get_session_stats' });
  assert.equal(child.written.length, 2);
  assert.equal(rpc._pending.size, 2);

  child.exit(137, null);
  const [promptResult, statsResult] = await Promise.all([prompt, stats]);
  for (const result of [promptResult, statsResult]) {
    assert.equal(result.success, false, 'the exit fact settles the waiter');
    assert.equal(result.code, 'transport_process_exit');
    assert.equal(result.error, 'process exited');
  }
  assert.equal(rpc.exited, true);
  assert.equal(rpc._pending.size, 0, 'no waiter is left behind on a dead child');
  await assert.rejects(
    () => rpc.send({ type: 'prompt', message: 'turn two' }),
    (error) => error.code === 'transport_process_exit',
  );
  assert.equal(child.written.length, 2, 'nothing is written after the exit fact');
});

test('CONTROL TRUTH: a refused stdin write is surfaced typed and never silently re-sent', async () => {
  const { rpc, child } = processFixture({ onTransportStall: () => { throw new Error('observer defect (fixture)'); } });
  let attempts = 0;
  child.stdin.write = () => { attempts += 1; throw new Error('EPIPE (fixture refusal)'); };

  await assert.rejects(
    () => rpc.send({ type: 'prompt', message: 'once' }),
    (error) => error.code === 'transport_write_failed',
    'a throwing observer never replaces the typed write refusal',
  );
  assert.equal(attempts, 1, 'the refusal is surfaced, never retried — a re-send could double an effect');
  assert.equal(rpc._pending.size, 0, 'no waiter is left for a frame that was never accepted');
  await rpc.kill();
});

test('CONTROL TRUTH: notify treats write(false) as accepted backpressure, not a refusal', async () => {
  const { rpc, child } = processFixture();
  const written = [];
  child.stdin.write = (line) => { written.push(line); return false; }; // buffered, high-water mark hit
  assert.equal(rpc.notify({ type: 'steer', message: 'keep going' }), true,
    'write(false) is backpressure — the frame is accepted');
  assert.equal(JSON.parse(written[0]).type, 'steer');
  await rpc.kill();
});

test('CONTROL TRUTH: a late uncorrelated response rides the existing onFrame evidence seam', async () => {
  const child = new NativeChild();
  const frames = [];
  const rpc = new OmpRpcProcess({
    command: 'omp', args: ['--mode', 'rpc'], spawnFn: () => child, onFrame: (frame) => frames.push(frame),
  }).start();
  const pending = rpc.send({ type: 'get_session_stats' });
  const [command] = child.written;
  child.frame({ type: 'response', id: command.id, command: 'get_session_stats', success: true, data: { sessionId: 'sess-1' } });
  assert.equal((await pending).data.sessionId, 'sess-1');

  // rpc.md: `prompt` may emit a later failure response with the SAME id after its ack.
  child.frame({ type: 'response', id: command.id, command: 'get_session_stats', success: false, error: 'late scheduling failure' });
  await tick();
  const late = frames.find((frame) => frame.type === 'response' && frame.success === false);
  assert.ok(late, 'the late response reaches the onFrame evidence seam instead of being swallowed');
  assert.equal(late.id, command.id);
  assert.equal(late.error, 'late scheduling failure');
  await rpc.kill();
});
