// The swarm slice's red-first rows (2026-09-14 audit S-G2/S-N1): the swarm runtime's known gaps
// belong in this manifest like every other known gap, because the canonical gate must be able to
// say "we know this is broken" about the swarm too — its equivalent knowledge otherwise lives only
// in issues and audit documents, where a GREEN verdict says nothing about it.
//
// Each row pins the contract one audit item names, and each fails today for a NAMED stage. When a
// row goes green the verdict refuses it as a stale expectation, so the row is removed with the
// fix, never left to rot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-gap', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
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
  schemaVersion: 1, repoId: 'repo-swarm-gap', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-gap-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Swarm gap'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'swarm-gap@example.invalid'], { cwd: repo });
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

test('S-E6 RED (stage: attention-request-leak): an unconfirmed operation row never projects the request body across the scope boundary', async (t) => {
  const { driver, root, paused, asWorker } = await fixture(t);
  const swarm = await root.swarms.create('attention leak');
  const reader = await swarm.recruit('reader', 'Read only', { ...selection, permissions: ['read'] });
  const readerWorker = await paused(reader.runId);
  const readerHandle = asWorker(readerWorker).swarms.open(swarm.id);
  // One operation is parked in flight for another participant: the organizer holds it as an
  // in-flight (unconfirmed) row whose request body is private to the caller that sent it.
  const secret = 'private-objective-text-7f3a';
  driver.coordination.recordDriver('swarm.operation_requested', {
    swarmId: swarm.id, command: 'swarm.guide', requestDigest: 'a'.repeat(64),
    request: { swarmId: swarm.id, participantId: 'reader', message: secret, idempotencyKey: 'gap-op-1' }, basis: null,
  }, { actor: 'direct:root', key: 'gap-op-1' });
  const view = await readerHandle.view();
  const parked = view.attention.filter((row) => row.kind === 'operation_unconfirmed');
  assert.ok(parked.length > 0, 'the in-flight operation is visible as attention');
  for (const row of parked) {
    assert.equal(Object.hasOwn(row, 'request'), false,
      'an operation row must never carry the request body into another participant’s view');
    assert.equal(JSON.stringify(row).includes(secret), false, 'the request text must not cross the scope boundary');
  }
});

test('S-G5 RED (stage: scoped-view-context-unscoped): a scoped view projects only the context its subtree owns', async (t) => {
  const { root, paused, asWorker } = await fixture(t);
  const swarm = await root.swarms.create('context scope');
  const reader = await swarm.recruit('reader', 'Read only', { ...selection, permissions: ['read'] });
  const author = await swarm.recruit('author', 'Author', { ...selection, permissions: SWARM_PERMISSIONS });
  const readerHandle = asWorker(await paused(reader.runId)).swarms.open(swarm.id);
  const authorHandle = asWorker(await paused(author.runId)).swarms.open(swarm.id);
  await authorHandle.context({ key: 'author-only', body: { secret: 'A' } });
  const scoped = await readerHandle.view();
  assert.deepEqual(Object.keys(scoped.context ?? {}), [],
    'a read-only participant’s view must not project a sibling’s context entry');
});

test('S-G11 RED (stage: contribution-unbound): a plain-text contribution binds what it names', async (t) => {
  const { root, paused, asWorker } = await fixture(t);
  const swarm = await root.swarms.create('contribution binding');
  const author = await swarm.recruit('author', 'Author', { ...selection, permissions: SWARM_PERMISSIONS });
  const authorHandle = asWorker(await paused(author.runId)).swarms.open(swarm.id);
  const body = 'finding: impl/test/swarm-gap-fixture-artifact.txt changed after this was accepted';
  const recorded = await authorHandle.contribute(body);
  const contribution = (await swarm.view()).contributions[0];
  assert.ok(contribution, 'the contribution is recorded');
  // The recorded row must bind the body it stores (so a later edit of what it names is detectable)
  // or carry the capture's revision binding — never store an unbound string with `refs: null`.
  const digest = contribution.bodyDigest ?? contribution.digest ?? null;
  assert.ok(typeof digest === 'string' && /^[0-9a-f]{64}$/u.test(digest),
    'a recorded contribution carries the digest of the text it stores');
  assert.notEqual(contribution.refs ?? null, null,
    'a recorded contribution names the artifact revision it observed, or refuses the unbound record');
});
