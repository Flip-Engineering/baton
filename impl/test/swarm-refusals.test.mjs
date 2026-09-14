// Refused swarm mutations are durable, wake-capable records (issue #271 work W2; fixture pattern
// from swarm-coupling.test.mjs): a refusal of a WRITE — contract admission, authority, the state
// fold, or holder liveness — lands as the runtime's own swarm.operation_refused driver row
// {swarmId, command, event, code, field, participantId}. The swarm fold never sees it, swarm.watch
// wakes on it, and the coordination log replays it byte-identically. A refused READ records
// nothing, and no caller can fabricate a refusal row: the kind is not a swarm.update event.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SWARM_DRIVER_EVENT_KINDS, SWARM_EVENT_KINDS, validateSwarmCommand } from '../src/swarm-contract.mjs';

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-refusals', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'], effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16, maxTextBytes: 4096,
    maxItems: 64, maxScopePaths: 64, maxRouteValues: 32, maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024,
    maxStatusBytes: 256 * 1024, maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code',
  timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [],
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-refusals', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-refusals-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Swarm refusals'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'refusals@example.invalid'], { cwd: repo });
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
  const driver = createDriver({
    repoRoot: repo, repoId: policy.repoId, logDir: join(directory, 'log'),
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000,
  });
  const app = new BatonApplication({ driver, repoId: policy.repoId, profiles: { standard: profile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true });
  t.after(async () => { await app.shutdown(principal('cleanup')); rmSync(directory, { recursive: true, force: true }); });
  await app.ready;
  const paused = async (runId) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const worker = driver.coordinator.list().find((row) => row.runId === runId);
      if (worker && driver.coordinator.pausedTurns({ workerId: worker.id }).length) return worker;
      if (Date.now() > deadline) throw new Error(`participant of ${runId} did not pause`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const asWorker = (worker) => bindBaton(app, { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: `${worker.id}-session` });
  return { app, driver, directory, root: bindBaton(app, principal('root')), paused, asWorker };
}

// A lead with every permission and one builder without organize authority, with one work item —
// the smallest swarm in which authority, fold, and holder refusals are all reachable.
async function holders(t) {
  const fixtureHandle = await fixture(t);
  const { root, paused, asWorker } = fixtureHandle;
  const swarm = await root.swarms.create('Refusals');
  const lead = await swarm.recruit('lead', 'Coordinate', { ...selection, permissions: SWARM_PERMISSIONS });
  const leadWorker = await paused(lead.runId);
  const delegated = asWorker(leadWorker).swarms.open(swarm.id);
  const alpha = await delegated.recruit('alpha', 'Build A', selection);
  const alphaWorker = await paused(alpha.runId);
  await delegated.work({ workId: 'W-A', objective: 'Part A', status: 'open' });
  return { ...fixtureHandle, swarm, delegated, lead, leadWorker, alpha, alphaWorker };
}

const refusalRows = (coordination) => coordination.eventsView()
  .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === 'swarm.operation_refused');
const refusalRow = (coordination, match) => {
  const rows = refusalRows(coordination).filter((event) => Object.entries(match)
    .every(([field, value]) => event.payload[field] === value));
  assert.equal(rows.length, 1, `exactly one refusal row matches ${JSON.stringify(match)}`);
  return rows[0];
};

test('a refused mutation is a durable row that wakes a watch and never enters the fold', async (t) => {
  const { swarm, alphaWorker, asWorker, driver } = await holders(t);
  const foldBefore = JSON.stringify(driver.coordination.swarm(swarm.id));
  const swarmEventsBefore = driver.coordination.eventsView().filter((event) => event.kind.startsWith('swarm.')).length;

  const parked = await swarm.view();
  const watching = swarm.watch({ afterSeq: parked.cursor, timeoutMs: 5000 });
  await assert.rejects(asWorker(alphaWorker).swarms.open(swarm.id)
    .group({ groupId: 'impl', members: ['alpha'] }), { code: 'swarm_permission_required' });

  const woke = await watching;
  assert.equal(woke.watch.reason, 'event', 'the refusal wakes a parked watcher');
  assert.equal(woke.watch.event.kind, 'driver.recorded');
  assert.equal(woke.watch.event.payloadKind, 'swarm.operation_refused');
  const row = refusalRow(driver.coordination, { code: 'swarm_permission_required' });
  assert.equal(row.seq, woke.watch.matchedSeq, 'the wake names the refusal row itself');
  assert.deepEqual(row.payload, {
    kind: 'swarm.operation_refused', swarmId: swarm.id, command: 'swarm.update',
    event: 'swarm.group_updated', code: 'swarm_permission_required', field: null, participantId: 'alpha',
  });
  assert.equal(row.idempotencyKey.startsWith('swarm-refusal:'), true, 'the refusal carries its own deterministic identity');
  assert.equal(JSON.stringify(driver.coordination.swarm(swarm.id)), foldBefore, 'the fold never sees the refusal');
  assert.equal(driver.coordination.eventsView().filter((event) => event.kind.startsWith('swarm.')).length,
    swarmEventsBefore, 'no swarm state event was appended for the refusal');
});

test('each refusal family records its own coordinates: the named field, the state, the holder', async (t) => {
  const { swarm, delegated, driver } = await holders(t);

  // The application (like the native bridge) validates swarm arguments at its own boundary before
  // dispatch, so a shape refusal never reaches the runtime. The runtime's own admission is
  // exercised directly here — it is the layer that owns the record and names the bad field.
  const admissionDirectory = mkdtempSync(join(tmpdir(), 'baton-swarm-admission-'));
  t.after(() => rmSync(admissionDirectory, { recursive: true, force: true }));
  const admission = new CoordinationStore(admissionDirectory);
  const runtime = new SwarmRuntime({ store: admission, coordinator: { list: () => [], pausedTurns: () => [] },
    authorize: async () => {}, prepareRun: async () => {}, startRun: async () => {}, stopRun: async () => ({}) });
  await runtime.command('swarm.create',
    { purpose: 'Admission', swarmId: 'swarm-admission', idempotencyKey: 'admission-create' }, principal('root'));
  await assert.rejects(runtime.command('swarm.update', { swarmId: 'swarm-admission', event: 'swarm.work_updated',
    payload: { workId: 'W-1', objective: 'W-1', bogus: true }, idempotencyKey: 'admission-update' }, principal('root')),
  { code: 'swarm_command_invalid' });
  assert.equal(refusalRow(admission, { code: 'swarm_command_invalid' }).payload.field, 'payload.bogus',
    'the contract refusal names the offending payload field');

  // The state fold's refusal names no field; the caller that attempted it is named instead.
  await assert.rejects(delegated.work({ workId: 'W-A', objective: 'Part A', dependsOn: [{ workId: 'W-missing' }] }),
    { code: 'work_not_found' });
  const state = refusalRow(driver.coordination, { code: 'work_not_found' }).payload;
  assert.equal(state.field, null);
  assert.equal(state.participantId, 'lead', 'the caller whose mutation was refused is named');

  // A holder release refused while the holder is live names the holder it refused to release.
  await assert.rejects(delegated.holderRelease('alpha', 'alpha is still live'), { code: 'swarm_holder_live' });
  assert.deepEqual(refusalRow(driver.coordination, { code: 'swarm_holder_live' }).payload, {
    kind: 'swarm.operation_refused', swarmId: swarm.id, command: 'swarm.update',
    event: 'swarm.holder_released', code: 'swarm_holder_live', field: null, participantId: 'alpha',
  });
});

test('refused reads record nothing, and an identical refusal retried records once', async (t) => {
  const { swarm, app, driver, alphaWorker, asWorker } = await holders(t);

  // A refused READ is the caller's own business: an absent swarm and a watch cursor ahead of the
  // log both refuse, and neither leaves a refusal row.
  await assert.rejects(app.command('swarm.view', { swarmId: 'swarm-absent' }, principal('root')),
    { code: 'swarm_not_found' });
  await assert.rejects(swarm.watch({ afterSeq: 10_000, timeoutMs: 10 }), { code: 'swarm_cursor_invalid' });
  assert.equal(refusalRows(driver.coordination).length, 0, 'no refused read is recorded');

  // The same refused request, retried under its own operation identity, records once.
  const refused = () => asWorker(alphaWorker).swarms.open(swarm.id)
    .group({ groupId: 'impl', members: ['alpha'] }, { idempotencyKey: 'same-operation' });
  await assert.rejects(refused(), { code: 'swarm_permission_required' });
  await assert.rejects(refused(), { code: 'swarm_permission_required' });
  assert.equal(refusalRows(driver.coordination).length, 1, 'the identical retry kept the refusal\'s deterministic identity');
  await assert.rejects(asWorker(alphaWorker).swarms.open(swarm.id)
    .group({ groupId: 'impl', members: ['alpha'] }, { idempotencyKey: 'another-operation' }),
  { code: 'swarm_permission_required' });
  assert.equal(refusalRows(driver.coordination).length, 2, 'a new operation identity records its own refusal');
});

test('the log replays refusals byte-identically, and no caller can fabricate one', async (t) => {
  const { swarm, delegated, app, driver, directory, alphaWorker, asWorker } = await holders(t);
  await assert.rejects(asWorker(alphaWorker).swarms.open(swarm.id)
    .group({ groupId: 'impl', members: ['alpha'] }), { code: 'swarm_permission_required' });
  await assert.rejects(delegated.work({ workId: 'W-A', objective: 'Part A', dependsOn: [{ workId: 'W-missing' }] }),
    { code: 'work_not_found' });

  // The refusal rides the same coordination log as every record: a reopened store replays it whole.
  const replayed = new CoordinationStore(join(directory, 'log', 'coordination'),
    { repoId: policy.repoId, goalPlanPolicy: policy });
  assert.deepEqual(replayed.eventsView(), driver.coordination.eventsView(),
    'replay reproduces the refusal rows byte-identically');
  assert.equal(JSON.stringify(replayed.swarm(swarm.id)), JSON.stringify(driver.coordination.swarm(swarm.id)),
    'the replayed fold matches the live one');

  // The refusal kind is the runtime's own record, never a caller-submittable swarm.update event:
  // the vocabularies say so, the contract refuses the name, and the app lane refuses it before
  // dispatch — an attempt on it is refused like any other unknown update kind and records nothing.
  assert.equal(SWARM_EVENT_KINDS.includes('swarm.operation_refused'), false);
  assert.equal(SWARM_DRIVER_EVENT_KINDS.includes('swarm.operation_refused'), true);
  assert.throws(() => validateSwarmCommand('swarm.update',
    { swarmId: swarm.id, event: 'swarm.operation_refused', idempotencyKey: 'forged' }),
  { code: 'swarm_command_invalid' });
  const beforeForgery = refusalRows(driver.coordination).length;
  await assert.rejects(app.command('swarm.update',
    { swarmId: swarm.id, event: 'swarm.operation_refused', idempotencyKey: 'forged' }, principal('root')),
  { code: 'swarm_command_invalid' });
  assert.equal(refusalRows(driver.coordination).length, beforeForgery,
    'a caller cannot fabricate a refusal row');
  assert.deepEqual(refusalRows(driver.coordination).map((event) => event.payload.code).sort(),
    ['swarm_permission_required', 'work_not_found'], 'only the refusals the runtime itself made are recorded');
});
