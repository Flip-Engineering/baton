import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBrief, createDriver, MockAdapter, MergirafResolver } from '../src/index.mjs';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (root, path, body) => { const file = join(root, path); execFileSync('mkdir', ['-p', join(file, '..')]); writeFileSync(file, body); };
const commit = (root, message) => { git(['add', '-A'], root); git(['commit', '-q', '-m', message], root); return git(['rev-parse', 'HEAD'], root); };
const until = async (fn, timeout = 5000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 10)); } throw new Error('timeout'); };

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'baton-sm-repo-'));
  git(['init', '-q', '-b', 'main'], root); git(['config', 'user.email', 'test@example.com'], root); git(['config', 'user.name', 'Test'], root);
  write(root, 'src/value.js', 'export const values = { alpha: 1 };\n'); commit(root, 'base'); return root;
}

function brief() {
  return createBrief({ goal: 'change value', constraints: [], pathScope: ['src/value.js'], definitionOfDone: 'value module remains valid', verification: { command: 'node src/value.js', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 1 } });
}

async function accepted(root, taskId, workerSource, structuredMerge) {
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/value.js', content: workerSource }] } });
  const logDir = mkdtempSync(join(tmpdir(), 'baton-sm-log-'));
  const driver = createDriver({ repoRoot: root, logDir, adapters: { mock: adapter }, structuredMerge, watchdog: { stallMs: 0 } });
  const handle = await driver.coordinator.spawn('mock', brief(), { taskId });
  await until(async () => (await driver.coordinator.result(handle.id)).ready);
  assert.equal((await driver.coordinator.result(handle.id)).status, 'completed');
  return { ...driver, handle, logDir };
}

test('SM1/SM2: missing resolver refuses a conflict without mutating main', async () => {
  const root = repo(); const { coordinator, handle } = await accepted(root, 'sm-missing', 'export const values = { alpha: 2 };\n', null);
  write(root, 'src/value.js', 'export const values = { alpha: 3 };\n'); commit(root, 'main diverges');
  const before = git(['rev-parse', 'HEAD'], root); const status = git(['status', '--porcelain'], root);
  await assert.rejects(coordinator.integrate(handle.id, { strategy: 'structured' }), (error) => error.code === 'structured_tool_unavailable');
  assert.equal(git(['rev-parse', 'HEAD'], root), before); assert.equal(git(['status', '--porcelain'], root), status);
  assert.equal((await coordinator.result(handle.id)).retainedResultRef?.startsWith('refs/baton/results/'), true);
});

test('SM4: resolver success with conflict markers still refuses and reaps the stage', async () => {
  const root = repo();
  const resolver = { maxFileBytes: 4096, identity: () => ({ tool: 'fake-mergiraf', version: 'test' }), resolve: async () => ({ status: 'resolved' }) };
  const { coordinator, handle } = await accepted(root, 'sm-markers', 'export const values = { alpha: 2 };\n', resolver);
  write(root, 'src/value.js', 'export const values = { alpha: 3 };\n'); commit(root, 'main diverges'); const before = git(['rev-parse', 'HEAD'], root);
  await assert.rejects(coordinator.integrate(handle.id, { strategy: 'structured' }), (error) => error.code === 'structured_unresolved');
  assert.equal(git(['rev-parse', 'HEAD'], root), before);
  assert.equal(existsSync(join(root, '.baton', 'integrate')), false);
});

test('SM6: clean structured resolution is freshly verified before main moves', async () => {
  const root = repo(); let calls = 0; let isolatedCwd = null;
  const resolver = {
    maxFileBytes: 4096,
    identity: () => ({ tool: 'fake-mergiraf', version: 'test' }),
    resolve: async ({ cwd, relativePath, absolutePath }) => { calls += 1; isolatedCwd = cwd; assert.equal(relativePath, 'value.js'); writeFileSync(absolutePath, 'export const values = { alpha: 2, beta: 3 };\n'); return { status: 'resolved' }; },
  };
  const { coordinator, log, handle } = await accepted(root, 'sm-success', 'export const values = { alpha: 2 };\n', resolver);
  write(root, 'src/value.js', 'export const values = { alpha: 1, beta: 3 };\n'); commit(root, 'main adds beta'); const before = git(['rev-parse', 'HEAD'], root);
  const result = await coordinator.integrate(handle.id, { strategy: 'structured', actor: 'test' });
  assert.equal(calls, 1); assert.equal(result.integration.beforeSha, before); assert.equal(result.integration.afterSha, git(['rev-parse', 'HEAD'], root));
  assert.equal(isolatedCwd.includes('baton-structured-conflict-'), true); assert.equal(isolatedCwd.startsWith(root), false);
  assert.equal(result.integration.stageSha, result.integration.afterSha); assert.equal(result.integration.strategy, 'structured');
  assert.equal(result.integration.verdict.reverified, true); assert.equal(result.integration.verdict.passed, true);
  assert.equal(readFileSync(join(root, 'src/value.js'), 'utf8'), 'export const values = { alpha: 2, beta: 3 };\n');
  assert.equal(log.read(handle.id).some((event) => event.kind === 'integration.merge_reverified'), true);
  assert.equal(existsSync(join(root, '.baton', 'integrate')), false);
});

test('SM3-SM7: a clean divergent three-way merge needs no resolver but still gets verified', async () => {
  const root = repo(); const { coordinator, handle } = await accepted(root, 'sm-clean-three-way', 'export const values = { alpha: 2 };\n', null);
  write(root, 'src/main-only.js', 'export const beta = 3;\n'); commit(root, 'main adds another file');
  const result = await coordinator.integrate(handle.id, { strategy: 'structured' });
  assert.equal(result.integration.classes.some((item) => item.class === 'clean_textual'), true);
  assert.equal(result.integration.resolver, null); assert.equal(result.integration.verdict.passed, true);
  assert.equal(readFileSync(join(root, 'src/value.js'), 'utf8'), 'export const values = { alpha: 2 };\n');
  assert.equal(readFileSync(join(root, 'src/main-only.js'), 'utf8'), 'export const beta = 3;\n');
});

test('SM2: a dirty main refuses without changing its bytes or index state', async () => {
  const root = repo(); const { coordinator, handle } = await accepted(root, 'sm-dirty', 'export const values = { alpha: 2 };\n', null);
  writeFileSync(join(root, 'src/value.js'), 'uncommitted user bytes\n'); const before = git(['rev-parse', 'HEAD'], root); const status = git(['status', '--porcelain=v1'], root);
  await assert.rejects(coordinator.integrate(handle.id, { strategy: 'structured' }), (error) => error.code === 'structured_main_dirty');
  assert.equal(git(['rev-parse', 'HEAD'], root), before); assert.equal(git(['status', '--porcelain=v1'], root), status);
  assert.equal(readFileSync(join(root, 'src/value.js'), 'utf8'), 'uncommitted user bytes\n');
});

test('SM4: parse fallback and deployment file ceilings refuse typed', async () => {
  for (const [taskId, resolver, expected] of [
    ['sm-fallback', { maxFileBytes: 4096, identity: () => ({ tool: 'fake' }), resolve: async () => ({ status: 'parse_fallback' }) }, 'structured_parse_fallback'],
    ['sm-file-bound', { maxFileBytes: 8, identity: () => ({ tool: 'fake' }), resolve: async () => { throw new Error('must not run'); } }, 'structured_file_too_large'],
  ]) {
    const root = repo(); const { coordinator, handle } = await accepted(root, taskId, 'export const values = { alpha: 2 };\n', resolver);
    write(root, 'src/value.js', 'export const values = { alpha: 3 };\n'); commit(root, 'main diverges'); const before = git(['rev-parse', 'HEAD'], root);
    await assert.rejects(coordinator.integrate(handle.id, { strategy: 'structured' }), (error) => error.code === expected);
    assert.equal(git(['rev-parse', 'HEAD'], root), before); assert.equal(existsSync(join(root, '.baton', 'integrate')), false);
  }
});

test('SM6: syntactically clean but invalid candidate fails fresh verification and preserves main', async () => {
  const root = repo();
  const resolver = { maxFileBytes: 4096, identity: () => ({ tool: 'fake-mergiraf', version: 'test' }), resolve: async ({ absolutePath }) => { writeFileSync(absolutePath, 'export const values = ;\n'); return { status: 'resolved' }; } };
  const { coordinator, handle } = await accepted(root, 'sm-false-clean', 'export const values = { alpha: 2 };\n', resolver);
  write(root, 'src/value.js', 'export const values = { alpha: 3 };\n'); commit(root, 'main diverges'); const before = git(['rev-parse', 'HEAD'], root);
  await assert.rejects(coordinator.integrate(handle.id, { strategy: 'structured' }), (error) => error.code === 'structured_verification_failed');
  assert.equal(git(['rev-parse', 'HEAD'], root), before); assert.equal(existsSync(join(root, '.baton', 'integrate')), false);
});

test('SM3/SM7: a main advance after staging refuses finalization without rewriting it', async () => {
  const root = repo(); let advanced = false;
  const resolver = { maxFileBytes: 4096, identity: () => ({ tool: 'fake-mergiraf', version: 'test' }), resolve: async ({ absolutePath }) => { writeFileSync(absolutePath, 'export const values = { alpha: 2, beta: 3 };\n'); return { status: 'resolved' }; } };
  const { coordinator, handle } = await accepted(root, 'sm-race', 'export const values = { alpha: 2 };\n', resolver);
  write(root, 'src/value.js', 'export const values = { alpha: 1, beta: 3 };\n'); commit(root, 'main adds beta');
  const raw = coordinator._worktrees.finalizeStructuredIntegration;
  coordinator._worktrees.finalizeStructuredIntegration = async (stage) => { write(root, 'race.txt', 'advanced\n'); commit(root, 'racing main'); advanced = true; return raw(stage); };
  await assert.rejects(coordinator.integrate(handle.id, { strategy: 'structured' }), (error) => error.code === 'structured_main_advanced');
  assert.equal(advanced, true); assert.equal(readFileSync(join(root, 'race.txt'), 'utf8'), 'advanced\n');
});

test('SM1: Mergiraf resolver uses fixed no-shell argv and classifies fallback', async () => {
  const calls = [];
  const resolver = new MergirafResolver({ binary: '/tools/mergiraf', timeoutMs: 1000, maxOutputBytes: 2048, maxFileBytes: 4096, execFile: async (file, args, opts) => { calls.push({ file, args, opts }); return { stdout: 'Solved 1 conflict(s)\n', stderr: '', exitCode: 0 }; } });
  assert.deepEqual(resolver.identity(), { tool: 'mergiraf', binary: '/tools/mergiraf' });
  assert.equal((await resolver.resolve({ cwd: '/stage', relativePath: 'src/value.js', absolutePath: '/stage/src/value.js' })).status, 'resolved');
  assert.deepEqual(calls[0].args, ['solve', 'src/value.js']); assert.equal(calls[0].opts.shell, false);
  const fallback = new MergirafResolver({ binary: 'mergiraf', timeoutMs: 1000, maxOutputBytes: 2048, maxFileBytes: 4096, execFile: async () => ({ stdout: 'falling back to line-based merge', stderr: '', exitCode: 0 }) });
  assert.equal((await fallback.resolve({ cwd: '/stage', relativePath: 'x.js', absolutePath: '/stage/x.js' })).status, 'parse_fallback');
});

test('SM8: post-main coordination failure poisons and replay does not invent structured success', async () => {
  const root = repo();
  const resolver = { maxFileBytes: 4096, identity: () => ({ tool: 'fake-mergiraf', version: 'test' }), resolve: async ({ absolutePath }) => { writeFileSync(absolutePath, 'export const values = { alpha: 2, beta: 3 };\n'); return { status: 'resolved' }; } };
  const { coordinator, coordination, handle, logDir } = await accepted(root, 'sm-authority-failure', 'export const values = { alpha: 2 };\n', resolver);
  write(root, 'src/value.js', 'export const values = { alpha: 1, beta: 3 };\n'); commit(root, 'main adds beta');
  const rawAppend = coordination._appendFile;
  coordination._appendFile = (file, body, encoding) => { if (body.includes('"kind":"knowledge.promoted"') && body.includes('"trigger":"integration"')) throw new Error('structured authority disk full'); return rawAppend(file, body, encoding); };
  await assert.rejects(coordinator.integrate(handle.id, { strategy: 'structured' }), (error) => error.code === 'coordination_write_unavailable');
  const moved = git(['rev-parse', 'HEAD'], root); assert.equal(git(['show', '-s', '--format=%P', moved], root).split(' ').length, 2);
  coordination._appendFile = rawAppend;
  const replay = createDriver({ repoRoot: root, logDir, coordination, adapters: { mock: new MockAdapter({ card: { concurrencyCeiling: 0 } }) }, structuredMerge: resolver, watchdog: { stallMs: 0 } });
  assert.equal((await replay.coordinator.result(handle.id)).integration, null);
});

test('SM9: restart reconciliation reaps an orphan structured stage', async () => {
  const root = repo();
  const resolver = { maxFileBytes: 4096, identity: () => ({ tool: 'fake-mergiraf' }), resolve: async ({ absolutePath }) => { writeFileSync(absolutePath, 'export const values = { alpha: 2, beta: 3 };\n'); return { status: 'resolved' }; } };
  const { coordinator, handle } = await accepted(root, 'sm-orphan', 'export const values = { alpha: 2 };\n', resolver);
  write(root, 'src/value.js', 'export const values = { alpha: 1, beta: 3 };\n'); commit(root, 'main adds beta');
  const capturedSha = coordinator._tasks.get(handle.taskId).capturedSha;
  const stage = await coordinator._worktrees.stageStructuredIntegration(handle.taskId, capturedSha);
  assert.equal(existsSync(stage.stagePath), true);
  const report = await coordinator._worktrees.reconcile();
  assert.equal(report.removedIntegrationDirs.includes(stage.stagePath), true); assert.equal(existsSync(stage.stagePath), false); assert.equal(existsSync(join(root, '.baton', 'integrate')), false);
});
