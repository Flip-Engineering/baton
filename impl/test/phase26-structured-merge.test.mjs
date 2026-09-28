import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBrief, createDriver, MockAdapter } from '../src/index.mjs';

import { reapFixtureDirectories } from '../scripts/suite-hygiene.mjs';

reapFixtureDirectories();

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (root, path, body) => { const file = join(root, path); execFileSync('mkdir', ['-p', join(file, '..')]); writeFileSync(file, body); };
const commit = (root, message) => { git(['add', '-A'], root); git(['commit', '-q', '-m', message], root); return git(['rev-parse', 'HEAD'], root); };
const until = async (fn, timeout = 5000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 10)); } throw new Error('timeout'); };

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'baton-sm-repo-'));
  git(['init', '-q', '-b', 'main'], root); Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_EMAIL: 'test@example.com' }); Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_COMMITTER_NAME: 'Test' });
  write(root, 'src/value.js', 'export const values = { alpha: 1 };\n'); commit(root, 'base'); return root;
}

function brief() {
  return createBrief({ goal: 'change value', constraints: [], pathScope: ['src/value.js'], definitionOfDone: 'value module remains valid', verification: { command: 'node src/value.js', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 1 } });
}

async function accepted(root, taskId, workerSource, structuredMerge, taskBrief = brief()) {
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/value.js', content: workerSource }] } });
  const logDir = mkdtempSync(join(tmpdir(), 'baton-sm-log-'));
  const driver = createDriver({ repoRoot: root, logDir, adapters: { mock: adapter }, structuredMerge, watchdog: { stallMs: 60_000 } }); // valid positive stallMs; watchdog never fires in this window
  const handle = await driver.coordinator.spawn('mock', taskBrief, { taskId });
  await until(async () => (await driver.coordinator.result(handle.id)).ready);
  assert.equal((await driver.coordinator.result(handle.id)).status, 'completed');
  return { ...driver, handle, logDir };
}

test('SM9: reconciliation preserves an integration stage until its owner explicitly cleans it', async () => {
  const root = repo();
  const resolver = { maxFileBytes: 4096, identity: () => ({ tool: 'fake-mergiraf' }), resolve: async ({ absolutePath }) => { writeFileSync(absolutePath, 'export const values = { alpha: 2, beta: 3 };\n'); return { status: 'resolved' }; } };
  const { coordinator, handle } = await accepted(root, 'sm-orphan', 'export const values = { alpha: 2 };\n', resolver);
  write(root, 'src/value.js', 'export const values = { alpha: 1, beta: 3 };\n'); commit(root, 'main adds beta');
  const capturedSha = coordinator._tasks.get(handle.taskId).capturedSha;
  const stage = await coordinator._worktrees.stageStructuredIntegration(handle.taskId, capturedSha);
  assert.equal(existsSync(stage.stagePath), true);
  const report = await coordinator._worktrees.reconcile();
  assert.deepEqual(report.removedIntegrationDirs, []);
  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(stage.stagePath), true);
  assert.ok(report.diagnostics.some((row) => row.kind === 'integrate' && row.path === stage.stagePath && row.retained));
  await coordinator._worktrees.removeStructuredIntegration(stage);
  assert.equal(existsSync(stage.stagePath), false);
});
