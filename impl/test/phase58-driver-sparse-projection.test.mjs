import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createBrief, createDriver, inspectToolchainProjection, MockAdapter,
} from '../src/index.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase58-${label}-`));

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();
}

function write(base, relativePath, content) {
  const target = join(base, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function fixture() {
  const world = root('world');
  const repo = join(world, 'repo');
  const toolchain = join(world, 'toolchain');
  mkdirSync(repo); mkdirSync(toolchain);
  git(['init', '-q'], repo);
  git(['config', 'user.name', 'Baton Phase 58'], repo);
  git(['config', 'user.email', 'phase58@example.invalid'], repo);
  write(repo, 'src/input.txt', 'source-value\n');
  write(repo, 'report/.gitkeep', '');
  write(repo, 'secret/hidden.txt', 'must not enter sparse worker or verifier\n');
  write(repo, 'README.md', '# intentionally outside sparse checkout\n');
  git(['add', '-A'], repo);
  git(['commit', '-qm', 'phase58 fixture'], repo);

  write(toolchain, 'package/package.json', '{"name":"phase58-fixture","main":"index.js"}\n');
  write(toolchain, 'package/index.js', 'module.exports = (value) => `processed:${value}`;\n');
  return { world, repo, toolchain, logDir: join(world, 'log') };
}

const projectionLimits = Object.freeze({
  maxMappings: 2,
  maxFiles: 16,
  maxDirectories: 16,
  maxBytes: 64 * 1024,
  maxFileBytes: 32 * 1024,
  maxPathBytes: 256,
  maxDepth: 8,
});

function projectionConfig(sourceRoot) {
  const base = {
    schemaVersion: 1,
    sourceRoot,
    sourceId: 'phase58-node-toolchain',
    mappings: [{ sourcePath: 'package', targetPath: 'node_modules/phase58-fixture' }],
    limits: { ...projectionLimits },
  };
  const identity = inspectToolchainProjection(base);
  return { config: { ...base, expectedManifestDigest: identity.manifestDigest }, identity };
}

async function until(fn, label, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function visibleRoot(path) {
  return readdirSync(path).filter((entry) => entry !== '.git').sort();
}

function assertSparseProjectionView(path) {
  assert.deepEqual(visibleRoot(path), ['node_modules', 'report', 'src']);
  assert.equal(readFileSync(join(path, 'src/input.txt'), 'utf8'), 'source-value\n');
  assert.equal(existsSync(join(path, 'report', '.gitkeep')), true);
  assert.equal(existsSync(join(path, 'node_modules', 'phase58-fixture', 'index.js')), true);
  assert.equal(existsSync(join(path, 'secret', 'hidden.txt')), false);
  assert.equal(existsSync(join(path, 'README.md')), false);
  assert.deepEqual(
    git(['sparse-checkout', 'list'], path).split('\n').filter(Boolean).map((entry) => entry.replace(/^\//, '')).sort(),
    ['report', 'src'],
  );
}

test('Phase 58: createDriver composes worker/verify sparse views with projected node_modules and drain reaps every owned residue', async (t) => {
  const f = fixture();
  const { config, identity } = projectionConfig(f.toolchain);
  let driver;
  t.after(async () => {
    try { await driver?.drainAndClose(); } catch { try { driver?.coordination.releaseWriterLease(); } catch {} }
    rmSync(f.world, { recursive: true, force: true });
  });

  const adapter = new MockAdapter({ scenario: {
    outcome: 'completed',
    ask: { kind: 'question', question: 'worker sparse view ready?', blocking: true, afterEditIndex: 0 },
    edits: [{ path: 'report/result.txt', content: 'processed:source-value\n' }],
  } });
  driver = createDriver({
    repoRoot: f.repo,
    repoId: 'repo-phase58',
    logDir: f.logDir,
    adapters: { mock: adapter },
    workerSparsePaths: ['src', 'report'],
    verifySparsePaths: ['src', 'report'],
    toolchainProjection: config,
    drainPolicy: { maxWorkers: 4, timeoutMs: 5_000, pollMs: 5 },
    watchdog: { stallMs: 0 },
  });

  const verificationScript = [
    "const fs = require('fs')",
    "const transform = require('./node_modules/phase58-fixture')",
    "const source = fs.readFileSync('src/input.txt', 'utf8').trim()",
    "const report = fs.readFileSync('report/result.txt', 'utf8').trim()",
    'if (report !== transform(source)) process.exit(9)',
  ].join(';');
  const taskBrief = createBrief({
    goal: 'read the allowed source and write the report',
    constraints: ['do not edit source inputs'],
    pathScope: ['report/result.txt'],
    definitionOfDone: 'the projected tool validates the report from the sparse source',
    verification: { command: `${process.execPath} -e "${verificationScript}"`, expectExit: 0, timeoutMs: 5_000 },
    budget: { tokens: 10_000, usd: 1, wallMin: 2 },
  });

  const handle = await driver.coordinator.spawn('mock', taskBrief, { taskId: 'phase58-sparse-driver' });
  const requestId = await until(() => driver.coordinator.list().find((row) => row.id === handle.id)?.pendingQuestionId, 'blocked worker inspection point');
  const worker = driver.coordinator.list().find((row) => row.id === handle.id);
  const workerPath = worker.sessionContext.worktree;
  const runtimePath = join(f.repo, '.baton', 'runtime', handle.id);

  assert.deepEqual(worker.sessionContext.toolchainProjection, identity);
  assertSparseProjectionView(workerPath);
  assert.equal(existsSync(runtimePath), true);
  assert.equal(git(['status', '--porcelain', '--untracked-files=all'], workerPath), '');

  await driver.coordinator.respond(requestId, { text: 'continue' });
  const result = await until(async () => {
    const current = await driver.coordinator.result(handle.id);
    return ['completed', 'failed'].includes(current.status) ? current : null;
  }, 'captured and verified sparse result');
  assert.equal(result.status, 'completed', JSON.stringify(result.verdict));

  const events = driver.log.read(handle.id);
  const ready = events.find((event) => event.kind === 'worktree.ready');
  const verified = events.find((event) => event.kind === 'verify.reverified');
  assert.deepEqual(ready.payload.toolchainProjection, identity);
  assert.equal(verified.payload.accept, true);
  assert.deepEqual(verified.payload.capture.toolchainProjection, identity);
  assert.deepEqual(verified.payload.capture.verifierToolchainProjection, identity);
  assert.deepEqual(
    git(['diff-tree', '--no-commit-id', '--name-only', '-r', verified.payload.capture.sha], f.repo).split('\n').filter(Boolean),
    ['report/result.txt'],
  );
  assert.equal(git(['ls-tree', '-r', '--name-only', verified.payload.capture.sha], f.repo).includes('node_modules/'), false);

  // Leave a real detached verifier behind deliberately; drain reconciliation, rather than this
  // test, must own its exact removal alongside the accepted worker/runtime state.
  const staleVerify = await driver.coordinator._worktrees.createVerifyWorktree('phase58-drain-residue', verified.payload.capture.sha);
  assertSparseProjectionView(staleVerify.path);
  execFileSync(process.execPath, ['-e', verificationScript], { cwd: staleVerify.path, stdio: 'pipe' });
  assert.equal(existsSync(staleVerify.path), true);
  assert.equal(
    git(['branch', '--list', worker.sessionContext.branch, '--format=%(refname:short)'], f.repo),
    worker.sessionContext.branch,
  );

  const receipt = await driver.drainAndClose('phase58:test');
  assert.equal(receipt.state, 'closed');
  assert.equal(receipt.fleet.checks.cleanupDrained, true);
  assert.equal(existsSync(workerPath), false);
  assert.equal(existsSync(staleVerify.path), false);
  assert.equal(existsSync(runtimePath), false);
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', `${worker.sessionContext.ownerTaskId}.meta.json`)), false);
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', `${worker.sessionContext.ownerTaskId}.projection.exclude`)), false);
  assert.equal(git(['branch', '--list', worker.sessionContext.branch, '--format=%(refname:short)'], f.repo), '');
  assert.equal(git(['worktree', 'list', '--porcelain'], f.repo).includes(join(f.repo, '.baton')), false);
  assert.equal(!existsSync(join(f.repo, '.baton', 'verify')) || readdirSync(join(f.repo, '.baton', 'verify')).length === 0, true);
  assert.equal(!existsSync(join(f.repo, '.baton', 'runtime')) || readdirSync(join(f.repo, '.baton', 'runtime')).length === 0, true);
  assert.equal(existsSync(join(f.logDir, 'coordination', 'writer.lease')), false);
});
