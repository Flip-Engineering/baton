import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  normalizeProviderGovernancePolicy,
  providerGovernanceRoute,
  validateProviderGovernanceCard,
} from '../src/provider-governance.mjs';

function route(overrides = {}) {
  return {
    harness: 'codex',
    model: 'gpt-5.6-sol',
    effort: 'low',
    terminalReserve: { tokens: 10_000, usd: 0.25 },
    mode: 'strict',
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    schemaVersion: 1,
    maxWireFrameBytes: 256 * 1024,
    maxProviderCallsPerTurn: 32,
    maxToolCallsPerTurn: 64,
    routes: [
      route(),
      route({ harness: 'grok', model: 'grok-build', terminalReserve: { tokens: 0, usd: 0 }, mode: 'observe' }),
    ],
    ...overrides,
  };
}

const harnesses = ['codex', 'grok'];
const rejects = (value, keys = harnesses) => assert.throws(
  () => normalizeProviderGovernancePolicy(value, keys),
  (error) => error instanceof TypeError && error.code === 'provider_governance_invalid',
);

test('normalization exposes only a deeply immutable path-free projection and deterministic digest', () => {
  const raw = policy();
  const normalized = normalizeProviderGovernancePolicy(raw, harnesses);
  const reordered = normalizeProviderGovernancePolicy({ ...raw, routes: [...raw.routes].reverse() }, [...harnesses].reverse());

  assert.deepEqual(Object.keys(normalized).sort(), ['digest', 'projection']);
  assert.deepEqual(normalized.projection, reordered.projection);
  assert.equal(normalized.digest, reordered.digest);
  assert.match(normalized.digest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.projection), true);
  assert.equal(Object.isFrozen(normalized.projection.routes), true);
  assert.equal(Object.isFrozen(normalized.projection.routes[0].terminalReserve), true);
  assert.deepEqual(Object.keys(normalized.projection).sort(), [
    'maxProviderCallsPerTurn', 'maxToolCallsPerTurn', 'maxWireFrameBytes', 'routes', 'schemaVersion',
  ]);
  assert.equal(JSON.stringify(normalized).includes('/Users/private'), false);
  assert.equal(JSON.stringify(normalized).includes('apiKey'), false);
  assert.throws(() => { normalized.projection.routes[0].mode = 'observe'; }, TypeError);

  raw.routes[0].terminalReserve.tokens = 1;
  assert.equal(providerGovernanceRoute(normalized, 'codex', 'gpt-5.6-sol', 'low').terminalReserve.tokens, 10_000);
});

test('policy route ordering and digest are locale-independent', () => {
  const fixture = fileURLToPath(new URL('./fixtures/provider-governance-locale.js', import.meta.url));
  const run = (locale) => JSON.parse(execFileSync(process.execPath, [fixture, 'run'], {
    encoding: 'utf8', env: { ...process.env, LANG: locale, LC_ALL: locale },
  }));
  const en = run('en_US.UTF-8');
  const tr = run('tr_TR.UTF-8');
  assert.deepEqual(en, tr);
  assert.deepEqual(en.harnesses, ['I', 'i']);
});

test('route lookup is exact across harness, model, and effort and exposes no public Map', () => {
  const normalized = normalizeProviderGovernancePolicy(policy(), harnesses);
  const found = providerGovernanceRoute(normalized, 'grok', 'grok-build', 'low');
  assert.deepEqual(found, {
    harness: 'grok', model: 'grok-build', effort: 'low',
    terminalReserve: { tokens: 0, usd: 0 }, mode: 'observe', digest: found.digest,
  });
  assert.match(found.digest, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(normalized.projection.routes.find((item) => item.harness === 'grok'), 'digest'), false);
  assert.equal(Object.isFrozen(found), true);
  assert.equal(providerGovernanceRoute(normalized, 'Grok', 'grok-build', 'low'), null);
  assert.equal(providerGovernanceRoute(normalized, 'grok', 'GROK-BUILD', 'low'), null);
  assert.equal(providerGovernanceRoute(normalized, 'grok', 'grok-build', 'LOW'), null);
  assert.equal(providerGovernanceRoute(normalized, 'grok', 'grok-build', null), null);
  assert.equal(Object.values(normalized).some((value) => value instanceof Map), false);
  rejects({ ...policy(), projection: {} });
  assert.throws(() => providerGovernanceRoute(policy(), 'codex', 'gpt-5.6-sol', 'low'), /normalized provider governance policy/);
});

test('policy, route, and terminal reserve shapes are closed', () => {
  const base = policy();
  rejects({ ...base, extra: true });
  const missing = { ...base }; delete missing.maxWireFrameBytes; rejects(missing);
  rejects({ ...base, schemaVersion: 2 });
  rejects({ ...base, routes: base.routes.map((item, index) => index === 0 ? { ...item, apiKey: 'secret' } : item) });
  rejects({ ...base, routes: base.routes.map((item, index) => index === 0 ? { ...item, terminalReserve: { ...item.terminalReserve, secret: 'hidden' } } : item) });
  rejects({ ...base, routes: base.routes.map((item, index) => index === 0 ? { ...item, terminalReserve: { tokens: item.terminalReserve.tokens } } : item) });
  rejects({ ...base, routes: base.routes.map((item, index) => index === 0 ? { ...item, mode: 'advisory' } : item) });
});

test('wire, provider-call, and tool-call ceilings require positive bounded safe integers', () => {
  const invalid = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1', null];
  for (const field of ['maxWireFrameBytes', 'maxProviderCallsPerTurn', 'maxToolCallsPerTurn']) {
    for (const value of invalid) rejects(policy({ [field]: value }));
  }
  assert.doesNotThrow(() => normalizeProviderGovernancePolicy(policy({ maxWireFrameBytes: 16 * 1024 * 1024 }), harnesses));
  rejects(policy({ maxWireFrameBytes: 16 * 1024 * 1024 + 1 }));
  for (const field of ['maxProviderCallsPerTurn', 'maxToolCallsPerTurn']) {
    assert.doesNotThrow(() => normalizeProviderGovernancePolicy(policy({ [field]: 100_000 }), harnesses));
    rejects(policy({ [field]: 100_001 }));
  }
});

test('terminal reserves accept exact bounded nano-USD only', () => {
  const withReserve = (terminalReserve) => policy({
    routes: [route({ terminalReserve }), policy().routes[1]],
  });
  assert.doesNotThrow(() => normalizeProviderGovernancePolicy(withReserve({ tokens: 0, usd: 0 }), harnesses));
  assert.doesNotThrow(() => normalizeProviderGovernancePolicy(withReserve({ tokens: 0, usd: 0.000000001 }), harnesses));
  assert.doesNotThrow(() => normalizeProviderGovernancePolicy(withReserve({ tokens: 100_000_000, usd: 1_000_000 }), harnesses));
  rejects(withReserve({ tokens: 100_000_001, usd: 0 }));
  rejects(withReserve({ tokens: 0, usd: 1_000_000.01 }));
  rejects(withReserve({ tokens: 0, usd: 0.0000000001 }));
  rejects(withReserve({ tokens: 0, usd: 0.5000000000000001 }));
  for (const tokens of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1']) rejects(withReserve({ tokens, usd: 0 }));
  for (const usd of [-0.01, Infinity, -Infinity, NaN, '0']) rejects(withReserve({ tokens: 0, usd }));
});

test('bounded identifiers, known harness coverage, route uniqueness, and the 1024-route ceiling fail closed', () => {
  rejects(policy(), []);
  rejects(policy(), ['codex', 'codex', 'grok']);
  rejects(policy(), ['codex', 'grok', '../escape']);
  rejects(policy({ routes: [route(), route({ harness: 'unknown' })] }));
  rejects(policy({ routes: [route(), route()] }), ['codex']);
  rejects(policy({ routes: [route()] }), ['codex', 'grok']);
  rejects(policy({ routes: [route({ model: '../private' }), policy().routes[1]] }));
  rejects(policy({ routes: [route({ effort: 'low effort' }), policy().routes[1]] }));
  rejects(policy({ routes: [route({ model: `m${'x'.repeat(128)}` }), policy().routes[1]] }));

  const exact = Array.from({ length: 1024 }, (_, index) => route({ model: `model-${index}` }));
  assert.equal(normalizeProviderGovernancePolicy(policy({ routes: exact }), ['codex']).projection.routes.length, 1024);
  rejects(policy({ routes: [...exact, route({ model: 'model-over' })] }), ['codex']);
});

test('governance cards are closed and reject contradictory capability claims', () => {
  const card = {
    governance: {
      usage: { tokens: 'native', usd: 'unavailable', tokenMetric: 'input_plus_output', terminalSeal: 'native' },
      providerCalls: { observation: 'native', enforcement: 'unavailable' },
      toolCalls: { observation: 'native', enforcement: 'approval_pre_effect' },
      maxWireFrameBytes: 1024,
    },
  };
  assert.deepEqual(validateProviderGovernanceCard(card), card.governance);
  assert.equal(Object.isFrozen(validateProviderGovernanceCard(card).usage), true);
  for (const governance of [
    { ...card.governance, secret: true },
    { ...card.governance, usage: { ...card.governance.usage, tokenMetric: null } },
    { ...card.governance, usage: { ...card.governance.usage, tokens: 'unavailable' } },
    { ...card.governance, providerCalls: { observation: 'unavailable', enforcement: 'native_pre_effect' } },
    { ...card.governance, toolCalls: { observation: 'unavailable', enforcement: 'approval_pre_effect' } },
    { ...card.governance, maxWireFrameBytes: 16 * 1024 * 1024 + 1 },
  ]) assert.throws(() => validateProviderGovernanceCard({ governance }), /provider governance card/);
});

test('digest binds every public governance field and exact route reserve/mode', () => {
  const base = normalizeProviderGovernancePolicy(policy(), harnesses).digest;
  const variants = [
    policy({ maxWireFrameBytes: 256 * 1024 + 1 }),
    policy({ maxProviderCallsPerTurn: 33 }),
    policy({ maxToolCallsPerTurn: 65 }),
    policy({ routes: [route({ terminalReserve: { tokens: 10_001, usd: 0.25 } }), policy().routes[1]] }),
    policy({ routes: [route({ mode: 'observe' }), policy().routes[1]] }),
  ];
  for (const variant of variants) assert.notEqual(normalizeProviderGovernancePolicy(variant, harnesses).digest, base);
});
