// Issue #285, lane custody-and-capacity — one row per giant-audit item this lane owns. Every row
// is RED on the pre-fix source and GREEN after it:
//
//   G-32  ONE whole-repository listing maxBuffer, derived in one place and taken by every git call
//   G-6   pinBaseSha's receipt names the stash COMMIT, never the moving name `stash@{0}`
//   G-5   the policy-digest refusal names the ledger and both digests, with a gracefulPath
//   G-35  reconcile keeps this authority's own live verify reservation
//   G-33  materialize derives the verify label from the reservation's recorded resource id
//   G-4   contribution_check_unconfirmed carries the new-checkId remedy as gracefulPath
//   G-7   a startup failure keeps the counts the open had, and the archived replay reports progress
//   G-42  the capacity lock wait yields the event loop, and the live admission path takes it
//
// The G-32 fixture is a real repository of enough paths: 6000 tracked paths of ~226 bytes put
// every listing the cited calls run — `status` (~1.4 MB), `ls-tree -r -l -z` (~1.7 MB),
// `ls-tree -r --name-only -z` (~1.4 MB), `ls-files -t -z` (~1.4 MB) — past Node's 1 MiB default
// buffer, so the pre-fix code fails with ENOBUFS and nothing else. No clocks, no mocks of git.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ContributionService } from '../src/contribution-service.mjs';
import { CoordinationStore, loadCoordinationStoreAsync } from '../src/coordination-store.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import {
  DirtyRepoError, createFromBase, gitListingMaxBuffer, pinBaseSha, sparseCheckoutIdentity,
} from '../src/worktree.mjs';
import {
  WorktreeCapacityAuthority, loadOrCreateWorktreeCapacityIntegrityKey,
} from '../src/worktree-capacity.mjs';
import { createBrief, createDriver, MockAdapter } from '../src/index.mjs';

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
  const token = authority.reserve('worker:g32-estimate', request);
  assert.ok(token.bytes >= BULK_COUNT && token.inodes >= BULK_COUNT,
    `the tree estimate read every path (bytes ${token.bytes}, inodes ${token.inodes})`);
  assert.equal(authority.release(token), true);

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

test('G-5: the policy-digest refusal names the ledger, both digests, and the gracefulPath', (t) => {
  const fixture = capacityFixture('g5');
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }));
  const ledger = join('.baton', 'capacity', 'reservations.json');
  const live = fixture.authority.reserve('verify:policy-change:1', fixture.request);
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

  const error = thrown(() => changed.reserve('verify:policy-change:2', fixture.request));
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

test('G-35: reconcile keeps this authority\'s own live verify reservation and settles a dead owner\'s', (t) => {
  const fixture = capacityFixture('g35');
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }));
  const token = fixture.authority.reserve('verify:live-in-process:1', fixture.request);
  fixture.authority.reserve('verify:dead-owner:1', fixture.request);
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

  const report = fixture.authority.reconcile([]);
  assert.deepEqual(report.removed, ['verify:dead-owner:1'], 'only the proved-dead owner is settled');
  assert.deepEqual(report.retainedVerifiers, ['verify:live-in-process:1']);
  const after = fixture.authority.snapshot().reservations;
  assert.deepEqual(after.map((row) => row.id), ['verify:live-in-process:1']);

  // The surviving reservation is still exactly usable: the in-flight verification materializes
  // its own coordinate, and only its owner's release takes it out of the ledger.
  const resourcePath = join(fixture.dir, '.baton', 'verify', 'live-in-process-abcd0123');
  mkdirSync(resourcePath, { recursive: true });
  assert.equal(typeof fixture.authority.materialize(token, resourcePath).materializedAt, 'string',
    'the surviving reservation materializes after reconcile');
  assert.equal(fixture.authority.release(token), true, 'its owner releases it');
  assert.deepEqual(fixture.authority.snapshot().reservations, []);
});

// ============================================================
// G-33 — the verify label comes from recorded fields, not an id shape
// ============================================================

test('G-33: materialize derives the verify label from the reservation\'s recorded resource id', (t) => {
  const fixture = capacityFixture('g33');
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }));
  const materializeInto = (name) => {
    const path = join(fixture.dir, '.baton', 'verify', name);
    mkdirSync(path, { recursive: true });
    return path;
  };

  // A resourceId with no separator segment: the whole field IS the label, and no character of it
  // is dropped.
  const whole = fixture.authority.reserve('verify:separatorless-label', fixture.request);
  assert.equal(typeof fixture.authority.materialize(whole, materializeInto('separatorless-label-0123abcd')).materializedAt,
    'string', 'a label without a separator is taken whole');

  // The composed deployment shape `verify:<label>:<sequence>` resolves the same label.
  const composed = fixture.authority.reserve('verify:composed-label:1', fixture.request);
  assert.equal(typeof fixture.authority.materialize(composed, materializeInto('composed-label-0123abcd')).materializedAt,
    'string');

  // The identity guard still refuses a directory that is not this reservation's label.
  const foreign = fixture.authority.reserve('verify:composed-label:2', fixture.request);
  const refused = thrown(() => fixture.authority.materialize(foreign, materializeInto('someone-else-0123abcd')));
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


// ============================================================
// G-7 — the startup report keeps the counts it had, and the archived replay reports progress
// ============================================================

/** A synthetic ledger of `rows` coordination rows written as raw bytes (the #351 fixture shape):
 * cheap to build at the sizes the replay's own chunk bound needs, and a history the fold replays. */
function seedLedger(directory, rows) {
  mkdirSync(directory, { recursive: true });
  const chunks = [];
  for (let seq = 1; seq <= rows; seq += 1) {
    chunks.push(JSON.stringify({
      schemaVersion: 1, seq, ts: '2026-09-18T00:00:00.000Z', kind: 'mcp.audit', actor: 'issue285-fixture',
      idempotencyKey: `issue285:${seq}`, payload: { seq, tool: 'coordination.read', body: 'x'.repeat(120) },
    }));
    if (chunks.length === 4_096) { appendFileSync(join(directory, 'events.jsonl'), `${chunks.join('\n')}\n`); chunks.length = 0; }
  }
  if (chunks.length > 0) appendFileSync(join(directory, 'events.jsonl'), `${chunks.join('\n')}\n`);
}

test('G-7: a startup failure reports the counts the open already had, never zeros', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue285-g7-failure-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const rows = 5;
  const store = new CoordinationStore(directory);
  for (let seq = 1; seq <= rows; seq += 1) {
    store.recordDriver(`g7.row.${seq}`, { seq }, { actor: 'test:issue285', key: `issue285:g7:${seq}` });
  }
  store.releaseWriterLease({ requireOwned: true });
  // The release wrote a checkpoint covering every good row; drop it so the reopen folds the ledger
  // itself and the refusal is the FIRST failure the fold meets.
  rmSync(join(directory, 'projection.checkpoint'), { force: true });
  // A durable row the fold refuses (the legacy wave roster): replay dies at seq `rows + 1` after
  // folding every row before it.
  appendFileSync(join(directory, 'events.jsonl'), `${JSON.stringify({
    schemaVersion: 1, seq: rows + 1, ts: '2026-09-18T00:00:00.000Z', kind: 'driver.recorded',
    actor: 'legacy-store', idempotencyKey: 'issue285:g7:legacy',
    payload: { kind: 'wave.started', waveId: 'w-legacy', roster: 'garbage' },
  })}\n`);

  let failure = null;
  assert.throws(() => new CoordinationStore(directory, {
    startupProgress: (entry) => { failure = entry; },
  }), (error) => error?.code === 'wave_registry_invalid');
  assert.equal(failure.state, 'failed');
  assert.equal(failure.totalEvents, rows + 1, 'the failure names the ledger size the open had counted');
  assert.equal(failure.replayedEvents, rows, 'and how many rows it had folded when the fold refused');
  assert.equal(failure.checkpointEvents, 0, 'no row was served by a checkpoint');
});

test('G-7: the archived replay reports progress while the segments and the covered prefix are rebuilt', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue285-g7-progress-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const chunk = FRAME_LIMITS['view.wake_replay.items'].value;
  const rows = chunk * 4;
  const cut = chunk * 2 + 1;
  seedLedger(directory, rows);
  const writer = new CoordinationStore(directory);
  const receipt = writer.compact({ beforeSeq: cut });
  assert.equal(receipt.archivedThroughSeq, cut - 1, 'the fixture archives one segment of `cut - 1` rows');
  writer.releaseWriterLease({ requireOwned: true });

  const reopened = new CoordinationStore(directory, { deferLoad: true });
  const snapshots = [];
  let settled = false;
  const pending = loadCoordinationStoreAsync(reopened).then(
    () => { settled = true; },
    (error) => { settled = true; throw error; },
  );
  while (!settled) {
    snapshots.push(reopened.startupStatus());
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
  await pending;

  const segmentReports = snapshots.filter((entry) => entry.state === 'replaying'
    && entry.replayedEvents > 0 && entry.replayedEvents < cut - 1);
  assert.ok(segmentReports.length > 0,
    'the segment fold reports progress while the archived prefix is folded');
  const readReports = snapshots.filter((entry) => entry.state === 'replaying'
    && (entry.readEvents ?? 0) > 0 && (entry.readEvents ?? 0) < rows);
  assert.ok(readReports.length > 0, 'the covered-prefix rebuild reports its own progress');
  const status = reopened.startupStatus();
  assert.equal(status.state, 'ready');
  assert.equal(status.totalEvents, rows, 'the archived prefix is counted in the ledger size');
  assert.equal(status.replayedEvents, cut - 1, 'the rows whose fold ran are the archived prefix');
  assert.equal(status.checkpointEvents, rows - (cut - 1), 'the covered window is served by the checkpoint');
  assert.equal(status.checkpointEvents + status.replayedEvents, status.totalEvents,
    'every row is either served by the checkpoint or folded — the counts the open had are never dropped');
});


// ============================================================
// G-42 — the capacity lock wait yields the event loop
// ============================================================

const HOLD_MS = 600;         // how long the holder process owns the lock
const RELEASE_LAG_MS = 150;  // the gap between the holder's "my hold ends" signal and its release
const BEAT_MS = 5;           // the heartbeat the parent measures the loop's freedom with
const BEATS_FLOOR = 5;       // 600ms of a free loop beats far more than this; a blocked loop beats none

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function until(fn, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(5);
  }
  throw new Error(`timeout waiting for ${label}`);
}

/** A holder process that owns the repository lock across a real wait: it signals readiness from
 * inside the injected `observe` (called while the lock is held) and signals the end of its hold
 * just before releasing, so the parent measures the loop's freedom inside exactly that window. */
function holderSource() {
  return `
import fs from 'node:fs';
import { WorktreeCapacityAuthority, loadOrCreateWorktreeCapacityIntegrityKey } from ${JSON.stringify(new URL('../src/worktree-capacity.mjs', import.meta.url).href)};
const [repoRoot, readyPath, releasePath, policyJson, requestJson] = process.argv.slice(2);
const buffer = new Int32Array(new SharedArrayBuffer(4));
const authority = new WorktreeCapacityAuthority({
  repoRoot,
  policy: JSON.parse(policyJson),
  integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(repoRoot),
  estimate: () => ({ bytes: 40, inodes: 3 }),
  observe: () => {
    fs.writeFileSync(readyPath, 'held');
    Atomics.wait(buffer, 0, 0, ${HOLD_MS});
    fs.writeFileSync(releasePath, 'released');
    // The signal precedes the release by a real gap, so the parent's "it had not landed yet"
    // reading is a fact about the waiter rather than a race with the waiter's own poll.
    Atomics.wait(buffer, 0, 0, ${RELEASE_LAG_MS});
    return { freeBytes: 1 << 30, freeInodes: 1 << 20 };
  },
});
authority.reserve('worker:g42-holder', JSON.parse(requestJson));
`;
}

test('G-42: the promise-returning wave waits for the lock without freezing the event loop', async (t) => {
  const fixture = capacityFixture('g42-wait');
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }));
  const readyPath = join(fixture.dir, 'g42-ready');
  const releasePath = join(fixture.dir, 'g42-release');
  const childPath = join(fixture.dir, 'g42-holder.mjs');
  writeFileSync(childPath, holderSource());
  const holder = spawn(process.execPath, [
    childPath, fixture.dir, readyPath, releasePath, JSON.stringify(POLICY), JSON.stringify(fixture.request),
  ], { stdio: 'ignore' });
  t.after(() => { try { holder.kill('SIGKILL'); } catch { /* already gone */ } });
  await until(() => existsSync(readyPath), 'the holder to take the lock');

  const beats = { count: 0 };
  const timer = setInterval(() => { beats.count += 1; }, BEAT_MS);
  t.after(() => clearInterval(timer));
  let settled = false;
  const pending = fixture.authority.reserveManyAsync([{ id: 'worker:g42-async', request: fixture.request }])
    .then((rows) => { settled = true; return rows; });
  await until(() => existsSync(releasePath), 'the holder to end its hold');
  const beatsDuringHold = beats.count;
  assert.equal(settled, false, 'the async wave waits for the live holder instead of landing early');
  assert.ok(beatsDuringHold >= BEATS_FLOOR,
    `the event loop kept beating while the lock was held (${beatsDuringHold} beats)`);
  const rows = await pending;
  clearInterval(timer);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'worker:g42-async');
  assert.equal(fixture.authority.snapshot().reservations.some((row) => row.id === 'worker:g42-async'), true,
    'the wave landed under the same identity the sync cadence mints');
});

test('G-42: the advisory admission path reserves through the async cadence, never the blocking twin', async (t) => {
  const { dir } = makeRepo('g42-wire', [['src/selected.txt', 'selected\n']]);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logDir = mkdtempSync(join(tmpdir(), 'baton-issue285-g42-log-'));
  t.after(() => rmSync(logDir, { recursive: true, force: true }));
  const driver = createDriver({
    repoRoot: dir,
    logDir,
    repoId: 'issue285-g42',
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [] } }) },
    worktreeCapacity: POLICY,
    worktreeCapacityEstimate: () => ({ bytes: 40, inodes: 3 }),
    worktreeCapacityObserve: () => ({ freeBytes: 1 << 30, freeInodes: 1 << 20 }),
  });
  t.after(async () => {
    try { await driver.drainAndClose('issue285:g42-wire'); }
    catch { try { driver.coordination.releaseWriterLease(); } catch { /* best effort */ } }
  });
  await driver.ready;

  const facade = driver.coordinator._worktrees;
  const asyncCalls = [];
  const syncCalls = [];
  const reserveCapacityAsync = facade.reserveCapacityAsync.bind(facade);
  facade.reserveCapacityAsync = (...args) => { asyncCalls.push(args[0]); return reserveCapacityAsync(...args); };
  const reserveCapacity = facade.reserveCapacity.bind(facade);
  facade.reserveCapacity = (...args) => { syncCalls.push(args[0]); return reserveCapacity(...args); };

  await driver.coordinator.spawn('mock', createBrief({
    goal: 'reserve through the async cadence',
    constraints: [],
    pathScope: ['src/**'],
    definitionOfDone: 'the advisory admission took the promise-returning cadence',
    verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
    budget: { tokens: 1_000, usd: 1, wallMin: 1 },
  }), { taskId: 'g42-wire' });
  assert.deepEqual(asyncCalls, ['g42-wire'], 'the advisory spawn reserved through the promise-returning cadence');
  assert.deepEqual(syncCalls, [], 'and never through the blocking twin');
});
