// Issue #292 — the declared coupling tells the truth (2026-09-14 audits: swarm-a finding 7 and
// "what did not" (b); swarm-b findings 5, 7, 9; tight-coupling root §2). Eight guarantees, each
// proven end to end here:
//   1. the exclusive-writer guard is never inert: the first recruit into a checkout records it,
//      and a claim over a participant with no recorded checkout is REFUSED, not recorded inert;
//   2. re-declaring a synchronization point carries its arrivals forward and says so;
//   3. releasedBy / reviewerId are the ACTOR — the member's name, or the acting principal's label
//      for an external orchestrator (the root's acts never land as null);
//   4. arrivals carry the actor and the timestamp that made them;
//   5. a member listed in `awaiting` sees the synchronization record in its own scoped view;
//   6. a retry under a spent idempotencyKey names its remedy (a new key);
//   7. the bridge tells the truth about keys (covered in swarm-native-bridge.test.mjs);
//   8. the native guidance names commands that exist.
// Fixture style: swarm-coupling.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { SWARM_COMMAND_NAMES, SWARM_EVENT_KINDS } from '../src/swarm-contract.mjs';
// #425: the guidance may name a kind the runtime records into the swarm fold (never
// caller-submittable), so the registered vocabulary includes the fold's own set.
import { SWARM_EVENT_KINDS as SWARM_FOLD_EVENT_KINDS } from '../src/swarm-state.mjs';
import { SWARM_NATIVE_GUIDANCE } from '../src/swarm-native-access.mjs';

// The view's coupling collection is an ARRAY of rows (issue #302, one collection shape).

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-coupling-truth', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
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
const capacityPolicy = Object.freeze({
  maxReservedBytes: 64 * 1024 * 1024, maxReservedInodes: 10_000,
  minFreeBytes: 1, minFreeInodes: 1, runtimeReserveBytes: 4 * 1024, runtimeReserveInodes: 4,
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'repo-coupling-truth', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-coupling-truth-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Coupling truth', GIT_COMMITTER_NAME: 'Coupling truth' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'coupling-truth@example.invalid', GIT_COMMITTER_EMAIL: 'coupling-truth@example.invalid' });
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
    worktreeCapacity: capacityPolicy,
    worktreeCapacityEstimate: () => ({ bytes: 16 * 1024, inodes: 32 }),
    worktreeCapacityObserve: () => ({ freeBytes: 1024 * 1024 * 1024, freeInodes: 1_000_000 }),
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

// A lead (every permission) with two builders in one group — the coupled subgroup the records
// below are declared over.
async function coupling(t) {
  const handle = await fixture(t);
  const { root, paused, asWorker } = handle;
  const swarm = await root.swarms.create('Coupling truth');
  const lead = await swarm.recruit('lead', 'Coordinate', { ...selection, permissions: SWARM_PERMISSIONS });
  const leadWorker = await paused(lead.runId);
  const delegated = asWorker(leadWorker).swarms.open(swarm.id);
  const alpha = await delegated.recruit('alpha', 'Build A', selection);
  const beta = await delegated.recruit('beta', 'Build B', selection);
  const alphaWorker = await paused(alpha.runId);
  const betaWorker = await paused(beta.runId);
  return { ...handle, swarm, delegated, lead, alpha, beta, leadWorker, alphaWorker, betaWorker };
}


// ── 2 and 4. re-declaring carries arrivals; an arrival carries its actor and time ───────────────


// ── 3. attribution is the ACTOR ─────────────────────────────────────────────────────────────────


test('a review is attributed to the ACTOR: the reviewing member, or the acting principal', async (t) => {
  const { swarm, delegated, root, alphaWorker, asWorker } = await coupling(t);
  await asWorker(alphaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-alpha-1', participantId: 'alpha', body: 'Part A ready',
  });

  // The root (no participant row) reviews: the row names the root's principal, never null.
  await root.swarms.open(swarm.id).review({ contributionId: 'contribution-alpha-1', decision: 'accept', reason: 'verified' });
  let view = await swarm.view();
  assert.equal(view.reviews['contribution-alpha-1'][0].reviewerId, 'direct:root');
  await delegated.review({ contributionId: 'contribution-alpha-1', decision: 'comment', reason: 'second look' });
  view = await swarm.view();
  assert.equal(view.reviews['contribution-alpha-1'][1].reviewerId, 'lead');
  // Neither may review under another identity.
  await assert.rejects(delegated.review({ contributionId: 'contribution-alpha-1', decision: 'comment', reviewerId: 'beta' }),
    { code: 'swarm_author_mismatch' });
  await assert.rejects(root.swarms.open(swarm.id).review({ contributionId: 'contribution-alpha-1', decision: 'comment', reviewerId: 'lead' }),
    { code: 'swarm_author_mismatch' }, 'an orchestrator cannot review under a member\'s name');
  assert.equal((await swarm.view()).reviews['contribution-alpha-1'].length, 2, 'the refused reviews recorded nothing');
});

// ── 5. a member listed in awaiting sees the record ───────────────────────────────────────────────


// ── 6. a spent key names its remedy ─────────────────────────────────────────────────────────────

test('a retry under the same idempotencyKey names the remedy: a NEW attempt needs a NEW key', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-coupling-retry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  let failures = 1;
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers, pausedTurns: () => [],
      guideParticipant: async () => {
        if (failures > 0) { failures -= 1; throw Object.assign(new Error('the lane was unavailable'), { code: 'lane_unavailable' }); }
        return { ok: true };
      },
    },
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working' });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  await runtime.command('swarm.create', { purpose: 'retry', swarmId: 'sw-1', idempotencyKey: 'create' }, owner);
  await runtime.command('swarm.recruit', { swarmId: 'sw-1', participantId: 'builder', objective: 'build', idempotencyKey: 'recruit' }, owner);
  const guide = { swarmId: 'sw-1', participantId: 'builder', message: 'continue', idempotencyKey: 'guide-1' };
  await assert.rejects(runtime.command('swarm.guide', guide, owner), { code: 'lane_unavailable' });
  // The guide lane is not replay-safe: the SAME key refuses, and the refusal names the remedy.
  await assert.rejects(runtime.command('swarm.guide', guide, owner),
    (error) => error.code === 'swarm_operation_unconfirmed'
      && /NEW idempotencyKey/u.test(error.message)
      && /swarm\.recruit and swarm\.holder_released/u.test(error.message),
    'the refusal says what replays and that a new attempt needs a new key');
  // A NEW key is the remedy the refusal named.
  const delivered = await runtime.command('swarm.guide', { ...guide, idempotencyKey: 'guide-2' }, owner);
  assert.equal(delivered.result.ok, true);
});

// ── 8. the guidance names commands that exist ───────────────────────────────────────────────────

test('the native guidance names only commands that exist', () => {
  // Every `swarm.…` token the guidance teaches is a registered command or a registered update
  // event: the guidance shipped to every native participant must not name a verb that is not.
  const known = new Set([...SWARM_COMMAND_NAMES, ...SWARM_EVENT_KINDS, ...SWARM_FOLD_EVENT_KINDS]);
  for (const name of SWARM_NATIVE_GUIDANCE.match(/\bswarm\.[a-z_]+/gu) ?? []) {
    assert.ok(known.has(name), `${name} is a registered command or event kind`);
  }
  assert.doesNotMatch(SWARM_NATIVE_GUIDANCE, /\binspect\b/u,
    'the guidance never points at a verb the command registry does not carry');
  assert.match(SWARM_NATIVE_GUIDANCE, /shown by swarm\.view/u);
  assert.match(SWARM_NATIVE_GUIDANCE, /a NEW attempt needs a NEW key/u,
    'the guidance tells the same retry truth the bridge help does');
});
