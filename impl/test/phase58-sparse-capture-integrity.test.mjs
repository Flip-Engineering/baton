import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createDriver, inspectToolchainProjection } from '../src/index.mjs';
import {
  captureCommit, createFromBase, reap, sparseCheckoutIdentity,
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
  const world = mkdtempSync(join(tmpdir(), `baton-phase58-integrity-${label}-`));
  const repo = join(world, 'repo');
  try {
    mkdirSync(repo);
    git(['init', '-q'], repo);
    git(['config', 'user.name', 'Baton Phase 58 Integrity'], repo);
    git(['config', 'user.email', 'phase58-integrity@example.invalid'], repo);
    write(repo, 'README.md', '# sparse integrity fixture\n');
    write(repo, 'src/main.js', 'export const value = 1;\n');
    write(repo, 'src/nested/helper.js', 'export const helper = true;\n');
    write(repo, 'docs/guide.md', '# private guide\n');
    write(repo, 'fixtures/history.bin', 'retained historical fixture\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'phase58 sparse integrity base'], repo);
    return { world, repo, baseSha: git(['rev-parse', 'HEAD'], repo) };
  } catch (error) {
    rmSync(world, { recursive: true, force: true });
    throw error;
  }
}

function eventLog() {
  const events = [];
  return { events, log: { append(event) { events.push(event); return event; } } };
}

function metadataPath(repo, taskId) {
  return join(repo, '.baton', 'wt', `${taskId}.meta.json`);
}

function readMetadata(repo, taskId) {
  return JSON.parse(readFileSync(metadataPath(repo, taskId), 'utf8'));
}

function writeMetadata(repo, taskId, value) {
  writeFileSync(metadataPath(repo, taskId), JSON.stringify(value, null, 2));
}

function codeIs(expected) {
  return (error) => error?.code === expected;
}

async function expectCaptureRefusal({ repo, taskId, worktree, expectedCode, log }) {
  const before = git(['rev-parse', 'HEAD'], worktree);
  await assert.rejects(
    () => captureCommit(repo, taskId, { vendor: 'adversary', model: 'fixture-model', effort: 'low', log }),
    codeIs(expectedCode),
  );
  assert.equal(git(['rev-parse', 'HEAD'], worktree), before, 'capture refusal must not create a commit');
}

async function cleanupWorker(repo, taskId) {
  try { await reap(repo, taskId, { force: true, deleteBranch: true }); } catch { /* fixture root is removed below */ }
}

const liveProjectionAttacks = [
  {
    label: 'broadened sparse specification',
    attack(worktree) {
      git(['sparse-checkout', 'set', '--no-cone', '--stdin'], worktree, { input: '/src\n/docs\n' });
      writeFileSync(join(worktree, 'docs/guide.md'), '# adversarial edit after broadening\n');
    },
  },
  {
    label: 'disabled sparse checkout',
    attack(worktree) {
      git(['sparse-checkout', 'disable'], worktree);
      writeFileSync(join(worktree, 'docs/guide.md'), '# adversarial edit after disabling\n');
    },
  },
];

for (const scenario of liveProjectionAttacks) {
  test(`SP7: capture fails closed after a worker installs a ${scenario.label}`, async (t) => {
    const { world, repo, baseSha } = fixture(`projection-${scenario.label.replaceAll(' ', '-')}`);
    const taskId = `projection-${scenario.label.replaceAll(' ', '-')}`;
    const { events, log } = eventLog();
    const handle = await createFromBase(repo, taskId, baseSha, { sparsePaths: ['src'], log });
    t.after(async () => { await cleanupWorker(repo, taskId); rmSync(world, { recursive: true, force: true }); });

    writeFileSync(join(handle.dir, 'src/main.js'), 'export const value = 2;\n');
    scenario.attack(handle.dir);

    await expectCaptureRefusal({
      repo, taskId, worktree: handle.dir, expectedCode: 'worker_sparse_projection_changed', log,
    });
    assert.equal(events.some((event) => event.kind === 'worktree.captured'), false);
  });
}

const metadataAttacks = [
  {
    label: 'missing metadata file',
    attack(repo, taskId) { rmSync(metadataPath(repo, taskId)); },
  },
  {
    label: 'truncated metadata document',
    attack(repo, taskId) { writeFileSync(metadataPath(repo, taskId), '{"taskId":'); },
  },
  {
    label: 'metadata document with its sparse identity omitted',
    attack(repo, taskId) {
      const metadata = readMetadata(repo, taskId);
      delete metadata.sparsePaths;
      writeMetadata(repo, taskId, metadata);
    },
  },
  {
    label: 'forged full-checkout identity',
    attack(repo, taskId) { writeMetadata(repo, taskId, { ...readMetadata(repo, taskId), sparsePaths: [] }); },
  },
  {
    label: 'substituted sparse path identity',
    attack(repo, taskId) { writeMetadata(repo, taskId, { ...readMetadata(repo, taskId), sparsePaths: ['docs'] }); },
  },
];

for (const scenario of metadataAttacks) {
  test(`SP8: capture refuses a ${scenario.label} before committing selected edits`, async (t) => {
    const { world, repo, baseSha } = fixture(`metadata-${scenario.label.replaceAll(' ', '-')}`);
    const taskId = `metadata-${scenario.label.replaceAll(' ', '-')}`;
    const { events, log } = eventLog();
    const handle = await createFromBase(repo, taskId, baseSha, { sparsePaths: ['src'], log });
    t.after(async () => { await cleanupWorker(repo, taskId); rmSync(world, { recursive: true, force: true }); });

    writeFileSync(join(handle.dir, 'src/main.js'), 'export const value = 3;\n');
    scenario.attack(repo, taskId);

    await expectCaptureRefusal({
      repo, taskId, worktree: handle.dir, expectedCode: 'worker_sparse_metadata_invalid', log,
    });
    assert.equal(events.some((event) => event.kind === 'worktree.captured'), false);
  });
}

function stageBlob(worktree, path, content) {
  const blob = git(['hash-object', '-w', '--stdin'], worktree, { input: content });
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], worktree);
}

const hiddenIndexAttacks = [
  {
    label: 'deletion of an unmaterialized tracked path',
    attack(worktree) { git(['update-index', '--force-remove', 'docs/guide.md'], worktree); },
    expectedPath: 'docs/guide.md',
  },
  {
    label: 'addition below an unmaterialized directory',
    attack(worktree) { stageBlob(worktree, 'docs/injected.md', 'injected outside sparse authority\n'); },
    expectedPath: 'docs/injected.md',
  },
  {
    label: 'path-prefix collision beside an allowed directory',
    attack(worktree) { stageBlob(worktree, 'src-escape/injected.js', 'export const escaped = true;\n'); },
    expectedPath: 'src-escape/injected.js',
  },
];

for (const scenario of hiddenIndexAttacks) {
  test(`SP9: capture rejects a staged ${scenario.label} hidden from the sparse filesystem`, async (t) => {
    const { world, repo, baseSha } = fixture(`index-${scenario.label.replaceAll(' ', '-')}`);
    const taskId = `index-${scenario.label.replaceAll(' ', '-')}`;
    const { events, log } = eventLog();
    const handle = await createFromBase(repo, taskId, baseSha, { sparsePaths: ['src'], log });
    t.after(async () => { await cleanupWorker(repo, taskId); rmSync(world, { recursive: true, force: true }); });

    writeFileSync(join(handle.dir, 'src/main.js'), 'export const value = 4;\n');
    scenario.attack(handle.dir);
    assert.equal(
      git(['diff', '--cached', '--name-only', baseSha], handle.dir).split('\n').includes(scenario.expectedPath),
      true,
      'the real Git diff presented to capture must contain the hidden index attack',
    );

    await expectCaptureRefusal({
      repo, taskId, worktree: handle.dir, expectedCode: 'worker_sparse_scope_violation', log,
    });
    assert.equal(events.some((event) => event.kind === 'worktree.captured'), false);
  });
}

function sessionContext(repo, taskId, handle) {
  return {
    worktree: handle.path,
    repoRoot: repo,
    baseSha: handle.baseSha,
    branch: handle.branch,
    ownerTaskId: taskId,
    sparsePaths: [...handle.sparsePaths],
  };
}

function driverFixture(label, repo, workerSparsePaths) {
  const logDir = mkdtempSync(join(tmpdir(), `baton-phase58-driver-${label}-`));
  const driver = createDriver({ repoRoot: repo, logDir, adapters: {}, workerSparsePaths });
  return { driver, logDir };
}

test('SP10: matching deployment, session, metadata, and live Git sparse identities remain resumable', async (t) => {
  const { world, repo, baseSha } = fixture('resume-green');
  const taskId = 'resume-green';
  const { driver, logDir } = driverFixture('resume-green', repo, ['src']);
  let handle;
  t.after(async () => {
    if (handle) await cleanupWorker(repo, taskId);
    try { driver.close(); } catch { /* evidence root cleanup below remains */ }
    rmSync(logDir, { recursive: true, force: true });
    rmSync(world, { recursive: true, force: true });
  });

  handle = await driver.coordinator._worktrees.create(taskId, baseSha);
  const verdict = await driver.coordinator._worktrees.validateSessionContext(sessionContext(repo, taskId, handle));
  assert.deepEqual(verdict, { ok: true });
});

const resumedContextAttacks = [
  {
    label: 'replayed context with its sparse identity omitted',
    mutate(context) { delete context.sparsePaths; },
  },
  {
    label: 'substituted replayed sparse identity',
    mutate(context) { context.sparsePaths = ['docs']; },
  },
];

for (const scenario of resumedContextAttacks) {
  test(`SP10: native resume rejects a ${scenario.label}`, async (t) => {
    const { world, repo, baseSha } = fixture(`resume-${scenario.label.replaceAll(' ', '-')}`);
    const taskId = `resume-${scenario.label.replaceAll(' ', '-')}`;
    const { driver, logDir } = driverFixture(taskId, repo, ['src']);
    let handle;
    t.after(async () => {
      if (handle) await cleanupWorker(repo, taskId);
      try { driver.close(); } catch { /* evidence root cleanup below remains */ }
      rmSync(logDir, { recursive: true, force: true });
      rmSync(world, { recursive: true, force: true });
    });

    handle = await driver.coordinator._worktrees.create(taskId, baseSha);
    const context = sessionContext(repo, taskId, handle);
    scenario.mutate(context);

    const verdict = await driver.coordinator._worktrees.validateSessionContext(context);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /sparse/i);
    await assert.rejects(() => driver.coordinator._validateSessionContext(context), codeIs('session_context_mismatch'));
  });
}

test('SP10: native resume rejects a checkout created under a different deployment sparse policy', async (t) => {
  const { world, repo, baseSha } = fixture('resume-policy-change');
  const taskId = 'resume-policy-change';
  // Both managers start before the worker exists, so neither startup reconciliation can erase
  // the attack fixture. The second manager then observes a real checkout owned by the first.
  const source = driverFixture('resume-source', repo, ['src']);
  const changed = driverFixture('resume-changed', repo, ['docs']);
  let handle;
  t.after(async () => {
    if (handle) await cleanupWorker(repo, taskId);
    for (const item of [source, changed]) {
      try { item.driver.close(); } catch { /* evidence root cleanup below remains */ }
      rmSync(item.logDir, { recursive: true, force: true });
    }
    rmSync(world, { recursive: true, force: true });
  });

  handle = await source.driver.coordinator._worktrees.create(taskId, baseSha);
  const context = sessionContext(repo, taskId, handle);
  const verdict = await changed.driver.coordinator._worktrees.validateSessionContext(context);

  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /sparse/i);
  await assert.rejects(() => changed.driver.coordinator._validateSessionContext(context), codeIs('session_context_mismatch'));
});

const reconcileAttacks = [
  {
    label: 'deployment sparse policy changed',
    sourcePolicy: ['src'],
    reconcilePolicy: ['docs'],
    mutate() {},
  },
  {
    label: 'durable sparse metadata was substituted',
    sourcePolicy: ['src'],
    reconcilePolicy: ['src'],
    mutate(repo, taskId) {
      writeMetadata(repo, taskId, { ...readMetadata(repo, taskId), sparsePaths: ['docs'] });
    },
  },
  {
    label: 'live sparse checkout was disabled',
    sourcePolicy: ['src'],
    reconcilePolicy: ['src'],
    mutate(_repo, _taskId, worktree) { git(['sparse-checkout', 'disable'], worktree); },
  },
];

for (const scenario of reconcileAttacks) {
  test(`SP11: reconciliation reaps an expected active worker when ${scenario.label}`, async (t) => {
    const { world, repo, baseSha } = fixture(`reconcile-${scenario.label.replaceAll(' ', '-')}`);
    const taskId = `reconcile-${scenario.label.replaceAll(' ', '-')}`;
    const source = driverFixture(`${taskId}-source`, repo, scenario.sourcePolicy);
    const reconciler = driverFixture(`${taskId}-reconciler`, repo, scenario.reconcilePolicy);
    let handle;
    t.after(async () => {
      if (handle && existsSync(handle.path)) await cleanupWorker(repo, taskId);
      for (const item of [source, reconciler]) {
        try { item.driver.close(); } catch { /* evidence root cleanup below remains */ }
        rmSync(item.logDir, { recursive: true, force: true });
      }
      rmSync(world, { recursive: true, force: true });
    });

    handle = await source.driver.coordinator._worktrees.create(taskId, baseSha);
    scenario.mutate(repo, taskId, handle.path);
    const report = await reconciler.driver.coordinator._worktrees.reconcile([taskId]);

    assert.deepEqual(report.errors, []);
    assert.equal(report.removedZombieDirs.includes(handle.path), true);
    assert.equal(existsSync(handle.path), false);
    assert.equal(existsSync(metadataPath(repo, taskId)), false);
    assert.equal(git(['branch', '--list', `baton/${taskId}`], repo), '');
  });
}

function nativeResumeProbe() {
  let resolveFirstSpawn;
  const firstSpawn = new Promise((resolve) => { resolveFirstSpawn = resolve; });
  const calls = { spawn: 0, records: [] };
  const adapter = {
    calls,
    firstSpawn,
    callback: null,
    onEvent(callback) { this.callback = callback; },
    emit(worker, kind, payload = {}, turnEpoch = 1) {
      this.callback?.({ worker, harness: 'phase58-resume-probe', actor: 'worker', kind, payload, turnEpoch });
    },
    card: () => ({
      harness: 'phase58-resume-probe', version: '1', authPosture: 'none', concurrencyCeiling: 2, maxContext: 10_000,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      modelSelection: {
        mode: 'exact', family: 'phase58-probe', configuredDefault: 'phase58-probe-model', available: ['phase58-probe-model'],
        acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: ['low'], configuredEffort: 'low', serviceTier: null,
      },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'unsupported' },
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: 'phase58-probe-total', terminalSeal: 'native' },
        providerCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        toolCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        maxWireFrameBytes: 1024 * 1024,
      },
    }),
    async spawn(worker, _brief, opts) {
      calls.spawn += 1;
      const ready = await opts.worktreeReady;
      const record = { worker, ready, session: opts.session };
      calls.records.push(record);
      resolveFirstSpawn(record);
      this.emit(worker, 'lifecycle.spawned', { sessionId: opts.session.id, pid: 58 });
      return { ok: true };
    },
    async prompt() { return { ok: true }; },
    async interrupt(worker) {
      queueMicrotask(() => this.emit(worker, 'control.interrupt_confirmed', {
        usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
      }));
      return { ok: true };
    },
    async kill(worker) {
      queueMicrotask(() => this.emit(worker, 'kill.confirmed', {
        usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
      }));
      return { ok: true };
    },
    async approve() { return { ok: true }; },
    async answer() { return { ok: true }; },
  };
  return adapter;
}

function bounded(promise, label, timeoutMs = 3_000) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs); }),
  ]).finally(() => clearTimeout(timeout));
}

function resumeProjection(world) {
  const sourceRoot = join(world, 'resume-toolchain');
  write(sourceRoot, 'runtime/index.mjs', 'export const resumed = true;\n');
  const config = {
    schemaVersion: 1,
    sourceRoot,
    sourceId: 'phase58-resume-toolchain',
    mappings: [{ sourcePath: 'runtime', targetPath: 'tools/resume-runtime' }],
    limits: {
      maxMappings: 2, maxFiles: 8, maxDirectories: 8, maxBytes: 32 * 1024,
      maxFileBytes: 16 * 1024, maxPathBytes: 256, maxDepth: 8,
    },
  };
  const identity = inspectToolchainProjection(config);
  return { config: { ...config, expectedManifestDigest: identity.manifestDigest }, identity };
}

test('SP12: createDriver native resume borrows one sparse projected worktree and refuses either identity substitution before adapter spawn', async (t) => {
  const { world, repo, baseSha } = fixture('coordinator-resume-projection');
  const logDir = join(world, 'driver-log');
  const { config, identity: toolchainProjection } = resumeProjection(world);
  const adapter = nativeResumeProbe();
  const driver = createDriver({
    repoRoot: repo,
    logDir,
    adapters: { probe: adapter },
    workerSparsePaths: ['src'],
    toolchainProjection: config,
    stopDeadlineMs: 1_000,
  });
  const ownerTaskId = 'resume-projection-owner';
  driver.coordination.createTask({
    id: ownerTaskId,
    brief: {
      goal: 'own the sparse projected session context', constraints: [], pathScope: ['src/**'],
      definitionOfDone: 'the context is owned durably',
      verification: { command: 'true', expectExit: 0 },
      budget: { tokens: 100, usd: 1, wallMin: 1 },
    },
    deps: [], refines: null, runId: null, taskType: 'general',
    reservedWorkerId: 'resume-projection-owner-worker',
  }, { actor: 'orchestrator', key: 'task.created:resume-projection-owner' });
  let owned;
  let resumed;
  t.after(async () => {
    if (resumed) await driver.coordinator.kill(resumed.id, 'test').catch(() => {});
    if (owned?.path && existsSync(owned.path)) await driver.coordinator._worktrees.remove(ownerTaskId).catch(() => {});
    try { driver.close(); } catch { /* owned fixture root cleanup below remains */ }
    rmSync(world, { recursive: true, force: true });
  });

  owned = await driver.coordinator._worktrees.create(ownerTaskId, baseSha);
  const context = {
    worktree: owned.path,
    repoRoot: repo,
    baseSha: owned.baseSha,
    branch: owned.branch,
    ownerTaskId,
    sparsePaths: [...owned.sparsePaths],
    sparseCheckoutIdentity: owned.sparseCheckoutIdentity,
    toolchainProjection: owned.toolchainProjection,
  };
  assert.deepEqual(context.sparseCheckoutIdentity, sparseCheckoutIdentity(['src']));
  assert.deepEqual(context.toolchainProjection, toolchainProjection);
  assert.equal(existsSync(join(owned.path, 'tools/resume-runtime/index.mjs')), true);

  const manager = driver.coordinator._worktrees;
  const originalCreate = manager.create.bind(manager);
  let unexpectedCreates = 0;
  manager.create = async (...args) => { unexpectedCreates += 1; return originalCreate(...args); };
  const beforeWorktrees = git(['worktree', 'list', '--porcelain'], repo).split('\n').filter((line) => line.startsWith('worktree '));

  resumed = await driver.coordinator.spawn('probe', {
    goal: 'resume the exact sparse projected worker',
    constraints: [],
    pathScope: ['src/**'],
    definitionOfDone: 'the native harness receives the admitted checkout',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100, usd: 1, wallMin: 1 },
  }, {
    taskId: 'resume-projection-borrower',
    refines: ownerTaskId,
    session: { mode: 'resume', id: 'phase58-native-session', context },
  });
  const spawn = await bounded(adapter.firstSpawn, 'native resume probe');
  const afterWorktrees = git(['worktree', 'list', '--porcelain'], repo).split('\n').filter((line) => line.startsWith('worktree '));
  const ready = driver.log.read(resumed.id).find((event) => event.kind === 'worktree.ready');
  const live = driver.coordinator.list().find((row) => row.id === resumed.id)?.sessionContext;

  assert.equal(unexpectedCreates, 0);
  assert.deepEqual(afterWorktrees, beforeWorktrees);
  assert.equal(spawn.ready.path, owned.path);
  assert.equal(spawn.session.context.worktree, owned.path);
  assert.deepEqual(spawn.session.context.sparseCheckoutIdentity, owned.sparseCheckoutIdentity);
  assert.deepEqual(spawn.session.context.toolchainProjection, toolchainProjection);
  assert.deepEqual(ready?.payload?.sparseCheckoutIdentity, owned.sparseCheckoutIdentity);
  assert.deepEqual(ready?.payload?.toolchainProjection, toolchainProjection);
  assert.deepEqual(live?.sparseCheckoutIdentity, owned.sparseCheckoutIdentity);
  assert.deepEqual(live?.toolchainProjection, toolchainProjection);

  const substitutedSparse = sparseCheckoutIdentity(['docs']);
  await assert.rejects(() => driver.coordinator.spawn('probe', {
    goal: 'must refuse substituted sparse identity', constraints: [], pathScope: ['docs/**'], definitionOfDone: 'refused',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 100, usd: 1, wallMin: 1 },
  }, {
    taskId: 'resume-substituted-sparse', refines: ownerTaskId,
    session: {
      mode: 'resume', id: 'phase58-tampered-sparse',
      context: { ...context, sparsePaths: ['docs'], sparseCheckoutIdentity: substitutedSparse },
    },
  }), (error) => error?.code === 'session_context_mismatch');

  await assert.rejects(() => driver.coordinator.spawn('probe', {
    goal: 'must refuse substituted toolchain identity', constraints: [], pathScope: ['src/**'], definitionOfDone: 'refused',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 100, usd: 1, wallMin: 1 },
  }, {
    taskId: 'resume-substituted-toolchain', refines: ownerTaskId,
    session: {
      mode: 'resume', id: 'phase58-tampered-toolchain',
      context: {
        ...context,
        toolchainProjection: { ...context.toolchainProjection, projectionDigest: '0'.repeat(64) },
      },
    },
  }), (error) => error?.code === 'session_context_mismatch');

  assert.equal(adapter.calls.spawn, 1);
  assert.equal(unexpectedCreates, 0);
  assert.equal(driver.coordinator.list().length, 1);
  assert.deepEqual(
    git(['worktree', 'list', '--porcelain'], repo).split('\n').filter((line) => line.startsWith('worktree ')),
    beforeWorktrees,
  );
});
