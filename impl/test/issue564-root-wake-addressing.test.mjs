// Issue #564 (addressing half) — a root-addressed wake class derived from durable rows the
// runtime records when work waits on the root.
//
// Two defects, one per row kind the contribution write path now derives:
//   (a)  the wake-class table maps a `swarm.root_attention_owed` driver row (the payload-kind
//        form, in every container the ledger projects) to the `root_owed` class;
//   (b)  `deriveWakeFrame` renders that row as a deployment-scoped terminal frame whose `next`
//        names the command that acts on it, with the subject reading the payload (participant,
//        fallback swarm);
//   (c)  the runtime derives the rows on the `swarm.update` contribution write path, AFTER the
//        contribution row is recorded: `review_owed` exactly when no OTHER active seat holds the
//        review permission at that moment (both directions), `needs_root` once per needsFromOthers
//        item ADDRESSED to the root (`the root: …` / `root: …`), never for prose that merely
//        contains the word (`root cause: …`, `the root of …`). The derivation keeps no state —
//        a replay of the same update records nothing twice.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { allocatePhysicalWorkspaceOwner, createFromBase } from '../src/worktree.mjs';
import { WAKE_CLASSES, deriveWakeFrame, wakeClassFor, wakeClassRow } from '../src/wake-stream.mjs';

const SWARM_ID = 'wake-564-addressing';
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue564-'));
  const repo = join(directory, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 564', GIT_COMMITTER_NAME: 'Issue 564' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue564@example.invalid', GIT_COMMITTER_EMAIL: 'issue564@example.invalid' });
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
    predecessorWorkspaceContext: () => null,
    // Issue #564: the provider-fault seam the death observation reads — armed per worker by the
    // reviewer-loss pins, so the observation's own repair behavior is testable without a real
    // provider kill.
    providerFaultDeathFor: (workerId) => faultDeaths.get(workerId) ?? null,
  };
  const faultDeaths = new Map();
  const runtime = new SwarmRuntime({
    store,
    coordinator,
    authorize: async () => {},
    prepareRun: async (request) => ({ ...request }),
    situationGit: { repoRoot: repo },
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      const receipt = allocatePhysicalWorkspaceOwner(repo, {
        runId: request.runId, attemptId: `attempt-${workers.length + 1}`,
        logicalTaskId: request.participantId, processGeneration: 1, baseSha,
      }, { deploymentId: createHash('sha256').update('issue564-deployment').digest('hex'),
        controllerId: createHash('sha256').update('issue564-controller').digest('hex'),
        pid: process.pid, pidStart: 'issue564-instance' });
      const workspaceId = receipt.physicalOwnerId;
      const worktree = (await createFromBase(repo, workspaceId, baseSha, { ownerReceipt: receipt })).dir;
      const workerId = `w-${workers.length + 1}`;
      const sessionContext = { ownerTaskId: workspaceId, worktree, branch: `baton/${workspaceId}`, baseSha };
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
  // Issue #564 review fix: an append-fault seam for the durable-row ordering pin. While armed,
  // the ledger refuses exactly the swarm.root_attention_owed appends, so a test can simulate the
  // crash or append failure that used to sit between the contribution append and the owed row.
  let failRootAttention = false;
  const originalRecordDriver = store.recordDriver.bind(store);
  store.recordDriver = (kind, payload, auth) => {
    if (failRootAttention && kind === 'swarm.root_attention_owed') {
      throw Object.assign(new Error('injected root-attention append fault'), { code: 'injected_append_fault' });
    }
    return originalRecordDriver(kind, payload, auth);
  };
  const updateCompletions = () => store.eventsView().filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.operation_completed' && event.payload?.command === 'swarm.update');
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: SWARM_ID, idempotencyKey: `issue564-${++key}`, ...args }, caller);
  const contractBody = (needsFromOthers) => ({
    subject: 'Lane delivers a root-addressed wake class',
    base: { observedHead: baseSha, rebasedOnto: baseSha },
    commit: null,
    items: [{ id: 'item-1', status: 'delivered', change: 'Derive the root attention rows',
      files: ['impl/src/swarm-runtime.mjs'], test: 'node scripts/run-suite.mjs test/issue564-root-wake-addressing.test.mjs',
      evidence: 'targeted suite green' }],
    verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
    carriedForward: [],
    needsFromOthers,
  });
  return {
    store, runtime, call, baseSha, contractBody,
    attentionRows: () => store.eventsView().filter((event) => event.kind === 'driver.recorded'
      && event.payload?.kind === 'swarm.root_attention_owed'),
    updateCompletions,
    failRootAttention: (value) => { failRootAttention = value; },
    seat: (participantId) => store.swarm(SWARM_ID)?.participants?.[participantId] ?? null,
    workerIdOf: (participantId) => store.swarm(SWARM_ID)?.participants?.[participantId]
      ?.bindings?.at(-1)?.workerId ?? null,
    setFaultDeath: (workerId, death) => {
      if (death === null) faultDeaths.delete(workerId); else faultDeaths.set(workerId, death);
    },
    recruit: (participantId, permissions) => call('recruit', {
      participantId, objective: `Work as ${participantId}`,
      ...(permissions === undefined ? {} : { permissions }),
    }),
  };
}

// ── (a) the class derives from the row, in every container the ledger projects ──

test('564-a: wakeClassFor maps the swarm.root_attention_owed driver row to the root_owed class', () => {
  const row = wakeClassRow('root_owed');
  assert.ok(row, 'the closed WAKE_CLASS_TABLE carries root_owed');
  assert.ok(WAKE_CLASSES.includes('root_owed'), 'root_owed is in the closed class vocabulary');
  assert.equal(row.scope, 'deployment', 'deployment scope is what a root session subscribes to');
  assert.equal(row.terminal, true, 'the row names the act; the wake is terminal');
  assert.equal(row.next, 'baton swarm view {swarmId}');
  assert.deepEqual(
    row.rows.map((matcher) => matcher.payloadKind), ['swarm.root_attention_owed'],
    'the class derives from exactly its one operational row kind');
  assert.ok(typeof row.summary === 'string' && row.summary.length > 0, 'root_owed is documented');
  // The payload-kind form, in both containers one operational event is projected into.
  assert.equal(wakeClassFor({ kind: 'driver.recorded', payload: { kind: 'swarm.root_attention_owed' } })?.wakeClass,
    'root_owed');
  assert.equal(wakeClassFor({ kind: 'evidence.mapped', payload: { kind: 'swarm.root_attention_owed' } })?.wakeClass,
    'root_owed');
});

// ── (b) the frame is deployment-scoped and terminal, and names the coordinates ──

test('564-b: deriveWakeFrame renders a terminal frame whose next carries the coordinates', () => {
  const frame = deriveWakeFrame({ seq: 41, ts: 'T', kind: 'driver.recorded', actor: 'baton-runtime',
    payload: { kind: 'swarm.root_attention_owed', swarmId: 'swarm-1', participantId: 'ada',
      contributionId: 'contribution-ada-1', owed: 'review_owed', ask: null,
      next: { command: 'swarm.check', swarmId: 'swarm-1', participantId: 'ada',
        contributionId: 'contribution-ada-1' } } });
  assert.equal(frame.wakeClass, 'root_owed');
  assert.equal(frame.swarmId, 'swarm-1');
  assert.equal(frame.participantId, 'ada');
  assert.equal(frame.next, 'baton swarm view swarm-1', 'the terminal command renders the coordinates');
  assert.deepEqual(frame.subject, { kind: 'participant', id: 'ada' },
    'the subject reads the participant the row is about');
  assert.equal(frame.row.payloadKind, 'swarm.root_attention_owed');
  // The fallback subject: a row that names only the swarm still carries one.
  const bare = deriveWakeFrame({ seq: 42, ts: 'T', kind: 'driver.recorded', actor: 'baton-runtime',
    payload: { kind: 'swarm.root_attention_owed', swarmId: 'swarm-1', participantId: 'ada',
      contributionId: 'contribution-ada-1', owed: 'needs_root', ask: 'the root: restart the resident',
      next: { command: 'swarm.view', swarmId: 'swarm-1' } } });
  assert.equal(bare.wakeClass, 'root_owed');
  assert.equal(bare.next, 'baton swarm view swarm-1');
});

// ── (c) the runtime derives the rows on the contribution write path ─────────────

test('564-c1: review_owed fires with no other active reviewer seat, needs_root only for root-addressed items', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test root wake addressing' });
  await f.recruit('author');
  // The premise of this row is that NO other active seat holds review: state it, so a change to
  // the recruit default permissions (e.g. #572) cannot make this fixture assert the opposite.
  await f.recruit('idle-peer', ['read', 'communicate', 'contribute']);

  await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'author', body: f.contractBody([
      { to: 'root', ask: 'the root: restore the publish path' },
      { to: 'root', ask: 'root: land the queue' },
      { to: 'participant', participantId: 'idle-peer', ask: 'root cause: the park is stale' },
      { to: 'participant', participantId: 'idle-peer', ask: 'the root of the issue is elsewhere' },
    ]) },
  });

  const rows = f.attentionRows();
  // review_owed: neither the author nor any other seat holds review, so only the root can check.
  const reviewOwed = rows.filter((event) => event.payload.owed === 'review_owed');
  assert.equal(reviewOwed.length, 1, 'exactly one review_owed row per trigger per contribution');
  assert.deepEqual(reviewOwed[0].payload, {
    kind: 'swarm.root_attention_owed',
    swarmId: SWARM_ID, participantId: 'author', contributionId: reviewOwed[0].payload.contributionId,
    owed: 'review_owed', ask: null,
    next: { command: 'swarm.check', swarmId: SWARM_ID, participantId: 'author',
      contributionId: reviewOwed[0].payload.contributionId },
  });
  assert.ok(f.store.swarm(SWARM_ID).contributions[reviewOwed[0].payload.contributionId],
    'the row names a contribution the fold holds');

  // The typed address determines which needs reach the root.
  const needsRoot = rows.filter((event) => event.payload.owed === 'needs_root');
  assert.deepEqual(needsRoot.map((event) => event.payload.ask),
    ['the root: restore the publish path', 'root: land the queue']);
  for (const event of needsRoot) {
    assert.equal(event.payload.participantId, 'author');
    assert.deepEqual(event.payload.next, { command: 'swarm.view', swarmId: SWARM_ID });
  }

  // One row per trigger per contribution: the same update under its own idempotency key
  // re-derives the same rows under the same keys and records nothing twice.
  await f.runtime.command('swarm.update', {
    swarmId: SWARM_ID, idempotencyKey: 'issue564-4',
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'author', body: f.contractBody([
      { to: 'root', ask: 'the root: restore the publish path' },
      { to: 'root', ask: 'root: land the queue' },
      { to: 'participant', participantId: 'idle-peer', ask: 'root cause: the park is stale' },
      { to: 'participant', participantId: 'idle-peer', ask: 'the root of the issue is elsewhere' },
    ]) },
  }, owner);
  assert.equal(f.attentionRows().length, rows.length, 'a replay records no second row');
});

test('564-c2: review_owed stays silent while an active seat other than the author holds review', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test review owed negative' });
  await f.recruit('author');
  await f.recruit('reviewer', ['read', 'communicate', 'contribute', 'review']);

  await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'author', body: f.contractBody([]) },
  });

  const rows = f.attentionRows();
  assert.equal(rows.length, 0,
    'a seat holding review is present, so no root attention is owed');
});

test('564-c3: a seat that left stops holding review, and the next contribution wakes the root again', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test review owed after leave' });
  await f.recruit('author');
  await f.recruit('reviewer', ['read', 'communicate', 'contribute', 'review']);

  await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'author', body: f.contractBody([]) },
  });
  assert.equal(f.attentionRows().length, 0, 'the active reviewer holds the check');

  await f.call('stop', { participantId: 'reviewer', reason: 'Lane done' });
  // The stop itself re-addresses the existing unreviewed contribution (the c4 case); the
  // NEXT contribution then carries its own review_owed row from its own write instant.
  const afterStop = f.attentionRows().filter((event) => event.payload.owed === 'review_owed');
  assert.equal(afterStop.length, 1, 'the existing unreviewed contribution is re-addressed');
  assert.equal(f.store.swarm(SWARM_ID).contributions[afterStop[0].payload.contributionId].participantId,
    'author', 'the re-addressed row names the recorded contribution');

  await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'author', body: f.contractBody([]) },
  });

  const rows = f.attentionRows().filter((event) => event.payload.owed === 'review_owed');
  assert.equal(rows.length, 2, 'each contribution owes exactly one review_owed row');
  assert.equal(new Set(rows.map((event) => event.payload.contributionId)).size, 2,
    'one row per contribution, never a second for the same work');
  assert.equal(rows[1].payload.participantId, 'author');
  assert.equal(rows[0].payload.participantId, 'author');
});

test('564-d: an append fault after the contribution row faults the mutation unacknowledged, and the replay repairs the owed rows', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test durable ordering under append fault' });
  await f.recruit('author');

  // The fault sits exactly where a crash used to lose the wake: after the contribution append,
  // while the owed rows are being recorded. The mutation must fault with its operation
  // completion unwritten, so nothing can read the contribution as acknowledged-without-wake.
  f.failRootAttention(true);
  const attempt = f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'author', body: f.contractBody([{ to: 'root', ask: 'root: land the queue' }]) },
  });
  await assert.rejects(attempt, (error) => error.code === 'injected_append_fault',
    'the append fault is the mutation answer, never a swallowed loss');
  assert.equal(f.attentionRows().length, 0, 'no owed row landed under the fault');
  assert.equal(f.updateCompletions().length, 0,
    'the operation is never completed without its owed rows');
  assert.ok(f.store.swarm(SWARM_ID).contributions
    && Object.keys(f.store.swarm(SWARM_ID).contributions).length === 1,
    'the contribution row itself is durable beneath the fault');

  // The replay under the SAME idempotency key repairs exactly what is missing: both owed rows
  // land once each, and only then is the operation completed — after the rows, never before.
  f.failRootAttention(false);
  await f.runtime.command('swarm.update', {
    swarmId: SWARM_ID, idempotencyKey: 'issue564-3',
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'author', body: f.contractBody([{ to: 'root', ask: 'root: land the queue' }]) },
  }, owner);
  const rows = f.attentionRows();
  assert.equal(rows.length, 2, 'the replay records exactly the two owed rows');
  assert.deepEqual(rows.map((event) => event.payload.owed).sort(), ['needs_root', 'review_owed']);
  assert.equal(f.store.swarm(SWARM_ID).contributions
    && Object.keys(f.store.swarm(SWARM_ID).contributions).length, 1,
    'the replay does not duplicate the contribution');
  const completions = f.updateCompletions();
  assert.equal(completions.length, 1, 'exactly one operation completion, from the replay');
  assert.ok(completions[0].seq > Math.max(...rows.map((event) => event.seq)),
    'the completion is written after every owed row it acknowledges');
});

test('564-c4: an existing unreviewed contribution is re-addressed when its sole reviewer leaves, derived from the fold', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test reviewer loss re-addresses existing work' });
  await f.recruit('author');
  await f.recruit('reviewer', ['read', 'communicate', 'contribute', 'review']);

  // Recorded while a reviewer seat held review: no review_owed row at the write instant. The
  // root-addressed need still fires — its trigger is the write, not the roster.
  await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'author', body: f.contractBody([{ to: 'root', ask: 'root: land the queue' }]) },
  });
  assert.equal(f.attentionRows().filter((event) => event.payload.owed === 'review_owed').length, 0,
    'the active reviewer holds the check at the write instant');
  assert.equal(f.attentionRows().filter((event) => event.payload.owed === 'needs_root').length, 1);

  await f.call('stop', { participantId: 'reviewer', reason: 'Lane done' });

  // The departure is the trigger: the still-unreviewed contribution is re-addressed to the root
  // from the fold, once — and the needsFromOthers need is NOT re-fired by the departure.
  const owed = f.attentionRows().filter((event) => event.payload.owed === 'review_owed');
  assert.equal(owed.length, 1, 'the existing unreviewed contribution wakes the root after the loss');
  assert.equal(owed[0].payload.participantId, 'author');
  assert.deepEqual(owed[0].payload.next,
    { command: 'swarm.check', swarmId: SWARM_ID, participantId: 'author',
      contributionId: owed[0].payload.contributionId });
  assert.equal(f.attentionRows().filter((event) => event.payload.owed === 'needs_root').length, 1,
    'the departure does not re-fire the contribution write triggers');

  // A second departure re-derives from the same fold and records nothing twice.
  await f.call('stop', { participantId: 'author', reason: 'Author leaves too' });
  assert.equal(f.attentionRows().filter((event) => event.payload.owed === 'review_owed').length, 1,
    'a second departure never double-records the owed row');
});

test('564-e: an append fault at the stop path is repaired by a later stop even though the departure row exists', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test stop fault reconciliation' });
  await f.recruit('author');
  await f.recruit('reviewer', ['read', 'communicate', 'contribute', 'review']);

  await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'author', body: f.contractBody([{ to: 'root', ask: 'root: land the queue' }]) },
  });
  assert.equal(f.attentionRows().filter((event) => event.payload.owed === 'review_owed').length, 0);

  // The reviewer's probe: the stop writes its participant_left row, the owed append then
  // faults. The departure is durable, the mutation faults unacknowledged, and the owed row
  // is missing.
  f.failRootAttention(true);
  await assert.rejects(f.call('stop', { participantId: 'reviewer', reason: 'Lane done' }),
    (error) => error.code === 'injected_append_fault',
    'the append fault faults the stop, never a swallowed loss');
  assert.equal(f.seat('reviewer').status, 'left', 'the departure row is durable beneath the fault');
  assert.equal(f.attentionRows().filter((event) => event.payload.owed === 'review_owed').length, 0,
    'the owed row did not land under the fault');

  // The repair: a LATER stop sees the seat already settled (leave would be null) and must
  // still reconcile the missing deterministic rows from the fold.
  f.failRootAttention(false);
  await f.call('stop', { participantId: 'reviewer', reason: 'Reconcile' });
  const owed = f.attentionRows().filter((event) => event.payload.owed === 'review_owed');
  assert.equal(owed.length, 1, 'the later stop reconciles the missing owed row');
  assert.ok(f.seat('reviewer') !== null
    && f.store.swarm(SWARM_ID).contributions[owed[0].payload.contributionId] !== null,
    'the reconciled row names the recorded contribution');
});

test('564-f: an append fault at the provider-fault observation is repaired by a later observation', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test observation fault reconciliation' });
  await f.recruit('author');
  await f.recruit('reviewer', ['read', 'communicate', 'contribute', 'review']);

  await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { participantId: 'author', body: f.contractBody([{ to: 'root', ask: 'root: land the queue' }]) },
  });
  assert.equal(f.attentionRows().filter((event) => event.payload.owed === 'review_owed').length, 0);

  // The provider kills the reviewer's worker; the observation writes the fault and leave rows,
  // but the owed append faults inside it. The observation is best-effort (a read must not fail
  // on a reconciliation append), so the rows stay missing until a later observation passes.
  f.setFaultDeath(f.workerIdOf('reviewer'),
    { seq: 1, code: 'provider_fault',
      route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      resetAt: null, snapshotSha: null });
  f.failRootAttention(true);
  await f.call('update', { event: 'swarm.context_updated',
    payload: { key: 'notes:observe-1', body: 'trigger the fault observation' } });
  assert.equal(f.seat('reviewer').status, 'left', 'the death settled the membership');
  assert.equal(f.attentionRows().filter((event) => event.payload.owed === 'review_owed').length, 0,
    'the owed row did not land under the fault');

  f.failRootAttention(false);
  await f.call('update', { event: 'swarm.context_updated',
    payload: { key: 'notes:observe-2', body: 'trigger the reconciling observation' } });
  const owed = f.attentionRows().filter((event) => event.payload.owed === 'review_owed');
  assert.equal(owed.length, 1, 'the later observation reconciles the missing owed row');
  assert.equal(f.attentionRows().filter((event) => event.payload.owed === 'needs_root').length, 1,
    'the observation never re-fires the write-instant triggers');
});
