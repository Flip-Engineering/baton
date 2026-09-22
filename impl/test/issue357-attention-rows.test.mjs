// issue357-attention-rows.test.mjs — the remainders of issues #357, #310 and #346: three
// attention rows derived from facts the runtime already holds, all waking the root.
//
// 1. `worktree_foreign_changes` (#357): a seat's worktree gains paths OUTSIDE its declared
//    scope (the participant row's `scope` globs). Derived from the worktree's own change set
//    (`git status --porcelain` in the seat's worktree — the same authority the #301 base
//    derivation already shells out to at read time), intersected with paths outside the scope
//    through the ONE scope matcher (`pathInScopes`, path-scope.mjs — never a second glob
//    reading). The row names {participantId, paths, worktree} and its `next` is the seat's
//    own row (`swarm.view` scoped to the seat).
// 2. `turn_ended_without_contribution` (#310): a seat's turn ends cleanly (worker gone, no
//    crash row, no failure cause — the turn_completed/resultStatus completed the view can
//    see) with a dirty worktree and NO `swarm.contribution_recorded` from that seat since
//    its binding. The row names {participantId, changedPaths, commits: []} and its `next`
//    is `swarm.capture` for the seat, so the work is captured rather than lost.
// 3. `provider_auth_expired` (#346): a `lifecycle.crashed {phase: provider, code:
//    provider_auth_expired, remedy}` row lands as an attention row naming the ROOT-side
//    remedy the crash row already carries (re-project / re-recruit) with a credential-level
//    `next`. The remedy is READ from the crash projection, never minted twice; the
//    coordinator's `_mintProviderFaultDeath` next vocabulary gains the matching credential
//    action (`reproject_credential`) for the auth class.
//
// Hermetic: real CoordinationStore under a controllable coordinator (the #332 pattern),
// real git worktrees under os.tmpdir(), no provider, no network. `git stash` is never used.
//
// baton-lint: allow-real-clock — the `expiresAt` literals below are opaque carried strings
// (asserted by equality, never compared to wall time), so there is no time-bomb: the store's
// real clock only stamps unrelated row metadata.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { swarmWakeSummary, watchSwarmFiltered } from '../src/application-cli.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const seatOf = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t, { lastCrash } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue357-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    guideParticipant: async () => ({ ok: true }),
    captureContribution: async (workerId, { contributionId }) =>
      ({ contributionId, workerId, sha: 'a'.repeat(40), ref: `refs/baton/checkpoints/${'a'.repeat(40)}` }),
    checkContribution: async () => ({ passed: true, sha: 'a'.repeat(40), attempt: { cleanup: { state: 'closed' } } }),
  };
  const runtime = new SwarmRuntime({
    store,
    coordinator,
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: false });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
    ...(lastCrash === undefined ? {} : { lastCrash }),
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(command === 'list' ? {} : { swarmId: 'attn' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `attn-${++key}` }),
      ...args }, caller);
  const recruit = (participantId, options = {}) => call('recruit', {
    participantId, objective: `Work as ${participantId}`,
    ...(Object.keys(options).length ? { options } : {}),
  });
  const workerOf = (participantId) => workers.find((row) => row.runId === store.swarm('attn').participants[participantId].runId);
  // docs/46 §9 cutover (issue #274): the envelope's rows are the array the pins read.
  const attention = async (projection = 'attention') => (await call('view', { projection })).attention?.rows ?? [];
  return { store, workers, runtime, call, recruit, workerOf, attention };
}

/** A seat worktree: a real git checkout with one committed base file. */
function seatTree(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue357-${name}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue357@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Issue 357'], { cwd: root });
  mkdirSync(join(root, 'impl'), { recursive: true });
  writeFileSync(join(root, 'impl', 'base.mjs'), '// base\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

const dirty = (tree, relpath, content = '// changed\n') => {
  const full = join(tree, relpath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
};

/** Bind a seat's worker to a worktree the way a real binding records its checkout. */
const bindTree = (worker, tree) => {
  worker.sessionContext = { worktree: tree, repoRoot: tree };
};

// docs/46 §9 cutover (issue #274): attention is the {rows, coverage} envelope; the row pins
// read `attention.rows`.
const kinds = (attention) => (Array.isArray(attention) ? attention : attention?.rows ?? [])
  .map((row) => row.kind);
const rowFor = (rows, kind, participantId) => rows.find((row) => row.kind === kind && row.participantId === participantId);

test('357a: a worktree path outside the seat scope raises worktree_foreign_changes; an in-scope path raises nothing', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Foreign worktrees page' });
  const tree = seatTree(t, 'foreign');
  dirty(tree, 'elsewhere/notes.md');
  dirty(tree, 'impl/code.mjs');
  await f.recruit('builder', { scope: ['impl/**'] });
  const worker = f.workerOf('builder');
  bindTree(worker, tree);

  const rows = await f.attention();
  const row = rowFor(rows, 'worktree_foreign_changes', 'builder');
  assert.ok(row, 'a foreign path raises the row');
  assert.deepEqual(row.paths, ['elsewhere/notes.md'], 'the row names the foreign path');
  assert.equal(row.worktree, tree, 'the row names the worktree it read');
  assert.ok(!row.paths.includes('impl/code.mjs'), 'an in-scope path is not foreign');
  assert.deepEqual(row.next, { command: 'swarm.view', swarmId: 'attn', participantId: 'builder' },
    'next is the seat’s own row');
});

test('357a2: a seat whose dirt is all in scope raises no foreign row, and a seat with no scope raises none', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Scoped worktrees stay silent' });
  const clean = seatTree(t, 'scoped');
  dirty(clean, 'impl/code.mjs');
  await f.recruit('scoped', { scope: ['impl/**'] });
  bindTree(f.workerOf('scoped'), clean);
  const unscopedTree = seatTree(t, 'unscoped');
  dirty(unscopedTree, 'elsewhere/notes.md');
  await f.recruit('unscoped');
  bindTree(f.workerOf('unscoped'), unscopedTree);

  const rows = await f.attention();
  assert.equal(rowFor(rows, 'worktree_foreign_changes', 'scoped'), undefined,
    'dirt inside the declared scope is not foreign');
  assert.equal(rowFor(rows, 'worktree_foreign_changes', 'unscoped'), undefined,
    'a seat with no declared scope has no outside to be foreign to');
});

test('357b: a cleanly ended turn with dirty work and no contribution raises turn_ended_without_contribution with the capture next', async (t) => {
  const f = fixture(t, { lastCrash: () => null });
  await f.call('create', { purpose: 'Unpublished work pages' });
  const tree = seatTree(t, 'unpublished');
  dirty(tree, 'impl/work.mjs');
  await f.recruit('solo', { scope: ['impl/**'] });
  const worker = f.workerOf('solo');
  bindTree(worker, tree);
  // The turn ended the way a one-shot seat ends it: the process is gone, no crash row on
  // the seat's ledger, no recorded failure cause — and no contribution was ever published.
  worker.status = 'exited';
  worker.terminalCause = null;

  const rows = await f.attention();
  const row = rowFor(rows, 'turn_ended_without_contribution', 'solo');
  assert.ok(row, 'unpublished finished work raises the row');
  assert.deepEqual(row.changedPaths, ['impl/work.mjs']);
  assert.deepEqual(row.commits, [], 'no turn commits are claimed without turn evidence');
  assert.deepEqual(row.next, { command: 'swarm.capture', swarmId: 'attn', participantId: 'solo' },
    'next captures the work rather than losing it');
});

test('357b2: a cleanly ended turn WITH a contribution since binding raises nothing', async (t) => {
  const f = fixture(t, { lastCrash: () => null });
  await f.call('create', { purpose: 'Published work stays silent' });
  const tree = seatTree(t, 'published');
  dirty(tree, 'impl/work.mjs');
  await f.recruit('published', { scope: ['impl/**'] });
  const worker = f.workerOf('published');
  bindTree(worker, tree);
  await f.call('update',
    { event: 'swarm.contribution_recorded', payload: { contributionId: 'final', body: 'The work is done.' } },
    seatOf(worker.id));
  worker.status = 'exited';
  worker.terminalCause = null;

  const rows = await f.attention();
  assert.equal(rowFor(rows, 'turn_ended_without_contribution', 'published'), undefined,
    'a contribution since binding covers the turn’s dirt');
});

test('357b3: a crashed turn never reads as an unpublished clean turn', async (t) => {
  const crashes = new Map();
  const f = fixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Crashes keep their own row' });
  const tree = seatTree(t, 'crashed');
  dirty(tree, 'impl/work.mjs');
  await f.recruit('crashed', { scope: ['impl/**'] });
  const worker = f.workerOf('crashed');
  bindTree(worker, tree);
  crashes.set(worker.id, { error: 'exited 1 (null)', stderrTail: 'boom' });
  worker.status = 'dead';

  const rows = await f.attention();
  assert.equal(rowFor(rows, 'turn_ended_without_contribution', 'crashed'), undefined,
    'a mid-turn death is told by the crash/dead rows, never as a clean unpublished turn');
});

test('357c: a provider_auth_expired crash lands as the remedy row reading the crash row’s remedy', async (t) => {
  const remedy = 'The provider refused this turn because the projected credential expired. '
    + 'The deployment owns the credential: re-project the refreshed credential into the worker '
    + 'runtime, or re-recruit the seat onto a route whose credential outlives the lane.';
  const f = fixture(t, { lastCrash: (workerId) => (workerId === f.workerOf('expired').id ? {
    error: 'the provider refused the turn: the projected Claude access token had expired',
    stderrTail: null, phase: 'provider', code: 'provider_auth_expired',
    expiresAt: '2026-09-18T10:00:00.000Z', mechanism: 'file', remedy,
  } : null) });
  await f.call('create', { purpose: 'Expired credentials page with their remedy' });
  await f.recruit('expired', { scope: ['impl/**'] });
  const worker = f.workerOf('expired');
  worker.status = 'dead';
  worker.terminalCause = { kind: 'provider_failure', code: 'provider_auth_expired' };

  const rows = await f.attention();
  const row = rowFor(rows, 'provider_auth_expired', 'expired');
  assert.ok(row, 'the auth-expired crash lands as its remedy row');
  assert.equal(row.code, 'provider_auth_expired');
  assert.equal(row.remedy, remedy, 'the row reads the crash row’s remedy, never a second minting');
  assert.match(row.remedy, /re-project|re-recruit/u, 'the remedy names the root-side act');
  assert.equal(row.expiresAt, '2026-09-18T10:00:00.000Z');
  assert.deepEqual(row.next, { command: 'swarm.recruit', swarmId: 'attn', participantId: 'expired' },
    'next re-recruits the seat — the credential-level act the swarm can take');
});

test('357c2: a non-auth crash raises no remedy row', async (t) => {
  const f = fixture(t, { lastCrash: () => ({ error: 'exited 1 (null)', stderrTail: 'boom' }) });
  await f.call('create', { purpose: 'Ordinary crashes stay ordinary' });
  await f.recruit('plain', { scope: ['impl/**'] });
  const worker = f.workerOf('plain');
  worker.status = 'dead';

  const rows = await f.attention();
  assert.ok(!rows.some((row) => row.kind === 'provider_auth_expired'),
    'an exit-code crash without the auth class is not a credential row');
});

test('357d: every new row rides the bounded watch’s returned view and the follow summary', async (t) => {
  const remedy = 're-project the refreshed credential into the worker runtime, or re-recruit the seat.';
  const workersCrashed = new Map();
  const f = fixture(t, { lastCrash: (workerId) => workersCrashed.get(workerId) ?? null });
  await f.call('create', { purpose: 'Watches carry the new rows' });
  const foreignTree = seatTree(t, 'watch-foreign');
  dirty(foreignTree, 'elsewhere/notes.md');
  await f.recruit('foreign', { scope: ['impl/**'] });
  bindTree(f.workerOf('foreign'), foreignTree);
  const unpublishedTree = seatTree(t, 'watch-unpublished');
  dirty(unpublishedTree, 'impl/work.mjs');
  await f.recruit('quiet', { scope: ['impl/**'] });
  const quiet = f.workerOf('quiet');
  bindTree(quiet, unpublishedTree);
  quiet.status = 'exited';
  quiet.terminalCause = null;
  await f.recruit('doomed', { scope: ['impl/**'] });
  const doomed = f.workerOf('doomed');
  doomed.status = 'dead';
  doomed.terminalCause = { kind: 'provider_failure', code: 'provider_auth_expired' };
  workersCrashed.set(doomed.id, { error: 'expired', stderrTail: null, phase: 'provider',
    code: 'provider_auth_expired', expiresAt: null, mechanism: 'file', remedy });

  // The bounded watch answers with the ordinary view — the new rows ride its attention
  // slice — and the follow stream’s per-page summary carries that same slice.
  const watched = await f.call('watch', { timeoutMs: 50 });
  assert.ok(kinds(watched.attention).includes('worktree_foreign_changes'), 'watch carries the foreign row');
  assert.ok(kinds(watched.attention).includes('turn_ended_without_contribution'), 'watch carries the unpublished row');
  assert.ok(kinds(watched.attention).includes('provider_auth_expired'), 'watch carries the remedy row');
  const summary = swarmWakeSummary({ ...watched, watch: { reason: 'event', event: { seq: 1 } } });
  assert.ok(kinds(summary.attention).includes('worktree_foreign_changes'));
  assert.ok(kinds(summary.attention).includes('turn_ended_without_contribution'));
  assert.ok(kinds(summary.attention).includes('provider_auth_expired'),
    'the follow page carries every new row in its attention');

  // And the bounded watch under the attention filter resolves carrying the rows: the
  // watch itself is the delivery path the root already follows. #356: a bounded watch answers
  // its wake frame over the outline default — a caller that wants the rows on the view names
  // the projection, exactly as the CLI now spells `--projection full`.
  const client = { async command(name, args) { return f.call(name === 'swarm.watch' ? 'watch' : name, args); } };
  const filtered = await watchSwarmFiltered(
    { kinds: ['attention'], swarmId: 'attn', timeoutMs: 50, projection: 'full',
      idempotencyKey: 'attn-watch' }, client);
  assert.ok(kinds(filtered.attention).includes('worktree_foreign_changes'),
    'the --wake-class attention watch resolves with the rows on its view');
});

// ── coordinator half (#346): the provider-fault attention next gains the credential act ──

function coordinatorSetup(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue357-coord-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = new Log(join(root, 'log'));
  const adapter = {
    _card: {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null,
      maxContext: 100000, verbs: { spawn: 'native', prompt: 'native', interrupt: 'native', kill: 'native' },
      modelSelection: { mode: 'exact', family: 'mock', configuredDefault: 'mock-model', available: ['mock-model'],
        acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: ['low'], configuredEffort: 'low', serviceTier: null },
      governance: { usage: { tokens: 'native', usd: 'native', tokenMetric: 'mock-total', terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' }, maxWireFrameBytes: 1024 * 1024 },
    },
    _onEvent: null,
    card() { return this._card; },
    onEvent(cb) { this._onEvent = cb; },
    emit(event) { if (this._onEvent) this._onEvent(event); },
    async spawn() { return { ok: true }; },
    async prompt() { return { ok: true }; },
    async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; },
  };
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees: {
      pathFor: (taskId) => join(root, `wt-${taskId}`),
      async create(taskId) {
        const path = join(root, `wt-${taskId}`);
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, 'work.mjs'), '// the member produced this\n');
        return { path, branch: `baton/${taskId}`, baseSha: 'b'.repeat(40) };
      },
      async reconcile() { return { errors: [], retained: [] }; },
      worktreeAvailable: () => true,
    },
    referee: async (task) => ({ reverified: true, observedExit: task.brief.verification.expectExit,
      matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock',
    now: () => Date.parse('2026-09-18T10:00:00.000Z'),
  });
  return { coordinator, adapter, log };
}

const brief = () => ({
  goal: 'do the thing', constraints: [], pathScope: ['.'], definitionOfDone: 'tests pass',
  verification: { command: 'true', expectExit: 0 }, budget: { tokens: 100000, usd: 5, wallMin: 30 },
});

test('357e: an auth-expired death mints the credential next, never a routing next alone', async (t) => {
  const { coordinator, adapter } = coordinatorSetup(t);
  const handle = await coordinator.spawn('mock', brief(), { runId: 'run:pf-auth-expired' });
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.crashed', actor: 'worker',
    payload: { phase: 'provider', code: 'provider_auth_expired', expiresAt: '2026-09-18T10:00:00.000Z',
      mechanism: 'file', error: 'the projected access token had expired',
      remedy: 're-project the refreshed credential into the worker runtime, or re-recruit the seat.' } });
  await coordinator.wait(20);
  const stopped = coordinator.kill(handle.id, 'policy');
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'worker', payload: {} });
  await stopped;
  await coordinator.wait(20);

  const page = await coordinator.attentionFollow({ scope: { runId: 'run:pf-auth-expired' }, afterCursor: 0 },
    { principalId: 'wave-owner', sessionId: 'session-wave-owner' });
  const rows = (page?.reasons ?? page?.wakes ?? []).filter((reason) => reason.kind === 'provider_fault_death');
  assert.equal(rows.length, 1, 'the auth death lands as its run-level row');
  assert.equal(rows[0].fault.code, 'provider_auth_expired');
  assert.equal(rows[0].next.action, 'reproject_credential',
    'the next act is the credential act — re-project — never resume_on_another_route alone');
});
