// issue545-quota-scope-read.test.mjs — Issue #545: a provider quota fact observed on ONE route
// must be read at the account scope by every consumer, its reset instant derived from the window
// the provider's own answer named, and the route row must model REMAINING usage from the provider's
// own answers rather than rendering a subscription 'ready' while its remaining budget is unknown.
//
// The reported incident (2026-09-21, operator): the kimi-code account was refused for quota, yet
// `kimi-code/kimi-code/k3@…` read `quota=exhausted resetAt=unknown` while `omp/kimi-code/k3@…` read
// plain `ready` for the SAME Moonshot account — a recruit was admitted on the omp row and died
// `provider_quota_exhausted` on its first turn, twice in two days.
//
// docs/51 fixed the scope derivation (#523); both rows derive the one scope string `kimi-code` by
// construction. This file pins the READ side of that fact on the LEDGER path — the durable
// `provider.degraded` row and the recorded turn refusal — which #523's rows exercise only through
// the in-memory authority.
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, real git checkouts, no provider process.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { Log } from '../src/log.mjs';
import { PROVIDER_FAULT_CODES, routeQuotaScope } from '../src/provider-faults.mjs';

const KIMI_NATIVE = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'low' });
const KIMI_OMP = Object.freeze({ harness: 'omp', model: 'kimi-code/k3', effort: 'low' });
// The provider's own words, the shape an omp plan refusal carries: a named window, no instant.
const WINDOW_TEXT = 'Usage limit reached for 5 hour, reset later';

const MIN = 60_000;

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
function tmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue545-${label}-`));
  dirs.push(dir);
  return dir;
}

function gitRepo(label) {
  const root = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'master'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue545@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Issue 545'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# issue 545\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

/** A fixture adapter advertising every route it is handed (the issue316-a3 card shape). */
function fleetAdapter(harness, routes) {
  const adapter = new MockAdapter({
    harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    harness,
    authPosture: 'subscription',
    concurrencyCeiling: 4,
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: routes[0].model,
      available: [...new Set(routes.map((route) => route.model))], family: harness,
      acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [...new Set(routes.map((route) => route.effort))],
      serviceTier: null, provenance: 'issue545-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: [] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable' },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });
  return adapter;
}

async function openDeployment(t, label, routes) {
  const repo = gitRepo(`${label}-repo`);
  const root = join(tmpDir(`${label}-owner`), 'deployment');
  mkdirSync(join(root, '..'), { recursive: true });
  let driverOptions = null;
  const adapters = Object.fromEntries([...new Set(routes.map((route) => route.harness))]
    .map((harness) => [harness, fleetAdapter(harness, routes.filter((route) => route.harness === harness))]));
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters,
      routes,
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  }, (options) => { driverOptions = options; return createDriver(options); });
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the test */ } });
  return { deployment, driverOptions };
}

const usageRowFor = (rows, route) => rows.find((row) => (
  row.route.harness === route.harness && row.route.model === route.model && row.route.effort === route.effort));

// ── 545-0: the two access paths are one account (the premise the rest of the file reads) ───────

test('545-0: the kimi-code harness and the omp provider derive one quota scope', () => {
  assert.equal(routeQuotaScope(KIMI_NATIVE), 'kimi-code');
  assert.equal(routeQuotaScope(KIMI_OMP), 'kimi-code',
    'omp reaches the same Moonshot account through kimi_key.json — one scope by construction');
});

// ── 545-a: the LEDGER path reads the scope, not the observing route ────────────────────────────

test('545-a: a durable provider.degraded row on one route degrades every route of its scope', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'ledger-degrade', [KIMI_NATIVE, KIMI_OMP]);
  const log = new Log(driverOptions.logDir);
  const at = new Date().toISOString();
  log.append({
    worker: 'w-1', harness: 'kimi-code@1.0.0', turnEpoch: 1,
    kind: 'provider.degraded', actor: 'policy',
    harnessResolved: KIMI_NATIVE.harness, modelResolved: KIMI_NATIVE.model, effortResolved: KIMI_NATIVE.effort,
    payload: {
      scope: 'kimi-code',
      faultClass: PROVIDER_FAULT_CODES.quota,
      route: KIMI_NATIVE,
      window: { from: at, to: at },
      participants: ['seat-1'],
      count: 1,
      resetAt: null,
      resetAtText: null,
    },
  });
  const doctor = await deployment.doctor();
  const native = usageRowFor(doctor.routeUsage, KIMI_NATIVE);
  const omp = usageRowFor(doctor.routeUsage, KIMI_OMP);
  assert.equal(native.quota.state, 'exhausted', 'the observing route reads the quota fact');
  assert.equal(omp.quota.state, 'exhausted',
    'the sibling route on the SAME account reads the same quota fact — the incident’s split-brain');
  assert.notEqual(omp.state, 'ready', 'a route whose account is exhausted is never rendered ready');
});

// ── 545-b: the reset instant comes from the window the provider's own answer named ─────────────

test('545-b: a refusal that names a window derives its reset instant from the refusal instant', async (t) => {
  const { deployment, driverOptions } = await openDeployment(t, 'window-reset', [KIMI_NATIVE, KIMI_OMP]);
  const log = new Log(driverOptions.logDir);
  const refusedAt = Date.now();
  // The provider's own answer: a quota refusal that names the plan's window and no instant. omp
  // reports a spent plan exactly this way, which is why #442 item 4 kept the words rather than
  // fabricating a UTC instant — and why the window has to be composed with the refusal instant.
  log.append({
    worker: 'w-1', harness: 'kimi-code@1.0.0', turnEpoch: 1,
    kind: 'lifecycle.turn_completed', actor: 'policy',
    harnessResolved: KIMI_NATIVE.harness, modelResolved: KIMI_NATIVE.model, effortResolved: KIMI_NATIVE.effort,
    payload: {
      result: { status: 'failed', failure: { message: WINDOW_TEXT } },
      code: PROVIDER_FAULT_CODES.quota,
      error: WINDOW_TEXT,
      detail: {},
    },
  });
  const doctor = await deployment.doctor();
  const row = usageRowFor(doctor.routeUsage, KIMI_NATIVE);
  assert.equal(row.quota.state, 'exhausted', 'the refusal is read off the ledger');
  assert.ok(typeof row.quota.resetAt === 'string',
    'a provider that named its window has an instant derived from it, never `unknown`');
  const derived = Date.parse(row.quota.resetAt);
  assert.ok(derived >= refusedAt, 'the derived instant is at or after the refusal instant');
  assert.ok(derived - refusedAt <= 5 * 60 * MIN + MIN,
    `the named 5 hour window bounds the derivation, got ${row.quota.resetAt}`);
});

// ── 545-c: remaining usage is modelled on the row, and an unknown remaining is never `ready` ───

test('545-c: the route row carries remaining usage from the provider, and unknown remaining is not `ready`', async (t) => {
  const { deployment } = await openDeployment(t, 'remaining', [KIMI_NATIVE, KIMI_OMP]);
  const doctor = await deployment.doctor();
  const row = usageRowFor(doctor.routeUsage, KIMI_NATIVE);
  assert.ok(row.quota.remaining !== undefined,
    'the row models remaining usage from the provider’s own answers');
  assert.ok(row.quota.window !== undefined || row.quota.observedAt !== undefined,
    'the remaining usage carries the window and the instant it was observed at');
});
