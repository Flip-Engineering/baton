// Issue #621 — a resume-from successor starts from the predecessor's preserved work.
//
// OBSERVED (2026-09-27, mcp-598-updates → mcp-598-updates2; 2026-09-28 08:55Z after a host reboot,
// digest-lead16za → digest-lead16zb): `swarm.recruit --resume-from` refused with
// `swarm_workspace_carry_failed`, twice in two days.
//   - 2026-09-27: the predecessor's snapshot 61eda2d0 did not apply onto the successor's checkout
//     (`patch failed: docs/43-host-capacity-and-derived-floors.md:357`,
//     `impl/test/swarm-coupling.test.mjs:178`) — the target had moved past the predecessor's base.
//   - 2026-09-28: the predecessor's workspace directory had been removed by startup reclamation
//     (#616) and its preserved work sat on branch `baton/ws-041bc8bc40cc4ffbf91d2a026e76e778`.
// Both times the root recruited a fresh seat pointed at the predecessor's branch by hand.
//
// The carry applied the predecessor's snapshot as a PATCH onto the successor's checkout, so it
// failed whenever that checkout had moved (a re-cut, a newer target) or no longer existed.
//
// The contract this file pins (#621):
//   (A) the target advanced incompatibly beyond the predecessor's base (the same path holds other
//       content) and the predecessor's checkout is gone: the recruit is ADMITTED, the successor's
//       own checkout holds the predecessor's work, `git rev-parse HEAD` in it is the recorded
//       snapshot revision, and `workspace.carried_from` says `applied` with that snapshot and its
//       paths;
//   (B) the predecessor's directory was removed by the startup reclamation and its work is only on
//       its preserved lane branch: the successor starts with that work checked out — HEAD is the
//       revision the removal recorded, the file content matches, its `sessionContext.baseSha` is
//       that revision, and the checkout is still a valid owned checkout the seat can work in (an
//       edit is captured and committed on its own lane branch).
//
// Hermetic: every fixture drives real scratch repositories, the deployment's own worktree
// authority, a real CoordinationStore and real BatonApplication incarnations; the carry row, the
// refusal and the checkout's revision are read from the durable ledger and from git, never from
// memory.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';
import { captureCommit, sparseCheckoutIdentity, validateOwnedWorktree } from '../src/worktree.mjs';

// The #362 rule: a recruit's run objective IS its composed brief, so the text bound is the
// deployment's own objective lane, never a constant a brief with a recovery section can outgrow.
import { FRAME_LIMITS } from '../src/limits.mjs';

const SWARM = 'resume-preserved';
const PROBE = 'impl/PROBE-621.txt';
const PROBE_BODY = 'the work the dead seat left behind\n';
const TARGET_BODY = 'the target already carries this path\n';
const TRACKED_EDIT = 'base\nedited by the dead seat\n';

const repoId = 'repo-issue621-resume';

const policy = Object.freeze({
  schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: FRAME_LIMITS['run.objective'].value, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
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

const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const orchestrator = principal('orchestrator');

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function initRepo(dir) {
  execFileSync('git', ['init', '-q', dir]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 621 resume', GIT_COMMITTER_NAME: 'Issue 621 resume' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue621@example.invalid', GIT_COMMITTER_EMAIL: 'issue621@example.invalid' });
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  mkdirSync(join(dir, 'impl'), { recursive: true });
  writeFileSync(join(dir, 'impl', 'lane.txt'), 'the lane\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: dir });
}

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

/** One scratch repository with a log directory of its own: the checkout every incarnation of a
 * test serves. */
function scratch(t, label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue621-${label}-`));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const logDir = join(directory, 'log');
  mkdirSync(logDir, { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, repo, logDir };
}

/** One incarnation of the deployment over that repository: the recruit crosses the deployment's
 * own workspace admission and its plan-gated dispatch, and the checkout is created by the
 * deployment's own worktree authority. */
async function incarnation(t, { repo, logDir, label }) {
  const driver = createDriver({
    repoRoot: repo, repoId, logDir,
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
  await app.ready;
  return {
    app, driver, repo, logDir, label,
    command: (name, args) => app.command(name, args, orchestrator),
    // Bounded: an abandoned incarnation is left holding a seat that never finishes its turn, and
    // the suite must not wait on it.
    close: async () => {
      await Promise.race([
        app.shutdown(principal('cleanup')).catch(() => {}),
        new Promise((resolve) => { setTimeout(resolve, 5_000).unref?.(); }),
      ]);
    },
  };
}

async function until(read, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const workerFor = (driver, runId) =>
  driver.coordinator.list().find((row) => row.runId === runId) ?? null;
const workingSeat = (driver, runId) => until(
  () => workerFor(driver, runId)?.status === 'working' ? workerFor(driver, runId) : null,
  `seat ${runId} to start working`,
);

const rowsOf = (driver, kind) => driver.coordination.eventsView()
  .filter((row) => (row.kind === 'driver.recorded' ? row.payload?.kind : row.kind) === kind);
const carryRows = (driver) => rowsOf(driver, 'workspace.carried_from');

/** The custody row a removal is backed by (#428): the LAST `worktree.snapshotted` row for one
 * workspace is the snapshot a successor carries. */
const snapshotRowFor = (driver, workspaceId) =>
  rowsOf(driver, 'worktree.snapshotted').filter((row) => row.payload?.workspaceId === workspaceId).at(-1)
    ?.payload ?? null;

async function predecessorSeat(w) {
  await w.command('swarm.create', {
    swarmId: SWARM, purpose: 'Continue a lane from preserved work', idempotencyKey: 'create',
  });
  const alpha = await w.command('swarm.recruit', {
    swarmId: SWARM, participantId: 'alpha', objective: 'Build the alpha lane',
    options: selection, idempotencyKey: 'recruit:alpha',
  });
  const worker = await workingSeat(w.driver, alpha.runId);
  const checkout = worker.worktree;
  mkdirSync(join(checkout, 'impl'), { recursive: true });
  writeFileSync(join(checkout, PROBE), PROBE_BODY);
  writeFileSync(join(checkout, 'base.txt'), TRACKED_EDIT);
  return {
    alpha, worker, checkout,
    workspaceId: worker.sessionContext.ownerTaskId,
    baseSha: worker.sessionContext.baseSha,
    laneBranch: `baton/${worker.sessionContext.ownerTaskId}`,
  };
}

// ——————————————————————————————————————————————————————————————————
// (A) the target moved past the predecessor's base
// ——————————————————————————————————————————————————————————————————

test('621-A: a successor of a gone checkout whose move makes the patch impossible starts at the snapshot', async (t) => {
  const w = await incarnation(t, { ...scratch(t, 'a'), label: 'a' });
  t.after(() => w.close());
  const predecessor = await predecessorSeat(w);
  await w.command('swarm.stop', {
    swarmId: SWARM, participantId: 'alpha', reason: 'hand the lane to a successor',
    idempotencyKey: 'stop:alpha',
  });
  if (existsSync(predecessor.checkout)) {
    execFileSync('git', ['worktree', 'remove', '--force', predecessor.checkout], { cwd: w.repo });
  }
  assert.equal(existsSync(predecessor.checkout), false, 'the predecessor checkout is gone');
  const snapshot = snapshotRowFor(w.driver, predecessor.workspaceId);
  assert.ok(snapshot?.sha, 'the removal is backed by a preserved snapshot revision');

  // The target moves past the predecessor's base and carries other content at the same path — the
  // shape the incident refused: the snapshot's diff could not apply onto a checkout of this target.
  writeFileSync(join(w.repo, PROBE), TARGET_BODY);
  execFileSync('git', ['add', '-A'], { cwd: w.repo });
  execFileSync('git', ['commit', '-qm', 'target moved past the predecessor base'], { cwd: w.repo });
  const movedSha = git(w.repo, ['rev-parse', 'HEAD']);
  assert.notEqual(movedSha, predecessor.baseSha, 'the target really moved');

  const bravo = await w.command('swarm.recruit', {
    swarmId: SWARM, participantId: 'bravo', objective: 'Continue the alpha lane',
    options: selection, resumeFrom: 'alpha', idempotencyKey: 'recruit:bravo',
  });
  const successor = await workingSeat(w.driver, bravo.runId);

  assert.equal(git(successor.worktree, ['rev-parse', 'HEAD']), snapshot.sha,
    'the successor checkout HEAD is the recorded snapshot revision');
  assert.equal(readFileSync(join(successor.worktree, PROBE), 'utf8'), PROBE_BODY,
    'the successor checkout holds the predecessor\'s work');
  assert.equal(readFileSync(join(successor.worktree, 'base.txt'), 'utf8'), TRACKED_EDIT,
    'and its tracked change');

  const carried = carryRows(w.driver);
  assert.equal(carried.length, 1, 'ONE carry row for the successor');
  assert.equal(carried[0].payload.predecessor, 'alpha');
  assert.equal(carried[0].payload.workspaceId, successor.sessionContext.ownerTaskId,
    'the row names the successor\'s own checkout');
  assert.equal(carried[0].payload.how, 'applied');
  assert.equal(carried[0].payload.snapshotSha, snapshot.sha);
  assert.deepEqual([...carried[0].payload.paths], [PROBE, 'base.txt'].sort(),
    'the row names the snapshot\'s own changed paths');
});

// ——————————————————————————————————————————————————————————————————
// (B) the removal left the work only on the preserved branch
// ——————————————————————————————————————————————————————————————————

test('621-B: a successor of a reclamation-removed checkout works in that preserved revision', async (t) => {
  const s = scratch(t, 'b');

  // The first incarnation's seat works and leaves uncommitted work in its own checkout; the
  // incarnation is then lost, which is the state a host reboot leaves behind.
  const first = await incarnation(t, { ...s, label: 'b1' });
  t.after(() => first.close());
  const predecessor = await predecessorSeat(first);
  first.driver.coordination.releaseWriterLease();

  // The startup that begins after the loss ends alpha's seat and keeps its checkout for the
  // successor that may bind it.
  const second = await incarnation(t, { ...s, label: 'b2' });
  t.after(() => second.close());
  assert.equal(existsSync(predecessor.checkout), true,
    'the startup that ends the seat keeps its checkout');
  second.driver.coordination.releaseWriterLease();

  // The startup that begins from alpha's own end reclaims the checkout, capturing its content
  // into the lane branch first (#616).
  const third = await incarnation(t, { ...s, label: 'b3' });
  t.after(() => third.close());
  assert.equal(existsSync(predecessor.checkout), false,
    'the startup that begins from alpha\'s end reclaims its checkout');
  const snapshot = snapshotRowFor(third.driver, predecessor.workspaceId);
  assert.ok(snapshot?.sha, 'the reclamation is backed by a preserved snapshot revision');
  const preservedTip = git(s.repo, ['rev-parse', predecessor.laneBranch]);
  assert.equal(preservedTip, snapshot.sha,
    'the preserved lane branch holds the revision the removal recorded');

  const bravo = await third.command('swarm.recruit', {
    swarmId: SWARM, participantId: 'bravo', objective: 'Continue the alpha lane',
    options: selection, resumeFrom: 'alpha', idempotencyKey: 'recruit:bravo',
  });
  const successor = await workingSeat(third.driver, bravo.runId);

  assert.equal(git(successor.worktree, ['rev-parse', 'HEAD']), preservedTip,
    'the successor starts with the preserved work checked out');
  assert.equal(readFileSync(join(successor.worktree, PROBE), 'utf8'), PROBE_BODY,
    'the file content matches the preserved work');
  assert.equal(successor.sessionContext.baseSha, preservedTip,
    'the successor\'s recorded base is the revision its checkout starts at');

  const carried = carryRows(third.driver);
  assert.equal(carried.length, 1, 'ONE carry row for the successor');
  assert.equal(carried[0].payload.how, 'applied');
  assert.equal(carried[0].payload.snapshotSha, preservedTip);

  // The carried checkout is still an owned checkout the seat can work and be captured in: the
  // deployment's own capture gate admits it, and an edit lands on the successor's lane branch.
  validateOwnedWorktree(s.repo, successor.sessionContext.ownerTaskId, {
    expectedPath: successor.worktree,
    expectedBaseSha: successor.sessionContext.baseSha,
    expectedBranch: successor.sessionContext.branch,
    sparseCheckoutIdentity: sparseCheckoutIdentity([]),
  });
  writeFileSync(join(successor.worktree, PROBE), `${PROBE_BODY}and continued by bravo\n`);
  const captured = await captureCommit(s.repo, successor.sessionContext.ownerTaskId, {
    expectedWorktreePath: successor.worktree,
    expectedBaseSha: successor.sessionContext.baseSha,
    expectedBranch: successor.sessionContext.branch,
  });
  assert.equal(git(s.repo, ['rev-parse', `baton/${successor.sessionContext.ownerTaskId}`]), captured.sha,
    'the successor\'s own lane branch holds the captured work');
  assert.equal(git(s.repo, ['show', `${captured.sha}:${PROBE}`]).trim(),
    `${PROBE_BODY}and continued by bravo`.trim(),
    'the captured revision holds what the successor wrote on top of the carried checkout');
});
