import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  captureCommit, createFromBase, reap, UnknownWorktreeError,
} from '../src/worktree.mjs';

function git(args, cwd, opts = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...opts,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      ...(opts.env ?? {}),
    },
  }).trim();
}

function write(root, relativePath, content) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function fixture(label) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue52-${label}-`));
  const repo = join(world, 'repo');
  try {
    mkdirSync(repo);
    git(['init', '-q'], repo);
    Object.assign(process.env, { GIT_AUTHOR_NAME: 'Baton Issue 52', GIT_COMMITTER_NAME: 'Baton Issue 52' });
    Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue52@example.invalid', GIT_COMMITTER_EMAIL: 'issue52@example.invalid' });
    write(repo, 'README.md', '# issue 52 fixture\n');
    write(repo, 'src/main.js', 'export const value = 1;\n');
    write(repo, 'docs/guide.md', '# private guide\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'issue 52 base'], repo);
    return { world, repo, baseSha: git(['rev-parse', 'HEAD'], repo) };
  } catch (error) {
    rmSync(world, { recursive: true, force: true });
    throw error;
  }
}

async function cleanupWorker(repo, taskId) {
  try { await reap(repo, taskId, { force: true, deleteBranch: true }); } catch { /* fixture root is removed below */ }
}

test('issue 52 defect (1): worker capture refuses the repository main checkout as its workspace', async (t) => {
  const { world, repo, baseSha } = fixture('main-checkout');
  const taskId = 'main-checkout-refusal';
  const handle = await createFromBase(repo, taskId, baseSha);
  t.after(async () => { await cleanupWorker(repo, taskId); rmSync(world, { recursive: true, force: true }); });

  write(handle.dir, 'src/main.js', 'export const value = 2;\n');
  const before = git(['rev-parse', 'HEAD'], handle.dir);
  await assert.rejects(
    () => captureCommit(repo, taskId, { expectedWorktreePath: repo }),
    (error) => error instanceof UnknownWorktreeError && /main checkout/.test(error.message),
    'capture with the main checkout as the expected workspace must fail closed naming the main checkout',
  );
  assert.equal(git(['rev-parse', 'HEAD'], handle.dir), before, 'the refusal must not create a commit');
});

test('issue 52 defect (1): worker capture refuses an expected workspace outside .baton/wt/', async (t) => {
  const { world, repo, baseSha } = fixture('outside-wt');
  const taskId = 'outside-wt-refusal';
  const handle = await createFromBase(repo, taskId, baseSha);
  t.after(async () => { await cleanupWorker(repo, taskId); rmSync(world, { recursive: true, force: true }); });

  write(handle.dir, 'src/main.js', 'export const value = 2;\n');
  const wtRoot = join(repo, '.baton', 'wt');
  await assert.rejects(
    () => captureCommit(repo, taskId, { expectedWorktreePath: wtRoot }),
    (error) => error instanceof UnknownWorktreeError && /outside owned/.test(error.message),
    'capture with a non-worktree .baton path as the expected workspace must fail closed',
  );
});

test('issue 52 defect (2): capture stages only the declared scope and warns on out-of-scope residue', async (t) => {
  const { world, repo, baseSha } = fixture('scoped-staging');
  const taskId = 'scoped-staging';
  const handle = await createFromBase(repo, taskId, baseSha, { sparsePaths: ['src'] });
  t.after(async () => { await cleanupWorker(repo, taskId); rmSync(world, { recursive: true, force: true }); });

  write(handle.dir, 'src/main.js', 'export const value = 2;\n');
  write(handle.dir, 'docs/residue.md', '# unrelated residue from outside the lane scope\n');

  const result = await captureCommit(repo, taskId, { vendor: 'mock' });
  assert.equal(result.snapshotted, true);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'worker_capture_out_of_scope_residue');
  assert.ok(result.warnings[0].paths.includes('docs/residue.md'));

  const committed = git(['show', '--name-only', '--pretty=format:', 'HEAD'], handle.dir)
    .split('\n').map((line) => line.trim()).filter(Boolean);
  assert.ok(committed.includes('src/main.js'), 'the snapshot commits the in-scope edit');
  assert.ok(!committed.includes('docs/residue.md'), 'out-of-scope residue must not enter the worker-attributed snapshot');

  const status = git(['status', '--porcelain'], handle.dir);
  assert.match(status, /^\?\? docs\/residue\.md$/m, 'residue stays on disk unstaged, visible to the trust gate');
  assert.ok(result.changedPaths.includes('docs/residue.md'), 'the reported tree still names the residue for the scope gate');
});

test('issue 52 defect (2): residue alone snapshots nothing but still warns', async (t) => {
  const { world, repo, baseSha } = fixture('residue-only');
  const taskId = 'residue-only';
  const handle = await createFromBase(repo, taskId, baseSha, { sparsePaths: ['src'] });
  t.after(async () => { await cleanupWorker(repo, taskId); rmSync(world, { recursive: true, force: true }); });

  write(handle.dir, 'docs/residue.md', '# unrelated residue and nothing else\n');

  const result = await captureCommit(repo, taskId, { vendor: 'mock' });
  assert.equal(result.snapshotted, false, 'no in-scope change means no empty snapshot commit');
  assert.equal(result.sha, baseSha);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'worker_capture_out_of_scope_residue');
});
