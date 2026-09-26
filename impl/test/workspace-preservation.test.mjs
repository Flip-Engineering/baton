// Workspace preservation — the destructive worktree removal boundary never destroys content no
// capture recorded. Every test drives real Git repositories and real checkouts; nothing mocks git,
// the filesystem, or the process-identity probe.
//
// Contract under test (impl/src/worktree.mjs):
//   - reap() and reconcile() destroy a checkout only when it holds no content this repository's
//     captures never recorded: staged, unstaged, deleted and untracked paths, and everything Git
//     ignores. An ignored `.env` or notes directory is content, not cleanliness.
//   - The only differences the boundary may destroy are the infrastructure the owner metadata
//     itself attests as runtime-materialized: `copiedDependencies` and `toolchainProjectionTargets`.
//     No caller option, and no `force`, substitutes for that attestation. `markStopped` is not one
//     either, and caller-declared paths are never authority to delete source.
//   - A refusal is typed (WorkspacePreservationError#code, #retained, #observation) and leaves the
//     directory, its content, its metadata, its Git registration, its branch, its index and its
//     owner receipt exactly as they were: a refusal is never reported as a removal.
//   - reconcile() applies the same rule to an owner whose controller is proven dead, retains the
//     checkout with a typed diagnostic, and leaves its capacity reservation and receipt unsettled.
//   - The boundary itself never stages, commits, stashes, or moves content: preservation is by
//     retention, and reaping content is a decision no part of this interface can express.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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

/** The full porcelain v2 working-tree + index + ignored-path observation, used to prove a refusal
 * changed nothing (a staged, committed or ignored side effect would alter this byte for byte). */
function statusRaw(dir) {
  return execFileSync('git', ['status', '--porcelain=v2', '-z', '--no-renames', '-uall', '--ignored=matching'], {
    cwd: dir, encoding: 'utf8', env: gitEnv,
  });
}

/** A real repository whose base commit may already carry the ignore rules the fixture needs, so
 * that ignored content is genuinely Git-ignored rather than merely untracked. */
function makeRepo(label = 'repo', { ignore = [] } = {}) {
  const world = mkdtempSync(join(tmpdir(), `baton-preservation-${label}-`));
  const root = join(world, 'repo'); mkdirSync(root);
  git(root, ['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Preservation Fixture', GIT_COMMITTER_NAME: 'Preservation Fixture' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'preservation@example.invalid', GIT_COMMITTER_EMAIL: 'preservation@example.invalid' });
  writeFileSync(join(root, 'README.md'), '# base\n');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'main.js'), 'export const value = 1;\n');
  if (ignore.length > 0) writeFileSync(join(root, '.gitignore'), `${ignore.join('\n')}\n`);
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

/** Everything a refusal must leave untouched: content, index, registration, branch, metadata and
 * owner receipt. Returns the state a caller re-asserts after a second refusal. */
function assertIntact(f, id, dir) {
  assert.equal(existsSync(dir), true, 'checkout retained');
  assert.equal(existsSync(join(f.root, '.baton', 'wt', `${id}.meta.json`)), true, 'metadata retained');
  assert.ok(listWorktrees(f.root).some((entry) => entry.dir === dir), 'registration retained');
  assert.ok(git(f.root, ['branch', '--list', `baton/${id}`]) !== '', 'branch retained');
  assert.equal(physicalWorkspaceOwnerReceipt(f.root, id)?.physicalOwnerId, id, 'owner receipt retained');
  assert.equal(physicalWorkspaceOwnerCleanupAbsent(f.root, id), false, 'no absence proof is claimed');
}

// ---------- reap(): un-captured content is never destroyed ----------

test('reap() retains a dirty checkout for a dead owner even with {force:true}', async (t) => {
  const variants = [
    ['unstaged tracked modification', (dir) => writeFileSync(join(dir, 'README.md'), '# base\nedited\n'), ['README.md']],
    ['staged tracked modification', (dir) => { writeFileSync(join(dir, 'src', 'main.js'), 'export const value = 2;\n'); git(dir, ['add', 'src/main.js']); }, ['src/main.js']],
    ['untracked file', (dir) => writeFileSync(join(dir, 'notes.txt'), 'unrecorded notes\n'), ['notes.txt']],
    ['deleted tracked file', (dir) => rmSync(join(dir, 'src', 'main.js')), ['src/main.js']],
    // Git-ignored paths are invisible to `--ignored=no`, which is exactly how a boundary can
    // delete a checkout it believes is clean while destroying the only copy of this content.
    ['ignored .env file', (dir) => writeFileSync(join(dir, '.env'), 'SECRET=1\n'), ['.env']],
    ['ignored notes directory', (dir) => {
      mkdirSync(join(dir, 'notes'), { recursive: true });
      writeFileSync(join(dir, 'notes', 'journal.md'), 'unrecorded research\n');
    }, ['notes']],
    ['ignored file inside an untracked directory', (dir) => {
      mkdirSync(join(dir, 'scratch'), { recursive: true });
      writeFileSync(join(dir, 'scratch', 'draft.txt'), 'draft\n');
      writeFileSync(join(dir, 'scratch', '.env'), 'TOKEN=2\n');
    }, ['scratch/.env', 'scratch/draft.txt']],
  ];
  for (const [label, mutate, expectedPaths] of variants) {
    await t.test(label, async () => {
      const f = makeRepo('reap-dirty', { ignore: ['.env', 'notes/', 'scratch/.env'] });
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
      for (const expectedPath of expectedPaths) {
        assert.ok(observation.dirtyPaths.includes(expectedPath),
          `${label}: observation names ${expectedPath} (${JSON.stringify(observation.dirtyPaths)})`);
      }
      assert.equal(statusRaw(dir), before, `${label}: refusal changed neither index nor working tree`);
      assertIntact(f, id, dir);

      // The refusal is stable: a retry observes the same state and destroys nothing.
      await rejectsPreservation(
        reap(f.root, id, { force: true, deleteBranch: true }),
        'workspace_uncommitted_content_retained', `${label}: forced reap retry`,
      );
      assert.equal(statusRaw(dir), before, `${label}: retry changed nothing`);
    });
  }
});

test('markStopped is not an authorization to destroy un-captured content', async (t) => {
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
  assert.equal(readFileSync(join(dir, 'partial.txt'), 'utf8'), 'partial work from an aborted run\n');
  assertIntact(f, id, dir);
});

test('no caller option is an authorization to destroy un-captured content', async (t) => {
  // The names below are the shape a deletion-policy API would take. None of them is one: the
  // boundary has no caller-supplied authority to delete source, so they are inert.
  const options = () => ({
    force: true, deleteBranch: true,
    discard: { reason: 'invented authorization', evidenceRef: 'refs/anything', actor: 'test:operator' },
    authorizeDiscard: () => ({ reason: 'invented authorization' }),
    disposablePaths: ['src'],
    beforeRemove: () => true,
  });

  await t.test('reap() retains content whatever the caller passes', async () => {
    const f = makeRepo('no-authority-reap');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const { id, dir } = await ownedCheckout(f, { attemptId: 'no-authority-reap' });
    mkdirSync(join(dir, 'src', 'private'), { recursive: true });
    writeFileSync(join(dir, 'src', 'private', 'notes.md'), 'unrecorded design notes\n');
    writeFileSync(join(dir, 'README.md'), '# base\nedited\n');
    const before = statusRaw(dir);

    await rejectsPreservation(
      reap(f.root, id, options()),
      'workspace_uncommitted_content_retained', 'caller-supplied options',
    );

    assert.equal(statusRaw(dir), before, 'the options changed nothing');
    assert.equal(readFileSync(join(dir, 'src', 'private', 'notes.md'), 'utf8'), 'unrecorded design notes\n');
    assertIntact(f, id, dir);
  });

  await t.test('reconcile() retains content whatever the caller passes', async () => {
    const f = makeRepo('no-authority-reconcile');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const { id, dir } = await ownedCheckout(f, { attemptId: 'no-authority-reconcile' });
    writeFileSync(join(dir, 'README.md'), '# base\ndead owner work\n');
    const before = statusRaw(dir);
    const settled = [];

    const report = reconcile(f.root, [], {
      ...options(),
      ownerAuthority: restartAuthority(),
      beforeOwnerCleanup: (physicalOwnerId) => { settled.push(physicalOwnerId); return true; },
    });

    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.removedPhysicalOwners, [], 'nothing is removed');
    assert.deepEqual(settled, [], 'a retained resource is never settled');
    assert.deepEqual(report.retainedContentOwners, [id]);
    assert.ok(report.diagnostics.some((row) => (
      row.physicalOwnerId === id && row.code === 'workspace_uncommitted_content_retained' && row.retained === true
    )));
    assert.equal(statusRaw(dir), before);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# base\ndead owner work\n');
    assert.equal(existsSync(receiptPath(f.root, id)), true, 'owner receipt retained');
  });
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

// ---------- attested runtime infrastructure is generated, not un-captured content ----------

test('attested runtime infrastructure is generated, not un-captured content', async (t) => {
  await t.test('metadata-attested copied dependency', async () => {
    const f = makeRepo('deps');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    mkdirSync(join(f.root, 'deps', 'runtime'), { recursive: true });
    writeFileSync(join(f.root, 'deps', 'runtime', 'index.js'), 'module.exports = 1;\n');
    const handle = await createFromBase(f.root, 'copied-dependency', f.baseSha, { dependencyDirs: ['deps'] });
    assert.equal(existsSync(join(handle.dir, 'deps', 'runtime', 'index.js')), true);

    const observation = observeOwnedWorktreeContent(f.root, 'copied-dependency');
    assert.deepEqual(observation.generatedRoots, ['deps']);
    assert.deepEqual(observation.dirtyPaths, [], 'a declared dependency copy is not un-captured work');
    assert.equal(observation.removable, true);

    await reap(f.root, 'copied-dependency', { force: true, deleteBranch: true });
    assert.equal(existsSync(handle.dir), false);
  });

  await t.test('metadata-attested copied dependency that Git also ignores', async () => {
    const f = makeRepo('deps-ignored', { ignore: ['deps/'] });
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    mkdirSync(join(f.root, 'deps', 'runtime'), { recursive: true });
    writeFileSync(join(f.root, 'deps', 'runtime', 'index.js'), 'module.exports = 1;\n');
    const handle = await createFromBase(f.root, 'deps-ignored', f.baseSha, { dependencyDirs: ['deps'] });

    const observation = observeOwnedWorktreeContent(f.root, 'deps-ignored');
    assert.deepEqual(observation.generatedRoots, ['deps']);
    assert.deepEqual(observation.dirtyPaths, []);
    assert.deepEqual(observation.generatedPaths, ['deps'], 'the ignored dependency tree is attested, not unproven');
    assert.equal(observation.state, 'generated');
    assert.equal(observation.removable, true);

    await reap(f.root, 'deps-ignored', { force: true, deleteBranch: true });
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
    assert.deepEqual(observation.dirtyPaths, [], `projection targets are attested, not un-captured content: ${JSON.stringify(observation.dirtyPaths)}`);
    assert.deepEqual(observation.generatedRoots, ['tools/runtime']);
    assert.equal(observation.removable, true);

    await reap(f.root, 'projected-toolchain', { force: true, deleteBranch: true });
    assert.equal(existsSync(handle.dir), false);
    assert.equal(existsSync(join(f.root, '.baton', 'wt', 'projected-toolchain.projection.exclude')), false);
  });

  await t.test('an un-attested look-alike is un-captured content, not infrastructure', async () => {
    const f = makeRepo('unattested');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const { id, dir } = await ownedCheckout(f, { attemptId: 'unattested-residue' });
    mkdirSync(join(dir, 'generated'), { recursive: true });
    writeFileSync(join(dir, 'generated', 'report.json'), '{}\n');

    const observation = observeOwnedWorktreeContent(f.root, id);
    assert.deepEqual(observation.generatedRoots, [], 'nothing but owner metadata attests infrastructure');
    assert.deepEqual(observation.dirtyPaths, ['generated/report.json']);

    await rejectsPreservation(
      reap(f.root, id, { force: true, deleteBranch: true }),
      'workspace_uncommitted_content_retained', 'unattested residue',
    );
    assert.equal(readFileSync(join(dir, 'generated', 'report.json'), 'utf8'), '{}\n');
  });
});

test('an attested dependency tree is not walked file by file', async (t) => {
  const f = makeRepo('attested-scale');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  mkdirSync(join(f.root, 'deps'));
  for (let index = 0; index < 1_500; index += 1) {
    const dir = join(f.root, 'deps', `pkg${index % 25}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `module${index}.js`), 'module.exports = 1;\n');
  }
  const handle = await createFromBase(f.root, 'attested-scale', f.baseSha, { dependencyDirs: ['deps'] });

  const observation = observeOwnedWorktreeContent(f.root, 'attested-scale');
  assert.deepEqual(observation.generatedRoots, ['deps']);
  assert.deepEqual(observation.dirtyPaths, []);
  assert.equal(observation.state, 'clean',
    'the attested tree is excluded from the walk instead of enumerated path by path');
  assert.equal(observation.removable, true);

  await reap(f.root, 'attested-scale', { force: true, deleteBranch: true });
  assert.equal(existsSync(handle.dir), false);
});

test('attested infrastructure never hides force-added source from preservation', async (t) => {
  const f = makeRepo('force-added-dependency');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  mkdirSync(join(f.root, 'deps'));
  writeFileSync(join(f.root, 'deps/vendor.js'), 'generated\n');
  const handle = await createFromBase(f.root, 'force-added', f.baseSha, { dependencyDirs: ['deps'] });
  writeFileSync(join(handle.dir, 'deps/vendor.js'), 'intentional local source change\n');
  git(handle.dir, ['add', '-f', 'deps/vendor.js']);
  const before = statusRaw(handle.dir);
  const observed = observeOwnedWorktreeContent(f.root, 'force-added');
  assert.equal(observed.removable, false);
  assert.ok(observed.dirtyPaths.includes('deps/vendor.js'));
  await rejectsPreservation(reap(f.root, 'force-added', { force: true, deleteBranch: true }),
    'workspace_uncommitted_content_retained', 'tracked source inside generated directory');
  assert.equal(statusRaw(handle.dir), before);
  assert.equal(readFileSync(join(handle.dir, 'deps/vendor.js'), 'utf8'), 'intentional local source change\n');
});

// ---------- unknown content is not permission ----------

test('a directory that is not this repository\'s checkout is retained', async (t) => {
  await t.test('another repository checked out at the owned path', async () => {
    const f = makeRepo('foreign-repo');
    t.after(() => rmSync(f.world, { recursive: true, force: true }));
    const dir = join(f.root, '.baton', 'wt', 'foreign-checkout');
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q']);
    Object.assign(process.env, { GIT_AUTHOR_NAME: 'Foreign Fixture', GIT_COMMITTER_NAME: 'Foreign Fixture' });
    Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'foreign@example.invalid', GIT_COMMITTER_EMAIL: 'foreign@example.invalid' });
    writeFileSync(join(dir, 'foreign.txt'), 'another repository worktree\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'foreign base']);
    const before = statusRaw(dir);

    // Its top level matches the directory it was given, so only the repository identity proves it
    // is not a checkout this owner ever had.
    assert.equal(realpathSync(git(dir, ['rev-parse', '--show-toplevel'])), realpathSync(dir));
    const observation = observeOwnedWorktreeContent(f.root, 'foreign-checkout');
    assert.equal(observation.state, 'unobservable');
    assert.equal(observation.removable, false);

    await rejectsPreservation(
      reap(f.root, 'foreign-checkout', { force: true }),
      'workspace_content_unobservable_retained', 'foreign checkout reap',
    );
    assert.equal(statusRaw(dir), before);
    assert.equal(readFileSync(join(dir, 'foreign.txt'), 'utf8'), 'another repository worktree\n');
    assert.equal(existsSync(dir), true);
  });

  await t.test('a checkout Git can no longer observe', async () => {
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
    assert.equal(readFileSync(join(dir, 'unrecorded.txt'), 'utf8'), 'not reachable through any capture\n');
    assert.equal(existsSync(dir), true);
  });
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
  assert.ok(report.retainedExpectedOwners.includes(dirty.id),
    'the retained checkout stays in the retained set, so its reservation is not dropped');
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

test('reconcile() retains a dead owner\'s checkout whose only difference is Git-ignored content', async (t) => {
  const f = makeRepo('startup-ignored', { ignore: ['.env', 'notes/'] });
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const { id, dir } = await ownedCheckout(f, { attemptId: 'startup-ignored' });
  writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgres://localhost/dev\n');
  mkdirSync(join(dir, 'notes'), { recursive: true });
  writeFileSync(join(dir, 'notes', 'todo.md'), 'finish the migration notes\n');
  const before = statusRaw(dir);
  const settled = [];

  const report = reconcile(f.root, [], {
    ownerAuthority: restartAuthority(),
    beforeOwnerCleanup: (physicalOwnerId) => { settled.push(physicalOwnerId); return true; },
  });

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.removedPhysicalOwners, []);
  assert.deepEqual(settled, [], 'an ignored-content retention settles no capacity');
  assert.deepEqual(report.retainedContentOwners, [id]);
  const diagnostic = report.diagnostics.find((row) => row.physicalOwnerId === id && row.retained === true);
  assert.equal(diagnostic.code, 'workspace_uncommitted_content_retained');
  assert.equal(diagnostic.contentState, 'dirty');
  assert.deepEqual([...diagnostic.dirtyPaths].sort(), ['.env', 'notes']);

  assert.equal(statusRaw(dir), before, 'ignored content is byte-identical after the refusal');
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'DATABASE_URL=postgres://localhost/dev\n');
  assert.equal(readFileSync(join(dir, 'notes', 'todo.md'), 'utf8'), 'finish the migration notes\n');
  assert.equal(existsSync(receiptPath(f.root, id)), true, 'owner receipt retained');
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

// ---------- the observation interface itself ----------

test('the observation reports absence and identity without touching anything', async (t) => {
  const f = makeRepo('observation');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const { id, dir } = await ownedCheckout(f, { attemptId: 'observation' });

  const clean = observeOwnedWorktreeContent(f.root, id);
  assert.equal(clean.state, 'clean');
  assert.equal(clean.removable, true);
  assert.equal(clean.dir, dir);
  assert.equal(clean.physicalOwnerId, id);
  assert.equal(clean.baseSha, f.baseSha);
  assert.equal(clean.headSha, f.baseSha);
  assert.ok(Object.isFrozen(clean));

  assert.equal(observeOwnedWorktreeContent(f.root, 'never-allocated').state, 'absent');
  assert.equal(observeOwnedWorktreeContent(f.root, 'never-allocated').removable, true);
  assert.throws(() => observeOwnedWorktreeContent(f.root, '../escape'), TypeError);
});
