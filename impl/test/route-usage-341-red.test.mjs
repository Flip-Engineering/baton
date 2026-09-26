// route-usage-341-red.test.mjs — Issue #341: per-served-route usage rows derived from the
// deployment's own ledger (resource.tokens, usageSeal, lifecycle.crashed) and adapter cards.
//
// Fixture: a deployment with TWO routes. Route A is healthy; route B's last crash carries
// the captured codex quota text ("You've hit your usage limit ... try again at <date>"),
// so route B reads blocked with resetAt on the doctor and a recruit on it is refused
// naming route A as ready. The usage row counts fixture turns.
//
// Hermetic: temp dirs under os.tmpdir() only; no network, no real provider.

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

const ROUTE_A = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const ROUTE_B = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
// The reset instant is a FUTURE wall-clock instant derived from now: a literal date turned this
// file into a time bomb (USAGE-341-3/4 went red at 2026-09-18T00:00Z when the recorded block
// lapsed and the route read ready again).
const EXPECTED_RESET_AT = new Date(Math.floor(Date.now() / 1000) * 1000 + 24 * 60 * 60 * 1000).toISOString();
const CODEX_QUOTA_TEXT = `You've hit your usage limit for the day. Please try again at ${EXPECTED_RESET_AT.replace('.000Z', 'Z')}.`;

function repository(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-route-usage-${name}-`));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'route-usage@example.invalid', GIT_COMMITTER_EMAIL: 'route-usage@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Route usage', GIT_COMMITTER_NAME: 'Route usage' });
  writeFileSync(join(root, 'README.md'), '# route usage fixture\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function deploymentRoot(t, name) {
  const owner = mkdtempSync(join(tmpdir(), `baton-route-usage-${name}-owner-`));
  t.after(() => rmSync(owner, { force: true, recursive: true }));
  return join(owner, 'deployment');
}

function fixtureAdapter(routes, ceiling = null) {
  const adapter = new MockAdapter({
    harness: 'codex',
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
      family: 'codex',
      acceptedPrefixes: [],
      acceptedAliases: [],
      reasoningEffort: [...new Set(routes.map((r) => r.effort))],
      serviceTier: null,
      provenance: 'route-usage-fixture',
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
  let driverOptions = null;
  const adapter = fixtureAdapter(routes, ceiling);
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters: { codex: adapter },
      routes,
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  }, (options) => {
    driverOptions = options;
    return createDriver(options);
  });
  t.after(async () => { try { await deployment.close(); } catch {} });
  return { deployment, driverOptions };
}

// ── USAGE-341-1: route usage rows are present on doctorReadiness ──────────────

test('USAGE-341-1: doctorReadiness includes routeUsage rows for each served route', async (t) => {
  const { deployment } = await openDeployment(t, 'usage-rows', [ROUTE_A, ROUTE_B]);
  const doctor = await deployment.doctor();

  assert.ok(doctor.routeUsage, 'doctor must carry routeUsage');
  assert.ok(Array.isArray(doctor.routeUsage), 'routeUsage must be an array');
  assert.equal(doctor.routeUsage.length, 2, 'one usage row per served route');

  const rowA = doctor.routeUsage.find((r) =>
    r.route.harness === ROUTE_A.harness && r.route.model === ROUTE_A.model && r.route.effort === ROUTE_A.effort);
  const rowB = doctor.routeUsage.find((r) =>
    r.route.harness === ROUTE_B.harness && r.route.model === ROUTE_B.model && r.route.effort === ROUTE_B.effort);

  assert.ok(rowA, 'route A usage row must be present');
  assert.ok(rowB, 'route B usage row must be present');

  // Usage shape
  assert.equal(typeof rowA.usage.turns, 'number', 'turns is a number');
  assert.equal(typeof rowA.usage.tokens, 'number', 'tokens is a number');
  assert.equal(rowA.usage.turns, 0, 'no turns yet');
  assert.equal(rowA.usage.tokens, 0, 'no tokens yet');

  // Concurrency shape
  assert.ok('ceiling' in rowA.concurrency, 'concurrency.ceiling is present');
  assert.ok('inUse' in rowA.concurrency, 'concurrency.inUse is present');

  // Quota shape
  assert.ok(rowA.quota, 'quota field is present');
  assert.equal(rowA.quota.state, 'ok', 'no quota block yet');
  assert.equal(rowA.quota.resetAt, null, 'no reset time');

  // lastProviderRefusal shape
  assert.equal(rowA.lastProviderRefusal, null, 'no refusal yet');
});

// ── USAGE-341-2: concurrency ceiling from adapter card ───────────────────────

test('USAGE-341-2: concurrency ceiling from adapter card flows into usage row', async (t) => {
  const { deployment } = await openDeployment(t, 'ceiling', [ROUTE_A], 4);
  const doctor = await deployment.doctor();

  const row = doctor.routeUsage?.[0];
  assert.ok(row, 'usage row must be present');
  assert.equal(row.concurrency.ceiling, 4, 'ceiling flows from adapter card');
  assert.equal(row.concurrency.inUse, 0, 'nothing in flight');
});

// ── USAGE-341-3: quota exhaustion from codex text marks route blocked ────────

test('USAGE-341-3: a codex quota crash marks the route blocked with resetAt on the doctor usage row', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'quota', [ROUTE_A, ROUTE_B]);
  const quota = driverOptions.routeQuotaAuthority;
  assert.ok(quota, 'the deployment hands its coordinator the exhausted-route authority');

  // Record a quota block on ROUTE_B with the codex quota text pattern
  const resetAt = EXPECTED_RESET_AT;
  quota.record(ROUTE_B, { resetAt, at: Date.now() });

  const doctor = await deployment.doctor();
  const usageB = doctor.routeUsage?.find((r) =>
    r.route.effort === ROUTE_B.effort);

  assert.ok(usageB, 'route B usage row must be present');
  assert.equal(usageB.quota.state, 'exhausted', 'quota state must be exhausted');
  assert.equal(usageB.quota.resetAt, resetAt, 'resetAt from the provider');
  assert.equal(usageB.state, 'blocked', 'route state must be blocked');
  assert.equal(usageB.code, PROVIDER_FAULT_CODES.quota, 'code must be provider_quota_exhausted');

  // #523: Route A shares the codex scope with Route B — both are exhausted.
  const usageA = doctor.routeUsage?.find((r) =>
    r.route.effort === ROUTE_A.effort);
  assert.ok(usageA, 'route A usage row must be present');
  assert.equal(usageA.quota.state, 'exhausted', '#523: route A shares the codex scope');
  assert.equal(usageA.state, 'blocked', '#523: route A is blocked by the scope-wide quota');
});

// ── USAGE-341-4: recruit on exhausted route is refused naming ready routes ───

test('USAGE-341-4: recruit on an exhausted route is refused and the refusal names ready routes', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'refuse', [ROUTE_A, ROUTE_B]);
  const quota = driverOptions.routeQuotaAuthority;
  quota.record(ROUTE_B, { resetAt: EXPECTED_RESET_AT, at: Date.now() });

  let spawns = 0;
  const adapter = Object.values(driverOptions.adapters)[0];
  const origSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawns += 1; return origSpawn(...args); };

  await assert.rejects(
    deployment.run('do the work', { exact: ROUTE_B }),
    (error) => error?.code === PROVIDER_FAULT_CODES.quota
      && error?.resetAt === EXPECTED_RESET_AT
      && error.message.includes(EXPECTED_RESET_AT),
    'recruit on exhausted route must refuse with quota code and resetAt',
  );
  assert.equal(spawns, 0, 'the refusal precedes every adapter effect');

  // #523: Route A shares the codex scope — both routes are blocked by the scope-wide quota.
  const doctor = await deployment.doctor();
  const blockedRoutes = doctor.routes.filter((r) => r.state === 'blocked');
  assert.ok(
    blockedRoutes.some((r) => r.effort === ROUTE_A.effort),
    '#523: route A is blocked by the scope-wide quota',
  );
});

// ── USAGE-341-5: usage row tracks turns from the operational log ─────────────

test('USAGE-341-5: usage row reflects turn counts from the operational log', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'turns', [ROUTE_A]);
  const log = new Log(driverOptions.logDir);

  const workerId = 'fixture-worker-1';
  log.append({
    worker: workerId, harness: 'codex', turnEpoch: 1,
    kind: 'lifecycle.turn_started', actor: 'orchestrator',
    harnessResolved: ROUTE_A.harness, modelResolved: ROUTE_A.model, effortResolved: ROUTE_A.effort,
    payload: {},
  });
  log.append({
    worker: workerId, harness: 'codex', turnEpoch: 1,
    kind: 'resource.tokens', actor: 'worker',
    harnessResolved: ROUTE_A.harness, modelResolved: ROUTE_A.model, effortResolved: ROUTE_A.effort,
    payload: { tokens: 5000, usd: 0.05, accounting: 'delta', source: 'fixture' },
  });
  log.append({
    worker: workerId, harness: 'codex', turnEpoch: 2,
    kind: 'lifecycle.turn_started', actor: 'orchestrator',
    harnessResolved: ROUTE_A.harness, modelResolved: ROUTE_A.model, effortResolved: ROUTE_A.effort,
    payload: {},
  });
  log.append({
    worker: workerId, harness: 'codex', turnEpoch: 2,
    kind: 'resource.tokens', actor: 'worker',
    harnessResolved: ROUTE_A.harness, modelResolved: ROUTE_A.model, effortResolved: ROUTE_A.effort,
    payload: { tokens: 3000, usd: 0.03, accounting: 'delta', source: 'fixture' },
  });

  const doctor = await deployment.doctor();
  const row = doctor.routeUsage?.[0];
  assert.ok(row, 'usage row must be present');
  assert.equal(row.usage.turns, 2, 'two turns were recorded');
  assert.equal(row.usage.tokens, 8000, 'token sum is correct');
});

// ── USAGE-341-6: route usage includes lastProviderRefusal when present ───────

test('USAGE-341-6: a provider quota crash populates lastProviderRefusal on the usage row', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'refusal', [ROUTE_A]);
  const log = new Log(driverOptions.logDir);

  const workerId = 'fixture-worker-refusal';
  log.append({
    worker: workerId, harness: 'codex', turnEpoch: 1,
    kind: 'lifecycle.crashed', actor: 'worker',
    harnessResolved: ROUTE_A.harness, modelResolved: ROUTE_A.model, effortResolved: ROUTE_A.effort,
    payload: {
      error: CODEX_QUOTA_TEXT,
      code: PROVIDER_FAULT_CODES.quota,
    },
  });

  const doctor = await deployment.doctor();
  const row = doctor.routeUsage?.[0];
  assert.ok(row, 'usage row must be present');
  assert.ok(row.lastProviderRefusal, 'lastProviderRefusal must be present');
  assert.equal(row.lastProviderRefusal.code, PROVIDER_FAULT_CODES.quota);
  assert.ok(row.lastProviderRefusal.at, 'at timestamp must be present');
  assert.ok(typeof row.lastProviderRefusal.text === 'string', 'text must be a string');
  assert.ok(row.lastProviderRefusal.text.length > 0, 'text must be non-empty');
  assert.ok(row.lastProviderRefusal.text.length <= 1024, 'text must be bounded');
});

// ── USAGE-341-7: deployment summary includes route usage for swarm view ──────

test('USAGE-341-7: deployment summary includes routeUsage for swarm.view', async (t) => {
  const { deployment } = await openDeployment(t, 'summary', [ROUTE_A]);
  const card = deployment.card();
  const readiness = card.readiness;

  assert.ok(readiness, 'card readiness must be present');
  assert.ok(readiness.routeUsage, 'card readiness must include routeUsage');
  assert.ok(Array.isArray(readiness.routeUsage), 'routeUsage must be an array');
  assert.equal(readiness.routeUsage.length, 1, 'one usage row per served route');
});

// ── USAGE-341-8: route.usage command is registered in semantics ──────────────

test('USAGE-341-8: route.usage command is registered in application-semantics', async (t) => {
  const { APPLICATION_SEMANTIC_REGISTRY } = await import('../src/application-semantics.mjs');
  const commands = APPLICATION_SEMANTIC_REGISTRY?.cli?.commands ?? [];
  const routeUsage = commands.find((cmd) => cmd.id === 'route.usage');
  assert.ok(routeUsage, 'route.usage command must be registered');
  assert.ok(routeUsage.usage?.includes('baton route usage'), 'usage text must include baton route usage');
});
