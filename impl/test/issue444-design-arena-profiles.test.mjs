// issue444-design-arena-profiles.test.mjs — Issue #444: the measured model profile gains a SECOND
// live source beside Artificial Analysis — Design Arena's Bradley-Terry Elo per arena — so a route
// carries its design strength beside its quality indices, the doctor and the seat brief render it,
// and a recruit can order candidates on the design axis when the work IS design work.
//
// Rows:
//   DESIGN-444-A  ONE keyed /models fetch answers every arena; the join by the route's
//                 `openRouterId` rides the profile row (the cache carries a `design` section
//                 beside `catalog`), and an unjoinable route degrades to `no_openrouter_id`
//   DESIGN-444-B  an absent design credential degrades the row (design null, reason key_absent)
//                 and NEVER refuses the route or makes an unkeyed request
//   DESIGN-444-C  the design section's freshness derives from the limits registry row (and from
//                 the response's own window when it declares one), never a literal of the module;
//                 a stale section reads `stale`, never a stale Elo
//   DESIGN-444-D  the doctor's profile row carries the arenas and the brief's route table renders
//                 `design: <best arena> <elo>` for every row that has one
//   DESIGN-444-E  swarm.recruit prefers quality by default and orders on the best design Elo when
//                 asked, naming the axis it ordered on; an unknown axis refuses with the closed set
//   DESIGN-444-F  BATON_DESIGNARENA_KEY is swept from worker environments with no new list entry,
//                 every served route carries its OpenRouter join, and a stray designarena_key at
//                 the repository root never enters a deployment snapshot
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, both fetches injected (no network), no
// provider process. The host's own keys are never read: every fixture passes its own env/keyPath.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DESIGN_ARENA_MODELS_URL, DESIGN_RANKINGS_REASONS, MODEL_PROFILE_SHAPE,
  MODEL_PROFILE_STALENESS_MS, designRankingFor, fetchDesignRankings, fetchModelProfiles,
  modelProfileReader, readCachedCatalog, readCachedDesignRankings, writeCachedCatalog,
  writeCachedDesignRankings,
} from '../src/model-profile.mjs';
import {
  DESIGNARENA_CREDENTIAL_ENV, DESIGNARENA_CREDENTIAL_FILE,
  designArenaCredentialPath, readDesignArenaCredential, renderRouteUsageLines,
} from '../src/adapter.mjs';
import {
  DEFAULT_BATON_DEPLOYMENT_ROUTES, KIMI_THROUGH_CLAUDE_ROUTE, openBatonDeployment,
} from '../src/application-deployment.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { RuntimeIsolation, isSecretEnvName } from '../src/runtime-isolation.mjs';
import { SWARM_ROUTE_PREFER_AXES, SwarmRuntime } from '../src/swarm-runtime.mjs';

const dirs = [];
function tmp(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-444-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// ── the two provider answers, reduced to the routes the fixtures map ────────────────────────────

const AA_OBSERVED_AT = '2026-09-17T00:00:00Z';
const AA_BODY = Object.freeze({
  updated_at: AA_OBSERVED_AT,
  data: [
    {
      slug: 'claude-opus-4-6', id: 'model-1', name: 'Claude Opus 4.6',
      model_creator: { slug: 'anthropic', name: 'Anthropic' },
      evaluations: {
        artificial_analysis_intelligence_index: 68.4,
        artificial_analysis_coding_index: 61.2,
      },
      median_output_tokens_per_second: 84.5,
      median_time_to_first_token_seconds: 1.9,
      pricing: { price_1m_blended_3_to_1: 9.5, price_1m_input_tokens: 5, price_1m_output_tokens: 25 },
    },
    {
      slug: 'deepseek-flash', id: 'model-2', name: 'DeepSeek Flash',
      model_creator: { slug: 'deepseek', name: 'DeepSeek' },
      evaluations: {
        artificial_analysis_intelligence_index: 52.1,
        artificial_analysis_coding_index: 47.75,
      },
      median_output_tokens_per_second: 210.25,
      median_time_to_first_token_seconds: 0.4,
      pricing: { price_1m_blended_3_to_1: 0.42, price_1m_input_tokens: 0.28, price_1m_output_tokens: 0.42 },
    },
  ],
});

// The Design Arena answer. #444's join key is `openRouterId`; the two container shapes the API's
// own siblings publish (an arena map and an arena array) both reach the same five-field row. The
// quality and design orders DISAGREE on purpose: claude-opus carries the higher Artificial
// Analysis index, deepseek-flash the higher design Elo — so a comparison that ordered on the wrong
// axis is visible, not coincidentally right.
const DESIGN_OBSERVED_AT = '2026-09-18T00:00:00Z';
const DESIGN_BODY = Object.freeze({
  success: true,
  updated_at: DESIGN_OBSERVED_AT,
  data: [
    {
      openRouterId: 'anthropic/claude-opus-4.6',
      name: 'Claude Opus 4.6',
      rankings: {
        Website: { Overall: { elo: 1341.2, rank: 2, votes: 812 } },
        'UI Component': { Overall: { elo: 1298.05, rank: 4, votes: 305 } },
      },
    },
    {
      openRouterId: 'deepseek/deepseek-flash',
      name: 'DeepSeek V4.1 Flash',
      arenas: [
        { arena: 'Data Visualization', category: 'Overall', elo: 1402.5, rank: 1, votes: 418 },
        { arena: 'Website', category: 'Overall', elo: 1180.4, rank: 12, votes: 210 },
      ],
    },
    { openRouterId: null, name: 'a model no OpenRouter route can join' },
    { openRouterId: 'muse/muse-spark-1.3-contributor', name: 'no ranking published', arenas: [] },
  ],
});

/** The injected fetch: one response, its headers, and the calls it saw. */
function fakeFetch({ body, headers = {}, status = 200 } = {}) {
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

const aaFetch = (options = {}) => fakeFetch({ body: AA_BODY, ...options });
const designFetch = (options = {}) => fakeFetch({ body: DESIGN_BODY, ...options });

// ── DESIGN-444-A: one keyed fetch answers every arena, and the join rides the profile ───────────

test('DESIGN-444-A: one keyed /models fetch answers every arena and the openRouterId join rides the profile row', async () => {
  const stateDir = tmp('join');
  const now = () => Date.parse(DESIGN_OBSERVED_AT) + 1_000;
  const design = designFetch();
  const aa = aaFetch();

  const fetched = await fetchDesignRankings({ fetchImpl: design.impl, key: 'design-key', now });
  assert.equal(design.calls.length, 1, 'the design catalog is ONE request');
  assert.equal(design.calls[0].url, DESIGN_ARENA_MODELS_URL, 'the models answer carries every arena');
  assert.equal(design.calls[0].options.headers.authorization, 'Bearer design-key',
    'the credential travels as the API declares it');

  const arenas = fetched.design.models['anthropic/claude-opus-4.6'];
  assert.equal(arenas.length, 2);
  for (const arena of arenas) {
    assert.deepEqual(Object.keys(arena).sort(), ['arena', 'category', 'elo', 'rank', 'votes'],
      'every arena row is the ONE declared five-field shape');
  }
  assert.deepEqual(arenas.map((row) => row.arena), ['Website', 'UI Component'],
    'the arenas ride best-first, so a reader never re-derives the best');
  assert.deepEqual({ ...arenas[0] }, { arena: 'Website', category: 'Overall', elo: 1341.2, rank: 2, votes: 812 });
  assert.equal(fetched.design.observedAt, DESIGN_OBSERVED_AT, "the provider's own instant rides the section");

  const joined = designRankingFor(fetched.design, 'deepseek/deepseek-flash');
  assert.equal(joined.arenas[0].arena, 'Data Visualization', 'both wire shapes reach the same row');
  assert.equal(joined.arenas[0].elo, 1402.5);
  assert.equal(designRankingFor(fetched.design, 'muse/muse-spark-1.3-contributor'), null,
    'an id whose only entry publishes no ranking joins nothing');
  assert.equal(designRankingFor(fetched.design, 'nobody/at-all'), null, 'an unknown id joins nothing');

  await assert.rejects(
    fetchDesignRankings({ fetchImpl: design.impl, key: '  ', now }),
    (error) => error?.code === 'design_rankings_credential_absent',
    'an absent key is a typed refusal, never an unkeyed request',
  );
  assert.equal(design.calls.length, 1, 'the credential refusal precedes the request');
  await assert.rejects(
    fetchDesignRankings({ fetchImpl: designFetch({ status: 401 }).impl, key: 'k', now }),
    (error) => error?.code === 'design_rankings_unavailable' && error?.detail?.status === 401,
    'an HTTP failure is typed and names its status',
  );
  await assert.rejects(
    fetchDesignRankings({ fetchImpl: fakeFetch({ body: { success: false, error: { code: 'x' } } }).impl, key: 'k', now }),
    (error) => error?.code === 'design_rankings_unavailable',
    'the provider\'s own error document is a typed unavailability',
  );

  // The deployment's own reader: one refresh writes BOTH sections of the ONE cache file, and the
  // route's profile carries the join its `openRouterId` names.
  const reader = modelProfileReader({
    stateDir, env: {}, key: 'aa-key', fetchImpl: aa.impl, designKey: 'design-key',
    designFetchImpl: design.impl, now,
  });
  await reader.refresh();
  const routed = reader.profileOf({
    aaSlug: 'claude-opus-4-6', billing: 'subscription', openRouterId: 'anthropic/claude-opus-4.6',
  });
  assert.deepEqual(Object.keys(routed).sort(), [...MODEL_PROFILE_SHAPE.measured].sort(),
    'the measured row is still the ONE declared closed shape');
  assert.equal(routed.intelligence, 68.4, 'the Artificial Analysis measurement is untouched');
  assert.equal(routed.design.arenas[0].arena, 'Website');
  assert.equal(routed.design.arenas[0].elo, 1341.2);
  assert.equal(routed.designReason, null, 'a row that carries design names no degradation');
  assert.deepEqual(Object.keys(routed.design).sort(), ['arenas', 'observedAt']);

  const unjoined = reader.profileOf({ aaSlug: 'deepseek-flash', billing: 'api', openRouterId: null });
  assert.equal(unjoined.design, null, 'a route with no OpenRouter id to join on carries no design');
  assert.equal(unjoined.designReason, DESIGN_RANKINGS_REASONS.noOpenRouterId);
  assert.equal(unjoined.intelligence, 52.1, 'its measured quality still applies');

  const unknown = reader.profileOf({
    aaSlug: 'deepseek-flash', billing: 'api', openRouterId: 'nobody/knows-this-one',
  });
  assert.equal(unknown.design, null, 'an id the design catalog does not define joins nothing');
  assert.equal(unknown.designReason, DESIGN_RANKINGS_REASONS.unavailable);

  const cached = readCachedDesignRankings(stateDir, { now });
  assert.ok(cached, 'the design section rides the same cache file as the catalog');
  assert.ok(readCachedCatalog(stateDir, { now }), 'and the catalog section is still readable beside it');
  assert.equal(cached.design.models['anthropic/claude-opus-4.6'][0].elo, 1341.2);
});

// ── DESIGN-444-B: an absent credential degrades the row, never the route ────────────────────────

test('DESIGN-444-B: an absent design credential degrades design to null/key_absent and never refuses the route', async (t) => {
  const aa = aaFetch();
  const design = designFetch();
  const keyPath = join(tmp('no-design-key'), DESIGNARENA_CREDENTIAL_FILE);
  const keyless = await openDeployment(t, 'keyless', {
    fetchImpl: aa.impl, key: 'aa-key', env: {}, designFetchImpl: design.impl, designKeyPath: keyPath,
  });
  const doctor = await keyless.doctor();

  assert.equal(doctor.ready, true, 'an absent design credential never refuses the doctor');
  const row = doctor.routes.find((candidate) => candidate.model === ROUTE_QUALITY.model);
  assert.equal(row.state, 'ready', 'the route is unaffected: the design axis is evidence, not a gate');
  assert.equal(row.profile.intelligence, 68.4, 'the quality measurement is still served');
  assert.equal(row.profile.design, null, 'no design ranking is claimed without a credential');
  assert.equal(row.profile.designReason, DESIGN_RANKINGS_REASONS.keyAbsent);
  assert.equal(design.calls.length, 0, 'an absent key makes no request at all');

  // The credential's own shape: the same config root as aa_key, the environment first, a file
  // second, absence (never a throw) last.
  assert.equal(DESIGNARENA_CREDENTIAL_ENV, 'BATON_DESIGNARENA_KEY');
  assert.equal(DESIGNARENA_CREDENTIAL_FILE, 'designarena_key');
  const home = tmp('home');
  assert.equal(designArenaCredentialPath({ env: {}, home }), join(home, '.config', 'baton', 'designarena_key'),
    'the key file resolves under the SAME config root every Baton-private credential uses');
  assert.equal(designArenaCredentialPath({ env: { XDG_CONFIG_HOME: '/xdg' }, home }),
    join('/xdg', 'baton', 'designarena_key'), 'and honors $XDG_CONFIG_HOME like aa_key');
  writeFileSync(keyPath, 'file-key\n', { mode: 0o600 });
  assert.equal(readDesignArenaCredential({ env: {}, path: keyPath }), 'file-key');
  assert.equal(readDesignArenaCredential({ env: { [DESIGNARENA_CREDENTIAL_ENV]: ' env-key ' }, path: keyPath }),
    'env-key', 'the environment wins over the file');
  assert.equal(readDesignArenaCredential({ env: {}, path: join(home, 'absent') }), null,
    'an absent key file is absence, never a throw');
});

// ── DESIGN-444-C: the staleness bound is the registry row, the provider's window wins ───────────

test('DESIGN-444-C: the design section is judged by the registry row (and the provider window), never a literal', async () => {
  const row = FRAME_LIMITS['model_profile.catalog_staleness_ms'];
  assert.ok(row, 'the staleness bound is a declared registry row');
  assert.equal(MODEL_PROFILE_STALENESS_MS, row.value, 'the reader reads THAT row, never a literal of its own');

  const stateDir = tmp('design-freshness');
  const publishedAtMs = Date.parse(DESIGN_OBSERVED_AT);
  let clock = publishedAtMs;
  const now = () => clock;
  const aa = aaFetch();
  const design = designFetch();
  const reader = modelProfileReader({
    stateDir, env: {}, key: 'aa-key', fetchImpl: aa.impl, designKey: 'design-key',
    designFetchImpl: design.impl, now,
  });
  await reader.refresh();

  const fresh = readCachedDesignRankings(stateDir, { now: () => publishedAtMs + row.value - 1 });
  assert.equal(fresh.stale, false, 'inside the registry bound the section is fresh');
  assert.equal(fresh.boundMs, row.value, 'the read publishes the bound it judged against');
  assert.equal(readCachedDesignRankings(stateDir, { now: () => publishedAtMs + row.value }).stale, true,
    'at the registry bound the section is stale');

  // A stale section is a REASON on the row, never a stale Elo dressed as a measurement.
  clock = publishedAtMs + row.value;
  const staleRow = reader.profileOf({
    aaSlug: 'claude-opus-4-6', billing: 'subscription', openRouterId: 'anthropic/claude-opus-4.6',
  });
  assert.equal(staleRow.design, null, 'a stale section claims no design number');
  assert.equal(staleRow.designReason, DESIGN_RANKINGS_REASONS.stale);
  assert.equal(staleRow.intelligence, 68.4, 'the quality measurement is judged on its own section');

  // The provider's own declared freshness window is honored when it answers one (the API's CDN
  // cache), and the registry row stays the fallback the read publishes.
  clock = publishedAtMs;
  const windowedDir = tmp('design-freshness-window');
  const windowed = await fetchDesignRankings({
    fetchImpl: designFetch({ headers: { 'cache-control': 'public, max-age=300', age: '0' } }).impl,
    key: 'design-key', now,
  });
  assert.equal(windowed.design.freshForMs, 300_000, 'the response window is honored as stated');
  writeCachedDesignRankings(windowedDir, windowed.design, { now });
  assert.equal(readCachedDesignRankings(windowedDir, { now: () => publishedAtMs + 299_000 }).stale, false);
  const pastWindow = readCachedDesignRankings(windowedDir, { now: () => publishedAtMs + 300_000 });
  assert.equal(pastWindow.stale, true, 'past the declared window it is stale');
  assert.equal(pastWindow.boundMs, row.value, 'the registry row stays the fallback the read publishes');

  // Writing the catalog section never clobbers the design section and vice versa: ONE file,
  // two live sources.
  const bothDir = tmp('design-freshness-both');
  const { catalog } = await fetchModelProfiles({ fetchImpl: aaFetch().impl, key: 'aa-key', now });
  writeCachedCatalog(bothDir, catalog, { now });
  writeCachedDesignRankings(bothDir, windowed.design, { now });
  writeCachedCatalog(bothDir, catalog, { now });
  assert.ok(readCachedCatalog(bothDir, { now }), 'the catalog survives a later design write');
  assert.ok(readCachedDesignRankings(bothDir, { now }), 'and the design section survives a later catalog write');
});

// ── the deployment fixture: the real doctor/brief/recruit rows over fixture adapters ────────────

const ROUTE_QUALITY = Object.freeze({
  harness: 'claude-code', model: 'claude-opus-4-6', effort: 'high',
  aaSlug: 'claude-opus-4-6', billing: 'subscription', openRouterId: 'anthropic/claude-opus-4.6',
});
const ROUTE_DESIGN = Object.freeze({
  harness: 'claude-code', model: 'deepseek/deepseek-flash', effort: 'high',
  aaSlug: 'deepseek-flash', billing: 'api', openRouterId: 'deepseek/deepseek-flash',
});

function repository(name) {
  const root = tmp(`repo-${name}`);
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue-444@example.invalid', GIT_COMMITTER_EMAIL: 'issue-444@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 444', GIT_COMMITTER_NAME: 'Issue 444' });
  writeFileSync(join(root, 'README.md'), '# issue 444 fixture\n');
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
      provenance: 'issue-444-fixture',
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

/** Open the deployment with the profile authority the caller injects (both fetches are fakes).
 * `inspectRepo` runs on the fresh repository BEFORE the open mints its effective-tree snapshot. */
async function openDeployment(t, name, modelProfiles, { inspectRepo = null, onDriver = null } = {}) {
  const repo = repository(name);
  if (inspectRepo) inspectRepo(repo);
  const root = join(tmp(`owner-${name}`), 'deployment');
  const routes = [ROUTE_QUALITY, ROUTE_DESIGN];
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root, adapters: { 'claude-code': fixtureAdapter('claude-code', routes) },
      routes, modelProfiles,
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  }, (options) => { if (onDriver) onDriver(options); return createDriver(options); });
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the fixture */ } });
  return deployment;
}

const keyedProfiles = (aa, design) => ({
  fetchImpl: aa.impl, key: 'aa-key', env: {}, designFetchImpl: design.impl, designKey: 'design-key',
});

// ── DESIGN-444-D: the doctor row and the brief's route table render the design field ────────────

test('DESIGN-444-D: the doctor profile row carries the arenas and the brief route table renders design', async (t) => {
  const aa = aaFetch();
  const design = designFetch();
  const deployment = await openDeployment(t, 'render', keyedProfiles(aa, design));
  const doctor = await deployment.doctor();

  const quality = doctor.routes.find((candidate) => candidate.model === ROUTE_QUALITY.model);
  assert.equal(quality.profile.design.arenas[0].arena, 'Website', 'the doctor row carries the arenas');
  assert.equal(quality.profile.design.arenas[0].elo, 1341.2);
  assert.equal(quality.profile.designReason, null);
  const designed = doctor.routes.find((candidate) => candidate.model === ROUTE_DESIGN.model);
  assert.equal(designed.profile.design.arenas[0].arena, 'Data Visualization');
  assert.equal(designed.profile.priceReason, null, 'an api route keeps carrying its price');

  const usage = deployment.routeUsageRows();
  assert.equal(usage.find((row) => row.route.model === ROUTE_QUALITY.model).profile.design.arenas[0].elo, 1341.2,
    'the usage row a recruit compares carries the SAME design fact the doctor publishes');

  // The ONE route-table renderer: `design: <best arena> <elo>` when the row has one, nothing when
  // it does not.
  const lines = renderRouteUsageLines(usage);
  assert.match(lines.find((line) => line.includes(ROUTE_QUALITY.model)),
    /design: Website 1341\.2/u, 'the best arena and its Elo ride the route line');
  assert.match(lines.find((line) => line.includes(ROUTE_DESIGN.model)),
    /design: Data Visualization 1402\.5/u);
  const bare = renderRouteUsageLines([{
    route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }, state: 'ready',
    usage: { turns: 0, tokens: 0 }, concurrency: { ceiling: null, inUse: 0 },
    profile: { ...quality.profile, design: null, designReason: 'no_openrouter_id' },
  }]);
  assert.doesNotMatch(bare[0], /design:/u, 'a row without a design ranking renders no design part');

  // The seat's own brief: the recruit answer's recorded brief is the brief every surface renders.
  const fixture = swarmFixture(() => usage);
  await fixture.call('create', { purpose: 'design brief' });
  const recruited = await fixture.call('recruit', {
    participantId: 'lane-brief', objective: 'compose design sub-lanes',
    permissions: ['read', 'communicate', 'contribute', 'recruit'], view: true,
  });
  // #464 (third half): the recruit receipt's roster row carries the brief's REACH; the text rides
  // the participantId-scoped read.
  assert.equal(typeof recruited.view.participants.find((row) => row.participantId === 'lane-brief').brief, 'object');
  const scopedBrief = await fixture.call('view', { participantId: 'lane-brief' });
  const brief = scopedBrief.participants.find((row) => row.participantId === 'lane-brief').brief;
  assert.match(brief, /### Route usage/u);
  assert.match(brief, /design: Website 1341\.2/u, 'the brief route table renders the design axis');
  assert.match(brief, /design: Data Visualization 1402\.5/u);
});

// ── DESIGN-444-E: the recruit comparison's prefer axis ──────────────────────────────────────────

test('DESIGN-444-E: recruit prefers quality by default, orders on design Elo when asked, and refuses an unknown axis', async (t) => {
  assert.deepEqual([...SWARM_ROUTE_PREFER_AXES], ['quality', 'design'], 'the axis set is closed and declared');

  const aa = aaFetch();
  const design = designFetch();
  const deployment = await openDeployment(t, 'prefer', keyedProfiles(aa, design));
  await deployment.doctor();
  const fixture = swarmFixture(() => deployment.routeUsageRows());
  await fixture.call('create', { purpose: 'prefer axis' });

  // The default axis: the measured quality index decides — deepseek-flash has the higher design
  // Elo, so a comparison that ordered on design without being asked would be visible here.
  const quality = await fixture.call('recruit', {
    participantId: 'lane-quality', objective: 'work', options: { harness: 'claude-code' },
  });
  assert.equal(quality.routes.orderedBy, 'quality', 'the comparison names the axis it ordered on');
  assert.equal(quality.routes.chosen.route.model, ROUTE_QUALITY.model);
  assert.match(quality.routes.chosen.reason, /quality|intelligence/u, 'the chosen row names its axis');
  assert.equal(quality.routes.considered.length, 2, 'both served routes are compared');

  const designed = await fixture.call('recruit', {
    participantId: 'lane-design', objective: 'design work',
    options: { harness: 'claude-code', prefer: 'design' },
  });
  assert.equal(designed.routes.orderedBy, 'design');
  assert.equal(designed.routes.chosen.route.model, ROUTE_DESIGN.model,
    'the route with the best design Elo wins when the caller asks for the design axis');
  assert.match(designed.routes.chosen.reason, /design/u, 'and the comparison row names the axis');
  const compared = designed.routes.considered.find((row) => row.route.model === ROUTE_QUALITY.model);
  assert.equal(compared.profile.design.arenas[0].elo, 1341.2, 'every compared row still carries its own fact');

  await assert.rejects(
    fixture.call('recruit', {
      participantId: 'lane-unknown', objective: 'work', options: { harness: 'claude-code', prefer: 'cheap' },
    }),
    (error) => error?.code === 'swarm_command_invalid'
      && error.message.includes('quality, design')
      && Array.isArray(error.detail?.admitted)
      && error.detail.admitted.join(',') === 'quality,design',
    'an unknown prefer refuses typed with the closed set',
  );
});

// ── DESIGN-444-F: the credential sweep, the route mapping, and the snapshot exclusion ───────────

test('DESIGN-444-F: the design key is swept from workers, mapped on every served route, and excluded from snapshots', async (t) => {
  // (1) The sweep needs NO new list entry: the runtime's own SECRET_NAME regex already covers any
  // name containing KEY, pinned here so a future list rewrite cannot silently open this door.
  assert.equal(isSecretEnvName(DESIGNARENA_CREDENTIAL_ENV), true,
    'BATON_DESIGNARENA_KEY is secret-shaped by the runtime\'s own classifier');
  const isolation = new RuntimeIsolation({
    repoRoot: tmp('sweep'),
    baseEnv: {
      PATH: '/bin', LANG: 'C', HOME: '/operator', RANDOM_FLAG: 'safe',
      BATON_DESIGNARENA_KEY: 'ambient-design-secret', BATON_AA_KEY: 'ambient-aa-secret',
    },
  });
  const scope = isolation.create('w-444', 'codex');
  assert.equal(scope.env.BATON_DESIGNARENA_KEY, undefined, 'the design key never reaches a worker');
  assert.equal(scope.env.BATON_AA_KEY, undefined, 'nor does the Artificial Analysis key');
  assert.equal(scope.env.RANDOM_FLAG, 'safe', 'ordinary settings still ride');
  assert.equal(JSON.stringify(scope.posture).includes('ambient-design-secret'), false);
  isolation.remove('w-444');

  // (2) Every served route declares its OpenRouter join beside its Artificial Analysis slug —
  // materialized, so a reader never has to tell "absent" from "null" — and the contributor model
  // that has no measured row claims no join either.
  const fleet = DEFAULT_BATON_DEPLOYMENT_ROUTES;
  assert.equal(fleet.every((route) => Object.hasOwn(route, 'openRouterId')), true,
    'every fleet route declares its Design Arena join (null when the model is not published)');
  const joinOf = (predicate) => fleet.find(predicate).openRouterId;
  assert.equal(joinOf((route) => route.model === 'claude-opus-4-6' && route.harness === 'claude-code'),
    'anthropic/claude-opus-4.6');
  assert.equal(joinOf((route) => route.model === 'zai/glm-5.3-flash'), 'z-ai/glm-5.3-flash');
  assert.equal(joinOf((route) => route.model === 'kimi-code/k3' && route.harness === 'omp'),
    'moonshotai/kimi-k3');
  assert.equal(KIMI_THROUGH_CLAUDE_ROUTE.model, 'kimi-k3[1m]');
  assert.equal(KIMI_THROUGH_CLAUDE_ROUTE.openRouterId, 'moonshotai/kimi-k3',
    'the Claude-CLI Kimi route joins the same model as the native one');
  assert.equal(joinOf((route) => route.model === 'deepseek/deepseek-flash'), 'deepseek/deepseek-flash');
  assert.equal(joinOf((route) => route.model === 'deepseek/deepseek-v4-pro[1m]'), 'deepseek/deepseek-v4-pro');
  assert.equal(joinOf((route) => route.model === 'gpt-5.6-sol'), 'openai/gpt-5.6-sol');
  assert.equal(joinOf((route) => route.model === 'grok-4.5'), 'x-ai/grok-4.5');
  assert.equal(fleet.find((route) => route.harness === 'muse').openRouterId, null,
    'the contributor model Design Arena publishes no row for claims no join');

  // (3) A stray key at the repository root is credential material like aa_key: it is named in
  // .gitignore and never enters the deployment's effective-tree snapshot — while the operator's
  // own file stays exactly where it was.
  const gitignore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8')
    .split('\n').map((line) => line.trim());
  assert.ok(gitignore.includes(DESIGNARENA_CREDENTIAL_FILE), '.gitignore covers the stray key copy');
  assert.ok(gitignore.includes('aa_key'), 'beside the Artificial Analysis copy #429 landed');

  let driverOptions = null;
  const aa = aaFetch();
  const design = designFetch();
  const deployment = await openDeployment(t, 'snapshot', keyedProfiles(aa, design), {
    inspectRepo: (repo) => {
      writeFileSync(join(repo, DESIGNARENA_CREDENTIAL_FILE), 'design-secret\n', { mode: 0o600 });
      writeFileSync(join(repo, 'aa_key'), 'aa-secret\n', { mode: 0o600 });
    },
    onDriver: (options) => { driverOptions = options; },
  });
  assert.ok(driverOptions?.deploymentBaseSha, 'the open minted the effective-tree snapshot');
  const repo = driverOptions.repoRoot;
  const tree = execFileSync('git', ['ls-tree', '-r', '--name-only', driverOptions.deploymentBaseSha],
    { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.equal(tree.includes(DESIGNARENA_CREDENTIAL_FILE), false, 'the stray design key is not in the snapshot');
  assert.equal(tree.includes('aa_key'), false, 'neither is the Artificial Analysis copy');
  assert.equal(statSync(join(repo, DESIGNARENA_CREDENTIAL_FILE)).isFile(), true,
    'excluding the file from the snapshot never touches the operator\'s copy');
  assert.equal(statSync(join(repo, 'aa_key')).isFile(), true);
});

// ── the swarm fixture: the real runtime over a real store, with the deployment's rows injected ──

function swarmFixture(rows) {
  const directory = tmp('swarm');
  const store = new CoordinationStore(directory);
  const workers = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers, pausedTurns: () => [] },
    authorize: async () => {},
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: rows() }),
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
    { swarmId: 'baton', ...(command === 'view' ? {} : { idempotencyKey: `design-444-${++key}` }), ...args }, owner);
  return { call };
}
