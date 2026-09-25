// issue429-model-profile.test.mjs — Issue #429: the route table carries each model's MEASURED
// profile (Artificial Analysis intelligence / coding index, output speed, time-to-first-token,
// price), so a recruit's route comparison and the doctor rank routes on measured facts rather than
// on the operator's memory.
// Rows:
//   PROFILE-429-A  one keyed fetch answers the catalog and writes the cache; an absent key refuses
//                  typed (`model_profile_credential_absent`), never a request
//   PROFILE-429-B  profileFor: a subscription route nulls the price with reason 'subscription' and
//                  keeps intelligence/coding/tps/ttft; an api route carries the price
//   PROFILE-429-C  the doctor's route table carries the profile for a route with an aaSlug and null
//                  for one without, and reads `credential_absent` degraded — never a refusal of the
//                  doctor — when no key exists
//   PROFILE-429-D  swarm.recruit's routes.considered carries the profile per route
//   PROFILE-429-E  the cache's freshness derives from the limits registry row (and from the
//                  provider's own cache-control when it declares one), never a literal of this file
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, the fetch injected (no network), no
// provider process. The root's real key (if any) is never read: the fixtures pass their own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_BATON_DEPLOYMENT_ROUTES, openBatonDeployment } from '../src/application-deployment.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import {
  AA_CATALOG_URL, MODEL_PROFILE_SHAPE, MODEL_PROFILE_STALENESS_MS,
  fetchModelProfiles, modelProfileReader, profileFor, readCachedCatalog, writeCachedCatalog,
} from '../src/model-profile.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';

const dirs = [];
function tmp(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-429-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// The catalog shape Artificial Analysis answers, reduced to the two routes the fixtures map.
const CATALOG_OBSERVED_AT = '2026-09-17T00:00:00Z';
const CATALOG_BODY = Object.freeze({
  updated_at: CATALOG_OBSERVED_AT,
  data: [
    {
      slug: 'claude-opus-4-6', id: 'model-1', name: 'Claude Opus 4.6',
      model_creator: { slug: 'anthropic', name: 'Anthropic' },
      release_date: '2026-08-01',
      evaluations: {
        artificial_analysis_intelligence_index: 68.4,
        artificial_analysis_coding_index: 61.2,
      },
      median_output_tokens_per_second: 84.5,
      median_time_to_first_token_seconds: 1.9,
      pricing: {
        price_1m_blended_3_to_1: 9.5, price_1m_input_tokens: 5, price_1m_output_tokens: 25,
      },
    },
    {
      slug: 'deepseek-flash', id: 'model-2', name: 'DeepSeek Flash',
      model_creator: { slug: 'deepseek', name: 'DeepSeek' },
      release_date: '2026-07-01',
      evaluations: {
        artificial_analysis_intelligence_index: 52.1,
        artificial_analysis_coding_index: 47.75,
      },
      median_output_tokens_per_second: 210.25,
      median_time_to_first_token_seconds: 0.4,
      pricing: {
        price_1m_blended_3_to_1: 0.42, price_1m_input_tokens: 0.28, price_1m_output_tokens: 0.42,
      },
    },
  ],
});

/** The injected fetch: one response, its headers, and the calls it saw. */
function fakeFetch({ body = CATALOG_BODY, headers = {}, status = 200 } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (Object.hasOwn(headers, name.toLowerCase()) ? headers[name.toLowerCase()] : null) },
      async json() { return body; },
    };
  };
  return { impl, calls };
}

// ── PROFILE-429-A: one keyed request answers the catalog; the cache round-trips; no key refuses ──

test('PROFILE-429-A: one keyed fetch answers the catalog and the cache is written; an absent key refuses typed', async () => {
  const stateDir = tmp('cache');
  const now = () => Date.parse(CATALOG_OBSERVED_AT) + 1_000;
  const { impl, calls } = fakeFetch();

  const fetched = await fetchModelProfiles({ fetchImpl: impl, key: 'test-key', now });
  assert.equal(calls.length, 1, 'the catalog is ONE request');
  assert.equal(calls[0].url, AA_CATALOG_URL, 'the catalog is read from the provider endpoint');
  assert.equal(fetched.catalog.models['claude-opus-4-6'].intelligence, 68.4,
    'the intelligence index is carried as measured');
  assert.equal(fetched.catalog.updatedAt, CATALOG_OBSERVED_AT,
    "the catalog's own instant is the freshness origin");

  const reader = modelProfileReader({ stateDir, key: 'test-key', now, fetchImpl: impl });
  await reader.refresh();
  const cached = readCachedCatalog(stateDir, { now });
  assert.ok(cached, 'a keyed refresh writes the cache');
  assert.equal(cached.stale, false, 'a just-written catalog is fresh');
  assert.equal(cached.catalog.models['claude-opus-4-6'].coding, 61.2, 'the cache round-trips the measurements');
  assert.equal(calls.length, 2, 'the reader fetched through the injected reader, not the real one');

  await assert.rejects(
    fetchModelProfiles({ fetchImpl: impl, key: null, now }),
    (error) => error?.code === 'model_profile_credential_absent',
    'an absent key is a typed refusal, never an unkeyed request',
  );
  assert.equal(calls.length, 2, 'the credential refusal precedes the request');

  await assert.rejects(
    fetchModelProfiles({ fetchImpl: fakeFetch({ status: 503 }).impl, key: 'test-key', now }),
    (error) => error?.code === 'model_profile_unavailable' && error?.detail?.status === 503,
    'an HTTP failure is a typed unavailability naming its status',
  );
  await assert.rejects(
    fetchModelProfiles({ fetchImpl: fakeFetch({ body: { nope: true } }).impl, key: 'test-key', now }),
    (error) => error?.code === 'model_profile_unavailable' && error?.detail?.cause === 'catalog_shape',
    'a shape failure is a typed unavailability naming its cause',
  );
});

// ── PROFILE-429-B: billing decides the price, never the measurement ──────────────────────────────

test('PROFILE-429-B: a subscription route nulls the price with reason subscription; an api route carries it', async () => {
  const now = () => Date.parse(CATALOG_OBSERVED_AT) + 1_000;
  const { catalog } = await fetchModelProfiles({ fetchImpl: fakeFetch().impl, key: 'test-key', now });

  const subscription = profileFor(catalog, 'claude-opus-4-6', { billing: 'subscription' });
  assert.deepEqual(Object.keys(subscription).sort(), [...MODEL_PROFILE_SHAPE.measured].sort(),
    'the measured profile is the ONE declared closed shape');
  assert.equal(subscription.slug, 'claude-opus-4-6');
  assert.equal(subscription.price, null, 'a flat subscription declares no per-token price');
  assert.equal(subscription.priceReason, 'subscription', 'and says WHY the price is absent');
  assert.equal(subscription.intelligence, 68.4, 'the measured indices apply to both bases');
  assert.equal(subscription.coding, 61.2);
  assert.equal(subscription.tps, 84.5);
  assert.equal(subscription.ttftS, 1.9);
  assert.equal(subscription.measuredAt, CATALOG_OBSERVED_AT);

  const api = profileFor(catalog, 'deepseek-flash', { billing: 'api' });
  assert.deepEqual(api.price, { blended31: 0.42, input: 0.28, output: 0.42 },
    'an api route carries the provider-published prices');
  assert.equal(api.priceReason, null, 'nothing is withheld from an api-billed route');
  assert.equal(api.intelligence, 52.1, 'the api row keeps the same measured indices');

  assert.equal(profileFor(catalog, 'a-model-nobody-measured', { billing: 'api' }), null,
    'a slug the catalog does not define yields no profile, never a guess');
});

// ── the deployment fixture: the real doctor/usage rows over fixture adapters ─────────────────────

const MAPPED_ROUTE = Object.freeze({
  harness: 'claude-code', model: 'claude-opus-4-6', effort: 'high',
  aaSlug: 'claude-opus-4-6', billing: 'subscription',
});
const UNMAPPED_ROUTE = Object.freeze({
  harness: 'claude-code', model: 'muse-spark-1.3-contributor', effort: 'high',
  billing: 'subscription',
});

function repository(t, name) {
  const root = tmp(`repo-${name}`);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue-429@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Issue 429'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# issue 429 fixture\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

/** The fixture adapter the #341 routes are served by: one exact route per model it advertises. */
function fixtureAdapter(harness, routes) {
  const adapter = new MockAdapter({
    harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    concurrencyCeiling: 4,
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact',
      configuredDefault: routes[0].model,
      available: [...new Set(routes.map((row) => row.model))],
      family: harness,
      acceptedPrefixes: [],
      acceptedAliases: [],
      reasoningEffort: [...new Set(routes.map((row) => row.effort))],
      serviceTier: null,
      provenance: 'issue-429-fixture',
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

/** Open the deployment with the profile authority the caller injects (its fetch is a fake). */
async function openDeployment(t, name, modelProfiles) {
  const repo = repository(t, name);
  const root = join(tmp(`owner-${name}`), 'deployment');
  const routes = [MAPPED_ROUTE, UNMAPPED_ROUTE];
  const adapters = { 'claude-code': fixtureAdapter('claude-code', routes) };
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root, adapters, routes, modelProfiles,
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  }, (options) => createDriver(options));
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the fixture */ } });
  return deployment;
}

// ── PROFILE-429-C: the doctor route table carries the profile ───────────────────────────────────

test('PROFILE-429-C: the doctor table carries the measured profile per route, and degrades on an absent key', async (t) => {
  const { impl } = fakeFetch();
  const keyed = await openDeployment(t, 'keyed', { fetchImpl: impl, key: 'test-key' });
  const doctor = await keyed.doctor();

  const profiled = doctor.routes.find((row) => row.model === MAPPED_ROUTE.model);
  assert.equal(profiled.profile.intelligence, 68.4, 'the routed model carries its measured intelligence');
  assert.equal(profiled.profile.coding, 61.2);
  assert.equal(profiled.profile.tps, 84.5);
  assert.equal(profiled.profile.ttftS, 1.9);
  assert.equal(profiled.profile.price, null, 'a subscription route nulls the price');
  assert.equal(profiled.profile.priceReason, 'subscription');

  const unmapped = doctor.routes.find((row) => row.model === UNMAPPED_ROUTE.model);
  assert.equal(unmapped.profile, null, 'a route without an aaSlug carries profile: null');

  const usage = keyed.routeUsageRows().find((row) => row.route.model === MAPPED_ROUTE.model);
  assert.equal(usage.profile.intelligence, 68.4, 'the usage rows the doctor publishes carry the same profile');

  // No key anywhere: the doctor still answers, and the profile row says why it cannot.
  const keyless = await openDeployment(t, 'keyless', {
    fetchImpl: impl, env: {}, keyPath: join(tmp(`nokey-${Date.now()}`), 'aa_key'),
  });
  const degraded = await keyless.doctor();
  assert.equal(degraded.ready, true, 'an absent profile credential never refuses the doctor');
  const keylessRow = degraded.routes.find((row) => row.model === MAPPED_ROUTE.model);
  assert.equal(keylessRow.state, 'ready', 'the route is unaffected: the profile is evidence, not a gate');
  assert.equal(keylessRow.profile.state, 'unavailable');
  assert.equal(keylessRow.profile.reason, 'credential_absent');
  assert.equal(typeof keylessRow.profile.next, 'string');
  assert.ok(keylessRow.profile.next.length > 0, 'the degraded row names the remedy');

  // The fleet's own declaration is where a family's mapping lives: `billing` is a closed basis and
  // `aaSlug` is the Artificial Analysis row the family's model maps to — null for a model the
  // provider does not publish, never a borrowed measurement.
  const fleet = DEFAULT_BATON_DEPLOYMENT_ROUTES;
  assert.equal(fleet.every((route) => ['api', 'subscription'].includes(route.billing)), true,
    'every fleet route declares one closed billing basis beside its own route');
  assert.equal(fleet.every((route) => Object.hasOwn(route, 'aaSlug')), true,
    'every fleet route declares its catalog mapping (null when the provider measures no row)');
  const apiRoute = fleet.find((route) => route.model === 'deepseek/deepseek-flash');
  assert.equal(apiRoute.billing, 'api', 'the per-token API family declares api billing');
  assert.equal(apiRoute.aaSlug, 'deepseek-flash');
  const subscriptionRoute = fleet.find((route) => route.harness === 'muse');
  assert.equal(subscriptionRoute.billing, 'subscription', 'a flat-plan family declares subscription billing');
  assert.equal(subscriptionRoute.aaSlug, null, 'and claims no slug for a model the provider does not measure');
  assert.equal(fleet.find((route) => route.model === 'kimi-code/k3' && route.harness === 'kimi-code').billing,
    'subscription', 'Kimi is a flat subscription even where its provider key file exists');
});

// ── PROFILE-429-D: the recruit's route comparison carries the profile ───────────────────────────

test('PROFILE-429-D: swarm.recruit routes.considered carries the profile per route', async (t) => {
  const { impl } = fakeFetch();
  const deployment = await openDeployment(t, 'recruit', { fetchImpl: impl, key: 'test-key' });

  const directory = tmp('swarm');
  const workers = [];
  const runtime = new SwarmRuntime({
    store: new CoordinationStore(directory),
    coordinator: { list: () => workers, pausedTurns: () => [] },
    authorize: async () => {},
    // The deployment's own rows reach the runtime through the summary it already reads.
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: deployment.routeUsageRows() }),
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: false });
    },
    stopRun: async (runId) => {
      const row = workers.find((candidate) => candidate.runId === runId);
      if (row) row.status = 'dead';
      return { state: 'closed' };
    },
  });
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  let key = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(command === 'view' ? {} : { idempotencyKey: `request-${++key}` }), ...args }, owner);

  await call('create', { purpose: 'measured routes' });
  const recruited = await call('recruit', {
    participantId: 'lane-429', objective: 'work', options: { harness: 'claude-code' },
  });

  const considered = recruited.routes.considered;
  assert.equal(considered.length, 2, 'every route matching the prefix is compared');
  const mapped = considered.find((row) => row.route.model === MAPPED_ROUTE.model);
  assert.equal(mapped.profile.intelligence, 68.4, 'the compared route carries its measured profile');
  assert.equal(mapped.profile.priceReason, 'subscription');
  const unmapped = considered.find((row) => row.route.model === UNMAPPED_ROUTE.model);
  assert.equal(unmapped.profile, null, 'a compared route with no aaSlug says so with null');
  for (const row of considered) assert.ok(Object.hasOwn(row, 'profile'), 'every compared route carries the field');
});

// ── PROFILE-429-E: the freshness bound is the registry row, and the provider's own window wins ──

test('PROFILE-429-E: the cache freshness derives from the registry row, and from the response when it declares one', async () => {
  const row = FRAME_LIMITS['model_profile.catalog_staleness_ms'];
  assert.ok(row, 'the staleness bound is a declared registry row');
  assert.equal(MODEL_PROFILE_STALENESS_MS, row.value, 'the reader reads THAT row, never a literal of its own');
  assert.equal(row.unit, 'ms');

  const publishedAtMs = Date.parse(CATALOG_OBSERVED_AT);
  const stateDir = tmp('freshness');
  // The copy is fetched on the provider's own instant, so the freshness origin is unambiguous.
  const now = () => publishedAtMs;
  const { catalog } = await fetchModelProfiles({ fetchImpl: fakeFetch().impl, key: 'test-key', now });
  writeCachedCatalog(stateDir, catalog, { now });

  const fresh = readCachedCatalog(stateDir, { now: () => publishedAtMs + row.value - 1 });
  assert.equal(fresh.stale, false, 'inside the registry bound the catalog is fresh');
  assert.equal(fresh.boundMs, row.value, 'the read publishes the bound it judged against');
  const expired = readCachedCatalog(stateDir, { now: () => publishedAtMs + row.value });
  assert.equal(expired.stale, true, 'at the registry bound the catalog is stale');

  // A catalog the provider published long before we fetched it is judged by the COPY's own age —
  // the provider's instant is the measurement fact (`measuredAt`), never an instant that would make
  // a freshly fetched catalog stale on arrival (one request per read).
  const olderDir = tmp('freshness-older-publication');
  const fetchedAt = Date.parse(CATALOG_OBSERVED_AT) + 6 * 60 * 60 * 1000;
  writeCachedCatalog(olderDir, catalog, { now: () => fetchedAt });
  assert.equal(readCachedCatalog(olderDir, { now: () => fetchedAt + row.value - 1 }).stale, false,
    'a catalog published before this deployment fetched it is fresh for the bound from the FETCH');
  assert.equal(readCachedCatalog(olderDir, { now: () => fetchedAt + row.value }).stale, true);
  assert.equal(profileFor(catalog, 'claude-opus-4-6', { billing: 'subscription' }).measuredAt,
    CATALOG_OBSERVED_AT, "the provider's own instant still rides the profile as its measurement");

  // The provider's own declared freshness window is what a reader honors when it answers one.
  const windowedDir = tmp('freshness-window');
  const windowed = await fetchModelProfiles({
    fetchImpl: fakeFetch({ headers: { 'cache-control': 'public, max-age=120', age: '30' } }).impl,
    key: 'test-key', now,
  });
  assert.equal(windowed.catalog.freshForMs, 90_000, 'the response window is its max-age minus its own age');
  writeCachedCatalog(windowedDir, windowed.catalog, { now });
  assert.equal(readCachedCatalog(windowedDir, { now: () => publishedAtMs + 89_000 }).stale, false,
    'inside the declared window the catalog is fresh');
  const pastWindow = readCachedCatalog(windowedDir, { now: () => publishedAtMs + 90_000 });
  assert.equal(pastWindow.stale, true, 'past the declared window it is stale, whatever the registry fallback says');
  assert.equal(pastWindow.boundMs, row.value, 'the registry row stays the fallback the read publishes');
});
