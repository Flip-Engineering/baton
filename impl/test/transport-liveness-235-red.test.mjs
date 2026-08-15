import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { createDriver, createWave } from '../src/index.mjs';

// Issue #235 (cross-ref #208, evidence in #230 + the 2026-08-15 dogfood) — the
// transport-liveness attention class. An auth-less omp member sat 25+ min as
// `phase: running, progressClass: {class: 'silent'}` while ground truth was ZERO established
// provider sockets / no provider traffic ever; after the credential fix the same shape showed
// 7-12 churning sockets. A member with zero provider traffic must never read as plain
// 'silent'/'quiesced' — the receipts must NAME the transport fact.
//
// #163 LAW (operator ruling) holds: this is EVIDENCE CLASSIFICATION ONLY. Nothing here
// terminates, reaps, or re-arms anything — the liveness observation changes what attention and
// settle receipts REPORT, never what they decide.
//
// RED   = no adapter emits lifecycle.transport_liveness; the coordinator has no
//         provider_silent attention projection; a never-trafficked member settles with no
//         progressClass and unnamed steering evidence.
// GREEN = (1) the adapter reports provider-traffic transitions (baseline never-observed, then
//         first-traffic), startup frames never counting as traffic;
//         (2) a never-trafficked member with an active turn projects
//         {kind:'provider_silent', summary:'no provider traffic observed this turn'};
//         (3) the wave settle receipt carries progressClass 'provider_silent' (distinct from
//         'silent') and the steering evidence names the member.

const line = (frame) => `${JSON.stringify(frame)}\n`;

// ---------------------------------------------------------------------------
// Case 1 — ADAPTER: OmpRpcCli reports provider-traffic transitions, not per-frame noise.
// ---------------------------------------------------------------------------

test('TRANSPORT-LIVENESS/ADAPTER: omp rpc emits transport_liveness on provider-traffic transitions only', async () => {
  const writes = [];
  const spawnFn = () => {
    const child = {
      pid: 4242,
      stdin: { write: () => {} },
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => {},
      on: () => {},
      once: () => {},
    };
    child.stdin.write = (chunk) => {
      writes.push(chunk);
      // The prompt command is correlated by id (omp-rpc _startTurn → process.send): answer it
      // so the first turn is acked, exactly as a real `omp --mode rpc` child would.
      let frame = null;
      try { frame = JSON.parse(chunk); } catch { frame = null; }
      if (frame?.type === 'prompt' && typeof frame.id === 'string') {
        child.stdout.write(line({ type: 'response', id: frame.id, success: true }));
      }
    };
    setImmediate(() => { child.stdout.write(line({ type: 'ready', protocolVersion: 1 })); });
    return child;
  };
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 5_000,
    model: 'deepseek/deepseek-v4-flash',
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['high'] },
    ceiling: 1,
    versionProbe: () => 'omp test',
    spawnFn,
  });
  const events = [];
  adapter.onEvent((e) => events.push(e));
  const ack = await adapter.spawn('w-235', { goal: 'observe transport liveness' }, {
    worktree: '/tmp',
    model: 'deepseek/deepseek-v4-flash',
    reasoningEffort: 'high',
  });
  assert.equal(ack.ok, true, `spawn must succeed (got ${JSON.stringify(ack)})`);

  const liveness = () => events.filter((e) => e.kind === 'lifecycle.transport_liveness');

  // THE PIN (a): the baseline — a fresh session that has carried ONLY startup frames reports
  // the provider dial as never observed, honestly and once.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(liveness().length, 1,
    `exactly one baseline transport_liveness event after ready (got ${JSON.stringify(liveness())})`);
  assert.deepEqual(liveness()[0].payload, {
    kind: 'transport_liveness',
    providerTraffic: false,
    lastTrafficAt: null,
    note: 'provider_dial_never_observed',
  }, 'the baseline observation is the never-trafficked evidence shape');

  // THE PIN (b): startup/UI frames do not flip the observation and do not re-emit — an
  // auth-less omp still answers its UI/command lanes while the provider socket never opens.
  const stdout = adapterSpawnedStdout(adapter);
  const events0 = liveness().length;
  stdout.write(line({ type: 'available_commands_update', commands: [] }));
  stdout.write(line({ type: 'extension_ui_request', id: 'ui-1' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(liveness().length, events0,
    'startup/UI frames emit no transport_liveness and are not provider traffic');

  // THE PIN (c): the first provider-traffic frame flips the observation exactly once.
  stdout.write(line({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x' } }));
  await new Promise((resolve) => setImmediate(resolve));
  const flipped = liveness();
  assert.equal(flipped.length, events0 + 1, 'the first traffic frame emits exactly one transition');
  assert.equal(flipped.at(-1).payload.providerTraffic, true);
  assert.equal(flipped.at(-1).payload.note, 'provider_traffic_observed');
  assert.equal(typeof flipped.at(-1).payload.lastTrafficAt, 'string',
    'the observed transition stamps lastTrafficAt');
  assert.ok(Number.isFinite(Date.parse(flipped.at(-1).payload.lastTrafficAt)),
    'lastTrafficAt is an ISO timestamp');

  // THE PIN (d): transitions only — further traffic frames never re-emit.
  stdout.write(line({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'y' } }));
  stdout.write(line({ type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'read' }));
  stdout.write(line({ type: 'agent_start' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(liveness().length, events0 + 1, 'subsequent traffic frames emit nothing (transition-only)');

  await adapter.kill('w-235');
});

// The adapter owns its child; expose the live session's stdout for frame injection.
function adapterSpawnedStdout(adapter) {
  const session = adapter._sessions.get('w-235');
  assert.ok(session?.process?.child?.stdout, 'the adapter session must hold a live child stdout');
  return session.process.child.stdout;
}

// ---------------------------------------------------------------------------
// Case 2 — COORDINATOR: the never-trafficked active-turn attention projection.
// NativePlanAdapter pattern (phase62-goal-plan-authority.test.mjs): a plan-gated spawn over a
// fake adapter that emits the #230/#235 wire shapes by hand.
// ---------------------------------------------------------------------------

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-liveness-235',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit'],
  capabilityClasses: ['code'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const auth = (principalId, powers, idempotencyKey) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`, powers,
  repoId: 'repo-liveness-235', runId: null, idempotencyKey,
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 16 * 1024, requiredPredecessorEvidence: [],
});

class LivenessAdapter {
  constructor() { this.cb = null; }
  onEvent(cb) { this.cb = cb; }
  card() {
    return {
      harness: 'mock', version: 'liveness-235', authPosture: 'none', concurrencyCeiling: 2, maxContext: 100_000,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
      modelSelection: { mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock', acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null },
    };
  }
  async spawn(worker) {
    queueMicrotask(() => {
      this.cb?.({ worker, harness: 'mock', turnEpoch: 1, actor: 'worker', kind: 'lifecycle.spawned', payload: { sessionId: `session-${worker}`, pid: 4242 } });
    });
    return { ok: true };
  }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async kill(worker) {
    this.cb?.({ worker, harness: 'mock', turnEpoch: 1, actor: 'worker', kind: 'kill.confirmed', payload: {} });
    return { ok: true };
  }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
}

async function until(fn, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not met');
}

test('TRANSPORT-LIVENESS/COORDINATOR: never-trafficked active turn projects provider_silent attention', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'baton-liveness-235-repo-'));
  const logDir = mkdtempSync(join(tmpdir(), 'baton-liveness-235-log-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'l@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'L'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const adapter = new LivenessAdapter();
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-liveness-235', logDir, adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 1_000,
  });

  const goalResult = await driver.coordinator.defineGoal({
    objective: 'Pin the transport-liveness attention class', definitionOfDone: ['true passes'],
    constraints: [], risk: 'low', budget: { tokens: 4_000, usd: 1, wallMin: 5, providerTurns: 4 }, predecessor: null,
  }, auth('goal-owner', ['goal:define'], 'goal:liveness'));
  const goal = goalResult.goal;
  const planResult = await driver.coordinator.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'implement', objective: 'Pin the transport-liveness attention class',
      definitionOfDone: ['true passes'], deps: [], pathScope: ['impl/**'], risk: 'low',
      budget: { tokens: 4_000, usd: 1, wallMin: 5, providerTurns: 4 }, verification,
      routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
      capabilities: ['code'], effects: ['repository_edit'],
    }],
  }, auth('planner', ['plan:propose'], 'plan:liveness'));
  const plan = planResult.plan;
  await driver.coordinator.approvePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest },
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', ['plan:approve'], 'approval:liveness'));

  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0, capabilities: ['code'], effects: ['repository_edit'],
  };
  const brief = {
    goal: 'Pin the transport-liveness attention class', constraints: [], pathScope: ['impl/**'],
    tools: [], outputFormat: '', definitionOfDone: 'true passes', verification,
    budget: { tokens: 4_000, usd: 1, wallMin: 5 }, providerTurns: 4,
    capabilities: ['code'], effects: ['repository_edit'],
  };
  const handle = await driver.coordinator.spawn('mock', brief, {
    taskId: 'liveness-235', model: 'model-a', effort: 'low', goalPlan: gate,
    actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session',
    powers: ['plan:dispatch'], idempotencyKey: 'spawn:liveness-235',
  });

  // Let the spawn admission complete (the spawned event must be durable first).
  await until(() => driver.log.read(handle.id).some((event) => event.kind === 'lifecycle.spawned'));

  const wire = (kind, payload) => adapter.cb?.({
    worker: handle.id, harness: 'mock', turnEpoch: 1, actor: 'worker', kind, payload,
  });

  // An active turn with NO liveness observation yet makes no claim either way.
  wire('lifecycle.turn_started', { phase: 'turn_started', turnId: 'mock-1', turnEpoch: 1 });
  await until(() => driver.coordinator._workers.get(handle.id)?.turnInFlight === true);
  assert.equal(driver.coordinator.providerSilenceAttention(handle.id), null,
    'no observation → no claim (never prose-guess a member)');

  // THE PIN: the baseline never-trafficked observation + active turn → provider_silent.
  wire('lifecycle.transport_liveness', {
    kind: 'transport_liveness', providerTraffic: false, lastTrafficAt: null,
    note: 'provider_dial_never_observed',
  });
  await until(() => driver.log.read(handle.id).some((event) => event.kind === 'lifecycle.transport_liveness'));
  assert.deepEqual(driver.coordinator.providerSilenceAttention(handle.id), {
    kind: 'provider_silent',
    workerId: handle.id,
    summary: 'no provider traffic observed this turn',
    note: 'provider_dial_never_observed',
    lastTrafficAt: null,
  }, 'the attention projection names the transport fact, never plain silence');

  // The observed transition clears it: evidence classification follows the latest observation.
  wire('lifecycle.transport_liveness', {
    kind: 'transport_liveness', providerTraffic: true,
    lastTrafficAt: new Date().toISOString(), note: 'provider_traffic_observed',
  });
  await until(() => {
    const latest = driver.log.read(handle.id).filter((event) => event.kind === 'lifecycle.transport_liveness').at(-1);
    return latest?.payload?.providerTraffic === true;
  });
  assert.equal(driver.coordinator.providerSilenceAttention(handle.id), null,
    'a trafficked member is never provider_silent, even mid-silence');

  await driver.coordinator.kill(handle.id, 'test');
  await driver.drainAndClose('test');
});

// ---------------------------------------------------------------------------
// Case 3 — WAVE SETTLE: the never-trafficked member settles 'provider_silent', distinctly.
// Fixture shape from wave-settle-error-surfacing-red.test.mjs (a Baton client facade whose
// member run views carry the #235 attention entry).
// ---------------------------------------------------------------------------

test('TRANSPORT-LIVENESS/WAVE-SETTLE: never-trafficked member settles provider_silent with named steering evidence', async () => {
  const neverTrafficked = {
    kind: 'provider_silent', workerId: 'w-silent', summary: 'no provider traffic observed this turn',
    note: 'provider_dial_never_observed', lastTrafficAt: null,
  };
  const outlines = {
    silent_member: { schemaVersion: 1, runId: 'run-silent', phase: 'running', attention: [neverTrafficked] },
    trafficked_member: { schemaVersion: 1, runId: 'run-trafficked', phase: 'running', attention: [] },
  };
  const facade = {
    runs: {
      start: async (objective, options) => ({
        approve: async () => ({}),
        complete: async () => ({}),
        status: async () => ({ view: outlines[options.waveRole] ?? { phase: 'running' } }),
        stop: async () => ({}),
      }),
      list: async () => ({ items: [] }),
    },
  };

  const wave = await createWave(facade, {
    members: [
      { role: 'silent_member', objective: 'never dialed', harness: 'worker', model: 'm', effort: 'low', scope: ['out.md'] },
      { role: 'trafficked_member', objective: 'live traffic', harness: 'worker', model: 'm', effort: 'low', scope: ['out.md'] },
    ],
    approve: true,
  });
  const outcomes = await wave.settle({ timeoutMs: 300 });

  const silent = outcomes.find((o) => o.role === 'silent_member');
  const trafficked = outcomes.find((o) => o.role === 'trafficked_member');
  assert.ok(silent && trafficked, `both members must settle (got ${JSON.stringify(outcomes.map((o) => o.role))})`);

  // THE PIN: the settle receipt classifies the never-trafficked member distinctly — never a
  // plain 'silent' read that hides a wedged member among healthy ones.
  assert.equal(silent.progressClass, 'provider_silent',
    `the never-trafficked member settles provider_silent (got ${JSON.stringify(silent)})`);
  assert.equal(silent.phase, 'working', 'evidence-only: the class changes no termination state');

  // A trafficked sibling carries NO provider_silent claim — the class is evidence-scoped.
  assert.notEqual(trafficked.progressClass, 'provider_silent',
    `a trafficked member never reads provider_silent (got ${JSON.stringify(trafficked)})`);

  // The steering evidence names the member.
  const named = wave.evidence().steering.find((s) => s.evidence === 'provider_silent');
  assert.ok(named, `steering evidence must name the provider-silent member (got ${JSON.stringify(wave.evidence().steering)})`);
  assert.equal(named.role, 'silent_member');
  assert.equal(named.summary, 'no provider traffic observed this turn');
});
