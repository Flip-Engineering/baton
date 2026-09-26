// issue564-wake-capability-report.test.mjs — issue #564's capability report: the SERVED
// doctor names, per harness this deployment can run, how a root-addressed wake starts a turn in an
// idle session — or that no channel exists.
//
// The delivery slice (impl/src/wake-delivery.mjs) owns the ONE closed per-harness capability
// table: claude-code carries `session-socket` and canStartTurn true, and codex, grok, kimi-code,
// muse and omp carry `none` with the channel that was checked named in their note. This slice
// reports those rows where a root reads them: `BatonDeployment.doctorReadiness()` — the surface
// `deployment.doctor` and the resident facade call — over the harnesses of this deployment's own
// served routes, with a harness the table does not know reported as a row rather than omitted.
// The bare BatonApplication's readiness is NOT the surface under test: the served class composes
// its own base (application-deployment.mjs:3621), and a wiring only into the application would be
// a false positive for every user-facing doctor read.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openBatonDeployment } from '../src/application-deployment.mjs';
import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';
import { HARNESS_WAKE_DELIVERY, harnessWakeCapabilityForHarnesses } from '../src/wake-delivery.mjs';

const ROUTE = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });

function initRepo(repo) {
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Issue 564 capability'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue564@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
}

/** The one mock route the deployment serves, with the card shape a dispatchable route declares. */
function deploymentAdapter() {
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed' } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue564-capability-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] },
    },
  });
  return adapter;
}

/** A REAL deployment opened in-process (the issue476/phase85 pattern): `deployment.doctorReadiness`
 * below is the served surface, never a hand-built object. */
async function openDeployment(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-564-capability-'));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const home = join(directory, 'home');
  const configRoot = join(directory, 'config');
  mkdirSync(home, { recursive: true });
  mkdirSync(configRoot, { recursive: true });
  const [bypassName, bypassValue] = HOST_CAPACITY_BYPASS.split('=');
  const priorBypass = process.env[bypassName];
  process.env[bypassName] = bypassValue;
  let driver = null;
  let deployment = null;
  try {
    deployment = await openBatonDeployment({
      repo,
      advanced: {
        deploymentRoot: join(directory, 'deployment'),
        adapters: { mock: deploymentAdapter() },
        routes: [ROUTE],
        verification: { command: 'node', arguments: ['--test'] },
        resident: {
          env: { HOME: home, XDG_CONFIG_HOME: configRoot, PATH: process.env.PATH ?? '' },
          home, webDrainMs: 300, sessionTtlMs: 60_000, commandTimeoutMs: 30_000, pollMs: 25,
        },
      },
    }, (options) => {
      driver = createDriver({ ...options, stopDeadlineMs: 400 });
      return driver;
    });
  } finally {
    if (priorBypass === undefined) delete process.env[bypassName];
    else process.env[bypassName] = priorBypass;
  }
  t.after(async () => {
    await deployment?.close?.().catch(() => {});
    await driver?.drainAndClose('564-capability').catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  });
  return { deployment, driver, directory };
}

test('564-c1: the capability rows cover exactly the named harnesses, sorted, unknown named', () => {
  const rows = harnessWakeCapabilityForHarnesses(['codex', 'claude-code', 'claude-code', null, '']);
  assert.deepEqual(rows.map((row) => row.harness), ['claude-code', 'codex'],
    'duplicates collapse and non-string names are dropped, sorted by harness');
  const claude = rows.find((row) => row.harness === 'claude-code');
  assert.equal(claude.canStartTurn, true, 'the operator Claude session has a turn-starting channel');
  assert.equal(claude.mechanism, 'session-socket', 'and it is named');
  const codex = rows.find((row) => row.harness === 'codex');
  assert.equal(codex.canStartTurn, false, 'an idle codex session cannot be started by this deployment yet');
  assert.equal(codex.mechanism, 'none', 'and the row says so instead of staying silent');
  assert.equal(typeof codex.note, 'string', 'the note names the channel that was checked');
  assert.deepEqual(codex, Object.freeze({ harness: 'codex', ...HARNESS_WAKE_DELIVERY.codex }),
    'the row is the delivery table own row, not a copy that can drift');
  const unknown = harnessWakeCapabilityForHarnesses(['mystery-harness']);
  assert.equal(unknown.length, 1, 'a harness the table does not know is REPORTED, never omitted');
  assert.equal(unknown[0].canStartTurn, false, 'and it can start no turn');
  assert.deepEqual(harnessWakeCapabilityForHarnesses([]), [], 'no routes, no rows');
});

test('564-c2: the SERVED doctor carries the capability rows of the harnesses this deployment runs', async (t) => {
  const { deployment } = await openDeployment(t);
  const readiness = deployment.doctorReadiness();
  assert.ok(Array.isArray(readiness.wakeDelivery),
    'the SERVED doctor document carries the per-harness wake capability (application-deployment.mjs:3621 base), so a root reading deployment.doctor is never silently deaf — a wiring only into the bare application is a false positive for this surface');
  assert.deepEqual(readiness.wakeDelivery.map((row) => row.harness), [ROUTE.harness],
    'exactly the harnesses of this deployment served routes, sorted');
  const row = readiness.wakeDelivery[0];
  assert.equal(row.mechanism, 'unknown',
    'the fixture route harness is outside the delivery table, and an unknown harness is reported as such');
  assert.equal(row.canStartTurn, false, 'and it can start no turn, which is the honest answer');
  assert.equal(row.note.length > 0, true,
    'the report states why this harness cannot be woken, so the reader is told rather than left guessing');
  assert.ok(Object.isFrozen(readiness), 'the doctor document stays frozen like every other readiness read');
});

test('564-c3: every harness the deployment vocabulary names has a capability row', () => {
  const routeHarnesses = ['codex', 'muse', 'grok', 'kimi-code', 'claude-code', 'omp'];
  const rows = harnessWakeCapabilityForHarnesses(routeHarnesses);
  assert.deepEqual(rows.map((row) => row.harness), [...routeHarnesses].sort(),
    'the doctor cannot report a harness the delivery table has no row for');
  for (const row of rows) {
    assert.equal(row.canStartTurn, row.mechanism !== 'none',
      'a row that cannot start a turn never claims a mechanism that could');
  }
});
