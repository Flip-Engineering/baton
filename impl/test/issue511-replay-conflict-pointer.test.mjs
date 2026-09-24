// Issue #511 — a replay conflict names the outcome the colliding identity already holds.
//
// Observed 2026-09-19 recruiting ds-notify on swarm-wave31-20260919: a `swarm recruit` killed by a
// client-side `timeout 20` had actually landed server-side, and the retry met
//
//   swarm_replay_conflict: Swarm mutation identity already names another request
//
// with no receipt, no participant id and no pointer to the seat that already existed. The refusal
// is correct — the retry was redundant — but a caller who trusted the client-side timeout had no
// path from it to the truth. Both collision sites now carry the prior request's own outcome on the
// refusal's declared detail: `recordSwarm` (the store, where the reported message is minted) and
// the runtime's `_once` operation identity.
//
// Suite law: hermetic (mkdtemp fixture, fixed clock, no network, no processes).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';

const CLOCK = () => '2026-09-19T07:00:00.000Z';
const PURPOSE = 'Read the identity a retry collides with';

test('a mutation identity that collides with a landed request names that request outcome', () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue511-'));
  try {
    const store = new CoordinationStore(root, { clock: CLOCK });
    const created = store.recordSwarm('swarm.created', { swarmId: 'sw-511', purpose: PURPOSE },
      { actor: 'owner', key: 'retry-identity-511' });
    assert.equal(created.seq, 1);

    assert.throws(() => store.recordSwarm('swarm.work_updated',
      { swarmId: 'sw-511', workId: 'work-511', objective: 'A different request under the same key' },
      { actor: 'owner', key: 'retry-identity-511' }), (error) => {
      assert.equal(error.code, 'swarm_replay_conflict');
      assert.deepEqual(error.detail.prior, {
        kind: 'swarm.created', requestedKind: 'swarm.work_updated', seq: 1,
        ts: CLOCK(), actor: 'owner', participantId: null,
      }, 'the refusal names the row the colliding identity already holds');
      assert.match(error.detail.next, /swarm view/u,
        'and points at the readback that shows the original request landed');
      return true;
    });
    assert.equal(store.events().length, 1, 'the refused retry appended nothing');

    assert.equal(store.recordSwarm('swarm.created', { swarmId: 'sw-511', purpose: PURPOSE },
      { actor: 'owner', key: 'retry-identity-511' }).seq, 1,
    'an exact replay under the same key still returns the prior row, never a refusal');
    assert.equal(store.events().length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a collision whose prior row names a seat reports that seat', () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue511-seat-'));
  try {
    const store = new CoordinationStore(root, { clock: CLOCK });
    store.recordSwarm('swarm.created', { swarmId: 'sw-511', purpose: PURPOSE },
      { actor: 'owner', key: 'create-511' });
    store.recordSwarm('swarm.participant_joined', {
      swarmId: 'sw-511', participantId: 'ds-notify', permissions: ['read', 'contribute'],
    }, { actor: 'owner', key: 'recruit-ds-notify' });
    assert.throws(() => store.recordSwarm('swarm.participant_joined', {
      swarmId: 'sw-511', participantId: 'ds-notify', permissions: ['read'],
    }, { actor: 'owner', key: 'recruit-ds-notify' }), (error) => {
      assert.equal(error.code, 'swarm_replay_conflict');
      assert.equal(error.detail.prior.kind, 'swarm.participant_joined');
      assert.equal(error.detail.prior.participantId, 'ds-notify',
        'the seat the colliding identity resolved to is named');
      assert.equal(error.detail.prior.requestedKind, 'swarm.participant_joined');
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
