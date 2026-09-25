// Issue #441, lane D — claims instead of handovers, as specified by
// docs/47-the-reading-half.md §5 (activated with #422/#423) over docs/45-open-coordination.md §2.
//
//   441d-a  a seat's declared recruit scope is recorded as its FIRST claim row at bind
//           (`scope:<participantId>`, bound to the seat's recorded checkout); a recruit that
//           declared no scope writes no claim — absence, never a guess;
//   441d-b  a path claim overlapping another seat's ACTIVE hold on the same recorded checkout
//           refuses `swarm_claim_conflict` typed, pre-effect, naming the holder, the holding
//           claimId and the overlapping paths — while a SCOPE claim never fences: a peer's
//           hold over a path the scope covers, and a recruit whose scope meets a peer's hold,
//           are both admitted (scopes overlap legally, docs/45 §2);
//   441d-c  the holder hands the hold off in ONE row (`handoffTo`) and the claim the conflict
//           refused is then admitted;
//   441d-d  the composed brief's `## Claims` block teaches the spelling with the validator's OWN
//           path-claim example (derived from swarm-event-schemas.mjs, never hand-typed) and
//           lists the seat's own claim (its scope) and every peer's active claim overlapping it;
//   441d-e  the scope claim and its exemption replay byte-identically, and the reserved
//           `scope:` namespace refuses a claim id that names another seat.
//
// The fixture is the light SwarmRuntime harness (swarm-runtime.test.mjs) with the
// workspaceAttachment mock every seat records its checkout through: the conflict rule keys on
// the RECORDED checkout, exactly as `issue423-claims-and-peers.test.mjs` reads it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { foldSwarmEvent, scopeClaimId, swarmSnapshot, validateSwarmEvent } from '../src/swarm-state.mjs';
import { SWARM_EVENT_PAYLOAD_SCHEMAS } from '../src/swarm-event-schemas.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const WS = `ws-${'a'.repeat(32)}`;
// `scopeClaimId` (swarm-state.mjs) is the ONE derivation: the runtime's bind-time write and the
// fold's namespace guard and conflict exemption all read this function, so a row this file finds
// by `scopeClaimId('alpha')` IS the row the runtime wrote.

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue441d-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const starts = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
    // Every seat in this fixture works in ONE recorded checkout: the conflict rule is
    // per-checkout, so a shared one is what makes the overlap rows readable at all.
    workspaceAttachment: (workerId) => (workers.some((row) => row.id === workerId)
      ? { workspaceId: WS, worktree: directory } : null),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      starts.push(request);
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, participantId: request.participantId, status: 'working',
        vendor: 'mock-session' });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const recruit = (participantId, extra = {}) => call('recruit',
    { participantId, objective: `Continue working as ${participantId}`, ...extra });
  const claim = (payload, caller) => call('update', { event: 'swarm.claim_updated', payload }, caller);
  // A seat's bridge identity is its worker: the fixture names workers in recruit order.
  const seatOf = (participantId) => {
    const worker = workers.find((row) => row.participantId === participantId);
    return principal(worker.id);
  };
  const claimRow = (view, claimId) => (view?.claims ?? []).find((row) => row.claimId === claimId) ?? null;
  const briefOf = (participantId) => starts.find((request) => request.participantId === participantId)?.objective ?? '';
  return { store, workers, starts, runtime, call, recruit, claim, seatOf, claimRow, briefOf };
}

test('#441d-a: the declared recruit scope is the seat\'s first claim row (docs/47 §5 item 3)', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Claims instead of handovers (#441)' });
  await f.recruit('alpha', { options: { scope: ['impl/src', 'impl/test/issue441d-*.test.mjs'] } });
  const view = await f.call('view');
  const row = f.claimRow(view, scopeClaimId('alpha'));
  assert.ok(row, 'the recruit scope is recorded as the seat\'s initial claim at bind (docs/47 §5 item 3)');
  assert.equal(row.participantId, 'alpha', 'the scope claim names its holder');
  assert.equal(row.status, 'active', 'the seat\'s first claim is active');
  assert.deepEqual([...row.paths], ['impl/src', 'impl/test/issue441d-*.test.mjs'],
    'the claim carries exactly the declared scope — the recruit\'s own paths');
  assert.equal(row.workspaceId, WS, 'the scope claim binds the seat\'s recorded checkout (docs/45 §2)');
  assert.equal(row.workId, null, 'a scope claim is a path claim, never a work claim');
  // A recruit that declared no scope writes no claim: absence, never a guess.
  await f.recruit('solo');
  const after = await f.call('view');
  assert.equal(f.claimRow(after, scopeClaimId('solo')), null, 'a seat with no declared scope claims nothing');
  assert.equal((after.claims ?? []).length, 1, 'the scope-less recruit added no claim row to the swarm');
  assert.equal(f.briefOf('solo').includes('## Claims'), false,
    'a seat with no scope and no claims of its own has no claim situation: the block is absent, never empty');
  // A scope claim is visibility, never a hold: when its holder goes there is no hold for a
  // release to settle (it conflicts with nothing), so it raises no claim_holder_gone row — the
  // participant row already says the seat is gone — while its claim row stays active on the view.
  await f.call('stop', { participantId: 'alpha', reason: 'lane done' });
  const gone = await f.call('view');
  assert.equal((gone.attention ?? []).some((entry) => entry.kind === 'claim_holder_gone'
    && entry.claimId === scopeClaimId('alpha')), false,
  'a gone holder\'s SCOPE claim pages nobody: it excludes nothing, and the seat\'s own row says it is gone');
  assert.equal(f.claimRow(gone, scopeClaimId('alpha')).status, 'active',
    'the scope claim row itself stays durable and active on the view');
});

test('#441d-b: an overlapping path claim refuses typed; a scope claim never fences (docs/47 §5 items 2-3)', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Claims instead of handovers (#441)' });
  await f.recruit('alpha', { options: { scope: ['impl/src'] } });
  await f.recruit('beta');
  // beta's hold over a path INSIDE alpha's declared scope is admitted: the scope claim is the
  // ground alpha was recruited onto, not a fence (scopes overlap legally, docs/45 §2).
  const betaClaim = await f.claim({ claimId: 'c-beta', paths: ['impl/src/held.mjs'] }, f.seatOf('beta'));
  assert.equal(betaClaim.receipt?.event?.kind, 'swarm.claim_updated',
    'a peer claim under a scope claim is admitted — a scope claim is never a conflict source');
  // A further seat's claim over the SAME paths on the same checkout refuses, typed and
  // pre-effect, naming the holder, the holding claimId and the overlapping paths (docs/45 §2).
  await f.recruit('gamma');
  await assert.rejects(f.claim({ claimId: 'c-gamma', paths: ['impl/src'] }, f.seatOf('gamma')), (error) => {
    assert.equal(error.code, 'swarm_claim_conflict', 'the overlap rule refuses `swarm_claim_conflict`');
    assert.match(error.message, /beta/u, 'the refusal names the holder');
    assert.match(error.message, /c-beta/u, 'the refusal names the holding claim');
    assert.deepEqual([...error.detail.paths], ['impl/src'],
      'the refusal names the overlapping paths of the claim it refuses');
    assert.equal(error.detail.holder, 'beta', 'the refusal detail names the holder');
    assert.equal(error.detail.holdingClaimId, 'c-beta', 'the refusal detail names the holding claimId');
    return true;
  });
  const view = await f.call('view');
  assert.equal(f.claimRow(view, 'c-gamma'), null, 'the refused claim was never recorded — pre-effect');
  assert.deepEqual([...f.claimRow(view, 'c-beta').paths], ['impl/src/held.mjs'],
    'the admitted peer hold is untouched by the refusal');
  // A NEW recruit whose scope meets that same active hold is admitted as well: the brief names
  // the overlap instead of the recruit refusing (docs/47 §5 item 3).
  const recruited = await f.recruit('delta', { options: { scope: ['impl/src/held.mjs'] } });
  assert.equal(recruited.participantId, 'delta', 'a recruit whose scope overlaps an active hold is admitted');
  const after = await f.call('view');
  assert.equal(f.claimRow(after, scopeClaimId('delta')).participantId, 'delta',
    'the admitted recruit still records its scope claim — over the paths a peer holds');
});

test('#441d-c: a handoff moves the hold in one row and the former conflict is admitted (docs/47 §5 item 2)', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Claims instead of handovers (#441)' });
  await f.recruit('alpha');
  await f.recruit('beta');
  await f.claim({ claimId: 'c-1', paths: ['impl/src/held.mjs'] }, f.seatOf('alpha'));
  await assert.rejects(f.claim({ claimId: 'c-2', paths: ['impl/src/held.mjs'] }, f.seatOf('beta')),
    (error) => error.code === 'swarm_claim_conflict', 'the second hold conflicts while alpha holds it');
  // The holder moves the hold to the seat that needed it — ONE row, no free window (docs/45 §2.2).
  const moved = await f.claim({ claimId: 'c-1', handoffTo: 'beta' }, f.seatOf('alpha'));
  assert.equal(moved.receipt?.event?.kind, 'swarm.claim_updated', 'the handoff is its own recorded row');
  const view = await f.call('view');
  assert.equal(f.claimRow(view, 'c-1').participantId, 'beta', 'the hold moved to the seat the handoff names');
  assert.equal(f.claimRow(view, 'c-1').status, 'active', 'a handoff keeps the claim active');
  assert.equal((view.claims ?? []).filter((row) => row.claimId === 'c-1').length, 1,
    'the handoff is ONE row, never a release-plus-claim pair');
  // The claim the conflict refused is now admitted: its holder IS the holder of the paths.
  const admitted = await f.claim({ claimId: 'c-2', paths: ['impl/src/held.mjs'] }, f.seatOf('beta'));
  assert.equal(admitted.receipt?.event?.kind, 'swarm.claim_updated',
    'the former conflict is admitted once the hold moved to its seat');
});

test('#441d-d: the brief\'s ## Claims block teaches the schema\'s example and names own and overlapping claims (docs/47 §5 item 1)', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Claims instead of handovers (#441)' });
  await f.recruit('beta');
  await f.claim({ claimId: 'c-beta', paths: ['impl/src/held.mjs'] }, f.seatOf('beta'));
  await f.recruit('gamma', { options: { scope: ['impl/src'] } });
  const brief = f.briefOf('gamma');
  assert.match(brief, /## Claims/u, 'the brief renders the new ## Claims block (docs/47 §5 item 1)');
  assert.ok(brief.indexOf('## Claims') > brief.indexOf('## Swarm situation'),
    'the block is the peers block\'s sibling — it follows ## Swarm situation');
  // The admitted example is the VALIDATOR's own, derived from the schema the bridge serves —
  // never a hand-typed second copy (#371's rule).
  const fields = SWARM_EVENT_PAYLOAD_SCHEMAS['swarm.claim_updated'].fields;
  const example = JSON.stringify({ event: 'swarm.claim_updated', payload: {
    claimId: fields.claimId.example, paths: fields.paths.example, status: fields.status.example } });
  assert.ok(brief.includes(example), `the block renders the schema's own path-claim example: ${example}`);
  // The seat's own claim: the scope it is being recruited with, recorded when it binds.
  assert.match(brief, /scope:gamma/u, 'the block names the seat\'s own scope claim');
  assert.match(brief, /impl\/src/u, 'the block names the paths the seat\'s own claim holds');
  // Every peer's ACTIVE claim that overlaps the seat's scope, with its holder.
  assert.match(brief, /c-beta[^\n]*beta|beta[^\n]*c-beta/u,
    'the block names the overlapping peer claim and its holder');
  assert.match(brief, /impl\/src\/held\.mjs/u, 'the block names the overlapping paths');
  // What the brief named is really recorded: the named scope claim is the seat's durable hold.
  const view = await f.call('view');
  const own = f.claimRow(view, scopeClaimId('gamma'));
  assert.ok(own, 'the scope claim the brief names is recorded when the seat binds');
  assert.equal(own.participantId, 'gamma', 'the recorded scope claim belongs to the brief\'s seat');
  // A settled seat is not a peer: its hold rides no later brief (the ONE #350 "can act"
  // predicate the peers block and every other surface read), while the claim row itself stays
  // durable on the view and its gone holder is the claim_holder_gone row's business.
  await f.call('stop', { participantId: 'beta', reason: 'lane done' });
  await f.recruit('epsilon', { options: { scope: ['impl/src'] } });
  const settled = f.briefOf('epsilon');
  assert.equal(settled.includes('c-beta'), false,
    'a settled seat\'s hold rides into no later brief — peers are the seats that can act');
  assert.ok(f.claimRow(await f.call('view'), 'c-beta'),
    'the claim row itself stays durable: the brief filters the PEER, never the record');
  // The counterpart, unchanged: a hold the seat TOOK still pages its release when the holder goes
  // (docs/45 §2.1) — the exemption is the scope claim's alone.
  assert.ok((await f.call('view')).attention.some((entry) => entry.kind === 'claim_holder_gone'
    && entry.claimId === 'c-beta'),
  'an ordinary claim whose holder is gone still raises claim_holder_gone — the landed rule');
});

test('#441d-e: the scope claim and its exemption replay byte-identically; the namespace is reserved (docs/47 §5)', async (t) => {
  const events = [
    ['swarm.created', { swarmId: 'replay', purpose: 'claims replay (#441d)' }],
    ['swarm.participant_joined', { swarmId: 'replay', participantId: 'alpha', workspaceId: WS }],
    ['swarm.participant_joined', { swarmId: 'replay', participantId: 'beta', workspaceId: WS }],
    ['swarm.claim_updated', { swarmId: 'replay', claimId: scopeClaimId('alpha'),
      participantId: 'alpha', paths: ['impl/src'], status: 'active' }],
    ['swarm.claim_updated', { swarmId: 'replay', claimId: 'c-beta', participantId: 'beta',
      paths: ['impl/src/held.mjs'] }],
  ];
  const fold = (swarms, admission) => events.forEach(([kind, payload], index) => foldSwarmEvent(swarms,
    { kind, payload, seq: index + 1, ts: `2026-09-18T00:00:0${index + 1}.000Z`, actor: 'root' }, { admission }));
  const admitted = new Map();
  fold(admitted, true);
  const own = admitted.get('replay').claims[scopeClaimId('alpha')];
  assert.ok(own, 'the scope claim folds as a claim row');
  assert.deepEqual([...own.paths], ['impl/src'], 'the scope claim holds the declared paths');
  assert.equal(own.workspaceId, WS, 'the scope claim binds the holder\'s recorded checkout');
  assert.ok(admitted.get('replay').claims['c-beta'],
    'the peer hold inside that scope is admitted beside it — the exemption is the fold\'s own rule');
  const replay = new Map();
  fold(replay, false);
  assert.deepEqual(swarmSnapshot(replay), swarmSnapshot(admitted),
    'the same log folds byte-identically: a replay never re-judges the conflict rule');
  // The `scope:` namespace is ONLY the seat's own scope claim: a hand-written claim must not
  // wear it, or an ordinary hold could exempt itself from the conflict rule.
  assert.throws(() => validateSwarmEvent('swarm.claim_updated', { swarmId: 'replay',
    claimId: scopeClaimId('beta'), participantId: 'alpha', paths: ['impl/src'] }),
  (error) => error?.code === 'invalid_payload',
  'a claim id naming another seat\'s scope refuses the closed shape');
});
