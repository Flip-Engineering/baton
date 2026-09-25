// Issue #543 — the resume-decision ASK is delivered by native wake. A `--resume-from` recruit under
// the manual policy records the question and stops before the work (docs/52 D1); this file pins HOW
// the question reaches the orchestrator the join names: through the ONE guidance delivery dance —
// the parent's own lane when its harness takes mid-turn delivery, else the #337 park its next read
// composes — beside the ledger rows every other reader already carries (the wake class, the
// attention row, and the root's own session over the deployment wake stream, docs/54 §4).
//
// Rows:
//   543-a  a seat's resume recruit delivers the ask to that seat's lane: the parent's worker
//          receives it, a guidance_sent row addressed to the parent names the row it threads to,
//          and the successor still waits with no worker and no host lease.
//   543-b  a one-shot parent's ask parks (reason harness_one_shot) and composes into the parent's
//          own successor brief, so the parent's next read carries the ask with no verb called.
//   543-c  a root-run resume names no seat in this tree: no ask is addressed to anyone, the
//          question is still recorded, and the successor holds no lease (docs/52 D7).
//
// SUITE LAW: temp dirs, a scripted coordinator, real git repositories, no provider process, no
// network. git stash is never used.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { allocatePhysicalWorkspaceOwner, createFromBase } from '../src/worktree.mjs';

const SWARM_ID = 'recovery-543';
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
// A seat's TWO identities, exactly as the native bridge mints them (#273): the actor carries the
// `swarm-native:<swarm>:<participant>` spelling the provenance derivation reads, and the principalId
// carries the worker the membership resolves through.
const seatPrincipal = (workerId, participantId) => ({ actor: `swarm-native:${SWARM_ID}:${participantId}`,
  principalId: `worker:${workerId}`, sessionId: workerId });
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const deployment = {
  deploymentId: createHash('sha256').update('issue543-deployment').digest('hex'),
  controllerId: createHash('sha256').update('issue543-controller').digest('hex'),
  pid: process.pid, pidStart: 'issue543-instance',
};

function fixture(t, { midTurn = 'supported' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue543-'));
  const repo = join(directory, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Issue 543']);
  git(repo, ['config', 'user.email', 'issue543@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = new CoordinationStore(join(directory, 'coordination'));
  const workers = [];
  const vendor = midTurn === 'unsupported' ? 'one-shot' : 'mock';
  const capacity = {
    acquired: [], released: [],
    acquire: async (kind, { holder }) => {
      capacity.acquired.push({ kind, holder });
      return { token: { kind, nonce: `${capacity.acquired.length}`.padStart(32, '0'),
        residentId: deployment.controllerId } };
    },
    release: async (token) => { capacity.released.push(token); return true; },
    releaseWorkersExcept: async () => 0,
  };
  const checkouts = new Map();
  const guides = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => (midTurn === 'unsupported'
      ? [{ name: vendor, card: { verbs: { prompt: 'unsupported', steer: 'unsupported' } } }]
      : []),
    guideParticipant: async (workerId, message, options = {}) => {
      guides.push({ workerId, message, priority: options.priority ?? null });
      if (midTurn === 'unsupported') return { ok: false, result: 'unsupported' };
      const worker = workers.find((row) => row.id === workerId);
      if (worker) worker.delivered.push(message);
      return { ok: true };
    },
    workspaceAttachment: (workerId) => checkouts.get(workerId) ?? null,
    liveWorkspaceHolders: () => [],
    predecessorWorkspaceContext: (workspaceId) => {
      const row = [...checkouts.values()].find((entry) => entry.workspaceId === workspaceId);
      return row === undefined ? null : { sessionContext: row.sessionContext, holders: [] };
    },
  };
  const runtime = new SwarmRuntime({
    store,
    coordinator,
    hostCapacity: capacity,
    authorize: async () => {},
    prepareRun: async (request) => ({ ...request }),
    situationGit: { repoRoot: repo },
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      const carried = request.workspace ?? null;
      const carriedCheckout = carried?.workspaceId === undefined
        ? null : join(repo, '.baton', 'wt', carried.workspaceId);
      let workspaceId = carried?.workspaceId ?? null;
      let worktree = carriedCheckout !== null && existsSync(carriedCheckout) ? carriedCheckout : null;
      if (worktree === null) {
        const receipt = allocatePhysicalWorkspaceOwner(repo, {
          runId: request.runId, attemptId: `attempt-${workers.length + 1}`,
          logicalTaskId: request.participantId, processGeneration: 1, baseSha,
        }, deployment);
        workspaceId = receipt.physicalOwnerId;
        worktree = (await createFromBase(repo, workspaceId, baseSha, { ownerReceipt: receipt })).dir;
      }
      const workerId = `w-${workers.length + 1}`;
      const sessionContext = carried?.sessionContext
        ?? { ownerTaskId: workspaceId, worktree, branch: `baton/${workspaceId}`, baseSha };
      checkouts.set(workerId, { workspaceId, worktree, sessionContext });
      workers.push({ id: workerId, taskId: `t-${workers.length + 1}`, runId: request.runId,
        status: 'working', paused: false, terminalCause: null, vendor, delivered: [],
        sessionContext, worktree });
    },
    stopRun: async (runId) => {
      workers.find((row) => row.runId === runId).status = 'dead';
      return { state: 'closed' };
    },
    lastCrash: () => null,
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: SWARM_ID,
      ...(['view', 'watch', 'list'].includes(command) ? {} : { idempotencyKey: `ask543-${++key}` }),
      ...args }, caller);
  const eventsOf = (kind, participantId) => store.eventsView()
    .filter((event) => (event.kind === 'driver.recorded' ? event.payload?.kind : event.kind) === kind
      && (participantId === undefined || event.payload?.participantId === participantId));
  const workerOf = (participantId) => {
    const row = store.swarm(SWARM_ID)?.participants?.[participantId] ?? null;
    return row === null ? null : workers.find((entry) => entry.runId === row.runId) ?? null;
  };
  return {
    store, runtime, repo, baseSha, workers, guides, capacity, call, eventsOf, workerOf,
    asSeat: (participantId) => seatPrincipal(workerOf(participantId).id, participantId),
    seat: (participantId) => store.swarm(SWARM_ID)?.participants?.[participantId] ?? null,
    recruit: (participantId, options = {}, caller = owner) => call('recruit', {
      participantId, objective: options.objective ?? `Continue the lane as ${participantId}`,
      ...(options.resumeFrom === undefined ? {} : { resumeFrom: options.resumeFrom }),
      ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    }, caller),
  };
}

/** One interrupted seat in the tree of a sub-orchestrator: `lead` recruited `alpha`, alpha was
 * interrupted mid-lane, and the interruption is what a successor resumes (docs/52 D4's tree). */
async function interruptedLane(t, options = {}) {
  const f = fixture(t, options);
  await f.call('create', { purpose: 'A recovered seat asks its lead whether to continue' });
  await f.recruit('lead', { permissions: [...SWARM_PERMISSIONS] });
  await f.recruit('alpha', {}, f.asSeat('lead'));
  const checkout = [...f.workerOf('alpha').worktree ? [{ worktree: f.workerOf('alpha').worktree }] : []][0];
  writeFileSync(join(checkout.worktree, 'alpha-work.txt'), 'alpha work\n');
  await f.call('stop', { participantId: 'alpha', reason: 'Interrupted mid-lane' });
  assert.equal(f.seat('alpha').status, 'left');
  return f;
}

// ── 543-a: the ask reaches the orchestrator the join names ───────────────────

test('543-a: a seat\'s resume recruit delivers the ask to that seat\'s own lane', async (t) => {
  const f = await interruptedLane(t);
  await f.recruit('bravo', { resumeFrom: 'alpha' }, f.asSeat('lead'));

  const bravo = f.seat('bravo');
  assert.equal(bravo.status, 'active', 'the successor is a member');
  assert.equal(bravo.parentId, 'lead', 'the join names the seat that recruited it (docs/52 D4)');
  assert.deepEqual(bravo.bindings, [], 'and it waits: no worker bound, no work started');

  const requests = f.eventsOf('swarm.resume_decision_requested', 'bravo');
  assert.equal(requests.length, 1, 'the question is on the ledger');
  const sent = f.eventsOf('swarm.guidance_sent', 'lead');
  assert.equal(sent.length, 1, 'the ask is delivered to the lead, not left to be read');
  const ask = sent[0].payload;
  assert.equal(ask.inReplyTo, requests[0].seq, 'the ask threads to the question it asks about');
  assert.equal(ask.delivery.state, 'delivered', 'the lead\'s harness takes mid-turn delivery');
  assert.match(f.guides[0].message, /bravo/u, 'the ask names the seat it is about');
  assert.match(f.guides[0].message, /baton swarm guide recovery-543 bravo/u,
    'and the act that continues it');
  assert.match(f.guides[0].message, /baton swarm stop recovery-543 bravo/u,
    'and the act that settles it');
  assert.deepEqual(f.capacity.acquired.filter((row) => row.holder.endsWith(':bravo')), [],
    'the waiting successor holds no host lease (docs/52 D7)');
});

// ── 543-b: a one-shot parent reads the ask in its own next brief ─────────────

test('543-b: a one-shot orchestrator\'s ask parks and composes into its next brief', async (t) => {
  const f = await interruptedLane(t, { midTurn: 'unsupported' });
  await f.recruit('bravo', { resumeFrom: 'alpha' }, f.asSeat('lead'));

  const parked = f.eventsOf('swarm.guidance_parked', 'lead');
  assert.equal(parked.length, 1, 'a harness that takes no mid-turn delivery parks the ask');
  assert.equal(parked[0].payload.delivery.reason, 'harness_one_shot');
  assert.equal(parked[0].payload.delivery.state, 'parked');
  assert.match(parked[0].payload.message, /Resume decision for bravo/u);
  assert.equal(f.eventsOf('swarm.guidance_sent', 'lead').length, 0, 'nothing was delivered mid-turn');

  // The parent's next read IS its own successor's brief (the #337 seam): the ask is composed there
  // with no verb called, which is what makes this delivery native rather than a read.
  await f.call('stop', { participantId: 'lead', reason: 'Interrupted mid-lane' });
  await f.call('update', { event: 'swarm.policy_updated',
    payload: { resumeContinuation: 'auto' } });
  await f.recruit('lead2', { resumeFrom: 'lead' });
  const lead2 = f.seat('lead2');
  assert.ok(lead2.brief, 'the auto-continued successor carries a brief');
  assert.match(lead2.brief, /Parked guidance for lead/u,
    'the brief composes the ask its predecessor never read');
  assert.match(lead2.brief, /Resume decision for bravo/u, 'and the ask is whole: the seat, the acts');
});

// ── 543-c: a tree with no orchestrator seat addresses no seat ────────────────

test('543-c: a root-run resume addresses no seat, and the question still waits', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'A root recovers a seat no seat recruited' });
  await f.recruit('alpha');
  await f.call('stop', { participantId: 'alpha', reason: 'Interrupted mid-lane' });

  await f.recruit('bravo', { resumeFrom: 'alpha' });
  assert.equal(f.seat('bravo').parentId, null, 'no seat in the tree owns this recovery');
  assert.equal(f.eventsOf('swarm.resume_decision_requested', 'bravo').length, 1,
    'the question is recorded for whoever holds the swarm');
  assert.equal(f.eventsOf('swarm.guidance_sent').length + f.eventsOf('swarm.guidance_parked').length, 0,
    'no ask is addressed to a seat that does not exist');
  assert.deepEqual(f.capacity.acquired.filter((row) => row.holder.endsWith(':bravo')), [],
    'and the waiting seat holds no lease');
});
