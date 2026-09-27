// Issue #285, G-42 (red pin): the capacity lock wait yields the caller's event loop, and reads
// never wait on the lock at all.
//
// Three facts, each red on the pre-fix source:
//  (a) an acquisition that meets a live holder keeps the caller's event loop free for the whole
//      wait — the pre-fix `Atomics.wait` slices froze the loop until the deadline, so a heartbeat
//      timer could not fire once, and the same typed pre-effect refusal still lands at the
//      deadline;
//  (b) `snapshot()`/`floor()` observe the ledger while a writer holds the lock — the state is one
//      atomically renamed file — where the pre-fix read took the lock, waited, and refused;
//  (c) the uncontended round trip still reserves, materializes and releases against real bytes.
//
// The holder is the test process itself: a planted `{pid: process.pid}` owner record is live by
// the protocol's own liveness probe and nothing releases it, so the wait is deterministic instead
// of timing-dependent.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorktreeCapacityAuthority, loadOrCreateWorktreeCapacityIntegrityKey } from '../src/worktree-capacity.mjs';

const REFUSAL_CODE = 'worktree_capacity_unavailable';
const HEARTBEAT_MS = 5;
const WAIT_MS = 250;

const POLICY = Object.freeze({
  maxReservedBytes: 10_000_000, maxReservedInodes: 100_000,
  minFreeBytes: 100, minFreeInodes: 10,
  runtimeReserveBytes: 20, runtimeReserveInodes: 2,
});
const REQUEST = Object.freeze({
  baseSha: 'a'.repeat(40),
  sparseCheckoutIdentity: { digest: 'b'.repeat(64) },
  toolchainProjection: null,
  toolchainProjectionTargetParents: [],
});

function repoWorld(t, label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-285-g42-${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(repo, { mode: 0o700 });
  return { dir, repo, capacity: join(repo, '.baton', 'capacity') };
}

function authorityFor(repo, { lockWaitMs } = {}) {
  return new WorktreeCapacityAuthority({
    repoRoot: repo, policy: POLICY, integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(repo),
    estimate: () => ({ bytes: 60, inodes: 5 }),
    observe: () => ({ freeBytes: 10_000_000, freeInodes: 100_000 }),
    ...(lockWaitMs === undefined ? {} : { lockWaitMs }),
  });
}

/** Plant a live owner record at the lock path: the protocol reads it as a live holder, and no
 * release ever removes it, so an acquisition must wait the full deadline and refuse. */
function plantLiveLock(world) {
  mkdirSync(world.capacity, { recursive: true, mode: 0o700 });
  const path = join(world.capacity, 'lock');
  writeFileSync(path, `${JSON.stringify({
    schemaVersion: 1, pid: process.pid, ownerId: 'c'.repeat(32), generation: 'd'.repeat(32),
  })}\n`, { mode: 0o600 });
  return path;
}

function heartbeat(intervalMs) {
  const state = { fired: 0 };
  const timer = setInterval(() => { state.fired += 1; }, intervalMs);
  timer.unref();
  return { timer, state };
}

test('G-42a: a contended acquisition keeps the event loop free and still refuses at the deadline', async (t) => {
  const world = repoWorld(t, 'contended');
  const authority = authorityFor(world.repo, { lockWaitMs: WAIT_MS });
  const planted = plantLiveLock(world);
  const plantedPayload = readFileSync(planted, 'utf8');

  const { timer, state } = heartbeat(HEARTBEAT_MS);
  const began = performance.now();
  let refusal = null;
  try {
    await authority.reserve('worker:contended', REQUEST);
  } catch (error) {
    refusal = error;
  }
  const elapsed = performance.now() - began;
  clearInterval(timer);

  assert.equal(refusal?.code, REFUSAL_CODE, `the wait must refuse typed, not resolve: ${refusal?.message}`);
  assert.equal(refusal?.lockContention, true, 'and the refusal is identified as pre-effect contention');
  assert.equal(refusal?.holderPid, process.pid, 'naming the live holder it waited on');
  assert.match(refusal.message, /wait deadline/u);
  assert.ok(elapsed >= WAIT_MS && elapsed < 10_000, `the wait is bounded by the deadline (${Math.round(elapsed)}ms)`);
  assert.ok(state.fired >= WAIT_MS / (HEARTBEAT_MS * 4),
    `the caller's event loop was frozen for the wait (${state.fired} heartbeat beats in ${Math.round(elapsed)}ms)`);
  assert.equal(readFileSync(planted, 'utf8'), plantedPayload, 'the live holder record is untouched');
  assert.equal(existsSync(join(world.capacity, 'reservations.json')), false,
    'the refusal is pre-effect: no ledger byte was written');
});

test('G-42b: reads observe the ledger while the lock is held, without waiting', (t) => {
  const world = repoWorld(t, 'reads');
  const planted = plantLiveLock(world);

  const reader = authorityFor(world.repo, { lockWaitMs: WAIT_MS });
  const began = performance.now();
  const snapshot = reader.snapshot();
  const floor = reader.floor();
  const elapsed = performance.now() - began;

  assert.deepEqual(snapshot.reservations, [], 'the committed state reads without the lock');
  assert.equal(snapshot.totals.bytes, 0);
  assert.ok(Number.isSafeInteger(floor.bytes) && Number.isSafeInteger(floor.inodes),
    'the effective floor resolves from the same read');
  assert.ok(elapsed < WAIT_MS / 2, `a read waited on the lock (${Math.round(elapsed)}ms)`);
  assert.equal(readFileSync(planted, 'utf8').length > 0, true, 'the writer\'s own lock is untouched');
});

test('G-42c: the uncontended round trip reserves, materializes and releases', async (t) => {
  const world = repoWorld(t, 'round-trip');
  const authority = authorityFor(world.repo);
  const resourcePath = join(world.repo, '.baton', 'wt', 'ws-00000000000000000000000000000000');
  mkdirSync(resourcePath, { recursive: true, mode: 0o700 });

  const token = await authority.reserve('worker:ws-00000000000000000000000000000000', REQUEST);
  assert.equal(token.id, 'worker:ws-00000000000000000000000000000000');
  assert.deepEqual(authority.snapshot().reservations.map((row) => row.id), [token.id]);

  const materialized = await authority.materialize(token, resourcePath);
  assert.equal(typeof materialized.materializedAt, 'string', 'materialization records the observation');

  assert.deepEqual(await authority.releaseMany([materialized]), [true]);
  assert.deepEqual(authority.snapshot().reservations, [], 'the released row leaves the ledger');
  assert.equal(existsSync(join(world.capacity, 'lock')), false, 'no lock survives the round trip');
});
