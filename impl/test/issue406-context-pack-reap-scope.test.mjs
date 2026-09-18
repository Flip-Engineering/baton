// Issue #406 (audit C33, principle P5): reapExpiredContextPacks accepted a repoId,
// never applied it (`void repoId`), and returned an unscoped count — a receipt for a
// scope the scan never honored.
//
// Red-first: the scope row below fails at HEAD (a foreign repoId is silently ignored
// and the store's own counts come back); it goes green on the fix ONLY.
//
// Chosen option: (a) — keep the repoId parameter and ENFORCE it as a scope guard. Every
// deployment holds exactly one repoId (`store._repoId`) and packs carry no per-pack
// repoId, so per-pack filtering is impossible; the parameter's only honest meaning is a
// scope assertion: a repoId that is not this store's refuses with
// context_pack_reap_scope_mismatch instead of returning another repo's counts under a
// foreign label. Option (b) (drop the parameter) is out: CI4 pins the store delegate
// arity at 1. The receipt keeps the exact `{ expired, reaped }` shape pinned by
// bidirectional-v3 B4 (outside this lane's owned files), and the count it reports is now
// truthfully the asserted scope's count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';

const dirs = [];
function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-issue406-'));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

const CLOCK = () => '2026-08-03T05:00:00.000Z';
const EXPIRED_VALIDITY = '2026-08-03T01:00:00.000Z';
const FRESH_VALIDITY = '2026-08-03T06:00:00.000Z';

function seedScopePacks(store, tag, { expiredBodies, freshBodies }) {
  const packs = [];
  let index = 0;
  for (const body of expiredBodies) {
    packs.push(store.mintContextPack(
      { type: 'spec', body, validity: EXPIRED_VALIDITY },
      { actor: 'orchestrator', key: `${tag}-expired-${index += 1}` },
    ).pack);
  }
  for (const body of freshBodies) {
    packs.push(store.mintContextPack(
      { type: 'spec', body, validity: FRESH_VALIDITY },
      { actor: 'orchestrator', key: `${tag}-fresh-${index += 1}` },
    ).pack);
  }
  return packs;
}

test('issue406-a: the reap scan is scoped to the asserted repoId — a foreign scope refuses', () => {
  const dirA = tmpDir();
  const dirB = tmpDir();
  const storeA = new CoordinationStore(dirA, { repoId: 'repo-scope-a', clock: CLOCK });
  const storeB = new CoordinationStore(dirB, { repoId: 'repo-scope-b', clock: CLOCK });
  seedScopePacks(storeA, 'a', { expiredBodies: ['a-old'], freshBodies: ['a-fresh'] });
  seedScopePacks(storeB, 'b', { expiredBodies: ['b-old-one', 'b-old-two'], freshBodies: [] });

  const receiptA = storeA.reapExpiredContextPacks('repo-scope-a');
  assert.deepEqual(receiptA, { expired: 1, reaped: 0 },
    'the asserted scope counts its own packs only — repo-b holds 2 expired packs, none leak in');

  assert.throws(
    () => storeA.reapExpiredContextPacks('repo-scope-b'),
    (error) => error?.code === 'context_pack_reap_scope_mismatch',
    'a foreign repoId must refuse — returning this store’s counts under repo-b’s label is the C33 lie',
  );

  const receiptB = storeB.reapExpiredContextPacks('repo-scope-b');
  assert.deepEqual(receiptB, { expired: 2, reaped: 0 },
    'each repo’s receipt counts its own scope (positive control)');

  storeA.releaseWriterLease();
  storeB.releaseWriterLease();
});

test('issue406-b: the scoped reap receipt is replay-stable — reopen replays the same packs', () => {
  const dir = tmpDir();
  const opts = { repoId: 'repo-scope-a', clock: CLOCK };
  const store = new CoordinationStore(dir, opts);
  const seeded = seedScopePacks(store, 'replay', { expiredBodies: ['replay-old'], freshBodies: ['replay-fresh'] });
  const live = store.reapExpiredContextPacks('repo-scope-a');
  assert.deepEqual(live, { expired: 1, reaped: 0 });
  store.releaseWriterLease();

  const reopened = new CoordinationStore(dir, opts);
  try {
    const replayed = reopened.reapExpiredContextPacks('repo-scope-a');
    assert.deepEqual(replayed, live, 'the replayed projection reaps the identical receipt');
    for (const pack of seeded) {
      assert.ok(reopened.contextPack(pack.packId), 'no pack is reclaimed by the scan, live or replayed');
    }
    assert.throws(
      () => reopened.reapExpiredContextPacks('repo-scope-b'),
      (error) => error?.code === 'context_pack_reap_scope_mismatch',
      'the scope guard survives replay too',
    );
  } finally {
    reopened.releaseWriterLease();
  }
});
