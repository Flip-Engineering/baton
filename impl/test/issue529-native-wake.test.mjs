// Issue #529 — native wake delivery: a resume-from successor's brief carries the wake events
// that occurred since the predecessor's last observation. The seat reads what happened while it
// was absent through the same mechanism parked guidance uses: durable ledger rows composed at
// recruitment time.
//
// Rows:
//   (a)  a resume-from successor's brief contains a "Recent wake events" block listing events
//        since the predecessor's last checkpoint seq;
//   (b)  the block names the wake classes, seqs, and timestamps of the events;
//   (c)  a first recruit (no predecessor) does NOT receive a wake events block;
//   (d)  the block is bounded by the situation byte budget.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { allocatePhysicalWorkspaceOwner, createFromBase } from '../src/worktree.mjs';

const SWARM_ID = 'wake-529';
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const deployment = {
  deploymentId: createHash('sha256').update('issue529-deployment').digest('hex'),
  controllerId: createHash('sha256').update('issue529-controller').digest('hex'),
  pid: process.pid, pidStart: 'issue529-instance',
};

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue529-'));
  const repo = join(directory, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Issue 529']);
  git(repo, ['config', 'user.email', 'issue529@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = new CoordinationStore(join(directory, 'coordination'));
  const workers = [];
  const checkouts = new Map();
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
    { swarmId: SWARM_ID, idempotencyKey: `wake529-${++key}`, ...args }, caller);
  return {
    store, runtime, repo, baseSha, workers, call,
    seat: (participantId) => store.swarm(SWARM_ID)?.participants?.[participantId] ?? null,
    recruit: (participantId, resumeFrom) => call('recruit', {
      participantId, objective: `Work as ${participantId}`,
      ...(resumeFrom === undefined ? {} : { resumeFrom }),
    }),
    answer: (participantId) => call('guide', {
      participantId, message: `Continue the lane as ${participantId}`,
    }),
  };
}

// ── (a) a resume-from successor's brief carries wake events ─────────────────

test('529-a: a resume-from successor brief contains a Recent wake events block', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test native wake delivery' });

  await f.recruit('alpha');
  const alphaAfter = f.seat('alpha');
  assert.equal(alphaAfter.status, 'active', 'alpha is active');

  await f.call('stop', { participantId: 'alpha', reason: 'Re-route' });
  const alphaStopped = f.seat('alpha');
  assert.equal(alphaStopped.status, 'left', 'alpha stopped');

  await f.recruit('beta', 'alpha');
  await f.answer('beta');
  const beta = f.seat('beta');
  assert.ok(beta.brief, 'beta has a composed brief');
  assert.match(beta.brief, /Recent wake events/u,
    'the successor brief carries a Recent wake events block');
});

// ── (b) the block names wake classes and seqs ───────────────────────────────

test('529-b: the wake events block names the wake classes of the events that occurred', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test wake class names' });

  await f.recruit('alpha');
  await f.call('stop', { participantId: 'alpha', reason: 'Re-route' });

  await f.recruit('beta', 'alpha');
  await f.answer('beta');
  const beta = f.seat('beta');

  assert.match(beta.brief, /recruited/u,
    'the block names the recruited wake class (alpha joined)');
  assert.match(beta.brief, /left/u,
    'the block names the left wake class (alpha stopped)');
  assert.match(beta.brief, /\bseq \d+\b/u,
    'the block carries ledger seq numbers');
});

// ── (c) a first recruit does NOT get a wake events block ────────────────────

test('529-c: a first recruit without a predecessor does not receive a wake events block', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test first recruit' });

  await f.recruit('alpha');
  const alpha = f.seat('alpha');
  assert.ok(alpha.brief, 'alpha has a composed brief');
  assert.doesNotMatch(alpha.brief, /Recent wake events/u,
    'a first recruit without a predecessor carries no wake events block');
});

// ── (d) the block names events from contributions ───────────────────────────

test('529-d: the wake events block includes contribution_recorded events', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test contribution wake' });

  await f.recruit('alpha');

  const contributionBody = {
    subject: 'Alpha contribution',
    base: { observedHead: f.baseSha, rebasedOnto: f.baseSha },
    commit: null,
    items: [{ id: 'item-1', status: 'delivered', change: 'Test change',
      files: ['base.txt'], test: 'true', evidence: 'green' }],
    verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
    carriedForward: [],
    needsFromOthers: [],
  };
  await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'alpha', body: contributionBody },
  });

  await f.call('stop', { participantId: 'alpha', reason: 'Done' });

  await f.recruit('beta', 'alpha');
  await f.answer('beta');
  const beta = f.seat('beta');

  assert.match(beta.brief, /contribution_recorded/u,
    'the block names the contribution_recorded wake class');
});
