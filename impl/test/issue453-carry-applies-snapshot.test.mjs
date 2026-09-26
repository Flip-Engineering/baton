// Issue #453 — a `swarm.recruit --resume-from` carry is a FACT or a REFUSAL, never a silent no-op.
//
// OBSERVED (primary at 1a830bfe, 2026-09-18 09:55–10:00Z): seat `ds-385mk` left two NEW uncommitted
// files in its checkout; its worker was SIGKILLed; custody snapshotted the checkout
// (`worktree.snapshotted {sha: b8fb794d, paths: 0}` — the row carried no snapshot diff at all) and
// removed it. `swarm recruit --resume-from ds-385mk` then recorded
// `workspace.carried_from {paths: [], snapshotSha: b8fb794d}` while the successor's checkout held
// neither file: the carry branch resolved `repoRoot` from `this.situationGit.repoRoot`, which the
// deployment never wires (application.mjs `_swarmRuntime()` passes `integration: {repoRoot,
// publishRemote}` and a `situationGit` with only `head`/`commitsSince`), so
// `applySnapshotToWorktree` was never called —
// silently, because a missing input skipped the apply and a failing apply was caught to `[]` — and
// the row still claimed a carry.
//
// The contract this file pins:
//   (a) a predecessor whose checkout is gone and whose snapshot holds an untracked new file: the
//       successor's checkout HOLDS the file, and the row says `how: 'applied'` with those paths;
//   (a2) the same when the snapshot row predates #453 and names no paths — the carry derives them
//       from the snapshot commit itself;
//   (bound) a predecessor whose checkout still exists is carried as `how: 'bound'` with the paths
//       the shared checkout holds;
//   (b) an apply that cannot run is a TYPED refusal naming the reason (git's own words) — no
//       successor is left working under a checkout that lost the work, and no
//       `workspace.carried_from` row claims otherwise;
//   (e) the incident's own class — an input the carry cannot derive (no repository root anywhere,
//       or a restart that lost the predecessor's recorded base) — refuses PRE-EFFECT: no successor
//       joins, no checkout is created, and `reason.missing` names the inputs;
//   (c) `worktree.snapshotted.paths` names the SNAPSHOT's own changed paths (tracked and untracked
//       alike), never a pre-snapshot working-tree list that reads 0 for untracked files;
//   (d) the row's new fields are durable, validated fold state, and a pre-#453 row still folds.
//
// Hermetic: every fixture drives a real repository, the deployment's own worktree authority, and a
// real CoordinationStore; the carry rows, the refusal and the brief are read from the durable
// ledger, never from memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { SWARM_EVENT_KINDS, foldSwarmEvent, validateSwarmEvent } from '../src/swarm-state.mjs';
import { allocatePhysicalWorkspaceOwner, captureCommit, createFromBase } from '../src/worktree.mjs';

const SWARM = 'carry-swarm';
const CARRIED = 'impl/PROBE-453.txt';
const CARRIED_BODY = 'the untracked file the crash left behind\n';
const TRACKED_EDIT = 'base\nedited by the dead seat\n';
const SNAPSHOT_SHA = 'b'.repeat(40);
const WORKSPACE_ID = `ws-${'4'.repeat(32)}`;
const AT = '2026-09-18T09:59:22.000Z';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const rowsOf = (store, kind) => store.eventsView().filter((event) => event.kind === kind);

function initRepo(repo) {
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 453 carry', GIT_COMMITTER_NAME: 'Issue 453 carry' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue453@example.invalid', GIT_COMMITTER_EMAIL: 'issue453@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
}

// ——————————————————————————————————————————————————————————————————
// Fixture: a real repository, the real worktree authority, a real store,
// and the deployment's OWN wiring
// ——————————————————————————————————————————————————————————————————

const deploymentAuthority = {
  deploymentId: createHash('sha256').update('issue453-deployment').digest('hex'),
  controllerId: createHash('sha256').update('issue453-controller').digest('hex'),
  pid: process.pid, pidStart: 'issue453-instance',
};

/** The checkout one seat works in, through the deployment's own worktree authority (lane branch,
 * owner receipt, worktree metadata) — the same physical workspace `swarm.participant_bound`
 * records. */
async function allocateCheckout(repo, { label, baseSha }) {
  const receipt = allocatePhysicalWorkspaceOwner(repo, {
    runId: `run-${label}`, attemptId: `attempt-${label}`, logicalTaskId: label,
    processGeneration: 1, baseSha,
  }, deploymentAuthority);
  const handle = await createFromBase(repo, receipt.physicalOwnerId, baseSha, { ownerReceipt: receipt });
  return { workspaceId: receipt.physicalOwnerId, dir: handle.dir, branch: receipt.branch, baseSha };
}

/**
 * ONE swarm runtime over a real repository and a real CoordinationStore, wired the way
 * application.mjs `_swarmRuntime()` wires the deployment: `integration: {repoRoot, publishRemote}` (or the
 * situation seam) carries the repository root, and `situationGit` carries the situation
 * projection (`head`/`commitsSince`) only.
 *
 * `successorBase` is the commit a FRESH successor checkout is created at (a function when the test
 * moves the target after the predecessor died). `repoRoot: false` wires the runtime with no
 * `integration` at all; `predecessorContext: false` has the coordinator answer for no checkout —
 * the state a resident restart leaves behind, where the handle carrying the predecessor's session
 * context is gone.
 */
function world(t, { successorBase = null, repoRoot = true, predecessorContext = true, tag = 'w' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue453-${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  initRepo(repo);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  const store = new CoordinationStore(join(dir, 'store'));
  const workers = [];
  const attachments = new Map();
  const contexts = new Map();
  const checkouts = new Map();
  const stopped = [];
  let allocated = 0;

  const contextOf = (checkout) => Object.freeze({
    repoRoot: repo, worktree: checkout.dir, baseSha: checkout.baseSha,
    branch: checkout.branch, ownerTaskId: checkout.workspaceId,
  });
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    workspaceAttachment: (workerId) => attachments.get(workerId) ?? null,
    predecessorWorkspaceContext: predecessorContext
      ? (workspaceId) => contexts.get(workspaceId) ?? null : () => null,
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {},
    integration: repoRoot ? { repoRoot: repo } : null,
    situationGit: { head: () => baseSha, commitsSince: () => [] },
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    stopRun: async (runId, reason) => { stopped.push({ runId, reason }); return { state: 'closed' }; },
    startRun: async (request) => {
      const index = workers.length + 1;
      const id = `w-${index}`;
      const predecessor = request.participantId === 'alpha';
      const base = request.workspace?.sessionContext?.baseSha ?? (predecessor ? baseSha
        : (typeof successorBase === 'function' ? successorBase() : successorBase ?? baseSha));
      // A successor bound to the predecessor's checkout adopts it; a fresh recruit gets its own.
      const checkout = request.workspace?.sessionContext
        ? {
          workspaceId: request.workspace.workspaceId,
          dir: request.workspace.sessionContext.worktree,
          branch: request.workspace.sessionContext.branch,
          baseSha: request.workspace.sessionContext.baseSha,
        }
        : await allocateCheckout(repo, { label: `seat-${tag}-${++allocated}`, baseSha: base });
      checkouts.set(checkout.workspaceId, checkout);
      const context = contextOf(checkout);
      contexts.set(checkout.workspaceId, { sessionContext: context, holders: [] });
      workers.push({
        id, taskId: `t-${index}`, runId: request.runId, status: 'working',
        worktree: checkout.dir, sessionContext: context,
      });
      attachments.set(id, { workspaceId: checkout.workspaceId, sessionContext: context, holderCount: 1 });
      return { runId: request.runId, workerId: id };
    },
  });
  let keys = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, {
    ...(command === 'view' ? {} : { idempotencyKey: `${tag}-${command}-${++keys}` }), ...args,
  }, { actor: 'owner', principalId: 'owner' });
  return { store, runtime, call, workers, attachments, contexts, checkouts, stopped, repo, baseSha };
}

const workerOf = (w, runId) => w.workers.find((row) => row.runId === runId) ?? null;

/**
 * The custody boundary #428 performs on a stop, driven by hand so the fixture can kill the seat the
 * way the incident did: snapshot the checkout onto its lane branch through the real capture
 * primitive, remove the checkout, and record the snapshot row the removal is backed by. `paths`
 * records the snapshot's own changed paths where the caller asks for the #453 row shape; `null`
 * records the row a pre-#453 deployment wrote.
 */
async function snapshotAndRemove(w, { worker, paths = null }) {
  const checkout = w.checkouts.get(worker.sessionContext.ownerTaskId);
  const captured = await captureCommit(w.repo, checkout.workspaceId, {
    expectedWorktreePath: checkout.dir, expectedBaseSha: checkout.baseSha,
    expectedBranch: checkout.branch,
  });
  execFileSync('git', ['worktree', 'remove', '--force', checkout.dir], { cwd: w.repo });
  assert.equal(existsSync(checkout.dir), false, 'the predecessor checkout is gone after the snapshot');
  w.store.recordDriver('worktree.snapshotted', {
    workspaceId: checkout.workspaceId, participantId: null, workerId: worker.id, taskId: worker.taskId,
    sha: captured.sha, branch: checkout.branch, snapshotted: true, stopSeq: null,
    ...(paths === null ? {} : { paths }),
  }, { actor: 'policy', key: `worktree.snapshotted:${worker.id}:${captured.sha}` });
  return { checkout, sha: captured.sha };
}

/** One dead predecessor whose checkout is gone and whose snapshot holds `CARRIED` + `TRACKED_EDIT`. */
async function deadPredecessorWithSnapshot(w, { snapshotPaths = null } = {}) {
  await w.call('create', { swarmId: SWARM, purpose: 'Carry a crash snapshot' });
  const alpha = await w.call('recruit', { swarmId: SWARM, participantId: 'alpha', objective: 'build alpha' });
  const worker = workerOf(w, alpha.runId);
  const checkout = w.checkouts.get(worker.sessionContext.ownerTaskId);
  mkdirSync(join(checkout.dir, 'impl'), { recursive: true });
  writeFileSync(join(checkout.dir, CARRIED), CARRIED_BODY);
  writeFileSync(join(checkout.dir, 'base.txt'), TRACKED_EDIT);
  const snapshot = await snapshotAndRemove(w, { worker, paths: snapshotPaths });
  worker.status = 'dead';
  return { worker, ...snapshot };
}

const inheritanceSection = (brief) =>
  brief.slice(brief.indexOf('## Inheritance from alpha')).split('\n\n## ')[0];

// ——————————————————————————————————————————————————————————————————
// (a) the carry really applies, and the row says so
// ——————————————————————————————————————————————————————————————————

test('453-a: a snapshot holding an untracked new file reaches the successor checkout', async (t) => {
  const w = world(t, { tag: 'a' });
  const snapshotPaths = ['base.txt', CARRIED];
  const { sha } = await deadPredecessorWithSnapshot(w, { snapshotPaths });

  const bravo = await w.call('recruit', {
    swarmId: SWARM, participantId: 'bravo', objective: 'continue alpha', resumeFrom: 'alpha',
  });
  const successorCheckout = workerOf(w, bravo.runId).worktree;

  assert.equal(readFileSync(join(successorCheckout, CARRIED), 'utf8'), CARRIED_BODY,
    'the successor checkout holds the predecessor\'s UNTRACKED file');
  assert.equal(readFileSync(join(successorCheckout, 'base.txt'), 'utf8'), TRACKED_EDIT,
    'and its tracked change');

  const carried = rowsOf(w.store, 'workspace.carried_from');
  assert.equal(carried.length, 1, 'ONE carry row for the successor');
  assert.equal(carried[0].payload.predecessor, 'alpha');
  assert.equal(carried[0].payload.workspaceId, workerOf(w, bravo.runId).sessionContext.ownerTaskId,
    'the row names the checkout that now holds the work');
  assert.equal(carried[0].payload.snapshotSha, sha, 'the snapshot it came from');
  assert.equal(carried[0].payload.how, 'applied', 'the carry is recorded as a FACT');
  assert.deepEqual([...carried[0].payload.paths], snapshotPaths, 'naming the carried paths');

  const section = inheritanceSection(w.store.swarm(SWARM).participants.bravo.brief);
  assert.ok(section.includes(CARRIED), `the brief names the carried path: ${section}`);
  assert.ok(section.includes('applied'), 'and how it was carried');
});

test('453-a2: a pre-#453 snapshot row names no paths — the carry derives them from the snapshot', async (t) => {
  const w = world(t, { tag: 'a2' });
  const { sha } = await deadPredecessorWithSnapshot(w, { snapshotPaths: null });

  const bravo = await w.call('recruit', {
    swarmId: SWARM, participantId: 'bravo', objective: 'continue alpha', resumeFrom: 'alpha',
  });
  const successorCheckout = workerOf(w, bravo.runId).worktree;

  assert.equal(readFileSync(join(successorCheckout, CARRIED), 'utf8'), CARRIED_BODY,
    'the successor checkout holds the predecessor\'s untracked file');
  const carried = rowsOf(w.store, 'workspace.carried_from');
  assert.equal(carried.length, 1, 'ONE carry row for the successor');
  assert.equal(carried[0].payload.how, 'applied');
  assert.deepEqual([...carried[0].payload.paths], ['base.txt', CARRIED],
    'the paths are the snapshot\'s own diff, read from the repository');
  assert.equal(carried[0].payload.snapshotSha, sha);
});

test('453-bound: a predecessor whose checkout still exists is carried as `bound`', async (t) => {
  const w = world(t, { tag: 'bound' });
  await w.call('create', { swarmId: SWARM, purpose: 'Carry a live checkout' });
  const alpha = await w.call('recruit', { swarmId: SWARM, participantId: 'alpha', objective: 'build alpha' });
  const worker = workerOf(w, alpha.runId);
  const checkout = w.checkouts.get(worker.sessionContext.ownerTaskId);
  mkdirSync(join(checkout.dir, 'impl'), { recursive: true });
  writeFileSync(join(checkout.dir, CARRIED), CARRIED_BODY);
  worker.status = 'dead';

  await w.call('recruit', {
    swarmId: SWARM, participantId: 'bravo', objective: 'continue alpha', resumeFrom: 'alpha',
  });

  const carried = rowsOf(w.store, 'workspace.carried_from');
  assert.equal(carried.length, 1, 'ONE carry row');
  assert.equal(carried[0].payload.how, 'bound', 'the successor binds the very checkout');
  assert.equal(carried[0].payload.workspaceId, checkout.workspaceId);
  assert.equal(carried[0].payload.snapshotSha, null, 'nothing was applied from a snapshot');
  assert.deepEqual([...carried[0].payload.paths], [CARRIED], 'the paths the shared checkout holds');
});

// ——————————————————————————————————————————————————————————————————
// (b) an apply that cannot run refuses typed
// ——————————————————————————————————————————————————————————————————

test('453-b: a snapshot that cannot apply refuses typed — no row, no successor handed the loss', async (t) => {
  // The deployment target moved past the predecessor's base: the successor's fresh checkout
  // already carries the same path with other content, so the snapshot diff cannot apply.
  const moved = {};
  const w = world(t, { tag: 'b', successorBase: () => moved.sha });
  const { sha } = await deadPredecessorWithSnapshot(w, { snapshotPaths: [CARRIED] });
  mkdirSync(join(w.repo, 'impl'), { recursive: true });
  writeFileSync(join(w.repo, CARRIED), 'the target already carries this path\n');
  execFileSync('git', ['add', '-A'], { cwd: w.repo });
  execFileSync('git', ['commit', '-qm', 'target moved past the predecessor base'], { cwd: w.repo });
  moved.sha = git(w.repo, ['rev-parse', 'HEAD']);

  // Issue #572: the recruit performs the whole recovery, so the apply that cannot run refuses the
  // RECRUIT that would start the seat rather than a later answer — and the seat is withdrawn.
  await assert.rejects(
    w.call('recruit', {
      swarmId: SWARM, participantId: 'bravo', objective: 'continue alpha', resumeFrom: 'alpha',
    }),
    (error) => {
      assert.equal(error.code, 'swarm_workspace_carry_failed',
        `the refusal is typed, never a silent successor: ${error.message}`);
      assert.equal(error.detail?.predecessor, 'alpha');
      assert.equal(error.detail?.snapshotSha, sha, 'the refusal names the snapshot it could not carry');
      assert.equal(typeof error.detail?.reason?.error, 'string', 'and the reason class');
      assert.ok(error.detail.reason.error.length > 0, 'the reason names the git failure');
      assert.match(error.detail.reason.error, /already exists/u,
        `the reason carries git's own words: ${error.detail.reason.error}`);
      return true;
    });

  assert.deepEqual(rowsOf(w.store, 'workspace.carried_from'), [],
    'no row claims a carry that did not happen');
  const checkout = w.checkouts.get(w.workers[1].sessionContext.ownerTaskId);
  assert.equal(readFileSync(join(checkout.dir, CARRIED), 'utf8'),
    'the target already carries this path\n', 'nothing was half-applied into the successor checkout');
  assert.notEqual(w.store.swarm(SWARM).participants.bravo?.status, 'active',
    'the seat the refused recruit could not start is not left as a live member');

});

// ——————————————————————————————————————————————————————————————————
// (e) the incident's own class: an input the carry cannot derive from
// ——————————————————————————————————————————————————————————————————

test('453-e: a carry with no derivable repository root refuses PRE-EFFECT, naming the inputs', async (t) => {
  // Nothing names a root: no landing authority, no situation seam, and no predecessor handle
  // (the restart case) — so both the root and the base the diff needs are absent.
  const w = world(t, { tag: 'e', repoRoot: false, predecessorContext: false });
  await deadPredecessorWithSnapshot(w, { snapshotPaths: [CARRIED] });

  await assert.rejects(
    w.call('recruit', {
      swarmId: SWARM, participantId: 'bravo', objective: 'continue alpha', resumeFrom: 'alpha',
    }),
    (error) => {
      assert.equal(error.code, 'swarm_workspace_carry_failed');
      assert.deepEqual([...error.detail.reason.missing], ['repoRoot', 'baseSha'],
        'the reason names exactly the inputs the carry lacked');
      return true;
    });

  assert.equal(w.store.swarm(SWARM).participants.bravo, undefined,
    'no successor joins on a carry that cannot happen');
  assert.equal(w.workers.length, 1, 'no successor checkout is created either');
  assert.deepEqual(w.stopped, [], 'and nothing needed withdrawing');
  assert.deepEqual(rowsOf(w.store, 'workspace.carried_from'), [], 'no row claims a carry');
});

test('453-e2: a restart that lost the predecessor handle refuses rather than guessing a base', async (t) => {
  const w = world(t, { tag: 'e2', predecessorContext: false });
  await deadPredecessorWithSnapshot(w, { snapshotPaths: [CARRIED] });

  await assert.rejects(
    w.call('recruit', {
      swarmId: SWARM, participantId: 'bravo', objective: 'continue alpha', resumeFrom: 'alpha',
    }),
    (error) => {
      assert.equal(error.code, 'swarm_workspace_carry_failed');
      assert.deepEqual([...error.detail.reason.missing], ['baseSha'],
        'the recorded base is what a snapshot diff must be taken against — never a guessed one');
      return true;
    });
  assert.equal(w.store.swarm(SWARM).participants.bravo, undefined, 'no seat joins');
  assert.deepEqual(rowsOf(w.store, 'workspace.carried_from'), [], 'no row claims a carry');
});

// ——————————————————————————————————————————————————————————————————
// (c) the custody row names the snapshot's own paths
// ——————————————————————————————————————————————————————————————————

const repoId = 'repo-issue453-custody';

const policy = Object.freeze({
  schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1, repoId,
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const selection = Object.freeze({
  exact: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
});

const principal = (principalId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
});
const orchestrator = principal('orchestrator');
const command = (app, name, args) => app.command(name, args, orchestrator);

/** A long turn keeps the seat non-terminal, so a stop reaches the preservation boundary. */
function workingAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: { outcome: 'completed', delayMs: 120_000, summary: 'still working', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

async function applicationFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue453-custody-'));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: join(directory, 'log'),
    adapters: { mock: workingAdapter() },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 4_000,
  });
  const app = new BatonApplication({
    driver, repoId,
    profiles: { standard: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    await app.shutdown(principal('cleanup')).catch(() => {});
    rmSync(directory, { force: true, recursive: true });
  });
  await app.ready;
  return { app, driver, repo };
}

async function seatWorking(driver, runId) {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const worker = driver.coordinator.list().find((row) => row.runId === runId && row.status === 'working');
    if (worker) return worker;
    if (Date.now() >= deadline) throw new Error(`seat never started working: ${runId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('453-c: worktree.snapshotted names the snapshot\'s own changed paths, untracked files included', async (t) => {
  const { app, driver, repo } = await applicationFixture(t);
  await command(app, 'swarm.create', {
    swarmId: 'custody-paths', purpose: 'Name the snapshot paths', idempotencyKey: 'create:custody-paths',
  });
  const seat = await command(app, 'swarm.recruit', {
    swarmId: 'custody-paths', participantId: 'builder', objective: 'hold uncommitted edits',
    options: selection, idempotencyKey: 'recruit:custody-paths:builder',
  });
  const worker = await seatWorking(driver, seat.runId);
  const checkout = worker.worktree;
  const baseSha = worker.sessionContext.baseSha;
  writeFileSync(join(checkout, 'carried.txt'), 'uncommitted work that must be named\n');
  writeFileSync(join(checkout, 'base.txt'), 'base\nedited by the seat\n');

  await command(app, 'swarm.stop', {
    swarmId: 'custody-paths', participantId: 'builder', reason: 'stop with uncommitted edits',
    idempotencyKey: 'stop:custody-paths:builder',
  });

  const rows = driver.coordination.eventsView()
    .filter((event) => event.kind === 'driver.recorded'
      && event.payload?.kind === 'worktree.snapshotted'
      && event.payload?.workspaceId === worker.sessionContext.ownerTaskId);
  assert.ok(rows.length >= 1, 'a worktree.snapshotted row is recorded');
  const snapshot = rows[rows.length - 1].payload;
  const expected = git(repo, ['diff', '--name-only', baseSha, snapshot.sha])
    .split('\n').filter(Boolean).sort();
  assert.deepEqual([...expected], ['base.txt', 'carried.txt'],
    'the fixture produced a tracked edit and an untracked file');
  assert.deepEqual([...snapshot.paths], expected,
    'the row names the SNAPSHOT\'s own changed paths — not the 0 a working-tree list reads for untracked files');
});

// ——————————————————————————————————————————————————————————————————
// (d) the row's new fields are validated, durable fold state
// ——————————————————————————————————————————————————————————————————

test('453-d: how/reason validate, fold, and a pre-#453 row still replays', async () => {
  assert.ok(SWARM_EVENT_KINDS.has('workspace.carried_from'), 'the fold kind is registered');
  const base = {
    swarmId: 'sw', participantId: 'bravo', workspaceId: WORKSPACE_ID, predecessor: 'alpha',
    paths: [CARRIED], snapshotSha: SNAPSHOT_SHA,
  };
  for (const payload of [
    { ...base, how: 'bound', paths: [CARRIED] },
    { ...base, how: 'applied' },
    { ...base, how: 'skipped', paths: [], reason: { missing: ['targetDir'] } },
    { ...base, how: 'skipped', paths: [], reason: { error: 'error: impl/PROBE-453.txt: already exists in working directory' } },
  ]) {
    assert.doesNotThrow(() => validateSwarmEvent('workspace.carried_from', payload),
      `the row validates: ${JSON.stringify(payload.how)}`);
  }
  assert.throws(() => validateSwarmEvent('workspace.carried_from', { ...base, how: 'carried' }),
    /how/, 'a how outside the closed set is refused');
  assert.throws(() => validateSwarmEvent('workspace.carried_from', { ...base, how: 'skipped' }),
    /reason/, 'a skipped carry must say why');
  assert.throws(() => validateSwarmEvent('workspace.carried_from',
    { ...base, how: 'skipped', paths: [], reason: { missing: [] } }),
  /reason/, 'a reason that names nothing is refused');
  assert.throws(() => validateSwarmEvent('workspace.carried_from',
    { ...base, how: 'applied', reason: { missing: ['baseSha'] } }),
  /reason/, 'a reason on a carry that happened is refused');

  const swarms = new Map([['sw', Object.freeze({
    participants: Object.freeze({
      bravo: Object.freeze({ participantId: 'bravo', status: 'active', seq: 1, ts: AT }),
    }),
  })]]);
  foldSwarmEvent(swarms, {
    kind: 'workspace.carried_from',
    payload: { ...base, how: 'skipped', paths: [], reason: { missing: ['baseSha'] } },
    seq: 10, ts: AT, actor: 'direct:owner',
  });
  const folded = swarms.get('sw').participants.bravo.carriedFrom;
  assert.equal(folded.how, 'skipped', 'the fold keeps the carry\'s how');
  assert.deepEqual({ ...folded.reason }, { missing: ['baseSha'] }, 'and its reason');
  assert.equal(folded.seq, 10);

  // Replay parity: a row recorded before #453 carries no `how` and still folds — honestly as
  // "not recorded", never a guess about whether the work moved.
  foldSwarmEvent(swarms, {
    kind: 'workspace.carried_from', payload: { ...base, how: undefined },
    seq: 11, ts: AT, actor: 'direct:owner',
  });
  const replayed = swarms.get('sw').participants.bravo.carriedFrom;
  assert.equal(replayed.how, null, 'a pre-#453 row reads how: null, never an invented fact');
  assert.deepEqual([...replayed.paths], [CARRIED], 'and keeps the paths it recorded');
  assert.equal(replayed.seq, 11);
});
