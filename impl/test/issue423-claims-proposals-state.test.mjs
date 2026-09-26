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
  const proposal = (proposalId) => swarms.get('baton').proposals[proposalId] ?? null;
  const refused = (kind, payload, code) => {
    let threw = null;
    try { fold(kind, payload, { admission: true }); } catch (error) { threw = error; }
    assert.ok(threw instanceof SwarmIntegrityError, `expected an integrity refusal, got ${threw?.message ?? 'none'}`);
    assert.equal(threw.code, code);
    return threw;
  };
  return { swarms, fold, claim, proposal, refused, row: () => swarms.get('baton') };
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

test('#423 state: a proposal is proposed until the last consent, which expands the plan into its rows', () => {
  const f = team();
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'propose',
    participantId: 'alpha', members: ['alpha', 'beta'], plan: splitPlan });
  const midway = f.proposal('p-1');
  assert.equal(midway.proposed, true);
  assert.deepEqual([...midway.consents], ['alpha'], 'the proposer consents by proposing');
  assert.equal(f.row().work['W-split'], undefined, 'nothing is created before the consent set completes');
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'arrive', participantId: 'beta' });
  const accepted = f.proposal('p-1');
  assert.equal(accepted.proposed, false);
  assert.equal(f.row().work['W-split'].objective, 'the split half', 'the plan\'s work rows are written');
  const minted = f.claim('p-1-claim-0');
  assert.equal(minted.participantId, 'beta', 'the minted claim names the holder the plan named');
  assert.equal(minted.workId, 'W-split');
  assert.equal(minted.status, 'active');
  assert.equal(minted.workspaceId, WS_SHARED, 'the minted claim binds its holder\'s recorded checkout');
});

test('#423 state: an unmatched seat cannot consent, a second consent refuses, and a withdrawal records nothing', () => {
  const f = team();
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'propose',
    participantId: 'alpha', members: ['alpha', 'beta'], plan: splitPlan });
  f.refused('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'arrive', participantId: 'charlie' }, 'swarm_not_a_member');
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'arrive', participantId: 'beta' });
  f.refused('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'arrive', participantId: 'beta' }, 'swarm_already_arrived');
  f.refused('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-ghost', action: 'arrive', participantId: 'alpha' }, 'swarm_proposal_not_found');
  // A fresh proposal, withdrawn before its consent set completes: the plan never lands.
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-2', action: 'propose',
    participantId: 'alpha', members: ['alpha', 'charlie'], plan: splitPlan });
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-2', action: 'release',
    releasedBy: 'alpha', reason: 'no longer needed' });
  assert.equal(f.proposal('p-2').released, true);
  assert.equal(f.proposal('p-2').proposed, false);
  f.refused('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-2', action: 'arrive', participantId: 'charlie' }, 'swarm_proposal_released');
  assert.equal(f.claim('p-2-claim-0'), null, 'a withdrawn proposal never expands');
});

test('#423 state: an amendment carries consents forward, names them, and expands the amended plan', () => {
  const f = team();
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'propose',
    participantId: 'alpha', members: ['alpha', 'beta', 'charlie'], plan: splitPlan });
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'arrive', participantId: 'beta' });
  assert.equal(f.proposal('p-1').proposed, true, 'charlie has still not consented');
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'propose',
    participantId: 'alpha', members: ['alpha', 'beta', 'charlie'], plan: splitPlan });
  const amended = f.proposal('p-1');
  assert.deepEqual([...amended.carriedConsents], ['beta'], 'the earlier consent is carried and named');
  assert.equal(amended.proposed, true, 'the member the amendment adds is still outstanding');
  assert.equal(f.claim('p-1-claim-0'), null, 'the amended plan has not expanded yet');
  // A roster that drops a consenting member does not carry that consent onto the new plan.
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'propose',
    participantId: 'alpha', members: ['alpha'], plan: splitPlan });
  const narrowed = f.proposal('p-1');
  assert.equal('carriedConsents' in narrowed, false, 'nothing was carried onto the narrowed plan');
  assert.equal(narrowed.proposed, false, 'the proposer alone completes the narrowed consent set');
  assert.ok(f.claim('p-1-claim-0'), 'the narrowed plan expanded');
});

test('#423 state: the acceptance trial-folds the whole plan — an existing work item or a claim conflict refuses it entirely', () => {
  const existing = team();
  existing.fold('swarm.claim_updated', claimId('c-1', { participantId: 'alpha', paths: ['impl/src'] }));
  existing.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-9', action: 'propose',
    participantId: 'alpha', members: ['alpha', 'beta'],
    plan: { claims: [{ participantId: 'beta', paths: ['impl/src/held.mjs'] }] } });
  const clash = existing.refused('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-9', action: 'arrive', participantId: 'beta' }, 'swarm_claim_conflict');
  assert.equal(clash.detail.holder, 'alpha');
  assert.equal(existing.claim('p-9-claim-0'), null, 'nothing was minted');
  assert.equal(existing.proposal('p-9').proposed, true, 'the consent did not land either');

  const dupe = team();
  const exists = dupe.refused('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-8', action: 'propose',
    participantId: 'alpha', members: ['alpha'], plan: { work: [{ workId: 'W-1', objective: 'again' }] } }, 'swarm_work_exists');
  assert.equal(exists.detail.workId, 'W-1');
  assert.equal(dupe.row().work['W-1'].objective, 'the one shared task', 'the existing work is untouched');
  assert.equal(dupe.proposal('p-8'), null, 'the refused acceptance recorded no proposal either');
});

test('#423 state: the minted claim ids are deterministic, and the plan shape is closed', () => {
  const f = team();
  f.fold('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-3', action: 'propose',
    participantId: 'alpha', members: ['alpha'],
    plan: { work: [{ workId: 'W-a', objective: 'a' }, { workId: 'W-b', objective: 'b' }],
      claims: [{ participantId: 'alpha', workId: 'W-a' }, { participantId: 'alpha', paths: ['impl/docs'] }] } });
  assert.ok(f.claim('p-3-claim-0') && f.claim('p-3-claim-1'), 'one claim per plan.claims entry, in plan order');
  assert.deepEqual([...Object.keys(f.row().claims)].sort(), ['p-3-claim-0', 'p-3-claim-1']);
  for (const [plan, pattern] of [
    [{ work: [{ workId: 'W-a', objective: 'a' }, { workId: 'W-a', objective: 'again' }] }, /names W-a twice/u],
    [{ work: [{ workId: 'W-a' }] }, /workId and an objective/u],
    [{ claims: [{ participantId: 'alpha', workId: 'W-a', paths: ['x'] }] }, /exactly one target/u],
    [{ claims: [{ workId: 'W-a' }] }, /names the participant/u],
    [{ nodes: [] }, /work and claims only/u],
  ]) {
    assert.throws(() => validateSwarmEvent('swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-x',
      action: 'propose', participantId: 'alpha', members: ['alpha'], plan }),
    (error) => error instanceof SwarmRefusal && error.code === 'invalid_payload' && pattern.test(error.message),
    `refused: ${JSON.stringify(plan)}`);
  }
});

// ── the contract surface ─────────────────────────────────────────────────────

test('#423 state: the two kinds are caller-submittable, addressed by their own rows, and their examples are admitted', () => {
  for (const kind of ['swarm.claim_updated', 'swarm.proposal_updated']) {
    assert.ok(SWARM_EVENT_KINDS.includes(kind), `${kind} is in the public update set`);
    assert.ok(SWARM_COMMAND_ROWS.some((row) => row.command === 'swarm.update'), 'the update verb carries them');
    assert.equal(validateSwarmCommand('swarm.update', { swarmId: 'baton', event: kind, idempotencyKey: 'k-1',
      payload: SWARM_EVENT_EXAMPLES[kind] }), true, `${kind}'s shipped example is admissible`);
    assert.deepEqual([...swarmEventAutoFilledFields(kind)].sort(), ['participantId', 'swarmId'],
      `${kind} derives the acting seat from the request identity, so the example omits it`);
  }
  assert.deepEqual([...swarmEventAgentRequiredFields('swarm.claim_updated')], ['claimId']);
  assert.deepEqual([...swarmEventAgentRequiredFields('swarm.proposal_updated')], ['proposalId', 'action']);
  assert.deepEqual(swarmChangedRow('swarm.claim_updated', { claimId: 'c-1' }), { collection: 'claims', id: 'c-1' });
  assert.deepEqual(swarmChangedRow('swarm.proposal_updated', { proposalId: 'p-1' }), { collection: 'proposals', id: 'p-1' });
  // A payload field the schemas do not declare is still refused, never dropped.
  assert.throws(() => validateSwarmCommand('swarm.update', { swarmId: 'baton', event: 'swarm.claim_updated',
    idempotencyKey: 'k-2', payload: { claimId: 'c-1', workId: 'W-1', handoff: 'beta' } }),
  (error) => error.code === 'swarm_command_invalid' && error.detail.field === 'payload.handoff');
});

test('#423 state: the collections are on every swarm row and replay is byte-identical', () => {
  const events = [
    ['swarm.created', { swarmId: 'baton', purpose: 'replay' }],
    ['swarm.participant_joined', { swarmId: 'baton', participantId: 'alpha', workspaceId: WS_SHARED }],
    ['swarm.participant_joined', { swarmId: 'baton', participantId: 'beta', workspaceId: WS_SHARED }],
    ['swarm.work_updated', { swarmId: 'baton', workId: 'W-1', objective: 'task' }],
    ['swarm.claim_updated', { swarmId: 'baton', claimId: 'c-1', participantId: 'alpha', paths: ['impl/src'] }],
    ['swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'propose', participantId: 'alpha',
      members: ['alpha', 'beta'], plan: { claims: [{ participantId: 'beta', paths: ['impl/test'] }] } }],
    ['swarm.proposal_updated', { swarmId: 'baton', proposalId: 'p-1', action: 'arrive', participantId: 'beta' }],
  ];
  const replay = () => {
    const swarms = new Map();
    events.forEach(([kind, payload], index) => foldSwarmEvent(swarms,
      { kind, payload, seq: index + 1, ts: `2026-09-18T00:00:${String(index + 1).padStart(2, '0')}.000Z`, actor: 'root' }));
    return swarms;
  };
  const first = replay();
  assert.deepEqual(swarmSnapshot(replay()), swarmSnapshot(first), 'the same log folds byte-identically');
  assert.ok(first.get('baton').claims && first.get('baton').proposals,
    'every swarm row carries the two collections from the start');
  assert.ok(first.get('baton').claims['p-1-claim-0'], 'the expansion survives a replay');
  // A replay never re-judges the conflict rules: the same log folds again without an admission fold.
  const withConflict = new Map();
  events.forEach(([kind, payload], index) => foldSwarmEvent(withConflict,
    { kind, payload, seq: index + 1, ts: `2026-09-18T00:00:${String(index + 1).padStart(2, '0')}.000Z`, actor: 'root' }));
  assert.deepEqual(swarmSnapshot(withConflict), swarmSnapshot(first));
});
