import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AtlasStructuralDelta, CapabilityRegistry, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-capability-${name}-`));
const envelope = (op, value = 1, overrides = {}) => ({
  op,
  status: 'ok',
  summary: 'bounded result',
  payload: [{ value }],
  refs: [{ kind: 'test', digest: 'a'.repeat(64) }],
  cost: { tokens_out: 4, wall_ms: 1, usd: 0, underlying: 'fixture' },
  provenance: { deterministic: true, mergeAuthority: false, verificationAuthority: false },
  ...overrides,
});

function fixture(overrides = {}) {
  const calls = [];
  return {
    calls,
    card() { return { name: 'fixture', version: '1', ops: { 'fixture.read': { reverifiable: true } } }; },
    async invoke(op, args, ctx) { calls.push({ action: 'invoke', op, args, ctx }); return envelope(op); },
    async resume(ref, cursor, ctx) { calls.push({ action: 'resume', ref, cursor, ctx }); return envelope('fixture.read'); },
    async reverify(claim, op, args, ctx) { calls.push({ action: 'reverify', claim, op, args, ctx }); return { ok: claim.digest === args.digest }; },
    ...overrides,
  };
}

const registry = (capability = fixture(), overrides = {}) => new CapabilityRegistry({
  capabilities: { fixture: capability },
  maxBudgetTokens: 1_000,
  maxEnvelopeBytes: 64 * 1024,
  root: '/trusted/repository',
  record: () => {},
  ...overrides,
});

test('CI1/CI2/CI5/CI7: closed cards invoke with trusted context and bounded provenance-only audit', async () => {
  const capability = fixture(); const events = [];
  const subject = registry(capability, { record: (event) => events.push(event) });
  assert.deepEqual(subject.cards(), [{
    name: 'fixture', version: '1', ops: { 'fixture.read': { reverifiable: true } },
    actions: { invoke: true, resume: true, reverify: true, cancel: false },
    northbound: { inlineOps: ['fixture.read'], taskOpsRequiringTaskPlane: [] },
  }]);
  const result = await subject.invoke('fixture', 'fixture.read', { query: 'TOP-SECRET-ARGUMENT' }, { budgetTokens: 100, actor: 'web:user:session' });
  assert.equal(result.status, 'ok');
  assert.deepEqual(capability.calls[0], {
    action: 'invoke', op: 'fixture.read', args: { query: 'TOP-SECRET-ARGUMENT' },
    ctx: { budgetTokens: 100, signal: undefined, actor: 'web:user:session', root: '/trusted/repository' },
  });
  assert.deepEqual(events.map((event) => event.kind), ['capability.op.started', 'capability.op.completed']);
  assert.equal(events[0].invocationId, events[1].invocationId);
  assert.equal(JSON.stringify(events).includes('TOP-SECRET-ARGUMENT'), false);
  assert.deepEqual(events[1].digests, ['a'.repeat(64)]);
  assert.deepEqual(events[1].cost, { tokens_out: 4, wall_ms: 1, usd: 0, underlying: 'fixture' });
  assert.deepEqual(events[1].refs, [{ kind: 'test', digest: 'a'.repeat(64) }]);
});

test('CI1/CI2/CI7: registration, cards, JSON inputs, operations, budgets, and envelopes fail closed', async () => {
  assert.throws(() => new CapabilityRegistry({ capabilities: {}, maxBudgetTokens: 1 }), /maxEnvelopeBytes/);
  assert.throws(() => new CapabilityRegistry({ capabilities: { fixture: fixture() }, maxBudgetTokens: 1, maxEnvelopeBytes: 1_000 }), /record sink/);
  assert.throws(() => new CapabilityRegistry({ capabilities: { bad: {} }, maxBudgetTokens: 1, maxEnvelopeBytes: 100, record: () => {} }), /invalid capability registration/);
  assert.throws(() => registry(fixture({ card: () => ({ ops: {} }) })), /invalid capability card/);
  assert.throws(() => registry(fixture(), { contexts: { missing: {} } }), /context has no registration/);
  await assert.rejects(registry().invoke('missing', 'fixture.read', {}, { budgetTokens: 10 }), (error) => error.code === 'capability_not_found');
  await assert.rejects(registry().invoke('fixture', 'fixture.write', {}, { budgetTokens: 10 }), (error) => error.code === 'capability_op_unavailable');
  await assert.rejects(registry().invoke('fixture', 'fixture.read', {}, { budgetTokens: 0 }), (error) => error.code === 'capability_budget_invalid');
  await assert.rejects(registry().invoke('fixture', 'fixture.read', {}, { budgetTokens: 1_001 }), (error) => error.code === 'capability_budget_invalid');
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(registry().invoke('fixture', 'fixture.read', cyclic, { budgetTokens: 10 }), (error) => error.code === 'capability_args_invalid');
  const malformed = fixture({ invoke: async () => ({ op: 'fixture.read', status: 'ok' }) });
  await assert.rejects(registry(malformed).invoke('fixture', 'fixture.read', {}, { budgetTokens: 10 }), (error) => error.code === 'capability_result_invalid');
  for (const result of [
    envelope('fixture.read', 1, { status: 'invented' }),
    envelope('fixture.read', 1, { status: 'needs_resume' }),
    envelope('fixture.read', 1, { status: 'ok', cursor: 'unexpected' }),
    envelope('fixture.read', 1, { refs: [{ kind: '', digest: 'bad' }] }),
    envelope('fixture.read', 1, { cost: { tokens_out: -1, wall_ms: 0, usd: 0, underlying: 'fixture' } }),
  ]) {
    const invalid = fixture({ invoke: async () => result });
    await assert.rejects(registry(invalid).invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 }), (error) => error.code === 'capability_result_invalid');
  }
  const resumable = fixture({ invoke: async () => envelope('fixture.read', 1, { status: 'needs_resume', cursor: 'next' }) });
  assert.equal((await registry(resumable).invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 })).cursor, 'next');
  const oversizedPayload = fixture({ invoke: async (op) => envelope(op, 'x'.repeat(100)) });
  await assert.rejects(registry(oversizedPayload).invoke('fixture', 'fixture.read', {}, { budgetTokens: 2 }), (error) => error.code === 'capability_result_oversize');
  const oversizedEnvelope = fixture({ invoke: async (op) => envelope(op, 1, { summary: 'x'.repeat(2_000) }) });
  await assert.rejects(registry(oversizedEnvelope, { maxEnvelopeBytes: 1_000 }).invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 }), (error) => error.code === 'capability_result_oversize');
});

test('CI2/CI7: deployment context resolves multi-root operations but cannot replace registry authority', async () => {
  const capability = fixture();
  const subject = registry(capability, { contexts: { fixture: ({ action, args }) => ({ beforeRoot: `/snapshots/${action}`, overlayEpoch: args.epoch }) } });
  await subject.invoke('fixture', 'fixture.read', { epoch: 'abc' }, { budgetTokens: 100, actor: 'web:user:session' });
  assert.deepEqual(capability.calls[0].ctx, {
    beforeRoot: '/snapshots/invoke', overlayEpoch: 'abc', budgetTokens: 100, signal: undefined,
    actor: 'web:user:session', root: '/trusted/repository',
  });
  const forbidden = registry(fixture(), { contexts: { fixture: { root: '/attacker-controlled' } } });
  await assert.rejects(forbidden.invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 }), (error) => error.code === 'capability_context_forbidden');
  const malformed = registry(fixture(), { contexts: { fixture: () => ({ value: Infinity }) } });
  await assert.rejects(malformed.invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 }), (error) => error.code === 'capability_context_invalid');
});

test('CI2/CI4: cancellation and coordinator-authority smuggling are rejected and audited', async () => {
  const events = []; const abort = new AbortController(); abort.abort();
  await assert.rejects(registry(fixture(), { record: (event) => events.push(event) }).invoke('fixture', 'fixture.read', {}, { budgetTokens: 10, signal: abort.signal }), (error) => error.code === 'cancelled');
  const smuggler = fixture({ invoke: async (op) => envelope(op, 1, { provenance: { mergeAuthority: true, verificationAuthority: false } }) });
  await assert.rejects(registry(smuggler, { record: (event) => events.push(event) }).invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 }), (error) => error.code === 'capability_authority_forbidden');
  const stringSmuggler = fixture({ invoke: async (op) => envelope(op, 1, { provenance: { mergeAuthority: 'true' } }) });
  await assert.rejects(registry(stringSmuggler).invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 }), (error) => error.code === 'capability_authority_forbidden');
  assert.equal(events.at(-1).kind, 'capability.op.refused');
  assert.equal(events.at(-1).code, 'capability_authority_forbidden');
});

test('CI5: provenance sink loss poisons the capability plane before any repeated effect', async () => {
  let effects = 0; const recorded = [];
  const capability = fixture({ invoke: async (op) => { effects += 1; return envelope(op); } });
  const subject = registry(capability, { record: (event) => { recorded.push(event); if (event.kind === 'capability.op.completed') throw new Error('sink lost'); } });
  await assert.rejects(subject.invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 }), (error) => error.code === 'capability_record_unavailable');
  assert.equal(effects, 1); assert.deepEqual(recorded.map((event) => event.kind), ['capability.op.started', 'capability.op.completed']);
  await assert.rejects(subject.invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 }), (error) => error.code === 'capability_record_unavailable');
  assert.throws(() => subject.cards(), (error) => error.code === 'capability_record_unavailable');
  assert.equal(effects, 1); assert.equal(recorded.length, 2);
});

test('CI3: resume and reverify share operation, input, budget, root, and authority policy', async () => {
  const capability = fixture(); const subject = registry(capability); const ctx = { budgetTokens: 100, actor: 'mcp:user:session' };
  const resumed = await subject.resume('fixture', 'fixture.read', { digest: 'a'.repeat(64) }, 'fixture:1', ctx);
  const verified = await subject.reverify('fixture', 'fixture.read', { digest: 'same' }, { digest: 'same' }, ctx);
  assert.equal(resumed.op, 'fixture.read'); assert.equal(verified.status, 'ok'); assert.equal(verified.payload[0].ok, true);
  assert.equal(capability.calls[0].ctx.root, '/trusted/repository'); assert.equal(capability.calls[1].ctx.root, '/trusted/repository');
  await assert.rejects(subject.resume('fixture', 'fixture.write', {}, 'cursor', ctx), (error) => error.code === 'capability_op_unavailable');
  await assert.rejects(subject.resume('fixture', 'fixture.read', {}, '', ctx), (error) => error.code === 'capability_resume_invalid');
  await assert.rejects(subject.reverify('fixture', 'fixture.read', null, {}, ctx), (error) => error.code === 'capability_reverify_invalid');
});

test('CI3: cards advertise action support and quarantine task-class ops from synchronous northbounds', async () => {
  const capability = fixture({
    card: () => ({
      name: 'fixture', version: '1',
      ops: {
        'fixture.read': { latency_class: 'interactive', reverifiable: true },
        'fixture.build': { latency_class: 'task', interruptible: true, reverifiable: true },
      },
    }),
    cancel: async () => {},
  });
  const subject = registry(capability); const card = subject.cards()[0];
  assert.deepEqual(card.actions, { invoke: true, resume: true, reverify: true, cancel: true });
  assert.deepEqual(card.northbound, { inlineOps: ['fixture.read'], taskOpsRequiringTaskPlane: ['fixture.build'] });
  const ctx = { budgetTokens: 100 };
  await assert.rejects(subject.invoke('fixture', 'fixture.build', {}, ctx), (error) => error.code === 'capability_task_requires_task_plane');
  await assert.rejects(subject.resume('fixture', 'fixture.build', { digest: 'a'.repeat(64) }, 'next', ctx), (error) => error.code === 'capability_task_requires_task_plane');
  await assert.rejects(subject.reverify('fixture', 'fixture.build', { digest: 'a'.repeat(64) }, {}, ctx), (error) => error.code === 'capability_task_requires_task_plane');
  assert.deepEqual(capability.calls, [], 'task-class actions must refuse before any capability effect');
  assert.throws(() => registry(fixture({ card: () => ({ name: 'fixture', ops: { bad: { latency_class: 'task', interruptible: false } } }) })), /invalid capability card/);
});

test('CI1/CI5/CI7: createDriver explicitly assembles one registry behind Coordinator and durable log evidence', async () => {
  const repoRoot = root('repo'); const logDir = root('log'); const capability = fixture();
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repoRoot });
  assert.throws(() => createDriver({ repoRoot, logDir, adapters: {}, capabilities: { fixture: capability } }), /deployment-derived/);
  const driver = createDriver({
    repoRoot, logDir, adapters: {}, capabilities: { fixture: capability },
    maxCapabilityBudgetTokens: 1_000, maxCapabilityEnvelopeBytes: 64 * 1024,
  });
  assert.equal(driver.capabilities, undefined, 'createDriver must not publish a coordinator-bypassing registry handle');
  assert.equal(driver.coordinator.capabilityCards()[0].name, 'fixture');
  const result = await driver.coordinator.invokeCapability('fixture', 'fixture.read', { query: 'private' }, { budgetTokens: 100, actor: 'orchestrator' });
  assert.equal(result.status, 'ok'); assert.equal(capability.calls[0].ctx.root, repoRoot);
  const evidence = driver.log.read('hub-capability');
  assert.deepEqual(evidence.map((event) => event.kind), ['capability.op.started', 'capability.op.completed']);
  assert.equal(JSON.stringify(evidence).includes('private'), false);
  assert.ok(driver.coordination.snapshot().evidence.length >= 2);
});

test('CI6-CI8: a real ast-grep Atlas multi-root operation traverses createDriver and reverify', async () => {
  const repoRoot = root('atlas-repo'); const logDir = root('atlas-log');
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  writeFileSync(join(repoRoot, 'before.mjs'), 'export function value() { return 1 }\n');
  writeFileSync(join(repoRoot, 'after.mjs'), 'export function value() { return 2 }\n');
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
  const atlas = new AtlasStructuralDelta({ artifactRoot: root('atlas-artifacts'), maxSourceBytes: 64 * 1024 });
  const driver = createDriver({
    repoRoot, logDir, adapters: {}, capabilities: { 'atlas-structural': atlas },
    capabilityContexts: { 'atlas-structural': { beforeRoot: repoRoot, afterRoot: repoRoot } },
    maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 128 * 1024,
  });
  const args = { beforePath: 'before.mjs', afterPath: 'after.mjs' }; const ctx = { budgetTokens: 2_000, actor: 'orchestrator' };
  const result = await driver.coordinator.invokeCapability('atlas-structural', 'diff.structural', args, ctx);
  assert.equal(result.status, 'ok'); assert.equal(result.payload.some((item) => item.change === 'modified' && item.name === 'value'), true);
  const reverified = await driver.coordinator.reverifyCapability('atlas-structural', 'diff.structural', result, args, ctx);
  assert.equal(reverified.status, 'ok'); assert.equal(reverified.payload[0].ok, true);
  assert.deepEqual(driver.coordinator.capabilityCards().map((card) => card.name), ['atlas-structural']);
});
