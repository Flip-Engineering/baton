// Issue #423, LANE 1 (state + contract) — the claims and work-proposal folds: a hold a seat
// takes for itself on a work item or a path set (with the per-checkout conflict rule and the
// one-row handoff), and a work split the seats it names accept by arriving, as specified by
// docs/45-open-coordination.md §2, §3 and §11.
//
// These rows are the STATE half of `impl/test/issue423-claims-and-peers.test.mjs`: they drive
// `foldSwarmEvent` directly. The runtime half (permissions, the `claims`/`proposals` view
// projections, `claim_holder_gone` and `shared_checkout_overlap` attention rows, the peers-now
// brief section) landed with them: the pairs file's rows are green and its `-red` suffix
// came off in that change (docs/44 rule 3).
import test from 'node:test';
import assert from 'node:assert/strict';

import { SWARM_ASSIGNMENT_STATUSES, SwarmRefusal, SwarmIntegrityError,
  foldSwarmEvent, swarmSnapshot, validateSwarmEvent } from '../src/swarm-state.mjs';
import { SWARM_EVENT_EXAMPLES, SWARM_EVENT_PAYLOAD_SCHEMAS,
  swarmEventAgentRequiredFields, swarmEventAutoFilledFields } from '../src/swarm-event-schemas.mjs';
import { SWARM_COMMAND_ROWS, SWARM_EVENT_KINDS, swarmChangedRow, validateSwarmCommand } from '../src/swarm-contract.mjs';

const WS_SHARED = `ws-${'a'.repeat(32)}`;
const WS_PRIVATE = `ws-${'b'.repeat(32)}`;

/** A swarm of three seats: alpha and beta work in ONE checkout, charlie in a private one. */
function team() {
  const swarms = new Map();
  let seq = 0;
  const fold = (kind, payload, { admission = false } = {}) => foldSwarmEvent(swarms,
    { kind, payload, seq: ++seq, ts: `2026-09-18T00:00:${String(seq).padStart(2, '0')}.000Z`, actor: 'root' },
    { admission });
  fold('swarm.created', { swarmId: 'baton', purpose: 'claims and proposals (#423)' });
  fold('swarm.participant_joined', { swarmId: 'baton', participantId: 'alpha', workspaceId: WS_SHARED });
  fold('swarm.participant_joined', { swarmId: 'baton', participantId: 'beta', workspaceId: WS_SHARED });
  fold('swarm.participant_joined', { swarmId: 'baton', participantId: 'charlie', workspaceId: WS_PRIVATE });
  fold('swarm.work_updated', { swarmId: 'baton', workId: 'W-1', objective: 'the one shared task' });
  const claim = (claimId) => swarms.get('baton').claims[claimId] ?? null;
  const refused = (kind, payload, code) => {
    let threw = null;
    try { fold(kind, payload, { admission: true }); } catch (error) { threw = error; }
    assert.ok(threw instanceof SwarmIntegrityError, `expected an integrity refusal, got ${threw?.message ?? 'none'}`);
    assert.equal(threw.code, code);
    return threw;
  };
  return { swarms, fold, claim, refused, row: () => swarms.get('baton') };
}

const claimId = (id, extra = {}) => ({ swarmId: 'baton', claimId: id, ...extra });

// ── claims (docs/45 §2) ──────────────────────────────────────────────────────

test('#423 state: a claim is an assignment-shaped hold bound to the claimant\'s recorded checkout', () => {
  const f = team();
  f.fold('swarm.claim_updated', claimId('c-1', { participantId: 'alpha', workId: 'W-1' }));
  const row = f.claim('c-1');
  assert.equal(row.participantId, 'alpha');
  assert.equal(row.status, 'active', 'a new claim is active');
  assert.equal(row.workId, 'W-1');
  assert.equal(row.paths, null);
  assert.equal(row.workspaceId, WS_SHARED, 'the claim binds the claimant\'s recorded checkout');
  assert.deepEqual([...SWARM_ASSIGNMENT_STATUSES], ['active', 'released'],
    'the claim reuses the assignment lifecycle vocabulary — one axis, no new status set');
  for (const status of SWARM_ASSIGNMENT_STATUSES) {
    assert.ok(SWARM_EVENT_PAYLOAD_SCHEMAS['swarm.claim_updated'].fields.status.enum.includes(status));
  }
});

test('#423 state: a seat with no recorded checkout claims with workspaceId null — absence, not a guess', () => {
  const f = team();
  f.fold('swarm.participant_joined', { swarmId: 'baton', participantId: 'dana' });
  f.fold('swarm.claim_updated', claimId('c-d', { participantId: 'dana', paths: ['impl/src/a.mjs'] }));
  assert.equal(f.claim('c-d').workspaceId, null);
});

test('#423 state: overlapping paths on the same recorded checkout refuse, naming the holder and the claim; another checkout never conflicts', () => {
  const f = team();
  f.fold('swarm.claim_updated', claimId('c-1', { participantId: 'alpha', paths: ['impl/src'] }));
  const clash = f.refused('swarm.claim_updated', claimId('c-2', { participantId: 'beta', paths: ['impl/src/held.mjs'] }), 'swarm_claim_conflict');
  assert.match(clash.message, /alpha/, 'the refusal names the holder');
  assert.match(clash.message, /c-1/, 'the refusal names the holding claim');
  assert.deepEqual([...clash.detail.paths], ['impl/src/held.mjs']);
  assert.equal(f.claim('c-2'), null, 'the conflicting claim was never recorded');
  // Disjoint paths on the same checkout, and the same paths on another checkout, both hold.
  f.fold('swarm.claim_updated', claimId('c-3', { participantId: 'beta', paths: ['impl/test'] }));
  f.fold('swarm.claim_updated', claimId('c-4', { participantId: 'charlie', paths: ['impl/src/held.mjs'] }));
  assert.ok(f.claim('c-3') && f.claim('c-4'), 'disjoint and per-checkout holds are admitted');
  // A released hold frees its paths.
  f.fold('swarm.claim_updated', claimId('c-1', { participantId: 'alpha', status: 'released' }));
  f.fold('swarm.claim_updated', claimId('c-5', { participantId: 'beta', paths: ['impl/src/held.mjs'] }));
  assert.ok(f.claim('c-5'), 'a released hold no longer conflicts');
});

test('#423 state: a work claim names existing work, and claims on one work item never conflict', () => {
  const f = team();
  f.fold('swarm.claim_updated', claimId('c-1', { participantId: 'alpha', workId: 'W-1' }));
  f.fold('swarm.claim_updated', claimId('c-2', { participantId: 'beta', workId: 'W-1' }));
  assert.ok(f.claim('c-2'), 'several seats may contribute to one work item');
  f.refused('swarm.claim_updated', claimId('c-3', { participantId: 'alpha', workId: 'W-ghost' }), 'work_not_found');
});

test('#423 state: the handoff moves the hold in ONE row, keeps it active, and refuses a mis-named holder', () => {
  const f = team();
  f.fold('swarm.claim_updated', claimId('c-1', { participantId: 'alpha', workId: 'W-1' }));
  f.refused('swarm.claim_updated', claimId('c-1', { participantId: 'beta', handoffTo: 'charlie' }), 'swarm_permission_required');
  const moved = f.refused('swarm.claim_updated', claimId('c-1', { participantId: 'beta', handoffTo: 'charlie' }), 'swarm_permission_required');
  assert.equal(moved.detail.rule, 'claim-holder-or-organize');
  f.fold('swarm.claim_updated', claimId('c-1', { participantId: 'alpha', handoffTo: 'beta' }));
  const row = f.claim('c-1');
  assert.equal(row.participantId, 'beta', 'the hold moves to the seat the handoff names');
  assert.equal(row.status, 'active', 'a handoff keeps the claim active — no free window');
  assert.equal(Object.keys(f.row().claims).length, 1, 'one row, never a release-plus-claim pair');
  assert.equal(row.version, 2, 'the move is the row\'s second version');
  // The receiver must be an active seat, and a handoff of a hold that does not exist refuses.
  f.refused('swarm.claim_updated', claimId('c-1', { participantId: 'beta', handoffTo: 'ghost' }), 'participant_not_found');
  f.fold('swarm.participant_left', { swarmId: 'baton', participantId: 'charlie', reason: 'done' });
  f.refused('swarm.claim_updated', claimId('c-1', { participantId: 'beta', handoffTo: 'charlie' }), 'participant_not_active');
  f.refused('swarm.claim_updated', claimId('c-ghost', { participantId: 'beta', status: 'released' }), 'swarm_claim_not_found');
});

test('#423 state: a released claim can be re-claimed by another seat, and CAS still guards a claim', () => {
  const f = team();
  f.fold('swarm.claim_updated', claimId('c-1', { participantId: 'alpha', workId: 'W-1' }));
  f.fold('swarm.claim_updated', claimId('c-1', { participantId: 'alpha', status: 'released' }));
  f.fold('swarm.claim_updated', claimId('c-1', { participantId: 'beta', workId: 'W-1' }));
  assert.equal(f.claim('c-1').participantId, 'beta', 'a freed hold is taken, not inherited');
  f.refused('swarm.claim_updated', claimId('c-1', { participantId: 'beta', expectedVersion: 9, status: 'released' }), 'version_conflict');
});

test('#423 state: the claim shape refuses a two-target claim, a shape-less path, and a status outside the lifecycle', () => {
  for (const [payload, pattern] of [
    [claimId('c', { participantId: 'alpha', workId: 'W-1', paths: ['impl/src'] }), /exactly one target/u],
    [claimId('c', { participantId: 'alpha', paths: ['../escape.mjs'] }), /repo-relative/u],
    [claimId('c', { participantId: 'alpha', paths: ['./impl/src.mjs'] }), /repo-relative/u],
    [claimId('c', { participantId: 'alpha', paths: [] }), /non-empty paths array/u],
    [claimId('c', { participantId: 'alpha', workId: 'W-1', status: 'done' }), /claim status must be one of/u],
    [{ swarmId: 'baton', claimId: 'c', workId: 'W-1' }, /requires participantId/u],
  ]) {
    assert.throws(() => validateSwarmEvent('swarm.claim_updated', payload),
      (error) => error instanceof SwarmRefusal && error.code === 'invalid_payload' && pattern.test(error.message),
      `refused: ${JSON.stringify(payload)}`);
  }
  const f = team();
  f.refused('swarm.claim_updated', claimId('c-new', { participantId: 'alpha' }), 'invalid_payload');
});

// ── work proposals (docs/45 §3) ──────────────────────────────────────────────

const splitPlan = {
  work: [{ workId: 'W-split', objective: 'the split half' }],
  claims: [{ participantId: 'beta', workId: 'W-split' }],
};


// ── the contract surface ─────────────────────────────────────────────────────
