import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createDriver, inspectToolchainProjection, MockAdapter, prepareToolchainProjection,
  ToolchainProjectionError,
} from '../src/index.mjs';
import { createBrief } from '../src/messages.mjs';
import { captureCommit, createFromBase, freshVerifySandbox, reap } from '../src/worktree.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sh(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
}

function root(label) { return mkdtempSync(join(tmpdir(), `baton-phase55-${label}-`)); }

function makeRepo() {
  const repo = root('repo');
  sh('git', ['init', '-q'], repo);
  sh('git', ['config', 'user.name', 'Baton Test'], repo);
  sh('git', ['config', 'user.email', 'baton@example.test'], repo);
  writeFileSync(join(repo, 'README.md'), '# target\n');
  sh('git', ['add', '-A'], repo);
  sh('git', ['commit', '-q', '-m', 'base'], repo);
  return { repo, sha: sh('git', ['rev-parse', 'HEAD'], repo) };
}

function write(rootDir, path, bytes, mode = null) {
  const target = join(rootDir, path); mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes); if (mode !== null) chmodSync(target, mode);
  return target;
}

function makeSource(label = 'source') {
  const sourceRoot = root(label);
  write(sourceRoot, 'deps/runtime/index.mjs', 'export const value = 1;\n');
  write(sourceRoot, 'deps/runtime/bin/run', '#!/bin/sh\nexit 0\n', 0o755);
  mkdirSync(join(sourceRoot, 'deps', 'runtime', 'empty'), { recursive: true });
  return sourceRoot;
}

const limits = Object.freeze({
  maxMappings: 8,
  maxFiles: 128,
  maxDirectories: 128,
  maxBytes: 1024 * 1024,
  maxFileBytes: 256 * 1024,
  maxPathBytes: 512,
  maxDepth: 32,
});

function descriptor(sourceRoot, overrides = {}) {
  return {
    schemaVersion: 1,
    sourceRoot,
    sourceId: 'baton-test-toolchain',
    mappings: [{ sourcePath: 'deps/runtime', targetPath: 'tools/runtime' }],
    limits: { ...limits },
    ...overrides,
  };
}

function prepared(sourceRoot, overrides = {}) {
  const config = descriptor(sourceRoot, overrides);
  const identity = inspectToolchainProjection(config);
  return prepareToolchainProjection({ ...config, expectedManifestDigest: identity.manifestDigest });
}

async function until(fn, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn(); if (value) return value; await sleep(10);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(goal = 'phase55 projection') {
  return createBrief({
    goal, constraints: [], pathScope: ['result.txt'], definitionOfDone: 'the result and projected tool both work',
    verification: { command: 'node tools/runtime/index.mjs && test -s result.txt', expectExit: 0, timeoutMs: 5000 },
    budget: { tokens: 1000, usd: 1, wallMin: 1 },
  });
}

test('TP1/TP2: manifest identity is deterministic, relocation-stable, mapping-bound, and host-path-free', (t) => {
  const a = makeSource('identity-a'); const b = makeSource('identity-b');
  t.after(() => { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); });
  const first = inspectToolchainProjection(descriptor(a));
  const repeated = inspectToolchainProjection(descriptor(a));
  const relocated = inspectToolchainProjection(descriptor(b));
  assert.deepEqual(first, repeated); assert.deepEqual(first, relocated);
  assert.deepEqual(Object.keys(first).sort(), ['byteCount', 'directoryAccountingVersion', 'directoryCount', 'fileCount', 'limits', 'manifestDigest', 'mappingCount', 'projectionDigest', 'schemaVersion', 'sourceId', 'targetParentDirectoryCount', 'targetParentDirectoryDigest'].sort());
  assert.equal(first.directoryAccountingVersion, 2);
  assert.equal(JSON.stringify(first).includes(a), false); assert.equal(JSON.stringify(first).includes(b), false);
  const remapped = inspectToolchainProjection(descriptor(a, { mappings: [{ sourcePath: 'deps/runtime', targetPath: 'vendor/runtime' }] }));
  assert.equal(remapped.manifestDigest, first.manifestDigest); assert.notEqual(remapped.projectionDigest, first.projectionDigest);
  write(a, 'deps/runtime/index.mjs', 'export const value = 2;\n');
  assert.notEqual(inspectToolchainProjection(descriptor(a)).manifestDigest, first.manifestDigest);
});

test('TP1/TP2/TP11: invalid configuration, unsafe mappings, links, hardlinks, privileged files, and special files fail closed', (t) => {
  const source = makeSource('invalid'); t.after(() => rmSync(source, { recursive: true, force: true }));
  const invalid = (config, code = 'toolchain_projection_invalid') => assert.throws(
    () => inspectToolchainProjection(config),
    (error) => error instanceof ToolchainProjectionError && error.code === code && !String(error.message).includes(source),
  );
  invalid({ ...descriptor(source), unknown: true });
  invalid(descriptor(source, { sourceId: '../private' }));
  invalid(descriptor(source, { mappings: [{ sourcePath: '../deps', targetPath: 'tools/runtime' }] }));
  invalid(descriptor(source, { mappings: [{ sourcePath: 'deps/runtime', targetPath: '.git/private' }] }));
  invalid(descriptor(source, { mappings: [
    { sourcePath: 'deps', targetPath: 'tools' }, { sourcePath: 'deps/runtime', targetPath: 'vendor' },
  ] }));
  invalid(descriptor(source, { mappings: [
    { sourcePath: 'deps/runtime', targetPath: 'tools' }, { sourcePath: 'other', targetPath: 'tools/nested' },
  ] }));

  symlinkSync('/private/phase55-canary', join(source, 'deps', 'runtime', 'escape'));
  invalid(descriptor(source)); rmSync(join(source, 'deps', 'runtime', 'escape'));
  linkSync(join(source, 'deps', 'runtime', 'index.mjs'), join(source, 'deps', 'runtime', 'alias.mjs'));
  invalid(descriptor(source)); rmSync(join(source, 'deps', 'runtime', 'alias.mjs'));
  chmodSync(join(source, 'deps', 'runtime', 'index.mjs'), 0o4755);
  invalid(descriptor(source)); chmodSync(join(source, 'deps', 'runtime', 'index.mjs'), 0o644);
  const fifo = join(source, 'deps', 'runtime', 'pipe'); sh('mkfifo', [fifo], source);
  invalid(descriptor(source)); rmSync(fifo);

  const identity = inspectToolchainProjection(descriptor(source));
  invalid({ ...descriptor(source), expectedManifestDigest: '0'.repeat(64) });
  assert.throws(
    () => prepareToolchainProjection({ ...descriptor(source), expectedManifestDigest: '0'.repeat(64) }),
    (error) => error.code === 'toolchain_projection_changed',
  );
  assert.doesNotThrow(() => prepareToolchainProjection({ ...descriptor(source), expectedManifestDigest: identity.manifestDigest }));
});

test('TP3: every independent deployment ceiling accepts exact input and refuses max+1 without truncation', (t) => {
  const roots = []; t.after(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const expectBound = (sourceRoot, mappings, exact, exceeded) => {
    assert.doesNotThrow(() => inspectToolchainProjection(descriptor(sourceRoot, { mappings, limits: exact })));
    assert.throws(
      () => inspectToolchainProjection(descriptor(sourceRoot, { mappings, limits: exceeded })),
      (error) => error instanceof ToolchainProjectionError && error.code === 'toolchain_projection_oversize',
    );
  };

  let source = root('bound-mappings'); roots.push(source); write(source, 'a/f', 'a'); write(source, 'b/f', 'b');
  expectBound(source, [{ sourcePath: 'a', targetPath: 'x' }, { sourcePath: 'b', targetPath: 'y' }],
    { ...limits, maxMappings: 2 }, { ...limits, maxMappings: 1 });

  source = root('bound-files'); roots.push(source); write(source, 'a/1', ''); write(source, 'a/2', '');
  expectBound(source, [{ sourcePath: 'a', targetPath: 'x' }], { ...limits, maxFiles: 2 }, { ...limits, maxFiles: 1 });

  source = root('bound-directories'); roots.push(source); mkdirSync(join(source, 'a', 'b'), { recursive: true });
  expectBound(source, [{ sourcePath: 'a', targetPath: 'x' }], { ...limits, maxDirectories: 2 }, { ...limits, maxDirectories: 1 });

  source = root('bound-bytes'); roots.push(source); write(source, 'a/1', '12'); write(source, 'a/2', '3');
  expectBound(source, [{ sourcePath: 'a', targetPath: 'x' }], { ...limits, maxBytes: 3, maxFileBytes: 2 }, { ...limits, maxBytes: 2, maxFileBytes: 2 });

  source = root('bound-file-bytes'); roots.push(source); write(source, 'a/1', '12');
  expectBound(source, [{ sourcePath: 'a', targetPath: 'x' }], { ...limits, maxBytes: 2, maxFileBytes: 2 }, { ...limits, maxFileBytes: 1 });

  source = root('bound-path'); roots.push(source); write(source, 'a/éé', 'x');
  expectBound(source, [{ sourcePath: 'a', targetPath: 'x' }], { ...limits, maxPathBytes: 6 }, { ...limits, maxPathBytes: 5 });

  source = root('bound-depth'); roots.push(source); write(source, 'a/b/c', 'x');
  expectBound(source, [{ sourcePath: 'a', targetPath: 'x' }], { ...limits, maxDepth: 2 }, { ...limits, maxDepth: 1 });
});

test('TP4/TP6: materialization makes verified independent byte copies and refuses attested-source drift atomically', (t) => {
  const source = makeSource('copies'); const one = root('copy-one'); const two = root('copy-two'); const changed = root('copy-changed');
  t.after(() => [source, one, two, changed].forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const authority = prepared(source); const identity = authority.identity();
  const first = authority.materialize(one); const second = authority.materialize(two);
  assert.deepEqual(first.identity, identity); assert.deepEqual(second.identity, identity);
  const sourceFile = join(source, 'deps/runtime/index.mjs'); const firstFile = join(one, 'tools/runtime/index.mjs'); const secondFile = join(two, 'tools/runtime/index.mjs');
  assert.equal(readFileSync(firstFile, 'utf8'), readFileSync(sourceFile, 'utf8'));
  assert.notEqual(lstatSync(firstFile).ino, lstatSync(sourceFile).ino); assert.notEqual(lstatSync(firstFile).ino, lstatSync(secondFile).ino);
  writeFileSync(firstFile, 'worker mutation\n');
  assert.equal(readFileSync(sourceFile, 'utf8'), 'export const value = 1;\n');
  assert.equal(readFileSync(secondFile, 'utf8'), 'export const value = 1;\n');
  assert.equal(lstatSync(join(one, 'tools/runtime/bin/run')).mode & 0o111, 0o111);
  assert.equal(readdirSync(join(one, 'tools/runtime/empty')).length, 0);

  writeFileSync(sourceFile, 'source drift\n');
  assert.throws(() => authority.materialize(changed), (error) => error.code === 'toolchain_projection_changed');
  assert.equal(existsSync(join(changed, 'tools/runtime')), false);
});

test('TP5/TP6: worker capture excludes projected bytes without .gitignore and force-added projection bytes fail closed', async (t) => {
  const { repo, sha } = makeRepo(); const source = makeSource('capture');
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(source, { recursive: true, force: true }); });
  const authority = prepared(source); const handle = await createFromBase(repo, 'projection-capture', sha, { toolchainProjection: authority });
  assert.deepEqual(handle.toolchainProjection, authority.identity());
  assert.equal(existsSync(join(repo, '.baton/wt/projection-capture.projection.exclude')), true);
  assert.equal(sh('git', ['status', '--porcelain', '--untracked-files=all'], handle.dir), '');
  write(handle.dir, 'result.txt', 'ordinary result\n');
  const captured = await captureCommit(repo, 'projection-capture', { vendor: 'mock' });
  assert.match(sh('git', ['show', '--pretty=', '--name-only', captured.sha], repo), /result\.txt/);
  assert.equal(sh('git', ['ls-tree', '-r', '--name-only', captured.sha], repo).includes('tools/runtime'), false);

  sh('git', ['add', '-f', 'tools/runtime/index.mjs'], handle.dir);
  sh('git', ['commit', '-q', '-m', 'hostile force add'], handle.dir);
  await assert.rejects(
    () => captureCommit(repo, 'projection-capture'),
    (error) => error.code === 'toolchain_projection_materialization_failed',
  );
  await reap(repo, 'projection-capture', { force: true, deleteBranch: true });
  assert.equal(existsSync(join(repo, '.baton/wt/projection-capture.projection.exclude')), false);
});

test('TP4/TP6/TP9: worker and verifier failures restore Git/worktree/branch/directory baselines', async (t) => {
  const { repo, sha } = makeRepo(); const source = makeSource('cleanup');
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(source, { recursive: true, force: true }); });
  const authority = prepared(source); writeFileSync(join(source, 'deps/runtime/index.mjs'), 'changed\n');
  const before = sh('git', ['worktree', 'list', '--porcelain'], repo);
  await assert.rejects(() => createFromBase(repo, 'projection-fail', sha, { toolchainProjection: authority }), (error) => error.code === 'toolchain_projection_changed');
  assert.equal(sh('git', ['worktree', 'list', '--porcelain'], repo), before);
  assert.equal(sh('git', ['branch', '--list', 'baton/projection-fail'], repo), '');
  assert.equal(existsSync(join(repo, '.baton/wt/projection-fail')), false);
  assert.equal(existsSync(join(repo, '.baton/wt/projection-fail.projection.exclude')), false);

  const fresh = prepared(source); const collisionSha = (() => {
    write(repo, 'tools/runtime/tracked.txt', 'collision\n'); sh('git', ['add', '-A'], repo); sh('git', ['commit', '-q', '-m', 'collision'], repo);
    return sh('git', ['rev-parse', 'HEAD'], repo);
  })();
  await assert.rejects(() => freshVerifySandbox(repo, 'projection-verify-fail', collisionSha, { toolchainProjection: fresh }), (error) => error.code === 'toolchain_projection_materialization_failed');
  assert.equal(sh('git', ['worktree', 'list', '--porcelain'], repo), before.replace(sha, collisionSha));
  assert.ok(!existsSync(join(repo, '.baton/verify')) || readdirSync(join(repo, '.baton/verify')).length === 0);
});

test('TP7/TP8: driver binds the same path-free identity into worktree readiness, replayable verification, and the result commit', async (t) => {
  const { repo } = makeRepo(); const source = makeSource('driver'); const logDir = root('driver-log');
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(source, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });
  const config = descriptor(source); const identity = inspectToolchainProjection(config);
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'result.txt', content: 'ok\n' }] } });
  const driver = createDriver({ repoRoot: repo, logDir, adapters: { mock: adapter }, toolchainProjection: { ...config, expectedManifestDigest: identity.manifestDigest } });
  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'projection-driver' });
  const result = await until(async () => { const row = await driver.coordinator.result(handle.id); return ['completed', 'failed'].includes(row.status) ? row : null; }, 'projected driver result');
  assert.equal(result.status, 'completed', JSON.stringify(result.verdict));
  const events = driver.log.read(handle.id); const ready = events.find((event) => event.kind === 'worktree.ready'); const verify = events.find((event) => event.kind === 'verify.reverified');
  assert.deepEqual(ready.payload.toolchainProjection, identity);
  assert.deepEqual(verify.payload.capture.toolchainProjection, identity);
  assert.deepEqual(verify.payload.capture.verifierToolchainProjection, identity);
  assert.equal(JSON.stringify({ result, ready, verify }).includes(source), false);
  assert.equal(sh('git', ['ls-tree', '-r', '--name-only', verify.payload.capture.sha], repo).includes('tools/runtime'), false);
  await driver.coordinator.kill(handle.id, 'test'); assert.equal(driver.close(), true);
  const replay = createDriver({ repoRoot: repo, logDir, adapters: {}, toolchainProjection: { ...config, expectedManifestDigest: identity.manifestDigest } });
  assert.deepEqual(replay.coordinator.list().find((row) => row.taskId === 'projection-driver')?.sessionContext?.toolchainProjection, identity);
  assert.deepEqual(replay.log.read(handle.id).find((event) => event.kind === 'verify.reverified')?.payload?.capture?.verifierToolchainProjection, identity);
  assert.equal(replay.close(), true);
});

test('TP7: a substituted base-verifier projection cannot reach an accepted verdict', async (t) => {
  const { repo } = makeRepo(); const source = makeSource('base-mismatch'); const logDir = root('base-mismatch-log');
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(source, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });
  const config = descriptor(source); const identity = inspectToolchainProjection(config);
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'result.txt', content: 'ok\n' }] } });
  const driver = createDriver({ repoRoot: repo, logDir, adapters: { mock: adapter }, requireRedGreen: true, toolchainProjection: { ...config, expectedManifestDigest: identity.manifestDigest } });
  const original = driver.coordinator._worktrees.createBaseVerifyWorktree.bind(driver.coordinator._worktrees);
  driver.coordinator._worktrees.createBaseVerifyWorktree = async (...args) => {
    const created = await original(...args);
    return { ...created, toolchainProjection: { ...created.toolchainProjection, manifestDigest: '0'.repeat(64) } };
  };
  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'projection-base-mismatch' });
  const result = await until(async () => { const row = await driver.coordinator.result(handle.id); return ['completed', 'failed'].includes(row.status) ? row : null; }, 'base projection mismatch');
  assert.equal(result.status, 'failed');
  assert.equal(driver.log.read(handle.id).some((event) => event.kind === 'verify.reverified' && event.payload?.accept === true), false);
  await driver.coordinator.kill(handle.id, 'test'); driver.close();
});

test('TP7/TP8: a source change between worker admission and verification fails closed despite a zero-exit command', async (t) => {
  const { repo } = makeRepo(); const source = makeSource('drift-gate'); const logDir = root('drift-log');
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(source, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });
  const config = descriptor(source); const identity = inspectToolchainProjection(config);
  const adapter = new MockAdapter({ scenario: {
    outcome: 'completed', ask: { kind: 'question', question: 'continue?', afterEditIndex: 0, blocking: true },
    edits: [{ path: 'result.txt', content: 'ok\n' }],
  } });
  const driver = createDriver({ repoRoot: repo, logDir, adapters: { mock: adapter }, toolchainProjection: { ...config, expectedManifestDigest: identity.manifestDigest } });
  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'projection-drift-gate' });
  const question = await until(() => {
    const requestId = driver.coordinator.list().find((row) => row.id === handle.id)?.pendingQuestionId;
    return requestId ? { requestId } : null;
  }, 'blocked worker question');
  writeFileSync(join(source, 'deps/runtime/index.mjs'), 'source changed before verification\n');
  await driver.coordinator.respond(question.requestId, { text: 'continue' });
  const result = await until(async () => { const row = await driver.coordinator.result(handle.id); return ['completed', 'failed'].includes(row.status) ? row : null; }, 'drift refusal');
  assert.equal(result.status, 'failed');
  assert.equal(driver.log.read(handle.id).some((event) => event.kind === 'verify.reverified' && event.payload?.accept === true), false);
  await driver.coordinator.kill(handle.id, 'test'); driver.close();
});

test('TP7/TP8: session-context validation pins the configured projection identity and rejects substitution', async (t) => {
  const { repo, sha } = makeRepo(); const source = makeSource('session'); const logDir = root('session-log');
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(source, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });
  const config = descriptor(source); const identity = inspectToolchainProjection(config);
  const driver = createDriver({ repoRoot: repo, logDir, adapters: {}, toolchainProjection: { ...config, expectedManifestDigest: identity.manifestDigest } });
  const created = await driver.coordinator._worktrees.create('projection-session', sha);
  const context = { worktree: created.path, repoRoot: repo, baseSha: sha, branch: created.branch, ownerTaskId: 'projection-session', toolchainProjection: identity };
  assert.deepEqual(await driver.coordinator._worktrees.validateSessionContext(context), { ok: true });
  const forged = { ...context, toolchainProjection: { ...identity, manifestDigest: '0'.repeat(64) } };
  assert.equal((await driver.coordinator._worktrees.validateSessionContext(forged)).ok, false);
  await driver.coordinator._worktrees.remove('projection-session'); driver.close();
});

test('TP10: legacy same-root dependency copying remains compatible and mixed legacy/new driver configuration refuses before authority', async (t) => {
  const { repo, sha } = makeRepo(); const source = makeSource('compat'); const logDir = root('compat-log');
  t.after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(source, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); });
  write(repo, 'legacy/deps/index.js', 'legacy\n');
  const legacy = await createFromBase(repo, 'legacy-compatible', sha, { dependencyDirs: ['legacy/deps'] });
  assert.equal(readFileSync(join(legacy.dir, 'legacy/deps/index.js'), 'utf8'), 'legacy\n');
  assert.equal(Object.hasOwn(legacy, 'toolchainProjection'), false);
  await reap(repo, 'legacy-compatible', { force: true, deleteBranch: true });

  rmSync(join(repo, 'legacy'), { recursive: true, force: true });
  writeFileSync(join(repo, '.gitignore'), '/installed/\n'); sh('git', ['add', '.gitignore'], repo); sh('git', ['commit', '-q', '-m', 'ignore installed toolchain'], repo);
  write(repo, 'installed/deps/index.js', 'same root projection\n');
  const sameRootConfig = descriptor(repo, { mappings: [{ sourcePath: 'installed/deps', targetPath: 'projected/deps' }] });
  const sameRoot = prepared(repo, { mappings: sameRootConfig.mappings });
  const sameRootHandle = await createFromBase(repo, 'same-root-projection', sh('git', ['rev-parse', 'HEAD'], repo), { toolchainProjection: sameRoot });
  assert.equal(readFileSync(join(sameRootHandle.dir, 'projected/deps/index.js'), 'utf8'), 'same root projection\n');
  await reap(repo, 'same-root-projection', { force: true, deleteBranch: true });

  const config = descriptor(source); const identity = inspectToolchainProjection(config);
  assert.throws(
    () => createDriver({ repoRoot: repo, logDir, adapters: {}, workerDependencyDirs: ['legacy/deps'], toolchainProjection: { ...config, expectedManifestDigest: identity.manifestDigest } }),
    /cannot be combined/,
  );
  assert.equal(existsSync(join(logDir, 'coordination', 'writer.lease')), false);
});
