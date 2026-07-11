import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationIntegrityError, CoordinationRefusal, CoordinationStore } from '../src/coordination-store.mjs';
import { createDriver, MockAdapter } from '../src/index.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'baton-coordination-'));
const fields = (id, deps = []) => ({ id, brief: { goal: id }, deps, refines: null, taskType: 'test', reservedWorkerId: `w-${id}` });

test('CK1: duplicate idempotency key returns the original event without mutation', () => {
  const store = new CoordinationStore(dir());
  const a = store.createTask(fields('a'), { actor: 'orchestrator', key: 'create-a' });
  const b = store.createTask(fields('changed'), { actor: 'orchestrator', key: 'create-a' });
  assert.equal(b.result, 'idempotent');
  assert.equal(b.event.seq, a.event.seq);
  assert.deepEqual(store.snapshot().tasks.map((task) => task.id), ['a']);
});

test('CK1: append failure is fatal and leaves event/task projections unchanged', () => {
  const store = new CoordinationStore(dir(), { appendFile: () => { throw new Error('disk full'); } });
  assert.throws(() => store.createTask(fields('a'), { actor: 'orchestrator', key: 'a' }), /disk full/);
  assert.deepEqual(store.snapshot(), { tasks: [], lastSeq: 0 });
});

test('CK1: startup rejects truncated tails, sequence gaps, and duplicate keys', () => {
  const truncated = dir();
  writeFileSync(join(truncated, 'events.jsonl'), '{"schemaVersion":1');
  assert.throws(() => new CoordinationStore(truncated), (error) => error instanceof CoordinationIntegrityError && error.code === 'truncated_tail');

  const gap = dir();
  writeFileSync(join(gap, 'events.jsonl'), `${JSON.stringify({ schemaVersion: 1, seq: 2, ts: 'x', kind: 'task.created', actor: 'x', idempotencyKey: 'a', payload: fields('a') })}\n`);
  assert.throws(() => new CoordinationStore(gap), (error) => error.code === 'sequence_gap');

  const duplicate = dir();
  const one = { schemaVersion: 1, seq: 1, ts: 'x', kind: 'task.created', actor: 'x', idempotencyKey: 'a', payload: fields('a') };
  const two = { ...one, seq: 2, payload: fields('b') };
  writeFileSync(join(duplicate, 'events.jsonl'), `${JSON.stringify(one)}\n${JSON.stringify(two)}\n`);
  assert.throws(() => new CoordinationStore(duplicate), (error) => error.code === 'duplicate_key');
});

test('CK2: queued DAG and ready set replay with exact deps and reserved handle', () => {
  const root = dir();
  const store = new CoordinationStore(root);
  store.createTask(fields('base'), { actor: 'orchestrator', key: 'base' });
  store.createTask(fields('child', ['base']), { actor: 'orchestrator', key: 'child' });
  assert.deepEqual(store.readyTasks().map((task) => task.id), ['base']);
  const replay = new CoordinationStore(root);
  assert.deepEqual(replay.task('child').deps, ['base']);
  assert.equal(replay.task('child').reservedWorkerId, 'w-child');
  assert.equal(replay.task('child').assignee, null);
  assert.deepEqual(replay.readyTasks().map((task) => task.id), ['base']);
});

test('CK2: claim CAS has one winner; stale/blocked refusals append nothing', () => {
  const store = new CoordinationStore(dir());
  store.createTask(fields('a'), { actor: 'orchestrator', key: 'a' });
  const winner = store.claimTask('a', 'w1', 1, { actor: 'orchestrator', key: 'claim-a' });
  assert.equal(winner.task.assignee, 'w1');
  const before = store.events().length;
  assert.throws(() => store.claimTask('a', 'w2', 1, { actor: 'orchestrator', key: 'claim-b' }), (error) => error instanceof CoordinationRefusal && error.code === 'stale_version');
  assert.equal(store.events().length, before);
});

test('CK2: terminal state is immutable across replay', () => {
  const root = dir();
  const store = new CoordinationStore(root);
  store.createTask(fields('a'), { actor: 'orchestrator', key: 'a' });
  store.claimTask('a', 'w1', 1, { actor: 'orchestrator', key: 'claim' });
  store.transitionTask('a', 'completed', 2, { actor: 'policy', key: 'done' }, { verification: 7 });
  assert.throws(() => store.transitionTask('a', 'working', 3, { actor: 'x', key: 'reopen' }), (error) => error.code === 'terminal');
  assert.equal(new CoordinationStore(root).task('a').status, 'completed');
});

test('CK8/CK9: public driver exposes coordination and queued DAG survives restart before dispatch', async () => {
  const repo = dir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo });
  const logDir = dir();
  const make = () => createDriver({
    repoRoot: repo, logDir,
    adapters: { mock: new MockAdapter({ card: { concurrencyCeiling: 0 }, scenario: { outcome: 'completed' } }) },
    watchdog: { stallMs: 0 },
  });
  const brief = { goal: 'queued', constraints: [], pathScope: [], definitionOfDone: 'never dispatch', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1, usd: 1, wallMin: 1 } };
  const first = make();
  const base = await first.coordinator.spawn('mock', brief, { taskId: 'base' });
  const child = await first.coordinator.spawn('mock', brief, { taskId: 'child', deps: ['base'] });
  assert.ok(first.coordination instanceof CoordinationStore);
  assert.deepEqual(first.coordination.readyTasks().map((task) => task.id), ['base']);
  assert.equal(first.log.workers().length, 0, 'neither queued task reached a worker log');

  const replay = make();
  assert.deepEqual(replay.coordinator.list().map((worker) => worker.taskId), ['base', 'child']);
  assert.equal(replay.coordinator.list().find((worker) => worker.id === base.id)?.status, 'pending');
  assert.equal(replay.coordinator.list().find((worker) => worker.id === child.id)?.status, 'pending');
  assert.deepEqual(replay.coordination.task('child').deps, ['base']);
  assert.equal(replay.coordination.task('child').assignee, null);
  assert.deepEqual(replay.coordination.readyTasks().map((task) => task.id), ['base']);
});
