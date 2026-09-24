// Organization truth for delegated swarms (the 2026-09-13 suborchestration audit): what a root
// orchestrator can read off swarm.view without assembling it by hand — a dead worker's turn is
// not "paused", a stopped participant and an orphaned delegation show as attention, a departed
// member's live session is named, a status-only work update keeps the recorded objective, and an
// unknown update field is refused instead of silently dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-org-truth', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'], effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16, maxTextBytes: 8192,
    maxItems: 64, maxScopePaths: 64, maxRouteValues: 32, maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024,
    maxStatusBytes: 256 * 1024, maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code',
  timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [],
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'repo-org-truth', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-org-truth-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Org truth'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'org@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'ready', files: {} } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(), turnCompletion: 'pausable',
    modelSelection: { mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null },
  });
  const driver = createDriver({ repoRoot: repo, repoId: policy.repoId, logDir: join(directory, 'log'),
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000 });
  const app = new BatonApplication({ driver, repoId: policy.repoId, profiles: { standard: profile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true });
  t.after(async () => { await app.shutdown(principal('cleanup')); rmSync(directory, { recursive: true, force: true }); });
  await app.ready;
  const paused = async (runId) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const worker = driver.coordinator.list().find((row) => row.runId === runId);
      if (worker && driver.coordination.eventsView().some((event) => event.payload?.kind === 'swarm.turn_reported'
        && event.payload.workerId === worker.id)) return worker;
      if (Date.now() > deadline) throw new Error(`participant of ${runId} did not report a completed turn`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const asWorker = (worker) => bindBaton(app, { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: `${worker.id}-session` });
  return { app, driver, root: bindBaton(app, principal('root')), paused, asWorker };
}

const kinds = (view) => view.attention.map((row) => row.kind);

test('a delegated subtree: dead workers, orphaned delegations, departed members and closed swarms are attention, not archaeology', async (t) => {
  const { driver, root, paused, asWorker } = await fixture(t);
  const swarm = await root.swarms.create('Organization truth');
  const lead = await swarm.recruit('lead', 'Coordinate', { ...selection, permissions: SWARM_PERMISSIONS });
  const leadWorker = await paused(lead.runId);
  const delegated = asWorker(leadWorker).swarms.open(swarm.id);
  const alpha = await delegated.recruit('alpha', 'Build A', selection);
  const beta = await delegated.recruit('beta', 'Build B', selection);
  const alphaWorker = await paused(alpha.runId);
  await paused(beta.runId);
  await delegated.work({ workId: 'W-A', objective: 'Part A', status: 'open' });
  await delegated.assign({ assignmentId: 'as-alpha', participantId: 'alpha', workId: 'W-A', status: 'active' });
  assert.deepEqual(kinds(await swarm.view()), ['root_wake_undelivered'],
    'the fixture records the report owed to its root session');

  // Stopping alpha settles its membership (issue #350): the row reads left/stopped, so its dead
  // runtime is no longer attention — the stop was the organization's own act — while its
  // orphaned work still is, and a dead worker's leftover pause is never a paused turn.
  await swarm.stop('alpha', 'part A done');
  let view = await swarm.view();
  const alphaRow = view.participants.find((row) => row.participantId === 'alpha');
  assert.equal(alphaRow.status, 'left');
  assert.equal(alphaRow.leftReason, 'stopped');
  assert.equal(alphaRow.runtime.state, 'dead');
  assert.equal(alphaRow.runtime.turn, null, 'a dead worker has no paused turn to guide');
  assert.equal(driver.coordinator.pausedTurns({ workerId: alphaWorker.id }).length >= 0, true);
  assert.deepEqual(kinds(view).sort(), ['assignment_holder_gone', 'root_wake_undelivered']);
  assert.deepEqual(view.attention.find((row) => row.kind === 'assignment_holder_gone'),
    { kind: 'assignment_holder_gone', assignmentId: 'as-alpha', participantId: 'alpha', workId: 'W-A',
      next: { event: 'swarm.holder_released', participantId: 'alpha' } });

  // The lead leaves organizationally: its process keeps running (a named fact) and beta's
  // delegation has no living parent.
  const left = await delegated.leave({ reason: 'delegation complete' });
  assert.equal(left.sessionStopped, false);
  view = await swarm.view();
  assert.ok(view.attention.some((row) => row.kind === 'member_left_session_live' && row.participantId === 'lead'));
  assert.ok(view.attention.some((row) => row.kind === 'delegation_orphaned' && row.participantId === 'beta' && row.parentId === 'lead'));
  // Issue #350: alpha's membership was settled by its stop, so it holds no delegation left to
  // orphan — only the live child of the departed parent is attention.
  assert.ok(!view.attention.some((row) => row.kind === 'delegation_orphaned' && row.participantId === 'alpha'), 'a stopped child of a departed parent is settled, not orphaned');

  // The root can still guide the orphan — loose coupling holds — and closing the swarm while it
  // runs is named too.
  const guided = await swarm.guide('beta', 'Finish part B');
  assert.equal(guided.result.result, 'ok');
  await swarm.close({ reason: 'audit complete' });
  view = await swarm.view();
  assert.equal(view.status, 'closed');
  const closed = view.attention.find((row) => row.kind === 'closed_with_live_participants');
  assert.ok(closed && closed.participantIds.includes('beta'), 'a closed swarm with a live participant says so');
});

test('work updates: a status-only update keeps the recorded objective, new work needs one, a declared dependency is stored, and a malformed one refuses', async (t) => {
  const { root } = await fixture(t);
  const swarm = await root.swarms.create('Work truth');
  await swarm.work({ workId: 'W', objective: 'Do the thing', status: 'open' });
  // Completion now demands evidence (issue #263); a status-only update on a live work item keeps
  // the recorded objective all the same.
  await assert.rejects(swarm.work({ workId: 'W', status: 'completed' }), { code: 'swarm_completion_unproven' });
  await swarm.work({ workId: 'W', status: 'open' });
  const updated = await swarm.view();
  assert.equal(updated.work.W.status, 'open');
  assert.equal(updated.work.W.objective, 'Do the thing', 'the recorded objective survives a status-only update');
  await assert.rejects(swarm.work({ workId: 'W-new', status: 'open' }), { code: 'swarm_payload_invalid' });
  // The dependency the suborchestration probe once had refused (it did not exist) is now a
  // DECLARED record on the work — and a malformed declaration still refuses, naming the shape.
  await swarm.work({ workId: 'W2', objective: 'Depends', status: 'open', dependsOn: [{ workId: 'W' }] });
  const declared = await swarm.view();
  assert.deepEqual(declared.work.W2.dependsOn, [{ workId: 'W' }], 'the declared dependency is durable');
  assert.deepEqual(declared.work.W2.waitsOn, [{ workId: 'W', settled: false, evidence: [] }],
    'the view shows the wait as unsettled with its (empty) evidence');
  await assert.rejects(swarm.work({ workId: 'W3', objective: 'Bad', status: 'open', dependsOn: ['W'] }),
    (error) => error.code === 'invalid_payload' && /each dependsOn entry must be an object/u.test(error.message));
  await assert.rejects(swarm.work({ workId: 'W4', objective: 'Dangling', status: 'open', dependsOn: [{ workId: 'W-nope' }] }),
    (error) => error.code === 'work_not_found' && /W-nope/u.test(error.message),
    'a dependency naming unknown work refuses with the missing identity');
});
