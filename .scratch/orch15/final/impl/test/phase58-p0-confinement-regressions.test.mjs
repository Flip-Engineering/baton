import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  captureCommit, createFromBase, reap, reconcile,
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
  const world = mkdtempSync(join(tmpdir(), `baton-phase58-p0-${label}-`));
  const repo = join(world, 'repo');
  mkdirSync(repo);
  git(['init', '-q'], repo);
  git(['config', 'user.name', 'Baton Phase 58 P0'], repo);
  git(['config', 'user.email', 'phase58-p0@example.invalid'], repo);
  write(repo, 'src/main.js', 'export const value = 1;\n');
  write(repo, 'private/retained.txt', 'must remain outside the sparse worker\n');
  git(['add', '-A'], repo);
  git(['commit', '-qm', 'phase58 P0 base'], repo);
  return { world, repo, baseSha: git(['rev-parse', 'HEAD'], repo) };
}

function metadataPath(repo, taskId) {
  return join(repo, '.baton', 'wt', `${taskId}.meta.json`);
}

function stageBlob(worktree, path, content) {
  const blob = git(['hash-object', '-w', '--stdin'], worktree, { input: content });
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], worktree);
}

test('SP13: capture binds private metadata baseSha to the coordinator-admitted base', async (t) => {
  const f = fixture('metadata-base-smuggling');
  const taskId = 'metadata-base-smuggling';
  const worker = await createFromBase(f.repo, taskId, f.baseSha, { sparsePaths: ['src'] });
  t.after(async () => {
    try { await reap(f.repo, taskId, { force: true, deleteBranch: true }); } catch { /* fixture teardown below is authoritative */ }
    rmSync(f.world, { recursive: true, force: true });
  });

  const injectedPath = 'private/injected-by-plumbing.txt';
  stageBlob(worker.dir, injectedPath, 'committed outside sparse authority\n');
  git(['commit', '-qm', 'commit hidden out-of-sparse payload'], worker.dir);
  const adversarialHead = git(['rev-parse', 'HEAD'], worker.dir);
  git(['update-index', '--skip-worktree', injectedPath], worker.dir);
  assert.equal(
    git(['diff', '--name-only', f.baseSha, adversarialHead], worker.dir).split('\n').includes(injectedPath),
    true,
    'the committed result must actually contain the hidden payload',
  );

  const metadata = JSON.parse(readFileSync(metadataPath(f.repo, taskId), 'utf8'));
  writeFileSync(metadataPath(f.repo, taskId), `${JSON.stringify({ ...metadata, baseSha: adversarialHead }, null, 2)}\n`);

  await assert.rejects(
    () => captureCommit(f.repo, taskId, {
      expectedWorktreePath: worker.dir,
      expectedBaseSha: f.baseSha,
      sparseCheckoutIdentity: worker.sparseCheckoutIdentity,
    }),
    (error) => error?.code === 'worker_sparse_metadata_invalid',
    'capture must refuse metadata whose base differs from the coordinator-admitted base',
  );
});

for (const authorityRoot of ['wt', 'verify']) {
  test(`SP14: reconcile refuses a symlinked .baton/${authorityRoot} root without deleting external children`, (t) => {
    const f = fixture(`symlink-${authorityRoot}`);
    t.after(() => rmSync(f.world, { recursive: true, force: true }));

    const externalRoot = join(f.world, `external-${authorityRoot}`);
    const victim = write(externalRoot, 'victim/preserve.txt', 'external data must survive Baton reconciliation\n');
    mkdirSync(join(f.repo, '.baton'), { recursive: true });
    symlinkSync(externalRoot, join(f.repo, '.baton', authorityRoot), 'dir');

    const report = reconcile(f.repo, []);

    assert.equal(existsSync(victim), true, `reconcile followed .baton/${authorityRoot} outside repository ownership`);
    assert.equal(
      report.errors.some((message) => message.includes(`${authorityRoot} root`) || message.includes(`${authorityRoot}-root`)),
      true,
      `reconcile must report the unconfined .baton/${authorityRoot} authority root`,
    );
  });
}
