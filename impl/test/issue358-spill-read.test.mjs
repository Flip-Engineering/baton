// Issue #358 (the remainder): a body a lane spilled must be readable by the seat the marker
// addresses, and every receipt that names a spill must name it at once.
//
//   (a) a 16 KB recruit objective reaches the fixture worker's brief whole — acceptance item 1
//       (the objective lanes bounded only by the substrate row) already landed; this row pins it
//       end to end through a real application, worker binding and lifecycle.spawned brief;
//   (b) a spilled message body is readable through `run.spill.read {spillId}` by the addressed
//       seat, and the `[SPILLED …]` marker the seat receives names that verb (`read`), so the
//       marker is a citation the seat can follow;
//   (c) the recruit receipt names the objective's spill facts (`objective: {bytes, spilled,
//       spill}`) — spilled: false while the brief rode whole, and the runtime passes a spawn's
//       spilled: true report through to the recruiter verbatim.
//
// Two fixtures, both taken from the suites this file sits beside: the light SwarmRuntime harness
// of issue441b-seat-read-verbs.test.mjs (real coordination store, coordinator double, real bridge)
// for the seat-side reads, and the real-application harness of swarm-application.test.mjs
// (BatonApplication over a driver with a MockAdapter) for the recruit path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program-policy.mjs';
import { createSwarmNativeBridge, swarmBridgeCommand } from '../src/swarm-native-bridge.mjs';
import { SWARM_PERMISSIONS, SwarmRuntime } from '../src/swarm-runtime.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const digestOf = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

// ── the light harness (issue441b pattern): real store, coordinator double, real bridge ──────────

const SWARM_ID = 'swarm-358';
const owner = Object.freeze({ actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });
const workerPrincipal = (workerId) => Object.freeze({
  actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: `${workerId}-session`,
});

async function lightFixture(t, label, { startRun } = {}) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue358-${label}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(join(directory, 'coordination'), {
    repoId: 'repo-issue358', deploymentBaseSha: '1'.repeat(40),
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: '2'.repeat(64), contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: () => { throw Object.assign(
      new Error('context package content is unavailable'), { code: 'context_artifact_unavailable' }); },
    contextSourceAttest: () => { throw new Error('the spill read never attests a source'); },
    clock: () => '2026-09-24T00:00:00.000Z',
  });
  const workers = [];
  const frames = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    // The one delivery lane a recruited seat's mid-turn guidance takes: record the frame so a row
    // can assert the exact [SPILLED …] marker the seat was handed.
    guideParticipant: async (workerId, frame) => {
      frames.push({ workerId, frame });
      return { ok: true };
    },
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {},
    prepareRun: async (request) => ({ ...request,
      route: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] }),
    startRun: startRun ?? (async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: true,
        sessionContext: { worktree: directory, repoRoot: directory } });
    }),
    stopRun: async (runId) => {
      const worker = workers.find((row) => row.runId === runId);
      if (worker) worker.status = 'dead';
      return { state: 'closed' };
    },
  });
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal, context }) => runtime.command(command, args, principal, context),
  });
  t.after(() => bridge.close());
  const command = (name, args, caller = owner) => runtime.command(name, args, caller);
  const bridgeFor = async (participantId, runId) => {
    const issued = await bridge.issue({ swarmId: SWARM_ID, participantId, runId });
    return (name, args = {}) => swarmBridgeCommand({ command: name, args }, { env: issued.env });
  };
  return { store, runtime, bridge, command, bridgeFor, workers, frames };
}

// ── the real-application harness (swarm-application.test.mjs pattern) ───────────────────────────

const appPolicy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-issue358-app',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    // The goal-plan text bound IS the objective lane (issue #362): a 16 KB brief must admit.
    maxTextBytes: FRAME_LIMITS['run.objective'].value, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 256 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const appVerification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

const appProfile = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-issue358-app',
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification: appVerification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const appPrincipal = (principalId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
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

async function appFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue358-app-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 358', GIT_COMMITTER_NAME: 'Issue 358' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue358@example.invalid', GIT_COMMITTER_EMAIL: 'issue358@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = configuredAdapter({ outcome: 'completed', delayMs: 5, summary: 'Contribution ready', files: {} });
  const driver = createDriver({ repoRoot: repo, repoId: appPolicy.repoId, logDir: join(directory, 'log'),
    adapters: { mock: adapter },
    goalPlanAuthority: { policy: appPolicy, authorize: async () => true }, stopDeadlineMs: 2000 });
  const app = new BatonApplication({ driver, repoId: appPolicy.repoId, profiles: { standard: appProfile },
    principals: { planner: appPrincipal('planner'), dispatcher: appPrincipal('dispatcher'),
      observer: appPrincipal('observer') },
    authorize: async () => true });
  t.after(async () => {
    await app.shutdown(appPrincipal('cleanup'));
    rmSync(directory, { force: true, recursive: true });
  });
  await app.ready;
  const spawnedBriefs = [];
  const prompt = adapter.prompt.bind(adapter);
  adapter.prompt = (worker, content, mode) => {
    if (mode === 'nudge') spawnedBriefs.push({ worker, content });
    return prompt(worker, content, mode);
  };
  return { app, driver, adapter, baton: bindBaton(app, appPrincipal('orchestrator')), spawnedBriefs };
}

async function paused(driver, runId) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const worker = driver.coordinator.list().find((row) => row.runId === runId);
    if (worker && driver.coordinator.pausedTurns({ workerId: worker.id }).length) return worker;
    if (Date.now() >= deadline) {
      throw new Error(`Participant did not remain paused: ${JSON.stringify(driver.coordinator.list())}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const spawnedBrief = (driver, workerId) => driver.log.read(workerId)
  .find((row) => row.kind === 'lifecycle.spawned')?.payload?.brief ?? null;

// A 16 KB objective whose LAST paragraph is the tail a head cap would have cut off — exactly the
// shape the incident's seats lost: the verification contract at the end of the brief.
const OBJECTIVE_TAIL = 'VERIFY: node --test test/issue358-spill-read.test.mjs — never the full suite';
const sixteenKbObjective = () => {
  const paragraphs = [];
  let bytes = 0;
  while (bytes < 16 * 1024) {
    const line = `Paragraph ${paragraphs.length}: the lane brief a seat reads whole, up to the spill substrate.\n`;
    paragraphs.push(line);
    bytes += Buffer.byteLength(line);
  }
  paragraphs.push(OBJECTIVE_TAIL);
  return paragraphs.join('\n');
};

const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

test('#358 (a): a 16 KB recruit objective reaches the fixture worker\'s brief whole', async (t) => {
  const { baton, driver } = await appFixture(t);
  const objective = sixteenKbObjective();
  const swarm = await baton.swarms.create('Briefs ride whole up to the substrate', { swarmId: 'brief-358' });
  const recruit = await swarm.recruit('worker', objective, { ...selection, permissions: SWARM_PERMISSIONS });
  const worker = await paused(driver, recruit.runId);
  const brief = spawnedBrief(driver, worker.id);
  assert.ok(brief, 'the worker binding carries a lifecycle.spawned brief');
  const goal = brief.goal;
  // The composed brief opens with the recruiter's objective and carries it VERBATIM — a 4 KB
  // head cap would have cut the tail paragraph off and left a [SPILLED …] citation behind.
  assert.ok(goal.startsWith(objective), 'the objective rides the brief whole, from head to tail');
  // The citation a spill leaves is a line of its own: `\n[SPILLED {…}]`. The brief's Swarm
  // section NAMES the marker when it teaches the read verb — only a real citation means text
  // was cut.
  assert.ok(!goal.includes('\n[SPILLED {'), 'no spill citation: nothing was cut off');
});

test('#358 (b): a spilled message body is readable through run.spill.read by the addressed seat, and the marker names the verb', async (t) => {
  const f = await lightFixture(t, 'read');
  await f.command('swarm.create', { swarmId: SWARM_ID, purpose: 'Read what a marker cut off', idempotencyKey: 'create' });
  await f.command('swarm.recruit', { swarmId: SWARM_ID, participantId: 'alpha', objective: 'Read the spill',
    permissions: ['read', 'communicate', 'contribute', 'review'], idempotencyKey: 'recruit-alpha' });
  const swarm = f.store.swarm(SWARM_ID);
  const alpha = await f.bridgeFor('alpha', swarm.participants.alpha.runId);

  const body = `${'peer message body. '.repeat(400)}SPILL-TAIL-SENTINEL`;
  assert.ok(Buffer.byteLength(body) > FRAME_LIMITS['swarm.notify.body'].value, 'the body crosses the lane cap and spills');
  const sent = await f.command('swarm.notify', { swarmId: SWARM_ID, participantId: 'alpha',
    message: body, idempotencyKey: 'notify-1' });
  // The sender's receipt names the spill at once: head inline, full body durable.
  assert.equal(sent.notify.state, 'delivered');
  const spillId = sent.notify.spill;
  assert.match(spillId, /^spill:sha256:[a-f0-9]{64}$/u);
  assert.ok(Buffer.byteLength(sent.notify.body) < Buffer.byteLength(body), 'the inline body is the bounded head');

  // The marker the seat received names the ONE verb that resolves it.
  const delivered = f.frames.find((row) => row.workerId !== null && row.frame.includes('[SPILLED'));
  assert.ok(delivered, 'the delivered frame carries the spill citation');
  const citation = JSON.parse(delivered.frame.slice(
    delivered.frame.indexOf('[SPILLED ') + '[SPILLED '.length,
    delivered.frame.lastIndexOf(']'),
  ));
  assert.equal(citation.spill, spillId);
  assert.equal(citation.read, 'run.spill.read', 'the marker names the verb a seat can follow');
  assert.ok(!delivered.frame.includes('SPILL-TAIL-SENTINEL'), 'the frame carries the head, never the full body');

  // The addressed seat reads the spill whole through the bridge.
  const read = await alpha('run.spill.read', { spillId });
  assert.equal(read.swarmId, SWARM_ID);
  assert.equal(read.spillId, spillId);
  assert.equal(read.digest, digestOf(body));
  assert.equal(read.bytes, Buffer.byteLength(body));
  assert.equal(read.body, body);

  // A spill id the deployment does not hold refuses typed, and the refusal teaches the fix.
  await assert.rejects(alpha('run.spill.read', { spillId: `spill:sha256:${'f'.repeat(64)}` }),
    (error) => error.code === 'swarm_spill_not_found'
      && /spill:sha256:/u.test(error.detail?.spillId ?? ''));
});

test('#358 (c): the recruit receipt names the objective\'s spill facts', async (t) => {
  const { baton, driver } = await appFixture(t);
  const objective = sixteenKbObjective();
  const swarm = await baton.swarms.create('The recruiter learns the spill at once', { swarmId: 'receipt-358' });
  const recruit = await swarm.recruit('worker', objective, { ...selection, permissions: SWARM_PERMISSIONS });
  const worker = await paused(driver, recruit.runId);
  const goal = spawnedBrief(driver, worker.id).goal;
  assert.deepEqual(recruit.objective, {
    bytes: Buffer.byteLength(goal), spilled: false, spill: null,
  });
});

test('#358 (c2): a spawn that reports its objective spilled passes the report to the recruiter verbatim', async (t) => {
  // The startRun seam receives the COMPOSED brief (objective + swarm situation), so the stub
  // reports the facts for exactly what it was handed, and the row asserts the verbatim pass-through.
  const reported = {};
  const f = await lightFixture(t, 'receipt', { startRun: async (request) => {
    if (f.workers.some((row) => row.runId === request.runId)) return;
    const minted = f.store.mintSpill({ body: request.objective, lane: 'run.objective' },
      { actor: 'owner', key: `run.objective.spill:${digestOf(request.objective)}` });
    f.workers.push({ id: `w-${f.workers.length + 1}`, taskId: `t-${f.workers.length + 1}`,
      runId: request.runId, status: 'working', paused: true,
      sessionContext: { worktree: 'unused', repoRoot: 'unused' } });
    reported.objective = {
      bytes: Buffer.byteLength(request.objective), spilled: true, spill: minted.spill.spillId,
    };
    return { objective: reported.objective };
  } });
  await f.command('swarm.create', { swarmId: SWARM_ID, purpose: 'Name the spill on the receipt', idempotencyKey: 'create' });
  const objective = sixteenKbObjective();
  const recruit = await f.command('swarm.recruit', { swarmId: SWARM_ID, participantId: 'alpha',
    objective, permissions: ['read', 'communicate', 'contribute'], idempotencyKey: 'recruit-alpha' });
  assert.ok(reported.objective, 'the composed brief crossed the objective lane and spilled');
  assert.deepEqual(recruit.objective, reported.objective);
});

test('#358 (e): run.spill.read refuses a bad shape typed, before any runtime effect', async (t) => {
  const f = await lightFixture(t, 'shape');
  await f.command('swarm.create', { swarmId: SWARM_ID, purpose: 'Admit the read shape', idempotencyKey: 'create' });
  await f.command('swarm.recruit', { swarmId: SWARM_ID, participantId: 'alpha', objective: 'Read',
    permissions: ['read', 'communicate', 'contribute'], idempotencyKey: 'recruit-alpha' });
  const swarm = f.store.swarm(SWARM_ID);
  const alpha = await f.bridgeFor('alpha', swarm.participants.alpha.runId);
  // The required field is named, with its description, in one refusal.
  await assert.rejects(alpha('run.spill.read', {}),
    (error) => error.code === 'swarm_command_invalid' && error.detail?.rule === 'required-field');
  // The spill id is a closed shape: the marker's own spelling.
  await assert.rejects(alpha('run.spill.read', { spillId: 'not-a-spill-id' }),
    (error) => error.code === 'swarm_command_invalid' && error.detail?.rule === 'field-predicate');
  // The run identity is never caller-supplied.
  await assert.rejects(alpha('run.spill.read', { runId: 'run-forged' }),
    (error) => error.detail?.rule === 'identity-field');
});
