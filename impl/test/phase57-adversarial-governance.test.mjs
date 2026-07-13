import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(5);
  }
  throw new Error('timed out');
};

const brief = () => ({
  goal: 'adversarial governed provider turn',
  constraints: [],
  pathScope: ['**'],
  definitionOfDone: 'done',
  verification: { command: 'true', expectExit: 0 },
  budget: { tokens: 200, usd: 5, wallMin: 1 },
});

const policy = ({ mode = 'observe', reserve = { tokens: 80, usd: 1 }, maxProviderCallsPerTurn = 2 } = {}) => ({
  schemaVersion: 1,
  maxWireFrameBytes: 1024 * 1024,
  maxProviderCallsPerTurn,
  maxToolCallsPerTurn: 2,
  routes: [{ harness: 'stub', model: 'stub-1', effort: 'low', terminalReserve: reserve, mode }],
});

function adapter({ strict = false } = {}) {
  const calls = { spawn: 0, prompt: 0, kill: 0 };
  const value = {
    calls,
    cb: null,
    onEvent(cb) { this.cb = cb; },
    emit(worker, kind, payload = {}, turnEpoch = 1) {
      this.cb?.({ worker, harness: 'stub', actor: 'worker', kind, payload, turnEpoch });
    },
    card: () => ({
      harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 2, maxContext: 10_000,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      modelSelection: { mode: 'exact', family: 'stub', configuredDefault: 'stub-1', available: ['stub-1'], acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: ['low'], configuredEffort: 'low', serviceTier: null },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: 'stub-total', terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: strict ? 'native_pre_effect' : 'unavailable' },
        toolCalls: { observation: 'native', enforcement: strict ? 'approval_pre_effect' : 'unavailable' },
        maxWireFrameBytes: 1024 * 1024,
      },
    }),
    ...(strict ? {
      bindProviderGovernance(envelope) { return { ok: true, bindingDigest: envelope.bindingDigest }; },
    } : {}),
    async spawn() { calls.spawn += 1; return { ok: true }; },
    async prompt() { calls.prompt += 1; return { ok: true }; },
    async interrupt(worker) {
      queueMicrotask(() => value.emit(worker, 'control.interrupt_confirmed', {
        usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
      }));
      return { ok: true };
    },
    async kill(worker) {
      calls.kill += 1;
      queueMicrotask(() => value.emit(worker, 'kill.confirmed', {
        usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
      }));
      return { ok: true };
    },
    async approve() { return { ok: true }; },
    async answer() { return { ok: true }; },
  };
  return value;
}

function system(ad, { providerGovernance = policy(), log = new Log(mkdtempSync(join(tmpdir(), 'baton-pg57-adversarial-'))) } = {}) {
  const coordination = coordinationForLog(log);
  let verifies = 0;
  const coordinator = new Coordinator({
    log,
    coordination,
    fences: new FenceTable(),
    adapters: { stub: ad },
    providerGovernance,
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/${taskId}` }),
      capture: async () => ({ sha: 'capture-sha', snapshotted: false }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => { verifies += 1; return { reverified: true, observedExit: 0 }; },
    route: () => 'stub',
    stopDeadlineMs: 100,
    budgetPolicy: { terminalGraceMs: 1 },
    watchdog: { stallMs: 0 },
  });
  return { coordinator, coordination, log, verifies: () => verifies };
}

const validUsage = (overrides = {}) => ({
  source: 'stub', counterId: 'turn-1', accounting: 'delta',
  tokens: 20, usd: 0.2, tokenMetric: 'stub-total', modelObserved: 'stub-1',
  ...overrides,
});

const validSeal = (overrides = {}) => ({
  tokens: 'reported', usd: 'reported', counterId: 'turn-1', tokenMetric: 'stub-total',
  ...overrides,
});

function terminal(ad, worker, usageSeal = validSeal()) {
  ad.emit(worker, 'lifecycle.turn_completed', {
    result: { status: 'completed', summary: 'done', artifacts: { files: [] }, verification: { command: 'true', claimedExit: 0 }, openQuestions: [] },
    usageSeal,
  });
}

for (const [label, omitted] of [['USD', 'usd'], ['tokens', 'tokens']]) {
  test(`PG4 adversarial: a seal cannot report ${label} when that dimension was omitted from resource.tokens`, async () => {
    const ad = adapter(); const fixture = system(ad);
    const handle = await fixture.coordinator.spawn('stub', brief(), { taskId: `pg57-omitted-${omitted}`, model: 'stub-1', effort: 'low' });
    const payload = validUsage(); delete payload[omitted];
    ad.emit(handle.id, 'resource.tokens', payload);
    terminal(ad, handle.id);
    await until(() => ['completed', 'failed'].includes(fixture.coordination.task(handle.taskId).status));
    assert.equal(fixture.coordination.task(handle.taskId).status, 'failed');
    assert.equal(fixture.verifies(), 0);
    assert.ok(fixture.log.read(handle.id).some((event) => event.kind === 'resource.provider_telemetry_invalid'));
  });
}

for (const [label, tokenMetric] of [['missing', null], ['mismatched', 'different-total']]) {
  test(`PG4 adversarial: ${label} terminal tokenMetric fails metric binding before verification`, async () => {
    const ad = adapter(); const fixture = system(ad);
    const handle = await fixture.coordinator.spawn('stub', brief(), { taskId: `pg57-seal-metric-${label}`, model: 'stub-1', effort: 'low' });
    ad.emit(handle.id, 'resource.tokens', validUsage());
    terminal(ad, handle.id, validSeal({ tokenMetric }));
    await until(() => fixture.coordination.task(handle.taskId).status === 'failed');
    assert.equal(fixture.verifies(), 0);
    assert.equal(
      fixture.log.read(handle.id).find((event) => event.kind === 'resource.provider_telemetry_invalid')?.payload?.code,
      'usage_seal_metric_mismatch',
    );
  });
}

for (const [label, tokenMetric] of [['omitted', undefined], ['mismatched', 'different-total']]) {
  test(`PG4 adversarial: resource.tokens tokenMetric ${label} cannot be laundered by a correct terminal seal`, async () => {
    const ad = adapter(); const fixture = system(ad);
    const handle = await fixture.coordinator.spawn('stub', brief(), { taskId: `pg57-resource-metric-${label}`, model: 'stub-1', effort: 'low' });
    const payload = validUsage();
    if (tokenMetric === undefined) delete payload.tokenMetric; else payload.tokenMetric = tokenMetric;
    ad.emit(handle.id, 'resource.tokens', payload);
    terminal(ad, handle.id);
    await until(() => ['completed', 'failed'].includes(fixture.coordination.task(handle.taskId).status));
    assert.equal(fixture.coordination.task(handle.taskId).status, 'failed');
    assert.equal(fixture.verifies(), 0);
    assert.ok(fixture.log.read(handle.id).some((event) => event.kind === 'resource.provider_telemetry_invalid'));
  });
}

for (const [label, malformed] of [
  ['numeric-string tokens', { tokens: '20' }],
  ['numeric-string USD', { usd: '0.2' }],
  ['fractional tokens', { tokens: 1.5 }],
  ['unsafe tokens', { tokens: Number.MAX_SAFE_INTEGER + 1 }],
]) {
  test(`PG4 adversarial: ${label} is rejected as usage_value_invalid`, async () => {
    const ad = adapter(); const fixture = system(ad);
    const handle = await fixture.coordinator.spawn('stub', brief(), { taskId: `pg57-invalid-${label.replaceAll(' ', '-')}`, model: 'stub-1', effort: 'low' });
    ad.emit(handle.id, 'resource.tokens', validUsage(malformed));
    await sleep(20);
    assert.equal(
      fixture.log.read(handle.id).find((event) => event.kind === 'resource.provider_telemetry_invalid')?.payload?.code,
      'usage_value_invalid',
    );
    assert.equal(fixture.verifies(), 0);
  });
}

test('PG2 adversarial: observe-mode acceptance is publicly labeled observationOnly', async () => {
  const ad = adapter(); const fixture = system(ad);
  const handle = await fixture.coordinator.spawn('stub', brief(), { taskId: 'pg57-observation-only', model: 'stub-1', effort: 'low' });
  ad.emit(handle.id, 'resource.tokens', validUsage());
  terminal(ad, handle.id);
  await until(() => fixture.coordination.task(handle.taskId).status === 'completed');
  const publicResult = await fixture.coordinator.result(handle.id);
  const verified = fixture.log.read(handle.id).find((event) => event.kind === 'verify.reverified');
  assert.equal(publicResult.observationOnly, true);
  assert.equal(verified.payload.providerGovernanceAdmission.observationOnly, true);
});

test('PG6 adversarial: replay keeps policy A evidence, then admits the next turn under policy B', async () => {
  const policyA = policy({ reserve: { tokens: 80, usd: 1 }, maxProviderCallsPerTurn: 2 });
  const adA = adapter(); const first = system(adA, { providerGovernance: policyA });
  const handle = await first.coordinator.spawn('stub', brief(), { taskId: 'pg57-policy-replay', model: 'stub-1', effort: 'low' });
  adA.emit(handle.id, 'resource.tokens', validUsage());
  terminal(adA, handle.id);
  await until(() => first.coordination.task(handle.taskId).status === 'completed');
  const admissionA = first.log.read(handle.id).find((event) => event.kind === 'resource.provider_turn_admitted');
  first.coordination.releaseWriterLease();

  const policyB = policy({ reserve: { tokens: 40, usd: 0.5 }, maxProviderCallsPerTurn: 3 });
  const adB = adapter(); const replayed = system(adB, { providerGovernance: policyB, log: first.log });
  const historical = replayed.coordinator.list().find((worker) => worker.id === handle.id);
  const followUp = await replayed.coordinator.send(handle.id, 'next governed turn', 'turn');
  const admissions = replayed.log.read(handle.id).filter((event) => event.kind === 'resource.provider_turn_admitted');
  const admissionB = admissions.at(-1);

  assert.equal(historical.providerGovernance.digest, admissionA.payload.routeDigest);
  assert.equal(historical.providerTurn.sealed, true);
  assert.equal(historical.providerTerminalSeal.counterId, 'turn-1');
  assert.equal(followUp.ok, true);
  assert.equal(adB.calls.prompt, 1);
  assert.equal(admissionB.payload.phase, 'follow_up');
  assert.notEqual(admissionB.payload.policyDigest, admissionA.payload.policyDigest);
  assert.deepEqual(admissionB.payload.reserve, { tokens: 40, usd: 0.5 });
});
