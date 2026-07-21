import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { Log } from '../src/log.mjs';

test('AX85-1: createDriver rebuilds truthful worker activity from durable operational logs', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase85-activity-replay-'));
  const repoRoot = join(root, 'repo');
  const logDir = join(root, 'state');
  mkdirSync(repoRoot, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'phase85@example.invalid'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Phase 85'], { cwd: repoRoot });
  writeFileSync(join(repoRoot, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repoRoot });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = new Log(logDir, () => '2026-07-19T00:00:00.000Z');
  const common = {
    worker: 'worker-replay', harness: 'mock@1', turnEpoch: 1,
    taskId: 'task-replay', runId: 'run-replay',
  };
  log.append({
    ...common, turnEpoch: 0, kind: 'lifecycle.spawned', actor: 'orchestrator',
    payload: {
      taskId: 'task-replay',
      brief: { pathScope: ['impl/**'], budget: { tokens: 1_000, usd: 1, wallMin: 1 } },
    },
  });
  log.append({ ...common, kind: 'lifecycle.turn_started', actor: 'worker', payload: {} });
  log.append({
    ...common, kind: 'resource.tokens', actor: 'worker',
    payload: { tokens: 321, usd: 0, accounting: 'delta' },
  });
  log.append({
    ...common, kind: 'content.file_edit', actor: 'worker',
    payload: { paths: [`${repoRoot}/.baton/wt/worker-replay/impl/src/application.mjs`] },
  });
  log.append({
    ...common, kind: 'control.recovery_terminalized', actor: 'policy',
    payload: { code: 'recovery_terminalized' },
  });

  const driver = createDriver({
    repoRoot, logDir,
    adapters: { mock: new MockAdapter({ harness: 'mock' }) },
  });
  const worker = driver.story.snapshot().workers['worker-replay'];
  assert.equal(worker.turnCount, 1);
  assert.deepEqual(worker.budgetUsed, { tokens: 321, usd: 0 });
  assert.deepEqual(worker.editedPaths, ['impl/src/application.mjs']);
  assert.ok(worker.lastEventSeq >= 5);
  assert.equal(worker.status, 'exited');
});
