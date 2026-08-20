import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

// #243 red pin — omp answer() was a stub ('not yet schema-pinned'); member questions on
// the #228 fleet could never be answered. Protocol pinned from the omp 17.3.4 binary:
//   request:  {type:'extension_ui_request', id, method: 'input'|'confirm'|'select'|'cancel', title, ...}
//   response: {type:'extension_ui_response', id, value} | {type:'extension_ui_response', id, cancelled:true}
//
// RED   = answer() refuses ({ok:false}) and extension_ui_request frames auto-cancel without
//         ever surfacing the question.
// GREEN = the request surfaces as an interaction event carrying the frame; answer() writes
//         the {id, value} response frame to the child's stdin; a dead/unknown request
//         answers cancelled, never throws.

class FakeStream extends EventEmitter {
  setEncoding() {}
  write(chunk) { this.emit('data', chunk); return true; }
}
class SpyStream extends FakeStream {
  constructor(sink) { super(); this.sink = sink; }
  write(chunk) { if (typeof chunk === 'string') this.sink.push(...chunk.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return { raw: l.slice(0, 80) }; } })); return super.write(chunk); }
}
class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.written = [];
    this.stdin = new SpyStream(this.written);
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.pid = 424242;
    this.killed = false;
    this.kill = () => { this.killed = true; };
  }
  notify(frame) { this.written.push(frame); }
}
const line = (o) => JSON.stringify(o) + '\n';

function adapterWith(child) {
  return new OmpRpcCli({
    requestTimeoutMs: 60_000,
    model: 'm', modelCatalog: { m: ['high'] }, ceiling: 1, versionProbe: () => 't',
    spawnFn: () => {
      setTimeout(() => child.stdout.write(line({ type: 'ready', protocolVersion: 1 })), 10);
      return child;
    },
  });
}

test('OMP-ANSWER (#243): a member question surfaces and answer() writes the id-correlated response frame', async () => {
  const child = new FakeChild();
  const adapter = adapterWith(child);
  const events = [];
  adapter.onEvent((e) => events.push(e));
  const ack = await adapter.spawn('w-243', { goal: 'q' }, { worktree: '/tmp', model: 'm', reasoningEffort: 'high' });
  assert.equal(ack.ok, true);
  await new Promise((r) => setTimeout(r, 50));

  // A real-shaped question arrives: input elicitation.
  child.stdout.write(line({
    type: 'extension_ui_request', id: 'req-1', method: 'input',
    title: 'Which route?', placeholder: 'model name',
  }));
  await new Promise((r) => setTimeout(r, 30));

  // THE PIN part 1: the question SURFACED — an interaction event carries the frame, it was
  // not silently auto-cancelled.
  const surfaced = events.find((e) => e.kind === 'interaction.requested' && e.payload?.id === 'req-1');
  assert.ok(surfaced, `the question surfaced as interaction.requested (kinds seen: ${[...new Set(events.map((e) => e.kind))].join(', ')})`);
  assert.equal(surfaced.payload.method, 'input');
  assert.ok(!child.written.some((f) => f.type === 'extension_ui_response' && f.id === 'req-1' && f.cancelled === true),
    'no auto-cancel raced the operator');

  // THE PIN part 2: answer() writes the id-correlated response frame.
  const answered = await adapter.answer('w-243', { id: 'req-1', value: 'glm/glm-5.3' });
  assert.equal(answered.ok, true, `answer resolves ok (got ${JSON.stringify(answered)})`);
  const frame = child.written.find((f) => f.type === 'extension_ui_response' && f.id === 'req-1');
  assert.ok(frame, 'the response frame was written to the child');
  assert.equal(frame.value, 'glm/glm-5.3');
  assert.notEqual(frame.cancelled, true);

  // Unknown request id answers cancelled, never throws.
  const late = await adapter.answer('w-243', { id: 'req-gone', value: 'x' });
  assert.equal(late.ok, true);
  const lateFrame = child.written.find((f) => f.type === 'extension_ui_response' && f.id === 'req-gone');
  assert.ok(lateFrame?.cancelled === true, 'an unknown/dead request answers cancelled');

  await adapter.kill('w-243').catch(() => {});
});
