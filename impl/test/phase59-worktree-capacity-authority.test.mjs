import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import {
  createBrief, createDriver, inspectToolchainProjection, loadOrCreateWorktreeCapacityIntegrityKey,
  MockAdapter, WorktreeCapacityAuthority,
} from '../src/index.mjs';
import {
  physicalWorkspaceOwnerReceipt, reconcile as reconcileWorktrees, sparseCheckoutIdentity,
} from '../src/worktree.mjs';

const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase59-${label}-`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function canonicalMissingLeaf(path) {
  let cursor = resolve(path); const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return resolve(path);
    suffix.unshift(basename(cursor)); cursor = parent;
  }
  return join(realpathSync(cursor), ...suffix);
}

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

function fixture(label, { projection = false } = {}) {
  const world = root(label);
  const repo = join(world, 'repo');
  const logDir = join(world, 'log');
  mkdirSync(repo);
  git(['init', '-q'], repo);
  git(['config', 'user.name', 'Baton Phase 59'], repo);
  git(['config', 'user.email', 'phase59@example.invalid'], repo);
  write(repo, 'src/selected.txt', 'selected-tree-bytes\n');
  write(repo, 'src/other.txt', 'other-tree-bytes\n');
  write(repo, 'docs/hidden.txt', 'hidden-tree-bytes\n');
  git(['add', '-A'], repo);
  git(['commit', '-qm', 'phase59 fixture'], repo);
  const f = { world, repo, logDir, sha: git(['rev-parse', 'HEAD'], repo) };
  if (projection) {
    const sourceRoot = join(world, 'toolchain');
    mkdirSync(sourceRoot);
    write(sourceRoot, 'runtime/index.js', 'module.exports = 59;\n');
    const base = {
      schemaVersion: 1,
      sourceRoot,
      sourceId: 'phase59-toolchain',
      mappings: [{ sourcePath: 'runtime', targetPath: 'node_modules/phase59-runtime' }],
      limits: {
        maxMappings: 2, maxFiles: 16, maxDirectories: 16, maxBytes: 64 * 1024,
        maxFileBytes: 32 * 1024, maxPathBytes: 256, maxDepth: 8,
      },
    };
    f.projectionIdentity = inspectToolchainProjection(base);
    f.toolchainProjection = { ...base, expectedManifestDigest: f.projectionIdentity.manifestDigest };
  }
  return f;
}

const validPolicy = Object.freeze({
  maxReservedBytes: 1_000,
  maxReservedInodes: 100,
  minFreeBytes: 100,
  minFreeInodes: 10,
  runtimeReserveBytes: 20,
  runtimeReserveInodes: 2,
});

const brief = () => createBrief({
  goal: 'hold one capacity-governed sparse worker',
  constraints: [],
  pathScope: ['src/**'],
  definitionOfDone: 'capacity is reserved before work starts',
  verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
  budget: { tokens: 1_000, usd: 1, wallMin: 1 },
});

async function until(fn, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(5);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function dispose(driver, f) {
  if (driver) {
    try { await driver.drainAndClose('phase59:test'); }
    catch { try { driver.coordination.releaseWriterLease(); } catch { /* best effort */ } }
  }
  rmSync(f.world, { recursive: true, force: true });
}

function countedBlockingAdapter() {
  const adapter = new MockAdapter({ scenario: {
    outcome: 'completed',
    ask: { kind: 'question', question: 'hold capacity?', blocking: true, afterEditIndex: 0 },
    edits: [],
  } });
  let calls = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = async (...args) => { calls += 1; return spawn(...args); };
  return { adapter, spawnCalls: () => calls };
}

function injectedCapacity({ treeBytes = 40, treeInodes = 3, freeBytes = 10_000, freeInodes = 1_000 } = {}) {
  const estimates = [];
  const observations = [];
  return {
    estimates,
    observations,
    worktreeCapacityEstimate(request) {
      estimates.push(request);
      return {
        bytes: treeBytes + request.policy.runtimeReserveBytes + (request.toolchainProjection?.byteCount ?? 0),
        inodes: treeInodes + request.policy.runtimeReserveInodes
          + (request.toolchainProjection?.fileCount ?? 0) + (request.toolchainProjection?.directoryCount ?? 0),
      };
    },
    worktreeCapacityObserve(request) {
      observations.push(request);
      return { freeBytes, freeInodes };
    },
  };
}

const invalidPolicies = [
  { label: 'null', value: null },
  { label: 'missing-field', value: (({ runtimeReserveInodes: _drop, ...rest }) => rest)(validPolicy) },
  { label: 'unknown-field', value: { ...validPolicy, unknown: 1 } },
  { label: 'zero-max-bytes', value: { ...validPolicy, maxReservedBytes: 0 } },
  { label: 'zero-max-inodes', value: { ...validPolicy, maxReservedInodes: 0 } },
  { label: 'negative-min-free-bytes', value: { ...validPolicy, minFreeBytes: -1 } },
  { label: 'negative-min-free-inodes', value: { ...validPolicy, minFreeInodes: -1 } },
  { label: 'negative-runtime-bytes', value: { ...validPolicy, runtimeReserveBytes: -1 } },
  { label: 'runtime-inodes-above-max', value: { ...validPolicy, runtimeReserveInodes: validPolicy.maxReservedInodes + 1 } },
  { label: 'unsafe-integer', value: { ...validPolicy, maxReservedBytes: Number.MAX_SAFE_INTEGER + 1 } },
];

for (const invalid of invalidPolicies) {
  test(`WC1: ${invalid.label} worktreeCapacity policy refuses before driver filesystem authority`, async (t) => {
    const f = fixture(`invalid-${invalid.label}`);
    let driver = null;
    t.after(() => dispose(driver, f));

    assert.throws(() => {
      driver = createDriver({
        repoRoot: f.repo,
        logDir: f.logDir,
        adapters: {},
        worktreeCapacity: invalid.value,
      });
    }, TypeError);

    assert.equal(driver, null);
    assert.equal(existsSync(f.logDir), false);
    assert.equal(existsSync(join(f.repo, '.baton')), false);
  });
}

test('WC2: default pinned sparse tree estimate composes projection identity and runtime reserve into one bounded reservation', async (t) => {
  const f = fixture('estimate', { projection: true });
  const { adapter } = countedBlockingAdapter();
  const injected = injectedCapacity();
  const treeBytes = Buffer.byteLength('selected-tree-bytes\n');
  const treeInodes = 2;
  const projectionInodes = f.projectionIdentity.fileCount + f.projectionIdentity.directoryCount;
  const totalBytes = treeBytes + f.projectionIdentity.byteCount + validPolicy.runtimeReserveBytes;
  const totalInodes = treeInodes + projectionInodes + validPolicy.runtimeReserveInodes;
  const policy = { ...validPolicy, maxReservedBytes: totalBytes, maxReservedInodes: totalInodes };
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo,
    logDir: f.logDir,
    adapters: { mock: adapter },
    workerSparsePaths: ['src/selected.txt'],
    toolchainProjection: f.toolchainProjection,
    worktreeCapacity: policy,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });

  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-estimate' });
  await until(() => driver.coordinator.list().find((row) => row.id === handle.id)?.pendingQuestionId, 'capacity-estimate worker');
  assert.equal(injected.observations.length, 1);

  const snapshot = driver.worktreeCapacity.snapshot();
  const owner = driver.coordinator.list().find((row) => row.id === handle.id).sessionContext.ownerTaskId;
  assert.equal(snapshot.totals.bytes, totalBytes);
  assert.equal(snapshot.totals.inodes, totalInodes);
  assert.deepEqual(snapshot.outstanding, {
    bytes: policy.runtimeReserveBytes,
    inodes: policy.runtimeReserveInodes,
  });
  assert.equal(snapshot.reservations.length, 1);
  assert.equal(typeof snapshot.reservations[0].materializedAt, 'string');
  assert.equal(snapshot.reservations[0].outstandingBytes, policy.runtimeReserveBytes);
  assert.equal(snapshot.reservations[0].outstandingInodes, policy.runtimeReserveInodes);
  assert.deepEqual(
    {
      id: snapshot.reservations[0].id,
      baseSha: snapshot.reservations[0].baseSha,
      sparseDigest: snapshot.reservations[0].sparseDigest,
      toolchainProjectionDigest: snapshot.reservations[0].toolchainProjectionDigest,
      bytes: snapshot.reservations[0].bytes,
      inodes: snapshot.reservations[0].inodes,
    },
    {
      id: `worker:${owner}`,
      baseSha: f.sha,
      sparseDigest: sparseCheckoutIdentity(['src/selected.txt']).digest,
      toolchainProjectionDigest: f.projectionIdentity.projectionDigest,
      bytes: totalBytes,
      inodes: totalInodes,
    },
  );
  assert.equal(JSON.stringify(snapshot).includes(f.world), false);
  assert.ok(snapshot.reservations.length <= 1);
});

test('WC3: projection target-parent inode max+1 refuses before checkout, materialization, or provider effects', async (t) => {
  const f = fixture('projection-parent-max-plus-one', { projection: true });
  const { adapter, spawnCalls } = countedBlockingAdapter();
  const injected = injectedCapacity();
  const treeBytes = Buffer.byteLength('selected-tree-bytes\n');
  const treeInodes = 2;
  const projectionInodes = f.projectionIdentity.fileCount + f.projectionIdentity.directoryCount;
  const totalBytes = treeBytes + f.projectionIdentity.byteCount + validPolicy.runtimeReserveBytes;
  const totalInodes = treeInodes + projectionInodes + validPolicy.runtimeReserveInodes;
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo,
    logDir: f.logDir,
    adapters: { mock: adapter },
    workerSparsePaths: ['src/selected.txt'],
    toolchainProjection: f.toolchainProjection,
    worktreeCapacity: { ...validPolicy, maxReservedBytes: totalBytes, maxReservedInodes: totalInodes - 1 },
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });

  await assert.rejects(
    driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-projection-parent-max-plus-one' }),
    (error) => error?.code === 'worktree_capacity_exceeded',
  );
  assert.equal(spawnCalls(), 0);
  assert.equal(driver.coordinator.list().length, 0);
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', 'capacity-projection-parent-max-plus-one')), false);
  assert.equal(existsSync(join(f.repo, '.baton', 'runtime')), false);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
});

test('WC2: shared projection target parents are unique and sparse-provided parents are not double-counted', async (t) => {
  const f = fixture('projection-parent-union');
  write(f.repo, 'vendor/keep.txt', 'tracked sparse parent\n');
  git(['add', '-A'], f.repo);
  git(['commit', '-qm', 'add sparse projection parent'], f.repo);
  f.sha = git(['rev-parse', 'HEAD'], f.repo);
  const sourceRoot = join(f.world, 'shared-toolchain');
  write(sourceRoot, 'source-a/index.js', 'module.exports = "a";\n');
  write(sourceRoot, 'source-b/index.js', 'module.exports = "b";\n');
  const descriptor = {
    schemaVersion: 1,
    sourceRoot,
    sourceId: 'phase59-shared-parent-toolchain',
    mappings: [
      { sourcePath: 'source-a', targetPath: 'vendor/shared/a' },
      { sourcePath: 'source-b', targetPath: 'vendor/shared/b' },
    ],
    limits: {
      maxMappings: 4, maxFiles: 16, maxDirectories: 16, maxBytes: 64 * 1024,
      maxFileBytes: 32 * 1024, maxPathBytes: 256, maxDepth: 8,
    },
  };
  const identity = inspectToolchainProjection(descriptor);
  const toolchainProjection = { ...descriptor, expectedManifestDigest: identity.manifestDigest };
  const { adapter } = countedBlockingAdapter();
  const injected = injectedCapacity();
  const exactInodes = 9;
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo,
    logDir: f.logDir,
    adapters: { mock: adapter },
    workerSparsePaths: ['vendor/keep.txt'],
    toolchainProjection,
    worktreeCapacity: { ...validPolicy, maxReservedInodes: exactInodes },
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });

  assert.equal(identity.directoryCount, 4, 'two source roots plus unique vendor and vendor/shared parents');
  assert.equal(identity.targetParentDirectoryCount, 2);
  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-projection-parent-union' });
  await until(() => driver.coordinator.list().find((row) => row.id === handle.id)?.pendingQuestionId, 'shared projection parent boundary');
  assert.equal(driver.worktreeCapacity.snapshot().totals.inodes, exactInodes);
});

test('WC2: projection target-parent paths must match their attested identity digest', (t) => {
  const f = fixture('projection-parent-digest', { projection: true });
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const authority = new WorktreeCapacityAuthority({
    repoRoot: f.repo,
    policy: validPolicy,
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(f.repo),
    observe: () => ({ freeBytes: 10_000, freeInodes: 1_000 }),
  });

  assert.throws(
    () => authority.reserve('worker:capacity-projection-parent-digest', {
      baseSha: f.sha,
      sparsePaths: ['src/selected.txt'],
      sparseCheckoutIdentity: sparseCheckoutIdentity(['src/selected.txt']),
      toolchainProjection: f.projectionIdentity,
      toolchainProjectionTargetParents: ['src'],
    }),
    (error) => error?.code === 'worktree_capacity_unavailable',
  );
  assert.deepEqual(authority.snapshot().reservations, []);
});

test('WC3: byte max+1 refuses typed before worktree, runtime, task, or provider effect', async (t) => {
  const f = fixture('max-plus-one');
  const { adapter, spawnCalls } = countedBlockingAdapter();
  const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 });
  const totalBytes = 40 + validPolicy.runtimeReserveBytes;
  const totalInodes = 3 + validPolicy.runtimeReserveInodes;
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo,
    logDir: f.logDir,
    adapters: { mock: adapter },
    worktreeCapacity: { ...validPolicy, maxReservedBytes: totalBytes - 1, maxReservedInodes: totalInodes },
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });

  await assert.rejects(
    driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-max-plus-one' }),
    (error) => error?.code === 'worktree_capacity_exceeded',
  );
  assert.equal(spawnCalls(), 0);
  assert.equal(driver.coordinator.list().length, 0);
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', 'capacity-max-plus-one')), false);
  assert.equal(existsSync(join(f.repo, '.baton', 'runtime')), false);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
});

test('WC3: inode max+1 refuses typed before worktree, runtime, task, or provider effect', async (t) => {
  const f = fixture('inode-max-plus-one');
  const { adapter, spawnCalls } = countedBlockingAdapter();
  const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 });
  const totalBytes = 40 + validPolicy.runtimeReserveBytes;
  const totalInodes = 3 + validPolicy.runtimeReserveInodes;
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo,
    logDir: f.logDir,
    adapters: { mock: adapter },
    worktreeCapacity: { ...validPolicy, maxReservedBytes: totalBytes, maxReservedInodes: totalInodes - 1 },
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });

  await assert.rejects(
    driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-inode-max-plus-one' }),
    (error) => error?.code === 'worktree_capacity_exceeded',
  );
  assert.equal(spawnCalls(), 0);
  assert.equal(driver.coordinator.list().length, 0);
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', 'capacity-inode-max-plus-one')), false);
  assert.equal(existsSync(join(f.repo, '.baton', 'runtime')), false);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
});

test('WC4: concurrent admission atomically reserves one worker and refuses the competing estimate before effects', async (t) => {
  const f = fixture('concurrent');
  const { adapter, spawnCalls } = countedBlockingAdapter();
  const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 });
  const totalBytes = 40 + validPolicy.runtimeReserveBytes;
  const totalInodes = 3 + validPolicy.runtimeReserveInodes;
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo,
    logDir: f.logDir,
    adapters: { mock: adapter },
    worktreeCapacity: { ...validPolicy, maxReservedBytes: totalBytes, maxReservedInodes: totalInodes },
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });

  const outcomes = await Promise.allSettled([
    driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-race-a' }),
    driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-race-b' }),
  ]);
  assert.equal(outcomes.filter((row) => row.status === 'fulfilled').length, 1);
  const refusal = outcomes.find((row) => row.status === 'rejected');
  assert.equal(refusal?.reason?.code, 'worktree_capacity_exceeded');
  const accepted = outcomes.find((row) => row.status === 'fulfilled').value;
  await until(() => driver.coordinator.list().find((row) => row.id === accepted.id)?.pendingQuestionId, 'one capacity race winner');
  assert.equal(spawnCalls(), 1);
  assert.equal(injected.estimates.length, 2);
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);
  assert.equal(
    !existsSync(join(f.repo, '.baton', 'wt'))
      ? 0
      : readdirSync(join(f.repo, '.baton', 'wt')).filter((entry) => !entry.endsWith('.json') && !entry.endsWith('.exclude')).length,
    1,
  );

  const receipt = await driver.drainAndClose('phase59:concurrent');
  assert.equal(receipt.capacity.ownedReservations, 0);
  assert.equal(driver.worktreeCapacity.snapshot().totals.bytes, 0);
  assert.equal(driver.worktreeCapacity.snapshot().totals.inodes, 0);
  driver = null;
});

test('WC4a: aggregate reservation admits or refuses the whole wave with one observation and one state transition', (t) => {
  const f = fixture('aggregate-wave');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 });
  const request = {
    baseSha: f.sha,
    sparsePaths: [],
    sparseCheckoutIdentity: sparseCheckoutIdentity([]),
    toolchainProjection: null,
    toolchainProjectionTargetParents: [],
  };
  const authority = new WorktreeCapacityAuthority({
    repoRoot: f.repo,
    policy: { ...validPolicy, maxReservedBytes: 119, maxReservedInodes: 10 },
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(f.repo),
    estimate: injected.worktreeCapacityEstimate,
    observe: injected.worktreeCapacityObserve,
  });

  assert.throws(() => authority.reserveMany([
    { id: 'worker:aggregate-a', request },
    { id: 'worker:aggregate-b', request },
  ]), (error) => error?.code === 'worktree_capacity_exceeded');
  assert.equal(injected.estimates.length, 2);
  assert.equal(injected.observations.length, 1);
  assert.deepEqual(authority.snapshot().reservations, []);
});

test('WC4b: aggregate reservation and release publish one exact all-member state each', (t) => {
  const f = fixture('aggregate-release');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 });
  const request = {
    baseSha: f.sha,
    sparsePaths: [],
    sparseCheckoutIdentity: sparseCheckoutIdentity([]),
    toolchainProjection: null,
    toolchainProjectionTargetParents: [],
  };
  const authority = new WorktreeCapacityAuthority({
    repoRoot: f.repo,
    policy: { ...validPolicy, maxReservedBytes: 120, maxReservedInodes: 10 },
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(f.repo),
    estimate: injected.worktreeCapacityEstimate,
    observe: injected.worktreeCapacityObserve,
  });

  const reservations = authority.reserveMany([
    { id: 'worker:aggregate-release-a', request },
    { id: 'worker:aggregate-release-b', request },
  ]);
  assert.equal(reservations.length, 2);
  assert.equal(new Set(reservations.map(({ createdAt }) => createdAt)).size, 1);
  assert.deepEqual(authority.snapshot().reservations.map(({ id }) => id), [
    'worker:aggregate-release-a', 'worker:aggregate-release-b',
  ]);
  assert.deepEqual(authority.releaseMany(reservations), [true, true]);
  assert.deepEqual(authority.snapshot().reservations, []);
});

test('WC5: kill/reap releases exactly, capacity can be reused, and final drain releases the replacement', async (t) => {
  const f = fixture('release-reuse');
  const { adapter } = countedBlockingAdapter();
  const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 });
  const totalBytes = 40 + validPolicy.runtimeReserveBytes;
  const totalInodes = 3 + validPolicy.runtimeReserveInodes;
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo,
    logDir: f.logDir,
    adapters: { mock: adapter },
    worktreeCapacity: { ...validPolicy, maxReservedBytes: totalBytes, maxReservedInodes: totalInodes },
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });

  const first = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-release-first' });
  await until(() => driver.coordinator.list().find((row) => row.id === first.id)?.pendingQuestionId, 'first reserved worker');
  const firstOwner = driver.coordinator.list().find((row) => row.id === first.id).sessionContext.ownerTaskId;
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);
  await driver.coordinator.kill(first.id, 'phase59:test');
  await until(() => driver.worktreeCapacity.snapshot().reservations.length === 0, 'first reservation release');
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', firstOwner)), false);

  const second = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-release-second' });
  await until(() => driver.coordinator.list().find((row) => row.id === second.id)?.pendingQuestionId, 'replacement reserved worker');
  const secondOwner = driver.coordinator.list().find((row) => row.id === second.id).sessionContext.ownerTaskId;
  assert.equal(driver.worktreeCapacity.snapshot().reservations[0].id, `worker:${secondOwner}`);
  await driver.drainAndClose('phase59:release');
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  driver = null;
});

test('WC6: worktree creation failure releases the reservation and permits an exact replacement', async (t) => {
  const f = fixture('create-failure');
  const { adapter } = countedBlockingAdapter();
  const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 });
  const totalBytes = 40 + validPolicy.runtimeReserveBytes;
  const totalInodes = 3 + validPolicy.runtimeReserveInodes;
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo,
    logDir: f.logDir,
    adapters: { mock: adapter },
    worktreeCapacity: { ...validPolicy, maxReservedBytes: totalBytes, maxReservedInodes: totalInodes },
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const collision = join(f.repo, '.baton', 'wt');
  mkdirSync(join(f.repo, '.baton'), { recursive: true });
  writeFileSync(collision, 'not a directory\n');

  const failed = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-create-failure' });
  await until(async () => {
    const result = await driver.coordinator.result(failed.id);
    return result.status === 'failed' ? result : null;
  }, 'failed worktree creation');
  await until(() => driver.worktreeCapacity.snapshot().reservations.length === 0, 'failed creation reservation release');
  rmSync(collision, { recursive: true, force: true });

  const replacement = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-create-replacement' });
  await until(() => driver.coordinator.list().find((row) => row.id === replacement.id)?.pendingQuestionId, 'replacement after create failure');
  const replacementOwner = driver.coordinator.list().find((row) => row.id === replacement.id).sessionContext.ownerTaskId;
  assert.equal(driver.worktreeCapacity.snapshot().reservations[0].id, `worker:${replacementOwner}`);
});

class InertAdapter extends MockAdapter {
  constructor() { super({ scenario: { outcome: 'completed', edits: [] } }); this.calls = 0; }
  async spawn() { this.calls += 1; return { ok: true }; }
  async kill() { return { ok: true, terminal: true }; }
  async interrupt() { return { ok: true, terminal: true }; }
}

test('WC7: startup replay plus reconciliation clears a stale reservation whose owned worktree disappeared', async (t) => {
  const f = fixture('replay-stale');
  const firstAdapter = new InertAdapter();
  const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 });
  const totalBytes = 40 + validPolicy.runtimeReserveBytes;
  const totalInodes = 3 + validPolicy.runtimeReserveInodes;
  const options = {
    repoRoot: f.repo,
    logDir: f.logDir,
    worktreeCapacity: { ...validPolicy, maxReservedBytes: totalBytes, maxReservedInodes: totalInodes },
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  };
  let first;
  let replay;
  t.after(async () => {
    try { first?.coordination.releaseWriterLease(); } catch { /* simulated crash may already release */ }
    await dispose(replay, f);
  });
  first = createDriver({ ...options, adapters: { inert: firstAdapter } });
  const handle = await first.coordinator.spawn('inert', brief(), { taskId: 'capacity-stale-replay' });
  const workerContext = await until(() => first.coordinator.list().find((row) => row.id === handle.id)?.sessionContext, 'stale reservation worktree');
  const workerPath = workerContext.worktree;
  assert.equal(first.worktreeCapacity.snapshot().reservations.length, 1);

  git(['worktree', 'remove', '--force', workerPath], f.repo);
  git(['branch', '-D', workerContext.branch], f.repo);
  first.coordination.releaseWriterLease({ requireOwned: true });
  replay = createDriver({ ...options, adapters: {} });
  await replay.ready;

  assert.equal(replay.worktreeCapacity.snapshot().totals.bytes, 0);
  assert.equal(replay.worktreeCapacity.snapshot().totals.inodes, 0);
  assert.deepEqual(replay.worktreeCapacity.snapshot().reservations, []);
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', `${workerContext.ownerTaskId}.meta.json`)), false);
});

for (const scenario of [
  { label: 'estimator exception', estimate() { throw new Error('estimate unavailable'); }, observe: () => ({ freeBytes: 10_000, freeInodes: 1_000 }) },
  { label: 'observer exception', estimate: () => ({ bytes: 60, inodes: 5 }), observe() { throw new Error('observe unavailable'); } },
  { label: 'invalid estimator shape', estimate: () => ({ bytes: 60 }), observe: () => ({ freeBytes: 10_000, freeInodes: 1_000 }) },
  { label: 'invalid observer shape', estimate: () => ({ bytes: 60, inodes: 5 }), observe: () => ({ freeBytes: 10_000 }) },
]) {
  test(`WC8: ${scenario.label} refuses unavailable before task, runtime, worktree, or provider effect`, async (t) => {
    const f = fixture(`dependency-${scenario.label.replaceAll(' ', '-')}`); const { adapter, spawnCalls } = countedBlockingAdapter(); let driver;
    t.after(() => dispose(driver, f));
    driver = createDriver({
      repoRoot: f.repo, logDir: f.logDir, adapters: { mock: adapter }, worktreeCapacity: validPolicy,
      worktreeCapacityEstimate: scenario.estimate, worktreeCapacityObserve: scenario.observe,
    });
    await assert.rejects(driver.coordinator.spawn('mock', brief(), { taskId: `capacity-${scenario.label.replaceAll(' ', '-')}` }), (error) => error?.code === 'worktree_capacity_unavailable');
    assert.equal(spawnCalls(), 0); assert.equal(driver.coordinator.list().length, 0);
    assert.equal(existsSync(join(f.repo, '.baton', 'runtime')), false);
    assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  });
}

test('WC9: free-space and inode floors subtract existing reservations inside concurrent admission', async (t) => {
  const f = fixture('free-floor'); const { adapter, spawnCalls } = countedBlockingAdapter(); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: { mock: adapter },
    worktreeCapacity: { ...validPolicy, maxReservedBytes: 1_000, maxReservedInodes: 1_000 },
    worktreeCapacityEstimate: () => ({ bytes: 60, inodes: 5 }),
    worktreeCapacityObserve: () => ({ freeBytes: 170, freeInodes: 20 }),
  });
  const first = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-floor-a' });
  await until(() => driver.coordinator.list().find((row) => row.id === first.id)?.pendingQuestionId, 'free-floor first worker');
  await assert.rejects(driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-floor-b' }), (error) => error?.code === 'worktree_capacity_exceeded');
  assert.equal(spawnCalls(), 1); assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);
});

test('WC10: worker and verifier reservations release only after their exact owned paths are removed', async (t) => {
  const f = fixture('verifier-release'); const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 }); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {},
    worktreeCapacity: { ...validPolicy, maxReservedBytes: 500, maxReservedInodes: 100 },
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate, worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const worker = await driver.coordinator._worktrees.create('capacity-verifier-owner', f.sha);
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);
  const verifier = await driver.coordinator._worktrees.createVerifyWorktree('capacity-verifier', f.sha);
  const active = driver.worktreeCapacity.snapshot();
  assert.equal(active.reservations.length, 2);
  assert.deepEqual(active.outstanding, {
    bytes: validPolicy.runtimeReserveBytes * 2,
    inodes: validPolicy.runtimeReserveInodes * 2,
  });
  assert.equal(active.reservations.every((row) => typeof row.materializedAt === 'string'), true);
  await driver.coordinator._worktrees.removeVerifyWorktree(verifier.path);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations.map((row) => row.id), [`worker:${worker.ownerTaskId}`]);
  await driver.coordinator._worktrees.remove(worker.ownerTaskId);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(existsSync(worker.path), false);
});

test('WC11: corrupt state and an ownerless live lock fail closed without deleting the lock', async (t) => {
  const f = fixture('state-lock'); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: { mock: countedBlockingAdapter().adapter }, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: () => ({ bytes: 60, inodes: 5 }), worktreeCapacityObserve: () => ({ freeBytes: 10_000, freeInodes: 1_000 }),
  });
  const capacityRoot = join(f.repo, '.baton', 'capacity'); mkdirSync(capacityRoot, { recursive: true });
  writeFileSync(join(capacityRoot, 'reservations.json'), '{');
  await assert.rejects(driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-corrupt-state' }), (error) => error?.code === 'worktree_capacity_unavailable');
  rmSync(join(capacityRoot, 'reservations.json'));
  const lock = join(capacityRoot, 'lock'); mkdirSync(lock);
  await assert.rejects(driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-ownerless-lock' }), (error) => error?.code === 'worktree_capacity_unavailable');
  assert.equal(existsSync(lock), true);
});

test('WC12: stale release token cannot delete a later reservation that reused the same resource id', async (t) => {
  const f = fixture('stale-release'); const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 }); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate, worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const request = { baseSha: f.sha, sparsePaths: [], sparseCheckoutIdentity: sparseCheckoutIdentity([]), toolchainProjection: null };
  const first = driver.worktreeCapacity.reserve('worker:capacity-reused', request);
  assert.equal(driver.worktreeCapacity.release(first), true);
  const replacement = driver.worktreeCapacity.reserve('worker:capacity-reused', request);
  assert.notEqual(first.nonce, replacement.nonce);
  assert.equal(driver.worktreeCapacity.release(first), false);
  assert.equal(driver.worktreeCapacity.snapshot().reservations[0].nonce, replacement.nonce);
  assert.equal(driver.worktreeCapacity.release(replacement), true);
});

test('WC13: provider refusal and runtime creation failure both release pre-worktree reservations', async (t) => {
  const f = fixture('pre-worktree-release'); const injected = injectedCapacity({ treeBytes: 40, treeInodes: 3 });
  const first = countedBlockingAdapter(); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: { mock: first.adapter }, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate, worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  driver.coordinator._admitProviderTurn = (handle) => ({
    ok: false,
    event: driver.log.append({ worker: handle.id, harness: 'mock', turnEpoch: 0, kind: 'resource.provider_turn_refused', actor: 'policy', payload: { code: 'fixture_refusal' } }),
  });
  const refused = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-provider-refused' });
  assert.equal(driver.coordinator.list().find((row) => row.id === refused.id).status, 'exited');
  assert.equal(first.spawnCalls(), 0); assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  driver.close(); driver = null;

  const second = countedBlockingAdapter();
  driver = createDriver({
    repoRoot: f.repo, logDir: join(f.world, 'runtime-failure-log'), adapters: { mock: second.adapter }, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate, worktreeCapacityObserve: injected.worktreeCapacityObserve,
    runtimeScopes: { reconcile() {}, create() { throw new Error('runtime unavailable'); }, remove() {} },
  });
  const failed = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-runtime-failed' });
  assert.equal(driver.coordinator.list().find((row) => row.id === failed.id).status, 'exited');
  assert.equal(second.spawnCalls(), 0); assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
});

test('WC14: valid-shape ledger tampering fails HMAC validation closed', async (t) => {
  const f = fixture('hmac-tamper'); const injected = injectedCapacity(); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate, worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const request = { baseSha: f.sha, sparsePaths: [], sparseCheckoutIdentity: sparseCheckoutIdentity([]), toolchainProjection: null };
  driver.worktreeCapacity.reserve('worker:capacity-hmac-tamper', request);
  const statePath = join(f.repo, '.baton', 'capacity', 'reservations.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.reservations[0].bytes += 1;
  writeFileSync(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  assert.throws(() => driver.worktreeCapacity.snapshot(), (error) => error?.code === 'worktree_capacity_unavailable');
});

test('WC15: a well-formed dead generation lock is reaped before exact admission', async (t) => {
  const f = fixture('dead-lock'); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: () => ({ bytes: 60, inodes: 5 }), worktreeCapacityObserve: () => ({ freeBytes: 10_000, freeInodes: 1_000 }),
  });
  const lock = join(f.repo, '.baton', 'capacity', 'lock');
  writeFileSync(lock, `${JSON.stringify({ schemaVersion: 1, pid: 99_999_999, ownerId: 'a'.repeat(32), generation: 'b'.repeat(32) })}\n`, { mode: 0o600 });
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(existsSync(lock), false);
});

test('WC16: restart reconciliation adopts live workers and removes non-resumable verifiers', async (t) => {
  const f = fixture('adopt'); const injected = injectedCapacity(); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate, worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const request = { baseSha: f.sha, sparsePaths: [], sparseCheckoutIdentity: sparseCheckoutIdentity([]), toolchainProjection: null };
  const worker = driver.worktreeCapacity.reserve('worker:capacity-adopted', request);
  driver.worktreeCapacity.reserve('verify:capacity-abandoned', request);
  const restarted = new WorktreeCapacityAuthority({
    repoRoot: f.repo, policy: validPolicy, integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(f.repo),
    estimate: injected.worktreeCapacityEstimate, observe: injected.worktreeCapacityObserve,
  });
  const report = restarted.reconcile(['capacity-adopted']);
  assert.deepEqual(report.removed, ['verify:capacity-abandoned']);
  assert.equal(report.adopted.length, 1);
  assert.notEqual(report.adopted[0].ownerId, worker.ownerId);
  assert.equal(restarted.release(report.adopted[0]), true);
});

test('WC17: legacy close paths refuse active reservations and preserve drain authority', async (t) => {
  const f = fixture('legacy-close'); const { adapter } = countedBlockingAdapter(); const injected = injectedCapacity(); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: { mock: adapter }, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate, worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-active-close' });
  await until(() => driver.coordinator.list().find((row) => row.id === handle.id)?.pendingQuestionId, 'legacy close worker');
  assert.throws(() => driver.close(), (error) => error?.code === 'driver_capacity_active');
  await assert.rejects(driver.closeAsync(), (error) => error?.code === 'driver_capacity_active');
  const receipt = await driver.drainAndClose('phase59:legacy-close');
  assert.equal(receipt.capacity.ownedReservations, 0);
  assert.match(receipt.capacity.stateDigest, /^[a-f0-9]{64}$/u);
  driver = null;
});

test('WC18: capacity refuses un-attested legacy dependency copies before driver authority', async (t) => {
  const f = fixture('legacy-dependency-refusal'); let driver = null;
  t.after(() => dispose(driver, f));
  assert.throws(() => {
    driver = createDriver({
      repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
      workerDependencyDirs: ['src'], verifyDependencyDirs: ['src'],
    });
  }, /attested toolchainProjection/u);
  assert.equal(driver, null);
  assert.equal(existsSync(f.logDir), false);
  assert.equal(existsSync(join(f.repo, '.baton')), false);
});

test('WC19: refused supervised closeAsync leaves recovery authority running for exact drain', async (t) => {
  const f = fixture('supervised-close'); const { adapter } = countedBlockingAdapter(); const injected = injectedCapacity(); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: { mock: adapter }, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate, worktreeCapacityObserve: injected.worktreeCapacityObserve,
    sessionRecoveryPolicy: { maxAttempts: 3, maxSessions: 2, maxStateRows: 8, timeoutMs: 100 },
  });
  await driver.ready;
  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-supervised-close' });
  await until(() => driver.coordinator.list().find((row) => row.id === handle.id)?.pendingQuestionId, 'supervised close worker');
  const before = driver.sessionRecovery.status();
  await assert.rejects(driver.closeAsync(), (error) => error?.code === 'driver_capacity_active');
  assert.deepEqual(driver.sessionRecovery.status(), before);
  const receipt = await driver.drainAndClose('phase59:supervised-close');
  assert.equal(receipt.capacity.ownedReservations, 0);
  driver = null;
});

test('WC20: failed exact pending release retains its nonce token for retry', async (t) => {
  const f = fixture('release-retry'); const injected = injectedCapacity(); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate, worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  driver.coordinator._worktrees.reserveCapacity('capacity-release-retry', f.sha);
  const release = driver.worktreeCapacity.release.bind(driver.worktreeCapacity);
  let injectedFailure = true;
  driver.worktreeCapacity.release = (token) => {
    if (injectedFailure) { injectedFailure = false; throw Object.assign(new Error('transient lock failure'), { code: 'worktree_capacity_unavailable' }); }
    return release(token);
  };
  assert.throws(() => driver.coordinator._worktrees.releaseCapacity('capacity-release-retry'), (error) => error?.code === 'worktree_capacity_unavailable');
  assert.equal(driver.coordinator._worktrees.releaseCapacity('capacity-release-retry'), true);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
});

test('WC21: drain capacity refusal occurs before irreversible coordinator close and can retry', async (t) => {
  const f = fixture('drain-retry'); const injected = injectedCapacity(); let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate, worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const request = { baseSha: f.sha, sparsePaths: [], sparseCheckoutIdentity: sparseCheckoutIdentity([]), toolchainProjection: null };
  const orphan = driver.worktreeCapacity.reserve('worker:capacity-orphan-drain', request);
  const reconcile = driver.coordinator._worktrees.reconcile.bind(driver.coordinator._worktrees);
  driver.coordinator._worktrees.reconcile = () => ({ errors: [] });
  await assert.rejects(driver.drainAndClose('phase59:orphan-first'), (error) => error?.code === 'coordinator_drain_incomplete');
  assert.equal(driver.coordinator._closed, false);
  driver.coordinator._worktrees.reconcile = reconcile;
  assert.equal(driver.worktreeCapacity.release(orphan), true);
  const receipt = await driver.drainAndClose('phase59:orphan-first');
  assert.equal(receipt.capacity.ownedReservations, 0);
  driver = null;
});

test('WC22: trust-gate capacity refusal exposes a bounded typed code without capacity internals', async (t) => {
  const f = fixture('trust-gate-capacity-code');
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [] } });
  let observations = 0;
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo,
    logDir: f.logDir,
    adapters: { mock: adapter },
    worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: () => ({ bytes: 60, inodes: 5 }),
    worktreeCapacityObserve: () => {
      observations += 1;
      return observations === 1
        ? { freeBytes: 10_000, freeInodes: 1_000 }
        : { freeBytes: 150, freeInodes: 20 };
    },
  });

  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-trust-gate-code' });
  await until(async () => {
    const result = await driver.coordinator.result(handle.id);
    return result.status === 'failed' ? result : null;
  }, 'typed trust-gate capacity refusal');

  const refusal = driver.log.read(handle.id).find((event) => (
    event.kind === 'error' && event.payload?.phase === 'trust_gate'
  ));
  assert.equal(refusal?.payload?.trustPhase, 'capture');
  assert.equal(refusal?.payload?.code, 'worktree_capacity_exceeded');
  assert.equal(Object.hasOwn(refusal?.payload ?? {}, 'freeBytes'), false);
  assert.equal(Object.hasOwn(refusal?.payload ?? {}, 'reservations'), false);
});

test('WC23: reconciliation releases dead foreign owners without stealing live foreign capacity', (t) => {
  const f = fixture('dead-foreign-owner');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const policy = { ...validPolicy, maxReservedBytes: 120 };
  const integrityKey = loadOrCreateWorktreeCapacityIntegrityKey(f.repo);
  const estimate = () => ({ bytes: 60, inodes: 5 });
  const observe = () => ({ freeBytes: 10_000, freeInodes: 1_000 });
  const foreign = new WorktreeCapacityAuthority({
    repoRoot: f.repo, policy, integrityKey, estimate, observe,
  });
  const request = {
    baseSha: f.sha, sparsePaths: [], sparseCheckoutIdentity: sparseCheckoutIdentity([]), toolchainProjection: null,
  };
  foreign.reserve('worker:capacity-dead-foreign', request);
  const liveForeign = foreign.reserve('worker:capacity-live-foreign', request);
  const retainedPath = join(f.repo, '.baton', 'wt', 'capacity-dead-foreign');
  mkdirSync(retainedPath, { recursive: true });

  const statePath = join(f.repo, '.baton', 'capacity', 'reservations.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const definitelyDeadPid = 2_147_483_647;
  const reservations = state.reservations.map((row) => row.id === 'worker:capacity-dead-foreign'
    ? { ...row, pid: definitelyDeadPid }
    : row);
  writeFileSync(statePath, `${JSON.stringify(foreign._seal({ ...state, reservations }), null, 2)}\n`, { mode: 0o600 });

  const restarted = new WorktreeCapacityAuthority({
    repoRoot: f.repo, policy, integrityKey, estimate, observe,
  });
  const report = restarted.reconcile([]);

  assert.deepEqual(report.removed, ['worker:capacity-dead-foreign']);
  assert.deepEqual(report.active, ['worker:capacity-live-foreign']);
  assert.equal(existsSync(retainedPath), true, 'capacity reconciliation must not claim worktree cleanup authority');
  const retained = restarted.snapshot().reservations[0];
  assert.equal(retained.ownerId, liveForeign.ownerId);
  assert.equal(retained.pid, process.pid);

  const replacement = restarted.reserve('worker:capacity-dead-replacement', request);
  assert.equal(restarted.snapshot().totals.bytes, 120, 'released dead capacity must be immediately reusable');
  assert.equal(restarted.release(replacement), true);
  assert.equal(foreign.release(liveForeign), true);
});

test('WC24: materialized allocations retain growth headroom without double-counting their tree bytes', (t) => {
  const f = fixture('materialized-outstanding-capacity');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const policy = {
    ...validPolicy,
    maxReservedBytes: 120,
    maxReservedInodes: 10,
    minFreeBytes: 100,
    minFreeInodes: 10,
  };
  let freeBytes = 220;
  let freeInodes = 30;
  const authority = new WorktreeCapacityAuthority({
    repoRoot: f.repo,
    policy,
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(f.repo),
    estimate: () => ({ bytes: 60, inodes: 5 }),
    observe: () => ({ freeBytes, freeInodes }),
  });
  const request = {
    baseSha: f.sha,
    sparsePaths: [],
    sparseCheckoutIdentity: sparseCheckoutIdentity([]),
    toolchainProjection: null,
    toolchainProjectionTargetParents: [],
  };

  const first = authority.reserve('worker:materialized-first', request);
  assert.throws(
    () => authority.materialize(first, join(f.repo, '.baton', 'wt', 'missing')),
    (error) => error?.code === 'worktree_capacity_unavailable',
  );
  const foreignPath = join(f.world, 'foreign-materialization');
  mkdirSync(foreignPath);
  assert.throws(
    () => authority.materialize(first, foreignPath),
    (error) => error?.code === 'worktree_capacity_unavailable',
  );
  const materializedPath = join(f.repo, '.baton', 'wt', 'materialized-first');
  mkdirSync(materializedPath, { recursive: true });
  freeBytes = 180;
  freeInodes = 27;
  const materialized = authority.materialize(first, materializedPath);
  assert.equal(typeof materialized.materializedAt, 'string');
  assert.equal(materialized.outstandingBytes, policy.runtimeReserveBytes);
  assert.equal(materialized.outstandingInodes, policy.runtimeReserveInodes);
  assert.deepEqual(authority.materialize(first, materializedPath), materialized,
    'response-loss replay returns the original materialization coordinate');

  const second = authority.reserve('worker:materialized-second', request);
  const snapshot = authority.snapshot();
  assert.deepEqual(snapshot.totals, { bytes: 120, inodes: 10 });
  assert.deepEqual(snapshot.outstanding, { bytes: 80, inodes: 7 });
  assert.equal(snapshot.reservations.find((row) => row.id === first.id).materializedAt,
    materialized.materializedAt);
  assert.equal(snapshot.reservations.find((row) => row.id === second.id).materializedAt, null);
  assert.deepEqual(authority.releaseMany([materialized, second]), [true, true]);
});

test('P92.2-PO2/WC25: failed materialized capacity release retains physical cleanup authority for exact retry', async (t) => {
  // Red at pre-fix candidate 2188b0c: remove() reaped the checkout and common-Git receipt before
  // this injected release failure escaped, so neither the durable binding nor local retry
  // authority survived. The retry could release capacity only after its cleanup proof was gone.
  const f = fixture('physical-owner-release-retry');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo,
    logDir: f.logDir,
    adapters: {},
    worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });

  const created = await driver.coordinator._worktrees.create('capacity-release-logical', f.sha, {
    runId: 'run-capacity-release-retry',
    attemptId: 'attempt-capacity-release-retry',
    processGeneration: 1,
  });
  const context = {
    repoRoot: f.repo,
    worktree: created.path,
    branch: created.branch,
    baseSha: created.baseSha,
    ownerTaskId: created.ownerTaskId,
    logicalTaskId: created.logicalTaskId,
    ownerReceiptDigest: created.ownerReceiptDigest,
  };
  const receiptBefore = physicalWorkspaceOwnerReceipt(f.repo, created.ownerTaskId);
  const release = driver.worktreeCapacity.release.bind(driver.worktreeCapacity);
  let releaseCalls = 0;
  driver.worktreeCapacity.release = (token) => {
    releaseCalls += 1;
    assert.equal(
      physicalWorkspaceOwnerReceipt(f.repo, created.ownerTaskId)?.receiptDigest,
      receiptBefore.receiptDigest,
      'the common-Git receipt must authorize every capacity release attempt',
    );
    if (releaseCalls === 1) {
      throw Object.assign(new Error('transient materialized release failure'), {
        code: 'worktree_capacity_unavailable',
      });
    }
    const released = release(token);
    assert.equal(released, true);
    assert.equal(
      physicalWorkspaceOwnerReceipt(f.repo, created.ownerTaskId)?.receiptDigest,
      receiptBefore.receiptDigest,
      'receipt finalization must follow durable capacity absence',
    );
    return released;
  };

  await assert.rejects(
    driver.coordinator._worktrees.remove(created.ownerTaskId),
    (error) => error?.code === 'worktree_capacity_unavailable',
  );
  assert.equal(existsSync(created.path), true);
  assert.equal(driver.coordinator._worktrees.worktreeAvailable('capacity-release-logical', context), true);
  assert.equal(
    physicalWorkspaceOwnerReceipt(f.repo, created.ownerTaskId)?.receiptDigest,
    receiptBefore.receiptDigest,
  );
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);
  assert.equal(git(['branch', '--list', created.branch], f.repo).replace(/^\+\s+/u, ''), created.branch);

  await driver.coordinator._worktrees.remove(created.ownerTaskId);
  assert.equal(releaseCalls, 2);
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 0);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, created.ownerTaskId), null);
  assert.equal(existsSync(created.path), false);
  assert.equal(git(['branch', '--list', created.branch], f.repo), '');
  assert.equal(
    git(['worktree', 'list', '--porcelain'], f.repo).split('\n')
      .some((line) => line === `worktree ${created.path}`),
    false,
  );

  await driver.coordinator._worktrees.remove(created.ownerTaskId);
  assert.equal(releaseCalls, 2, 'idempotent cleanup must not replay the exact capacity release');
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, created.ownerTaskId), null);
});

test('P92.2-PO2/WC26: post-create materialization rollback survives release throw and false before exact retry', async (t) => {
  const f = fixture('post-create-rollback-retry');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const materialize = driver.worktreeCapacity.materialize.bind(driver.worktreeCapacity);
  driver.worktreeCapacity.materialize = () => {
    throw Object.assign(new Error('injected post-create materialization failure'), {
      code: 'worktree_capacity_unavailable',
    });
  };
  const release = driver.worktreeCapacity.release.bind(driver.worktreeCapacity);
  let releaseCalls = 0;
  let physicalOwnerId;
  driver.worktreeCapacity.release = (token) => {
    releaseCalls += 1;
    physicalOwnerId ??= token.id.slice('worker:'.length);
    const receipt = physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId);
    assert.ok(receipt, `release attempt ${releaseCalls} requires the receipt`);
    assert.equal(existsSync(receipt.worktree), true, `release attempt ${releaseCalls} requires the checkout`);
    if (releaseCalls === 1) {
      throw Object.assign(new Error('injected rollback release throw'), {
        code: 'worktree_capacity_unavailable',
      });
    }
    if (releaseCalls === 2) return false;
    return release(token);
  };

  await assert.rejects(driver.coordinator._worktrees.create('post-create-logical', f.sha, {
    runId: 'run-post-create', attemptId: 'attempt-post-create', processGeneration: 1,
  }));
  driver.worktreeCapacity.materialize = materialize;
  assert.equal(releaseCalls, 1);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);

  await assert.rejects(
    driver.coordinator._worktrees.remove('post-create-logical'),
    (error) => error?.code === 'worktree_capacity_unavailable',
  );
  assert.equal(releaseCalls, 2);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);

  await driver.coordinator._worktrees.remove('post-create-logical');
  assert.equal(releaseCalls, 3);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId), null);
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', physicalOwnerId)), false);
  assert.equal(git(['branch', '--list', `baton/${physicalOwnerId}`], f.repo), '');
  await driver.coordinator._worktrees.remove('post-create-logical');
  assert.equal(releaseCalls, 3);
});

test('P92.2-PO2/WC27: pending base-mismatch release false retains allocation and success finalizes it', async (t) => {
  const f = fixture('pending-base-mismatch');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const binding = {
    runId: 'run-base-mismatch', attemptId: 'attempt-base-mismatch', processGeneration: 1,
  };
  driver.coordinator._worktrees.reserveCapacity('base-mismatch-logical', f.sha, binding);
  git(['commit', '--allow-empty', '-qm', 'different requested base'], f.repo);
  const differentSha = git(['rev-parse', 'HEAD'], f.repo);
  const reservation = driver.worktreeCapacity.snapshot().reservations[0];
  const physicalOwnerId = reservation.resourceId;
  const release = driver.worktreeCapacity.release.bind(driver.worktreeCapacity);
  let releaseCalls = 0;
  driver.worktreeCapacity.release = (token) => {
    releaseCalls += 1;
    assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
    return releaseCalls === 1 ? false : release(token);
  };

  await assert.rejects(
    driver.coordinator._worktrees.create('base-mismatch-logical', differentSha, binding),
    /capacity reservation base SHA disagrees/u,
  );
  assert.equal(releaseCalls, 1);
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));

  await assert.rejects(
    driver.coordinator._worktrees.create('base-mismatch-logical', differentSha, binding),
    /capacity reservation base SHA disagrees/u,
  );
  assert.equal(releaseCalls, 2);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId), null);
});

test('P92.2-PO2/WC28: pending remove release false is a retryable refusal, not cleanup success', async (t) => {
  const f = fixture('pending-remove-false');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  driver.coordinator._worktrees.reserveCapacity('pending-remove-logical', f.sha, {
    runId: 'run-pending-remove', attemptId: 'attempt-pending-remove', processGeneration: 1,
  });
  const reservation = driver.worktreeCapacity.snapshot().reservations[0];
  const physicalOwnerId = reservation.resourceId;
  const release = driver.worktreeCapacity.release.bind(driver.worktreeCapacity);
  let releaseCalls = 0;
  driver.worktreeCapacity.release = (token) => {
    releaseCalls += 1;
    assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
    return releaseCalls === 1 ? false : release(token);
  };

  await assert.rejects(
    driver.coordinator._worktrees.remove('pending-remove-logical'),
    (error) => error?.code === 'worktree_capacity_unavailable',
  );
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
  await driver.coordinator._worktrees.remove('pending-remove-logical');
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId), null);
  assert.equal(releaseCalls, 2);
});

test('P92.2-PO2/WC29: failed-create retry finalizes the retained physical transaction before allocating anew', async (t) => {
  const f = fixture('failed-create-gates-retry');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const materialize = driver.worktreeCapacity.materialize.bind(driver.worktreeCapacity);
  driver.worktreeCapacity.materialize = () => {
    throw Object.assign(new Error('injected gated materialization failure'), {
      code: 'worktree_capacity_unavailable',
    });
  };
  const release = driver.worktreeCapacity.release.bind(driver.worktreeCapacity);
  let releaseCalls = 0;
  let retainedOwnerId;
  driver.worktreeCapacity.release = (token) => {
    releaseCalls += 1;
    retainedOwnerId ??= token.resourceId;
    if (releaseCalls === 1) {
      throw Object.assign(new Error('injected initial cleanup failure'), {
        code: 'worktree_capacity_unavailable',
      });
    }
    if (releaseCalls === 2) return false;
    return release(token);
  };
  const binding = {
    runId: 'run-gated-create', attemptId: 'attempt-gated-create', processGeneration: 1,
  };
  await assert.rejects(
    driver.coordinator._worktrees.create('gated-create-logical', f.sha, binding),
  );
  driver.worktreeCapacity.materialize = materialize;
  const originalReceipt = physicalWorkspaceOwnerReceipt(f.repo, retainedOwnerId);
  assert.ok(originalReceipt);
  await assert.rejects(
    driver.coordinator._worktrees.create('gated-create-logical', f.sha, binding),
    (error) => error?.code === 'worktree_capacity_unavailable',
  );
  assert.equal(releaseCalls, 2);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, retainedOwnerId)?.receiptDigest,
    originalReceipt.receiptDigest);
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);

  const replacement = await driver.coordinator._worktrees.create(
    'gated-create-logical', f.sha, binding,
  );
  assert.equal(releaseCalls, 3);
  assert.notEqual(replacement.ownerTaskId, retainedOwnerId);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, retainedOwnerId), null);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, replacement.ownerTaskId));
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations.map((row) => row.resourceId), [
    replacement.ownerTaskId,
  ]);
  await driver.coordinator._worktrees.remove(replacement.ownerTaskId);
});

test('P92.2-PO2/WC30: restart settles failed-materialization capacity before destructive reconciliation', async (t) => {
  const f = fixture('restart-failed-materialization');
  const injected = injectedCapacity();
  let driver;
  t.after(() => {
    try { driver?.coordination.releaseWriterLease(); } catch { /* already released */ }
    rmSync(f.world, { recursive: true, force: true });
  });
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  driver.worktreeCapacity.materialize = () => {
    throw Object.assign(new Error('restart materialization boundary'), {
      code: 'worktree_capacity_unavailable',
    });
  };
  driver.worktreeCapacity.release = () => {
    throw Object.assign(new Error('controller died before rollback settlement'), {
      code: 'worktree_capacity_unavailable',
    });
  };
  await assert.rejects(driver.coordinator._worktrees.create(
    'restart-materialization-logical', f.sha, {
      runId: 'run-restart-materialization',
      attemptId: 'attempt-restart-materialization',
      processGeneration: 1,
    },
  ));
  const priorReservation = driver.worktreeCapacity.snapshot().reservations[0];
  const physicalOwnerId = priorReservation.resourceId;
  const receipt = physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId);
  assert.ok(receipt);
  driver.coordinator._closed = true;
  driver.coordination.releaseWriterLease({ requireOwned: true });

  const restartedCapacity = new WorktreeCapacityAuthority({
    repoRoot: f.repo,
    policy: validPolicy,
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(f.repo),
    estimate: injected.worktreeCapacityEstimate,
    observe: injected.worktreeCapacityObserve,
  });
  const ownerAuthority = {
    deploymentId: receipt.deploymentId,
    controllerId: 'f'.repeat(64),
    pid: process.pid,
    pidStart: receipt.controller.pidStart,
  };
  const assertCompleteTransaction = () => {
    assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
    assert.equal(existsSync(receipt.worktree), true);
    assert.notEqual(git(['branch', '--list', receipt.branch], f.repo), '');
    assert.equal(git(['worktree', 'list', '--porcelain'], f.repo).split('\n')
      .filter((line) => line.startsWith('worktree '))
      .some((line) => realpathSync(line.slice('worktree '.length)) === realpathSync(receipt.worktree)), true);
    assert.deepEqual(restartedCapacity.snapshot().reservations.map((row) => row.resourceId), [
      physicalOwnerId,
    ]);
  };

  const thrown = reconcileWorktrees(f.repo, [], {
    ownerAuthority,
    beforeOwnerCleanup: () => {
      assertCompleteTransaction();
      throw Object.assign(new Error('restart settlement unavailable'), {
        code: 'worktree_capacity_unavailable',
      });
    },
  });
  assert.ok(thrown.diagnostics.some((row) => (
    row.code === 'workspace_owner_capacity_settlement_failed' && row.retained === true
  )));
  assertCompleteTransaction();

  const refused = reconcileWorktrees(f.repo, [], {
    ownerAuthority,
    beforeOwnerCleanup: () => { assertCompleteTransaction(); return false; },
  });
  assert.ok(refused.diagnostics.some((row) => (
    row.code === 'workspace_owner_capacity_settlement_refused' && row.retained === true
  )));
  assertCompleteTransaction();

  const settled = reconcileWorktrees(f.repo, [], {
    ownerAuthority,
    beforeOwnerCleanup: (owner) => {
      assert.equal(owner, physicalOwnerId);
      assertCompleteTransaction();
      return restartedCapacity.settleForCleanup(`worker:${owner}`);
    },
  });
  assert.deepEqual(settled.errors, []);
  assert.deepEqual(restartedCapacity.snapshot().reservations, []);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId), null);
  assert.equal(existsSync(receipt.worktree), false);
  assert.equal(git(['branch', '--list', receipt.branch], f.repo), '');
});

test('P92.2-PO2/WC31: concurrent failed-transaction removal joins one physical finalization', async (t) => {
  const f = fixture('concurrent-failed-transaction-finalization');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  driver.worktreeCapacity.materialize = () => {
    throw Object.assign(new Error('injected concurrent-finalization materialization failure'), {
      code: 'worktree_capacity_unavailable',
    });
  };
  const release = driver.worktreeCapacity.release.bind(driver.worktreeCapacity);
  let releaseCalls = 0;
  let joinedSettlementCalls = 0;
  let physicalOwnerId;
  driver.worktreeCapacity.release = (token) => {
    releaseCalls += 1;
    physicalOwnerId ??= token.resourceId;
    if (releaseCalls === 1) {
      throw Object.assign(new Error('retain transaction for concurrent removal'), {
        code: 'worktree_capacity_unavailable',
      });
    }
    joinedSettlementCalls += 1;
    return release(token);
  };

  await assert.rejects(driver.coordinator._worktrees.create(
    'concurrent-finalize-logical', f.sha, {
      runId: 'run-concurrent-finalize',
      attemptId: 'attempt-concurrent-finalize',
      processGeneration: 1,
    },
  ));
  const receipt = physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId);
  assert.ok(receipt);
  assert.equal(existsSync(receipt.worktree), true);
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);

  const first = driver.coordinator._worktrees.remove('concurrent-finalize-logical');
  const second = driver.coordinator._worktrees.remove('concurrent-finalize-logical');
  assert.deepEqual(await Promise.all([first, second]), [undefined, undefined]);
  assert.equal(joinedSettlementCalls, 1, 'concurrent callers must join one capacity settlement');
  assert.equal(releaseCalls, 2);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId), null);
  assert.equal(existsSync(receipt.worktree), false);
  assert.equal(git(['branch', '--list', receipt.branch], f.repo), '');
  assert.equal(git(['worktree', 'list', '--porcelain'], f.repo).split('\n')
    .some((line) => line === `worktree ${receipt.worktree}`), false);
  assert.equal(driver.log.read(physicalOwnerId)
    .filter((event) => event.kind === 'worktree.reaped').length, 1,
  'joined finalization must emit exactly one physical receipt-finalization/reap event');

  await driver.coordinator._worktrees.remove('concurrent-finalize-logical');
  assert.equal(joinedSettlementCalls, 1, 'later retry must be exactly idempotent');
  assert.equal(releaseCalls, 2);
  assert.equal(driver.log.read(physicalOwnerId)
    .filter((event) => event.kind === 'worktree.reaped').length, 1);
});

test('P92.2-PO2/WC32: internal post-add failure remains intact until capacity-first outer rollback', async (t) => {
  const f = fixture('internal-post-add-capacity-first', { projection: true });
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
    toolchainProjection: f.toolchainProjection,
  });
  write(f.toolchainProjection.sourceRoot, 'runtime/index.js',
    'module.exports = "drift-after-admission";\n');

  const release = driver.worktreeCapacity.release.bind(driver.worktreeCapacity);
  let releaseCalls = 0;
  let physicalOwnerId;
  let retainedReceipt;
  const assertCompleteTransaction = () => {
    const receipt = physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId);
    assert.ok(receipt, 'capacity settlement requires the common-Git owner receipt');
    retainedReceipt ??= receipt;
    assert.equal(receipt.receiptDigest, retainedReceipt.receiptDigest);
    assert.equal(existsSync(receipt.worktree), true);
    assert.notEqual(git(['branch', '--list', receipt.branch], f.repo), '');
    assert.equal(git(['worktree', 'list', '--porcelain'], f.repo).split('\n')
      .filter((line) => line.startsWith('worktree '))
      .some((line) => realpathSync(line.slice('worktree '.length))
        === realpathSync(receipt.worktree)), true);
    assert.deepEqual(driver.worktreeCapacity.snapshot().reservations.map((row) => row.resourceId), [
      physicalOwnerId,
    ]);
  };
  driver.worktreeCapacity.release = (token) => {
    releaseCalls += 1;
    physicalOwnerId ??= token.resourceId;
    assertCompleteTransaction();
    if (releaseCalls === 1) {
      throw Object.assign(new Error('post-add rollback settlement threw'), {
        code: 'worktree_capacity_unavailable',
      });
    }
    if (releaseCalls === 2) return false;
    const settled = release(token);
    assert.equal(settled, true);
    assert.equal(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId)?.receiptDigest,
      retainedReceipt.receiptDigest, 'capacity absence must precede receipt finalization');
    return settled;
  };

  await assert.rejects(driver.coordinator._worktrees.create(
    'internal-post-add-logical', f.sha, {
      runId: 'run-internal-post-add', attemptId: 'attempt-internal-post-add', processGeneration: 1,
    },
  ), (error) => error?.code === 'worktree_capacity_unavailable');
  assert.equal(releaseCalls, 1);
  assertCompleteTransaction();

  await assert.rejects(
    driver.coordinator._worktrees.remove('internal-post-add-logical'),
    (error) => error?.code === 'worktree_capacity_unavailable',
  );
  assert.equal(releaseCalls, 2);
  assertCompleteTransaction();

  await driver.coordinator._worktrees.remove('internal-post-add-logical');
  assert.equal(releaseCalls, 3);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId), null);
  assert.equal(existsSync(retainedReceipt.worktree), false);
  assert.equal(git(['branch', '--list', retainedReceipt.branch], f.repo), '');
  assert.equal(git(['worktree', 'list', '--porcelain'], f.repo).split('\n')
    .filter((line) => line.startsWith('worktree '))
    .some((line) => line.slice('worktree '.length) === retainedReceipt.worktree), false);
  assert.equal(driver.log.read(physicalOwnerId)
    .filter((event) => event.kind === 'worktree.reaped').length, 1);
  await driver.coordinator._worktrees.remove('internal-post-add-logical');
  assert.equal(releaseCalls, 3);
});

test('P92.2-PO2/WC33: single preflight refuses a retained failed-create transaction before allocation', async (t) => {
  const f = fixture('failed-create-single-preflight-gate');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  driver.worktreeCapacity.materialize = () => {
    throw Object.assign(new Error('retain failed create for single preflight'), {
      code: 'worktree_capacity_unavailable',
    });
  };
  const release = driver.worktreeCapacity.release.bind(driver.worktreeCapacity);
  let releaseCalls = 0;
  let physicalOwnerId;
  driver.worktreeCapacity.release = (token) => {
    releaseCalls += 1;
    physicalOwnerId ??= token.resourceId;
    if (releaseCalls === 1) {
      throw Object.assign(new Error('retain exact failed create'), {
        code: 'worktree_capacity_unavailable',
      });
    }
    return release(token);
  };
  await assert.rejects(driver.coordinator._worktrees.create(
    'single-preflight-gated', f.sha, {
      runId: 'run-single-preflight', attemptId: 'attempt-single-preflight', processGeneration: 1,
    },
  ));
  const receiptFilesBefore = readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners'));
  assert.throws(
    () => driver.coordinator._worktrees.reserveCapacity('single-preflight-gated', f.sha, {
      runId: 'run-single-preflight', attemptId: 'attempt-single-preflight', processGeneration: 1,
    }),
    (error) => error?.code === 'worktree_capacity_transaction_pending',
  );
  assert.equal(releaseCalls, 1);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations.map((row) => row.resourceId), [
    physicalOwnerId,
  ]);
  assert.deepEqual(readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners')),
    receiptFilesBefore);
  await driver.coordinator._worktrees.remove('single-preflight-gated');
});

test('P92.2-PO2/WC34: wave preflight refuses one retained failed member before any allocation', async (t) => {
  const f = fixture('failed-create-wave-preflight-gate');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  driver.worktreeCapacity.materialize = () => {
    throw Object.assign(new Error('retain failed create for wave preflight'), {
      code: 'worktree_capacity_unavailable',
    });
  };
  const release = driver.worktreeCapacity.release.bind(driver.worktreeCapacity);
  let releaseCalls = 0;
  let physicalOwnerId;
  driver.worktreeCapacity.release = (token) => {
    releaseCalls += 1;
    physicalOwnerId ??= token.resourceId;
    if (releaseCalls === 1) {
      throw Object.assign(new Error('retain exact failed wave member'), {
        code: 'worktree_capacity_unavailable',
      });
    }
    return release(token);
  };
  await assert.rejects(driver.coordinator._worktrees.create(
    'wave-preflight-gated', f.sha, {
      runId: 'run-wave-preflight', attemptId: 'attempt-wave-preflight', processGeneration: 1,
    },
  ));
  const receiptsBefore = readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners'));
  assert.throws(() => driver.coordinator._worktrees.reserveCapacityMany([
    {
      taskId: 'wave-preflight-gated', requestedBaseSha: f.sha,
      runId: 'run-wave-preflight', attemptId: 'attempt-wave-preflight', processGeneration: 1,
    },
    {
      taskId: 'wave-preflight-clean', requestedBaseSha: f.sha,
      runId: 'run-wave-preflight', attemptId: 'attempt-wave-clean', processGeneration: 1,
    },
  ]), (error) => error?.code === 'worktree_capacity_transaction_pending');
  assert.equal(releaseCalls, 1);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations.map((row) => row.resourceId), [
    physicalOwnerId,
  ]);
  assert.deepEqual(readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners')), receiptsBefore);
  await driver.coordinator._worktrees.remove('wave-preflight-gated');
});

test('P92.2-PO2/WC35: persist-then-throw single reserve retains receipt until exact settlement retry', async (t) => {
  const f = fixture('unknown-single-reservation-outcome');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const reserve = driver.worktreeCapacity.reserve.bind(driver.worktreeCapacity);
  let physicalOwnerId;
  driver.worktreeCapacity.reserve = (id, request) => {
    const reservation = reserve(id, request);
    physicalOwnerId = reservation.resourceId;
    throw Object.assign(new Error('single reservation response lost after persistence'), {
      code: 'injected_reservation_response_loss',
    });
  };
  const settle = driver.worktreeCapacity.settleForCleanup.bind(driver.worktreeCapacity);
  let settleCalls = 0;
  driver.worktreeCapacity.settleForCleanup = (id) => {
    settleCalls += 1;
    assert.equal(id, `worker:${physicalOwnerId}`);
    assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
    return settleCalls === 1 ? false : settle(id);
  };

  assert.throws(
    () => driver.coordinator._worktrees.reserveCapacity('unknown-single-reserve', f.sha, {
      runId: 'run-unknown-single', attemptId: 'attempt-unknown-single', processGeneration: 1,
    }),
    (error) => error?.code === 'worktree_capacity_unavailable'
      && error?.reservationError === 'injected_reservation_response_loss',
  );
  assert.equal(settleCalls, 1);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations.map((row) => row.resourceId), [
    physicalOwnerId,
  ]);
  assert.throws(
    () => driver.coordinator._worktrees.reserveCapacity('unknown-single-reserve', f.sha, {
      runId: 'run-unknown-single', attemptId: 'attempt-unknown-single', processGeneration: 1,
    }),
    (error) => error?.code === 'worktree_capacity_transaction_pending',
  );

  await driver.coordinator._worktrees.remove('unknown-single-reserve');
  assert.equal(settleCalls, 2);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId), null);
  driver.worktreeCapacity.reserve = reserve;
  const fresh = driver.coordinator._worktrees.reserveCapacity('unknown-single-reserve', f.sha, {
    runId: 'run-unknown-single', attemptId: 'attempt-unknown-single-fresh', processGeneration: 1,
  });
  assert.notEqual(fresh.ownerReceipt.physicalOwnerId, physicalOwnerId);
  assert.equal(driver.coordinator._worktrees.releaseCapacity('unknown-single-reserve'), true);
});

test('P92.2-PO2/WC36: persist-then-throw reserve wave retains every unknown physical outcome', async (t) => {
  const f = fixture('unknown-wave-reservation-outcome');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const reserveMany = driver.worktreeCapacity.reserveMany.bind(driver.worktreeCapacity);
  let physicalOwnerIds = [];
  driver.worktreeCapacity.reserveMany = (entries) => {
    const reservations = reserveMany(entries);
    physicalOwnerIds = reservations.map((row) => row.resourceId);
    throw Object.assign(new Error('wave reservation response lost after persistence'), {
      code: 'injected_wave_reservation_response_loss',
    });
  };
  const settle = driver.worktreeCapacity.settleForCleanup.bind(driver.worktreeCapacity);
  let settleCalls = 0;
  driver.worktreeCapacity.settleForCleanup = (id) => {
    settleCalls += 1;
    const physicalOwnerId = id.slice('worker:'.length);
    assert.ok(physicalOwnerIds.includes(physicalOwnerId));
    assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
    return settleCalls <= 2 ? false : settle(id);
  };
  const entries = ['a', 'b'].map((suffix) => ({
    taskId: `unknown-wave-${suffix}`, requestedBaseSha: f.sha,
    runId: 'run-unknown-wave', attemptId: `attempt-unknown-wave-${suffix}`, processGeneration: 1,
  }));

  assert.throws(
    () => driver.coordinator._worktrees.reserveCapacityMany(entries),
    (error) => error?.code === 'worktree_capacity_unavailable'
      && error?.reservationError === 'injected_wave_reservation_response_loss',
  );
  assert.equal(settleCalls, 2);
  assert.equal(physicalOwnerIds.length, 2);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations.map((row) => row.resourceId).sort(),
    [...physicalOwnerIds].sort());
  for (const physicalOwnerId of physicalOwnerIds) {
    assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
  }
  assert.throws(
    () => driver.coordinator._worktrees.reserveCapacityMany(entries),
    (error) => error?.code === 'worktree_capacity_transaction_pending',
  );

  await Promise.all(entries.map((entry) => driver.coordinator._worktrees.remove(entry.taskId)));
  assert.equal(settleCalls, 4);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  for (const physicalOwnerId of physicalOwnerIds) {
    assert.equal(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId), null);
  }
  driver.worktreeCapacity.reserveMany = reserveMany;
  const fresh = driver.coordinator._worktrees.reserveCapacityMany(entries.map((entry) => ({
    ...entry, attemptId: `${entry.attemptId}-fresh`,
  })));
  assert.equal(fresh.length, 2);
  assert.deepEqual(driver.coordinator._worktrees.releaseCapacityMany(
    entries.map((entry) => entry.taskId),
  ), [true, true]);
});

test('P92.2-PO2/WC37: direct create retains a persisted unknown reserve before exact retry', async (t) => {
  const f = fixture('unknown-direct-create-reservation-outcome');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const reserve = driver.worktreeCapacity.reserve.bind(driver.worktreeCapacity);
  let retainedOwnerId;
  driver.worktreeCapacity.reserve = (id, request) => {
    const reservation = reserve(id, request);
    retainedOwnerId = reservation.resourceId;
    throw Object.assign(new Error('direct-create reservation response lost after persistence'), {
      code: 'injected_direct_create_reservation_response_loss',
    });
  };
  const settle = driver.worktreeCapacity.settleForCleanup.bind(driver.worktreeCapacity);
  let settleCalls = 0;
  driver.worktreeCapacity.settleForCleanup = (id) => {
    settleCalls += 1;
    assert.equal(id, `worker:${retainedOwnerId}`);
    assert.ok(physicalWorkspaceOwnerReceipt(f.repo, retainedOwnerId));
    return settleCalls === 1 ? false : settle(id);
  };
  const binding = {
    runId: 'run-unknown-direct-create',
    attemptId: 'attempt-unknown-direct-create',
    processGeneration: 1,
  };

  await assert.rejects(
    driver.coordinator._worktrees.create('unknown-direct-create', f.sha, binding),
    (error) => error?.code === 'worktree_capacity_unavailable'
      && error?.reservationError === 'injected_direct_create_reservation_response_loss',
  );
  assert.equal(settleCalls, 1);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, retainedOwnerId));
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations.map((row) => row.resourceId), [
    retainedOwnerId,
  ]);
  assert.throws(
    () => driver.coordinator._worktrees.reserveCapacity('unknown-direct-create', f.sha, binding),
    (error) => error?.code === 'worktree_capacity_transaction_pending',
  );

  driver.worktreeCapacity.reserve = reserve;
  const replacement = await driver.coordinator._worktrees.create(
    'unknown-direct-create', f.sha, binding,
  );
  assert.equal(settleCalls, 2);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, retainedOwnerId), null);
  assert.notEqual(replacement.ownerTaskId, retainedOwnerId);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations.map((row) => row.resourceId), [
    replacement.ownerTaskId,
  ]);
  await driver.coordinator._worktrees.remove(replacement.ownerTaskId);
});

test('P92.2-PO2/WC38: duplicate successful wave preflight replays exact pending reservations', async (t) => {
  const f = fixture('duplicate-wave-preflight-replay');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const entries = ['a', 'b'].map((suffix) => ({
    taskId: `duplicate-wave-${suffix}`, requestedBaseSha: f.sha,
    runId: 'run-duplicate-wave', attemptId: `attempt-duplicate-wave-${suffix}`,
    processGeneration: 1,
  }));
  const first = driver.coordinator._worktrees.reserveCapacityMany(entries);
  const snapshotBefore = driver.worktreeCapacity.snapshot();
  const receiptsBefore = readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners'));
  const replay = driver.coordinator._worktrees.reserveCapacityMany(entries);
  assert.deepEqual(replay, first);
  assert.equal(replay[0], first[0]);
  assert.equal(replay[1], first[1]);
  assert.deepEqual(driver.worktreeCapacity.snapshot(), snapshotBefore);
  assert.deepEqual(readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners')), receiptsBefore);
  assert.deepEqual(driver.coordinator._worktrees.releaseCapacityMany(
    entries.map((entry) => entry.taskId),
  ), [true, true]);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  for (const row of first) {
    assert.equal(physicalWorkspaceOwnerReceipt(f.repo, row.ownerReceipt.physicalOwnerId), null);
  }
});

test('P92.2-PO2/WC39: mixed pending and new wave refuses atomically before owner allocation', async (t) => {
  const f = fixture('mixed-wave-preflight-refusal');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const pending = driver.coordinator._worktrees.reserveCapacity('mixed-wave-existing', f.sha, {
    runId: 'run-mixed-wave', attemptId: 'attempt-mixed-wave-existing', processGeneration: 1,
  });
  const snapshotBefore = driver.worktreeCapacity.snapshot();
  const receiptsBefore = readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners'));
  assert.throws(() => driver.coordinator._worktrees.reserveCapacityMany([
    {
      taskId: 'mixed-wave-existing', requestedBaseSha: f.sha,
      runId: 'run-mixed-wave', attemptId: 'attempt-mixed-wave-existing', processGeneration: 1,
    },
    {
      taskId: 'mixed-wave-new', requestedBaseSha: f.sha,
      runId: 'run-mixed-wave', attemptId: 'attempt-mixed-wave-new', processGeneration: 1,
    },
  ]), (error) => error?.code === 'worktree_capacity_reservation_conflict');
  assert.deepEqual(driver.worktreeCapacity.snapshot(), snapshotBefore);
  assert.deepEqual(readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners')), receiptsBefore);
  assert.equal(driver.coordinator._worktrees.releaseCapacity('mixed-wave-existing'), true);
  assert.equal(physicalWorkspaceOwnerReceipt(
    f.repo, pending.ownerReceipt.physicalOwnerId,
  ), null);
});

test('P92.2-PO2/WC40: mismatched-base wave refuses before replacing any pending member', async (t) => {
  const f = fixture('mismatched-base-wave-preflight-refusal');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const entries = ['a', 'b'].map((suffix) => ({
    taskId: `mismatched-wave-${suffix}`, requestedBaseSha: f.sha,
    runId: 'run-mismatched-wave', attemptId: `attempt-mismatched-wave-${suffix}`,
    processGeneration: 1,
  }));
  const pending = driver.coordinator._worktrees.reserveCapacityMany(entries);
  git(['commit', '--allow-empty', '-qm', 'new mismatched wave base'], f.repo);
  const differentSha = git(['rev-parse', 'HEAD'], f.repo);
  const snapshotBefore = driver.worktreeCapacity.snapshot();
  const receiptsBefore = readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners'));
  assert.throws(() => driver.coordinator._worktrees.reserveCapacityMany(entries.map(
    (entry, index) => ({ ...entry, requestedBaseSha: index === 0 ? differentSha : entry.requestedBaseSha }),
  )), (error) => error?.code === 'worktree_capacity_reservation_conflict');
  assert.deepEqual(driver.worktreeCapacity.snapshot(), snapshotBefore);
  assert.deepEqual(readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners')), receiptsBefore);
  assert.deepEqual(driver.coordinator._worktrees.releaseCapacityMany(
    entries.map((entry) => entry.taskId),
  ), [true, true]);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  for (const row of pending) {
    assert.equal(physicalWorkspaceOwnerReceipt(f.repo, row.ownerReceipt.physicalOwnerId), null);
  }
});

test('P92.2-PO2/WC41: single preflight replay requires the full immutable allocation binding', async (t) => {
  const f = fixture('single-pending-full-binding-replay');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const binding = {
    runId: 'run-single-binding', attemptId: 'attempt-single-binding', processGeneration: 3,
  };
  const first = driver.coordinator._worktrees.reserveCapacity(
    'single-binding-replay', f.sha, binding,
  );
  const snapshotBefore = driver.worktreeCapacity.snapshot();
  const receiptsBefore = readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners'));
  const replay = driver.coordinator._worktrees.reserveCapacity(
    'single-binding-replay', f.sha, binding,
  );
  assert.equal(replay, first);
  const mutations = [
    { ...binding, runId: 'run-single-binding-b' },
    { ...binding, attemptId: 'attempt-single-binding-b' },
    { ...binding, processGeneration: 4 },
  ];
  for (const candidate of mutations) {
    assert.throws(
      () => driver.coordinator._worktrees.reserveCapacity(
        'single-binding-replay', f.sha, candidate,
      ),
      (error) => error?.code === 'worktree_capacity_reservation_conflict',
    );
    assert.deepEqual(driver.worktreeCapacity.snapshot(), snapshotBefore);
    assert.deepEqual(readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners')),
      receiptsBefore);
  }
  assert.equal(driver.coordinator._worktrees.releaseCapacity('single-binding-replay'), true);
  assert.equal(physicalWorkspaceOwnerReceipt(
    f.repo, first.ownerReceipt.physicalOwnerId,
  ), null);
});

test('P92.2-PO2/WC42: create cannot consume pending capacity under another immutable binding', async (t) => {
  const f = fixture('create-pending-full-binding-refusal');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const binding = {
    runId: 'run-create-binding', attemptId: 'attempt-create-binding', processGeneration: 2,
  };
  const pending = driver.coordinator._worktrees.reserveCapacity(
    'create-binding-refusal', f.sha, binding,
  );
  const snapshotBefore = driver.worktreeCapacity.snapshot();
  const receiptsBefore = readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners'));
  await assert.rejects(
    driver.coordinator._worktrees.create('create-binding-refusal', f.sha, {
      ...binding, attemptId: 'attempt-create-binding-b',
    }),
    (error) => error?.code === 'worktree_capacity_reservation_conflict',
  );
  assert.deepEqual(driver.worktreeCapacity.snapshot(), snapshotBefore);
  assert.deepEqual(readdirSync(join(f.repo, '.git', 'baton', 'workspace-owners')), receiptsBefore);
  assert.equal(existsSync(pending.ownerReceipt.worktree), false);
  assert.equal(git(['branch', '--list', pending.ownerReceipt.branch], f.repo), '');

  const created = await driver.coordinator._worktrees.create(
    'create-binding-refusal', f.sha, binding,
  );
  assert.equal(created.ownerTaskId, pending.ownerReceipt.physicalOwnerId);
  assert.notEqual(created.ownerReceiptDigest, pending.ownerReceipt.receiptDigest,
    'the same allocation receipt advances from allocated to ready');
  assert.deepEqual({
    runId: created.ownerReceipt.runId,
    attemptId: created.ownerReceipt.attemptId,
    processGeneration: created.ownerReceipt.processGeneration,
  }, binding);
  await driver.coordinator._worktrees.remove(created.ownerTaskId);
});

test('P92.2-PO2/WC43: single pending cleanup latches capacity absence through receipt unlink failure', async (t) => {
  const f = fixture('single-pending-receipt-finalization');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const pending = driver.coordinator._worktrees.reserveCapacity('single-finalize', f.sha, {
    runId: 'run-single-finalize', attemptId: 'attempt-single-finalize', processGeneration: 1,
  });
  const receiptPath = canonicalMissingLeaf(join(
    f.repo, '.git', 'baton', 'workspace-owners', `${pending.ownerReceipt.physicalOwnerId}.json`,
  ));
  const originalRmSync = fs.rmSync;
  fs.rmSync = (target, ...args) => {
    if (target === receiptPath) throw Object.assign(new Error('injected receipt unlink failure'), {
      code: 'injected_receipt_unlink_failure',
    });
    return originalRmSync(target, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => driver.coordinator._worktrees.releaseCapacity('single-finalize'),
      (error) => error?.code === 'injected_receipt_unlink_failure',
    );
  } finally {
    fs.rmSync = originalRmSync;
    syncBuiltinESMExports();
  }
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, pending.ownerReceipt.physicalOwnerId));
  assert.throws(
    () => driver.coordinator._worktrees.reserveCapacity('single-finalize', f.sha, {
      runId: 'run-single-finalize', attemptId: 'attempt-single-finalize', processGeneration: 1,
    }),
    (error) => error?.code === 'worktree_capacity_transaction_pending',
  );
  assert.equal(driver.coordinator._worktrees.releaseCapacity('single-finalize'), true);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, pending.ownerReceipt.physicalOwnerId), null);
});

test('P92.2-PO2/WC44: releaseCapacityMany reports partial receipt finalization and retries exactly', async (t) => {
  const f = fixture('wave-pending-receipt-finalization');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const taskIds = ['wave-finalize-a', 'wave-finalize-b'];
  const pending = driver.coordinator._worktrees.reserveCapacityMany(taskIds.map((taskId) => ({
    taskId, requestedBaseSha: f.sha, runId: 'run-wave-finalize',
    attemptId: `attempt-${taskId}`, processGeneration: 1,
  })));
  const failedOwnerId = pending[1].ownerReceipt.physicalOwnerId;
  const failedReceiptPath = canonicalMissingLeaf(join(
    f.repo, '.git', 'baton', 'workspace-owners', `${failedOwnerId}.json`,
  ));
  const originalRmSync = fs.rmSync;
  fs.rmSync = (target, ...args) => {
    if (target === failedReceiptPath) throw new Error('injected wave receipt unlink failure');
    return originalRmSync(target, ...args);
  };
  syncBuiltinESMExports();
  let outcomes;
  try { outcomes = driver.coordinator._worktrees.releaseCapacityMany(taskIds); }
  finally {
    fs.rmSync = originalRmSync;
    syncBuiltinESMExports();
  }
  assert.deepEqual(outcomes, [true, false]);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(physicalWorkspaceOwnerReceipt(
    f.repo, pending[0].ownerReceipt.physicalOwnerId,
  ), null);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, failedOwnerId));
  assert.deepEqual(driver.coordinator._worktrees.releaseCapacityMany(taskIds), [false, true]);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, failedOwnerId), null);
});

test('P92.2-PO2/WC45: settleCapacityMany retains a partial receipt failure for exact retry', async (t) => {
  const f = fixture('settle-wave-receipt-finalization');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const taskIds = ['settle-finalize-a', 'settle-finalize-b'];
  const pending = driver.coordinator._worktrees.reserveCapacityMany(taskIds.map((taskId) => ({
    taskId, requestedBaseSha: f.sha, runId: 'run-settle-finalize',
    attemptId: `attempt-${taskId}`, processGeneration: 1,
  })));
  const failedOwnerId = pending[1].ownerReceipt.physicalOwnerId;
  const failedReceiptPath = canonicalMissingLeaf(join(
    f.repo, '.git', 'baton', 'workspace-owners', `${failedOwnerId}.json`,
  ));
  const originalRmSync = fs.rmSync;
  fs.rmSync = (target, ...args) => {
    if (target === failedReceiptPath) throw new Error('injected settled receipt unlink failure');
    return originalRmSync(target, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => driver.coordinator._worktrees.settleCapacityMany(taskIds),
      (error) => error?.code === 'worktree_cleanup_failed',
    );
  } finally {
    fs.rmSync = originalRmSync;
    syncBuiltinESMExports();
  }
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(physicalWorkspaceOwnerReceipt(
    f.repo, pending[0].ownerReceipt.physicalOwnerId,
  ), null);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, failedOwnerId));
  assert.deepEqual(driver.coordinator._worktrees.settleCapacityMany(taskIds), [true, true]);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, failedOwnerId), null);
});

test('P92.2-PO2/WC46: post-effect receipt unlink response loss is exact-idempotent', (t) => {
  const f = fixture('post-effect-receipt-unlink');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const binding = {
    runId: 'run-post-effect-unlink', attemptId: 'attempt-post-effect-unlink',
    processGeneration: 1,
  };
  const pending = driver.coordinator._worktrees.reserveCapacity(
    'post-effect-unlink', f.sha, binding,
  );
  const receiptPath = canonicalMissingLeaf(join(
    f.repo, '.git', 'baton', 'workspace-owners', `${pending.ownerReceipt.physicalOwnerId}.json`,
  ));
  const originalRmSync = fs.rmSync;
  let crossed = false;
  fs.rmSync = (target, ...args) => {
    if (!crossed && String(target) === receiptPath) {
      crossed = true;
      originalRmSync(target, ...args);
      throw Object.assign(new Error('injected post-effect receipt unlink response loss'), {
        code: 'injected_post_effect_receipt_unlink',
      });
    }
    return originalRmSync(target, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => driver.coordinator._worktrees.releaseCapacity('post-effect-unlink'),
      (error) => error?.code === 'injected_post_effect_receipt_unlink',
    );
  } finally {
    fs.rmSync = originalRmSync;
    syncBuiltinESMExports();
  }
  assert.equal(crossed, true);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, pending.ownerReceipt.physicalOwnerId), null);
  assert.equal(driver.coordinator._worktrees.releaseCapacity('post-effect-unlink'), true);
  const replacement = driver.coordinator._worktrees.reserveCapacity(
    'post-effect-unlink', f.sha, binding,
  );
  assert.notEqual(replacement.ownerReceipt.physicalOwnerId, pending.ownerReceipt.physicalOwnerId);
  assert.equal(driver.coordinator._worktrees.releaseCapacity('post-effect-unlink'), true);
});

test('P92.2-PO2/WC47: pending base mismatch retains its receipt-finalization latch', async (t) => {
  const f = fixture('pending-base-mismatch-unlink');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const binding = {
    runId: 'run-base-mismatch-unlink', attemptId: 'attempt-base-mismatch-unlink',
    processGeneration: 1,
  };
  const pending = driver.coordinator._worktrees.reserveCapacity(
    'base-mismatch-unlink', f.sha, binding,
  );
  write(f.repo, 'different-base.txt', 'different base\n');
  git(['add', 'different-base.txt'], f.repo);
  git(['commit', '-qm', 'different base'], f.repo);
  const differentSha = git(['rev-parse', 'HEAD'], f.repo);
  const receiptPath = canonicalMissingLeaf(join(
    f.repo, '.git', 'baton', 'workspace-owners', `${pending.ownerReceipt.physicalOwnerId}.json`,
  ));
  const originalRmSync = fs.rmSync;
  fs.rmSync = (target, ...args) => {
    if (String(target) === receiptPath) throw Object.assign(new Error('injected base mismatch unlink'), {
      code: 'injected_base_mismatch_unlink',
    });
    return originalRmSync(target, ...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      driver.coordinator._worktrees.create('base-mismatch-unlink', differentSha, binding),
      (error) => error?.code === 'injected_base_mismatch_unlink',
    );
  } finally {
    fs.rmSync = originalRmSync;
    syncBuiltinESMExports();
  }
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, pending.ownerReceipt.physicalOwnerId));
  await assert.rejects(
    driver.coordinator._worktrees.create('base-mismatch-unlink', differentSha, binding),
    (error) => error instanceof TypeError && /base SHA disagrees/u.test(error.message),
  );
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, pending.ownerReceipt.physicalOwnerId), null);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
});

test('P92.2-PO2/WC48: pending remove retains its receipt-finalization latch', async (t) => {
  const f = fixture('pending-remove-unlink');
  const injected = injectedCapacity();
  let driver;
  t.after(() => dispose(driver, f));
  driver = createDriver({
    repoRoot: f.repo, logDir: f.logDir, adapters: {}, worktreeCapacity: validPolicy,
    worktreeCapacityEstimate: injected.worktreeCapacityEstimate,
    worktreeCapacityObserve: injected.worktreeCapacityObserve,
  });
  const pending = driver.coordinator._worktrees.reserveCapacity('pending-remove-unlink', f.sha, {
    runId: 'run-pending-remove-unlink', attemptId: 'attempt-pending-remove-unlink',
    processGeneration: 1,
  });
  const receiptPath = canonicalMissingLeaf(join(
    f.repo, '.git', 'baton', 'workspace-owners', `${pending.ownerReceipt.physicalOwnerId}.json`,
  ));
  const originalRmSync = fs.rmSync;
  fs.rmSync = (target, ...args) => {
    if (String(target) === receiptPath) throw Object.assign(new Error('injected pending remove unlink'), {
      code: 'injected_pending_remove_unlink',
    });
    return originalRmSync(target, ...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      driver.coordinator._worktrees.remove('pending-remove-unlink'),
      (error) => error?.code === 'injected_pending_remove_unlink',
    );
  } finally {
    fs.rmSync = originalRmSync;
    syncBuiltinESMExports();
  }
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, pending.ownerReceipt.physicalOwnerId));
  await driver.coordinator._worktrees.remove('pending-remove-unlink');
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, pending.ownerReceipt.physicalOwnerId), null);
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations, []);
});
