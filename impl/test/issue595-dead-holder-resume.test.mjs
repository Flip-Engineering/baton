// Issue #595 — a seat whose runtime was lost keeps holding its workspace, and a successor cannot
// resume from it.
//
// OBSERVED (resident at d343fc54, 2026-09-25 17:32Z): after a host crash, wake-astra592b's worker
// w-64 was restored as a dead handle whose cleanup never finalized. `holdsWorkspace` counts such a
// handle as a holder, and `_predecessorWorkspace` treated every holder other than the
// predecessor's own worker as a live foreign holder, so `swarm recruit --resume-from
// wake-astra592c` refused `predecessor_workspace_held` with holders [w-64], even after
// wake-astra592b was stopped.
//
// The rule this file pins: a foreign holder blocks a resume unless it is processless (its process is
// proven closed and no cleanup of the checkout is running). A processless holder has no process
// that could write the checkout, so the successor binds to it and the holder's hold is released
// durably to the successor (worktree.holder_released, reason custody_transferred).
//
// Rows:
//   (a) a foreign holder whose worker is dead does not block: the successor binds to the checkout;
//   (b) a foreign holder whose worker is working still refuses predecessor_workspace_held;
//   (c) binding the successor hands the processless holder's hold over to it;
//   (d) the release touches only processless holders of the named checkout;
//   (e) a terminal holder whose cleanup is still running, or whose process is not proven closed,
//       still refuses: the checkout may be under removal, or a survivor may be writing it.
//
// Fixture: the #452 fixture (real SwarmRuntime, real CoordinationStore, real owned checkouts), with
// the controller reporting one extra holder for the predecessor's workspace.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { releaseDeadWorkspaceHolds } from '../src/runtime-api.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { allocatePhysicalWorkspaceOwner, createFromBase } from '../src/worktree.mjs';

const SWARM_ID = 'dead-holder';
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const workerPrincipal = (workerId) => ({
  actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId,
});
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// The deployment identity a physical workspace owner receipt is issued under (#428's shape): the
// authority requires one, and this fixture is the controller of its own repository.
const deployment = {
  deploymentId: createHash('sha256').update('issue595-deployment').digest('hex'),
  controllerId: createHash('sha256').update('issue595-controller').digest('hex'),
  pid: process.pid, pidStart: 'issue595-instance',
};

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue595-'));
  const repo = join(directory, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Issue 595']);
  git(repo, ['config', 'user.email', 'issue595@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = new CoordinationStore(join(directory, 'coordination'));
  const workers = [];
  const checkouts = new Map(); // workerId → { workspaceId, worktree, sessionContext }
  // Holders the controller reports for a workspace beside the seats' own workers: the dead or live
  // worker of another seat that still names the checkout (#595).
  const foreignHolders = new Map(); // workspaceId → workerId[]
  const standings = new Map(); // workerId → the controller's classification of that holder
  const releases = []; // the releaseDeadWorkspaceHolds calls the runtime made
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
    captureContribution: async (workerId, { contributionId }) =>
      ({ contributionId, workerId, sha: baseSha, ref: `refs/baton/checkpoints/${baseSha}` }),
    checkContribution: async () => ({ passed: true, sha: baseSha, attempt: { cleanup: { state: 'closed' } } }),
    workspaceAttachment: (workerId) => checkouts.get(workerId) ?? null,
    releaseDeadWorkspaceHolds: async (workspaceId, holderIds, successorWorkerId) => {
      releases.push({ workspaceId, holderIds: [...holderIds], successorWorkerId });
      return holderIds;
    },
    predecessorWorkspaceContext: (workspaceId) => {
      const row = [...checkouts.values()].find((entry) => entry.workspaceId === workspaceId);
      return row === undefined ? null
        : { sessionContext: row.sessionContext, holders: [...(foreignHolders.get(workspaceId) ?? [])],
          standing: Object.fromEntries((foreignHolders.get(workspaceId) ?? []).map((id) => [id, standings.get(id)])) };
    },
  };
  const runtime = new SwarmRuntime({
    store,
    coordinator,
    authorize: async () => {},
    prepareRun: async (request) => ({ ...request }),
    situationGit: { repoRoot: repo },
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      const carried = request.workspace ?? null;
      const carriedCheckout = carried?.workspaceId === undefined
        ? null : join(repo, '.baton', 'wt', carried.workspaceId);
      // A seat's checkout is allocated by the deployment's own worktree authority (a real owned
      // checkout with its lane branch and meta), or — when the recruit carries one — the
      // predecessor's checkout itself, which is what a successor bound to it works in.
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
    { swarmId: SWARM_ID, idempotencyKey: `stopped-${++key}`, ...args }, caller);
  return {
    store, runtime, repo, baseSha, workers, call, releases,
    addForeignHolder: (workspaceId, workerId, status, standing) => {
      standings.set(workerId, standing);
      workers.push({ id: workerId, taskId: `t-${workerId}`, runId: `run-${workerId}`, status,
        paused: false, terminalCause: null, sessionContext: { ownerTaskId: workspaceId }, worktree: null });
      foreignHolders.set(workspaceId, [...(foreignHolders.get(workspaceId) ?? []), workerId]);
    },
    checkoutOf: (participantId) => {
      const row = store.swarm(SWARM_ID).participants[participantId];
      return [...checkouts.values()].find((entry) => entry.workspaceId === row.workspaceId) ?? null;
    },
    workerOf: (participantId) => {
      const row = store.swarm(SWARM_ID)?.participants?.[participantId] ?? null;
      return row === null ? null : workers.find((entry) => entry.runId === row.runId) ?? null;
    },
    seat: (participantId) => store.swarm(SWARM_ID)?.participants?.[participantId] ?? null,
    carriedFrom: (participantId) => store.eventsView()
      .filter((event) => (event.kind === 'driver.recorded' ? event.payload?.kind : event.kind)
        === 'workspace.carried_from' && event.payload?.participantId === participantId),
    recruit: (participantId, resumeFrom) => call('recruit', {
      participantId, objective: `Continue the lane as ${participantId}`,
      ...(resumeFrom === undefined ? {} : { resumeFrom }),
    }),
    // #525: a resume-from recruit lands the recovery question; the guide is the orchestrator's
    // answer, and it is the act that starts the successor and performs its carry.
    answer: (participantId) => call('guide', {
      participantId, message: `Continue the lane as ${participantId}`,
    }),
    refusal: (participantId, resumeFrom) => call('recruit', {
      participantId, objective: `Continue the lane as ${participantId}`, resumeFrom,
    }).then(() => null, (error) => error),
  };
}

/** One stopped seat with a retained checkout, the shape a #595 resume starts from. */
async function stoppedSeat(t) {
  const f = fixture(t);
  await f.call('create', { purpose: "Resume a seat whose checkout another seat's worker names" });
  await f.recruit('alpha');
  const alpha = f.seat('alpha');
  const checkout = f.checkoutOf('alpha');
  assert.ok(checkout !== null, 'alpha works in a checkout the row names');
  assert.equal(alpha.workspaceId, checkout.workspaceId);
  // The work the lane produced and a successor is meant to continue: one changed path in the
  // checkout, which the #385 carry reports and the successor's brief names.
  writeFileSync(join(checkout.worktree, 'alpha-work.txt'), 'alpha work\n');
  await f.call('stop', { participantId: 'alpha', reason: 'Re-route this lane by hand' });
  return { f, checkout };
}


test('595-a: a foreign holder whose worker is dead does not block the resume, and the successor binds to the checkout', async (t) => {
  const { f, checkout } = await stoppedSeat(t);
  f.addForeignHolder(checkout.workspaceId, 'w-dead-holder', 'dead', 'processless');

  await f.recruit('bravo', 'alpha');
  await f.answer('bravo');

  const bravo = f.seat('bravo');
  assert.equal(bravo.resumeFrom, 'alpha');
  assert.equal(bravo.workspaceId, checkout.workspaceId,
    'the successor binds to the checkout a dead worker still named');
  assert.equal(f.carriedFrom('bravo').length, 1, 'the carry is recorded');
});

test('595-b: a foreign holder whose worker is working still refuses predecessor_workspace_held', async (t) => {
  const { f, checkout } = await stoppedSeat(t);
  f.addForeignHolder(checkout.workspaceId, 'w-live-holder', 'working', 'live');

  const refused = await f.recruit('bravo', 'alpha')
    .then(() => f.answer('bravo'))
    .then(() => null, (error) => error);
  assert.ok(refused !== null, 'a live foreign holder refuses the resume');
  assert.equal(refused.code, 'swarm_workspace_unavailable');
  assert.equal(refused.detail?.reason, 'predecessor_workspace_held');
  assert.deepEqual(refused.detail?.holders, ['w-live-holder']);
});

test('595-c: binding the successor hands the dead holder\'s hold over to it', async (t) => {
  const { f, checkout } = await stoppedSeat(t);
  f.addForeignHolder(checkout.workspaceId, 'w-dead-holder', 'dead', 'processless');

  await f.recruit('bravo', 'alpha');
  await f.answer('bravo');

  const successor = f.workerOf('bravo');
  assert.ok(successor !== null, 'the successor has a worker');
  assert.deepEqual(f.releases, [{
    workspaceId: checkout.workspaceId, holderIds: ['w-dead-holder'], successorWorkerId: successor.id,
  }], 'the dead holder is released to the successor, once');
});

test('595-d: releaseDeadWorkspaceHolds releases only processless holders of the named checkout', async () => {
  const workspaceId = `ws-${'a'.repeat(32)}`;
  const otherWorkspace = `ws-${'b'.repeat(32)}`;
  const handle = (id, status, ownerTaskId, extra = {}) => ({
    id, status, sessionContext: { ownerTaskId }, worktree: `/tmp/${ownerTaskId}`,
    ownedWorktreeAuthority: true, workspaceCleanupDeferred: null, physicalWorkspaceCleanupCompleted: false,
    processRef: { state: 'closed' }, ...extra,
  });
  const workers = new Map([
    ['w-dead', handle('w-dead', 'dead', workspaceId)],
    ['w-live', handle('w-live', 'working', workspaceId, { processRef: { state: 'ready' } })],
    ['w-cleaning', handle('w-cleaning', 'dead', workspaceId, { cleanupPromise: Promise.resolve() })],
    ['w-unproven', handle('w-unproven', 'dead', workspaceId, { processRef: { state: 'unconfirmed_after_restart' } })],
    ['w-elsewhere', handle('w-elsewhere', 'dead', otherWorkspace)],
  ]);
  const releasedWith = [];
  const coordinator = {
    _workers: workers,
    _releaseProcesslessHold: (h, successorWorkerId) => { releasedWith.push({ id: h.id, successorWorkerId }); },
  };
  const released = await releaseDeadWorkspaceHolds(coordinator, workspaceId,
    ['w-dead', 'w-live', 'w-cleaning', 'w-unproven', 'w-elsewhere', 'w-unknown'], 'w-successor');
  assert.deepEqual([...released], ['w-dead'], 'only the processless holder of this checkout is released');
  assert.deepEqual(releasedWith, [{ id: 'w-dead', successorWorkerId: 'w-successor' }],
    'it is released as a custody transfer naming the successor');
});

for (const [standing, why] of [['cleanup_in_flight', 'its cleanup may be removing the checkout'],
  ['unresolved', 'its process is not proven closed']]) {
  test(`595-e: a terminal holder whose standing is ${standing} still refuses (${why})`, async (t) => {
    const { f, checkout } = await stoppedSeat(t);
    f.addForeignHolder(checkout.workspaceId, 'w-terminal-holder', 'dead', standing);
    const refused = await f.recruit('bravo', 'alpha')
      .then(() => f.answer('bravo'))
      .then(() => null, (error) => error);
    assert.ok(refused !== null, 'the resume refuses');
    assert.equal(refused.detail?.reason, 'predecessor_workspace_held');
    assert.deepEqual(refused.detail?.holders, ['w-terminal-holder']);
  });
}
