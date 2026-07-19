import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { runBatonCli } from '../src/application-cli.mjs';
import { bindBatonPort } from '../src/application-client.mjs';
import { BatonApplication } from '../src/application.mjs';
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
          state: 'stopped', targetCount: 1, remainingCount: 0,
          counts: {
            pendingCancelled: 0, killConfirmed: 1, alreadyTerminal: 0,
            processesObserved: 1, processesClosed: 1,
          },
          checks: {
            dispatchClosed: true, interactionsResolved: true, runAuthorityReleased: true,
          },
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
    alreadyTerminal: 0, dispatchClosed: true, interactionsResolved: true,
    killConfirmed: 1, pendingCancelled: 0, processesClosed: 1, processesObserved: 1,
    remainingCount: 0, runAuthorityReleased: true, state: 'stopped', targetCount: 1,
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

test('RT2/RT5: explicit Run bindings cannot be widened by task fallback and append-only resume is stable', () => {
  const f = fixture();
  const first = projectRunTimelinePage({
    runId: 'run-a', events: f.events, snapshot: f.snapshot,
    resolveOperational: f.resolve, limit: 1,
  });
  const conflicting = {
    schemaVersion: 1, worker: 'private-worker-a', seq: 2, ts: at(6),
    kind: 'content.message', actor: 'worker', taskId: 'private-task-a', runId: 'run-b',
    payload: { text: 'cross-run sentinel' },
  };
  f.operational.set(`${conflicting.worker}:${conflicting.seq}`, conflicting);
  f.events.push(mapped(6, conflicting));
  f.events.push(coordination(7, 'task.transitioned', {
    id: 'private-task-a', runId: 'run-b', from: 'working', to: 'completed',
  }));
  f.events.push(coordination(8, 'task.transitioned', {
    id: 'private-task-a', runId: 'run-a', from: 'working', to: 'completed',
  }));
  const resumed = projectRunTimelinePage({
    runId: 'run-a', events: f.events, snapshot: f.snapshot,
    resolveOperational: f.resolve, cursor: first.cursor,
  });
  assert.deepEqual(resumed.items.map((item) => item.position), [2, 3, 4]);
  assert.equal(resumed.items.at(-1).kind, 'task.transitioned');
  assert.equal(JSON.stringify(resumed).includes('cross-run sentinel'), false);
});

test('RT8: production-shaped result and zero-reap receipts retain safe terminal truth', () => {
  const events = [
    coordination(1, 'run.result_adoption_completed', {
      schemaVersion: 1, runId: 'run-zero', nodeKey: 'work',
      receipt: {
        runId: 'run-zero', state: 'adopted',
        result: { ref: 'private-result-ref', sha: 'f'.repeat(40) },
      },
    }),
    coordination(2, 'run.result_export_completed', {
      schemaVersion: 1, exportId: 'a'.repeat(64),
      receipt: {
        runId: 'run-zero', state: 'completed', fileCount: 2, byteCount: 17,
        locator: 'private-export-locator', manifestDigest: 'b'.repeat(64),
      },
    }),
    coordination(3, 'run.stop_completed', {
      schemaVersion: 1, runId: 'run-zero', receipt: {
        state: 'stopped', targetCount: 0, remainingCount: 0,
        counts: {
          pendingCancelled: 0, killConfirmed: 0, alreadyTerminal: 0,
          processesObserved: 0, processesClosed: 0,
        },
        checks: {
          dispatchClosed: true, interactionsResolved: true, runAuthorityReleased: true,
        },
      },
    }),
  ];
  const page = projectRunTimelinePage({ runId: 'run-zero', events, snapshot: {} });
  assert.deepEqual(page.items.map((item) => item.kind), [
    'run.result_adoption_completed', 'run.result_export_completed', 'run.stop_completed',
  ]);
  assert.deepEqual(page.items[0].facts, { state: 'adopted' });
  assert.deepEqual(page.items[1].facts, { byteCount: 17, fileCount: 2, state: 'completed' });
  assert.deepEqual(page.items[2].facts, {
    alreadyTerminal: 0, dispatchClosed: true, interactionsResolved: true,
    killConfirmed: 0, pendingCancelled: 0, processesClosed: 0, processesObserved: 0,
    remainingCount: 0, runAuthorityReleased: true, state: 'stopped', targetCount: 0,
  });
  for (const absent of ['private-result-ref', 'private-export-locator', 'manifestDigest']) {
    assert.equal(JSON.stringify(page).includes(absent), false, `timeline leaked ${absent}`);
  }
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

test('RT1: bound client and CLI reject cross-Run timeline pages before yielding them', async () => {
  const crossRun = {
    schemaVersion: 1, runId: 'run-b', depth: 'content', cursor: 1, terminal: true,
    content: {
      kind: 'baton.run_timeline.page', runId: 'run-b', channel: 'events',
      cursor: 'opaque', hasMore: false, items: [{ runId: 'run-b', position: 1 }],
    },
  };
  const baton = bindBatonPort({ command: async () => crossRun });
  await assert.rejects(baton.runs.open('run-a').events().next(),
    (error) => error.code === 'application_client_protocol_invalid');
  await assert.rejects(runBatonCli({
    kind: 'stream', runId: 'run-a', channel: 'events', follow: false,
    idempotencyKey: 'cross-run-cli',
  }, { command: async () => crossRun }), (error) => error.code === 'cli_protocol_failed');
});

test('RT8: a drained terminal timeline has no continuation, while backlog and live waits do', async () => {
  const current = {
    goal: { runId: 'run-terminal' },
    profile: { followPolicy: { mode: 'enabled', maxWaitMs: 10, maxChanges: 10, maxResponseBytes: 65_536 } },
  };
  let view = { phase: 'stopped', cursor: 9 };
  let content = {
    schemaVersion: 1, kind: 'baton.run_timeline.page', runId: 'run-terminal',
    channel: 'events', cursor: 'page-final', hasMore: false, itemCount: 0, items: [],
  };
  const application = Object.assign(Object.create(BatonApplication.prototype), {
    ready: Promise.resolve(), principals: { observer: { principalId: 'observer' } },
    _assertOpen() {},
    _authorizeRecursiveCommand() {},
    async _authorize() { return true; },
    _findRun() { return current; },
    async _buildView() { return view; },
    _withContextProjection(_run, next) { return next; },
    _semanticBounds() { return { maxItems: 10, maxBytes: 65_536, maxWaitMs: 10 }; },
    _semanticEnvelope() {
      return {
        schemaVersion: 1, runId: 'run-terminal', depth: 'content', cursor: view.cursor,
        changed: false, timedOut: false, terminal: view.phase === 'stopped', truncated: false,
      };
    },
    _semanticSectionItems() {
      return [{ id: 'execution:events', section: 'execution', state: view.phase }];
    },
    _runTimelineContent() { return content; },
    _finalizeSemanticInspection(response) { return response; },
  });
  const request = {
    runId: 'run-terminal', depth: 'content', section: 'execution', item: 'execution:events',
  };
  const principal = { actor: 'direct:test', principalId: 'test', sessionId: 'test-session' };
  const terminal = await application.inspect(request, principal);
  assert.equal(Object.hasOwn(terminal, 'continuation'), false);

  content = { ...content, cursor: 'page-backlog', hasMore: true, items: [{ position: 1 }] };
  const backlog = await application.inspect(request, principal);
  assert.equal(backlog.continuation.arguments.pageCursor, 'page-backlog');
  assert.equal(Object.hasOwn(backlog.continuation.arguments, 'cursor'), false);

  view = { phase: 'running', cursor: 11 };
  content = { ...content, cursor: 'page-live', hasMore: false, items: [] };
  const live = await application.inspect(request, principal);
  assert.equal(live.continuation.arguments.pageCursor, 'page-live');
  assert.equal(live.continuation.arguments.cursor, 11);
});
