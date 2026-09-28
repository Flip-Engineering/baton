// Issue #630: swarm-visual-20260925 recruitment refused ordinary contribution prose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-issue630',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-issue630',
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

const ROUTE = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });
const OWNER = Object.freeze({ actor: 'direct:orchestrator', principalId: 'orchestrator', sessionId: 'orchestrator-session' });
const principal = (principalId) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});

const selection = { exact: { ...ROUTE }, scope: ['impl/**'] };

function configuredAdapter(scenario) {
  const adapter = new MockAdapter({ harness: 'mock', scenario });
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

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue630-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 630 test', GIT_COMMITTER_NAME: 'Issue 630 test' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue630@example.invalid', GIT_COMMITTER_EMAIL: 'issue630@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = configuredAdapter({ outcome: 'completed', delayMs: 5, summary: 'Contribution ready', files: {} });
  const driver = createDriver({ repoRoot: repo, repoId: policy.repoId, logDir: join(directory, 'log'),
    deploymentBaseSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000 });
  const app = new BatonApplication({ driver, repoId: policy.repoId, profiles: { standard: profile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true });
  t.after(async () => {
    await app.shutdown(principal('cleanup'));
    rmSync(directory, { force: true, recursive: true });
  });
  await app.ready;
  return { app, driver, adapter, runtime: app._swarmRuntime() };
}

test('#630: composed contribution prose admits a recruit', async (t) => {
  const { driver, runtime } = await fixture(t);
  let key = 0;
  const call = (command, args) => runtime.command(`swarm.${command}`,
    { swarmId: 'visual', idempotencyKey: `request-${++key}`, ...args }, OWNER);
  await call('create', { purpose: 'Recruitment with contribution prose' });
  await call('recruit', { participantId: 'author', objective: 'Write the contribution', options: selection });
  const author = driver.coordination.swarm('visual').participants.author;
  await runtime.command('swarm.update', { swarmId: 'visual', event: 'swarm.contribution_recorded',
    idempotencyKey: 'contribution', payload: { body: {
      subject: 'Run action removal', base: { observedHead: 'a'.repeat(40), rebasedOnto: 'a'.repeat(40) },
      commit: null, items: [{ id: 'run-action', status: 'delivered', change: 'Remove run action', files: [], test: 'targeted', evidence: 'passed' }], verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
      carriedForward: ['Dedicated command authorization: phase64-integrated-run-application.test.mjs'], needsFromOthers: [],
    } },
  }, { actor: `worker:${author.bindings[0].workerId}`, principalId: `worker:${author.bindings[0].workerId}`, sessionId: 'author' });
  for (const [participantId, extra] of [['fresh', {}], ['successor', { resumeFrom: 'author' }]]) {
    await call('recruit', { participantId, objective: 'Continue the work', options: selection, ...extra });
    const seat = driver.coordination.swarm('visual').participants[participantId];
    assert.equal(seat.status, 'active');
    assert.equal(seat.bindings.length, 1);
  }
});

test('#630: a start refusal before goal creation settles the joined seat', async (t) => {
  const { driver, runtime } = await fixture(t);
  await runtime.command('swarm.create', { swarmId: 'refusal', purpose: 'Refused recruitment', idempotencyKey: 'create' }, OWNER);
  const startRun = runtime.startRun;
  runtime.startRun = (request, ...args) => startRun({ ...request, objective: '\0' }, ...args);
  await assert.rejects(runtime.command('swarm.recruit', {
    swarmId: 'refusal', participantId: 'successor', objective: 'Continue', options: selection, idempotencyKey: 'refuse',
  }, OWNER), error => error.code === 'application_client_invalid');
  const seat = driver.coordination.swarm('refusal').participants.successor;
  assert.equal(seat.status, 'left');
  assert.equal(seat.leftReason, 'recruit_refused');
  assert.equal(seat.bindings.length, 0);
  assert.equal(driver.coordinator.list().some(worker => worker.runId === seat.runId), false);
  runtime.startRun = startRun;
  await runtime.command('swarm.recruit', {
    swarmId: 'refusal', participantId: 'successor', objective: 'Continue', options: selection, idempotencyKey: 'retry',
  }, OWNER);
  const retried = driver.coordination.swarm('refusal').participants.successor;
  assert.equal(retried.status, 'active');
  assert.equal(retried.bindings.length, 1);
  assert.notEqual(retried.runId, seat.runId);
});
