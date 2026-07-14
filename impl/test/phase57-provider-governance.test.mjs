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
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(5); }
  throw new Error('timed out');
};
const brief = (budget = { tokens: 100, usd: 2, wallMin: 1 }) => ({
  goal: 'governed provider turn', constraints: [], pathScope: ['**'], definitionOfDone: 'done',
  verification: { command: 'true', expectExit: 0 }, budget,
});
const policy = (route = {}) => ({
  schemaVersion: 1,
  maxWireFrameBytes: 1024 * 1024,
  maxProviderCallsPerTurn: 2,
  maxToolCallsPerTurn: 2,
  routes: [{
    harness: 'stub', model: 'stub-1', effort: 'low', terminalReserve: { tokens: 80, usd: 1 }, mode: 'observe',
    ...route,
  }],
});

function adapter({ strict = false, bind = strict, maxWireFrameBytes = 1024 * 1024, stopSeal = null, emulatedSteer = false } = {}) {
  const calls = { spawn: 0, prompt: 0, promptModes: [], kill: 0, interrupt: 0, bind: 0, lastBinding: null };
  const value = {
    calls,
    cb: null,
    onEvent(cb) { this.cb = cb; },
    emit(worker, kind, payload = {}, turnEpoch = 1) { this.cb?.({ worker, harness: 'stub', actor: 'worker', kind, payload, turnEpoch }); },
    card: () => ({
      harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 2, maxContext: 10_000,
      verbs: { spawn: 'native', prompt: 'native', steer: emulatedSteer ? 'emulated' : 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      modelSelection: { mode: 'exact', family: 'stub', configuredDefault: 'stub-1', available: ['stub-1'], acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: ['low'], configuredEffort: 'low', serviceTier: null },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: 'stub-total', terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: strict ? 'native_pre_effect' : 'unavailable' },
        toolCalls: { observation: 'native', enforcement: strict ? 'approval_pre_effect' : 'unavailable' },
        maxWireFrameBytes,
      },
    }),
    ...(bind ? { bindProviderGovernance(envelope) { calls.bind += 1; calls.lastBinding = envelope; return { ok: true, bindingDigest: envelope.bindingDigest }; } } : {}),
    async spawn() { calls.spawn += 1; return { ok: true }; },
    async prompt(_worker, _message, mode) { calls.prompt += 1; calls.promptModes.push(mode); return { ok: true }; },
    async interrupt(worker) { calls.interrupt += 1; queueMicrotask(() => value.emit(worker, 'control.interrupt_confirmed', stopSeal ? { usageSeal: stopSeal } : {})); return { ok: true }; },
    async kill(worker) { calls.kill += 1; queueMicrotask(() => value.emit(worker, 'kill.confirmed', stopSeal ? { usageSeal: stopSeal } : {})); return { ok: true }; },
    async approve() { return { ok: true }; }, async answer() { return { ok: true }; },
  };
  return value;
}

function system(ad, opts = {}) {
  const log = opts.log ?? new Log(mkdtempSync(join(tmpdir(), 'baton-pg57-log-')));
  const coordination = coordinationForLog(log);
  let worktreeCreates = 0; let verifies = 0;
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { stub: ad }, providerGovernance: opts.providerGovernance ?? policy(),
    worktrees: {
      create: async (taskId) => { worktreeCreates += 1; return { path: `/tmp/${taskId}` }; },
      capture: async () => ({ sha: 'capture-sha', snapshotted: false }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => { verifies += 1; return { reverified: true, observedExit: 0 }; },
    route: () => 'stub', stopDeadlineMs: 100, budgetPolicy: { terminalGraceMs: 1 }, watchdog: { stallMs: 0 },
  });
  return { coordinator, log, coordination, worktreeCreates: () => worktreeCreates, verifies: () => verifies };
}

function usage(ad, worker, { tokens = 20, usd = 0.2, counterId = 'turn-1', accounting = 'delta' } = {}) {
  ad.emit(worker, 'resource.tokens', { source: 'stub', counterId, accounting, tokens, usd, tokenMetric: 'stub-total', modelObserved: 'stub-1' });
}

function terminal(ad, worker, usageSeal = { tokens: 'reported', usd: 'reported', counterId: 'turn-1', tokenMetric: 'stub-total' }) {
  ad.emit(worker, 'lifecycle.turn_completed', {
    result: { status: 'completed', summary: 'done', artifacts: { files: [] }, verification: { command: 'true', claimedExit: 0 }, openQuestions: [] },
    usageSeal,
  });
}

test('PG1/PG3: observe route reserves headroom before adapter/worktree effects without counting reserve as usage', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-admit', model: 'stub-1', effort: 'low' });
  assert.equal(ad.calls.spawn, 1); assert.equal(f.worktreeCreates(), 1);
  const admitted = f.log.read(handle.id).find((event) => event.kind === 'resource.provider_turn_admitted');
  assert.deepEqual(admitted.payload.reserve, { tokens: 80, usd: 1 });
  assert.deepEqual(f.coordinator.list()[0].budgetUsed, { tokens: 0, usd: 0 });
  assert.equal(f.coordinator.list()[0].providerGovernance.mode, 'observe');
});

test('PG3: insufficient route reserve fails before worktree, runtime, or adapter submission', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief({ tokens: 79, usd: 2, wallMin: 1 }), { taskId: 'pg-refuse', model: 'stub-1', effort: 'low' });
  assert.equal(ad.calls.spawn, 0); assert.equal(f.worktreeCreates(), 0);
  assert.equal(f.coordinator.list()[0].status, 'exited');
  const refused = f.log.read(handle.id).find((event) => event.kind === 'resource.provider_turn_refused');
  assert.equal(refused.payload.code, 'token_reserve_unavailable');
  assert.equal(f.coordination.task(handle.taskId).status, 'failed');
});

test('PG1: an exact harness/model/effort tuple absent from deployment policy never runs ungoverned', async () => {
  const ad = adapter(); const f = system(ad, { providerGovernance: policy({ model: 'stub-2' }) });
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-route-absent', model: 'stub-1', effort: 'low' });
  assert.equal(ad.calls.spawn, 0); assert.equal(f.worktreeCreates(), 0);
  assert.equal(f.log.read(handle.id).find((event) => event.kind === 'resource.provider_turn_refused').payload.code, 'exact_provider_route_unconfigured');
});

test('PG2/PG6: observation mode still refuses an adapter whose native frame bound exceeds policy', async () => {
  const ad = adapter({ maxWireFrameBytes: 2 * 1024 * 1024 }); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-wire-bound', model: 'stub-1', effort: 'low' });
  assert.equal(ad.calls.spawn, 0); assert.equal(f.worktreeCreates(), 0);
  assert.equal(f.log.read(handle.id).find((event) => event.kind === 'resource.provider_turn_refused').payload.code, 'wire_frame_bound_unavailable');
});

test('PG2: strict route refuses when card lacks pre-effect provider/tool enforcement', async () => {
  const ad = adapter(); const f = system(ad, { providerGovernance: policy({ mode: 'strict' }) });
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-strict-red', model: 'stub-1', effort: 'low' });
  assert.equal(ad.calls.spawn, 0); assert.equal(f.worktreeCreates(), 0);
  assert.equal(f.log.read(handle.id).find((event) => event.kind === 'resource.provider_turn_refused').payload.code, 'provider_call_pre_effect_enforcement_unavailable');
});

test('PG2: a strict route whose card proves native pre-effect enforcement is admitted', async () => {
  const ad = adapter({ strict: true }); const f = system(ad, { providerGovernance: policy({ mode: 'strict' }) });
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-strict-green', model: 'stub-1', effort: 'low' });
  assert.equal(ad.calls.spawn, 1); assert.equal(f.worktreeCreates(), 1);
  const admitted = f.log.read(handle.id).find((event) => event.kind === 'resource.provider_turn_admitted');
  assert.equal(admitted.payload.mode, 'strict');
  assert.equal(ad.calls.bind, 1);
  assert.equal(admitted.payload.strictBinding.bindingDigest, ad.calls.lastBinding.bindingDigest);
  assert.deepEqual({ harness: ad.calls.lastBinding.harness, model: ad.calls.lastBinding.model, effort: ad.calls.lastBinding.effort }, { harness: 'stub', model: 'stub-1', effort: 'low' });
});

test('PG2: strict card strings without a synchronous exact policy binding refuse before effects', async () => {
  const ad = adapter({ strict: true, bind: false }); const f = system(ad, { providerGovernance: policy({ mode: 'strict' }) });
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-strict-unbound', model: 'stub-1', effort: 'low' });
  assert.equal(ad.calls.spawn, 0); assert.equal(f.worktreeCreates(), 0);
  assert.equal(f.log.read(handle.id).find((event) => event.kind === 'resource.provider_turn_refused').payload.code, 'provider_policy_binding_unavailable');
});

test('PG4: native usage and matching seal are processed before successful trust admission', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-sealed', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id); terminal(ad, handle.id);
  await until(() => f.coordination.task(handle.taskId).status === 'completed');
  assert.equal(f.verifies(), 1);
  const verified = f.log.read(handle.id).find((event) => event.kind === 'verify.reverified');
  assert.equal(verified.payload.accept, true);
  assert.equal(verified.payload.providerGovernanceAdmission.terminalSeal.counterId, 'turn-1');
  assert.deepEqual(verified.payload.providerGovernanceAdmission.turn.usage, { tokens: 20, usd: 0.2 });
});

test('PG4/PG6: exact nano-USD deltas aggregate identically live and on replay', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-exact-usd', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id, { tokens: 10, usd: 0.1 });
  usage(ad, handle.id, { tokens: 10, usd: 0.2 });
  terminal(ad, handle.id);
  await until(() => f.coordination.task(handle.taskId).status === 'completed');
  assert.equal(f.coordinator.list()[0].budgetUsed.usd, 0.3);
  assert.equal(f.coordinator.list()[0].providerTurn.usage.usd, 0.3);
  f.coordination.releaseWriterLease();
  const replayed = system(adapter(), { log: f.log }).coordinator.list()[0];
  assert.equal(replayed.budgetUsed.usd, 0.3);
  assert.equal(replayed.providerTurn.usage.usd, 0.3);
});

test('PG4: missing terminal usage seal fails before verification and reaps the untrusted session', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-no-seal', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id); terminal(ad, handle.id, null);
  await until(() => f.coordination.task(handle.taskId).status === 'failed');
  await until(() => ad.calls.kill === 1);
  assert.equal(f.verifies(), 0);
  assert.equal(f.log.read(handle.id).find((event) => event.kind === 'resource.provider_telemetry_invalid').payload.code, 'usage_seal_invalid');
});

test('PG4: an unobserved terminal counter fails before verification', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-seal-counter', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id); terminal(ad, handle.id, { tokens: 'reported', usd: 'reported', counterId: 'other-turn', tokenMetric: 'stub-total' });
  await until(() => f.coordination.task(handle.taskId).status === 'failed');
  assert.equal(f.verifies(), 0);
  assert.equal(f.log.read(handle.id).find((event) => event.kind === 'resource.provider_telemetry_invalid').payload.code, 'usage_seal_counter_unobserved');
});

test('PG4/PG9: a seal cannot report a usage dimension its validated card calls unavailable', async () => {
  const ad = adapter(); const original = ad.card;
  ad.card = () => ({ ...original(), governance: { ...original().governance, usage: { ...original().governance.usage, usd: 'unavailable' } } });
  const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-card-seal-contradiction', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id); terminal(ad, handle.id);
  await until(() => f.coordination.task(handle.taskId).status === 'failed');
  assert.equal(f.verifies(), 0);
  assert.equal(f.log.read(handle.id).find((event) => event.kind === 'resource.provider_telemetry_invalid').payload.code, 'usage_seal_card_contradiction');
});

test('PG4: telemetry arriving after the terminal seal cannot race into an accepted artifact', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-late-usage', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id); terminal(ad, handle.id); usage(ad, handle.id, { tokens: 1, usd: 0, counterId: 'late-turn' });
  await until(() => f.coordination.task(handle.taskId).status === 'failed');
  assert.equal(f.log.read(handle.id).find((event) => event.kind === 'resource.provider_telemetry_invalid').payload.code, 'usage_after_terminal');
  const verified = f.log.read(handle.id).find((event) => event.kind === 'verify.reverified');
  if (verified) assert.equal(verified.payload.accept, false);
});

test('PG4: telemetry contradicting an already accepted turn durably revokes task and artifact acceptance', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-post-accept-usage', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id); terminal(ad, handle.id);
  await until(() => f.coordination.task(handle.taskId).status === 'completed');
  const acceptedIds = f.coordination.task(handle.taskId).artifactIds;
  assert.equal(acceptedIds.some((id) => f.coordination.artifact(id).accepted === true), true);
  usage(ad, handle.id, { tokens: 1, usd: 0, counterId: 'too-late' });
  await until(() => f.coordination.task(handle.taskId).status === 'failed');
  assert.equal((await f.coordinator.result(handle.id)).status, 'failed');
  assert.equal(acceptedIds.every((id) => f.coordination.artifact(id).accepted === false), true);
  assert.ok(f.coordination.events().some((event) => event.kind === 'task.acceptance_revoked'));
  f.coordination.releaseWriterLease();
  const replayAdapter = adapter(); const replayed = system(replayAdapter, { log: f.log });
  assert.equal(replayed.coordinator.list()[0].providerTelemetryFailed, true);
  assert.equal(replayed.coordination.task(handle.taskId).status, 'failed');
});

test('PG4: a duplicate terminal after durable acceptance revokes the task and every accepted artifact', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-post-accept-duplicate-terminal', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id); terminal(ad, handle.id);
  await until(() => f.coordination.task(handle.taskId).status === 'completed');
  const acceptedIds = f.coordination.task(handle.taskId).artifactIds;
  terminal(ad, handle.id);
  await until(() => f.coordination.task(handle.taskId).status === 'failed');
  assert.equal(f.log.read(handle.id).findLast((event) => event.kind === 'resource.provider_telemetry_invalid').payload.code, 'usage_seal_duplicate');
  assert.equal(acceptedIds.every((id) => f.coordination.artifact(id).accepted === false), true);
  assert.equal(f.coordination.events().filter((event) => event.kind === 'task.acceptance_revoked').length, 1);
});

test('PG4/PG5: provider or tool effects after the terminal seal cannot race into acceptance', async () => {
  for (const [kind, payload, code] of [
    ['resource.provider_call', { callId: 'late-provider', phase: 'requested' }, 'provider_call_after_terminal'],
    ['content.tool_call', { callId: 'late-tool', phase: 'requested' }, 'tool_call_after_terminal'],
  ]) {
    const ad = adapter(); const f = system(ad);
    const handle = await f.coordinator.spawn('stub', brief(), { taskId: `pg-late-${kind}`, model: 'stub-1', effort: 'low' });
    usage(ad, handle.id); terminal(ad, handle.id); ad.emit(handle.id, kind, payload);
    await until(() => f.coordination.task(handle.taskId).status === 'failed');
    assert.equal(f.log.read(handle.id).find((event) => event.kind === 'resource.provider_governance_exceeded').payload.code, code);
    const verified = f.log.read(handle.id).find((event) => event.kind === 'verify.reverified');
    if (verified) assert.equal(verified.payload.accept, false);
  }
});

test('PG4: governed crash seals are validated and restored as terminal evidence', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-crash-seal', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id);
  ad.emit(handle.id, 'lifecycle.crashed', {
    error: 'provider failed',
    usageSeal: { tokens: 'reported', usd: 'reported', counterId: 'turn-1', tokenMetric: 'stub-total' },
  });
  await until(() => f.coordination.task(handle.taskId).status === 'failed');
  assert.equal(f.coordinator.list()[0].providerTurn.sealed, true);
  assert.equal(f.coordinator.list()[0].providerTerminalSeal.counterId, 'turn-1');
  f.coordination.releaseWriterLease();
  const replayAdapter = adapter(); const restored = system(replayAdapter, { log: f.log }).coordinator.list()[0];
  assert.equal(restored.providerTurn.sealed, true);
  assert.equal(restored.providerTerminalSeal.counterId, 'turn-1');
});

test('PG3/PG4: interrupt-then seals the old turn and reserves a distinct follow-up before prompt', async () => {
  const seal = { tokens: 'reported', usd: 'reported', counterId: 'turn-1', tokenMetric: 'stub-total' };
  const ad = adapter({ stopSeal: seal }); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-interrupt-then', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id);
  const result = await f.coordinator.interrupt(handle.id, 'continue safely', 'operator:test');
  assert.equal(result.followUp, 'admitted');
  assert.equal(ad.calls.interrupt, 1); assert.deepEqual(ad.calls.promptModes, ['turn']);
  const admitted = f.log.read(handle.id).filter((event) => event.kind === 'resource.provider_turn_admitted');
  assert.equal(admitted.length, 2); assert.equal(admitted[1].payload.phase, 'follow_up');
  const stopped = f.log.read(handle.id).find((event) => event.kind === 'control.interrupt_confirmed');
  assert.deepEqual(stopped.payload.usageSeal, seal);
  assert.equal(f.coordinator.list()[0].providerTurn.admissionSeq, admitted[1].seq);
  assert.equal(f.coordinator.list()[0].providerTurn.sealed, false);
});

test('PG3/PG5: governed emulated steer composes sealed interrupt plus separately admitted turn', async () => {
  const seal = { tokens: 'reported', usd: 'reported', counterId: 'turn-1', tokenMetric: 'stub-total' };
  const ad = adapter({ stopSeal: seal, emulatedSteer: true }); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-emulated-steer', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id);
  const result = await f.coordinator.send(handle.id, 'redirect', 'steer');
  assert.equal(result.followUp, 'admitted');
  assert.equal(ad.calls.interrupt, 1); assert.deepEqual(ad.calls.promptModes, ['turn']);
  assert.equal(f.log.read(handle.id).filter((event) => event.kind === 'resource.provider_turn_admitted').length, 2);
});

test('PG1: a governed alias route rejects a different observed model instead of accepting any alias expansion', async () => {
  const ad = adapter(); const original = ad.card;
  ad.card = () => ({ ...original(), modelSelection: { ...original().modelSelection, configuredDefault: 'alias', available: ['alias'], acceptedAliases: ['alias'] } });
  const f = system(ad, { providerGovernance: policy({ model: 'alias' }) });
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-alias-exact', model: 'alias', effort: 'low' });
  ad.emit(handle.id, 'resource.tokens', { source: 'stub', counterId: 'turn-1', accounting: 'delta', tokens: 1, usd: 0, tokenMetric: 'stub-total', modelObserved: 'stub-actual' });
  await until(() => ad.calls.kill === 1);
  assert.deepEqual(f.coordinator.list()[0].modelMismatch, { requested: 'alias', observed: 'stub-actual' });
});

test('PG4: malformed and regressing governed telemetry fail closed instead of manufacturing zero or reset credit', async () => {
  for (const [label, events, code] of [
    ['nan', [{ tokens: NaN, usd: 0, accounting: 'delta' }], 'usage_value_invalid'],
    ['sub-nano', [{ tokens: 1, usd: 0.5000000000000001, accounting: 'delta' }], 'usage_value_invalid'],
    ['accounting', [{ tokens: 1, usd: 0, accounting: 'guess' }], 'usage_accounting_invalid'],
    ['regression', [{ tokens: 20, usd: 0, accounting: 'cumulative' }, { tokens: 10, usd: 0, accounting: 'cumulative' }], 'usage_counter_regressed'],
  ]) {
    const ad = adapter(); const f = system(ad);
    const handle = await f.coordinator.spawn('stub', brief(), { taskId: `pg-invalid-${label}`, model: 'stub-1', effort: 'low' });
    for (const event of events) usage(ad, handle.id, { ...event, counterId: `${label}-counter` });
    await until(() => ad.calls.kill === 1);
    assert.equal(f.log.read(handle.id).find((event) => event.kind === 'resource.provider_telemetry_invalid').payload.code, code);
  }
});

test('PG5: provider/tool updates deduplicate by logical ID and the third distinct attempt trips each ceiling once', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-calls', model: 'stub-1', effort: 'low' });
  ad.emit(handle.id, 'resource.provider_call', { callId: 'p1', phase: 'requested' });
  ad.emit(handle.id, 'resource.provider_call', { callId: 'p1', phase: 'completed' });
  ad.emit(handle.id, 'resource.provider_call', { callId: 'p2', phase: 'completed' });
  ad.emit(handle.id, 'content.tool_call', { callId: 't1', phase: 'requested', name: 'Read' });
  ad.emit(handle.id, 'content.tool_call', { callId: 't1', phase: 'completed', name: 'Read' });
  ad.emit(handle.id, 'content.tool_call', { callId: 't2', phase: 'requested', name: 'Test' });
  assert.deepEqual({ providerCalls: f.coordinator.list()[0].providerTurn.providerCalls, toolCalls: f.coordinator.list()[0].providerTurn.toolCalls }, { providerCalls: 2, toolCalls: 2 });
  ad.emit(handle.id, 'resource.provider_call', { callId: 'p3', phase: 'requested' });
  ad.emit(handle.id, 'content.tool_call', { callId: 't3', phase: 'requested', name: 'Edit' });
  await until(() => ad.calls.kill === 1);
  const exceeded = f.log.read(handle.id).filter((event) => event.kind === 'resource.provider_governance_exceeded');
  assert.equal(exceeded.length, 1, 'one sticky first violation owns the stop');
  assert.equal(exceeded[0].payload.code, 'provider_call_limit_exceeded');
});

test('PG3/PG6: replay restores reserve, usage, call counts, seal, and sticky governance outcome without a new provider effect', async () => {
  const ad = adapter(); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'pg-replay', model: 'stub-1', effort: 'low' });
  usage(ad, handle.id);
  ad.emit(handle.id, 'resource.provider_call', { callId: 'p1', phase: 'completed' });
  ad.emit(handle.id, 'content.tool_call', { callId: 't1', phase: 'completed' });
  terminal(ad, handle.id);
  await until(() => f.coordination.task(handle.taskId).status === 'completed');
  f.coordination.releaseWriterLease();
  const replayAdapter = adapter(); const replay = system(replayAdapter, { log: f.log }).coordinator;
  const restored = replay.list()[0];
  assert.equal(replayAdapter.calls.spawn, 0);
  assert.deepEqual(restored.providerTurn.usage, { tokens: 20, usd: 0.2 });
  assert.equal(restored.providerTurn.providerCalls, 1); assert.equal(restored.providerTurn.toolCalls, 1);
  assert.equal(restored.providerTurn.sealed, true); assert.equal(restored.providerTerminalSeal.counterId, 'turn-1');
});
