// Issue #178 (kernel honesty finding, #169 audit instance 4): the `worktree_capacity_exceeded`
// refusal judged on numbers it then dropped. The orchestrator could not tell deferral from shrink
// without reading `df -h` and the reservations ledger by hand. These rows pin the payload the
// refusal must carry — the observed free space, the floor it was judged against, what is already
// reserved, the axis that breached, and the next action — beside the message that names them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { loadOrCreateWorktreeCapacityIntegrityKey, WorktreeCapacityAuthority } from '../src/index.mjs';
import { sparseCheckoutIdentity } from '../src/worktree.mjs';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fixture(label) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue178-${label}-`));
  const repo = join(world, 'repo');
  mkdirSync(repo);
  git(['init', '-q'], repo);
  git(['config', 'user.name', 'Baton Issue 178'], repo);
  git(['config', 'user.email', 'issue178@example.invalid'], repo);
  const path = join(repo, 'src/selected.txt');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'selected-tree-bytes\n');
  git(['add', '-A'], repo);
  git(['commit', '-qm', 'issue 178 fixture'], repo);
  return { world, repo, sha: git(['rev-parse', 'HEAD'], repo) };
}

// The measured halves are injected: the row is about what the refusal carries, never about the
// volume this host happens to have. 40 tree bytes + 20 runtime reserve bytes, 3 tree inodes + 2.
const VALID_POLICY = Object.freeze({
  maxReservedBytes: 1_000,
  maxReservedInodes: 100,
  minFreeBytes: 100,
  minFreeInodes: 10,
  runtimeReserveBytes: 20,
  runtimeReserveInodes: 2,
});

function injected() {
  return {
    estimate(request) {
      return {
        bytes: 40 + request.policy.runtimeReserveBytes,
        inodes: 3 + request.policy.runtimeReserveInodes,
      };
    },
    observe() { return { freeBytes: 10_000, freeInodes: 1_000 }; },
  };
}

function authority(f, policy) {
  const measured = injected();
  return new WorktreeCapacityAuthority({
    repoRoot: f.repo,
    policy,
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(f.repo),
    estimate: measured.estimate,
    observe: measured.observe,
  });
}

function request(f) {
  return {
    baseSha: f.sha,
    sparsePaths: [],
    sparseCheckoutIdentity: sparseCheckoutIdentity([]),
    toolchainProjection: null,
    toolchainProjectionTargetParents: [],
  };
}

// WC-P1: the observed numbers, the floor, the reserved outstanding, the axis, and the next action.
test('WC-P1: a byte-axis refusal carries free, floor, reserved, the breaching axis and the next action', async (t) => {
  const f = fixture('byte-axis');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  // One wave of 40 + 20 = 60 bytes against a 59-byte ceiling: the byte ceiling is what breaches.
  const capacity = authority(f, { ...VALID_POLICY, maxReservedBytes: 59 });

  await assert.rejects(
    capacity.reserveMany([{ id: 'worker:payload-byte-axis', request: request(f) }]),
    (error) => {
      assert.equal(error?.code, 'worktree_capacity_exceeded', 'the typed capacity code survives');
      assert.equal(error.freeBytes, 10_000, 'the observed free bytes ride the refusal');
      assert.equal(error.freeInodes, 1_000, 'the observed free inodes ride the refusal');
      assert.equal(error.minFreeBytes, 100, 'the floor the wave was judged against rides the refusal');
      assert.equal(error.minFreeInodes, 10, 'the inode floor rides the refusal');
      assert.equal(error.reservedBytes, 0, 'nothing was reserved outstanding yet');
      assert.equal(error.reservedInodes, 0, 'nothing was reserved outstanding yet');
      assert.equal(error.breachingAxis, 'bytes', 'the axis that breached is named');
      assert.equal(typeof error.next, 'string', 'the refusal names a next action');
      assert.ok(error.next.length > 0, 'the next action is not empty');
      assert.match(error.next, /release|free/u, 'the next action names what the operator can do');
      assert.match(error.message, /10000 bytes and 1000 inodes free/u,
        'the message still names the numbers the payload carries');
      return true;
    },
  );
  assert.deepEqual(capacity.snapshot().reservations, [], 'a refused wave reserves nothing');
});

// WC-P2: the same payload on the inode axis — the axis is derived, never a constant.
test('WC-P2: an inode-axis refusal names inodes as the breaching axis', async (t) => {
  const f = fixture('inode-axis');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  // The wave needs 3 + 2 = 5 inodes against a 4-inode ceiling; the byte side stays inside its own.
  const capacity = authority(f, { ...VALID_POLICY, maxReservedInodes: 4 });

  await assert.rejects(
    capacity.reserveMany([{ id: 'worker:payload-inode-axis', request: request(f) }]),
    (error) => {
      assert.equal(error?.code, 'worktree_capacity_exceeded');
      assert.equal(error.breachingAxis, 'inodes', 'the inode ceiling is the axis that breached');
      assert.equal(error.minFreeInodes, 10);
      assert.equal(error.reservedInodes, 0);
      assert.equal(typeof error.next, 'string');
      return true;
    },
  );
});

// WC-P3: the physical floor is its own axis of refusal, and a live reservation is what `reserved`
// reports — the two facts an orchestrator needs to tell "defer" from "shrink".
test('WC-P3: a floor refusal names the floor as the breaching axis and the live reservation as reserved', async (t) => {
  const f = fixture('floor-axis');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  // 1 000 free bytes minus the 60-byte wave leaves 940, under the configured 950-byte floor.
  const measured = injected();
  const floored = new WorktreeCapacityAuthority({
    repoRoot: f.repo,
    policy: { ...VALID_POLICY, maxReservedBytes: 1_000_000, minFreeBytes: 950 },
    integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(f.repo),
    estimate: measured.estimate,
    observe: () => ({ freeBytes: 1_000, freeInodes: 1_000 }),
  });

  await assert.rejects(
    floored.reserveMany([{ id: 'worker:payload-floor-axis', request: request(f) }]),
    (error) => {
      assert.equal(error?.code, 'worktree_capacity_exceeded');
      assert.equal(error.breachingAxis, 'bytes', 'the byte floor is what breached here');
      assert.equal(error.minFreeBytes, 950, 'the floor that breached rides the refusal');
      assert.equal(error.freeBytes, 1_000, 'the observation it was compared against rides too');
      assert.equal(typeof error.next, 'string');
      return true;
    },
  );

  // A settled reservation is the `reserved` half: the second wave breaches the 119-byte ceiling
  // with 60 bytes already outstanding, and the refusal reports exactly that.
  const queued = authority(f, { ...VALID_POLICY, maxReservedBytes: 119 });
  await queued.reserveMany([{ id: 'worker:payload-reserved-a', request: request(f) }]);
  await assert.rejects(
    queued.reserveMany([{ id: 'worker:payload-reserved-b', request: request(f) }]),
    (error) => {
      assert.equal(error?.code, 'worktree_capacity_exceeded');
      assert.equal(error.reservedBytes, 60, 'the outstanding reservation rides the refusal');
      assert.equal(error.reservedInodes, 5, 'its inodes ride too');
      assert.equal(error.estimateBytes, 60, 'the wave being refused is named separately');
      assert.equal(error.breachingAxis, 'bytes');
      assert.equal(typeof error.next, 'string');
      return true;
    },
  );
  assert.equal(queued.snapshot().reservations.length, 1, 'only the admitted wave is reserved');
});
