import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorktreeCapacityAuthority, loadOrCreateWorktreeCapacityIntegrityKey } from '../src/worktree-capacity.mjs';

const policy = {
  maxReservedBytes: null, maxReservedInodes: null,
  minFreeBytes: 100, minFreeInodes: 10, runtimeReserveBytes: 20, runtimeReserveInodes: 2,
};
const request = { baseSha: 'a'.repeat(40), sparseCheckoutIdentity: { digest: 'b'.repeat(64) } };
function fixture(t, options = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-physical-admission-'));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  const configured = { repoRoot, policy, integrityKey: loadOrCreateWorktreeCapacityIntegrityKey(repoRoot),
    estimate: () => ({ bytes: 60, inodes: 5 }),
    observe: () => ({ freeBytes: 220, freeInodes: 20 }), ...options };
  return { configured, authority: new WorktreeCapacityAuthority(configured) };
}

test('uncapped reservations still refuse real byte or inode exhaustion before writes', (t) => {
  const { authority } = fixture(t);
  authority.reserve('worker:first', request);
  authority.reserve('worker:second', request);
  const before = authority.snapshot();
  assert.throws(() => authority.reserve('worker:third', request), { code: 'worktree_capacity_exceeded' });
  assert.deepEqual(authority.snapshot(), before);
  const { authority: inodeBound } = fixture(t, {
    observe: () => ({ freeBytes: 10_000, freeInodes: 14 }),
  });
  assert.throws(() => inodeBound.reserve('worker:first', request), { code: 'worktree_capacity_exceeded' });
  assert.equal(inodeBound.snapshot().reservations.length, 0);
});

test('ample physical capacity admits beyond the old byte, reservation-count and state-file ceilings', (t) => {
  // Synthetic estimates exercise admission without allocating 100 GiB of actual storage.
  const bytes = 10 * 1024 * 1024;
  const { authority, configured } = fixture(t, {
    estimate: () => ({ bytes, inodes: 101 }),
    observe: () => ({ freeBytes: 1024 ** 4, freeInodes: 10_000_000 }),
  });
  const entries = Array.from({ length: 10_001 }, (_, index) => ({ id: `worker:${index}`, request }));
  const tokens = authority.reserveMany(entries);
  assert.equal(tokens.length, entries.length);
  assert.ok(statSync(authority.statePath).size > 4 * 1024 * 1024);
  const reopened = new WorktreeCapacityAuthority(configured).snapshot();
  assert.equal(reopened.reservations.length, entries.length);
  assert.equal(reopened.totals.bytes, entries.length * bytes);
  assert.ok(reopened.totals.inodes > 1_000_000);
});

test('configured owner quotas still refuse before physical exhaustion', (t) => {
  const { authority } = fixture(t, { policy: { ...policy, maxReservedBytes: 60 } });
  authority.reserve('worker:first', request);
  assert.throws(() => authority.reserve('worker:second', request), { code: 'worktree_capacity_exceeded' });
  assert.equal(authority.snapshot().reservations.length, 1);
});
