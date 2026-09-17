// issue341-provider-refusals-readiness.test.mjs — Issue #341 part 2: a provider refusal feeds
// route readiness.
//
// The observed failure this pins: `doctor --check` reported `codex/gpt-5.6-sol@*` ready while the
// provider had already refused the route for quota — three recruits died within seconds with the
// provider's own text ("You've hit your usage limit … try again at <date>") and readiness never
// moved. The same class covered #346/#348: a claude-code seat died on "401 OAuth access token has
// expired" with readiness still saying ready.
//
// So the provider's own refusal text, read through the route card's CLOSED refusal table, marks the
// route blocked until the instant that text names — or until a later turn on the route succeeds —
// and the next recruit/run on that route is refused BEFORE any effect, naming the code, the instant
// and the routes that ARE ready. The text a row publishes is the #299-redacted, bounded text, so a
// token-shaped secret in provider output never crosses the row.
//
// Hermetic: temp dirs under os.tmpdir() only; no network, no real provider, no quota.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { Log } from '../src/log.mjs';
import { PROVIDER_FAULT_CODES } from '../src/provider-faults.mjs';

const QUOTA_CODE = PROVIDER_FAULT_CODES.quota;
const AUTH_CODE = 'provider_auth_expired';

const ROUTE_A = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const ROUTE_B = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const CLAUDE_ROUTE = Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-6', effort: 'high' });

// The provider texts themselves: codex's observed quota refusal (with the instant it names), the
// claude auth refusal that opened #348, and an unrelated transport complaint.
const codexQuotaText = (resetAt) => `You've hit your usage limit for the day. Please try again at ${resetAt}.`;
const CODEX_TRANSPORT_TEXT = 'the provider connection was reset before the turn settled';
const CLAUDE_AUTH_TEXT = 'Failed to authenticate. API Error: 401 OAuth access token has expired.';

const routeLabel = (route) => `${route.harness}/${route.model}@${route.effort}`;

function repository(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-refusal-341-${name}-`));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'provider-refusals@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Provider refusals'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# provider refusals fixture\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function deploymentRoot(t, name) {
  const owner = mkdtempSync(join(tmpdir(), `baton-refusal-341-${name}-owner-`));
  t.after(() => rmSync(owner, { force: true, recursive: true }));
  return join(owner, 'deployment');
}

/** A double standing in for one real harness: the card advertises exactly the routes it serves (so
 * the deployment's own exact-route admission accepts them) and publishes that harness's closed
 * provider-refusal table, which MockAdapter derives from the harness it claims to be. */
function fixtureAdapter(harness, routes, ceiling = null) {
  const adapter = new MockAdapter({
    harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    concurrencyCeiling: ceiling,
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact',
      configuredDefault: routes[0].model,
      available: [...new Set(routes.map((r) => r.model))],
      family: harness,
      acceptedPrefixes: [],
      acceptedAliases: [],
      reasoningEffort: [...new Set(routes.map((r) => r.effort))],
      serviceTier: null,
      provenance: 'provider-refusals-fixture',
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

async function openDeployment(t, name, routes, ceiling = null) {
  const repo = repository(t, name);
  const root = deploymentRoot(t, name);
  mkdirSync(join(root, '..'), { recursive: true });
  const byHarness = new Map();
  for (const route of routes) {
    const rows = byHarness.get(route.harness) ?? [];
    rows.push(route);
    byHarness.set(route.harness, rows);
  }
  const adapters = Object.fromEntries(
    [...byHarness].map(([harness, rows]) => [harness, fixtureAdapter(harness, rows, ceiling)]),
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

/** A crash cert as the adapters publish it: the provider's own words in `error`. */
function appendCrash(log, worker, route, text, extra = {}) {
  return log.append({
    worker, harness: route.harness, turnEpoch: 1, kind: 'lifecycle.crashed', actor: 'worker',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: { error: text, usageSeal: null, ...extra },
  });
}

/** A turn terminal as the session tiers publish it: the WorkerResult wrapped in `result`. */
function appendTurnCompleted(log, worker, route, status, turnEpoch = 2) {
  return log.append({
    worker, harness: route.harness, turnEpoch, kind: 'lifecycle.turn_completed', actor: 'worker',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: { result: { status, summary: '', artifacts: { commits: [], files: [] } }, usageSeal: null },
  });
}

function routeRow(doctor, route) {
  return doctor.routes.find((row) => row.harness === route.harness && row.model === route.model
    && row.effort === route.effort);
}

function usageRow(doctor, route) {
  return doctor.routeUsage.find((row) => row.route.harness === route.harness
    && row.route.model === route.model && row.route.effort === route.effort);
}

// ── (a) the codex quota text blocks the route until the instant it names ───────────────────────

test('REFUSAL-341-A: a codex quota crash text reads blocked with the parsed reset instant, on the doctor row and the usage row', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'codex-quota', [ROUTE_A, ROUTE_B]);
  const log = new Log(driverOptions.logDir);
  const worker = 'fixture-codex-quota';
  const resetAt = new Date(Date.now() + 60 * 60_000).toISOString();
  // An unrelated crash before AND after the refusal: the refusal is the newest MATCHING row, and a
  // later crash is not a later success — nothing but the provider answering retires the block.
  appendCrash(log, worker, ROUTE_B, CODEX_TRANSPORT_TEXT);
  appendCrash(log, worker, ROUTE_B, codexQuotaText(resetAt));
  appendCrash(log, worker, ROUTE_B, CODEX_TRANSPORT_TEXT);

  const doctor = await deployment.doctor();
  const rowB = routeRow(doctor, ROUTE_B);
  assert.equal(rowB.state, 'blocked', 'the refused route does not read ready');
  assert.equal(rowB.code, QUOTA_CODE, 'the row names the typed class');
  assert.equal(rowB.resetAt, resetAt, 'the instant is parsed out of the provider\u2019s own words');
  assert.equal(rowB.lastProviderRefusal.code, QUOTA_CODE);
  assert.match(rowB.lastProviderRefusal.text, /hit your usage limit/u, 'the provider\u2019s own text rides the row');
  assert.equal(rowB.lastProviderRefusal.resetAt, resetAt);

  const usageB = usageRow(doctor, ROUTE_B);
  assert.equal(usageB.state, 'blocked', 'the usage row carries the same verdict');
  assert.equal(usageB.code, QUOTA_CODE);
  assert.equal(usageB.resetAt, resetAt, 'the usage row carries the instant its doctor row carries');
  assert.equal(usageB.quota.state, 'exhausted');
  assert.equal(usageB.quota.resetAt, resetAt);
  assert.equal(usageB.lastProviderRefusal.resetAt, resetAt);

  const rowA = routeRow(doctor, ROUTE_A);
  assert.equal(rowA.state, 'ready', 'the other route on the same card is untouched');
  assert.equal(rowA.lastProviderRefusal, null, 'route A never refused');
  assert.equal(usageRow(doctor, ROUTE_A).state, 'ready');
  assert.equal(usageRow(doctor, ROUTE_A).resetAt, null);
  assert.equal(doctor.ready, true, 'one ready route keeps the fleet usable');
  assert.equal(doctor.routeUsage.length, 2);
});

// ── (b) the claude auth refusal blocks with no reset instant ───────────────────────────────────

test('REFUSAL-341-B: a claude OAuth refusal reads blocked as provider_auth_expired with no reset instant', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'claude-auth', [CLAUDE_ROUTE]);
  const log = new Log(driverOptions.logDir);
  appendCrash(log, 'fixture-claude-auth', CLAUDE_ROUTE, CLAUDE_AUTH_TEXT);

  const doctor = await deployment.doctor();
  const row = routeRow(doctor, CLAUDE_ROUTE);
  assert.equal(row.state, 'blocked');
  assert.equal(row.code, AUTH_CODE, 'the auth class, not the quota class');
  assert.equal(row.resetAt, null, 'the provider named no instant, and none is invented');
  assert.equal(row.lastProviderRefusal.code, AUTH_CODE);
  assert.match(row.lastProviderRefusal.text, /OAuth access token has expired/u);

  const usage = usageRow(doctor, CLAUDE_ROUTE);
  assert.equal(usage.state, 'blocked');
  assert.equal(usage.code, AUTH_CODE);
  assert.equal(usage.quota.state, 'ok', 'an expired credential is not a spent quota');
  assert.equal(usage.resetAt, null);
  assert.equal(doctor.ready, false, 'a fleet whose only route is refused is not ready');
});

// ── (c) a later successful turn on the route clears the block ──────────────────────────────────

test('REFUSAL-341-C: a later successful turn on the refused route clears the block', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'later-success', [ROUTE_A]);
  const log = new Log(driverOptions.logDir);
  const worker = 'fixture-later-success';
  const resetAt = new Date(Date.now() + 60 * 60_000).toISOString();
  appendCrash(log, worker, ROUTE_A, codexQuotaText(resetAt));

  const refused = await deployment.doctor();
  assert.equal(routeRow(refused, ROUTE_A).state, 'blocked', 'fixture premise: the route is blocked');
  const refusedAt = routeRow(refused, ROUTE_A).lastProviderRefusal.at;
  assert.equal(usageRow(refused, ROUTE_A).lastProviderRefusal.at, refusedAt);

  await new Promise((resolve) => { setTimeout(resolve, 5); });
  appendTurnCompleted(log, worker, ROUTE_A, 'completed');

  const cleared = await deployment.doctor();
  assert.equal(routeRow(cleared, ROUTE_A).state, 'ready', 'the provider answered, so the block is spent');
  assert.equal(routeRow(cleared, ROUTE_A).code, undefined, 'no code rides a ready row');
  assert.equal(usageRow(cleared, ROUTE_A).state, 'ready');
  assert.equal(usageRow(cleared, ROUTE_A).resetAt, null);
  assert.equal(usageRow(cleared, ROUTE_A).quota.state, 'ok');
  assert.equal(cleared.ready, true);
  // The refusal the provider gave is still the LAST one the ledger holds — the state says it is
  // retired, the row still names what happened and when.
  assert.equal(usageRow(cleared, ROUTE_A).lastProviderRefusal.at, refusedAt);
});

// ── (d) a reset instant in the past is not a block ─────────────────────────────────────────────

test('REFUSAL-341-D: a reset instant already in the past leaves the route ready', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'past-reset', [ROUTE_A]);
  const log = new Log(driverOptions.logDir);
  const past = new Date(Date.now() - 120_000).toISOString();
  appendCrash(log, 'fixture-past-reset', ROUTE_A, codexQuotaText(past));

  const doctor = await deployment.doctor();
  assert.equal(routeRow(doctor, ROUTE_A).state, 'ready', 'the instant it named has passed');
  assert.equal(usageRow(doctor, ROUTE_A).quota.state, 'ok');
  assert.equal(usageRow(doctor, ROUTE_A).resetAt, null);
  assert.equal(usageRow(doctor, ROUTE_A).lastProviderRefusal.resetAt, past, 'the row still names the instant');
  assert.equal(doctor.ready, true);
});

// ── (e) the published crash text is redacted and bounded ───────────────────────────────────────

test('REFUSAL-341-E: the crash text a row publishes is redacted and bounded, and the secret never crosses', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'redaction', [ROUTE_A]);
  const log = new Log(driverOptions.logDir);
  const resetAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const secret = 'sk-live-abcdefghijklmnopqrstuvwx0123';
  const text = `${codexQuotaText(resetAt)} provider said: api_key=${secret}`;
  appendCrash(log, 'fixture-redaction', ROUTE_A, text);

  const doctor = await deployment.doctor();
  const row = routeRow(doctor, ROUTE_A);
  // The refusal is recognised in the provider's own words, while the row publishes neither the
  // token nor an unbounded tail.
  assert.equal(row.state, 'blocked', 'the provider\u2019s refusal is still recognised');
  const published = row.lastProviderRefusal.text;
  assert.ok(!published.includes(secret), 'a token-shaped secret never crosses the row');
  assert.match(published, /credential-shaped content redacted/u, 'the #299 redaction says so in place');
  assert.ok(published.length <= 1024, 'the published text is bounded');
  assert.ok(!JSON.stringify(doctor).includes(secret), 'and it never crosses the serialized doctor');
  assert.ok(!JSON.stringify(doctor.card ?? {}).includes(secret));
  assert.equal(usageRow(doctor, ROUTE_A).lastProviderRefusal.text, published);
});

// ── (f) admission of a run/recruit on the blocked route refuses pre-effect ─────────────────────

test('REFUSAL-341-F: admission on the refused route refuses before any effect, naming the code, the instant and the ready routes', async (t) => {
  const { deployment, driverOptions, adapters } = await openDeployment(t, 'admission', [ROUTE_A, ROUTE_B]);
  const log = new Log(driverOptions.logDir);
  const resetAt = new Date(Date.now() + 60 * 60_000).toISOString();
  appendCrash(log, 'fixture-admission', ROUTE_B, codexQuotaText(resetAt));

  let spawns = 0;
  for (const adapter of Object.values(adapters)) {
    const spawn = adapter.spawn.bind(adapter);
    adapter.spawn = (...args) => { spawns += 1; return spawn(...args); };
  }

  const refused = (error) => error?.code === QUOTA_CODE
    && error?.state === 'blocked'
    && error?.resetAt === resetAt
    && error?.readyRoutes?.includes(routeLabel(ROUTE_A)) === true
    && error.message.includes(QUOTA_CODE)
    && error.message.includes(resetAt)
    && error.message.includes(routeLabel(ROUTE_A));

  await assert.rejects(
    deployment.run('do the work', { exact: ROUTE_B }),
    refused,
    'a recruit on the refused route is refused pre-effect, naming the ready alternative',
  );
  assert.equal(spawns, 0, 'the refusal precedes every adapter effect');

  await assert.rejects(
    deployment.explore('look around', { exact: ROUTE_B }),
    refused,
    'run admission reaches the same refusal on the same derivation',
  );
  assert.equal(spawns, 0, 'and it too precedes every adapter effect');

  // With no route left ready, the refusal says so instead of naming an alternative that is not.
  appendCrash(log, 'fixture-admission', ROUTE_A, codexQuotaText(resetAt));
  await assert.rejects(
    deployment.run('do the work', { exact: ROUTE_B }),
    (error) => error?.code === QUOTA_CODE
      && error?.readyRoutes?.length === 0
      && /no route is ready/u.test(error.message),
    'a fleet with no ready route refuses, and says that plainly',
  );
  assert.equal(spawns, 0);
});
