import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { inspectToolchainProjection, prepareToolchainProjection } from '../src/toolchain-projection.mjs';
import { createFromBase, freshVerifySandbox } from '../src/worktree.mjs';

const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase58-adversarial-${label}-`));

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(base, relativePath, content) {
  const target = join(base, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function repoFixture(label) {
  const world = root(label);
  const repo = join(world, 'repo');
  mkdirSync(repo);
  git(['init', '-q'], repo);
  git(['config', 'user.name', 'Baton Phase 58 adversary'], repo);
  git(['config', 'user.email', 'phase58-adversary@example.invalid'], repo);
  write(repo, 'src/input.txt', 'source\n');
  git(['add', '-A'], repo);
  git(['commit', '-qm', 'fixture'], repo);
  return { world, repo, sha: git(['rev-parse', 'HEAD'], repo) };
}

function worktreePaths(repo) {
  const rows = git(['worktree', 'list', '--porcelain'], repo).split('\n');
  return rows.filter((row) => row.startsWith('worktree ')).map((row) => row.slice('worktree '.length));
}

function batonRefs(repo) {
  return git(['for-each-ref', '--format=%(refname)', 'refs/heads/baton/'], repo).split('\n').filter(Boolean);
}

function cleanupFixture(f) {
  if (!existsSync(f.repo)) return;
  for (const path of worktreePaths(f.repo).reverse()) {
    if (resolve(path) === resolve(f.repo)) continue;
    const within = relative(resolve(f.repo), resolve(path));
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) continue;
    try { git(['worktree', 'remove', '--force', path], f.repo); } catch { rmSync(path, { recursive: true, force: true }); }
  }
  try { git(['worktree', 'prune'], f.repo); } catch { /* best effort */ }
  for (const ref of batonRefs(f.repo)) {
    try { git(['update-ref', '-d', ref], f.repo); } catch { /* best effort */ }
  }
  rmSync(f.world, { recursive: true, force: true });
}

const limits = Object.freeze({
  maxMappings: 2,
  maxFiles: 16,
  maxDirectories: 16,
  maxBytes: 64 * 1024,
  maxFileBytes: 32 * 1024,
  maxPathBytes: 256,
  maxDepth: 8,
});

function trackedTargetFixture(label) {
  const f = repoFixture(label);
  const source = join(f.world, 'external-toolchain');
  mkdirSync(source);
  write(source, 'runtime/index.js', 'module.exports = "projected-external";\n');
  write(f.repo, 'tools/runtime/index.js', 'module.exports = "tracked-repository";\n');
  git(['add', '-A'], f.repo);
  git(['commit', '-qm', 'track projection collision'], f.repo);
  f.sha = git(['rev-parse', 'HEAD'], f.repo);
  const base = {
    schemaVersion: 1,
    sourceRoot: source,
    sourceId: 'phase58-adversarial-toolchain',
    mappings: [{ sourcePath: 'runtime', targetPath: 'tools/runtime' }],
    limits: { ...limits },
  };
  const authority = prepareToolchainProjection({
    ...base,
    expectedManifestDigest: inspectToolchainProjection(base).manifestDigest,
  });
  return { ...f, authority };
}

function identifierRefusal(error) {
  return error instanceof TypeError || error?.code === 'invalid_worktree_identifier';
}

test('AT1: a tracked projection target hidden by worker sparse checkout refuses before external bytes can substitute it', async (t) => {
  const f = trackedTargetFixture('tracked-worker');
  let created = null;
  let refusal = null;
  t.after(() => cleanupFixture(f));
  const beforeWorktrees = worktreePaths(f.repo);
  const beforeRefs = batonRefs(f.repo);

  try {
    created = await createFromBase(f.repo, 'tracked-hidden-worker', f.sha, {
      sparsePaths: ['src'],
      toolchainProjection: f.authority,
    });
  } catch (error) { refusal = error; }

  assert.ok(refusal, created
    ? `worker exposed sparse-hidden tracked target as: ${readFileSync(join(created.dir, 'tools/runtime/index.js'), 'utf8').trim()}`
    : 'worker did not return a typed tracked-target refusal');
  assert.equal(refusal.code, 'toolchain_projection_materialization_failed');

  assert.equal(created, null);
  assert.deepEqual(worktreePaths(f.repo), beforeWorktrees);
  assert.deepEqual(batonRefs(f.repo), beforeRefs);
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', 'tracked-hidden-worker')), false);
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', 'tracked-hidden-worker.projection.exclude')), false);
});

test('AT2: a tracked projection target hidden by verifier sparse checkout refuses and leaves no detached substitute', async (t) => {
  const f = trackedTargetFixture('tracked-verifier');
  let sandbox = null;
  let refusal = null;
  t.after(() => cleanupFixture(f));
  const beforeWorktrees = worktreePaths(f.repo);

  try {
    sandbox = await freshVerifySandbox(f.repo, 'tracked-hidden-verifier', f.sha, {
      sparsePaths: ['src'],
      toolchainProjection: f.authority,
    });
  } catch (error) { refusal = error; }

  assert.ok(refusal, sandbox
    ? `verifier exposed sparse-hidden tracked target as: ${readFileSync(join(sandbox.dir, 'tools/runtime/index.js'), 'utf8').trim()}`
    : 'verifier did not return a typed tracked-target refusal');
  assert.equal(refusal.code, 'toolchain_projection_materialization_failed');

  assert.equal(sandbox, null);
  assert.deepEqual(worktreePaths(f.repo), beforeWorktrees);
  assert.equal(!existsSync(join(f.repo, '.baton', 'verify')), true);
});

const unsafeWorkerIds = [
  { case: 'slash', value: 'nested/task' },
  { case: 'backslash', value: 'nested\\task' },
  { case: 'dot-segment', value: 'nested/../task' },
  { case: 'control', value: 'task\nnext' },
  { case: 'metadata-suffix', value: 'task.meta.json' },
  { case: 'projection-suffix', value: 'task.projection.exclude' },
  { case: 'git-lock-suffix', value: 'task.lock' },
];

for (const invalid of unsafeWorkerIds) {
  test(`AT3: worker taskId ${invalid.case} form refuses before path or ref authority`, async (t) => {
    const f = repoFixture(`worker-id-${invalid.case}`);
    let created = null;
    t.after(() => cleanupFixture(f));
    const beforeWorktrees = worktreePaths(f.repo);
    const beforeRefs = batonRefs(f.repo);

    await assert.rejects(async () => {
      created = await createFromBase(f.repo, invalid.value, f.sha);
    }, identifierRefusal);

    assert.equal(created, null);
    assert.deepEqual(worktreePaths(f.repo), beforeWorktrees);
    assert.deepEqual(batonRefs(f.repo), beforeRefs);
    assert.equal(existsSync(join(f.repo, '.baton')), false);
  });
}

const unsafeVerifierLabels = [
  { case: 'slash', value: 'nested/label' },
  { case: 'backslash', value: 'nested\\label' },
  { case: 'dot-segment', value: '../escape' },
  { case: 'control', value: 'label\u0001next' },
  { case: 'metadata-suffix', value: 'label.meta.json' },
  { case: 'projection-suffix', value: 'label.projection.exclude' },
  { case: 'git-lock-suffix', value: 'label.lock' },
];

for (const invalid of unsafeVerifierLabels) {
  test(`AT4: verifier label ${invalid.case} form refuses before path authority`, async (t) => {
    const f = repoFixture(`verify-label-${invalid.case}`);
    let sandbox = null;
    t.after(() => cleanupFixture(f));
    const beforeWorktrees = worktreePaths(f.repo);
    const beforeRefs = batonRefs(f.repo);

    await assert.rejects(async () => {
      sandbox = await freshVerifySandbox(f.repo, invalid.value, f.sha);
    }, identifierRefusal);

    assert.equal(sandbox, null);
    assert.deepEqual(worktreePaths(f.repo), beforeWorktrees);
    assert.deepEqual(batonRefs(f.repo), beforeRefs);
    assert.equal(existsSync(join(f.repo, '.baton')), false);
  });
}
