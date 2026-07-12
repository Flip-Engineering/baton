import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CapabilityRegistry, createDriver } from '../src/index.mjs';

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
    async reverify(claim, args, ctx) { calls.push({ action: 'reverify', claim, args, ctx }); return { ok: claim.digest === args.digest }; },
    ...overrides,
  };
}

const registry = (capability = fixture(), overrides = {}) => new CapabilityRegistry({
  capabilities: { fixture: capability },
  maxBudgetTokens: 1_000,
  maxEnvelopeBytes: 64 * 1024,
  root: '/trusted/repository',
  ...overrides,
});

test('CI1/CI2/CI5/CI7: closed cards invoke with trusted context and bounded provenance-only audit', async () => {
  const capability = fixture(); const events = [];
  const subject = registry(capability, { record: (event) => events.push(event) });
  assert.deepEqual(subject.cards(), [{ name: 'fixture', version: '1', ops: { 'fixture.read': { reverifiable: true } } }]);
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
});

test('CI1/CI2/CI7: registration, cards, JSON inputs, operations, budgets, and envelopes fail closed', async () => {
  assert.throws(() => new CapabilityRegistry({ capabilities: {}, maxBudgetTokens: 1 }), /maxEnvelopeBytes/);
  assert.throws(() => new CapabilityRegistry({ capabilities: { bad: {} }, maxBudgetTokens: 1, maxEnvelopeBytes: 100 }), /invalid capability registration/);
  assert.throws(() => registry(fixture({ card: () => ({ ops: {} }) })), /invalid capability card/);
  await assert.rejects(registry().invoke('missing', 'fixture.read', {}, { budgetTokens: 10 }), (error) => error.code === 'capability_not_found');
  await assert.rejects(registry().invoke('fixture', 'fixture.write', {}, { budgetTokens: 10 }), (error) => error.code === 'capability_op_unavailable');
  await assert.rejects(registry().invoke('fixture', 'fixture.read', {}, { budgetTokens: 0 }), (error) => error.code === 'capability_budget_invalid');
  await assert.rejects(registry().invoke('fixture', 'fixture.read', {}, { budgetTokens: 1_001 }), (error) => error.code === 'capability_budget_invalid');
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(registry().invoke('fixture', 'fixture.read', cyclic, { budgetTokens: 10 }), (error) => error.code === 'capability_args_invalid');
  const malformed = fixture({ invoke: async () => ({ op: 'fixture.read', status: 'ok' }) });
  await assert.rejects(registry(malformed).invoke('fixture', 'fixture.read', {}, { budgetTokens: 10 }), (error) => error.code === 'capability_result_invalid');
  const oversizedPayload = fixture({ invoke: async (op) => envelope(op, 'x'.repeat(100)) });
  await assert.rejects(registry(oversizedPayload).invoke('fixture', 'fixture.read', {}, { budgetTokens: 2 }), (error) => error.code === 'capability_result_oversize');
  const oversizedEnvelope = fixture({ invoke: async (op) => envelope(op, 1, { summary: 'x'.repeat(2_000) }) });
  await assert.rejects(registry(oversizedEnvelope, { maxEnvelopeBytes: 1_000 }).invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 }), (error) => error.code === 'capability_result_oversize');
});

test('CI2/CI4: cancellation and coordinator-authority smuggling are rejected and audited', async () => {
  const events = []; const abort = new AbortController(); abort.abort();
  await assert.rejects(registry(fixture(), { record: (event) => events.push(event) }).invoke('fixture', 'fixture.read', {}, { budgetTokens: 10, signal: abort.signal }), (error) => error.code === 'cancelled');
  const smuggler = fixture({ invoke: async (op) => envelope(op, 1, { provenance: { mergeAuthority: true, verificationAuthority: false } }) });
  await assert.rejects(registry(smuggler, { record: (event) => events.push(event) }).invoke('fixture', 'fixture.read', {}, { budgetTokens: 100 }), (error) => error.code === 'capability_authority_forbidden');
  assert.equal(events.at(-1).kind, 'capability.op.refused');
  assert.equal(events.at(-1).code, 'capability_authority_forbidden');
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

test('CI1/CI5/CI7: createDriver explicitly assembles one registry behind Coordinator and durable log evidence', async () => {
  const repoRoot = root('repo'); const logDir = root('log'); const capability = fixture();
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repoRoot });
  assert.throws(() => createDriver({ repoRoot, logDir, adapters: {}, capabilities: { fixture: capability } }), /deployment-derived/);
  const driver = createDriver({
    repoRoot, logDir, adapters: {}, capabilities: { fixture: capability },
    maxCapabilityBudgetTokens: 1_000, maxCapabilityEnvelopeBytes: 64 * 1024,
  });
  assert.equal(driver.coordinator.capabilityCards()[0].name, 'fixture');
  const result = await driver.coordinator.invokeCapability('fixture', 'fixture.read', { query: 'private' }, { budgetTokens: 100, actor: 'orchestrator' });
  assert.equal(result.status, 'ok'); assert.equal(capability.calls[0].ctx.root, repoRoot);
  const evidence = driver.log.read('hub-capability');
  assert.deepEqual(evidence.map((event) => event.kind), ['capability.op.started', 'capability.op.completed']);
  assert.equal(JSON.stringify(evidence).includes('private'), false);
  assert.ok(driver.coordination.snapshot().evidence.length >= 2);
});
