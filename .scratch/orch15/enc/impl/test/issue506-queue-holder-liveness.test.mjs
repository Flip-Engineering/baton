// Issue #506: the host-capacity queue projection tells the truth about each holder — a dead
// holder's queue entry is named dead everywhere it is visible, and swept where the authority
// mutates. The reclaim half of the issue already exists (#sweep inside every observe()/acquire()
// mutex turn); what was missing is the liveness fact on the rows the view and the doctor read:
// observeNow() never mutates, so a dead front-of-queue holder sat in `swarm view`'s
// deployment.hostCapacity.queue indistinguishable from a live queued request — the observation
// behind the issue: one position-1 entry naming a left seat and a pid that no longer existed,
// unchanged for 90 minutes across every read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HostCapacityAuthority } from '../src/host-capacity.mjs';

const G = 1024 ** 3;

function leaseRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue506-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Stage one real queue record the way acquire() writes it: a private regular file the authority
 * validates with the exact QUEUE_FIELDS shape, named so bytewise order is FIFO order. */
function stageQueueEntry(root, entry) {
  mkdirSync(join(root, 'queue'), { recursive: true, mode: 0o700 });
  const path = join(root, 'queue', `queue-${entry.enqueuedAt}-${entry.nonce}.json`);
  writeFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

const deadEntry = {
  schemaVersion: 1, kind: 'verify', holder: 'participant:swarm-506:dead-seat',
  nonce: 'a'.repeat(32), pid: 3_999_001, residentId: 'resident-gone',
  enqueuedAt: '2026-09-19T01:22:34.571Z',
};
const liveEntry = {
  schemaVersion: 1, kind: 'verify', holder: 'participant:swarm-506:live-seat',
  nonce: 'b'.repeat(32), pid: process.pid, residentId: 'resident-here',
  enqueuedAt: '2026-09-19T01:25:00.000Z',
};

function authorityOver(root, liveness) {
  return new HostCapacityAuthority({
    root, residentId: 'issue506', liveness,
    observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 1 }),
    pollMs: 15,
  });
}

test('HC-506-a: observeNow names each queue holder alive or dead; a dead front holder never reads like a live queued request', async (t) => {
  const root = leaseRoot(t);
  stageQueueEntry(root, deadEntry);
  stageQueueEntry(root, liveEntry);
  const authority = authorityOver(root, (pid) => pid === process.pid);

  const queue = authority.observeNow().queue;
  assert.equal(queue.length, 2);
  assert.equal(queue[0].holder, deadEntry.holder);
  assert.equal(queue[0].holderAlive, false, 'the dead front holder reads dead on the non-mutating read');
  assert.equal(queue[1].holder, liveEntry.holder);
  assert.equal(queue[1].holderAlive, true, 'the live holder reads alive');
});

test('HC-506-b: the participant verify row carries the same fact for the seat it names', async (t) => {
  const root = leaseRoot(t);
  stageQueueEntry(root, deadEntry);
  stageQueueEntry(root, liveEntry);
  const authority = authorityOver(root, (pid) => pid === process.pid);

  assert.deepEqual(authority.observeParticipantVerify(deadEntry.holder),
    { state: 'queued', position: 1, ahead: 0, holderAlive: false },
    'a dead queued seat reads queued AND dead on the swarm view row');
  assert.deepEqual(authority.observeParticipantVerify(liveEntry.holder),
    { state: 'queued', position: 2, ahead: 1, holderAlive: true });
});

test('HC-506-c: the mutating read sweeps the dead entry (the reclaim half) and its row is gone, not stale', async (t) => {
  const root = leaseRoot(t);
  stageQueueEntry(root, deadEntry);
  stageQueueEntry(root, liveEntry);
  const authority = authorityOver(root, (pid) => pid === process.pid);

  const observed = await authority.observe();
  assert.equal(observed.queue.length, 1, 'a proved-dead holder’s queue entry returns to the queue');
  assert.equal(observed.queue[0].holder, liveEntry.holder);
  assert.equal(observed.queue[0].holderAlive, true);
  assert.equal(authority.observeParticipantVerify(deadEntry.holder), null,
    'absence is absence after the sweep, never a stale row');
});
