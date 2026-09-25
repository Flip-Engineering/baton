// Issue #423 red-before skeleton (stage: design-not-landed): claims on work items and path
// sets, work-splitting proposals accepted by arrival, the peers-now brief section, and the
// shared_checkout_overlap attention row — as specified by docs/45-open-coordination.md
// §2, §3, §5 and §6.
//
// Every row asserts the behaviour docs/45 specifies against the CURRENT runtime and is expected
// RED: swarm.claim_updated and swarm.proposal_updated are not in the public kind set yet (today
// the first unlanded call refuses swarm_command_unavailable, and each row's message names what
// the implementer must land). When a row goes green its expected-red manifest entry is stale
// and is retired with the landing (docs/44).
//
// Manifest plan (docs/44 rule 5): these rows list with reason #423. The manifest
// (impl/scripts/expected-red-tests.json) is outside this design lane's path scope; listing the
// rows is the implementing lane's first act, named in docs/45 §13.
//
// Fixture: the light SwarmRuntime harness (swarm-runtime.test.mjs) plus a workspaceAttachment
// mock, so alpha and beta are recorded in ONE shared checkout (ws-aaa…, a real git worktree the
// overlap row reads) and charlie in a private one (ws-bbb…) — the conflict rule keys on the
// recorded checkout (docs/45 §2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const WS_SHARED = `ws-${'a'.repeat(32)}`;
const WS_PRIVATE = `ws-${'b'.repeat(32)}`;
const SHARED_SEATS = new Set(['alpha', 'beta']);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue423-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // The shared checkout is a real git worktree: the overlap derivation reads it with the same
  // read-only git authority the view already uses (worktreeChangedPaths, docs/45 §5).
  const sharedRepo = join(directory, 'shared');
  execFileSync('git', ['init', '-q', sharedRepo]);
  execFileSync('git', ['config', 'user.name', 'Issue 423'], { cwd: sharedRepo });
  execFileSync('git', ['config', 'user.email', 'issue-423@example.invalid'], { cwd: sharedRepo });
  mkdirSync(join(sharedRepo, 'impl', 'src'), { recursive: true });
  writeFileSync(join(sharedRepo, 'impl', 'src', 'held.mjs'), '// held\n');
  execFileSync('git', ['add', '.'], { cwd: sharedRepo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: sharedRepo });
  // The WIP a peer must see BEFORE its own commit: an uncommitted change under a claimed path.
  writeFileSync(join(sharedRepo, 'impl', 'src', 'held.mjs'), '// held — changed by a seat\n');
  const privateDir = join(directory, 'private');
  mkdirSync(privateDir, { recursive: true });
  const store = new CoordinationStore(directory);
  const workers = [];
  const starts = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : []),
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
    workspaceAttachment: (workerId) => {
      const worker = workers.find((row) => row.id === workerId);
      if (!worker) return null;
      return SHARED_SEATS.has(worker.participantId)
        ? { workspaceId: WS_SHARED, worktree: sharedRepo }
        : { workspaceId: WS_PRIVATE, worktree: privateDir };
    },
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      starts.push(request);
      const shared = SHARED_SEATS.has(request.participantId);
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, participantId: request.participantId, status: 'working', paused: false,
        vendor: 'mock-session',
        sessionContext: shared ? { worktree: sharedRepo, repoRoot: sharedRepo } : { worktree: privateDir, repoRoot: privateDir } });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const recruit = (participantId) => call('recruit', { participantId, objective: `Continue working as ${participantId}` });
  const team = async () => {
    await call('create', { purpose: 'Claims and peers-now (#423)' });
    await recruit('alpha');
    await recruit('beta');
    await recruit('charlie');
    await call('update', { event: 'swarm.work_updated', payload: { workId: 'W-1', objective: 'The one shared task' } });
    return { alpha: principal('w-1'), beta: principal('w-2'), charlie: principal('w-3') };
  };
  const claimRow = (view, claimId) => (view?.claims ?? []).find((row) => row.claimId === claimId) ?? null;
  return { store, runtime, workers, starts, call, recruit, team, claimRow };
}

test('#423 RED (stage: design-not-landed): a contribute seat claims a work item and every peer sees the hold', async (t) => {
  const f = fixture(t);
  const { alpha } = await f.team();
  const claimed = await f.call('update', { event: 'swarm.claim_updated', payload: {
    claimId: 'c-1', workId: 'W-1',
  } }, alpha);
  assert.equal(claimed.receipt.event.kind, 'swarm.claim_updated',
    'land swarm.claim_updated: a claim on a work item any contribute seat may take (docs/45 §2)');
  const view = await f.call('view');
  const claim = f.claimRow(view, 'c-1');
  assert.ok(claim, 'land the claims collection on the view, an array of rows (docs/45 §2, §8)');
  assert.equal(claim.participantId, 'alpha', 'the claim names its holder — derived from the caller, never caller-chosen (docs/45 §2)');
  assert.equal(claim.status, 'active', 'a new claim is active (docs/45 §2)');
  assert.equal(claim.workspaceId, WS_SHARED, 'a claim binds the claimant\'s recorded checkout (docs/45 §2)');
});

test('#423 RED (stage: design-not-landed): a path claim on a checkout another peer holds refuses naming the holder; another checkout never conflicts', async (t) => {
  const f = fixture(t);
  const { alpha, beta, charlie } = await f.team();
  await f.call('update', { event: 'swarm.claim_updated', payload: {
    claimId: 'c-1', paths: ['impl/src'],
  } }, alpha);
  await assert.rejects(f.call('update', { event: 'swarm.claim_updated', payload: {
    claimId: 'c-2', paths: ['impl/src/held.mjs'],
  } }, beta), (error) => {
    assert.equal(error.code, 'swarm_claim_conflict',
      'land the claim conflict: same recorded checkout, overlapping paths (docs/45 §2)');
    assert.match(error.message, /alpha/, 'the refusal names the holder (docs/45 §2)');
    assert.match(error.message, /c-1/, 'the refusal names the holding claim (docs/45 §2)');
    return true;
  });
  const admitted = await f.call('update', { event: 'swarm.claim_updated', payload: {
    claimId: 'c-3', paths: ['impl/src/held.mjs'],
  } }, charlie);
  assert.equal(admitted.receipt.event.kind, 'swarm.claim_updated',
    'land per-checkout exclusivity: the same path on another checkout never conflicts (docs/45 §2)');
  // The claim is visible in every peer's next brief: a new recruit's brief renders it (§6/§8).
  await f.recruit('delta');
  const brief = f.starts.at(-1).objective;
  assert.match(brief, /impl\/src/,
    'land the peers-now brief section: a peer\'s claimed paths render in the next brief (docs/45 §6)');
});

test('#423 RED (stage: design-not-landed): a handoff moves the hold in one row; a non-holder cannot move it', async (t) => {
  const f = fixture(t);
  const { alpha, beta } = await f.team();
  await f.call('update', { event: 'swarm.claim_updated', payload: { claimId: 'c-1', workId: 'W-1' } }, alpha);
  await assert.rejects(f.call('update', { event: 'swarm.claim_updated', payload: {
    claimId: 'c-1', handoffTo: 'charlie',
  } }, beta), (error) => {
    assert.equal(error.code, 'swarm_permission_required',
      'land claim-holder-or-organize: a non-holder never moves the claim (docs/45 §2.2)');
    return true;
  });
  await f.call('update', { event: 'swarm.claim_updated', payload: {
    claimId: 'c-1', handoffTo: 'beta',
  } }, alpha);
  const view = await f.call('view');
  const claim = f.claimRow(view, 'c-1');
  assert.equal(claim.participantId, 'beta', 'land the handoff: the hold moves in ONE row, no free window (docs/45 §2.2)');
  assert.equal(claim.status, 'active', 'a handoff keeps the claim active (docs/45 §2.2)');
  assert.equal((view.claims ?? []).filter((row) => row.claimId === 'c-1').length, 1,
    'the handoff is one row, not a release-plus-claim pair (docs/45 §2.2)');
});

test('#423 RED (stage: design-not-landed): a claim whose holder is gone raises claim_holder_gone naming the release', async (t) => {
  const f = fixture(t);
  const { alpha } = await f.team();
  await f.call('update', { event: 'swarm.claim_updated', payload: { claimId: 'c-1', workId: 'W-1' } }, alpha);
  f.workers.find((row) => row.id === 'w-1').status = 'dead';
  const view = await f.call('view');
  const row = (view.attention ?? []).find((entry) => entry.kind === 'claim_holder_gone' && entry.claimId === 'c-1');
  assert.ok(row, 'land claim_holder_gone: the mirror of assignment_holder_gone (docs/45 §2.1)');
  assert.equal(row.participantId, 'alpha', 'the row names the gone holder (docs/45 §2.1)');
  assert.deepEqual(row.next, { event: 'swarm.claim_updated', claimId: 'c-1', status: 'released' },
    'the row names the release — death never auto-releases (docs/45 §2.1, §0)');
});

test('#423 RED (stage: design-not-landed): a work-splitting proposal accepted by arrival writes its work items and claims', async (t) => {
  const f = fixture(t);
  const { alpha, beta } = await f.team();
  const proposed = await f.call('update', { event: 'swarm.proposal_updated', payload: {
    proposalId: 'p-1', action: 'propose', members: ['alpha', 'beta'],
    plan: { work: [{ workId: 'W-split', objective: 'The split half' }], claims: [{ participantId: 'beta', workId: 'W-split' }] },
  } }, alpha);
  assert.equal(proposed.receipt.event.kind, 'swarm.proposal_updated',
    'land swarm.proposal_updated: a peer writes the split down, the named seats accept by arriving (docs/45 §3)');
  const midway = await f.call('view');
  const proposal = (midway.proposals ?? []).find((row) => row.proposalId === 'p-1');
  assert.ok(proposal, 'land the proposals collection on the view (docs/45 §3, §8)');
  assert.equal(proposal.proposed, true, 'a proposal is proposed until consent completes (docs/45 §3)');
  assert.deepEqual(proposal.consents, ['alpha'], 'the proposer consents by proposing (docs/45 §3)');
  await f.call('update', { event: 'swarm.proposal_updated', payload: {
    proposalId: 'p-1', action: 'arrive',
  } }, beta);
  const accepted = await f.call('view');
  assert.ok(accepted.work['W-split'],
    'land acceptance-as-expansion: the last consent writes the plan\'s work rows (docs/45 §3)');
  const minted = f.claimRow(accepted, 'p-1-claim-0');
  assert.ok(minted, 'land the deterministically minted claim (${proposalId}-claim-${index}, docs/45 §3)');
  assert.equal(minted.participantId, 'beta', 'the minted claim names the holder the plan named — arrival consented to it (docs/45 §3)');
});

test('#423 RED (stage: design-not-landed): the peers-now brief section renders held work and last checkpoints from the durable rows', async (t) => {
  const f = fixture(t);
  const { alpha } = await f.team();
  await f.call('update', { event: 'swarm.assignment_updated', payload: {
    assignmentId: 'as-1', participantId: 'alpha', workId: 'W-1', status: 'active',
  } });
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'alpha-progress', body: 'half of W-1', workId: 'W-1',
  } }, alpha);
  await f.recruit('delta');
  const brief = f.starts.at(-1).objective;
  assert.match(brief, /Peers now/,
    'land the peers-now section in every recruit and resume brief (docs/45 §6)');
  assert.match(brief, /alpha[^\n]*W-1|W-1[^\n]*alpha/,
    'the section names each peer\'s held work from the active assignments (docs/45 §6)');
  assert.match(brief, /alpha-progress/,
    'the section names each peer\'s last checkpoint from the contribution rows (docs/45 §6)');
});

test('#423 RED (stage: design-not-landed): a claimed path observed changed on a shared checkout raises shared_checkout_overlap before any commit', async (t) => {
  const f = fixture(t);
  const { beta } = await f.team();
  await f.call('update', { event: 'swarm.claim_updated', payload: {
    claimId: 'c-1', paths: ['impl/src/held.mjs'],
  } }, beta);
  const view = await f.call('view');
  const overlap = (view.attention ?? []).find((entry) => entry.kind === 'shared_checkout_overlap');
  assert.ok(overlap,
    'land shared_checkout_overlap: the shared checkout\'s changed set intersecting an active claim pages before commit (docs/45 §5)');
  assert.equal(overlap.workspaceId, WS_SHARED, 'the row names the shared checkout (docs/45 §5)');
  assert.ok(overlap.paths.includes('impl/src/held.mjs'), 'the row names the changed-and-claimed paths (docs/45 §5)');
  assert.ok((overlap.holders ?? []).some((holder) => holder.participantId === 'beta' && holder.claimId === 'c-1'),
    'the row names the holder and the claim (docs/45 §5)');
});
