import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createBrief, createDriver, inspectToolchainProjection, loadOrCreateWorktreeCapacityIntegrityKey,
  MockAdapter, WorktreeCapacityAuthority,
} from '../src/index.mjs';
import { sparseCheckoutIdentity } from '../src/worktree.mjs';

const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase59-${label}-`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      id: 'worker:capacity-estimate',
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
  assert.equal(driver.worktreeCapacity.snapshot().reservations.length, 1);
  await driver.coordinator.kill(first.id, 'phase59:test');
  await until(() => driver.worktreeCapacity.snapshot().reservations.length === 0, 'first reservation release');
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', 'capacity-release-first')), false);

  const second = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-release-second' });
  await until(() => driver.coordinator.list().find((row) => row.id === second.id)?.pendingQuestionId, 'replacement reserved worker');
  assert.equal(driver.worktreeCapacity.snapshot().reservations[0].id, 'worker:capacity-release-second');
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
  const collision = join(f.repo, '.baton', 'wt', 'capacity-create-failure');
  mkdirSync(collision, { recursive: true });

  const failed = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-create-failure' });
  await until(async () => {
    const result = await driver.coordinator.result(failed.id);
    return result.status === 'failed' ? result : null;
  }, 'failed worktree creation');
  await until(() => driver.worktreeCapacity.snapshot().reservations.length === 0, 'failed creation reservation release');
  rmSync(collision, { recursive: true, force: true });

  const replacement = await driver.coordinator.spawn('mock', brief(), { taskId: 'capacity-create-replacement' });
  await until(() => driver.coordinator.list().find((row) => row.id === replacement.id)?.pendingQuestionId, 'replacement after create failure');
  assert.equal(driver.worktreeCapacity.snapshot().reservations[0].id, 'worker:capacity-create-replacement');
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
  const workerPath = await until(() => first.coordinator.list().find((row) => row.id === handle.id)?.sessionContext?.worktree, 'stale reservation worktree');
  assert.equal(first.worktreeCapacity.snapshot().reservations.length, 1);

  git(['worktree', 'remove', '--force', workerPath], f.repo);
  git(['branch', '-D', 'baton/capacity-stale-replay'], f.repo);
  first.coordination.releaseWriterLease({ requireOwned: true });
  replay = createDriver({ ...options, adapters: {} });
  await replay.ready;

  assert.equal(replay.worktreeCapacity.snapshot().totals.bytes, 0);
  assert.equal(replay.worktreeCapacity.snapshot().totals.inodes, 0);
  assert.deepEqual(replay.worktreeCapacity.snapshot().reservations, []);
  assert.equal(existsSync(join(f.repo, '.baton', 'wt', 'capacity-stale-replay.meta.json')), false);
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
  assert.deepEqual(driver.worktreeCapacity.snapshot().reservations.map((row) => row.id), ['worker:capacity-verifier-owner']);
  await driver.coordinator._worktrees.remove('capacity-verifier-owner');
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
