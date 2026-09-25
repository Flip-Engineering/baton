// provider-services.test.mjs — Issue #317 (docs/50): provider services as a deployment concept.
//
// The pins, one per decision of docs/50:
//
//   D1  the `advanced.services` section validates at open — closed fields, the three credential
//       reference kinds, the usage declaration — and a violation refuses deployment_config_invalid.
//   D2  a route resolves to its service by the explicit `provider` field first, else the model's
//       provider segment, else the harness.
//   D3  services.list is one canonical operation: the CLI parse, the argument contract, and the
//       application dispatch all answer the one derivation.
//   D4  the model list comes from the service's endpoint where one answers, else the declaration,
//       with the typed refusal named on the row.
//   D5  usage visibility: the declared-window accounting, the reset instant (the provider's own
//       word before the declared-window derivation), and the observed rate-limit lane.
//   D6  the typed faults attribute to the service: the doctor's route and usage rows name it, the
//       pre-effect recruit refusal names the service and its reset.
//   D7  a deployment with no services section serializes exactly as before.
//
// Hermetic: temp dirs under os.tmpdir(), an injected fetchImpl, no network, no real provider.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment, routeAdmissionGate } from '../src/application-deployment.mjs';
import { Log } from '../src/log.mjs';
import { ProviderQuotaAuthority } from '../src/route-quota.mjs';
import {
  USAGE_WINDOW_KINDS, deriveServiceUsage, fetchServiceModels, normalizeProviderServices, normalizeServiceClients,
  serviceCredentialReference, serviceForRoute, serviceStateOf, validateServicesListArgs,
} from '../src/provider-services.mjs';

const ZAI_ROUTE = Object.freeze({ harness: 'codex', model: 'zai/glm-5.3-flash', effort: 'low' });
const ZAI_ROUTE_HIGH = Object.freeze({ harness: 'codex', model: 'zai/glm-5.3-flash', effort: 'high' });
const DEEPSEEK_ROUTE = Object.freeze({ harness: 'codex', model: 'deepseek/deepseek-flash', effort: 'low' });
const WINDOW_MS = 5 * 3_600_000; // the fixture declaration: the provider's own "5 hour" window
const QUOTA_TOKENS = 1_000_000;

const serviceFixture = (overrides = {}) => ({
  baseUrl: 'https://services.example.invalid/api',
  credential: { kind: 'env', name: 'BATON_317_FIXTURE_TOKEN' },
  harnesses: ['codex'],
  models: ['glm-5.3-flash'],
  usage: { windowMs: WINDOW_MS, quotaTokens: QUOTA_TOKENS },
  ...overrides,
});

// ── D1: the config contract ──────────────────────────────────────────────────────────────────

test('317-D1: a well-formed services section normalizes to frozen closed records', () => {
  const services = normalizeProviderServices({
    zai: serviceFixture(),
    deepseek: {
      baseUrl: 'https://deepseek.example.invalid',
      credential: { kind: 'file', path: 'deepseek_key.json', jsonPointer: '/deepseek_key' },
      harnesses: ['omp'],
    },
    anthropic: {
      baseUrl: 'https://api.anthropic.example.invalid',
      credential: { kind: 'keychain', service: 'baton-anthropic', account: 'operator' },
      harnesses: ['claude-code'],
      models: ['claude-opus-4-6'],
    },
  });
  assert.equal(services.length, 3);
  const zai = services.find((service) => service.provider === 'zai');
  assert.equal(zai.baseUrl, 'https://services.example.invalid/api');
  assert.deepEqual(zai.usage, { windowMs: WINDOW_MS, quotaTokens: QUOTA_TOKENS });
  assert.deepEqual(serviceCredentialReference(zai), { kind: 'env', reference: 'BATON_317_FIXTURE_TOKEN' });
  const deepseek = services.find((service) => service.provider === 'deepseek');
  assert.equal(deepseek.usage, null, 'no declaration, no usage axis');
  assert.equal(deepseek.models, null, 'no declaration, no model list');
  assert.deepEqual(serviceCredentialReference(deepseek),
    { kind: 'file', reference: 'deepseek_key.json' });
  const anthropic = services.find((service) => service.provider === 'anthropic');
  assert.deepEqual(serviceCredentialReference(anthropic),
    { kind: 'keychain', reference: 'baton-anthropic/operator' });
  assert.ok(Object.isFrozen(services) && Object.isFrozen(zai) && Object.isFrozen(zai.usage));
});

test('317-D1: a malformed section refuses at open with the config code, naming the field', () => {
  const refused = (value, marker) => {
    let thrown = null;
    try { normalizeProviderServices(value); } catch (error) { thrown = error; }
    assert.equal(thrown?.code, 'deployment_config_invalid', `expected refusal for ${marker}`);
    assert.match(thrown.message, /services/u, `the refusal names the section for ${marker}`);
  };
  refused([], 'an array is not the provider-keyed record');
  refused({ ZAI: serviceFixture() }, 'an uppercase provider segment');
  refused({ zai: serviceFixture({ baseUrl: 'ht!tp://' }) }, 'an unparseable baseUrl');
  refused({ zai: serviceFixture({ baseUrl: 'http://provider.example.invalid' }) },
    'plain http off the loopback');
  refused({ zai: serviceFixture({ credential: { kind: 'vault', name: 'X' } }) },
    'a credential kind outside the closed set');
  refused({ zai: serviceFixture({ credential: { kind: 'env', name: '9BAD' } }) },
    'an env name that is not one');
  refused({ zai: serviceFixture({ credential: { kind: 'env', name: 'OK', value: 'sk-live' } }) },
    'a credential carrying a VALUE field');
  refused({ zai: serviceFixture({ harnesses: [] }) }, 'an empty harness list');
  refused({ zai: serviceFixture({ usage: { windowMs: -1, quotaTokens: 5 } }) }, 'a negative window');
  refused({ zai: serviceFixture({ usage: { windowMs: WINDOW_MS } }) }, 'a half usage declaration');
  refused({ zai: serviceFixture({ models: 'glm-5.3-flash' }) }, 'a non-array model list');
  refused({ zai: { ...serviceFixture(), region: 'cn' } }, 'an unsupported entry field');
  // A loopback http base is the fixture admission: it parses.
  const loopback = normalizeProviderServices({
    local: { ...serviceFixture(), baseUrl: 'http://127.0.0.1:8787/v1' },
  });
  assert.equal(loopback[0].baseUrl, 'http://127.0.0.1:8787/v1');
});

test('317-D1: the serviceClients seam section validates its function fields', () => {
  const clients = normalizeServiceClients({ timeoutMs: 1000 });
  assert.equal(clients.timeoutMs, 1000);
  assert.equal(clients.fetchImpl, null, 'unset seams stay null for the deployment default');
  let thrown = null;
  try { normalizeServiceClients({ fetchImpl: 'not-a-function' }); } catch (error) { thrown = error; }
  assert.equal(thrown?.code, 'deployment_config_invalid');
  assert.match(thrown.message, /fetchImpl/u);
  thrown = null;
  try { normalizeServiceClients({ timeoutMs: 0 }); } catch (error) { thrown = error; }
  assert.equal(thrown?.code, 'deployment_config_invalid');
});

// ── D2: route resolution ─────────────────────────────────────────────────────────────────────

test('317-D2: a route resolves to its service by explicit provider, then model segment, then harness', () => {
  const services = normalizeProviderServices({
    zai: serviceFixture(),
    kimi: {
      baseUrl: 'https://kimi.example.invalid',
      credential: { kind: 'env', name: 'BATON_317_FIXTURE_TOKEN' },
      harnesses: ['claude-code'],
    },
  });
  assert.equal(serviceForRoute(services, ZAI_ROUTE)?.provider, 'zai', 'the model segment resolves');
  assert.equal(
    serviceForRoute(services, { harness: 'claude-code', provider: 'kimi', model: 'kimi-k3[1m]', effort: 'low' })?.provider,
    'kimi', 'the explicit provider field wins over a slash-less model id',
  );
  assert.equal(serviceForRoute(services, DEEPSEEK_ROUTE), null, 'an undeclared provider resolves to none');
  assert.equal(serviceForRoute(services, { harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' }), null);
});

// ── D5: the usage derivation ─────────────────────────────────────────────────────────────────

test('317-D5: no declaration and no observed rate limit is an honest absence', () => {
  const service = normalizeProviderServices({
    zai: serviceFixture({ usage: undefined, models: undefined }),
  })[0];
  assert.equal(service.usage, null);
  assert.equal(deriveServiceUsage(service, { observations: [], reset: null, now: Date.now() }), null);
});

test('317-D5: the declared window accounts the deployment\u2019s own token rows, deduplicated per counter', () => {
  const service = normalizeProviderServices({ zai: serviceFixture() })[0];
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const usage = deriveServiceUsage(service, {
    now,
    observations: [
      // In-window delta rows sum.
      { ts: iso(now - 1_000), tokens: 100, accounting: 'delta', counterId: 't-1' },
      { ts: iso(now - 2_000), tokens: 250, accounting: 'delta', counterId: 't-2' },
      // A cumulative counter counts its LATEST in-window value once, never each rewrite.
      { ts: iso(now - 3_000), tokens: 700, accounting: 'cumulative', counterId: 'turn-1' },
      { ts: iso(now - 1_500), tokens: 900, accounting: 'cumulative', counterId: 'turn-1' },
      // Outside the window: accounted nowhere.
      { ts: iso(now - WINDOW_MS - 60_000), tokens: 555_000, accounting: 'delta' },
      // A rate-limit observation is the observed lane, not accounting.
      { ts: iso(now - 500), source: 'rateLimit', rateLimits: { primary: { usedPercent: 41, windowDurationMins: 300, resetsAt: iso(now + 600_000) } } },
    ],
    reset: null,
  });
  assert.equal(usage.usedTokens, 100 + 250 + 900);
  assert.equal(usage.remainingTokens, QUOTA_TOKENS - usage.usedTokens);
  assert.equal(usage.resetAt, null, 'no block was observed, so no reset instant exists');
  assert.equal(usage.resetSource, null);
  assert.deepEqual(usage.observed, {
    primary: { usedPercent: 41, windowDurationMins: 300, resetsAt: iso(now + 600_000) },
  }, 'the provider\u2019s own rate-limit fact rides the row verbatim');
});

test('317-D5: the reset instant is the provider\u2019s own word before the declared-window derivation', () => {
  const service = normalizeProviderServices({ zai: serviceFixture() })[0];
  const now = Date.now();
  const providerReset = new Date(now + 3_600_000).toISOString();
  const withProviderWord = deriveServiceUsage(service, {
    now, observations: [],
    reset: { resetAt: providerReset, observedAt: now - 60_000 },
  });
  assert.equal(withProviderWord.resetAt, providerReset);
  assert.equal(withProviderWord.resetSource, 'provider');
  // The provider's answer named no instant: the declaration derives it from the observation.
  const derived = deriveServiceUsage(service, {
    now, observations: [],
    reset: { resetAt: null, observedAt: now - 60_000 },
  });
  assert.equal(derived.resetAt, new Date(now - 60_000 + WINDOW_MS).toISOString());
  assert.equal(derived.resetSource, 'declared_window');
  // No declaration and no provider word: no invented instant.
  const undeclared = normalizeProviderServices({ zai: serviceFixture({ usage: undefined }) })[0];
  const none = deriveServiceUsage(undeclared, {
    now, observations: [{ ts: new Date(now).toISOString(), source: 'rateLimit', rateLimits: { primary: { usedPercent: 3 } } }],
    reset: { resetAt: null, observedAt: now - 60_000 },
  });
  assert.equal(none.resetAt, null);
  assert.equal(none.resetSource, null);
  assert.equal(none.usedTokens, null, 'no window, no accounting');
  assert.equal(none.observed.primary.usedPercent, 3);
});

// ── D4: the model-list read ─────────────────────────────────────────────────────────────────

test('317-D4: the endpoint answer parses; every failure degrades typed', async () => {
  const service = normalizeProviderServices({ zai: serviceFixture() })[0];
  const seen = [];
  const okFetch = async (url, options) => {
    seen.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'glm-5.3-flash' }, { id: 'glm-5.3' }] }) };
  };
  const answer = await fetchServiceModels(service, { fetchImpl: okFetch, credential: 'token-value' });
  assert.deepEqual(answer.models, ['glm-5.3-flash', 'glm-5.3']);
  assert.equal(seen[0].url, 'https://services.example.invalid/api/models');
  assert.equal(seen[0].options.headers.authorization, 'Bearer token-value');

  const statusRefusal = await fetchServiceModels(service, {
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    credential: 'token-value',
  }).then(() => null, (error) => error);
  assert.equal(statusRefusal?.code, 'service_models_unavailable');
  assert.equal(statusRefusal?.detail.status, 401);

  const shapeRefusal = await fetchServiceModels(service, {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ notData: true }) }),
    credential: 'token-value',
  }).then(() => null, (error) => error);
  assert.equal(shapeRefusal?.code, 'service_models_unavailable');
  assert.equal(shapeRefusal?.detail.cause, 'model_list_shape');

  const absent = await fetchServiceModels(service, {
    fetchImpl: okFetch, credential: null,
  }).then(() => null, (error) => error);
  assert.equal(absent?.code, 'service_credential_absent',
    'a declared credential that resolved to nothing refuses before any request');

  const noFetch = await fetchServiceModels(service, { credential: 'token-value' })
    .then(() => null, (error) => error);
  assert.equal(noFetch?.code, 'service_models_unavailable');
  assert.equal(noFetch?.detail.cause, 'fetch_impl_absent');
});

// ── the aggregate state ──────────────────────────────────────────────────────────────────────

test('317: the service state aggregates its member routes\u2019 own verdicts', () => {
  assert.equal(serviceStateOf([]), 'unrouted');
  assert.equal(serviceStateOf(['ready', 'blocked']), 'ready');
  assert.equal(serviceStateOf(['degraded', 'blocked']), 'degraded');
  assert.equal(serviceStateOf(['blocked', 'blocked']), 'blocked');
});

// ── the list argument contract ───────────────────────────────────────────────────────────────

test('317-D3: the services.list argument contract is closed and typed', () => {
  assert.deepEqual(validateServicesListArgs(undefined), { provider: null });
  assert.deepEqual(validateServicesListArgs({ provider: 'zai' }), { provider: 'zai' });
  const refusal = (args, rule) => {
    let thrown = null;
    try { validateServicesListArgs(args); } catch (error) { thrown = error; }
    assert.equal(thrown?.code, 'services_list_invalid');
    assert.equal(thrown?.detail?.rule, rule);
  };
  refusal({ provider: '' }, 'field-predicate');
  refusal('zai', 'arguments-shape');
});

// ── the deployment wiring (D3/D5/D6/D7) ──────────────────────────────────────────────────────

function repository(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-services-317-${name}-`));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'provider-services@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Provider services'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# provider services fixture\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function fixtureAdapter(harness, routes) {
  const adapter = new MockAdapter({
    harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    concurrencyCeiling: null,
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact',
      configuredDefault: routes[0].model,
      available: [...new Set(routes.map((route) => route.model))],
      family: harness,
      acceptedPrefixes: [],
      acceptedAliases: [],
      reasoningEffort: [...new Set(routes.map((route) => route.effort))],
      serviceTier: null,
      provenance: 'provider-services-fixture',
      refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: [] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: [] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });
  return adapter;
}

async function openDeployment(t, name, routes, advancedExtra = {}) {
  const repo = repository(t, name);
  const root = join(mkdtempSync(join(tmpdir(), `baton-services-317-${name}-owner-`)), 'deployment');
  t.after(() => rmSync(join(root, '..'), { force: true, recursive: true }));
  mkdirSync(join(root, '..'), { recursive: true });
  const byHarness = new Map();
  for (const route of routes) {
    const rows = byHarness.get(route.harness) ?? [];
    rows.push(route);
    byHarness.set(route.harness, rows);
  }
  const adapters = Object.fromEntries(
    [...byHarness].map(([harness, rows]) => [harness, fixtureAdapter(harness, rows)]),
  );
  let driverOptions = null;
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters,
      routes,
      verification: { command: process.execPath, arguments: ['--version'] },
      ...advancedExtra,
    },
  }, (options) => {
    driverOptions = options;
    return createDriver(options);
  });
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the fixture */ } });
  return { deployment, driverOptions };
}

function appendTokens(log, worker, route, tokens) {
  return log.append({
    worker, harness: route.harness, turnEpoch: 1, kind: 'resource.tokens', actor: 'worker',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: { tokens, accounting: 'delta', counterId: `${worker}-1` },
  });
}

function appendQuotaCrash(log, worker, route, text) {
  return log.append({
    worker, harness: route.harness, turnEpoch: 1, kind: 'lifecycle.crashed', actor: 'worker',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: { error: text, usageSeal: null },
  });
}

test('317-D3/D5/D6: the doctor carries the services section, the rows name their service, and services.list answers the live model pull', async (t) => {
  const now = Date.now();
  const modelsAnswer = { data: [{ id: 'glm-5.3-flash' }, { id: 'glm-5.3-air' }] };
  const fetchCalls = [];
  const { deployment, driverOptions } = await openDeployment(t, 'doctor', [ZAI_ROUTE, ZAI_ROUTE_HIGH, DEEPSEEK_ROUTE], {
    resident: { env: { ...process.env, BATON_317_FIXTURE_TOKEN: 'fixture-token' } },
    services: {
      zai: serviceFixture(),
      idle: {
        baseUrl: 'https://idle.example.invalid',
        credential: { kind: 'env', name: 'BATON_317_FIXTURE_TOKEN' },
        harnesses: ['omp'],
        usage: { windowMs: WINDOW_MS, quotaTokens: 5000 },
      },
    },
    serviceClients: {
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, authorization: options?.headers?.authorization ?? null });
        return { ok: true, status: 200, json: async () => modelsAnswer };
      },
      timeoutMs: 1000,
    },
  });
  const log = new Log(driverOptions.logDir);
  // In-window sends on both zai routes; one send far outside the window; one on deepseek, which
  // declares nothing. The window reads the event's stamped ts, so the old send rides a wound-back
  // clock on the same append path (the Log's injectable clock).
  const clocked = new Log(driverOptions.logDir, () => new Date(now - WINDOW_MS - 60_000).toISOString());
  appendTokens(log, 'w-1', ZAI_ROUTE, 1000);
  appendTokens(log, 'w-2', ZAI_ROUTE_HIGH, 2000);
  appendTokens(clocked, 'w-3', ZAI_ROUTE, 900_000);
  appendTokens(log, 'w-4', DEEPSEEK_ROUTE, 7000);

  const doctor = await deployment.doctor();
  assert.ok(Array.isArray(doctor.services), 'the doctor carries the services section');
  const zai = doctor.services.find((service) => service.provider === 'zai');
  assert.equal(zai.state, 'ready');
  assert.deepEqual(zai.routes.map((route) => `${route.harness}/${route.model}@${route.effort}`).sort(),
    ['codex/zai/glm-5.3-flash@high', 'codex/zai/glm-5.3-flash@low'],
    'the service names the routes derived from it');
  assert.deepEqual(zai.credential, { kind: 'env', reference: 'BATON_317_FIXTURE_TOKEN' },
    'the credential rides as a reference, never a value');
  assert.equal(zai.usage.usedTokens, 3000, 'the accounting windows the deployment\u2019s own rows');
  assert.equal(zai.usage.remainingTokens, QUOTA_TOKENS - 3000);
  assert.equal(zai.usage.resetAt, null, 'nothing was observed — no instant is invented');
  const idle = doctor.services.find((service) => service.provider === 'idle');
  assert.equal(idle.state, 'unrouted', 'a service no route resolves to says so');
  assert.equal(idle.usage.usedTokens, 0);

  // D6: the route and usage rows name their service.
  const zaiRouteRow = doctor.routes.find((row) => row.model === ZAI_ROUTE.model && row.effort === 'low');
  assert.equal(zaiRouteRow.service, 'zai', 'the doctor route row names its service');
  const deepseekRouteRow = doctor.routes.find((row) => row.model === DEEPSEEK_ROUTE.model);
  assert.equal(deepseekRouteRow.service, null, 'an undeclared provider names no service');
  const zaiUsageRow = doctor.routeUsage.find((row) => row.route.model === ZAI_ROUTE.model && row.route.effort === 'low');
  assert.equal(zaiUsageRow.service, 'zai', 'the usage row names its service');

  // D3/D4: the verb answers the endpoint's model list with the resolved credential, and the
  // provider filter narrows to one service.
  const answer = await deployment.servicesList({ provider: 'zai' });
  assert.equal(answer.services.length, 1);
  assert.deepEqual(answer.services[0].models, ['glm-5.3-flash', 'glm-5.3-air'],
    'the models come from the provider\u2019s own endpoint answer');
  assert.equal(answer.services[0].modelsSource, 'endpoint');
  assert.equal(answer.services[0].credentialState, 'resolved');
  assert.equal(fetchCalls[0].url, 'https://services.example.invalid/api/models');
  assert.equal(fetchCalls[0].authorization, 'Bearer fixture-token');

  const all = await deployment.servicesList({});
  assert.equal(all.services.length, 2);
  const idleListed = all.services.find((service) => service.provider === 'idle');
  assert.deepEqual(idleListed.models, ['glm-5.3-flash', 'glm-5.3-air'],
    'a service with no declared models reads the endpoint answer');
  assert.equal(idleListed.modelsSource, 'endpoint');
});

test('317-D4: a failed model pull degrades the row to the declaration and names the typed cause', async (t) => {
  const { deployment } = await openDeployment(t, 'degrade', [ZAI_ROUTE], {
    resident: { env: { ...process.env } }, // no BATON_317_FIXTURE_TOKEN: the reference resolves to nothing
    services: { zai: serviceFixture() },
    serviceClients: {
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
      timeoutMs: 1000,
    },
  });
  const answer = await deployment.servicesList({});
  const row = answer.services[0];
  assert.equal(row.modelsSource, 'declaration', 'the declaration answers when the endpoint cannot');
  assert.deepEqual(row.models, ['glm-5.3-flash']);
  assert.equal(row.credentialState, 'absent');
  assert.equal(row.modelsRefusal.code, 'service_credential_absent',
    'the credential absence refuses before any request, and the row names it');
});

test('317-D5/D6: a quota block with no provider instant reads the declared-window reset, on the row and in the pre-effect refusal', async (t) => {
  const now = Date.now();
  const { deployment, driverOptions } = await openDeployment(t, 'reset', [ZAI_ROUTE, DEEPSEEK_ROUTE], {
    resident: { env: { ...process.env, BATON_317_FIXTURE_TOKEN: 'fixture-token' } },
    services: { zai: serviceFixture() },
    serviceClients: { fetchImpl: async () => { throw new Error('never called'); }, timeoutMs: 1000 },
  });
  const log = new Log(driverOptions.logDir);
  // The provider's own words name the window but NO instant: the 2026-09-14 GLM shape (#295).
  appendQuotaCrash(log, 'w-quota', ZAI_ROUTE, 'Usage limit reached for 5 hour. Your quota will recover after the window.');

  const doctor = await deployment.doctor();
  const zai = doctor.services.find((service) => service.provider === 'zai');
  assert.equal(zai.state, 'blocked', 'the service reads its member route\u2019s verdict');
  const usageRow = doctor.routeUsage.find((row) => row.route.model === ZAI_ROUTE.model);
  assert.equal(usageRow.state, 'blocked');
  assert.equal(usageRow.resetAt, null, 'the provider named no instant — the route row says so');
  assert.ok(zai.usage.resetAt !== null, 'the service row derives the reset from the declaration');
  assert.equal(zai.usage.resetSource, 'declared_window');
  const observedAt = Date.parse(doctor.routes.find((row) => row.model === ZAI_ROUTE.model).quotaBlockedSince);
  assert.equal(Date.parse(zai.usage.resetAt), observedAt + WINDOW_MS,
    'the derivation is the observation plus the declared window');

  // The pre-effect refusal names the service and the reset the service record derived.
  await assert.rejects(
    deployment.run('do the work', { exact: ZAI_ROUTE }),
    (error) => {
      assert.equal(error?.state, 'blocked');
      assert.equal(error?.service?.provider, 'zai', 'the refusal names the service');
      assert.equal(error?.service?.resetAt, zai.usage.resetAt, 'the refusal carries the service record\u2019s reset');
      assert.equal(error?.service?.resetSource, 'declared_window');
      assert.ok(error.message.includes(zai.usage.resetAt), 'and the message spells the instant');
      return true;
    },
  );

  // A route on an undeclared provider keeps the refusal shape it always had.
  appendQuotaCrash(log, 'w-quota-2', DEEPSEEK_ROUTE, 'Usage limit reached for 5 hour.');
  await assert.rejects(
    deployment.run('do the work', { exact: DEEPSEEK_ROUTE }),
    (error) => {
      assert.equal(error?.state, 'blocked');
      assert.equal(error?.service, undefined, 'no service record, no service field');
      return true;
    },
  );
});

test('317-D6: a provider-stated reset stays the provider\u2019s word on the service row and in the refusal', async (t) => {
  const now = Date.now();
  const resetAt = new Date(now + 2 * 3_600_000).toISOString();
  const { deployment, driverOptions } = await openDeployment(t, 'provider-word', [ZAI_ROUTE, DEEPSEEK_ROUTE], {
    resident: { env: { ...process.env, BATON_317_FIXTURE_TOKEN: 'fixture-token' } },
    services: { zai: serviceFixture() },
    serviceClients: { fetchImpl: async () => { throw new Error('never called'); }, timeoutMs: 1000 },
  });
  const log = new Log(driverOptions.logDir);
  appendQuotaCrash(log, 'w-quota', ZAI_ROUTE, `You've hit your usage limit for the day. Please try again at ${resetAt}.`);

  const doctor = await deployment.doctor();
  const zai = doctor.services.find((service) => service.provider === 'zai');
  assert.equal(zai.usage.resetAt, resetAt, 'the provider\u2019s own instant wins over the declaration');
  assert.equal(zai.usage.resetSource, 'provider');
  await assert.rejects(
    deployment.run('do the work', { exact: ZAI_ROUTE }),
    (error) => {
      assert.equal(error?.service?.provider, 'zai');
      assert.equal(error?.service?.resetAt, resetAt);
      assert.equal(error?.service?.resetSource, 'provider');
      return true;
    },
  );
});

// ── #491: the declared window SHAPE, beside the reset instant it qualifies ────────────────────

test('491-D1: a declaration may name its window shape from the closed set, and an unknown shape refuses', () => {
  const declared = normalizeProviderServices({
    zai: serviceFixture({ usage: { windowMs: WINDOW_MS, quotaTokens: QUOTA_TOKENS, windowKind: 'rolling' } }),
  })[0];
  assert.equal(declared.usage.windowKind, 'rolling', 'the declared shape is published with the declaration');
  assert.deepEqual(USAGE_WINDOW_KINDS, ['rolling', 'fixed_clock']);
  const undeclared = normalizeProviderServices({ zai: serviceFixture() })[0];
  assert.deepEqual(undeclared.usage, { windowMs: WINDOW_MS, quotaTokens: QUOTA_TOKENS },
    'a declaration that names no shape keeps the record it has always published');
  assert.throws(
    () => normalizeProviderServices({
      zai: serviceFixture({ usage: { windowMs: WINDOW_MS, quotaTokens: QUOTA_TOKENS, windowKind: 'hourly' } }),
    }),
    (error) => {
      assert.equal(error?.code, 'deployment_config_invalid');
      assert.match(error.message, /windowKind must be one of: rolling, fixed_clock/u,
        'the refusal names the closed set it judged');
      return true;
    },
  );
});

test('491-D5: the derived usage row carries the declared shape, or unknown when nothing is declared', () => {
  const rolling = normalizeProviderServices({
    zai: serviceFixture({ usage: { windowMs: WINDOW_MS, quotaTokens: QUOTA_TOKENS, windowKind: 'rolling' } }),
  })[0];
  const withShape = deriveServiceUsage(rolling, { now: 1_760_000_000_000 });
  assert.deepEqual(withShape.quotaWindow, { kind: 'rolling', periodMs: WINDOW_MS },
    'the declared shape and its period ride the usage row');
  const plain = deriveServiceUsage(normalizeProviderServices({ zai: serviceFixture() })[0],
    { now: 1_760_000_000_000 });
  assert.deepEqual(plain.quotaWindow, { kind: 'unknown', periodMs: WINDOW_MS },
    'a declaration that names no shape reads unknown — never a guessed one');
  assert.equal(deriveServiceUsage(normalizeProviderServices({
    deepseek: {
      baseUrl: 'https://deepseek.example.invalid',
      credential: { kind: 'env', name: 'BATON_317_FIXTURE_TOKEN' },
      harnesses: ['omp'],
    },
  })[0], { now: 1_760_000_000_000 }), null, 'no usage declaration, no usage row');
});

test('491-D5/D6: the doctor row, the route row and the refusal read the declared shape beside the reset', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'window-shape', [ZAI_ROUTE, DEEPSEEK_ROUTE], {
    resident: { env: { ...process.env, BATON_317_FIXTURE_TOKEN: 'fixture-token' } },
    services: {
      zai: serviceFixture({
        usage: { windowMs: WINDOW_MS, quotaTokens: QUOTA_TOKENS, windowKind: 'rolling' },
      }),
    },
    serviceClients: { fetchImpl: async () => { throw new Error('never called'); }, timeoutMs: 1000 },
  });
  const log = new Log(driverOptions.logDir);
  // The provider names its window but no instant: the reset is the declaration's derivation, and
  // the shape says whether that boundary can move when the route is used again.
  appendQuotaCrash(log, 'w-quota', ZAI_ROUTE, 'Usage limit reached for 5 hour. Your quota will recover after the window.');

  const doctor = await deployment.doctor();
  const zai = doctor.services.find((service) => service.provider === 'zai');
  assert.deepEqual(zai.usage.quotaWindow, { kind: 'rolling', periodMs: WINDOW_MS },
    'the service row reads the declared shape');
  const usageRow = doctor.routeUsage.find((row) => row.route.model === ZAI_ROUTE.model);
  assert.deepEqual(usageRow.quota.window, { kind: 'rolling', periodMs: WINDOW_MS },
    'the route row carries the shape beside the reset it qualifies');
  assert.equal(usageRow.quota.state, 'exhausted');
  const deepseekRow = doctor.routeUsage.find((row) => row.route.model === DEEPSEEK_ROUTE.model);
  assert.equal(deepseekRow.quota.window, undefined,
    'a route resolving to no declared usage window keeps the quota shape it always had');

  await assert.rejects(
    deployment.run('do the work', { exact: ZAI_ROUTE }),
    (error) => {
      assert.deepEqual(error?.service?.window, { kind: 'rolling', periodMs: WINDOW_MS },
        'the refusal carries the shape a machine reader acts on');
      assert.match(error.message, /declared rolling 5 h window from the observed block/u,
        'and its text reads the boundary kind, not one bare timestamp');
      return true;
    },
  );
});

test('317-D7: a deployment with no services section publishes the shapes it always did', async (t) => {
  const { deployment } = await openDeployment(t, 'absent', [ZAI_ROUTE]);
  const doctor = await deployment.doctor();
  assert.equal(doctor.services, undefined, 'no section without the declaration');
  assert.equal(doctor.routes[0].service, undefined, 'no service field on the route rows');
  assert.equal(doctor.routeUsage[0].service, undefined, 'no service field on the usage rows');
  const summary = deployment.application?.deploymentSummary?.() ?? null;
  if (summary !== null) assert.equal(summary.services, undefined, 'the summary shape is unchanged');
  const answer = await deployment.servicesList({});
  assert.deepEqual(answer, { schemaVersion: 1, services: [] }, 'the verb answers an honest empty list');
});

test('317-D6: the admission gate names the service record\u2019s reset when the provider named none', () => {
  // The gate itself, read against a quota authority whose recorded block carries no instant:
  // the derived window reset comes from the service record, never from the provider's prose.
  const now = 1_760_000_000_000;
  const services = normalizeProviderServices({ zai: serviceFixture() });
  const quota = new ProviderQuotaAuthority({ now: () => now, maxEntries: 4 });
  quota.record(ZAI_ROUTE, { resetAt: null, at: now - 60_000 });
  const readiness = Object.freeze({
    routes: Object.freeze([
      Object.freeze({ ...ZAI_ROUTE, state: 'ready' }),
      Object.freeze({ ...DEEPSEEK_ROUTE, state: 'ready' }),
    ]),
  });
  const gate = routeAdmissionGate(readiness, quota, null, null, services);
  let thrown = null;
  try { gate({ exact: ZAI_ROUTE }); } catch (error) { thrown = error; }
  assert.equal(thrown?.state, 'blocked');
  assert.equal(thrown?.service?.provider, 'zai');
  assert.equal(thrown?.service?.resetAt, new Date(now - 60_000 + WINDOW_MS).toISOString());
  assert.equal(thrown?.service?.resetSource, 'declared_window');
  assert.ok(thrown.message.includes(thrown.service.resetAt));
  // The same gate without the services table keeps the refusal it always had.
  const bare = routeAdmissionGate(readiness, quota, null, null);
  thrown = null;
  try { bare({ exact: ZAI_ROUTE }); } catch (error) { thrown = error; }
  assert.equal(thrown?.service, undefined);
  assert.ok(thrown.message.includes('until a later turn on it succeeds'));
});
