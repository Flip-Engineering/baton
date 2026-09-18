// Issue #285, lane custody-and-capacity — one row per giant-audit item this lane owns. Every row
// is RED on the pre-fix source and GREEN after it:
//
//   G-32  ONE whole-repository listing maxBuffer, derived in one place and taken by every git call
//   G-6   pinBaseSha's receipt names the stash COMMIT, never the moving name `stash@{0}`
//   G-5   the policy-digest refusal names the ledger and both digests, with a gracefulPath
//   G-35  reconcile keeps this authority's own live verify reservation
//   G-33  materialize derives the verify label from the reservation's recorded resource id
//   G-4   contribution_check_unconfirmed carries the new-checkId remedy as gracefulPath
//
// The G-32 fixture is a real repository of enough paths: 6000 tracked paths of ~226 bytes put
// every listing the cited calls run — `status` (~1.4 MB), `ls-tree -r -l -z` (~1.7 MB),
// `ls-tree -r --name-only -z` (~1.4 MB), `ls-files -t -z` (~1.4 MB) — past Node's 1 MiB default
// buffer, so the pre-fix code fails with ENOBUFS and nothing else. No clocks, no mocks of git.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ContributionService } from '../src/contribution-service.mjs';
import {
  DirtyRepoError, createFromBase, gitListingMaxBuffer, pinBaseSha, sparseCheckoutIdentity,
} from '../src/worktree.mjs';
import {
  WorktreeCapacityAuthority, loadOrCreateWorktreeCapacityIntegrityKey,
} from '../src/worktree-capacity.mjs';

const SHA_40 = /^[a-f0-9]{40}$/u;
const BULK_COUNT = 6000; // ls-tree -r -l -z over these paths is ~1.7 MB; status ~1.4 MB
const bulkPath = (index) => `bulk/${'p'.repeat(220)}-${String(index).padStart(5, '0')}`;

function sh(cmd, args, cwd, opts = {}) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    ...opts,
  }).trim();
}

/** A real git repository with one base commit. */
function makeRepo(label, files) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue285-${label}-`));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'issue285@example.invalid'], dir);
  sh('git', ['config', 'user.name', 'Issue 285'], dir);
  for (const [path, content] of files) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  sh('git', ['add', '-A'], dir);
  sh('git', ['commit', '-qm', 'issue285 fixture'], dir);
  return { dir, baseSha: sh('git', ['rev-parse', 'HEAD'], dir) };
}

function thrown(operation) {
  try { operation(); } catch (error) { return error; }
  throw new Error('the operation was expected to refuse');
}

async function rejection(operation) {
  try { await operation(); } catch (error) { return error; }
  throw new Error('the operation was expected to refuse');
}

const POLICY = Object.freeze({
  maxReservedBytes: 4096, maxReservedInodes: 64,
  minFreeBytes: 0, minFreeInodes: 0,
  runtimeReserveBytes: 512, runtimeReserveInodes: 4,
});

/** A capacity authority over its own repository with injected measurement, so every row below
 * exercises the ledger and the git calls under test rather than the filesystem's free space. */
function capacityFixture(label, policy = POLICY) {
  const { dir, baseSha } = makeRepo(label, [['src/selected.txt', 'selected\n']]);
  const integrityKey = loadOrCreateWorktreeCapacityIntegrityKey(dir);
  const authority = new WorktreeCapacityAuthority({
    repoRoot: dir,
    policy,
    integrityKey,
    estimate: () => ({ bytes: 40, inodes: 3 }),
    observe: () => ({ freeBytes: 1 << 30, freeInodes: 1 << 20 }),
  });
  const request = {
    baseSha, sparsePaths: [], sparseCheckoutIdentity: sparseCheckoutIdentity([]), toolchainProjection: null,
  };
  return { dir, baseSha, integrityKey, authority, request };
}

// ============================================================
// G-32 — one listing bound, derived in one place
// ============================================================

test('G-32: one derived bound carries every whole-repository git listing past Node\'s 1 MiB default', async (t) => {
  const { dir, baseSha } = makeRepo('g32', Array.from({ length: BULK_COUNT }, (_, index) => [bulkPath(index), 'x']));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const saved = process.env.BATON_GIT_LISTING_PATHS;
  t.after(() => {
    if (saved === undefined) delete process.env.BATON_GIT_LISTING_PATHS;
    else process.env.BATON_GIT_LISTING_PATHS = saved;
  });
  delete process.env.BATON_GIT_LISTING_PATHS;
  assert.ok(gitListingMaxBuffer() >= 64 * 1024 * 1024,
    'the ONE bound is the documented whole-repository derivation, at least the 64 MiB literal it replaces');
  // No git call carries a buffer literal of its own: the wrappers, and every call they serve, take
  // the ONE derivation. The only other maxBuffer in these two files is worktree.mjs's `/bin/ps`
  // probe, which bounds one process line and postchecks it at 256 bytes — never a git listing.
  for (const [relative, probeBounds] of [['worktree.mjs', 1], ['worktree-capacity.mjs', 0]]) {
    const source = readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
    const bounds = source.split('\n').filter((line) => /maxBuffer\s*:/u.test(line));
    const derived = bounds.filter((line) => line.includes('gitListingMaxBuffer()'));
    assert.ok(derived.length >= 1, `${relative}: the git wrapper takes the ONE derivation`);
    assert.equal(bounds.length - derived.length, probeBounds,
      `${relative}: every other buffer bound is the documented non-listing probe`);
    for (const call of source.match(/execFileSync\(\s*'git'[\s\S]*?\);/gu) ?? []) {
      assert.equal(/maxBuffer:\s*\d/u.test(call), false, `${relative} passes a per-call buffer literal to git`);
    }
  }

  // defaultEstimate — `git ls-tree -r -l -z` over the whole tree (~1.7 MB of stdout).
  const authority = new WorktreeCapacityAuthority({
    repoRoot: dir,
    policy: {
      maxReservedBytes: 8 * 1024 * 1024, maxReservedInodes: 100_000,
      minFreeBytes: 0, minFreeInodes: 0, runtimeReserveBytes: 1024, runtimeReserveInodes: 8,
    },
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(dir),
  });
  const request = {
    baseSha, sparsePaths: [], sparseCheckoutIdentity: sparseCheckoutIdentity([]), toolchainProjection: null,
  };
  const token = await authority.reserve('worker:g32-estimate', request);
  assert.ok(token.bytes >= BULK_COUNT && token.inodes >= BULK_COUNT,
    `the tree estimate read every path (bytes ${token.bytes}, inodes ${token.inodes})`);
  assert.equal(await authority.release(token), true);

  // trackedPathsAtCommit + assertSparseIndexState — `ls-tree --name-only -z` and `ls-files -t -z`
  // over the same tree, inside a sparse creation that validates its own index state.
  const created = await createFromBase(dir, 'g32-sparse', baseSha, { sparsePaths: [bulkPath(0)] });
  assert.equal(existsSync(join(created.dir, bulkPath(0))), true);
  assert.equal(existsSync(join(created.dir, bulkPath(1))), false);

  // isClean — `git status --porcelain` (~1.4 MB once every tracked path differs).
  for (let index = 0; index < BULK_COUNT; index += 1) writeFileSync(join(dir, bulkPath(index)), 'xy');
  await assert.rejects(() => pinBaseSha(dir), DirtyRepoError,
    'the status listing completes instead of failing with ENOBUFS');

  // The bound is configurable, and the wrappers really take it: 1000 paths' worth of bytes cannot
  // hold this listing, so the same call refuses with the raw ENOBUFS that the derivation prevents.
  process.env.BATON_GIT_LISTING_PATHS = '1000';
  const configured = gitListingMaxBuffer();
  assert.ok(configured < 2 * 1024 * 1024 && configured > 0, `the derived bound follows the deployment (${configured} bytes)`);
  const refused = await rejection(() => pinBaseSha(dir));
  assert.equal(refused?.code, 'ENOBUFS', 'the configured derivation gates the git call');
});

// ============================================================
// G-6 — the receipt names the stash commit
// ============================================================

test('G-6: pinBaseSha records the stash commit, and a later stash does not move that identity', async (t) => {
  const { dir, baseSha } = makeRepo('g6', [['operator-work.txt', 'committed\n']]);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'operator-work.txt'), 'uncommitted operator work\n');

  const pinned = await pinBaseSha(dir, { autoStash: true });
  assert.equal(pinned.stashed, true);
  assert.equal(pinned.sha, baseSha);
  assert.match(pinned.stashSha ?? '', SHA_40, 'the receipt carries the stash COMMIT');
  assert.equal(sh('git', ['rev-parse', '--verify', `${pinned.stashSha}^{commit}`], dir), pinned.stashSha);
  assert.equal(pinned.stashSha, sh('git', ['rev-parse', '--verify', 'refs/stash'], dir),
    'the recorded identity is the stash this pin pushed');
  assert.equal(sh('git', ['show', `${pinned.stashSha}:operator-work.txt`], dir), 'uncommitted operator work');

  // A second stash re-points the name `stash@{0}`. The recorded identity still names the commit
  // holding THIS pin's parked work, and that work is still parked (W4: never auto-popped).
  writeFileSync(join(dir, 'operator-work.txt'), 'later operator work\n');
  sh('git', ['stash', 'push', '-u', '-m', 'later-stash'], dir);
  assert.notEqual(sh('git', ['rev-parse', '--verify', 'refs/stash'], dir), pinned.stashSha,
    'stash@{0} is a moving name, and the fixture moved it');
  assert.equal(sh('git', ['show', `${pinned.stashSha}:operator-work.txt`], dir), 'uncommitted operator work',
    'the recorded identity still names the commit that carries the pinned work');
  assert.ok(sh('git', ['stash', 'list', '--format=%H'], dir).split('\n').includes(pinned.stashSha),
    'the pinned stash is still in the stash list');
});

// ============================================================
// G-5 — the policy-digest refusal names the ledger
// ============================================================

test('G-5: the policy-digest refusal names the ledger, both digests, and the gracefulPath', async (t) => {
  const fixture = capacityFixture('g5');
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }));
  const ledger = join('.baton', 'capacity', 'reservations.json');
  const live = await fixture.authority.reserve('verify:policy-change:1', fixture.request);
  assert.equal(typeof live.id, 'string');
  assert.equal(existsSync(join(fixture.dir, ledger)), true,
    'the named ledger is the file the authority really writes');
  const changed = new WorktreeCapacityAuthority({
    repoRoot: fixture.dir,
    policy: { ...POLICY, maxReservedBytes: POLICY.maxReservedBytes * 2 },
    integrityKey: fixture.integrityKey,
    estimate: () => ({ bytes: 40, inodes: 3 }),
    observe: () => ({ freeBytes: 1 << 30, freeInodes: 1 << 20 }),
  });

  const error = await rejection(() => changed.reserve('verify:policy-change:2', fixture.request));
  assert.equal(error?.code, 'worktree_capacity_unavailable');
  assert.equal(error.ledger, ledger);
  assert.equal(error.statePolicyDigest, fixture.authority.policy.digest);
  assert.equal(error.policyDigest, changed.policy.digest);
  assert.notEqual(error.statePolicyDigest, error.policyDigest);
  for (const value of [ledger, error.statePolicyDigest, error.policyDigest]) {
    assert.ok(error.message.includes(value), `the refusal names ${value}`);
  }
  assert.equal(typeof error.gracefulPath, 'string');
  assert.ok(error.gracefulPath.includes(ledger), 'the gracefulPath names the ledger to inspect');
  assert.match(error.gracefulPath, /settle or clear/u, 'the gracefulPath names the remedy');
  assert.ok(error.message.includes(error.gracefulPath), 'the message carries the same path phrase');

  // The refusal is pre-effect: the live reservation it refuses over is untouched.
  assert.deepEqual(fixture.authority.snapshot().reservations.map((row) => row.id),
    ['verify:policy-change:1']);
});

// ============================================================
// G-35 — reconcile keeps this authority's own live verify reservation
// ============================================================

test('G-35: reconcile keeps this authority\'s own live verify reservation and settles a dead owner\'s', async (t) => {
  const fixture = capacityFixture('g35');
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }));
  const token = await fixture.authority.reserve('verify:live-in-process:1', fixture.request);
  await fixture.authority.reserve('verify:dead-owner:1', fixture.request);
  const before = fixture.authority.snapshot().reservations;
  assert.equal(before.find((row) => row.id === token.id).ownerId, fixture.authority.ownerId);
  assert.equal(before.find((row) => row.id === token.id).pid, process.pid,
    'the scenario is real: this authority\'s own verification, alive in this process');

  // A verifier whose process is gone is settled — preservation must never leak capacity.
  const statePath = join(fixture.dir, '.baton', 'capacity', 'reservations.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const reservations = state.reservations.map((row) => (
    row.id === 'verify:dead-owner:1' ? { ...row, pid: 2_147_483_647 } : row
  ));
  writeFileSync(statePath, `${JSON.stringify(fixture.authority._seal({ ...state, reservations }), null, 2)}\n`,
    { mode: 0o600 });

  const report = await fixture.authority.reconcile([]);
  assert.deepEqual(report.removed, ['verify:dead-owner:1'], 'only the proved-dead owner is settled');
  assert.deepEqual(report.retainedVerifiers, ['verify:live-in-process:1']);
  const after = fixture.authority.snapshot().reservations;
  assert.deepEqual(after.map((row) => row.id), ['verify:live-in-process:1']);

  // The surviving reservation is still exactly usable: the in-flight verification materializes
  // its own coordinate, and only its owner's release takes it out of the ledger.
  const resourcePath = join(fixture.dir, '.baton', 'verify', 'live-in-process-abcd0123');
  mkdirSync(resourcePath, { recursive: true });
  const materialized = await fixture.authority.materialize(token, resourcePath);
  assert.equal(typeof materialized.materializedAt, 'string',
    'the surviving reservation materializes after reconcile');
  assert.equal(await fixture.authority.release(token), true, 'its owner releases it');
  assert.deepEqual(fixture.authority.snapshot().reservations, []);
});

// ============================================================
// G-33 — the verify label comes from recorded fields, not an id shape
// ============================================================

test('G-33: materialize derives the verify label from the reservation\'s recorded resource id', async (t) => {
  const fixture = capacityFixture('g33');
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }));
  const materializeInto = (name) => {
    const path = join(fixture.dir, '.baton', 'verify', name);
    mkdirSync(path, { recursive: true });
    return path;
  };

  // A resourceId with no separator segment: the whole field IS the label, and no character of it
  // is dropped.
  const whole = await fixture.authority.reserve('verify:separatorless-label', fixture.request);
  const wholeMaterialized = await fixture.authority.materialize(whole, materializeInto('separatorless-label-0123abcd'));
  assert.equal(typeof wholeMaterialized.materializedAt,
    'string', 'a label without a separator is taken whole');

  // The composed deployment shape `verify:<label>:<sequence>` resolves the same label.
  const composed = await fixture.authority.reserve('verify:composed-label:1', fixture.request);
  const composedMaterialized = await fixture.authority.materialize(composed, materializeInto('composed-label-0123abcd'));
  assert.equal(typeof composedMaterialized.materializedAt, 'string');

  // The identity guard still refuses a directory that is not this reservation's label.
  const foreign = await fixture.authority.reserve('verify:composed-label:2', fixture.request);
  const refused = await rejection(() => fixture.authority.materialize(foreign, materializeInto('someone-else-0123abcd')));
  assert.equal(refused?.code, 'worktree_capacity_unavailable');
});

// ============================================================
// G-4 — the unconfirmed-check refusal carries its remedy
// ============================================================

test('G-4: a spent check identity refuses with the new-checkId gracefulPath', async () => {
  const serviceFor = (events) => new ContributionService({
    worktrees: { async resolveCheckpoint() { return null; } },
    referee: null, accept: () => true, acceptOptions: {}, capture: async () => ({}),
    record: () => {}, events: () => events, closeVerdict: () => null,
  });
  const handle = { id: 'w-1' };
  const task = { id: 't-1', brief: { verification: { command: 'true', expectExit: 0 } } };

  // A started check with no verdict and no recorded unavailability.
  const bare = await rejection(() => serviceFor([
    { kind: 'contribution.check_started', payload: { contributionId: 'c-1', checkId: 'spent' } },
  ]).check({ handle, task, contributionId: 'c-1', checkId: 'spent' }));
  assert.equal(bare.code, 'contribution_check_unconfirmed');
  assert.match(bare.gracefulPath ?? '', /mint a new checkId/u, 'the remedy travels on the error');
  assert.match(bare.gracefulPath, /c-1/u);
  assert.match(bare.gracefulPath, /spent/u);
  assert.ok(bare.message.includes(bare.gracefulPath), 'the message carries the same path phrase');

  // A recorded unavailability keeps its own code and its attempt, and still names the remedy.
  const recorded = await rejection(() => serviceFor([
    { kind: 'contribution.check_started', payload: { contributionId: 'c-1', checkId: 'spent-2' } },
    {
      kind: 'contribution.check_unavailable',
      payload: { contributionId: 'c-1', checkId: 'spent-2', code: 'worktree_capacity_exceeded', attempt: { verifierStarted: false } },
    },
  ]).check({ handle, task, contributionId: 'c-1', checkId: 'spent-2' }));
  assert.equal(recorded.code, 'worktree_capacity_exceeded');
  assert.deepEqual(recorded.verificationAttempt, { verifierStarted: false });
  assert.match(recorded.gracefulPath ?? '', /mint a new checkId/u);
});
