// Workspace preservation — the destructive worktree removal boundary never destroys un-captured
// content. Every test drives real Git repositories and real checkouts; nothing mocks git, the
// filesystem, or the process-identity probe.
//
// Contract under test (impl/src/worktree.mjs):
//   - reap() and reconcile() destroy a checkout only when its content is (a) Git-observed clean,
//     (b) every changed path is declared runtime infrastructure — the owner metadata's
//     `copiedDependencies` / `toolchainProjectionTargets`, the worktree's own projection exclude
//     configuration, or the caller's `disposablePaths` — or (c) the caller supplies an explicit
//     `discard` authorization. `force` overrides the stop latch, never preservation.
//   - A refusal is typed (WorkspacePreservationError#code, #retained, #observation) and leaves the
//     directory, its content, its metadata, its Git registration, its branch, its index and its
//     owner receipt exactly as they were: a refusal is never reported as a removal.
//   - reconcile() applies the same rule to an owner whose controller is proven dead, retains the
//     checkout with a typed diagnostic, and leaves its capacity reservation evidence unsettled.
//   - The boundary itself never stages, commits, stashes, or moves content: preserving content as
//     a revision is a caller decision, recorded as authorization evidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  WorkspacePreservationError,
  allocatePhysicalWorkspaceOwner,
  createFromBase,
  listWorktrees,
  markStopped,
  observeOwnedWorktreeContent,
  physicalWorkspaceOwnerCleanupAbsent,
  physicalWorkspaceOwnerReceipt,
  reap,
  reconcile,
} from '../src/worktree.mjs';
import { inspectToolchainProjection, prepareToolchainProjection } from '../src/toolchain-projection.mjs';

// ---------- helpers ----------

const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

function git(cwd, args, input) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: gitEnv, ...(input === undefined ? {} : { input }),
  }).trim();
}

/** The full porcelain v2 working-tree + index observation, used to prove a refusal changed
 * nothing (a staged or committed side effect would alter this byte for byte). */
function statusRaw(dir) {
  return execFileSync('git', ['status', '--porcelain=v2', '-z', '--no-renames', '-uall'], {
    cwd: dir, encoding: 'utf8', env: gitEnv,
  });
}

function makeRepo(label = 'repo') {
  const world = mkdtempSync(join(tmpdir(), `baton-preservation-${label}-`));
  const root = join(world, 'repo'); mkdirSync(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Preservation Fixture']);
  git(root, ['config', 'user.email', 'preservation@example.invalid']);
  writeFileSync(join(root, 'README.md'), '# base\n');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'main.js'), 'export const value = 1;\n');
  git(root, ['add', '-A']); git(root, ['commit', '-qm', 'base']);
  return { world, root, baseSha: git(root, ['rev-parse', 'HEAD']) };
}

function commonGit(root) {
  const raw = git(root, ['rev-parse', '--git-common-dir']);
  return isAbsolute(raw) ? raw : resolve(root, raw);
}

function receiptPath(root, physicalOwnerId) {
  return join(commonGit(root), 'baton', 'workspace-owners', `${physicalOwnerId}.json`);
}

const digest = (value) => createHash('sha256').update(value).digest('hex');

function processStart() {
  return execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// One deployment, two controller generations: the restart actor below is the live writer, so the
// receipt's controller is provably dead locally (workspaceOwnerAuthorityState → 'local_dead').
const DEPLOYMENT_ID = digest('preservation-deployment');
function deadOwnerAuthority() {
  return {
    deploymentId: DEPLOYMENT_ID, controllerId: digest('preservation-previous-controller'),
    pid: 2_147_483_647, pidStart: 'preservation-not-a-live-process',
  };
}
function restartAuthority() {
  return {
    deploymentId: DEPLOYMENT_ID, controllerId: digest('preservation-restart-controller'),
    pid: process.pid, pidStart: processStart(),
  };
}
function liveForeignAuthority() {
  return {
    deploymentId: digest('preservation-foreign-deployment'),
    controllerId: digest('preservation-foreign-controller'),
    pid: process.pid, pidStart: processStart(),
  };
}
function binding(baseSha, attemptId) {
  return {
    runId: 'preservation-run', attemptId, logicalTaskId: 'preservation-logical',
    processGeneration: 1, baseSha,
  };
}

/** A physical-owner receipt with a real checkout, allocated by a controller that is dead now. */
async function ownedCheckout(f, { attemptId = 'preservation-attempt', ownerReceipt = true } = {}) {
  if (ownerReceipt === false) {
    return { id: attemptId, dir: (await createFromBase(f.root, attemptId, f.baseSha)).dir };
  }
  const receipt = allocatePhysicalWorkspaceOwner(
    f.root, binding(f.baseSha, attemptId), deadOwnerAuthority(),
  );
  const handle = await createFromBase(f.root, receipt.physicalOwnerId, f.baseSha, { ownerReceipt: receipt });
  return { id: receipt.physicalOwnerId, dir: handle.dir, branch: handle.branch, receipt };
}

function stubLog() {
  const events = [];
  return { events, log: { append: (event) => events.push(event) } };
}

async function rejectsPreservation(promise, code, label) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof WorkspacePreservationError, `${label}: expected WorkspacePreservationError, got ${error?.name}: ${error?.message}`);
    assert.equal(error.code, code, `${label}: code`);
    assert.equal(error.retained, true, `${label}: retained flag`);
    assert.ok(error.observation, `${label}: observation is attached`);
    return true;
  }, label);
}

// ---------- reap(): un-captured content is never destroyed ----------

test('reap() retains a dirty checkout for a dead owner even with {force:true}', async (t) => {
  const variants = [
    ['unstaged tracked modification', (dir, root) => writeFileSync(join(dir, 'README.md'), '# base\nedited\n'), 'README.md'],
    ['staged tracked modification', (dir) => { writeFileSync(join(dir, 'src', 'main.js'), 'export const value = 2;\n'); git(dir, ['add', 'src/main.js']); }, 'src/main.js'],
    ['untracked file', (dir) => writeFileSync(join(dir, 'notes.txt'), 'unrecorded notes\n'), 'notes.txt'],
    ['deleted tracked file', (dir) => rmSync(join(dir, 'src', 'main.js')), 'src/main.js'],
  ];
  for (const [label, mutate, expectedPath] of variants) {
    await t.test(label, async () => {
      const f = makeRepo('reap-dirty');
      t.after(() => rmSync(f.world, { recursive: true, force: true }));
      const { id, dir } = await ownedCheckout(f);
      mutate(dir, f.root);
      await markStopped(f.root, id);
      const before = statusRaw(dir);

      await rejectsPreservation(
        reap(f.root, id, { force: true, deleteBranch: true }),
        'workspace_uncommitted_content_retained', `${label}: forced reap`,
      );

      const observation = observeOwnedWorktreeContent(f.root, id);
      assert.equal(observation.state, 'dirty');
      assert.equal(observation.removable, false);
      assert.ok(observation.dirtyPaths.includes(expectedPath),
        `${label}: observation names ${expectedPath} (${JSON.stringify(observation.dirtyPaths)})`);
      assert.equal(statusRaw(dir), before, `${label}: refusal changed neither index nor working tree`);
      assert.equal(existsSync(dir), true);
      assert.equal(existsSync(join(f.root, '.baton', 'wt', `${id}.meta.json`)), true);
      assert.equal(physicalWorkspaceOwnerReceipt(f.root, id)?.physicalOwnerId, id, `${label}: owner receipt retained`);
      assert.equal(physicalWorkspaceOwnerCleanupAbsent(f.root, id), false, `${label}: no absence proof is claimed`);
      assert.ok(git(f.root, ['branch', '--list', `baton/${id}`]) !== '', `${label}: branch retained`);
      assert.ok(listWorktrees(f.root).some((entry) => entry.dir === dir), `${label}: registration retained`);

      // The refusal is stable: a retry observes the same state and destroys nothing.
      await rejectsPreservation(
        reap(f.root, id, { force: true, deleteBranch: true }),
        'workspace_uncommitted_content_retained', `${label}: forced reap retry`,
      );
      assert.equal(statusRaw(dir), before, `${label}: retry changed nothing`);
    });
  }
});

test('markStopped and a non-forced reap are not a discard authorization', async (t) => {
  const f = makeRepo('reap-stopped-dirty');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const { id, dir } = await ownedCheckout(f);
  writeFileSync(join(dir, 'partial.txt'), 'partial work from an aborted run\n');
  await markStopped(f.root, id);
  const before = statusRaw(dir);

  await rejectsPreservation(
    reap(f.root, id, { deleteBranch: true }),
    'workspace_uncommitted_content_retained', 'stopped dirty reap',
  );
  assert.equal(statusRaw(dir), before);
  assert.equal(existsSync(join(dir, 'partial.txt')), true);
});

test('a clean checkout is still removed, and reaping twice stays a no-op', async (t) => {
  const f = makeRepo('reap-clean');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const { id, dir } = await ownedCheckout(f, { attemptId: 'preservation-clean' });
  assert.equal(observeOwnedWorktreeContent(f.root, id).state, 'clean');

  await markStopped(f.root, id);
  await reap(f.root, id, { deleteBranch: true });

  assert.equal(existsSync(dir), false);
  assert.equal(existsSync(join(f.root, '.baton', 'wt', `${id}.meta.json`)), false);
  assert.equal(git(f.root, ['branch', '--list', `baton/${id}`]), '');
  assert.equal(listWorktrees(f.root).some((entry) => entry.dir === dir), false);
  assert.equal(physicalWorkspaceOwnerReceipt(f.root, id), null, 'owner receipt released');
  assert.equal(physicalWorkspaceOwnerCleanupAbsent(f.root, id), true, 'exact absence proven');
  await assert.doesNotReject(() => reap(f.root, id, { deleteBranch: true }), 'second reap is a no-op');
});

// ---------- runtime-materialized infrastructure still cleans ----------

test('runtime-materialized infrastructure is disposable, not un-captured content', async (t) => {
  await t.test('metadata-declared copied dependency', async () => {
    const f = makeRepo('deps');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    mkdirSync(join(f.root, 'deps', 'runtime'), { recursive: true });
    writeFileSync(join(f.root, 'deps', 'runtime', 'index.js'), 'module.exports = 1;\n');
    const handle = await createFromBase(f.root, 'copied-dependency', f.baseSha, { dependencyDirs: ['deps'] });
    assert.equal(existsSync(join(handle.dir, 'deps', 'runtime', 'index.js')), true);

    const observation = observeOwnedWorktreeContent(f.root, 'copied-dependency');
    assert.equal(observation.state, 'disposable');
    assert.deepEqual(observation.disposableRoots, ['deps']);
    assert.deepEqual(observation.disposablePaths, ['deps/runtime/index.js']);
    assert.deepEqual(observation.dirtyPaths, []);

    await reap(f.root, 'copied-dependency', { force: true, deleteBranch: true });
    assert.equal(existsSync(handle.dir), false);
  });

  await t.test('toolchain projection target hidden by the worktree projection excludes', async () => {
    const f = makeRepo('projection');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const sourceRoot = mkdtempSync(join(tmpdir(), 'baton-preservation-source-'));
    t.after(() => rmSync(sourceRoot, { recursive: true, force: true }));
    mkdirSync(join(sourceRoot, 'deps', 'runtime'), { recursive: true });
    writeFileSync(join(sourceRoot, 'deps', 'runtime', 'index.mjs'), 'export const value = 1;\n');
    const config = {
      schemaVersion: 1, sourceRoot, sourceId: 'preservation-toolchain',
      mappings: [{ sourcePath: 'deps/runtime', targetPath: 'tools/runtime' }],
      limits: {
        maxMappings: 8, maxFiles: 128, maxDirectories: 128, maxBytes: 1024 * 1024,
        maxFileBytes: 256 * 1024, maxPathBytes: 512, maxDepth: 32,
      },
    };
    const identity = inspectToolchainProjection(config);
    const authority = prepareToolchainProjection({ ...config, expectedManifestDigest: identity.manifestDigest });
    const handle = await createFromBase(f.root, 'projected-toolchain', f.baseSha, { toolchainProjection: authority });
    assert.equal(existsSync(join(handle.dir, 'tools', 'runtime', 'index.mjs')), true);

    const observation = observeOwnedWorktreeContent(f.root, 'projected-toolchain');
    assert.equal(observation.state, 'clean', `projection targets are ignored, not un-captured content: ${JSON.stringify(observation.dirtyPaths)}`);

    await reap(f.root, 'projected-toolchain', { force: true, deleteBranch: true });
    assert.equal(existsSync(handle.dir), false);
    assert.equal(existsSync(join(f.root, '.baton', 'wt', 'projected-toolchain.projection.exclude')), false);
  });

  await t.test('caller-declared generated infrastructure residue', async () => {
    const f = makeRepo('generated');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const { id, dir } = await ownedCheckout(f, { attemptId: 'generated-residue' });
    mkdirSync(join(dir, 'generated'), { recursive: true });
    writeFileSync(join(dir, 'generated', 'report.json'), '{}\n');

    await rejectsPreservation(
      reap(f.root, id, { force: true, deleteBranch: true }),
      'workspace_uncommitted_content_retained', 'undeclared residue',
    );
    assert.equal(existsSync(join(dir, 'generated', 'report.json')), true);

    const observation = observeOwnedWorktreeContent(f.root, id, { disposablePaths: ['generated'] });
    assert.equal(observation.state, 'disposable');
    assert.deepEqual(observation.disposablePaths, ['generated/report.json']);
    await reap(f.root, id, { force: true, deleteBranch: true, disposablePaths: ['generated'] });
    assert.equal(existsSync(dir), false, 'declared infrastructure is still removable');
  });
});

// ---------- explicit discard authorization ----------

test('an explicit discard authorization destroys content and records its evidence', async (t) => {
  await t.test('with a preserving reference', async () => {
    const f = makeRepo('discard-evidence');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const { id, dir } = await ownedCheckout(f, { attemptId: 'discard-evidence' });
    writeFileSync(join(dir, 'README.md'), '# base\ncaptured elsewhere\n');
    const { events, log } = stubLog();

    await reap(f.root, id, {
      force: true, deleteBranch: true, log,
      discard: { reason: 'adapter run aborted; content captured', evidenceRef: 'refs/baton/checkpoints/deadbeef', actor: 'test:operator' },
    });

    assert.equal(existsSync(dir), false);
    const recorded = events.filter((event) => event.kind === 'worktree.discard_authorized');
    assert.equal(recorded.length, 1, 'exactly one discard authorization is recorded');
    assert.equal(recorded[0].worker, id);
    assert.deepEqual(recorded[0].payload.dirtyPaths, ['README.md']);
    assert.equal(recorded[0].payload.reason, 'adapter run aborted; content captured');
    assert.equal(recorded[0].payload.evidenceRef, 'refs/baton/checkpoints/deadbeef');
    assert.equal(recorded[0].payload.actor, 'test:operator');
    assert.equal(events.filter((event) => event.kind === 'worktree.reaped').length, 1);
  });

  await t.test('without a preserving reference the authorization is still explicit', async () => {
    const f = makeRepo('discard-no-evidence');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const { id, dir } = await ownedCheckout(f, { attemptId: 'discard-no-evidence' });
    writeFileSync(join(dir, 'junk.txt'), 'aborted run residue\n');
    const { events, log } = stubLog();

    await reap(f.root, id, { force: true, deleteBranch: true, log, discard: { reason: 'aborted run, nothing worth keeping' } });
    assert.equal(existsSync(dir), false);
    const recorded = events.filter((event) => event.kind === 'worktree.discard_authorized');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].payload.evidenceRef, null);
  });

  await t.test('a malformed authorization fails before any effect', async () => {
    const f = makeRepo('discard-malformed');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const { id, dir } = await ownedCheckout(f, { attemptId: 'discard-malformed' });
    writeFileSync(join(dir, 'README.md'), '# base\nedited\n');
    const before = statusRaw(dir);

    for (const discard of [
      {}, { reason: '' }, { reason: '   ' }, { reason: 'ok', evidence: 'refs/x' },
      { reason: 'ok', evidenceRef: 7 }, { reason: 'ok', actor: '' }, 'yes',
    ]) {
      await assert.rejects(
        reap(f.root, id, { force: true, deleteBranch: true, discard }),
        (error) => error instanceof TypeError, `discard ${JSON.stringify(discard)}`,
      );
      assert.equal(statusRaw(dir), before, `discard ${JSON.stringify(discard)} changed nothing`);
      assert.equal(existsSync(dir), true);
    }
  });
});

// ---------- beforeRemove: the caller's transaction gate stays outside the effect ----------

test('beforeRemove defers the removal and is never able to claim an authorization it refused', async (t) => {
  const f = makeRepo('before-remove');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const { id, dir } = await ownedCheckout(f, { attemptId: 'before-remove' });
  writeFileSync(join(dir, 'README.md'), '# base\nedited\n');
  const { events, log } = stubLog();
  const discard = { reason: 'captured before deferred removal', evidenceRef: 'refs/baton/checkpoints/cafe' };
  let gateCalls = 0;

  await rejectsPreservation(
    reap(f.root, id, {
      force: true, deleteBranch: true, log, discard,
      beforeRemove: ({ physicalOwnerId, observation, discard: authorized }) => {
        gateCalls += 1;
        assert.equal(physicalOwnerId, id);
        assert.equal(observation.state, 'dirty');
        assert.equal(authorized?.evidenceRef, 'refs/baton/checkpoints/cafe');
        return false;
      },
    }),
    'workspace_removal_deferred', 'deferred removal',
  );
  assert.equal(gateCalls, 1);
  assert.equal(existsSync(dir), true);
  assert.equal(existsSync(join(dir, 'README.md')), true);
  assert.equal(physicalWorkspaceOwnerReceipt(f.root, id)?.physicalOwnerId, id);
  assert.deepEqual(events, [], 'a deferred removal records no discard authorization');

  await reap(f.root, id, {
    force: true, deleteBranch: true, log, discard,
    beforeRemove: () => true,
  });
  assert.equal(existsSync(dir), false);
  assert.equal(events.filter((event) => event.kind === 'worktree.discard_authorized').length, 1);

  // The gate runs for the residue path too, where there is no content at all.
  const clean = await ownedCheckout(f, { attemptId: 'before-remove-clean' });
  const seen = [];
  await reap(f.root, clean.id, {
    force: true, deleteBranch: true,
    beforeRemove: ({ observation }) => { seen.push(observation.state); return true; },
  });
  assert.deepEqual(seen, ['clean']);
});

// ---------- unobservable content ----------

test('a directory whose content cannot be observed is retained, not cleaned', async (t) => {
  const f = makeRepo('unobservable');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const { id, dir } = await ownedCheckout(f, { attemptId: 'unobservable' });
  writeFileSync(join(dir, 'unrecorded.txt'), 'not reachable through any capture\n');
  rmSync(join(dir, '.git')); // the checkout can no longer be observed as its own repository

  const observation = observeOwnedWorktreeContent(f.root, id);
  assert.equal(observation.state, 'unobservable');
  assert.equal(observation.removable, false);

  await rejectsPreservation(
    reap(f.root, id, { force: true, deleteBranch: true }),
    'workspace_content_unobservable_retained', 'unobservable reap',
  );
  assert.equal(existsSync(join(dir, 'unrecorded.txt')), true);
  assert.equal(existsSync(dir), true);
});

test('reconcile() still removes a leftover directory that holds no content', async (t) => {
  const f = makeRepo('zombie-empty');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const zombie = join(f.root, '.baton', 'wt', 'zombie-empty');
  mkdirSync(zombie, { recursive: true });

  const report = reconcile(f.root, []);
  assert.deepEqual(report.errors, []);
  assert.ok(report.removedZombieDirs.includes(zombie));
  assert.equal(existsSync(zombie), false);
});

// ---------- reconcile(): startup custody of a dead owner ----------

test('reconcile() retains a dead owner\'s dirty checkout and settles nobody\'s capacity for it', async (t) => {
  const f = makeRepo('startup-reconcile');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const dirty = await ownedCheckout(f, { attemptId: 'startup-dirty' });
  const clean = await ownedCheckout(f, { attemptId: 'startup-clean' });
  writeFileSync(join(dirty.dir, 'README.md'), '# base\nwork in progress\n');
  writeFileSync(join(dirty.dir, 'notes.txt'), 'unrecorded\n');
  const dirtyBefore = statusRaw(dirty.dir);
  const { events, log } = stubLog();
  const settled = [];

  const report = reconcile(f.root, [], {
    ownerAuthority: restartAuthority(), log,
    beforeOwnerCleanup: (physicalOwnerId) => { settled.push(physicalOwnerId); return true; },
  });

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.removedPhysicalOwners, [clean.id], 'only the clean owner is removed');
  assert.deepEqual(settled, [clean.id], 'capacity settles only for the resource that was removed');
  assert.deepEqual(report.retainedContentOwners, [dirty.id]);
  assert.equal(report.removedZombieDirs.includes(dirty.dir), false);

  const diagnostic = report.diagnostics.find((row) => row.physicalOwnerId === dirty.id && row.retained === true);
  assert.equal(diagnostic.code, 'workspace_uncommitted_content_retained');
  assert.equal(diagnostic.contentState, 'dirty');
  assert.deepEqual([...diagnostic.dirtyPaths].sort(), ['README.md', 'notes.txt']);

  assert.equal(existsSync(dirty.dir), true, 'dirty checkout retained');
  assert.equal(statusRaw(dirty.dir), dirtyBefore, 'dirty checkout content untouched');
  assert.equal(readFileSync(join(dirty.dir, 'notes.txt'), 'utf8'), 'unrecorded\n');
  assert.equal(existsSync(receiptPath(f.root, dirty.id)), true, 'owner receipt retained as evidence');
  assert.equal(physicalWorkspaceOwnerCleanupAbsent(f.root, dirty.id), false);
  assert.ok(git(f.root, ['branch', '--list', `baton/${dirty.id}`]) !== '', 'branch retained');

  assert.equal(existsSync(clean.dir), false, 'clean checkout removed');
  assert.equal(existsSync(receiptPath(f.root, clean.id)), false, 'clean owner receipt released');
  assert.equal(physicalWorkspaceOwnerCleanupAbsent(f.root, clean.id), true);
  assert.equal(physicalWorkspaceOwnerReceipt(f.root, dirty.id).state, 'ready');

  // Idempotence: the retained owner is reported identically and nothing else is settled.
  const second = reconcile(f.root, [], {
    ownerAuthority: restartAuthority(), log,
    beforeOwnerCleanup: (physicalOwnerId) => { settled.push(physicalOwnerId); return true; },
  });
  assert.deepEqual(second.errors, []);
  assert.deepEqual(second.removedPhysicalOwners, []);
  assert.deepEqual(second.retainedContentOwners, [dirty.id]);
  assert.deepEqual(settled, [clean.id], 'no capacity is settled on the idempotent retry');
  assert.ok(second.diagnostics.some((row) => row.physicalOwnerId === dirty.id && row.code === 'workspace_uncommitted_content_retained'));
  assert.equal(statusRaw(dirty.dir), dirtyBefore);
  assert.equal(events.filter((event) => event.kind === 'worktree.reconciled').length, 1,
    'only the removed owner emits a reconciled event');
});

test('reconcile() never touches a live foreign controller\'s checkout, dirty or not', async (t) => {
  const f = makeRepo('foreign');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const receipt = allocatePhysicalWorkspaceOwner(f.root, binding(f.baseSha, 'foreign-attempt'), liveForeignAuthority());
  const handle = await createFromBase(f.root, receipt.physicalOwnerId, f.baseSha, { ownerReceipt: receipt });
  writeFileSync(join(handle.dir, 'README.md'), '# base\nforeign in progress\n');
  const before = statusRaw(handle.dir);
  const settled = [];

  const report = reconcile(f.root, [], {
    ownerAuthority: restartAuthority(),
    beforeOwnerCleanup: (physicalOwnerId) => { settled.push(physicalOwnerId); return true; },
  });

  assert.deepEqual(report.errors, []);
  assert.ok(report.diagnostics.some((row) => (
    row.physicalOwnerId === receipt.physicalOwnerId && row.code === 'workspace_owner_live_foreign' && row.retained === true
  )));
  assert.deepEqual(report.removedPhysicalOwners, []);
  assert.deepEqual(settled, []);
  assert.equal(existsSync(handle.dir), true);
  assert.equal(statusRaw(handle.dir), before);
  assert.equal(existsSync(receiptPath(f.root, receipt.physicalOwnerId)), true);
});

// ---------- reconcile(): preserve-then-remove is a caller decision the boundary records ----------

test('reconcile() authorizeDiscard is the caller\'s capture decision, recorded with its reference', async (t) => {
  await t.test('a caller that declines to capture keeps the content', async () => {
    const f = makeRepo('authorize-decline');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const { id, dir } = await ownedCheckout(f, { attemptId: 'authorize-decline' });
    writeFileSync(join(dir, 'README.md'), '# base\nwork\n');
    writeFileSync(join(dir, 'fresh.txt'), 'untracked work\n');
    const before = statusRaw(dir);
    let consulted = 0;

    const report = reconcile(f.root, [], {
      ownerAuthority: restartAuthority(),
      authorizeDiscard: (physicalOwnerId, receipt, observation) => {
        consulted += 1;
        assert.equal(physicalOwnerId, id);
        assert.equal(receipt.logicalTaskId, 'preservation-logical');
        assert.equal(observation.state, 'dirty');
        return null;
      },
    });

    assert.equal(consulted, 1);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.removedPhysicalOwners, []);
    assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id && row.code === 'workspace_uncommitted_content_retained'));
    assert.equal(existsSync(dir), true);
    assert.equal(statusRaw(dir), before, 'a declined capture changes neither index nor working tree');
  });

  await t.test('an invalid authorization return retains with its own diagnostic', async () => {
    const f = makeRepo('authorize-invalid');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const { id, dir } = await ownedCheckout(f, { attemptId: 'authorize-invalid' });
    writeFileSync(join(dir, 'README.md'), '# base\nwork\n');

    const report = reconcile(f.root, [], {
      ownerAuthority: restartAuthority(),
      authorizeDiscard: () => ({ reason: '' }),
    });

    assert.deepEqual(report.errors, []);
    assert.ok(report.diagnostics.some((row) => (
      row.physicalOwnerId === id && row.code === 'workspace_discard_authorization_invalid' && row.retained === true
    )));
    assert.deepEqual(report.retainedContentOwners, [id]);
    assert.equal(existsSync(dir), true);
  });

  await t.test('a capture pinned to a ref preserves tracked and untracked content before removal', async () => {
    const f = makeRepo('authorize-capture');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const { id, dir } = await ownedCheckout(f, { attemptId: 'authorize-capture' });
    writeFileSync(join(dir, 'README.md'), '# base\ncaptured tracked edit\n');
    writeFileSync(join(dir, 'fresh.txt'), 'captured untracked work\n');
    const { events, log } = stubLog();
    let capturedSha = null;

    const report = reconcile(f.root, [], {
      ownerAuthority: restartAuthority(), log,
      authorizeDiscard: (physicalOwnerId, receipt, observation) => {
        assert.equal(observation.state, 'dirty');
        // The caller's capture: stage, commit and pin. The removal boundary itself performs none
        // of this — it only records the reference the caller names as evidence.
        git(dir, ['add', '-A']);
        git(dir, ['-c', 'user.name=Preservation Capture', '-c', 'user.email=capture@example.invalid',
          'commit', '-q', '-m', 'baton preserve: caller capture before authorized discard']);
        capturedSha = git(dir, ['rev-parse', 'HEAD']);
        git(f.root, ['update-ref', `refs/baton/checkpoints/${capturedSha}`, capturedSha]);
        return {
          reason: 'content captured to a pinned checkpoint before removal',
          evidenceRef: `refs/baton/checkpoints/${capturedSha}`, actor: 'test:operator',
        };
      },
    });

    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.removedPhysicalOwners, [id]);
    assert.deepEqual(report.retainedContentOwners, []);
    assert.equal(report.authorizedDiscards.length, 1);
    assert.equal(report.authorizedDiscards[0].evidenceRef, `refs/baton/checkpoints/${capturedSha}`);
    assert.deepEqual([...report.authorizedDiscards[0].dirtyPaths].sort(), ['README.md', 'fresh.txt']);

    const recorded = events.filter((event) => event.kind === 'worktree.discard_authorized');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].payload.evidenceRef, `refs/baton/checkpoints/${capturedSha}`);

    assert.equal(existsSync(dir), false, 'authorized removal completed');
    assert.equal(existsSync(receiptPath(f.root, id)), false);
    assert.equal(git(f.root, ['cat-file', '-t', capturedSha]), 'commit');
    assert.equal(git(f.root, ['show', `${capturedSha}:README.md`]), '# base\ncaptured tracked edit');
    assert.equal(git(f.root, ['show', `${capturedSha}:fresh.txt`]), 'captured untracked work');
    assert.deepEqual(
      git(f.root, ['ls-tree', '-r', '--name-only', capturedSha]).split('\n').sort(),
      ['README.md', 'fresh.txt', 'src/main.js'],
      'the pinned revision names exactly the checkout content, nothing else',
    );
  });
});
