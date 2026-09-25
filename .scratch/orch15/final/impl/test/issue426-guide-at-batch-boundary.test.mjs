import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

// Issue #426 red pin — mid-turn guidance to an omp seat must not interrupt its in-flight tool
// batch. Reported by the open-glm seat on compare-389 (2026-09-18): five queued guides each
// interrupted a batch mid-flight and cost a retry. docs/10: guidance rides the data plane and
// "respects turn boundaries; delivered when the recipient is ready". The adapter already reads
// the batch phases off the wire (content.tool_call requested/completed ride
// tool_execution_start/end), so a guide that arrives mid-batch is QUEUED until the batch
// completes, then delivered; guides held at one boundary coalesce into ONE steer carrying them
// in order; the delivery receipt names deliveredAt ('batch_boundary' | 'idle') and the
// coalesced count, and each guide keeps its own messageId on it.
//
// RED   = a mid-batch nudge writes its steer frame immediately (the batch is interrupted) and
//         no delivery receipt exists; idle/queued acks carry no delivery truth.
// GREEN = queued-at-boundary delivery, one-frame coalescing, receipts, and at-once idle
//         delivery — with the batch never re-run and no replay of held guidance as a turn.

const line = (frame) => `${JSON.stringify(frame)}\n`;

async function until(fn, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not met');
}

// The fixture omp wire (omp-false-stall's shape): answers the ready handshake, acks correlated
// prompt commands, and records every stdin frame with the monotonic tick it was written at, so
// the test can order deliveries against the batch frames staged on stdout. `stage()` stamps the
// same clock when the test writes a frame at the child, making "delivered after the batch's
// completed frame" a tick comparison, never a guess from wall-clock timing.
function buildFixture() {
  const writes = []; // { tick, frame } — every frame written to the child's stdin
  const staged = []; // { tick, frame } — every frame the test staged on the child's stdout
  let tick = 0;
  const nextTick = () => ++tick;
  let childStdout = null;
  let promptCount = 0;
  class FakeChild extends EventEmitter {
    constructor() {
      super();
      this.pid = 426426;
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.stdin = {
        write: (chunk) => {
          let frame = null;
          try { frame = JSON.parse(chunk); } catch { frame = null; }
          if (frame) {
            writes.push({ tick: nextTick(), frame });
            if (frame.type === 'prompt' && typeof frame.id === 'string') {
              promptCount += 1;
              const id = frame.id;
              setImmediate(() => childStdout.write(line({ type: 'response', id, success: true })));
            }
          }
          return true;
        },
        end: () => {},
      };
    }
    kill(signal) {
      setImmediate(() => this.emit('exit', 0, signal ?? null));
    }
  }
  const spawnFn = () => {
    const child = new FakeChild();
    childStdout = child.stdout;
    setImmediate(() => { child.stdout.write(line({ type: 'ready', protocolVersion: 1 })); });
    return child;
  };
  const stage = (frame) => {
    const at = nextTick();
    staged.push({ tick: at, frame });
    childStdout.write(line(frame));
    return at;
  };
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 5_000,
    model: 'm',
    modelCatalog: { m: ['high'] },
    ceiling: 1,
    versionProbe: () => 'omp test',
    spawnFn,
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  return {
    adapter, events, stage,
    steers: () => writes.filter((entry) => entry.frame.type === 'steer'),
    prompts: () => writes.filter((entry) => entry.frame.type === 'prompt'),
    promptCount: () => promptCount,
    receipts: () => events.filter((event) => event.kind === 'control.guide_delivered'),
    lastStagedTick: () => staged.at(-1)?.tick ?? 0,
  };
}

async function spawned(fixture) {
  const ack = await fixture.adapter.spawn('w-426', { goal: 'hold the batch boundary' }, {
    worktree: '/tmp', model: 'm', reasoningEffort: 'high',
  });
  assert.equal(ack.ok, true, `spawn ok (${JSON.stringify(ack).slice(0, 120)})`);
  await until(() => fixture.promptCount() === 1); // the first turn rides spawn (#230)
  return ack;
}

test('426 (a): a guide during an in-flight batch is delivered after the batch completes — the batch is not re-run', async () => {
  const fixture = buildFixture();
  await spawned(fixture);

  const startTick = fixture.stage({ type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'bash' });
  const ack = await fixture.adapter.prompt('w-426', 'keep the lane', 'nudge');
  assert.equal(ack.ok, true, 'the guide is accepted');
  assert.equal(ack.queued, true, 'a mid-batch guide is queued, never written mid-batch');
  assert.ok(typeof ack.messageId === 'string' && ack.messageId.length > 0, 'the guide keeps its own messageId');
  assert.equal(fixture.steers().length, 0, 'nothing rides the wire while the batch is in flight');

  const endTick = fixture.stage({ type: 'tool_execution_end', toolCallId: 'tc-1', toolName: 'bash', result: 'ok' });
  await until(() => fixture.steers().length === 1);
  const delivery = fixture.steers()[0];
  assert.ok(delivery.tick > endTick && endTick > startTick,
    'the steer is written only after the batch completed frame');
  assert.equal(delivery.frame.message, 'keep the lane');
  assert.equal(fixture.promptCount(), 1, 'the batch is not re-run — no second prompt exists');

  const receipts = fixture.receipts();
  assert.equal(receipts.length, 1, 'exactly one delivery receipt');
  assert.equal(receipts[0].payload.deliveredAt, 'batch_boundary');
  assert.equal(receipts[0].payload.coalesced, 1);
  assert.deepEqual(receipts[0].payload.messageIds, [ack.messageId]);
  // Event-lane order mirrors the wire order: the completed tool row precedes the receipt.
  const completedIdx = fixture.events.findIndex(
    (event) => event.kind === 'content.tool_call' && event.payload?.phase === 'completed');
  const receiptIdx = fixture.events.findIndex((event) => event.kind === 'control.guide_delivered');
  assert.ok(completedIdx >= 0 && completedIdx < receiptIdx,
    'the batch completed frame is observed before the delivery receipt');

  await fixture.adapter.kill('w-426');
});

test('426 (b): three guides during one batch arrive as one delivery, in order', async () => {
  const fixture = buildFixture();
  await spawned(fixture);

  fixture.stage({ type: 'tool_execution_start', toolCallId: 'tc-a', toolName: 'bash' });
  const acks = [];
  for (const text of ['guide one', 'guide two', 'guide three']) {
    acks.push(await fixture.adapter.prompt('w-426', text, 'nudge'));
  }
  assert.ok(acks.every((ack) => ack.ok && ack.queued), 'all three queue behind the batch');
  assert.equal(new Set(acks.map((ack) => ack.messageId)).size, 3, 'each guide keeps its own messageId');
  assert.equal(fixture.steers().length, 0, 'nothing rides the wire while the batch is in flight');

  fixture.stage({ type: 'tool_execution_end', toolCallId: 'tc-a', toolName: 'bash', result: 'ok' });
  await until(() => fixture.steers().length >= 1);
  await new Promise((resolve) => setTimeout(resolve, 25)); // settle any stragglers
  assert.equal(fixture.steers().length, 1, 'ONE delivery, not three');
  assert.equal(fixture.steers()[0].frame.message, 'guide one\n\nguide two\n\nguide three',
    'the coalesced steer carries all three guides in order');
  assert.equal(fixture.promptCount(), 1, 'no re-run — the batch boundary is not a new turn');

  const receipts = fixture.receipts();
  assert.equal(receipts.length, 1, 'one receipt for the one delivery');
  assert.equal(receipts[0].payload.deliveredAt, 'batch_boundary');
  assert.equal(receipts[0].payload.coalesced, 3);
  assert.deepEqual(receipts[0].payload.messageIds, acks.map((ack) => ack.messageId));

  await fixture.adapter.kill('w-426');
});

test('426 (c): a guide while idle is delivered at once', async () => {
  const fixture = buildFixture();
  await spawned(fixture);

  fixture.stage({
    type: 'agent_end', isTerminal: true,
    messages: [{ role: 'assistant', content: [{ type: 'text', text: 'settled' }] }],
  });
  await until(() => fixture.events.some((event) => event.kind === 'lifecycle.turn_completed'));
  const promptsBefore = fixture.promptCount();
  const steersBefore = fixture.steers().length;

  const ack = await fixture.adapter.prompt('w-426', 'wake and continue', 'nudge');
  assert.equal(ack.ok, true);
  assert.equal(ack.deliveredAt, 'idle', 'the idle guide is delivered at once');
  assert.equal(ack.coalesced, 1);
  assert.ok(typeof ack.messageId === 'string' && ack.messageId.length > 0);
  await until(() => fixture.promptCount() === promptsBefore + 1);
  assert.equal(fixture.steers().length, steersBefore, 'an idle delivery rides the new turn prompt, not a steer');

  const receipts = fixture.receipts();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].payload.deliveredAt, 'idle');
  assert.equal(receipts[0].payload.coalesced, 1);
  assert.deepEqual(receipts[0].payload.messageIds, [ack.messageId]);

  await fixture.adapter.kill('w-426');
});

test('426 (d): a guide mid-turn with no batch pending is delivered at once on the native steer lane', async () => {
  const fixture = buildFixture();
  await spawned(fixture);

  const ack = await fixture.adapter.prompt('w-426', 'course note', 'nudge');
  assert.equal(ack.ok, true);
  assert.equal(ack.deliveredAt, 'idle', 'no batch pending — delivered at once');
  assert.equal(ack.coalesced, 1);
  await until(() => fixture.steers().length === 1);
  assert.equal(fixture.steers()[0].frame.message, 'course note');
  assert.equal(fixture.promptCount(), 1, 'the running turn stays the running turn');

  const receipts = fixture.receipts();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].payload.deliveredAt, 'idle');
  assert.deepEqual(receipts[0].payload.messageIds, [ack.messageId]);

  await fixture.adapter.kill('w-426');
});

test('426 (e): guidance stranded past its turn rides the next explicit turn — never replayed as a turn of its own', async () => {
  const fixture = buildFixture();
  await spawned(fixture);

  fixture.stage({ type: 'tool_execution_start', toolCallId: 'tc-x', toolName: 'bash' });
  const ack = await fixture.adapter.prompt('w-426', 'held guidance', 'nudge');
  assert.equal(ack.queued, true);

  // The turn ends before the batch ever closes (the interrupted-batch shape): no replay, the
  // turn boundary is honest, and the guide is not lost.
  fixture.stage({ type: 'agent_end', isTerminal: true, messages: [] });
  await until(() => fixture.events.some((event) => event.kind === 'lifecycle.turn_completed'));
  assert.equal(fixture.promptCount(), 1, 'turn end never mints a provider turn of its own');
  assert.equal(fixture.adapter._sessions.get('w-426').guideQueue.length, 1, 'the guide stays held');

  const next = await fixture.adapter.prompt('w-426', 'fresh turn body', 'turn');
  assert.equal(next.ok, true);
  await until(() => fixture.promptCount() === 2);
  assert.equal(fixture.prompts()[1].frame.message, 'held guidance\n\nfresh turn body',
    'the held guide composes ahead of the explicit continuation');
  const receipts = fixture.receipts();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].payload.deliveredAt, 'idle');
  assert.equal(receipts[0].payload.coalesced, 1);
  assert.deepEqual(receipts[0].payload.messageIds, [ack.messageId]);

  await fixture.adapter.kill('w-426');
});
