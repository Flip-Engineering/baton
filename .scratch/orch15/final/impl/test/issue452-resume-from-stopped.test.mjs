// Issue #452 — a seat the ROOT stopped is a resumable predecessor while its workspace is still
// carriable.
//
// OBSERVED (primary at 1a830bfe, 2026-09-18 09:41Z): the root stopped `claude-385` after reviewing
// its contribution (`status: left`, its #428-retained checkout still on disk and still named on its
// row), and the manual re-route #443 exists for was refused:
//   baton swarm recruit … --resume-from claude-385
//   → swarm_recruit_predecessor_unavailable: Swarm recruit predecessor is not an active participant
// The detail carried {participantId, status} and named no remedy. `_inheritancePredecessor` admitted
// `active` and, since #442, `left` + `provider_fault`; every other settled status refused — so the
// #385 carry (bind the retained checkout when no live holder has it, else carry the change set of
// the snapshot) could only ever continue a seat a PROVIDER killed, never one the root stopped by
// hand to re-route it.
//
// The law this file pins (#452):
//   a settled predecessor is resumable while its workspace is still carriable — the retained
//   checkout on disk, or the snapshot commit its stop left on the lane branch. A settled seat with
//   neither has nothing to continue and refuses, naming its actual {status, leftReason, workspace}
//   and the closed set of resumable predecessor states (#376: never a bare "not active").
//
// Rows:
//   (a)  a root-stopped seat (left/stopped) whose checkout is still on disk is resumed: the
//        successor binds to that same workspace and `workspace.carried_from` records the bind;
//   (a2) the same seat once its checkout is cleaned but its stop left a snapshot commit is resumed
//        just the same — the snapshot's change set lands in the successor's fresh checkout;
//   (b)  the same seat with a cleaned checkout and no snapshot refuses, and the refusal detail
//        names the workspace state it observed;
//   (c)  a seat the root settled as completed (#350 × #332) is resumable the same way;
//   (d)  the refusal detail carries the closed set of resumable predecessor states.
//
// Fixture: the real SwarmRuntime over the real CoordinationStore and a real Git repository, with
// every seat's checkout allocated by the deployment's OWN worktree authority
// (`allocatePhysicalWorkspaceOwner` + `createFromBase`) — a real owned checkout with its meta and
// lane branch at `<repo>/.baton/wt/<workspaceId>` — and a root `swarm.stop` settling membership
// through the real #350 path. The checkout therefore survives exactly as #428's retained one does
// when a stop cannot reap it, and `workspaceChangedPaths` reads real work out of a real checkout.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SWARM_RESUMABLE_PREDECESSOR_STATES, SwarmRuntime } from '../src/swarm-runtime.mjs';
import { allocatePhysicalWorkspaceOwner, createFromBase } from '../src/worktree.mjs';

const SWARM_ID = 'stopped';
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const workerPrincipal = (workerId) => ({
  actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId,
});
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// The deployment identity a physical workspace owner receipt is issued under (#428's shape): the
// authority requires one, and this fixture is the controller of its own repository.
const deployment = {
  deploymentId: createHash('sha256').update('issue452-deployment').digest('hex'),
  controllerId: createHash('sha256').update('issue452-controller').digest('hex'),
  pid: process.pid, pidStart: 'issue452-instance',
};

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue452-'));
  const repo = join(directory, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Issue 452']);
  git(repo, ['config', 'user.email', 'issue452@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = new CoordinationStore(join(directory, 'coordination'));
  const workers = [];
  const checkouts = new Map(); // workerId → { workspaceId, worktree, sessionContext }
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
    captureContribution: async (workerId, { contributionId }) =>
      ({ contributionId, workerId, sha: baseSha, ref: `refs/baton/checkpoints/${baseSha}` }),
    checkContribution: async () => ({ passed: true, sha: baseSha, attempt: { cleanup: { state: 'closed' } } }),
    workspaceAttachment: (workerId) => checkouts.get(workerId) ?? null,
    predecessorWorkspaceContext: (workspaceId) => {
      const row = [...checkouts.values()].find((entry) => entry.workspaceId === workspaceId);
      return row === undefined ? null : { sessionContext: row.sessionContext, holders: [] };
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
    store, runtime, repo, baseSha, workers, call,
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

/** The world rows (a), (a2), (b) and (c) start from: one seat, a real checkout, and the root's own
 * real `swarm.stop` — the shape #452 reports: membership settles (#350) and the checkout survives
 * (a stop whose custody boundary retains it, the state #428 leaves on disk). */
async function stoppedSeat(t) {
  const f = fixture(t);
  await f.call('create', { purpose: 'Resume a seat the root stopped' });
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

const SNAPSHOT_ROW = (workspaceId, sha) => ({
  workspaceId, participantId: 'alpha', sha, branch: `baton/${workspaceId}`, reason: 'stop',
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) A root-stopped seat with a retained checkout is resumed, and the carry
//     records the BIND.
// ─────────────────────────────────────────────────────────────────────────────

test('452-a: a root-stopped seat whose checkout is retained is a resumable predecessor, and the successor binds to that same checkout', async (t) => {
  const { f, checkout } = await stoppedSeat(t);
  const alpha = f.seat('alpha');
  assert.equal(alpha.status, 'left', 'the stop settles the membership row (#350)');
  assert.equal(alpha.leftReason, 'stopped', 'a seat the root stopped settles as stopped');
  assert.ok(existsSync(checkout.worktree), 'the #428-retained checkout is still on disk and still named on the row');

  await f.recruit('bravo', 'alpha');
  await f.answer('bravo');

  const bravo = f.seat('bravo');
  assert.equal(bravo.resumeFrom, 'alpha');
  assert.equal(bravo.workspaceId, checkout.workspaceId,
    'the successor is bound to the predecessor\'s retained checkout');
  const carried = f.carriedFrom('bravo');
  assert.equal(carried.length, 1, 'one workspace.carried_from row records the carry');
  assert.equal(carried[0].payload.predecessor, 'alpha');
  assert.equal(carried[0].payload.workspaceId, checkout.workspaceId, 'the carry names the bound checkout');
  assert.deepEqual([...carried[0].payload.paths], ['alpha-work.txt'],
    'the retained checkout\'s change set is what the successor carries');
  assert.equal(carried[0].payload.snapshotSha, null, 'a retained checkout carries no snapshot');
  assert.match(bravo.brief, /Carried workspace/, 'the successor\'s brief names the carried workspace');
});

// ─────────────────────────────────────────────────────────────────────────────
// (a2) The same seat once its checkout is cleaned: the stop's snapshot on the
//      lane branch is the carry.
// ─────────────────────────────────────────────────────────────────────────────
test('452-a2: a root-stopped seat whose checkout is gone but whose lane branch holds the stop\'s snapshot is resumed from that snapshot', async (t) => {
  const { f, checkout } = await stoppedSeat(t);
  // The seat's work reaches its lane branch, the stop records the snapshot, and the checkout is
  // cleaned — a stop whose removal could proceed, leaving the commit behind.
  writeFileSync(join(checkout.worktree, 'alpha-work.txt'), 'alpha work\n');
  git(checkout.worktree, ['add', '.']);
  git(checkout.worktree, ['commit', '-qm', 'alpha work']);
  const snapshotSha = git(checkout.worktree, ['rev-parse', 'HEAD']);
  f.store.recordDriver('worktree.snapshotted', SNAPSHOT_ROW(checkout.workspaceId, snapshotSha),
    { actor: 'baton-runtime', key: `snapshot:${checkout.workspaceId}` });
  rmSync(checkout.worktree, { recursive: true, force: true });
  assert.equal(existsSync(checkout.worktree), false, 'the checkout was cleaned');

  await f.recruit('charlie', 'alpha');
  await f.answer('charlie');

  const charlie = f.seat('charlie');
  assert.equal(charlie.resumeFrom, 'alpha');
  assert.notEqual(charlie.workspaceId, checkout.workspaceId, 'a cleaned checkout is not bound: the successor starts fresh');
  const carried = f.carriedFrom('charlie');
  assert.equal(carried.length, 1, 'one workspace.carried_from row records the carry');
  assert.equal(carried[0].payload.predecessor, 'alpha');
  assert.equal(carried[0].payload.snapshotSha, snapshotSha, 'the carry names the stop\'s snapshot');
  const fresh = f.checkoutOf('charlie');
  assert.ok(existsSync(join(fresh.worktree, 'alpha-work.txt')),
    'the snapshot\'s change set landed in the successor\'s fresh checkout');
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Cleaned checkout, no snapshot: the seat has nothing to continue and the
//     refusal says exactly that.
// ─────────────────────────────────────────────────────────────────────────────

test('452-b: a root-stopped seat with a cleaned checkout and no snapshot refuses, and the detail names the workspace state', async (t) => {
  const { f, checkout } = await stoppedSeat(t);
  rmSync(checkout.worktree, { recursive: true, force: true });
  assert.equal(existsSync(checkout.worktree), false, 'the checkout was cleaned');
  const snapshots = f.store.eventsView().filter((event) =>
    (event.kind === 'driver.recorded' ? event.payload?.kind : event.kind) === 'worktree.snapshotted'
    && event.payload?.workspaceId === checkout.workspaceId);
  assert.deepEqual(snapshots, [], 'and the lane branch holds no snapshot');

  const refusal = await f.refusal('bravo', 'alpha');
  assert.ok(refusal !== null, 'a settled seat with nothing to carry is refused');
  assert.equal(refusal.code, 'swarm_recruit_predecessor_unavailable');
  assert.equal(refusal.detail.participantId, 'alpha');
  assert.equal(refusal.detail.status, 'left', 'the detail names the predecessor\'s status');
  assert.equal(refusal.detail.leftReason, 'stopped', 'the detail names the reason the seat settled');
  assert.equal(refusal.detail.workspace, 'none', 'the detail names that no workspace is carriable');
  assert.equal(f.seat('bravo'), null, 'nothing was recorded: no seat joined on a refused recruit');
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) A seat the root settled as completed (#350 × #332) is resumable the
//     same way.
// ─────────────────────────────────────────────────────────────────────────────

test('452-c: a seat the root settled as completed is resumable the same way as one it stopped', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Resume a completed seat' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  // The seat records its final contribution (#332), so the stop that follows settles it as a
  // completion rather than a plain stop (#350).
  await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { contributionId: 'final', body: 'The lane is done.' },
  }, workerPrincipal(worker.id));
  const checkout = f.checkoutOf('builder');
  await f.call('stop', { participantId: 'builder', reason: 'The lane is done' });

  const settled = f.seat('builder');
  assert.equal(settled.status, 'left');
  assert.equal(settled.leftReason, 'completed', 'the contributed, cleanly exited seat settles as completed');
  assert.ok(existsSync(checkout.worktree), 'its checkout is still on disk');

  await f.recruit('builder-2', 'builder');
  await f.answer('builder-2');
  const successor = f.seat('builder-2');
  assert.equal(successor.workspaceId, checkout.workspaceId, 'the successor binds to the completed seat\'s checkout');
  const carried = f.carriedFrom('builder-2');
  assert.equal(carried.length, 1, 'the completed seat carries the same way a stopped one does');
  assert.equal(carried[0].payload.predecessor, 'builder');
  assert.equal(carried[0].payload.workspaceId, checkout.workspaceId);
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) The closed set of resumable states rides the refusal.
// ─────────────────────────────────────────────────────────────────────────────

test('452-d: the refusal names the closed set of resumable predecessor states', async (t) => {
  const { f, checkout } = await stoppedSeat(t);
  rmSync(checkout.worktree, { recursive: true, force: true });

  const refusal = await f.refusal('bravo', 'alpha');
  assert.equal(refusal.code, 'swarm_recruit_predecessor_unavailable');
  assert.ok(Array.isArray(refusal.detail.resumable), 'the detail carries the closed set');
  assert.deepEqual([...refusal.detail.resumable], [...SWARM_RESUMABLE_PREDECESSOR_STATES]);
  assert.ok(refusal.detail.resumable.includes('active'), 'a live seat is resumable');
  assert.ok(refusal.detail.resumable.includes('left:provider_fault'), '#442\'s fault-settled seat is resumable');
  assert.ok(refusal.detail.resumable.some((state) => state.includes('stopped')), 'a stopped seat is named');
  assert.ok(refusal.detail.resumable.some((state) => state.includes('completed')), 'a completed seat is named');
  for (const state of ['active', 'left:provider_fault', 'left:stopped', 'left:completed']) {
    assert.match(refusal.message, new RegExp(state.replace(':', ':')),
      `the message names ${state}`);
  }
  assert.match(refusal.message, /carriable workspace/, 'the message says what makes a settled seat resumable');

  // The state the set exists to keep out is still refused: a rolled-back membership (#308) is not
  // a predecessor a successor can continue.
  const rolledBack = await f.refusal('delta', 'ghost');
  assert.equal(rolledBack.code, 'swarm_recruit_predecessor_unavailable',
    'a predecessor the swarm does not hold refuses by name');
});
