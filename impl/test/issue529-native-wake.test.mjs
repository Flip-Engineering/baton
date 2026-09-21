// Issue #529 — native wake delivery: a seat's brief carries the wake events that occurred since
// its lineage's reference point (the predecessor's last observation, or the swarm's own creation
// seq for a first recruit). The seat reads what happened through the same mechanism parked
// guidance uses: durable ledger rows composed at recruitment time.
//
// Rows:
//   (a)  a resume-from successor's brief contains a "Recent wake events" block listing events
//        since the predecessor's last checkpoint seq;
//   (b)  the block names the wake classes, seqs, and timestamps of the events;
//   (c)  a first recruit of a swarm that has produced no wake events receives no block;
//   (d)  the block names events from contributions;
//   (e)  a first recruit INTO a swarm that has already produced events carries the block, diffed
//        against the swarm's creation seq, and never reads its own join;
//   (f)  the block carries this swarm's events only — a sibling swarm's seats never ride it;
//   (g)  a TERMINAL class's line names the command that acts on it (docs/54 §3.1).

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
// The wake block a brief carries, from its header to the next top-level section, so an assertion
// about the block never reads a sibling block of the same brief (the sibling-swarm block of the
// situation section names other swarms' seats too).
function wakeBlockOf(brief) {
  const start = `${brief}`.indexOf('Recent wake events');
  if (start < 0) return '';
  const rest = brief.slice(start);
  const end = rest.indexOf('\n## ');
  return end < 0 ? rest : rest.slice(0, end);
}
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
  // Every Run-start request the runtime hands the deployment, in order, so a row can read what the
  // seat's recruitment passed on (its brief, and the wake narrowing its session is configured with).
  const requests = [];
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
      requests.push(request);
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
    store, runtime, repo, baseSha, workers, requests, call,
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

// ── (c) a fresh swarm's first recruit gets no block ─────────────────────────

test('529-c: a first recruit of a swarm that produced no wake events carries no block', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test first recruit' });

  await f.recruit('alpha');
  const alpha = f.seat('alpha');
  assert.ok(alpha.brief, 'alpha has a composed brief');
  // The reference point IS the swarm's creation seq, so a seat recruited before anything else
  // happened in the swarm has nothing to read: the block is absent, never an empty one.
  assert.doesNotMatch(alpha.brief, /Recent wake events/u,
    'a first recruit of a swarm with no wake events carries no block');
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

// ── (e) a first recruit reads the history of the swarm it joins ─────────────

test('529-e: a first recruit into a swarm with wake events carries the block since its creation seq', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test first recruit with history' });

  await f.recruit('alpha');
  await f.call('stop', { participantId: 'alpha', reason: 'Done' });

  await f.recruit('gamma');
  const gamma = f.seat('gamma');
  const creation = f.store.eventsView().find((event) => (
    event.kind === 'swarm.created' && event.payload?.swarmId === SWARM_ID));
  assert.ok(creation, 'the swarm creation row is on the ledger');

  assert.match(gamma.brief, new RegExp(`Recent wake events \\(since seq ${creation.seq},`, 'u'),
    'a first recruit diffs against the swarm creation seq');
  const block = wakeBlockOf(gamma.brief);
  assert.match(block, /recruited/u, 'the block names alpha joining before gamma existed');
  assert.match(block, /left/u, 'the block names alpha stopping');
  // The seat's own join is written AFTER the brief is composed, so it is never its own news.
  assert.doesNotMatch(block, /gamma/u, 'a seat never reads its own join in the block');
});

// ── (f) the block carries this swarm's events only ──────────────────────────

test('529-f: the block carries this swarm\'s events only', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test the block swarm filter' });
  await f.recruit('alpha');

  // A sibling swarm in the same deployment. Its seats ride the brief's sibling block; they never
  // ride this seat's wake block, which is derived per swarm.
  await f.call('create', { purpose: 'Sibling swarm', swarmId: 'wake-529-sibling' });
  await f.call('recruit', {
    swarmId: 'wake-529-sibling', participantId: 'delta', objective: 'Work as delta',
  });

  await f.recruit('gamma');
  const block = wakeBlockOf(f.seat('gamma').brief);
  assert.ok(block.length > 0, 'gamma reads its own swarm\'s events');
  assert.match(block, /recruited/u, 'this swarm\'s events ride the block');
  assert.doesNotMatch(block, /delta/u, 'a sibling swarm\'s seat never rides this seat\'s block');
});

// ── (g) a terminal class names the command that acts on it ──────────────────

test('529-g: a terminal wake line names the command that acts on it', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test terminal wake follow-up' });

  await f.recruit('alpha');
  await f.call('stop', { participantId: 'alpha', reason: 'Done' });

  await f.recruit('gamma');
  const block = wakeBlockOf(f.seat('gamma').brief);

  assert.match(block, /left[^\n]*· next: baton swarm view wake-529/u,
    'a terminal class carries the command that acts on it, with the swarm filled in from the frame');
  assert.doesNotMatch(block, /recruited[^\n]*· next:/u,
    'a non-terminal class names no follow-up command');
});

// ── (h) a deployment-scoped event about this lane rides the block ───────────

test('529-h: a deployment-scoped event that resolves to this lane rides the block', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test deployment-scoped wake rows' });

  await f.recruit('alpha');
  const binding = f.seat('alpha').bindings.at(-1);
  assert.ok(binding?.workerId, 'alpha is bound to a worker');
  // A deployment-scoped class carries no swarmId of its own: the row names only the worker the
  // turn paused on, so its coordinates ride in through `wakeAttribution` — the same fold the wake
  // stream serves frames from — and the successor of that lane reads it in its brief.
  const paused = f.store.recordDriver('turn.paused', {
    worker: binding.workerId, taskId: binding.taskId, turn: 'turn-1', reason: 'awaiting a caller',
  }, { actor: 'driver', key: 'wake529-paused-alpha' });

  await f.call('stop', { participantId: 'alpha', reason: 'Re-route' });
  await f.recruit('delta', 'alpha');
  await f.answer('delta');

  const block = wakeBlockOf(f.seat('delta').brief);
  assert.match(block, new RegExp(`seq ${paused.event.seq} · paused`, 'u'),
    'the predecessor lane\'s paused turn rides the successor\'s block');
  assert.match(block, new RegExp(`paused[^\\n]*· next: baton swarm guide ${SWARM_ID} alpha`, 'u'),
    'the deployment-scoped line names the command that acts on it, with the lane resolved from attribution');
});

// ── (i) a deployment-scoped event about another lane never rides the block ──

test('529-i: a deployment-scoped event about another lane never rides the block', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test the deployment-scope lane filter' });

  await f.recruit('alpha');
  await f.recruit('gamma');
  const other = f.seat('gamma').bindings.at(-1);
  assert.ok(other?.workerId, 'gamma is bound to a worker');
  const paused = f.store.recordDriver('turn.paused', {
    worker: other.workerId, taskId: other.taskId, turn: 'turn-2', reason: 'awaiting a caller',
  }, { actor: 'driver', key: 'wake529-paused-gamma' });

  await f.call('stop', { participantId: 'alpha', reason: 'Re-route' });
  await f.recruit('delta', 'alpha');
  await f.answer('delta');

  const block = wakeBlockOf(f.seat('delta').brief);
  assert.ok(block.length > 0, 'delta reads its own lane\'s events');
  assert.doesNotMatch(block, new RegExp(`seq ${paused.event.seq}`, 'u'),
    'a deployment-scoped row about another seat\'s lane never rides this seat\'s block');
});

// ── (j) the recruit's declared wake narrowing rides the seat ────────────────

test('529-j: a recruit\'s autoWake narrowing is recorded on the seat and reaches its run', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test the autoWake narrowing' });

  await f.call('recruit', {
    participantId: 'alpha', objective: 'Work as alpha',
    // A repeated class and an alias, so the recorded value proves it is the stream's own
    // canonical spelling and set, never the caller's text.
    autoWake: { kinds: ['left', 'context', 'left'], participants: ['alpha'] },
  });

  const expected = { kinds: ['context_updated', 'left'], participants: ['alpha'] };
  assert.deepEqual({ ...f.seat('alpha').autoWake }, expected,
    'the join records the narrowing in the wake stream\'s own class spelling');
  const started = f.requests.find((request) => request.participantId === 'alpha');
  assert.ok(started, 'the recruit started a run');
  assert.deepEqual({ ...started.autoWake }, expected,
    'the run this seat starts carries the declared narrowing into its bridge issue');
});

// ── (k) an unknown wake class refuses before any membership ─────────────────

test('529-k: an autoWake naming an unknown class refuses before the seat joins', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test the autoWake closed set' });

  await assert.rejects(
    f.call('recruit', { participantId: 'alpha', objective: 'Work as alpha', autoWake: { kinds: ['no-such-class'] } }),
    (error) => error.code === 'swarm_command_invalid' && error.detail?.field === 'autoWake'
      && Array.isArray(error.detail?.unknown) && error.detail.unknown.includes('no-such-class'),
  );
  assert.equal(f.seat('alpha'), null, 'no seat joined on a declared class the stream does not serve');
  assert.equal(f.requests.some((request) => request.participantId === 'alpha'), false, 'no run started');
});
