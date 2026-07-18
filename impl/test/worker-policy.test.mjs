import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_WORKER_POLICY_REQUEST, attestWorkerPolicyObservation, compareWorkerPolicyObservation,
  createWorkerPolicyObservation,
  normalizeWorkerPolicyCard, normalizeWorkerPolicyObservation, normalizeWorkerPolicyRequest,
  resolveWorkerPolicy, workerPolicyObservationRequired, workerPolicyRequestDigest,
} from '../src/index.mjs';
import { ClaudeCli, CodexCli, PiCli, ZCodeCli } from '../src/cli-adapters.mjs';
import { Coordinator, WorkerPolicySelectionError } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import {
  buildAuthoritativeBrief, goalPlanDigest, normalizeGoalPlanPolicy, normalizeGoalRequest,
  normalizePlanRequest,
} from '../src/goal-plan.mjs';
import { Log } from '../src/log.mjs';
import { processClosedPayload, processStartedPayload } from '../src/process-lifecycle.mjs';

const card = (overrides = {}) => ({
  schemaVersion: 1,
  autonomy: {
    supported: ['unattended', 'interactive'], default: 'unattended', perTask: true,
    observation: 'launch', mechanisms: ['approval-policy-never'],
    ...overrides.autonomy,
  },
  access: {
    supported: ['full', 'workspace'], default: 'full', perTask: true,
    observation: 'launch', mechanisms: ['host-full-permissions'],
    ...overrides.access,
  },
  containment: {
    hostProcess: 'same_uid', guarantees: ['private_runtime'],
    configuredPreferences: ['harness-workspace-policy'], observation: 'unavailable',
    ...overrides.containment,
  },
});

test('WP1: default worker policy means unattended autonomy without fabricating containment', () => {
  assert.deepEqual(normalizeWorkerPolicyRequest(), DEFAULT_WORKER_POLICY_REQUEST);
  assert.deepEqual(DEFAULT_WORKER_POLICY_REQUEST, {
    schemaVersion: 1,
    autonomy: { mode: 'unattended' },
    access: { mode: 'full' },
    containment: { mode: 'workspace_preferred', minimum: 'private_runtime' },
  });
  assert.match(workerPolicyRequestDigest(DEFAULT_WORKER_POLICY_REQUEST), /^[a-f0-9]{64}$/u);
});

test('WP2: request and card schemas are closed, deterministic, and path/credential free', () => {
  assert.throws(() => normalizeWorkerPolicyRequest({
    ...DEFAULT_WORKER_POLICY_REQUEST, token: 'forbidden',
  }), (error) => error.code === 'worker_policy_invalid');
  assert.throws(() => normalizeWorkerPolicyCard(card({
    containment: { configuredPreferences: ['/private/host/path'] },
  })), (error) => error.code === 'worker_policy_invalid');
  const first = resolveWorkerPolicy(DEFAULT_WORKER_POLICY_REQUEST, card());
  const second = resolveWorkerPolicy(structuredClone(DEFAULT_WORKER_POLICY_REQUEST), card());
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes('/private/'), false);
  assert.equal(JSON.stringify(first).toLowerCase().includes('token'), false);
  assert.equal(Object.isFrozen(first.autonomy), true);
  assert.equal(Object.isFrozen(first.autonomy.mechanisms), true);
  assert.equal(Object.isFrozen(first.access), true);
  assert.equal(Object.isFrozen(first.containment), true);
  assert.equal(Object.isFrozen(first.containment.requested), true);
  assert.equal(Object.isFrozen(first.containment.guarantees), true);
});

test('WP3: preferred workspace reports an honest gap while required guarantees fail closed', () => {
  const preferred = resolveWorkerPolicy(DEFAULT_WORKER_POLICY_REQUEST, card());
  assert.equal(preferred.autonomy.resolved, 'unattended');
  assert.equal(preferred.access.resolved, 'full');
  assert.equal(preferred.containment.resolved, 'private_runtime_only');
  assert.equal(preferred.containment.hostProcess, 'same_uid');
  assert.equal(preferred.containment.attestation, 'preferred_gap');
  assert.match(preferred.resolutionDigest, /^[a-f0-9]{64}$/u);

  assert.throws(() => resolveWorkerPolicy({
    schemaVersion: 1, autonomy: { mode: 'unattended' },
    access: { mode: 'full' },
    containment: { mode: 'workspace_required', minimum: 'tool_workspace' },
  }, card()), (error) => error.code === 'worker_policy_containment_unavailable');
  assert.throws(() => resolveWorkerPolicy({
    schemaVersion: 1, autonomy: { mode: 'unattended' },
    access: { mode: 'full' },
    containment: { mode: 'external_required', minimum: 'external' },
  }, card()), (error) => error.code === 'worker_policy_containment_unavailable');
});

test('WP4: verified external containment and provider-observed autonomy remain distinct facts', () => {
  const resolution = resolveWorkerPolicy({
    schemaVersion: 1, autonomy: { mode: 'unattended' },
    access: { mode: 'full' },
    containment: { mode: 'external_required', minimum: 'external' },
  }, card({
    autonomy: { observation: 'provider', mechanisms: ['acp-mode-yolo'] },
    containment: {
      hostProcess: 'external', guarantees: ['private_runtime', 'tool_workspace', 'external'],
      configuredPreferences: ['external-boundary'], observation: 'runtime_probe',
    },
  }));
  assert.equal(resolution.autonomy.observation, 'provider');
  assert.equal(resolution.containment.resolved, 'external');
  assert.equal(resolution.containment.attestation, 'satisfied');
});

test('WP4b: observation receipts are closed, content-addressed, and compared axis by axis', () => {
  const resolution = resolveWorkerPolicy(DEFAULT_WORKER_POLICY_REQUEST, card());
  assert.equal(workerPolicyObservationRequired(resolution), true);
  const observation = createWorkerPolicyObservation(resolution, {
    autonomy: 'unattended', access: 'full',
  });
  assert.deepEqual(compareWorkerPolicyObservation(resolution, observation), []);
  assert.equal(observation.containment.observed, null);
  assert.match(observation.observationDigest, /^[a-f0-9]{64}$/u);

  const wrong = createWorkerPolicyObservation(resolution, {
    autonomy: 'interactive', access: 'workspace',
  });
  assert.deepEqual(compareWorkerPolicyObservation(resolution, wrong).map((item) => item.axis), [
    'autonomy', 'access',
  ]);
  assert.throws(() => normalizeWorkerPolicyObservation({ ...observation, extra: true }),
    (error) => error.code === 'worker_policy_observation_invalid');
  assert.throws(() => createWorkerPolicyObservation(resolution, { autonomy: 'unattended' }),
    (error) => error.code === 'worker_policy_observation_invalid');
  assert.throws(() => attestWorkerPolicyObservation(resolution, {
    autonomy: 'interactive', access: 'full',
  }), (error) => error.code === 'worker_policy_observation_mismatch');
});

test('WP5: unsupported autonomy refuses before launch instead of falling back', () => {
  assert.throws(() => resolveWorkerPolicy({
    schemaVersion: 1, autonomy: { mode: 'interactive' },
    access: { mode: 'full' },
    containment: { mode: 'workspace_preferred', minimum: 'private_runtime' },
  }, card({ autonomy: { supported: ['unattended'], default: 'unattended', perTask: false } })),
  (error) => error.code === 'worker_policy_autonomy_unavailable');
});

test('WP5: full access is an explicit default and never inferred from unattended autonomy', () => {
  assert.throws(() => resolveWorkerPolicy({
    schemaVersion: 1, autonomy: { mode: 'unattended' }, access: { mode: 'full' },
    containment: { mode: 'workspace_preferred', minimum: 'private_runtime' },
  }, card({ access: { supported: ['workspace'], default: 'workspace', mechanisms: ['workspace-only'] } })),
  (error) => error.code === 'worker_policy_access_unavailable');
});

test('WP6: one-shot adapter cards expose a normalized policy without claiming containment', () => {
  for (const adapter of [new CodexCli(), new ClaudeCli(), new ZCodeCli(), new PiCli()]) {
    const policy = normalizeWorkerPolicyCard(adapter.card().workerPolicy);
    assert.deepEqual(policy.containment.guarantees, ['private_runtime']);
    assert.equal(policy.containment.hostProcess, 'same_uid');
    assert.equal(policy.access.default, 'full');
  }
  assert.equal(new CodexCli().card().workerPolicy.autonomy.default, 'unattended');
  assert.equal(new ClaudeCli().card().workerPolicy.autonomy.default, 'unattended');
});

const planPolicy = normalizeGoalPlanPolicy({
  schemaVersion: 1, repoId: 'repo-worker-policy', mandatory: true, approvalTtlMs: 60_000,
  riskClasses: ['low'], effectClasses: ['repository_edit'], capabilityClasses: ['code'],
  limits: {
    maxGoalVersions: 4, maxPlanVersions: 4, maxNodes: 4, maxDepsPerNode: 4,
    maxTextBytes: 4_096, maxItems: 16, maxScopePaths: 16, maxRouteValues: 16,
    maxGoalBytes: 65_536, maxPlanBytes: 262_144, maxStatusBytes: 262_144,
    maxTokens: 100_000, maxUsd: 10, maxWallMin: 60, maxProviderTurns: 64,
  },
});

function planWithWorkerPolicy(workerPolicy = DEFAULT_WORKER_POLICY_REQUEST) {
  const budget = { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 4 };
  const goal = {
    ...normalizeGoalRequest({
      objective: 'Bind worker policy', definitionOfDone: ['policy bound'], constraints: [],
      risk: 'low', budget, predecessor: null,
    }, planPolicy),
    goalId: `goal:${'a'.repeat(64)}`, version: 1, digest: 'b'.repeat(64),
  };
  const plan = normalizePlanRequest({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'work', objective: 'Bind worker policy', definitionOfDone: ['policy bound'], deps: [],
      pathScope: ['impl/**'], risk: 'low', budget,
      verification: {
        command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
        expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 65_536,
        requiredPredecessorEvidence: [],
      },
      routes: { harnesses: ['stub'], models: ['stub-model'], efforts: ['high'] },
      capabilities: ['code'], effects: ['repository_edit'], workerPolicy,
    }],
  }, planPolicy, goal);
  return { goal, plan };
}

test('WP7: Plan and authoritative Brief content-address the exact full-access worker request', () => {
  const { goal, plan } = planWithWorkerPolicy();
  assert.deepEqual(plan.nodes[0].workerPolicy, DEFAULT_WORKER_POLICY_REQUEST);
  const binding = { goalId: goal.goalId, planId: 'plan', nodeKey: 'work' };
  const brief = buildAuthoritativeBrief(goal, plan, plan.nodes[0], binding);
  assert.deepEqual(brief.workerPolicy, DEFAULT_WORKER_POLICY_REQUEST);
  assert.notEqual(
    goalPlanDigest(plan),
    goalPlanDigest(planWithWorkerPolicy({
      ...DEFAULT_WORKER_POLICY_REQUEST, access: { mode: 'workspace' },
    }).plan),
  );
});

function coordinatorForPolicy(workerPolicy, calls = []) {
  const adapter = {
    onEvent() {},
    card: () => ({
      harness: 'stub', version: '1', concurrencyCeiling: 1, maxContext: 1_000,
      modelSelection: {
        mode: 'exact', configuredDefault: 'stub-model', available: ['stub-model'], family: 'stub',
        acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
        provenance: 'test', refreshedAt: null,
      },
      workerPolicy,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
    }),
    async spawn(worker, _brief, opts) { calls.push({ worker, opts }); return { ok: true }; },
    async prompt() { return { ok: true }; }, async interrupt() { return { ok: true }; },
    async approve() { return { ok: true }; }, async answer() { return { ok: true }; }, async kill() { return { ok: true }; },
  };
  const log = new Log(mkdtempSync(join(tmpdir(), 'baton-worker-policy-log-')));
  return new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(), adapters: { stub: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/${taskId}` }), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub',
    approvalTimeoutMs: 1_000, stopDeadlineMs: 100,
  });
}

function directBrief(workerPolicy = DEFAULT_WORKER_POLICY_REQUEST) {
  return {
    goal: 'Bind worker policy', constraints: [], pathScope: ['**'], definitionOfDone: 'done',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1_000, usd: 1, wallMin: 1 }, workerPolicy,
  };
}

test('WP8: coordinator resolves policy before allocation, passes only the resolution, and keys learning by it', async () => {
  const calls = [];
  const coordinator = coordinatorForPolicy(card(), calls);
  const handle = await coordinator.spawn('stub', directBrief(), {
    taskId: 'policy-bound', model: 'stub-model', effort: 'high',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.workerPolicy.access.resolved, 'full');
  assert.equal(calls[0].opts.workerPolicy.containment.attestation, 'preferred_gap');
  assert.throws(() => { calls[0].opts.workerPolicy.access.resolved = 'workspace'; }, TypeError);
  assert.equal(calls[0].opts.workerPolicy.access.resolved, 'full');
  assert.equal(JSON.parse(handle.routeKey).length, 7);
  assert.equal(JSON.parse(handle.routeKey)[6], calls[0].opts.workerPolicy.resolutionDigest);

  const refusing = coordinatorForPolicy(card({
    access: { supported: ['workspace'], default: 'workspace', mechanisms: ['workspace-only'] },
  }));
  await assert.rejects(
    () => refusing.spawn('stub', directBrief(), { model: 'stub-model', effort: 'high' }),
    (error) => error instanceof WorkerPolicySelectionError && error.code === 'worker_policy_access_unavailable',
  );
  assert.deepEqual(refusing.list(), []);
});

test('WP9: an observed launch-policy mismatch fails once and retains authority until exact process close', async () => {
  let emit = () => {};
  let close = () => {};
  let kills = 0;
  const policyCard = card();
  const adapter = {
    onEvent(callback) { emit = callback; },
    card: () => ({
      harness: 'stub', version: '1', concurrencyCeiling: 1, maxContext: 1_000,
      modelSelection: {
        mode: 'exact', configuredDefault: 'stub-model', available: ['stub-model'], family: 'stub',
        acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
        provenance: 'test', refreshedAt: null,
      },
      workerPolicy: policyCard,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
    }),
    async spawn(worker, _brief, opts) {
      const generation = opts.processGeneration;
      const pid = 41_001;
      const base = { worker, harness: 'stub', turnEpoch: 1, actor: 'worker' };
      emit({ ...base, kind: 'lifecycle.process_started', payload: processStartedPayload(generation, pid) });
      close = () => emit({
        ...base, kind: 'lifecycle.process_closed',
        payload: processClosedPayload(generation, pid, null, 'SIGKILL', false),
      });
      emit({
        ...base, kind: 'worker_policy.observed',
        payload: {
          processGeneration: generation, pid, processGroupId: pid,
          workerPolicyObserved: createWorkerPolicyObservation(opts.workerPolicy, {
            autonomy: 'interactive', access: 'full',
          }),
        },
      });
      return { ok: true };
    },
    async kill(worker) {
      kills += 1;
      emit({
        worker, harness: 'stub', turnEpoch: 1, actor: 'worker', kind: 'kill.confirmed',
        payload: { usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null } },
      });
      return { ok: true };
    },
    async prompt() { return { ok: true }; }, async interrupt() { return { ok: true }; },
    async approve() { return { ok: true }; }, async answer() { return { ok: true }; },
  };
  const log = new Log(mkdtempSync(join(tmpdir(), 'baton-worker-policy-mismatch-log-')));
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(), adapters: { stub: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/${taskId}` }), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub',
    approvalTimeoutMs: 1_000, stopDeadlineMs: 1_000,
  });
  const publicHandle = await coordinator.spawn('stub', directBrief(), {
    taskId: 'policy-mismatch', model: 'stub-model', effort: 'high',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const internal = coordinator._workers.get(publicHandle.id);
  assert.equal(kills, 1);
  assert.equal(internal.status, 'stopping');
  assert.equal(internal.localAuthority, true);
  assert.equal(coordinator._tasks.get('policy-mismatch').status, 'failed');
  assert.equal(log.read(publicHandle.id).filter((event) => event.kind === 'worker_policy.mismatch').length, 1);

  close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(internal.status, 'dead');
  assert.equal(internal.localAuthority, false);
  assert.equal(kills, 1);
});
