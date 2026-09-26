// Issue #422, LANE 1 (state + contract) — the joint couplings' fold: the rotating writer lease
// (`take`/`yield` with the hold history), quorum synchronization points, and coupling proposals
// whose arrival is consent, as specified by docs/45-open-coordination.md §4 and §11.
//
// These rows are the STATE half of `impl/test/issue422-joint-couplings.test.mjs`: they drive
// `foldSwarmEvent` directly, so they prove the fold, the shape validator and the contract on
// their own. The runtime half landed with them: the pairs file's rows are green and its
// `-red` suffix came off in that change (docs/44 rule 3).
import test from 'node:test';
import assert from 'node:assert/strict';

import { SWARM_COUPLING_ACTIONS, SWARM_PROPOSAL_ACTIONS, SwarmRefusal, SwarmIntegrityError,
  foldSwarmEvent, swarmSnapshot, validateSwarmEvent } from '../src/swarm-state.mjs';
import { SWARM_EVENT_EXAMPLES, SWARM_EVENT_PAYLOAD_SCHEMAS,
  swarmEventAgentRequiredFields, swarmEventAutoFilledFields } from '../src/swarm-event-schemas.mjs';
import { SWARM_EVENT_KINDS, validateSwarmCommand } from '../src/swarm-contract.mjs';
import { SWARM_REFUSAL_CODES } from '../src/swarm-refusals.mjs';

const WS_TEAM = `ws-${'a'.repeat(32)}`;
const WS_OTHER = `ws-${'b'.repeat(32)}`;

/** A swarm with a three-seat team: alpha and beta share one checkout, charlie works in another. */
function team({ claim = true } = {}) {
  const swarms = new Map();
  let seq = 0;
  const fold = (kind, payload, { admission = false } = {}) => foldSwarmEvent(swarms,
    { kind, payload, seq: ++seq, ts: `2026-09-18T00:00:${String(seq).padStart(2, '0')}.000Z`, actor: 'root' },
    { admission });
  fold('swarm.created', { swarmId: 'baton', purpose: 'joint couplings (#422)' });
  fold('swarm.participant_joined', { swarmId: 'baton', participantId: 'alpha', workspaceId: WS_TEAM });
  fold('swarm.participant_joined', { swarmId: 'baton', participantId: 'beta', workspaceId: WS_TEAM });
  fold('swarm.participant_joined', { swarmId: 'baton', participantId: 'charlie', workspaceId: WS_OTHER });
  fold('swarm.group_updated', { swarmId: 'baton', groupId: 'team', members: ['alpha', 'beta'] });
  fold('swarm.work_updated', { swarmId: 'baton', workId: 'W-1', objective: 'the one shared task' });
  const coupling = (couplingId) => swarms.get('baton').couplings[couplingId] ?? null;
  const refused = (payload, code) => {
    let threw = null;
    try { fold('swarm.coupling_updated', payload, { admission: true }); } catch (error) { threw = error; }
    assert.ok(threw instanceof SwarmIntegrityError, `expected an integrity refusal, got ${threw?.message ?? 'none'}`);
    assert.equal(threw.code, code);
    return threw;
  };
  return { swarms, fold, coupling, refused, row: () => swarms.get('baton'), claim };
}

const lease = (extra = {}) => ({ swarmId: 'baton', couplingId: 'lease-1', coupling: 'writer',
  action: 'declare', ...(extra.action === 'take' || extra.action === 'yield' ? {} : { groupId: 'team' }), ...extra });

// ── the vocabulary ───────────────────────────────────────────────────────────

test('#422 state: the coupling action set and the proposal action set are the design\'s own', () => {
  assert.deepEqual([...SWARM_COUPLING_ACTIONS], ['declare', 'propose', 'arrive', 'take', 'yield', 'release']);
  assert.deepEqual([...SWARM_PROPOSAL_ACTIONS], ['propose', 'arrive', 'release']);
  for (const action of SWARM_COUPLING_ACTIONS) {
    assert.ok(SWARM_EVENT_PAYLOAD_SCHEMAS['swarm.coupling_updated'].fields.action.enum.includes(action),
      `${action} is admitted by the payload schema`);
  }
});

test('#422 state: the shape lane refuses a lease take/yield without a seat, a quorum on a non-synchronization record, and members outside a propose', () => {
  for (const [payload, pattern] of [
    [lease({ action: 'take' }), /take names participantId/u],
    [lease({ action: 'yield' }), /yield names participantId/u],
    [lease({ action: 'take', participantId: 'alpha', quorum: 2 }), /only a synchronization point declares a quorum/u],
    [lease({ quorum: 2 }), /only a synchronization point declares a quorum/u],
    [lease({ quorum: 0 }), /quorum must be a positive integer/u],
    [{ swarmId: 'baton', couplingId: 'sync-1', coupling: 'synchronization', action: 'declare', members: ['alpha', 'beta'] }, /names its members when it is proposed/u],
    [{ swarmId: 'baton', couplingId: 'lease-1', coupling: 'writer', action: 'declare', participantId: 'alpha', groupId: 'team' }, /exactly one of participantId/u],
    [{ swarmId: 'baton', couplingId: 'fail-1', coupling: 'failure', action: 'propose', members: ['alpha'] }, /declared, never proposed/u],
    [{ swarmId: 'baton', couplingId: 'lease-1', coupling: 'writer', action: 'propose' }, /proposal names the members/u],
  ]) {
    assert.throws(() => validateSwarmEvent('swarm.coupling_updated', payload),
      (error) => error instanceof SwarmRefusal && error.code === 'invalid_payload' && pattern.test(error.message),
      `refused: ${JSON.stringify(payload)}`);
  }
});

// ── the rotating writer lease (docs/45 §4.1) ─────────────────────────────────

test('#422 state: a lease snapshots its roster and covers its members\' recorded checkouts', () => {
  const f = team();
  f.fold('swarm.coupling_updated', lease());
  const record = f.coupling('lease-1');
  assert.deepEqual([...record.members], ['alpha', 'beta'], 'the declared roster is snapshotted');
  assert.deepEqual([...record.workspaces], [WS_TEAM], 'the lease covers the members\' recorded checkouts');
  assert.equal(record.holder, null, 'a declared lease starts unheld');
  assert.deepEqual([...record.holds], [], 'no hold history yet');
  assert.equal(record.released, false);
});

test('#422 state: the lease rotates — take, the held refusal, yield, the next take, and the hold history', () => {
  const f = team();
  f.fold('swarm.coupling_updated', lease());
  f.fold('swarm.coupling_updated', lease({ action: 'take', participantId: 'alpha' }));
  assert.equal(f.coupling('lease-1').holder, 'alpha');
  const held = f.refused(lease({ action: 'take', participantId: 'beta' }), 'swarm_writer_lease_held');
  assert.match(held.message, /alpha/, 'the refusal names the holder');
  f.refused(lease({ action: 'yield', participantId: 'beta' }), 'swarm_writer_lease_held');
  f.fold('swarm.coupling_updated', lease({ action: 'yield', participantId: 'alpha' }));
  assert.equal(f.coupling('lease-1').holder, null, 'the holder frees the lease without a lead');
  f.refused(lease({ action: 'yield', participantId: 'alpha' }), 'swarm_writer_lease_unheld');
  f.fold('swarm.coupling_updated', lease({ action: 'take', participantId: 'beta' }));
  const record = f.coupling('lease-1');
  assert.equal(record.holder, 'beta', 'the next member takes the freed lease');
  assert.equal(record.holds.length, 2, 'the hold history keeps both holds');
  assert.equal(record.holds[0].yieldedBy, 'alpha', 'the first hold names who yielded it');
  assert.equal(record.holds[1].yieldedBy, null, 'the live hold is open');
});

test('#422 state: a take-over after the holder\'s membership ended is admitted; a non-member never takes', () => {
  const f = team();
  f.fold('swarm.coupling_updated', lease());
  f.fold('swarm.coupling_updated', lease({ action: 'take', participantId: 'alpha' }));
  f.refused(lease({ action: 'take', participantId: 'charlie' }), 'swarm_not_a_member');
  f.fold('swarm.participant_left', { swarmId: 'baton', participantId: 'alpha', reason: 'done' });
  f.fold('swarm.coupling_updated', lease({ action: 'take', participantId: 'beta' }));
  assert.equal(f.coupling('lease-1').holder, 'beta', 'the fold reads membership, never runtime liveness');
});

test('#422 state: exclusivity is per checkout across BOTH writer spellings', () => {
  const f = team();
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'w-1', coupling: 'writer', action: 'declare', participantId: 'alpha' });
  const clash = f.refused(lease({ couplingId: 'lease-9' }), 'swarm_writer_conflict');
  assert.match(clash.message, /w-1/, 'the refusal names the record that holds the checkout');
  f.refused({ swarmId: 'baton', couplingId: 'w-2', coupling: 'writer', action: 'declare', participantId: 'beta' }, 'swarm_writer_conflict');
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'w-3', coupling: 'writer', action: 'declare', participantId: 'charlie' });
  assert.ok(f.coupling('w-3'), 'another checkout takes its own writer');
  // The pre-design exemption still holds: the same writer re-declaring over its own checkout.
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'w-1', coupling: 'writer', action: 'declare', participantId: 'alpha' });
  assert.equal(f.coupling('w-1').writer, 'alpha');
});

test('#422 state: a lease over a group with no recorded checkout refuses the workspace-unrecorded rule at admission', () => {
  const f = team();
  f.fold('swarm.participant_joined', { swarmId: 'baton', participantId: 'dana' });
  f.fold('swarm.group_updated', { swarmId: 'baton', groupId: 'ghosts', members: ['dana'] });
  f.refused({ swarmId: 'baton', couplingId: 'lease-g', coupling: 'writer', action: 'declare', groupId: 'ghosts' },
    'swarm_writer_workspace_unrecorded');
  assert.equal(f.coupling('lease-g'), null, 'nothing was recorded');
});

test('#422 state: a lease declared by consent rotates exactly as a group lease does', () => {
  const f = team();
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'lease-c', coupling: 'writer',
    action: 'propose', participantId: 'alpha', members: ['alpha', 'beta'] });
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'lease-c', coupling: 'writer', action: 'arrive', participantId: 'beta' });
  assert.deepEqual([...f.coupling('lease-c').members], ['alpha', 'beta'], 'the consent set is the roster');
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'lease-c', coupling: 'writer', action: 'take', participantId: 'beta' });
  assert.equal(f.coupling('lease-c').holder, 'beta', 'a consented lease takes a holder');
  f.refused({ swarmId: 'baton', couplingId: 'lease-c', coupling: 'writer', action: 'take', participantId: 'alpha' }, 'swarm_writer_lease_held');
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'lease-c', coupling: 'writer', action: 'yield', participantId: 'beta' });
  assert.equal(f.coupling('lease-c').holder, null);
  assert.equal(f.coupling('lease-c').holds.length, 1);
});

// ── quorum synchronization points (docs/45 §4.3) ─────────────────────────────

test('#422 state: the quorum-th arrival releases the point, attributed to the arriver', () => {
  const f = team();
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-1', coupling: 'synchronization',
    action: 'declare', groupId: 'team', name: 'interface-freeze', quorum: 2 });
  assert.equal(f.coupling('sync-1').quorum, 2, 'the record carries the declared quorum');
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-1', coupling: 'synchronization', action: 'arrive', participantId: 'alpha' });
  assert.equal(f.coupling('sync-1').released, false, 'one arrival of two never releases a quorum-2 point');
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-1', coupling: 'synchronization', action: 'arrive', participantId: 'beta' });
  const done = f.coupling('sync-1');
  assert.equal(done.released, true, 'the satisfying arrival releases the point in the same fold');
  assert.equal(done.releasedBy, 'beta', 'the release is attributed to the arriving seat');
  assert.match(done.releaseReason, /quorum/, 'the reason names the quorum');
});

test('#422 state: a point declared without a quorum releases exactly as before — explicitly', () => {
  const f = team();
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-2', coupling: 'synchronization',
    action: 'declare', groupId: 'team', name: 'freeze' });
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-2', coupling: 'synchronization', action: 'arrive', participantId: 'alpha' });
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-2', coupling: 'synchronization', action: 'arrive', participantId: 'beta' });
  assert.equal(f.coupling('sync-2').released, false, 'every live member arrived and the point still waits');
  assert.equal('quorum' in f.coupling('sync-2'), false, 'no quorum was declared, so none is recorded');
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-2', coupling: 'synchronization', action: 'release', releasedBy: 'alpha' });
  assert.equal(f.coupling('sync-2').released, true);
});

// ── coupling proposals (docs/45 §4.5) ────────────────────────────────────────

test('#422 state: a proposal starts with the proposer\'s consent, and the last consent declares it', () => {
  const f = team();
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'lease-9', coupling: 'writer',
    action: 'propose', participantId: 'alpha', members: ['alpha', 'beta'] });
  const midway = f.coupling('lease-9');
  assert.equal(midway.proposed, true);
  assert.deepEqual([...midway.consents], ['alpha'], 'the proposer consents by proposing');
  assert.equal(midway.holder, null);
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'lease-9', coupling: 'writer', action: 'arrive', participantId: 'beta' });
  const declared = f.coupling('lease-9');
  assert.equal(declared.proposed, false, 'the last arrival declares the record');
  assert.deepEqual([...declared.members], ['alpha', 'beta'], 'the consent set becomes the member roster');
  assert.deepEqual([...declared.workspaces], [WS_TEAM], 'coverage is derived from the consenting seats');
  assert.equal(declared.holder, null, 'a consented lease starts unheld');
});

test('#422 state: an amendment carries the consents forward and names them; a withdrawn proposal never expands', () => {
  const f = team();
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'lease-9', coupling: 'writer',
    action: 'propose', participantId: 'alpha', members: ['alpha', 'beta'] });
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'lease-9', coupling: 'writer',
    action: 'propose', participantId: 'alpha', members: ['alpha', 'beta', 'charlie'] });
  const amended = f.coupling('lease-9');
  assert.deepEqual([...amended.consents], ['alpha'], 'consent is carried, never wiped');
  assert.equal(amended.proposed, true, 'a new member is still outstanding');
  f.refused({ swarmId: 'baton', couplingId: 'lease-9', coupling: 'writer', action: 'take', participantId: 'alpha' },
    'invalid_payload');
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'lease-9', coupling: 'writer',
    action: 'release', releasedBy: 'alpha', reason: 'withdrawn' });
  assert.equal(f.coupling('lease-9').released, true);
  assert.equal(f.coupling('lease-9').proposed, false, 'a withdrawal is not a live proposal');
});

test('#422 state: an arrival at a proposed synchronization point is consent, and its arrivals start empty', () => {
  const f = team();
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-9', coupling: 'synchronization',
    action: 'propose', participantId: 'alpha', members: ['alpha', 'beta'], name: 'freeze' });
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-9', coupling: 'synchronization', action: 'arrive', participantId: 'beta' });
  const declared = f.coupling('sync-9');
  assert.equal(declared.proposed, false);
  assert.deepEqual([...declared.arrivals], [], 'consent to the point is not arrival at the point');
  assert.deepEqual([...declared.consents], ['alpha', 'beta']);
});

test('#422 state: a seat outside the consent set cannot consent, and a second consent refuses', () => {
  const f = team();
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-9', coupling: 'synchronization',
    action: 'propose', participantId: 'alpha', members: ['alpha', 'beta', 'charlie'], name: 'freeze' });
  f.refused({ swarmId: 'baton', couplingId: 'sync-9', coupling: 'synchronization', action: 'arrive', participantId: 'nobody' }, 'participant_not_found');
  f.fold('swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-9', coupling: 'synchronization', action: 'arrive', participantId: 'beta' });
  f.refused({ swarmId: 'baton', couplingId: 'sync-9', coupling: 'synchronization', action: 'arrive', participantId: 'beta' }, 'swarm_already_arrived');
  assert.equal(f.coupling('sync-9').proposed, true, 'charlie has still not consented');
  // A seat the proposal never named cannot consent at all.
  f.fold('swarm.participant_joined', { swarmId: 'baton', participantId: 'dana', workspaceId: WS_OTHER });
  f.refused({ swarmId: 'baton', couplingId: 'sync-9', coupling: 'synchronization', action: 'arrive', participantId: 'dana' }, 'swarm_not_a_member');
});

// ── migration (docs/45 §11) ──────────────────────────────────────────────────

test('#422 state: a pre-design record folds to exactly the shape it always did, and replay is byte-identical', () => {
  const events = [
    ['swarm.created', { swarmId: 'baton', purpose: 'migration' }],
    ['swarm.participant_joined', { swarmId: 'baton', participantId: 'alpha', workspaceId: WS_TEAM }],
    ['swarm.participant_joined', { swarmId: 'baton', participantId: 'beta', workspaceId: WS_TEAM }],
    ['swarm.group_updated', { swarmId: 'baton', groupId: 'team', members: ['alpha', 'beta'] }],
    ['swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-old', coupling: 'synchronization', action: 'declare', groupId: 'team', name: 'freeze' }],
    ['swarm.coupling_updated', { swarmId: 'baton', couplingId: 'sync-old', coupling: 'synchronization', action: 'arrive', participantId: 'alpha' }],
    ['swarm.coupling_updated', { swarmId: 'baton', couplingId: 'w-old', coupling: 'writer', action: 'declare', participantId: 'alpha' }],
    ['swarm.coupling_updated', { swarmId: 'baton', couplingId: 'fail-old', coupling: 'failure', action: 'declare', groupId: 'team', policy: 'independent' }],
  ];
  const replay = () => {
    const swarms = new Map();
    events.forEach(([kind, payload], index) => foldSwarmEvent(swarms,
      { kind, payload, seq: index + 1, ts: `2026-09-18T00:00:${String(index + 1).padStart(2, '0')}.000Z`, actor: 'root' }));
    return swarms;
  };
  const first = replay();
  const second = replay();
  assert.deepEqual(swarmSnapshot(second), swarmSnapshot(first), 'the same log folds byte-identically');
  const records = first.get('baton').couplings;
  assert.deepEqual(Object.keys(records['sync-old']).sort(),
    ['actor', 'arrivals', 'carriedArrivals', 'coupling', 'couplingId', 'groupId', 'members', 'name',
      'policy', 'releaseReason', 'released', 'releasedBy', 'seq', 'ts', 'version', 'workspaceId', 'writer'],
    'a synchronization record keeps its pre-design key set — the new fields are absent, not null');
  assert.deepEqual(Object.keys(records['w-old']).sort(),
    ['actor', 'arrivals', 'bypasses', 'carriedArrivals', 'coupling', 'couplingId', 'groupId', 'members',
      'name', 'policy', 'releaseReason', 'released', 'releasedBy', 'seq', 'ts', 'version', 'workspaceId', 'writer'],
    'an exclusive writer record keeps its pre-design key set');
});

// ── the contract surface ─────────────────────────────────────────────────────

test('#422 state: the coupling schema admits the joint fields, and the contract needs no new caller field', () => {
  const fields = Object.keys(SWARM_EVENT_PAYLOAD_SCHEMAS['swarm.coupling_updated'].fields);
  for (const field of ['quorum', 'members']) assert.ok(fields.includes(field), `${field} is a declared payload field`);
  assert.ok(SWARM_EVENT_KINDS.includes('swarm.claim_updated') && SWARM_EVENT_KINDS.includes('swarm.proposal_updated'));
  const example = SWARM_EVENT_EXAMPLES['swarm.coupling_updated'];
  assert.equal(validateSwarmCommand('swarm.update', { swarmId: 'baton', event: 'swarm.coupling_updated',
    idempotencyKey: 'k-1', payload: example }), true);
  assert.deepEqual([...swarmEventAgentRequiredFields('swarm.coupling_updated')], ['couplingId', 'coupling', 'action']);
  assert.deepEqual([...swarmEventAutoFilledFields('swarm.coupling_updated')].sort(), ['participantId', 'releasedBy', 'swarmId']);
  // Every new refusal code this lane mints owns a row in the family's closed set.
  for (const code of ['swarm_writer_lease_held', 'swarm_writer_lease_unheld', 'swarm_claim_conflict',
    'swarm_claim_not_found', 'swarm_proposal_not_found', 'swarm_proposal_released', 'swarm_work_exists']) {
    assert.ok(SWARM_REFUSAL_CODES[code], `${code} is declared with its HTTP class`);
    assert.ok(SWARM_REFUSAL_CODES[code].raisedBy.includes('fold'), `${code} names the fold as its raiser`);
  }
  assert.ok(SWARM_REFUSAL_CODES.swarm_permission_required.raisedBy.includes('fold'),
    'the claim-move refusal is raised by the fold as well as the runtime');
});
