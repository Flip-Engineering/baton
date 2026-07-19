import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { projectRunTimelinePage } from '../src/run-timeline.mjs';

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const at = (second) => `2026-07-18T12:00:${String(second).padStart(2, '0')}.000Z`;
const coordination = (seq, kind, payload) => ({
  schemaVersion: 1, seq, ts: at(seq), kind, actor: 'test', idempotencyKey: `event-${seq}`, payload,
});
const mapped = (seq, operational) => coordination(seq, 'evidence.mapped', {
  worker: operational.worker, workerSeq: operational.seq, digest: sha(operational),
  kind: operational.kind, ts: operational.ts,
});

function fixture() {
  const operational = new Map();
  const one = {
    schemaVersion: 1, worker: 'private-worker-a', seq: 1, ts: at(2),
    kind: 'content.message', actor: 'worker', taskId: 'private-task-a', runId: 'run-a',
    payload: { text: 'hello from A', threadId: 'private-thread', command: 'never expose me' },
  };
  const two = {
    schemaVersion: 1, worker: 'private-worker-b', seq: 1, ts: at(4),
    kind: 'content.message', actor: 'worker', taskId: 'private-task-b', runId: 'run-b',
    payload: { text: 'hello from B' },
  };
  operational.set(`${one.worker}:${one.seq}`, one);
  operational.set(`${two.worker}:${two.seq}`, two);
  return {
    operational,
    snapshot: {
      tasks: [
        { id: 'private-task-a', runId: 'run-a', assignee: 'private-worker-a', role: 'work' },
        { id: 'private-task-b', runId: 'run-b', assignee: 'private-worker-b', role: 'review' },
      ],
    },
    events: [
      coordination(1, 'task.created', { id: 'private-task-a', runId: 'run-a' }),
      mapped(2, one),
      coordination(3, 'task.created', { id: 'private-task-b', runId: 'run-b' }),
      mapped(4, two),
      coordination(5, 'run.stop_completed', {
        runId: 'run-a', receipt: {
          targetCount: 1, remainingCount: 0, killConfirmed: 1,
          processesClosed: 1, dispatchClosed: true, runAuthorityReleased: true,
          workerIds: ['private-worker-a'], fence: 99,
        },
      }),
    ],
    resolve({ worker, workerSeq }) { return operational.get(`${worker}:${workerSeq}`) ?? null; },
  };
}

test('RT1/RT2: a Run page has contiguous Run-local positions and excludes sibling/internal authority', () => {
  const f = fixture();
  const page = projectRunTimelinePage({
    runId: 'run-a', events: f.events, snapshot: f.snapshot, resolveOperational: f.resolve,
  });
  assert.deepEqual(page.items.map((item) => item.position), [1, 2, 3]);
  assert.deepEqual(page.items.map((item) => item.kind), [
    'task.created', 'content.message', 'run.stop_completed',
  ]);
  assert.deepEqual(page.items.at(-1).facts, {
    dispatchClosed: true, killConfirmed: 1, processesClosed: 1,
    remainingCount: 0, runAuthorityReleased: true, targetCount: 1,
  });
  const serialized = JSON.stringify(page);
  for (const absent of [
    'run-b', 'private-worker', 'private-task', 'private-thread', 'never expose me', 'fence',
  ]) assert.equal(serialized.includes(absent), false, `timeline leaked ${absent}`);
});

test('RT3/RT5: opaque pagination is deterministic across rebuild and refuses another Run/mode', () => {
  const f = fixture();
  const first = projectRunTimelinePage({
    runId: 'run-a', events: f.events, snapshot: f.snapshot, resolveOperational: f.resolve, limit: 1,
  });
  assert.equal(first.hasMore, true);
  const second = projectRunTimelinePage({
    runId: 'run-a', events: structuredClone(f.events), snapshot: structuredClone(f.snapshot),
    resolveOperational: f.resolve, cursor: first.cursor, limit: 10,
  });
  assert.deepEqual(second.items.map((item) => item.position), [2, 3]);
  assert.throws(() => projectRunTimelinePage({
    runId: 'run-b', events: f.events, snapshot: f.snapshot,
    resolveOperational: f.resolve, cursor: first.cursor,
  }), (error) => error.code === 'run_timeline_cursor_mismatch');
  assert.throws(() => projectRunTimelinePage({
    runId: 'run-a', events: f.events, snapshot: f.snapshot,
    resolveOperational: f.resolve, cursor: first.cursor, includeOutput: true,
  }), (error) => error.code === 'run_timeline_cursor_mismatch');
});

test('RT4: provider output is opt-in, untrusted, UTF-8 safe, and losslessly resumable', () => {
  const text = '🙂αβγ🙂'.repeat(700);
  const operational = {
    schemaVersion: 1, worker: 'hidden-worker', seq: 1, ts: at(1),
    kind: 'content.message', actor: 'worker', taskId: 'hidden-task', runId: 'run-unicode',
    payload: { text },
  };
  const events = [mapped(1, operational)];
  const snapshot = { tasks: [{ id: 'hidden-task', runId: 'run-unicode', assignee: 'hidden-worker' }] };
  const resolve = () => operational;
  let cursor = null;
  const collected = [];
  do {
    const page = projectRunTimelinePage({
      runId: 'run-unicode', events, snapshot, resolveOperational: resolve,
      includeOutput: true, cursor, limit: 2, maxFragmentBytes: 97,
    });
    for (const item of page.items) {
      assert.equal(item.category, 'output');
      assert.equal(item.contentTrust, 'untrusted_provider');
      assert.equal(Buffer.from(item.output.text).toString('utf8'), item.output.text);
      collected.push(item.output.text);
    }
    cursor = page.cursor;
    if (!page.hasMore) break;
  } while (true);
  assert.equal(collected.join(''), text);
  const safe = projectRunTimelinePage({
    runId: 'run-unicode', events, snapshot, resolveOperational: resolve,
  });
  assert.equal(JSON.stringify(safe).includes(text.slice(0, 30)), false);
});

test('RT4 integrity: mapped source mutation fails closed', () => {
  const f = fixture();
  f.operational.get('private-worker-a:1').payload.text = 'tampered';
  assert.throws(() => projectRunTimelinePage({
    runId: 'run-a', events: f.events, snapshot: f.snapshot, resolveOperational: f.resolve,
  }), (error) => error.code === 'run_timeline_evidence_mismatch');
});

