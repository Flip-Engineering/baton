import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { swarmBridgeCommand } from '../src/swarm-native-bridge.mjs';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase64',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 8192, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
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
  schemaVersion: 1,
  repoId: 'repo-phase64',
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

const principal = (principalId) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});

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
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-app-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Swarm test'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'swarm@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = configuredAdapter({ outcome: 'completed', delayMs: 5, summary: 'Contribution ready', files: {} });
  const driver = createDriver({ repoRoot: repo, repoId: policy.repoId, logDir: join(directory, 'log'),
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000 });
  const app = new BatonApplication({ driver, repoId: policy.repoId, profiles: { standard: profile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true });
  t.after(async () => {
    await app.shutdown(principal('cleanup'));
    rmSync(directory, { force: true, recursive: true });
  });
  await app.ready;
  return { app, driver, adapter, baton: bindBaton(app, principal('orchestrator')) };
}

async function paused(driver, runId) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const worker = driver.coordinator.list().find((row) => row.runId === runId);
    if (worker && driver.coordinator.pausedTurns({ workerId: worker.id }).length) return worker;
    if (Date.now() >= deadline) throw new Error(`Participant did not remain paused: ${JSON.stringify(driver.coordinator.list())}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

test('real application supports delegated recruitment and continuing native turns through the swarm SDK', async (t) => {
  const { app, baton, driver } = await fixture(t);
  const swarm = await baton.swarms.create('Develop Baton using a living swarm', { swarmId: 'self-build' });
  assert.equal((await swarm.view()).participants.length, 1, 'a fresh swarm still answers with the synthesized root row (docs/46 §5.1)');
  await swarm.context({ key: 'design', body: 'Participants may contribute without ending their sessions.' });
  const lead = await swarm.recruit('lead', 'Coordinate implementation', { ...selection, permissions: SWARM_PERMISSIONS });
  const leadWorker = await paused(driver, lead.runId);
  // The default MockAdapter claims task completion. Swarm membership must override that protocol
  // before the very first turn, while preserving ordinary non-swarm adapter semantics.
  assert.equal(driver.coordination.task(leadWorker.taskId).status, 'paused');
  const leadClient = bindBaton(app, { actor: `worker:${leadWorker.id}`, principalId: `worker:${leadWorker.id}`, sessionId: 'lead-session' });
  const delegated = leadClient.swarms.open(swarm.id);
  const builder = await delegated.recruit('builder', 'Implement the next contribution', selection);
  const builderWorker = await paused(driver, builder.runId);
  const builderClient = bindBaton(app, { actor: `worker:${builderWorker.id}`, principalId: `worker:${builderWorker.id}`, sessionId: 'builder-session' });
  const implementation = builderClient.swarms.open(swarm.id);
  await implementation.contribute({ contributionId: 'finding', body: 'The next change can remain independent of reviewer lifetime.' });
  await assert.rejects(implementation.recruit('forbidden', 'Attempt unauthorized recruitment', selection), { code: 'swarm_permission_required' });
  const view = await swarm.view();
  assert.equal(view.participants.find((row) => row.participantId === 'builder').parentId, 'lead');
  assert.equal(view.contributions.find((row) => row.contributionId === 'finding').body, 'The next change can remain independent of reviewer lifetime.');
  await delegated.group({ groupId: 'review', members: ['lead', 'builder'] });
  await delegated.group({ groupId: 'implementation', members: ['builder'] });
  assert.equal((await swarm.view()).groups.find((row) => row.groupId === 'review').members.length, 2);
  const help = await app.command('application.help', { topic: 'swarm', depth: 'content' }, principal('orchestrator'));
  assert.ok(help.content.commands.some((usage) => usage.includes('swarm recruit')));
  await delegated.close();
  assert.equal(driver.coordination.task(builderWorker.taskId).status, 'paused', 'closing a group must not terminate participants');
});


test('native shells coordinate, recruit and contribute through scoped runtime-injected identities', async (t) => {
  const { app, baton, driver, adapter } = await fixture(t);
  const environments = new Map();
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    // Issue #309: the Baton surface rides the brief's Swarm section, not the goal text.
    assert.ok(brief.swarm?.includes('BATON_SWARM_CLIENT'));
    environments.set(worker, options.env);
    return spawn(worker, brief, options);
  };
  const swarm = await baton.swarms.create('Native participants coordinate their own collaboration', { swarmId: 'native-build' });
  const lead = await swarm.recruit('lead', 'Coordinate the next implementation', { ...selection, permissions: SWARM_PERMISSIONS });
  const leadWorker = await paused(driver, lead.runId);
  const leadEnv = environments.get(leadWorker.id);
  const native = async (env, command, args) => {
    const { stdout } = await promisify(execFile)(process.execPath,
      [env.BATON_SWARM_CLIENT, command, ...(args === undefined ? [] : [JSON.stringify(args)])], { env });
    return JSON.parse(stdout);
  };
  const leadView = await native(leadEnv, 'swarm.view');
  assert.equal(leadView.caller.participantId, 'lead');
  const builder = await native(leadEnv, 'swarm.recruit', {
    participantId: 'builder', objective: 'Build the contribution', options: selection,
  });
  const builderWorker = await paused(driver, builder.runId);
  const builderEnv = environments.get(builderWorker.id);
  assert.notEqual(builderEnv.BATON_SWARM_BRIDGE_TOKEN, leadEnv.BATON_SWARM_BRIDGE_TOKEN);
  await Promise.all([
    native(builderEnv, 'swarm.update', { event: 'swarm.contribution_recorded', payload: 'Builder finding from native tools' }),
    native(leadEnv, 'swarm.update', { event: 'swarm.context_updated', payload: { key: 'direction', body: 'Keep the reviewer available' } }),
  ]);
  const view = await swarm.view();
  const finding = Object.values(view.contributions).find((row) => row.body === 'Builder finding from native tools');
  assert.equal(finding.participantId, 'builder');
  assert.equal(view.participants.find((row) => row.participantId === 'builder').parentId, 'lead');
  const publicState = JSON.stringify({ view, logs: driver.log.read(builderWorker.id) });
  assert.equal(publicState.includes(builderEnv.BATON_SWARM_BRIDGE_TOKEN), false);
  await app.stop(builder.runId, 'Explicit participant stop revokes its native access', principal('orchestrator'));
  await assert.rejects(swarmBridgeCommand({ command: 'swarm.view', args: { swarmId: swarm.id } }, { env: builderEnv }),
    { code: 'swarm_bridge_token_invalid' });
  assert.equal((await native(leadEnv, 'swarm.view')).caller.participantId, 'lead');
});

test('an implementer captures its own live code; a reviewer checks it while a self-check refuses', async (t) => {
  const { app, baton, driver, adapter } = await fixture(t);
  let release;
  const heldTurn = new Promise((done) => { release = done; });
  const run = adapter._runSession.bind(adapter);
  adapter._runSession = async (...args) => { await heldTurn; return run(...args); };
  let environment;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => { environment = options.env; return spawn(worker, brief, options); };
  const swarm = await baton.swarms.create('Let implementers publish their own running work');
  const builder = await swarm.recruit('builder', 'Implement a contribution', selection);
  try {
    const worker = driver.coordinator.list().find((row) => row.runId === builder.runId);
    const cwd = worker.worktree;
    const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    mkdirSync(join(cwd, 'impl'), { recursive: true });
    writeFileSync(join(cwd, 'impl/live.txt'), 'staged\n');
    git(['add', 'impl/live.txt']);
    writeFileSync(join(cwd, 'impl/live.txt'), 'staged\nadditional live work\n');
    const indexPath = git(['rev-parse', '--git-path', 'index']);
    const index = readFileSync(indexPath);
    const head = git(['rev-parse', 'HEAD']);
    const native = async (command, args) => {
      const { stdout } = await promisify(execFile)(process.execPath,
        [environment.BATON_SWARM_CLIENT, command, JSON.stringify(args)], { env: environment });
      return JSON.parse(stdout);
    };
    const captured = await native('swarm.capture', { participantId: 'builder', contributionId: 'live' });
    assert.equal(git(['show', `${captured.sha}:impl/live.txt`]), 'staged\nadditional live work');
    assert.equal(git(['rev-parse', 'HEAD']), head);
    assert.deepEqual(readFileSync(indexPath), index);
    assert.equal(driver.coordinator.pausedTurns({ workerId: worker.id }).length, 0);
    // #269 item 4: reviewer independence — the contributing seat cannot check its own
    // contribution. The refusal is the command's answer (ok:false on stdout, non-zero exit)
    // and runs nothing.
    const refused = await native('swarm.check', { participantId: 'builder', contributionId: 'live', checkId: 'own-check' })
      .then(() => null, (error) => JSON.parse(error.stdout));
    assert.equal(refused?.ok, false);
    assert.equal(refused?.error?.code, 'self_check_refused');
    // A different seat checks the same capture: the verdict path is unchanged.
    const reviewer = await swarm.recruit('reviewer', 'Review the live contribution',
      { ...selection, permissions: ['read', 'review', 'communicate'] });
    const reviewerWorker = driver.coordinator.list().find((row) => row.runId === reviewer.runId);
    const reviewerClient = bindBaton(app, { actor: `worker:${reviewerWorker.id}`,
      principalId: `worker:${reviewerWorker.id}`, sessionId: 'reviewer-session' });
    const checked = await reviewerClient.swarms.open(swarm.id).check('builder', 'live', 'review-check');
    assert.equal(checked.passed, true);
    assert.equal((await swarm.view()).participants[0].runtime.turn, 'running');
    assert.deepEqual(readFileSync(indexPath), index, 'verification leaves the live staging area untouched too');
  } finally { release(); }
  await paused(driver, builder.runId);
});
