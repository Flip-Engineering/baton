// Bend2 application lane C: law revision 12c (orchestrator authority) applied to the swarm
// authority machinery on master.
//
// The law (docs/bend2/examples/laws-orchestrator-authority.bend, revision 12c) states: for every
// relation and every act the model's grant is the specification's — an orchestrator holds every
// management act over the seats it leads, a seat can stop itself, and no act is granted over a
// seat the actor does not lead. Its 12c extension states the scope derivation and the dispatch
// boundary: the relation is derived from the authenticated current delegation, the caller's
// claimed relation does not change the dispatch decision, the effect-time check uses the same
// relation, no second check denies a lawful grant, a current delegation holds every management
// act, and a seat stops itself under its own scope.
//
// The runtime's spellings (the management-action universe this lane DERIVED from the machinery):
//   Recruit   -> swarm.recruit (permission `recruit`); its subject is a prospective seat, so no
//                relation exists at dispatch and the prospective seat's scope — the parentId it
//                joins under — is the caller's own identity, never a supplied field;
//   Resume    -> swarm.recruit with `resumeFrom` (permission `recruit`), the same prospective
//                subject;
//   Guide     -> swarm.guide and swarm.notify (permission `communicate`), subject = participantId;
//   Stop      -> swarm.stop (permission `stop`), subject = participantId;
//   Review    -> swarm.check, swarm.capture and swarm.update{swarm.contribution_reviewed}
//                (permission `review`); check/capture name the seat, a recorded review names the
//                CONTRIBUTION and the runtime reads its author from the fold;
//   Integrate -> swarm.integrate (permission `organize`); the verb names a CONTRIBUTION and the
//                runtime reads its author from the fold.
// The action target is derived by ONE function (`_actionTarget`) and the relation by ONE function
// (`_leads` over the durable parentId edges); the caller supplies neither. What this lane LEFT
// OPEN, and says so in its report: the flat permission grant the root issues is a separate grant
// the model does not carry (the model's own scope note names the issuing/revoking runtime as
// unmodelled), and no act's subject is a group, a work item or a swarm.
//
// SUITE LAW: temp dirs, a scripted coordinator, no provider process, no network. No count or line
// number of other code is asserted; every assertion names a behavior. Each row drives the real
// SwarmRuntime over the real CoordinationStore through `runtime.command`, the same boundary the
// bridge crosses.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const SWARM_ID = 'authority';
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({
  actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId,
});
const WS_LANE = `ws-${'b'.repeat(32)}`;
const SHA = 'a'.repeat(40);
// The two identity-keyed verbs carry no idempotencyKey of their own (their identity is the rows
// they name), so the request builder omits it for them.
const IDENTITY_KEYED = Object.freeze(['capture', 'check']);
// The lead's flat grant deliberately withholds every management permission the relation must
// supply: no `communicate`, no `stop`, no `review`, no `organize`. It keeps `recruit` alone,
// because a prospective subject has no relation and `recruit` is the only authority that admits
// creating one (#584's shape, extended to the whole act set here).
const LEAD_PERMISSIONS = Object.freeze(['read', 'contribute', 'recruit']);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-r12c-authority-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
    workspaceAttachment: () => ({ workspaceId: WS_LANE, worktree: directory }),
    captureContribution: async (workerId, { contributionId }) =>
      ({ contributionId, workerId, sha: SHA, ref: `refs/baton/checkpoints/${SHA}` }),
    checkContribution: async () => ({ passed: true, sha: SHA, attempt: { cleanup: { state: 'closed' } } }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: false, vendor: 'mock-session' });
    },
    stopRun: async (runId) => {
      const row = workers.find((candidate) => candidate.runId === runId);
      if (row) row.status = 'dead';
      return { state: 'closed' };
    },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: SWARM_ID,
      ...(IDENTITY_KEYED.includes(command) ? {} : { idempotencyKey: `r12c-${++key}` }),
      ...args }, caller);
  /** The durable fold — the authenticated record the relation is derived from. */
  const roster = () => store.swarm(SWARM_ID).participants;
  const refused = async (command, args, caller) => {
    try { await call(command, args, caller); return null; }
    catch (error) { return error; }
  };
  /** The swarm of every row below: a lead and two seats it leads, plus one top-level seat the
   * ROOT recruited so the lead has a peer it does not lead. */
  const team = async () => {
    await call('create', { purpose: 'Revision 12c: the delegation relation' });
    await call('recruit', { participantId: 'lead', objective: 'Lead the lane', permissions: [...LEAD_PERMISSIONS] });
    const lead = principal('w-1');
    await call('recruit', { participantId: 'childA', objective: 'Work A', permissions: ['read', 'contribute'] }, lead);
    await call('recruit', { participantId: 'childB', objective: 'Work B', permissions: ['read', 'contribute'] }, lead);
    await call('recruit', { participantId: 'peer', objective: 'A peer the root recruited', permissions: ['read', 'contribute'] });
    return { lead, childA: principal('w-2'), childB: principal('w-3'), peer: principal('w-4') };
  };
  /** The contribution a child authors, recorded through the runtime's own surface so its author is
   * the fold's fact and not a field any caller can name on another verb. The author's principal is
   * the worker the fold bound to the seat — the same identity the runtime resolves. */
  const childContribution = async (participantId, contributionId) => {
    const bound = workers.find((row) => row.runId === roster()[participantId].runId);
    return call('update', {
      event: 'swarm.contribution_recorded',
      payload: { contributionId, participantId, body: `${contributionId} work` },
    }, principal(bound.id));
  };
  return { runtime, call, roster, refused, team, childContribution, workers };
}

// ── r12c-a: the delegation scope derives from authenticated current authority, and the caller
//    cannot supply the relation ─────────────────────────────────────────────────────────────────
test('r12c-a: the relation is derived from the authenticated fold, never supplied', async (t) => {
  const f = fixture(t);
  const { lead, peer } = await f.team();

  // The relation is not an input. A claimed relation, and a claimed parentage, are unknown fields
  // on the verbs that would need them — the request never carries the relation.
  const claimedRelation = await f.refused('guide', { participantId: 'childA', message: 'x', relation: 'leads' }, lead);
  assert.equal(claimedRelation?.code, 'swarm_command_invalid');
  assert.match(claimedRelation.message, /unknown field relation/u,
    'the relation is derived, so no verb admits it as a field');
  const claimedParent = await f.refused('recruit', { participantId: 'kid', objective: 'kid', parentId: 'lead' }, lead);
  assert.equal(claimedParent?.code, 'swarm_command_invalid');
  assert.match(claimedParent.message, /unknown field parentId/u,
    'a recruit joins under the caller: the prospective seat scope is not a supplied field');

  // The scope is the fold's own edges: the seats the lead recruited sit under it, the root's peer
  // does not.
  assert.equal(f.roster().lead.parentId, null);
  assert.equal(f.roster().childA.parentId, 'lead');
  assert.equal(f.roster().childB.parentId, 'lead');
  assert.equal(f.roster().peer.parentId, null);

  // Two seats with the SAME flat grant get opposite decisions on the same target: the lead holds
  // stop over the seat it leads, its peer holds nothing over that seat.
  const peerStop = await f.refused('stop', { participantId: 'childA', reason: 'no relation' }, peer);
  assert.equal(peerStop?.code, 'swarm_permission_required',
    'the peer leads no seat, so the relation grants it no act over childA');
  const leadStop = await f.call('stop', { participantId: 'childA', reason: 'Lane closed' }, lead);
  assert.ok(leadStop, 'the lead holds the same act over the seat it leads');
});

// ── r12c-b: a stale grant confers no authority ────────────────────────────────────────────────
test('r12c-b: a grant confers authority only while it is current', async (t) => {
  const f = fixture(t);
  const { lead } = await f.team();

  await f.call('stop', { participantId: 'lead', reason: 'The root settled the lead' }, owner);
  const settled = f.roster().lead;
  assert.equal(settled.status, 'left', 'the lead membership ended');
  assert.ok(settled.permissions.includes('recruit'),
    'the settled row still records the flat grant it held, so the refusal below is the grant’s staleness, not an emptied list');

  // The SAME request the current lead was admitted on is refused once the grant is stale.
  const stale = await f.refused('stop', { participantId: 'childA', reason: 'a stale grant' }, lead);
  assert.equal(stale?.code, 'swarm_membership_required',
    'a principal whose membership ended holds no authority: the grant is not current');
  assert.equal(f.roster().childA.status, 'active', 'and the seat it would have stopped is untouched');
});

// ── r12c-c1: the effect rechecks the current authority — the stop leg ─────────────────────────
test('r12c-c1: the stop effect rechecks the authority the dispatch admitted it under', async (t) => {
  // The run drain is an await, so the caller can be settled while it runs. This row is a MECHANISM
  // row: on the base it fails, because the effect settled the seat anyway. Observed run
  // (2026-09-25): a lead settled mid-drain still wrote childA's departure.
  const f = fixture(t);
  const { lead } = await f.team();
  const childRun = f.roster().childA.runId;
  f.runtime.stopRun = async (runId) => {
    if (runId === childRun) {
      await f.call('stop', { participantId: 'lead', reason: 'settled during the drain' }, owner);
    }
    const row = f.workers.find((candidate) => candidate.runId === runId);
    if (row) row.status = 'dead';
    return { state: 'closed' };
  };
  const refusal = await f.refused('stop', { participantId: 'childA', reason: 'done' }, lead);
  assert.equal(refusal?.code, 'swarm_membership_required',
    'the effect rechecks the current authority: the grant ended during the drain');
  assert.equal(f.roster().childA.status, 'active',
    'and the seat the stale grant would have settled stays active');
});

// ── r12c-c2: the effect rechecks the current authority — the recruit leg (already held) ───────
test('r12c-c2: the recruit effect rechecks after its awaited intent', async (t) => {
  // The recruit path already ran the permission derivation inside its effect (the runtime's
  // precedent for the clause), so this row demonstrates the clause rather than adding to it: it
  // passes on the base too.
  const f = fixture(t);
  const { lead } = await f.team();
  f.runtime.prepareRun = async () => {
    await f.call('stop', { participantId: 'lead', reason: 'settled during the intent' }, owner);
  };
  const refusal = await f.refused('recruit',
    { participantId: 'childC', objective: 'More work', permissions: ['read', 'contribute'] }, lead);
  assert.equal(refusal?.code, 'swarm_membership_required',
    'the recruit effect re-reads the authority after the awaited intent');
  assert.equal(Object.hasOwn(f.roster(), 'childC'), false,
    'and no membership is written for a grant that is no longer current');
});

// ── r12c-d: one lawful grant confers no second permission ─────────────────────────────────────
test('r12c-d: no second permission denies an act the relation admitted', async (t) => {
  const f = fixture(t);
  const { lead, peer } = await f.team();
  await f.childContribution('childA', 'contribution-a');

  // The lead holds no flat `review`, so the relation is its only grant. Capturing another seat's
  // revision is gated at `review`; before revision 12c the effect refused this with a second
  // flat-list check ("Capturing another participant requires review authority") after dispatch had
  // admitted it. The retained run is named in the runtime comment at that site.
  const captured = await f.call('capture', { participantId: 'childA', contributionId: 'contribution-a' }, lead);
  assert.ok(captured, 'the lead captures the work of the seat it leads under its one lawful grant');

  // The same act on the same record is refused for a seat the actor does not lead: the one grant
  // is the relation, and no grant means no act.
  const peerCapture = await f.refused('capture', { participantId: 'childA', contributionId: 'contribution-a' }, peer);
  assert.equal(peerCapture?.code, 'swarm_permission_required',
    'the peer holds no review and leads no seat, so the act is refused at dispatch');
});

// ── r12c-e: a current delegation holds every management act over its scope ────────────────────
test('r12c-e: a current delegation holds recruit, guide, stop, review, integrate and resume', async (t) => {
  const f = fixture(t);
  const { lead, childA, peer } = await f.team();

  // Recruit (and its resume spelling): the subject is prospective, so the flat `recruit` grant
  // admits it and the seat joins under the caller's own identity.
  const recruited = await f.call('recruit',
    { participantId: 'childC', objective: 'More work', permissions: ['read', 'contribute'] }, lead);
  assert.ok(recruited, 'Recruit: the lead creates a seat');
  assert.equal(f.roster().childC.parentId, 'lead', 'and the prospective seat scope is the caller');
  const resumed = await f.call('recruit',
    { participantId: 'childD', resumeFrom: 'childB', objective: 'Continue B', permissions: ['read', 'contribute'] }, lead);
  assert.ok(resumed, 'Resume: the lead continues a seat through its own lineage');

  // Guide: the lead holds no flat `communicate`.
  const guided = await f.call('guide', { participantId: 'childA', message: 'Proceed' }, lead);
  assert.ok(guided, 'Guide: the lead guides the seat it leads');

  // Review: capture the seat's revision, and record the review of its contribution. The recorded
  // review names only the contribution, so the seat is the fold's own author fact.
  await f.childContribution('childA', 'contribution-review');
  const captured = await f.call('capture', { participantId: 'childA', contributionId: 'contribution-review' }, lead);
  assert.ok(captured, 'Review: the lead captures the seat’s revision');
  const reviewed = await f.call('update', {
    event: 'swarm.contribution_reviewed',
    payload: { contributionId: 'contribution-review', decision: 'accept', reason: 'Reviewed by its orchestrator' },
  }, lead);
  assert.ok(reviewed, 'Review: the lead records the review of the seat’s contribution');

  // Integrate: the lead holds no flat `organize`, so the relation is its only grant. The act is
  // admitted at dispatch; the refusal that follows is the landing's own semantic precondition (an
  // unrevoked accept), which the law's model leaves outside its scope.
  await f.childContribution('childA', 'contribution-integrate');
  const integrateRefusal = await f.refused('integrate', { contributionId: 'contribution-integrate' }, lead);
  assert.notEqual(integrateRefusal?.code, 'swarm_permission_required',
    'Integrate: no authority refusal — the relation admitted the act');
  assert.equal(integrateRefusal?.code, 'integrate_contribution_not_accepted',
    'the act reaches the landing’s own semantic precondition instead');

  // Stop: the lead holds no flat `stop`.
  const stopped = await f.call('stop', { participantId: 'childC', reason: 'Work complete' }, lead);
  assert.ok(stopped, 'Stop: the lead stops a seat it leads');

  // The whole set is the DELEGATION’s: the same acts over a seat the lead does not lead are
  // refused, so nothing here is a flat grant the lead always held.
  for (const [command, args] of [
    ['guide', { participantId: 'peer', message: 'x' }],
    ['stop', { participantId: 'peer', reason: 'x' }],
    ['capture', { participantId: 'peer', contributionId: 'contribution-review' }],
  ]) {
    const refused = await f.refused(command, args, lead);
    assert.equal(refused?.code, 'swarm_permission_required',
      `${command} over a seat the lead does not lead is refused`);
  }
  assert.equal(f.roster().peer.status, 'active', 'and the peer is untouched');
});

// ── r12c-f: a seat stops itself under its own scope ──────────────────────────────────────────
test('r12c-f: a seat stops itself, and holds nothing else over itself or its lead', async (t) => {
  const f = fixture(t);
  const { lead, childA } = await f.team();

  // The Itself case: neither the lead nor a child holds a flat `stop`, and each stops itself.
  const childSelfStop = await f.call('stop', { participantId: 'childA', reason: 'I am done' }, childA);
  assert.ok(childSelfStop, 'a seat stops itself under its own scope');
  assert.equal(f.roster().childA.status, 'left');
  const leadSelfStop = await f.call('stop', { participantId: 'lead', reason: 'Lane closed' }, lead);
  assert.ok(leadSelfStop, 'the lead declares itself done the same way');

  // The relation runs one way: a seat holds no act over the seat that recruited it.
  const upward = await f.refused('stop', { participantId: 'lead', reason: 'Trying upward' }, principal('w-3'));
  assert.equal(upward?.code, 'swarm_permission_required',
    'a seat does not lead the seat that recruited it');
});
