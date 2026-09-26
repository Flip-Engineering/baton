// Issue #402: a failed worker-generation binding must leave a trace. The binding writer
// (runtime-observation `recordWorkerGeneration`) caught the coordination store's refusal and
// returned null with nothing recorded — a lost durable generation binding was indistinguishable
// from one that never ran. The fix routes the failure through the named receipt writer the file's
// other worker-scoped acts use: the worker's operational log (`recorder.log.append`), as a
// `worker.generation_bind_failed` row naming the worker, the generation, the task and the
// refusal's own code. The function still returns null — the caller's flow is unchanged — but the
// failure now says itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recordWorkerGeneration } from '../src/runtime-observation.mjs';

const handle = () => ({
  id: 'w-7', taskId: 't-1', processGeneration: 3, vendor: 'omp', turnEpoch: 2,
});

const coordinator = () => ({
  _tasks: new Map([['t-1', { id: 't-1', runId: 'run-1' }]]),
  _harnessOf: (vendor) => vendor,
});

test('402: a refused generation binding records a worker.generation_bind_failed receipt and still returns null', () => {
  const appended = [];
  const recorder = {
    coordination: {
      task: () => ({ id: 't-1', version: 4 }),
      recordWorkerGeneration: () => {
        throw Object.assign(new Error('ledger refused the binding'), { code: 'generation_refused' });
      },
    },
    log: { append: (row) => { appended.push(row); return { seq: appended.length }; } },
  };

  const result = recordWorkerGeneration(coordinator(), recorder, handle());
  assert.equal(result, null, 'the flow still returns null — the caller is unchanged');
  assert.equal(appended.length, 1, 'the failure left exactly one trace');
  const row = appended[0];
  assert.equal(row.kind, 'worker.generation_bind_failed', 'under the binding-failure kind');
  assert.equal(row.worker, 'w-7', 'naming the worker the binding belonged to');
  assert.equal(row.actor, 'hub', 'as the hub act it is');
  assert.equal(row.payload.workerId, 'w-7');
  assert.equal(row.payload.processGeneration, 3);
  assert.equal(row.payload.taskId, 't-1');
  assert.equal(row.payload.code, 'generation_refused', 'with the refusal own code');
  assert.ok(typeof row.payload.message === 'string' && row.payload.message.length > 0,
    'and the refusal own words, bounded');
  assert.ok(row.payload.message.length <= 300, 'the message is bounded');
});

test('402: a successful binding records nothing beside it', () => {
  const appended = [];
  const recorder = {
    coordination: {
      task: () => ({ id: 't-1', version: 4 }),
      recordWorkerGeneration: () => ({ ok: true }),
    },
    log: { append: (row) => { appended.push(row); return { seq: appended.length }; } },
  };

  const result = recordWorkerGeneration(coordinator(), recorder, handle());
  assert.deepEqual(result, { ok: true }, 'the binding rides unchanged');
  assert.equal(appended.length, 0, 'no failure trace on success');
});
