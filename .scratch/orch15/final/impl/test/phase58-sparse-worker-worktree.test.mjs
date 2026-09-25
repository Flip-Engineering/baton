import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockAdapter, createDriver } from '../src/index.mjs';
import {
  captureCommit, createFromBase, listWorktrees, markStopped, normalizeSparsePaths, reap,
} from '../src/worktree.mjs';

function sh(cmd, args, cwd, opts = {}) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', ...opts }).trim();
}

function write(root, path, content) {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

function makeRepo(label = 'repo') {
  const repo = mkdtempSync(join(tmpdir(), `baton-pg58-${label}-`));
  sh('git', ['init', '-q'], repo);
  sh('git', ['config', 'user.email', 'phase58@example.test'], repo);
  sh('git', ['config', 'user.name', 'Baton Phase 58'], repo);
  write(repo, 'README.md', '# phase 58\n');
  write(repo, 'src/main.js', 'export const value = 1;\n');
  write(repo, 'src/nested/helper.js', 'export const helper = true;\n');
  write(repo, 'config/settings.json', '{"enabled":true}\n');
  write(repo, 'docs/guide.md', '# large unselected guide\n');
  write(repo, 'fixtures/large.bin', 'unselected fixture\n');
  sh('git', ['add', '-A'], repo);
  sh('git', ['commit', '-q', '-m', 'phase 58 base'], repo);
  return { repo, baseSha: sh('git', ['rev-parse', 'HEAD'], repo) };
}

function stubLog() {
  const events = [];
  return { events, log: { append(event) { events.push(event); return event; } } };
}

const brief = () => ({
  goal: 'edit one selected sparse worker path',
  constraints: [], pathScope: ['src/**'], definitionOfDone: 'selected edit is captured',
  verification: { command: 'true', expectExit: 0 },
  budget: { tokens: 100, usd: 1, wallMin: 1 },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
};

test('SP1: createFromBase materializes only selected worker paths while preserving exact branch and base identity', async (t) => {
  const { repo, baseSha } = makeRepo('materialize');
  const sparsePaths = ['src', 'config/settings.json'];
  const handle = await createFromBase(repo, 'sparse-materialize', baseSha, { sparsePaths });
  t.after(async () => {
    await reap(repo, 'sparse-materialize', { force: true, deleteBranch: true });
    rmSync(repo, { recursive: true, force: true });
  });

  assert.equal(handle.dir, join(repo, '.baton', 'wt', 'sparse-materialize'));
  assert.equal(handle.branch, 'baton/sparse-materialize');
  assert.equal(handle.baseSha, baseSha);
  assert.deepEqual(handle.sparsePaths, normalizeSparsePaths(sparsePaths));
  assert.equal(sh('git', ['rev-parse', 'HEAD'], handle.dir), baseSha);
  assert.equal(sh('git', ['branch', '--show-current'], handle.dir), 'baton/sparse-materialize');
  assert.equal(readFileSync(join(handle.dir, 'src/main.js'), 'utf8'), 'export const value = 1;\n');
  assert.equal(readFileSync(join(handle.dir, 'config/settings.json'), 'utf8'), '{"enabled":true}\n');
  assert.equal(existsSync(join(handle.dir, 'README.md')), false);
  assert.equal(existsSync(join(handle.dir, 'docs/guide.md')), false);
  assert.equal(existsSync(join(handle.dir, 'fixtures/large.bin')), false);
});

test('SP2: captureCommit records a selected-path edit without deleting unmaterialized base paths', async (t) => {
  const { repo, baseSha } = makeRepo('capture');
  const handle = await createFromBase(repo, 'sparse-capture', baseSha, { sparsePaths: ['src'] });
  t.after(async () => {
    await reap(repo, 'sparse-capture', { force: true, deleteBranch: true });
    rmSync(repo, { recursive: true, force: true });
  });

  assert.equal(existsSync(join(handle.dir, 'docs/guide.md')), false);
  writeFileSync(join(handle.dir, 'src/main.js'), 'export const value = 2;\n');
  const captured = await captureCommit(repo, 'sparse-capture', { vendor: 'mock', model: 'fixture-model', effort: 'low' });

  assert.equal(captured.snapshotted, true);
  assert.equal(sh('git', ['diff', '--name-only', baseSha, captured.sha], repo), 'src/main.js');
  assert.equal(sh('git', ['show', `${captured.sha}:src/main.js`], repo), 'export const value = 2;');
  assert.equal(sh('git', ['show', `${captured.sha}:docs/guide.md`], repo), '# large unselected guide');
  assert.equal(sh('git', ['show', `${captured.sha}:fixtures/large.bin`], repo), 'unselected fixture');
});

const invalidSparsePaths = [
  { label: 'empty', value: '' },
  { label: 'absolute', value: '/src' },
  { label: 'parent', value: '../src' },
  { label: 'embedded-parent', value: 'src/../docs' },
  { label: 'empty-segment', value: 'src//main.js' },
  { label: 'wildcard', value: 'src/*' },
];

for (const invalid of invalidSparsePaths) {
  test(`SP3: ${invalid.label} worker sparse path refuses before creating worktree, branch, directory, or metadata`, async (t) => {
    const { repo, baseSha } = makeRepo(`invalid-${invalid.label}`);
    const taskId = `sparse-invalid-${invalid.label}`;
    let created = null;
    t.after(async () => {
      if (created || existsSync(join(repo, '.baton', 'wt', taskId))) {
        await reap(repo, taskId, { force: true, deleteBranch: true });
      }
      rmSync(repo, { recursive: true, force: true });
    });
    const before = await listWorktrees(repo);

    await assert.rejects(async () => {
      created = await createFromBase(repo, taskId, baseSha, { sparsePaths: [invalid.value] });
    }, TypeError);

    assert.deepEqual(await listWorktrees(repo), before);
    assert.equal(existsSync(join(repo, '.baton', 'wt', taskId)), false);
    assert.equal(existsSync(join(repo, '.baton', 'wt', `${taskId}.meta.json`)), false);
    assert.equal(sh('git', ['branch', '--list', `baton/${taskId}`], repo), '');
  });
}

const invalidDriverSparsePolicies = [
  { label: 'duplicate', value: ['src', 'src'] },
  { label: 'reserved-git-root', value: ['.git/objects'] },
  { label: 'reserved-baton-root', value: ['.baton/wt'] },
  { label: 'overlong', value: ['a'.repeat(2_049)] },
  { label: 'max-plus-one', value: Array.from({ length: 1_025 }, (_, index) => `src/p${index}`) },
];

for (const invalid of invalidDriverSparsePolicies) {
  test(`SP3: ${invalid.label} deployment worker policy refuses before driver filesystem authority`, (t) => {
    const { repo } = makeRepo(`driver-invalid-${invalid.label}`);
    const logDir = join(repo, 'never-created-log');
    t.after(() => rmSync(repo, { recursive: true, force: true }));

    assert.throws(() => createDriver({
      repoRoot: repo,
      logDir,
      adapters: {},
      workerSparsePaths: invalid.value,
    }), TypeError);

    assert.equal(existsSync(logDir), false);
    assert.equal(existsSync(join(repo, '.baton')), false);
  });
}

test('SP4: createDriver forwards workerSparsePaths independently from verifySparsePaths', async (t) => {
  const { repo, baseSha } = makeRepo('driver-forwarding');
  const logDir = mkdtempSync(join(tmpdir(), 'baton-pg58-forwarding-log-'));
  const driver = createDriver({
    repoRoot: repo,
    logDir,
    adapters: {},
    workerSparsePaths: ['src'],
    verifySparsePaths: ['docs/guide.md'],
  });
  let worker = null;
  let verifier = null;
  t.after(async () => {
    if (verifier?.path && existsSync(verifier.path)) await driver.coordinator._worktrees.removeVerifyWorktree(verifier.path);
    if (worker?.path && existsSync(worker.path)) await driver.coordinator._worktrees.remove('driver-sparse');
    try { driver.close(); } catch { /* assertion failure may leave cleanup to the evidence root */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  worker = await driver.coordinator._worktrees.create('driver-sparse', baseSha);
  verifier = await driver.coordinator._worktrees.createVerifyWorktree('driver-sparse', baseSha);

  assert.equal(existsSync(join(worker.path, 'src/main.js')), true);
  assert.equal(existsSync(join(worker.path, 'docs/guide.md')), false);
  assert.equal(existsSync(join(worker.path, 'README.md')), false);
  assert.deepEqual(worker.sparsePaths, ['src']);
  assert.equal(existsSync(join(verifier.path, 'docs/guide.md')), true);
  assert.equal(existsSync(join(verifier.path, 'src/main.js')), false);
  assert.equal(existsSync(join(verifier.path, 'README.md')), false);
});

test('SP5: sparse worker identity is durable in handle, event, metadata, and exact cleanup', async (t) => {
  const { repo, baseSha } = makeRepo('metadata-cleanup');
  const { events, log } = stubLog();
  const taskId = 'sparse-metadata';
  let reaped = false;
  t.after(async () => {
    if (!reaped) await reap(repo, taskId, { force: true, deleteBranch: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const handle = await createFromBase(repo, taskId, baseSha, { sparsePaths: ['src'], log });
  const metaPath = join(repo, '.baton', 'wt', `${taskId}.meta.json`);
  const metadata = JSON.parse(readFileSync(metaPath, 'utf8'));
  const created = events.find((event) => event.kind === 'worktree.created');
  assert.deepEqual(handle.sparsePaths, ['src']);
  assert.deepEqual(metadata.sparsePaths, ['src']);
  assert.deepEqual(created.payload.sparsePaths, ['src']);

  await markStopped(repo, taskId);
  await reap(repo, taskId, { deleteBranch: true, log });
  reaped = true;
  assert.equal(existsSync(handle.dir), false);
  assert.equal(existsSync(metaPath), false);
  assert.equal(sh('git', ['branch', '--list', `baton/${taskId}`], repo), '');
  assert.equal(events.filter((event) => event.kind === 'worktree.reaped').length, 1);
});

test('SP6: worktree.ready and replayed session context preserve the worker sparse projection', async (t) => {
  const { repo } = makeRepo('replay');
  const logDir = mkdtempSync(join(tmpdir(), 'baton-pg58-replay-log-'));
  const options = {
    repoRoot: repo,
    logDir,
    workerSparsePaths: ['src'],
    verifySparsePaths: ['src'],
  };
  const driver = createDriver({
    ...options,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/result.js', content: 'export const result = true;\n' }] } }) },
  });
  let driverClosed = false;
  let replay = null;
  t.after(async () => {
    if (!driverClosed) {
      try { await driver.closeAsync(); } catch { /* evidence-root cleanup remains */ }
    }
    if (replay) {
      try { replay.close(); } catch { /* evidence-root cleanup remains */ }
    }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'sparse-replay' });
  const result = await until(async () => {
    const value = await driver.coordinator.result(handle.id);
    return value.ready ? value : null;
  }, 'sparse worker completion');
  assert.equal(result.status, 'completed', JSON.stringify(result.verdict));
  const ready = driver.log.read(handle.id).find((event) => event.kind === 'worktree.ready');
  const liveSparsePaths = driver.coordinator.list()[0].sessionContext?.sparsePaths;

  await driver.coordinator.kill(handle.id, 'test');
  assert.equal(driver.close(), true);
  driverClosed = true;
  replay = createDriver({ ...options, adapters: {} });
  const restored = replay.coordinator.list().find((row) => row.taskId === handle.taskId);

  assert.deepEqual({
    ready: ready?.payload?.sparsePaths,
    live: liveSparsePaths,
    restored: restored?.sessionContext?.sparsePaths,
  }, {
    ready: ['src'],
    live: ['src'],
    restored: ['src'],
  });
});
