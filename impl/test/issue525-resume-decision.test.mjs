// Issue #525 — a recovered seat requests its orchestrator's continue decision.
// The contract this file pins is docs/52-resume-continuation-decision.md.
//
// The problem: `swarm.recruit --resume-from <old-id>` recovers the predecessor's workspace AND
// starts the successor on the continuation in one command — "resume the workspace" and
// "continue the same work" are conflated into one act, and no row ever asks the seat's
// orchestrator (the root, or the sub-orchestrator that recruited the predecessor) whether the
// interrupted objective is still the right one.
//
// The contract (docs/52 D1-D7):
//   - a resume-from recruit joins the successor, plans the carry with today's pre-effect
//     refusals, records `swarm.resume_decision_requested`, and stops there — no worker, no
//     binding, no capacity lease;
//   - the pending question is one view-derived attention row (`resume_decision_required`) and
//     one wake class, settling when the act it names lands;
//   - the answer is an existing verb: swarm.guide parks with reason `awaiting_resume_decision`
//     and starts the seat (recording `swarm.resume_decision_answered`), swarm.stop settles the
//     seat without any work;
//   - a resume run by a non-member (the root recovering a sub-orchestrator's seat) re-joins the
//     successor under the predecessor's nearest living ancestor, so the question pages the level
//     of the tree that recruited the seat;
//   - the posture is a policy field, `resumeContinuation: 'manual' | 'auto'`, default 'manual';
//     under 'auto' a resume-from recruit behaves exactly as it did before this contract.
//
// Rows (every row is RED at the base commit 8ff5bf09, for the reason each assertion names):
//   525-a  the closed sets carry the contract: the two runtime-recorded swarm kinds, the
//          wake class keyed on the request row, the policy field. RED: none exist.
//   525-b  the recruit joins the successor and records the request, and spawns no worker.
//          RED: the worker spawns in the same command today and no request row exists.
//   525-c  the attention projection carries resume_decision_required with both settling acts.
//          RED: no such row kind.
//   525-d  the guide answers: parked with reason awaiting_resume_decision, the answered row
//          names the guide's seq, the seat starts, the deferred carry lands, the answer
//          composes into the first brief. RED: the successor is bound at recruit today, so the
//          guide is an ordinary delivery and no answered row exists.
//   525-e  swarm.stop settles a pending successor with no worker ever spawned and no answered
//          row, the attention row settles, and the stopped successor stays a resumable
//          predecessor (#452). RED: the successor is bound at recruit today.
//   525-f  a root-run resume of a sub-orchestrator's stopped seat re-joins the successor under
//          the sub-orchestrator, whose scoped attention projection carries the question naming
//          it responsible. RED: the join writes parentId null for a non-member recruiter today.
//   525-g  `swarm.create --policy '{"resumeContinuation":"auto"}'` is admitted and a resume-from
//          under it binds in the same command, recording no question. RED: the policy field is
//          refused by the closed set today.
//
// SUITE LAW: temp dirs, a scripted coordinator, real git repositories, no provider process, no
// network. git stash is never used. Each red row fails a plausible WRONG implementation — the
// base commit is one: it binds and starts the successor inside the recruit.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SWARM_EVENT_KINDS, SWARM_POLICY_FIELDS } from '../src/swarm-state.mjs';
import { SWARM_EVENT_KINDS as SWARM_SUBMITTABLE_KINDS } from '../src/swarm-contract.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { WAKE_CLASS_TABLE } from '../src/wake-stream.mjs';
import { allocatePhysicalWorkspaceOwner, createFromBase } from '../src/worktree.mjs';

const SWARM_ID = 'recovery';
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const workerPrincipal = (workerId) => ({
  actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId,
});
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// The deployment identity a physical workspace owner receipt is issued under (#428's shape) —
// the same fixture law issue452-resume-from-stopped.test.mjs follows.
const deployment = {
  deploymentId: createHash('sha256').update('issue525-deployment').digest('hex'),
  controllerId: createHash('sha256').update('issue525-controller').digest('hex'),
  pid: process.pid, pidStart: 'issue525-instance',
};

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue525-'));
  const repo = join(directory, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 525', GIT_COMMITTER_NAME: 'Issue 525' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue525@example.invalid', GIT_COMMITTER_EMAIL: 'issue525@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = new CoordinationStore(join(directory, 'coordination'));
  const workers = [];
  // The host authority's own witness (#297): what this seat's path acquired, and what it handed
  // back. A decision-pending seat must hold NO lease (docs/52 D7).
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
  const checkouts = new Map(); // workerId → { workspaceId, worktree, sessionContext }
  const guides = []; // the coordinator lane calls a guide actually rode
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    guideParticipant: async (workerId, message, options = {}) => {
      guides.push({ workerId, message, priority: options.priority ?? null });
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
        status: 'working', paused: false, terminalCause: null, sessionContext, worktree });
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
      ...(['view', 'watch', 'list'].includes(command) ? {} : { idempotencyKey: `recovery-${++key}` }),
      ...args }, caller);
  const eventsOf = (kind, participantId) => store.eventsView()
    .filter((event) => (event.kind === 'driver.recorded' ? event.payload?.kind : event.kind) === kind
      && (participantId === undefined || event.payload?.participantId === participantId));
  return {
    store, runtime, repo, baseSha, workers, guides, capacity, call, eventsOf,
    checkoutOf: (participantId) => {
      const row = store.swarm(SWARM_ID).participants[participantId];
      return [...checkouts.values()].find((entry) => entry.workspaceId === row.workspaceId) ?? null;
    },
    workerOf: (participantId) => {
      const row = store.swarm(SWARM_ID)?.participants?.[participantId] ?? null;
      return row === null ? null : workers.find((entry) => entry.runId === row.runId) ?? null;
    },
    seat: (participantId) => store.swarm(SWARM_ID)?.participants?.[participantId] ?? null,
    recruit: (participantId, options = {}, caller = owner) => call('recruit', {
      participantId, objective: options.objective ?? `Continue the lane as ${participantId}`,
      ...(options.resumeFrom === undefined ? {} : { resumeFrom: options.resumeFrom }),
      ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    }, caller),
  };
}

/** One seat interrupted mid-lane: recruited, one changed path in its checkout, settled by the
 * root's own stop — the recovery shape #525 names (the resume seam is the same for a stopped,
 * a fault-settled and a runtime-lost predecessor; issue452's fixture proves the seam here). */
async function interruptedSeat(t) {
  const f = fixture(t);
  await f.call('create', { purpose: 'A recovered seat asks whether to continue' });
  await f.recruit('alpha');
  const checkout = f.checkoutOf('alpha');
  assert.ok(checkout !== null, 'alpha works in a checkout the row names');
  writeFileSync(join(checkout.worktree, 'alpha-work.txt'), 'alpha work\n');
  await f.call('stop', { participantId: 'alpha', reason: 'Interrupted mid-lane' });
  assert.equal(f.seat('alpha').status, 'left');
  assert.equal(f.seat('alpha').leftReason, 'stopped');
  return { f, checkout };
}

// ─────────────────────────────────────────────────────────────────────────────
// 525-a: the closed sets carry the contract
// ─────────────────────────────────────────────────────────────────────────────

test('525-a RED at base: the resume-decision contract joins the closed sets — two runtime-recorded kinds, one wake class, one policy field', () => {
  assert.ok(SWARM_EVENT_KINDS.has('swarm.resume_decision_requested'),
    'the recovery question is a runtime-recorded swarm kind (docs/52 D1)');
  assert.ok(SWARM_EVENT_KINDS.has('swarm.resume_decision_answered'),
    'the answer is a runtime-recorded swarm kind (docs/52 D3)');
  assert.ok(!SWARM_SUBMITTABLE_KINDS.includes('swarm.resume_decision_requested')
    && !SWARM_SUBMITTABLE_KINDS.includes('swarm.resume_decision_answered'),
  'neither kind is caller-submittable through swarm.update — a fabricated question would page an orchestrator nobody asked');

  const wake = WAKE_CLASS_TABLE.find((row) => row.wakeClass === 'resume_decision_required');
  assert.ok(wake, 'the one wake table carries the class (docs/52 D2)');
  assert.equal(wake.scope, 'swarm');
  assert.equal(wake.terminal, true, 'the question is the act the consumer answers');
  assert.equal(wake.next, 'baton swarm guide {swarmId} {participantId}');
  assert.ok(wake.rows.some((matcher) => matcher.kind === 'swarm.resume_decision_requested'),
    'the class derives from the request row and nothing else');

  assert.ok(SWARM_POLICY_FIELDS.includes('resumeContinuation'),
    'the posture is a policy field beside the #443 pair (docs/52 D5)');
});

// ─────────────────────────────────────────────────────────────────────────────
// 525-b: the recruit records the recovery and the question, and stops before the work
// ─────────────────────────────────────────────────────────────────────────────

test('525-b RED at base: a resume-from recruit joins the successor and records the decision request, and spawns no worker before the answer', async (t) => {
  const { f } = await interruptedSeat(t);
  const receipt = await f.recruit('bravo', { resumeFrom: 'alpha' });

  const bravo = f.seat('bravo');
  assert.ok(bravo !== null, 'the successor joins');
  assert.equal(bravo.status, 'active');
  assert.equal(bravo.resumeFrom, 'alpha');

  assert.equal(f.workerOf('bravo'), null,
    'recovering the workspace admits no worker before the orchestrator answers (docs/52 D1)');
  assert.equal(f.eventsOf('swarm.participant_bound', 'bravo').length, 0,
    'no binding is recorded before the answer');

  const requests = f.eventsOf('swarm.resume_decision_requested', 'bravo');
  assert.equal(requests.length, 1, 'the recruit records exactly one resume_decision_requested row');
  assert.equal(requests[0].payload.predecessor, 'alpha');
  assert.equal(requests[0].payload.carry?.how, 'bound',
    'the request names the carry plan — the retained checkout waits for the answer');
  assert.equal(requests[0].payload.carry?.workspaceId, f.seat('alpha').workspaceId);
  assert.deepEqual(receipt.next, {
    continue: { command: 'swarm.guide', args: { swarmId: SWARM_ID, participantId: 'bravo' } },
    stop: { command: 'swarm.stop', args: { swarmId: SWARM_ID, participantId: 'bravo' } },
  }, 'the recruit receipt names BOTH acts that settle the question (docs/52 D1/D2)');
});

// ─────────────────────────────────────────────────────────────────────────────
// 525-c: the question is one attention row naming both settling acts
// ─────────────────────────────────────────────────────────────────────────────

test('525-c RED at base: the attention projection carries resume_decision_required naming the guide and stop acts that settle it', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.recruit('bravo', { resumeFrom: 'alpha' });

  const view = await f.call('view');
  const row = (view.attention ?? []).find((entry) => entry.kind === 'resume_decision_required'
    && entry.participantId === 'bravo');
  assert.ok(row, 'a pending recovery pages as resume_decision_required (docs/52 D2)');
  assert.equal(row.predecessor, 'alpha');
  assert.equal(row.next?.continue?.command, 'swarm.guide', 'the continue act is a guide');
  assert.equal(row.next?.continue?.participantId, 'bravo');
  assert.equal(row.next?.stop?.command, 'swarm.stop', 'the do-not-continue act is a stop');
  assert.equal(row.next?.stop?.participantId, 'bravo');
  assert.equal(row.responsibleParticipant, null,
    'a root-recruited successor has no seat above it');
  assert.equal(row.responsibleActor, 'owner', 'so the row names the swarm\'s creator');
});

// ─────────────────────────────────────────────────────────────────────────────
// 525-d: the guide answers the question and starts the seat
// ─────────────────────────────────────────────────────────────────────────────

test('525-d RED at base: the orchestrator\'s guide answers the decision — parked, recorded, and the seat starts with the answer in its first brief', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.recruit('bravo', { resumeFrom: 'alpha' });

  const answer = await f.call('guide', {
    participantId: 'bravo', message: 'Continue — the lane still stands.',
  });
  assert.equal(answer.guide?.delivery?.state, 'parked',
    'a decision-pending seat has no worker, so the answer parks (docs/52 D3)');
  assert.equal(answer.guide?.delivery?.reason, 'awaiting_resume_decision');

  const answered = f.eventsOf('swarm.resume_decision_answered', 'bravo');
  assert.equal(answered.length, 1, 'the answer is recorded exactly once');
  assert.equal(answered[0].payload.predecessor, 'alpha');
  assert.equal(answered[0].payload.guidance?.seq, answer.guide?.seq,
    'the answered row names the guide that settled the question');

  const worker = f.workerOf('bravo');
  assert.notEqual(worker, null, 'the continue answer performs the deferred start');
  assert.equal(f.eventsOf('swarm.participant_bound', 'bravo').length, 1);
  const carried = f.eventsOf('workspace.carried_from', 'bravo');
  assert.equal(carried.length, 1, 'the carry lands when the seat starts, not before');
  assert.equal(carried[0].payload.workspaceId, f.seat('alpha').workspaceId);

  const view = await f.call('view', { participantId: 'bravo' }, workerPrincipal(worker.id));
  const row = view.participants.find((entry) => entry.participantId === 'bravo');
  assert.match(row.brief ?? '', /## Recovery from alpha/,
    'the first brief names the recovery (docs/52 D6)');
  assert.ok((row.brief ?? '').includes('Continue — the lane still stands.'),
    'the answer composes into the first brief through the #337 park seam');
  const delivered = f.eventsOf('swarm.guidance_delivered')
    .filter((event) => event.payload?.messageId === answer.guide?.messageId);
  assert.equal(delivered.length, 1, 'the parked answer is marked delivered exactly once');

  const after = await f.call('view');
  assert.ok(!(after.attention ?? []).some((entry) => entry.kind === 'resume_decision_required'
    && entry.participantId === 'bravo'), 'the answer settles the attention row');
});

// ─────────────────────────────────────────────────────────────────────────────
// 525-e: don't continue — the stop settles the pending seat
// ─────────────────────────────────────────────────────────────────────────────

test('525-e RED at base: swarm.stop settles a decision-pending successor without a worker ever spawning, and the successor stays resumable', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.recruit('bravo', { resumeFrom: 'alpha' });
  await f.call('stop', { participantId: 'bravo', reason: 'Priorities moved while the seat was down' });

  assert.equal(f.workerOf('bravo'), null,
    'a decision-pending seat has no worker to drain (docs/52 D3 — the #353 path settles it)');
  assert.equal(f.eventsOf('swarm.resume_decision_answered', 'bravo').length, 0,
    'a stop is not an answer');
  const bravo = f.seat('bravo');
  assert.equal(bravo.status, 'left');
  assert.equal(bravo.leftReason, 'stopped');

  const view = await f.call('view');
  assert.ok(!(view.attention ?? []).some((entry) => entry.kind === 'resume_decision_required'
    && entry.participantId === 'bravo'), 'the stop settles the attention row');

  // The stopped successor is itself a resumable predecessor (#452): the work it carried waits
  // for a later recovery to ask the same question.
  await f.recruit('charlie', { resumeFrom: 'bravo' });
  assert.equal(f.seat('charlie').resumeFrom, 'bravo');
  assert.equal(f.workerOf('charlie'), null, 'charlie pends for the same question in turn');
  assert.equal(f.eventsOf('swarm.resume_decision_requested', 'charlie').length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 525-f: the question pages the sub-orchestrator that recruited the seat
// ─────────────────────────────────────────────────────────────────────────────

test('525-f RED at base: a root-run resume re-joins the predecessor\'s subtree, and the sub-orchestrator\'s scoped attention carries the question', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'A recovery decision finds the level that recruited the seat' });
  await f.recruit('sub', { permissions: ['read', 'communicate', 'contribute', 'recruit'] });
  const subWorker = f.workerOf('sub');
  assert.ok(subWorker !== null);
  await f.recruit('alpha', {}, workerPrincipal(subWorker.id));
  assert.equal(f.seat('alpha').parentId, 'sub', 'the sub-orchestrator leads its recruit');
  const checkout = f.checkoutOf('alpha');
  writeFileSync(join(checkout.worktree, 'alpha-work.txt'), 'alpha work\n');
  await f.call('stop', { participantId: 'alpha', reason: 'Interrupted mid-lane' });

  // The ROOT recovers the seat (docs/48 §8: resume initiation is the root's act). The
  // continuation question belongs to the seat's own orchestrator all the same (docs/52 D4).
  await f.recruit('bravo', { resumeFrom: 'alpha' });
  assert.equal(f.seat('bravo').parentId, 'sub',
    'a resume by a non-member re-joins the successor under the predecessor\'s nearest living ancestor');

  const subView = await f.call('view', { participantId: 'sub' }, workerPrincipal(subWorker.id));
  const row = (subView.attention ?? []).find((entry) => entry.kind === 'resume_decision_required'
    && entry.participantId === 'bravo');
  assert.ok(row, 'the sub-orchestrator\'s own scoped view carries the question');
  assert.equal(row.responsibleParticipant, 'sub',
    'the row names the sub-orchestrator as the party that answers');
});

// ─────────────────────────────────────────────────────────────────────────────
// 525-g: the policy opt-out keeps the one-command resume
// ─────────────────────────────────────────────────────────────────────────────

test('525-g RED at base: a swarm may declare resumeContinuation auto and keep the one-command resume', async (t) => {
  const f = fixture(t);
  await f.call('create', {
    purpose: 'Recoveries continue on their own here',
    policy: { resumeContinuation: 'auto' },
  });
  await f.recruit('alpha');
  const checkout = f.checkoutOf('alpha');
  writeFileSync(join(checkout.worktree, 'alpha-work.txt'), 'alpha work\n');
  await f.call('stop', { participantId: 'alpha', reason: 'Interrupted mid-lane' });

  await f.recruit('bravo', { resumeFrom: 'alpha' });
  assert.notEqual(f.workerOf('bravo'), null,
    'under resumeContinuation auto the successor binds in the same command (docs/52 D5)');
  assert.equal(f.eventsOf('swarm.participant_bound', 'bravo').length, 1);
  assert.equal(f.eventsOf('swarm.resume_decision_requested', 'bravo').length, 0,
    'no question is recorded under auto');
});

// ─────────────────────────────────────────────────────────────────────────────
// 525-h: the host lease moves from the recruit to the answer
// ─────────────────────────────────────────────────────────────────────────────

test('525-h: a decision-pending seat holds no host lease, and the answer takes the one the recruit would have', async (t) => {
  const { f } = await interruptedSeat(t);
  await f.recruit('bravo', { resumeFrom: 'alpha' });
  assert.deepEqual(f.capacity.acquired.filter((row) => row.holder.endsWith(':bravo')), [],
    'a seat whose answer never comes never held a lease (docs/52 D7)');

  await f.call('guide', { participantId: 'bravo', message: 'Continue — capacity is yours.' });
  const taken = f.capacity.acquired.filter((row) => row.holder.endsWith(':bravo'));
  assert.equal(taken.length, 1, 'the answer takes the host slot today\'s recruit would have taken');
  assert.equal(taken[0].kind, 'worker');
  assert.equal(taken[0].holder, `participant:${SWARM_ID}:bravo`);
  assert.notEqual(f.workerOf('bravo'), null, 'and the seat is bound behind it');
});
