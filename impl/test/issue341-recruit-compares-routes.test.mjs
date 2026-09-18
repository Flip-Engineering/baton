// issue341-recruit-compares-routes.test.mjs — Issue #341 part 3: a recruit compares the routes the
// deployment serves, and the seat's brief names what it may recruit on.
//
// The observed gap: the route table carries usage and quota (part 1) and readiness answers the
// provider's own refusal (part 2), but `swarm.recruit` still received one exact route and answered
// only admission/baseBehind — so a root (or a delegating seat) could not see "this route's provider
// refused the last turns", "kimi-code is blocked" or "these routes are ready instead", and it
// defaulted to one harness instead of composing across them.
//
// Rows:
//   RECRUIT-341-A   a prefix recruit chooses the ready route and names the blocked routes with codes
//   RECRUIT-341-A2  the chosen route is the one with the most remaining headroom (slots, then turns)
//   RECRUIT-341-B   an exact recruit on a refused route refuses pre-effect through the deployment's
//                   own admission gate, naming the ready alternative, and joins nobody
//   RECRUIT-341-B2  the same refusal crosses the deployment run/explore lane (part 2's path)
//   RECRUIT-341-C   the seat's brief lists the served routes with usage, recruitable by grant
//   RECRUIT-341-D   a free failed-turn summary never blocks a route; a crash's own text still does
//   RECRUIT-341-D2  the muse refusal row matches the CLI's captured refusal text only
//   RECRUIT-341-E   the deployment's usage accessor is the doctor's own derivation, row for row
//   RECRUIT-341-F   an exact recruit answers its own row beside the ready alternatives
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, no network, no provider process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { openBatonDeployment, routeAdmissionGate } from '../src/application-deployment.mjs';
import { routeQuotaKey } from '../src/route-quota.mjs';
import { matchProviderRefusal, providerRefusalsForHarness } from '../src/adapter.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';
import { Log } from '../src/log.mjs';
import { PROVIDER_FAULT_CODES } from '../src/provider-faults.mjs';

const QUOTA_CODE = PROVIDER_FAULT_CODES.quota;
const AUTH_CODE = 'provider_auth_expired';

const ROUTE_READY = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const ROUTE_QUOTA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const ROUTE_AUTH = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });
const RESET_AT = new Date(Math.floor(Date.now() / 1000) * 1000 + 6 * 60 * 60 * 1000).toISOString();

const routeLabel = (route) => `${route.harness}/${route.model}@${route.effort}`;

/** One usage row as part 1's deployment derivation publishes it. */
function usageRow(route, {
  state = 'ready', code = null, resetAt = null, turns = 0, tokens = 0,
  ceiling = null, inUse = 0, refusalText = null, quotaResetAt = null,
} = {}) {
  return Object.freeze({
    route: Object.freeze({ ...route }),
    state, code, resetAt,
    usage: Object.freeze({ turns, tokens, usd: 0 }),
    concurrency: Object.freeze({ ceiling, inUse }),
    lastProviderRefusal: refusalText === null ? null
      : Object.freeze({ code, text: refusalText, at: new Date(Date.now() - 1_000).toISOString(), resetAt }),
    quota: state === 'blocked' && code === QUOTA_CODE
      ? Object.freeze({ state: 'exhausted', resetAt: quotaResetAt ?? resetAt })
      : Object.freeze({ state: 'ok', resetAt: null }),
  });
}

// ── the swarm fixture: the real runtime over a real store, with the deployment's rows injected ──

const DEFAULT_PERMISSIONS = ['read', 'communicate', 'contribute'];
const GRANTED = [...DEFAULT_PERMISSIONS, 'recruit'];

function swarmFixture(t, rows, gate = null) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-recruit-341-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const seen = [];
  const coordinator = { list: () => workers, pausedTurns: () => [] };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {},
    // The deployment's own route rows reach the runtime through the summary it already reads.
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: rows }),
    prepareRun: async (request) => {
      seen.push(request);
      // An admission gate stands in for the deployment's own (part 2's routeAdmissionGate when the
      // row is refused): the runtime delegates route admission, it never second-guesses it.
      if (gate) gate(request.options ?? {});
      return { ...request, route: request.options?.exact ?? null };
    },
    startRun: async (request) => {
      if (!workers.some((row) => row.runId === request.runId)) {
        workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
          runId: request.runId, status: 'working', paused: false });
      }
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
  return { call, seen, runtime };
}

const rowByEffort = (rows, effort) => rows.find((row) => row.route.effort === effort);

// ── RECRUIT-341-A: the prefix recruit compares the routes and chooses the ready one ─────────────

test('RECRUIT-341-A: a prefix recruit chooses the ready route and names the blocked routes with their codes', async (t) => {
  const fixture = swarmFixture(t, [
    usageRow(ROUTE_READY, { turns: 3, tokens: 1_200, ceiling: 4 }),
    usageRow(ROUTE_QUOTA, { state: 'blocked', code: QUOTA_CODE, resetAt: RESET_AT, turns: 9, ceiling: 4, refusalText: 'usage limit reached' }),
    usageRow(ROUTE_AUTH, { state: 'blocked', code: AUTH_CODE, turns: 1, ceiling: 4, refusalText: 'missing meta credentials' }),
  ]);
  await fixture.call('create', { purpose: 'route comparison' });

  const recruited = await fixture.call('recruit', {
    participantId: 'lane-a', objective: 'work', options: { harness: 'codex' },
  });
  assert.equal(recruited.admission.state, 'admitted', 'the recruit is admitted on the route the runtime compared');

  assert.ok(recruited.routes, 'the recruit answers the routes it compared');
  assert.deepEqual(recruited.routes.chosen.route, ROUTE_READY, 'the ready route is chosen');
  assert.equal(recruited.routes.chosen.state, 'ready');
  assert.equal(recruited.routes.considered.length, 3, 'every route matching the prefix is named');

  assert.equal(rowByEffort(recruited.routes.considered, 'high').state, 'ready');
  const quota = rowByEffort(recruited.routes.considered, 'xhigh');
  assert.equal(quota.code, QUOTA_CODE, 'the refused route is named with its typed code');
  assert.equal(quota.resetAt, RESET_AT);
  assert.equal(quota.quota.state, 'exhausted');
  assert.equal(quota.usage.turns, 9, 'the usage row rides the comparison');
  const auth = rowByEffort(recruited.routes.considered, 'low');
  assert.equal(auth.code, AUTH_CODE);

  for (const row of recruited.routes.considered) {
    assert.equal(typeof row.reason, 'string');
    assert.ok(row.reason.length > 0, 'every compared route says why it was or was not chosen');
  }
  assert.match(rowByEffort(recruited.routes.considered, 'high').reason, /headroom|ready/u);

  // The chosen route is the one the deployment is asked to admit — exactly, so a prefix can never
  // resolve ambiguously downstream.
  assert.deepEqual(fixture.seen[0].options.exact, ROUTE_READY, 'the chosen route is admitted exactly');
});

// ── RECRUIT-341-A2: the choice is the most remaining headroom, then the fewest turns ────────────

test('RECRUIT-341-A2: the ready route with the most remaining headroom wins, then the fewest turns', async (t) => {
  const busiest = Object.freeze({ harness: 'codex', model: 'gpt-5.6-pro', effort: 'high' });
  const crowded = Object.freeze({ harness: 'codex', model: 'gpt-5.6-mini', effort: 'high' });
  const freshest = Object.freeze({ harness: 'codex', model: 'gpt-5.6-air', effort: 'high' });
  const fixture = swarmFixture(t, [
    usageRow(busiest, { turns: 4, ceiling: 2, inUse: 0 }),
    usageRow(crowded, { turns: 1, ceiling: 2, inUse: 1 }),
    usageRow(freshest, { turns: 0, ceiling: 2, inUse: 0 }),
  ]);
  await fixture.call('create', { purpose: 'headroom' });

  const recruited = await fixture.call('recruit', {
    participantId: 'lane-a2', objective: 'work', options: { model: 'gpt-5.6' },
  });
  assert.equal(recruited.routes.considered.length, 3, 'the model prefix compares every route it names');
  assert.deepEqual(recruited.routes.chosen.route, freshest,
    'equal free slots are broken by the fewest turns, never by configuration order');
  assert.equal(fixture.seen[0].options.exact.effort, 'high');
  assert.deepEqual(fixture.seen[0].options.exact, freshest);
});

// ── RECRUIT-341-B: an exact recruit on a refused route refuses pre-effect ───────────────────────

test('RECRUIT-341-B: an exact recruit on a refused route refuses through the deployment gate, pre-effect, naming the ready alternative', async (t) => {
  // The deployment's OWN admission derivation (part 2's gate) stands in for the refused route.
  const readiness = {
    routes: [ROUTE_READY, ROUTE_QUOTA, ROUTE_AUTH].map((route) => ({ ...route, state: 'ready' })),
  };
  const block = Object.freeze({
    state: 'blocked', route: Object.freeze({ ...ROUTE_QUOTA }), code: QUOTA_CODE, resetAt: RESET_AT,
    observedAt: new Date().toISOString(),
    lastProviderRefusal: Object.freeze({ code: QUOTA_CODE, text: 'usage limit reached', at: new Date().toISOString(), resetAt: RESET_AT }),
  });
  const refusals = () => ({
    live: new Map([[routeQuotaKey(ROUTE_QUOTA), block]]), observed: new Map(),
  });
  const gate = routeAdmissionGate(readiness, null, refusals);

  const fixture = swarmFixture(t, [
    usageRow(ROUTE_READY, { ceiling: 4 }),
    usageRow(ROUTE_QUOTA, { state: 'blocked', code: QUOTA_CODE, resetAt: RESET_AT, ceiling: 4 }),
    usageRow(ROUTE_AUTH, { state: 'blocked', code: AUTH_CODE, ceiling: 4 }),
  ], gate);
  await fixture.call('create', { purpose: 'refused exact recruit' });

  await assert.rejects(
    fixture.call('recruit', {
      participantId: 'lane-b', objective: 'work', options: { exact: ROUTE_QUOTA },
    }),
    (error) => error?.code === QUOTA_CODE
      && error?.state === 'blocked'
      && error?.resetAt === RESET_AT
      && error?.readyRoutes?.includes(routeLabel(ROUTE_READY)) === true
      && error.message.includes(routeLabel(ROUTE_READY)),
    'the refused exact route is refused by admission, naming the route that is ready',
  );
  assert.deepEqual(fixture.seen[0].options.exact, ROUTE_QUOTA,
    'the runtime delegates route admission: the exact selection reaches the gate untouched');

  const view = await fixture.call('view', {});
  assert.equal(view.participants.find((row) => row.participantId === 'lane-b'), undefined,
    'a refused recruit joins nobody — the refusal precedes the membership write');
});

// ── RECRUIT-341-B2: the same refusal crosses the deployment run/explore lane (part 2's path) ────

const codexQuotaText = (resetAt) => `You've hit your usage limit for the day. Please try again at ${resetAt}.`;

function repository(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-recruit-341-${name}-`));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'recruit-341@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Recruit 341'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# recruit 341 fixture\n');
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
      provenance: 'recruit-341-fixture',
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

async function openDeployment(t, name, routes) {
  const repo = repository(t, name);
  const owner = mkdtempSync(join(tmpdir(), `baton-recruit-341-${name}-owner-`));
  t.after(() => rmSync(owner, { force: true, recursive: true }));
  const root = join(owner, 'deployment');
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
    },
  }, (options) => {
    driverOptions = options;
    return createDriver(options);
  });
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the fixture */ } });
  return { deployment, driverOptions, adapters };
}

function appendCrash(log, worker, route, text) {
  return log.append({
    worker, harness: route.harness, turnEpoch: 1, kind: 'lifecycle.crashed', actor: 'worker',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: { error: text, usageSeal: null },
  });
}

function appendFailedTurn(log, worker, route, summary, turnEpoch = 2) {
  return log.append({
    worker, harness: route.harness, turnEpoch, kind: 'lifecycle.turn_completed', actor: 'worker',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: { result: { status: 'failed', summary, artifacts: { commits: [], files: [] } }, usageSeal: null },
  });
}

const doctorRow = (doctor, route) => doctor.routes.find((row) => row.harness === route.harness
  && row.model === route.model && row.effort === route.effort);

test('RECRUIT-341-B2: the deployment run lane refuses the refused route pre-effect, naming the ready alternative', async (t) => {
  const { deployment, driverOptions, adapters } = await openDeployment(t, 'run-lane', [ROUTE_READY, ROUTE_QUOTA]);
  const log = new Log(driverOptions.logDir);
  appendCrash(log, 'fixture-run-lane', ROUTE_QUOTA, codexQuotaText(RESET_AT));

  let spawns = 0;
  for (const adapter of Object.values(adapters)) {
    const spawn = adapter.spawn.bind(adapter);
    adapter.spawn = (...args) => { spawns += 1; return spawn(...args); };
  }

  const refused = (error) => error?.code === QUOTA_CODE
    && error?.readyRoutes?.includes(routeLabel(ROUTE_READY)) === true
    && error.message.includes(RESET_AT);

  await assert.rejects(deployment.run('work', { exact: ROUTE_QUOTA }), refused,
    'the run lane carries the same pre-effect refusal the recruit lane carries (#324)');
  await assert.rejects(deployment.explore('look', { exact: ROUTE_QUOTA }), refused);
  assert.equal(spawns, 0, 'the refusal precedes every adapter effect');

  const doctor = await deployment.doctor();
  assert.equal(doctorRow(doctor, ROUTE_QUOTA).state, 'blocked');
  assert.equal(doctorRow(doctor, ROUTE_READY).state, 'ready', 'the ready alternative is the one the refusal named');
  assert.ok(Array.isArray(doctor.routeUsage), 'the rows the comparison reads are the doctor’s own');
});

// ── RECRUIT-341-C: the seat's brief names what it may recruit on ────────────────────────────────

test('RECRUIT-341-C: the seat brief lists the served routes with usage and marks them recruitable by grant', async (t) => {
  const rows = [
    usageRow(ROUTE_READY, { turns: 5, tokens: 900, ceiling: 4, inUse: 1 }),
    usageRow(ROUTE_QUOTA, { state: 'blocked', code: QUOTA_CODE, resetAt: RESET_AT, turns: 9, ceiling: 4 }),
  ];
  const granted = swarmFixture(t, rows);
  await granted.call('create', { purpose: 'recruitable brief' });
  const recruited = await granted.call('recruit', {
    participantId: 'lane-c', objective: 'compose sub-lanes', permissions: GRANTED, view: true,
  });
  // #464 (third half): the recruit receipt's view is an unscoped roster and carries the brief's
  // REACH; the composed text rides the participantId-scoped read.
  assert.equal(typeof recruited.view.participants.find((row) => row.participantId === 'lane-c').brief, 'object');
  const scopedC = await granted.call('view', { participantId: 'lane-c' });
  const brief = scopedC.participants.find((row) => row.participantId === 'lane-c').brief;
  assert.match(brief, /### Route usage/u, 'the seat’s brief carries the route usage subsection');
  assert.match(brief, new RegExp(routeLabel(ROUTE_READY), 'u'));
  assert.match(brief, /recruitable=true/u, 'a seat holding the recruit grant reads the ready route as recruitable');
  assert.match(brief, /turns=5/u, 'the usage row rides the brief');

  const ungranted = swarmFixture(t, rows);
  await ungranted.call('create', { purpose: 'no recruit grant' });
  const plain = await ungranted.call('recruit', {
    participantId: 'lane-c2', objective: 'work', permissions: DEFAULT_PERMISSIONS, view: true,
  });
  assert.equal(typeof plain.view.participants.find((row) => row.participantId === 'lane-c2').brief, 'object');
  const scopedC2 = await ungranted.call('view', { participantId: 'lane-c2' });
  const plainBrief = scopedC2.participants.find((row) => row.participantId === 'lane-c2').brief;
  assert.match(plainBrief, /### Route usage/u, 'the routes the swarm serves are still named');
  assert.match(plainBrief, /recruitable=false/u, 'without the grant the same rows read recruitable: false');
  assert.doesNotMatch(plainBrief, /recruitable=true/u);
});

// ── RECRUIT-341-D: a free failed-turn summary never blocks a route ──────────────────────────────

test('RECRUIT-341-D: a failed turn whose summary mentions the limit does not block, while a crash’s own text still does', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'free-summary', [ROUTE_READY]);
  const log = new Log(driverOptions.logDir);
  // The free prose of a failed turn: the seat's own summary happens to mention the limit. It is
  // never evidence about the ROUTE — only a row the adapter typed as a provider fault is.
  appendFailedTurn(log, 'fixture-free-summary', ROUTE_READY, 'the worker stopped early: usage limit reached in its own words');

  const ready = await deployment.doctor();
  assert.equal(doctorRow(ready, ROUTE_READY).state, 'ready', 'a failed turn’s prose never blocks a route');
  assert.equal(doctorRow(ready, ROUTE_READY).lastProviderRefusal, null);

  // The contrast: the same words on the adapter's own crash cert still refuse the route.
  appendCrash(log, 'fixture-crash-cert', ROUTE_READY, codexQuotaText(RESET_AT));
  const blocked = await deployment.doctor();
  assert.equal(doctorRow(blocked, ROUTE_READY).state, 'blocked');
  assert.equal(doctorRow(blocked, ROUTE_READY).code, QUOTA_CODE);
});

// ── RECRUIT-341-D2: the muse row matches the CLI's captured refusal text only ───────────────────

test('RECRUIT-341-D2: the muse refusal row matches the CLI’s captured text and no generic prose', () => {
  const card = { providerRefusals: providerRefusalsForHarness('muse') };
  // Captured from a credential-free `muse exec --json` (empty keyring): the CLI's own refusal.
  const captured = 'missing meta credentials: run `muse login` or set META_API_KEY, '
    + 'or save credentials at /tmp/fixture/.config/muse/auth.json';
  assert.equal(matchProviderRefusal(card, captured)?.code, AUTH_CODE,
    'the CLI’s captured refusal text is recognised');
  for (const prose of ['the proxy answered unauthorized', 'the user is not logged in to the dashboard',
    'an unrelated transport error']) {
    assert.equal(matchProviderRefusal(card, prose), null,
      `a pattern nobody captured never blocks a route: ${prose}`);
  }
});

// ── RECRUIT-341-E: the deployment hands the runtime the SAME rows the doctor publishes ──────────

test('RECRUIT-341-E: the deployment’s usage accessor is the doctor’s own derivation, row for row', async (t) => {
  const { deployment } = await openDeployment(t, 'accessor', [ROUTE_READY, ROUTE_QUOTA]);
  const rows = deployment.routeUsageRows();
  const doctor = await deployment.doctor();
  assert.equal(rows.length, doctor.routeUsage.length, 'one accessor, one derivation — never a second list');
  assert.deepEqual(rows, doctor.routeUsage, 'the rows a recruit compares are the rows the doctor publishes');
  assert.deepEqual(rows[0].route, ROUTE_READY);
  for (const row of rows) {
    assert.ok(row.route && row.usage && row.concurrency && row.quota, 'every row carries what a comparison reads');
    assert.equal(typeof row.state, 'string');
  }
});

// ── RECRUIT-341-F: an exact recruit answers with its own row and the ready alternatives ─────────

test('RECRUIT-341-F: an exact recruit answers its own row beside the ready alternatives', async (t) => {
  const alt = Object.freeze({ harness: 'codex', model: 'gpt-5.6-pro', effort: 'high' });
  const fixture = swarmFixture(t, [
    usageRow(ROUTE_READY, { turns: 2, ceiling: 4 }),
    usageRow(alt, { turns: 7, ceiling: 4 }),
    usageRow(ROUTE_QUOTA, { state: 'blocked', code: QUOTA_CODE, resetAt: RESET_AT, ceiling: 4 }),
  ]);
  await fixture.call('create', { purpose: 'exact selection' });

  const recruited = await fixture.call('recruit', {
    participantId: 'lane-f', objective: 'work', options: { exact: alt },
  });
  assert.deepEqual(recruited.routes.chosen.route, alt, 'the caller’s own route is the one admitted');
  assert.equal(recruited.routes.chosen.reason, 'named exactly by the caller');
  assert.deepEqual(recruited.routes.considered.map((row) => row.route),
    [alt, ROUTE_READY], 'the answer names the caller’s route and the ready alternatives, never the blocked ones');
  assert.deepEqual(fixture.seen[0].options.exact, alt, 'an exact selection is admitted untouched');
});
