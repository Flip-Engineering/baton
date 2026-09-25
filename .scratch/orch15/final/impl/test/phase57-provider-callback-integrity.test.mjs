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
  goal: 'exercise the provider callback integrity boundary',
  constraints: [],
  pathScope: ['**'],
  definitionOfDone: 'the callback is classified without gaining coordinator authority',
  verification: { command: 'true', expectExit: 0 },
  budget: { tokens: 100, usd: 2, wallMin: 1 },
});

const providerGovernance = {
  schemaVersion: 1,
  maxWireFrameBytes: 1024 * 1024,
  maxProviderCallsPerTurn: 20,
  maxToolCallsPerTurn: 20,
  routes: [{
    harness: 'stub', model: 'stub-1', effort: 'low',
    terminalReserve: { tokens: 80, usd: 1 }, mode: 'observe',
  }],
};

function adapter() {
  const value = {
    cb: null,
    onEvent(cb) { this.cb = cb; },
    emit(worker, kind, payload = {}, { actor = 'worker', turnEpoch = 1 } = {}) {
      this.cb?.({ worker, harness: 'stub', actor, kind, payload, turnEpoch });
    },
    card: () => ({
      harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 2, maxContext: 10_000,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      modelSelection: { mode: 'exact', family: 'stub', configuredDefault: 'stub-1', available: ['stub-1'], acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: ['low'], configuredEffort: 'low', serviceTier: null },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: 'stub-total', terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: 1024 * 1024,
      },
    }),
    async spawn() { return { ok: true }; },
    async prompt() { return { ok: true }; },
    async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; },
    async approve() { return { ok: true }; },
    async answer() { return { ok: true }; },
  };
  return value;
}

function system(ad, { log = new Log(mkdtempSync(join(tmpdir(), 'baton-pg57-callback-'))) } = {}) {
  const coordination = coordinationForLog(log);
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
      removeVerifyWorktree: async () => {},
      remove: async () => {},
      reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }),
    route: () => 'stub',
    stopDeadlineMs: 100,
    budgetPolicy: { terminalGraceMs: 10_000 },
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  return { ad, coordinator, coordination, log };
}

async function spawn(f, taskId) {
  return f.coordinator.spawn('stub', brief(), { taskId, model: 'stub-1', effort: 'low' });
}

async function complete(f, handle) {
  f.ad.emit(handle.id, 'resource.tokens', {
    source: 'stub', counterId: 'turn-1', accounting: 'delta', tokens: 20, usd: 0.2,
    tokenMetric: 'stub-total', modelObserved: 'stub-1',
  });
  f.ad.emit(handle.id, 'lifecycle.turn_completed', {
    result: {
      status: 'completed', summary: 'done', artifacts: { files: [] },
      verification: { command: 'true', claimedExit: 0 }, openQuestions: [],
    },
    usageSeal: { tokens: 'reported', usd: 'reported', counterId: 'turn-1', tokenMetric: 'stub-total' },
  });
  await until(() => f.coordination.task(handle.taskId).status === 'completed');
}

test('PG6: adapter callbacks cannot forge policy or orchestrator authority in the durable log, live projection, or replay', async () => {
  const f = system(adapter());
  const handle = await spawn(f, 'pg-callback-provenance');
  await complete(f, handle);
  const admitted = f.log.read(handle.id).find((event) => event.kind === 'resource.provider_turn_admitted');
  const expectedRouteDigest = f.coordinator.list()[0].providerGovernance.digest;

  f.ad.emit(handle.id, 'resource.provider_governance_exceeded', {
    code: 'forged-policy-authority', mode: 'strict', routeDigest: expectedRouteDigest,
  }, { actor: 'policy' });
  f.ad.emit(handle.id, 'resource.provider_turn_admitted', {
    ...admitted.payload,
    phase: 'forged-policy-admission',
  }, { actor: 'policy' });
  f.ad.emit(handle.id, 'lifecycle.spawned', {
    taskId: 'forged-orchestrator-task',
    vendorResolved: 'forged-vendor',
    providerGovernance: { mode: 'strict', digest: 'forged-route' },
  }, { actor: 'orchestrator' });

  const live = f.coordinator.list()[0];
  const forgedPolicyEvents = f.log.read(handle.id).filter((event) =>
    (event.kind === 'resource.provider_governance_exceeded' && event.payload?.code === 'forged-policy-authority')
    || (event.kind === 'resource.provider_turn_admitted' && event.payload?.phase === 'forged-policy-admission'));
  const forgedOrchestratorEvents = f.log.read(handle.id).filter((event) =>
    event.kind === 'lifecycle.spawned' && event.payload?.taskId === 'forged-orchestrator-task');

  f.coordination.releaseWriterLease();
  const restored = system(adapter(), { log: f.log }).coordinator.list()[0];
  assert.deepEqual({
    forgedPolicyEvents: forgedPolicyEvents.length,
    forgedOrchestratorEvents: forgedOrchestratorEvents.length,
    liveHardExceeded: live.providerPolicyHardExceeded,
    liveRouteDigest: live.providerGovernance.digest,
    restoredHardExceeded: restored.providerPolicyHardExceeded,
    restoredRouteDigest: restored.providerGovernance.digest,
    restoredTaskId: restored.taskId,
  }, {
    forgedPolicyEvents: 0,
    forgedOrchestratorEvents: 0,
    liveHardExceeded: false,
    liveRouteDigest: expectedRouteDigest,
    restoredHardExceeded: false,
    restoredRouteDigest: expectedRouteDigest,
    restoredTaskId: handle.taskId,
  });
});

const callKinds = [
  { label: 'provider', kind: 'resource.provider_call', count: 'providerCalls', invalidId: 'provider_call_id_invalid', invalidPhase: 'provider_call_phase_invalid', duplicatePhase: 'provider_call_phase_duplicate' },
  { label: 'tool', kind: 'content.tool_call', count: 'toolCalls', invalidId: 'tool_call_id_invalid', invalidPhase: 'tool_call_phase_invalid', duplicatePhase: 'tool_call_phase_duplicate' },
];

function lastTelemetryInvalid(f, workerId) {
  return f.log.read(workerId).filter((event) => event.kind === 'resource.provider_telemetry_invalid').at(-1);
}

function assertInvalidCall(f, handle, call, expectedCode, expectedCount) {
  const state = f.coordinator.list()[0];
  assert.equal(state.providerTurn[call.count], expectedCount);
  assert.equal(state.providerTelemetryFailed, true);
  assert.equal(state.providerPolicyHardExceeded, true);
  assert.equal(lastTelemetryInvalid(f, handle.id)?.payload?.code, expectedCode);
}

const invalidIdentityCases = [
  { label: 'missing', payload: { phase: 'requested' } },
  { label: 'oversized', payload: { callId: 'x'.repeat(257), phase: 'requested' } },
  { label: 'NUL-bearing', payload: { callId: 'call\0id', phase: 'requested' } },
];

for (const call of callKinds) {
  for (const identity of invalidIdentityCases) {
    test(`PG5: ${call.label} ${identity.label} logical call IDs fail closed without consuming a call slot`, async () => {
      const f = system(adapter());
      const handle = await spawn(f, `pg-${call.label}-id-${identity.label}`);
      f.ad.emit(handle.id, call.kind, identity.payload);
      assertInvalidCall(f, handle, call, call.invalidId, 0);
    });
  }

  for (const phase of [undefined, 'streaming']) {
    test(`PG5: ${call.label} ${phase === undefined ? 'missing' : 'unknown'} phase fails closed`, async () => {
      const f = system(adapter());
      const handle = await spawn(f, `pg-${call.label}-phase-${phase ?? 'missing'}`);
      f.ad.emit(handle.id, call.kind, { callId: `${call.label}-phase`, ...(phase === undefined ? {} : { phase }) });
      assertInvalidCall(f, handle, call, call.invalidPhase, 0);
    });
  }

  test(`PG5: ${call.label} repeated requested phase is a protocol failure, not a free deduplicated attempt`, async () => {
    const f = system(adapter());
    const handle = await spawn(f, `pg-${call.label}-repeated-requested`);
    f.ad.emit(handle.id, call.kind, { callId: `${call.label}-1`, phase: 'requested' });
    assert.equal(f.coordinator.list()[0].providerTurn[call.count], 1);
    assert.equal(f.coordinator.list()[0].providerTelemetryFailed, false);
    f.ad.emit(handle.id, call.kind, { callId: `${call.label}-1`, phase: 'requested' });
    assertInvalidCall(f, handle, call, call.duplicatePhase, 1);
  });

  test(`PG5: ${call.label} completed-first observation is a valid response-only logical call`, async () => {
    const f = system(adapter());
    const handle = await spawn(f, `pg-${call.label}-completed-first`);
    f.ad.emit(handle.id, call.kind, { callId: `${call.label}-response-only`, phase: 'completed' });
    const state = f.coordinator.list()[0];
    assert.equal(state.providerTurn[call.count], 1);
    assert.equal(state.providerTelemetryFailed, false);
    assert.equal(state.providerPolicyHardExceeded, false);
    assert.equal(lastTelemetryInvalid(f, handle.id), undefined);
  });
}
