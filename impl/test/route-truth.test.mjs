// Issue #293 — route truth: the served registry, the ONE omp readiness derivation, and the
// generated fleet-routes table must agree.
//
// RT-1 is the acceptance row: a deployment over a fixture repo lacking the provider key files
// reports every served omp route blocked with ITS OWN missing file named, and ready once that
// file exists. RT-2 pins the one derivation directly (agent database first, per-provider key
// file, never either-file-for-both-providers, fail-closed otherwise) and proves the ready-when
// cell the generated table renders is the same declaration. RT-3 pins CLI.md's fleet-routes table
// as a byte-checked generated block of render-surface-docs.mjs rendered from the served registry.
// RT-4 pins admission: the omp family is advertised from the observed agent database, never by
// declaration.
//
// Fixture safety: hermetic mkdtemp git repos and HOMEs under os.tmpdir(); key files are written
// mode 600 and their contents are never printed; the only subprocesses are `git init` and the
// injected `node --version` verification command; no provider process and no network.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as deploymentModule from '../src/application-deployment.mjs';
import { openBaton } from '../src/index.mjs';
import * as surfaceDocs from '../scripts/render-surface-docs.mjs';

const CLI_DOC = join(import.meta.dirname, '..', 'CLI.md');
const OMP_ROUTES = deploymentModule.DEFAULT_BATON_DEPLOYMENT_ROUTES
  .filter((route) => route.harness === 'omp');
const AGENT_DATABASE = '~/.omp/agent/agent.db';

const dirs = [];
function tmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-route-truth-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function repository(name) {
  const root = tmpDir(name);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'route-truth@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Route truth'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# Route truth fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return { root, repo };
}

/** A fixture HOME: os.homedir() honors $HOME on POSIX, so the deployment resolves every
 * credential root inside the temp directory. `plantOmp` creates the tree the omp projection and
 * the omp readiness derivation both resolve (agent.db is the agent-database fact). */
function fixtureHome({ plantOmp = false } = {}) {
  const home = tmpDir(plantOmp ? 'home-omp' : 'home-bare');
  if (plantOmp) {
    mkdirSync(join(home, '.omp', 'agent'), { recursive: true });
    writeFileSync(join(home, '.omp', 'agent', 'agent.db'), 'fixture-agent-db\n');
    writeFileSync(join(home, '.omp', 'agent', 'config.yml'), 'fixture-config\n');
  }
  return home;
}

/** The provisioning contract's fixture credential. The contents are never read, printed or
 * asserted on — only the file's presence is the deployment fact under test. */
function provisionKey(repo, name) {
  writeFileSync(join(repo, name), `{"${name.replace(/\.json$/u, '')}":"route-truth-fixture"}\n`,
    { mode: 0o600 });
}

/** The omp card the served routes match: a fixture adapter that satisfies every PRE-EXISTING
 * readiness gate (exact route match, observed version, the #230 worker policy), so the row's
 * verdict is decided by the omp readiness derivation alone. */
const WORKER_POLICY = Object.freeze({
  schemaVersion: 1,
  autonomy: {
    supported: ['unattended'], default: 'unattended', perTask: false,
    observation: 'launch', mechanisms: ['permission-mode-yolo'],
  },
  access: {
    supported: ['full'], default: 'full', perTask: false,
    observation: 'launch', mechanisms: ['omp-unsandboxed-permissions'],
  },
  containment: {
    hostProcess: 'same_uid', guarantees: ['private_runtime'],
    configuredPreferences: ['worktree-cwd', 'profile-isolation'], observation: 'unavailable',
  },
});
const OMP_CARD = Object.freeze({
  harness: 'omp',
  version: '1.0.0',
  authPosture: 'api-key',
  modelSelection: {
    mode: 'exact',
    configuredDefault: OMP_ROUTES[0].model,
    available: [...new Set(OMP_ROUTES.map((route) => route.model))],
    family: 'omp', acceptedPrefixes: [], acceptedAliases: [],
    reasoningEffort: [...new Set(OMP_ROUTES.map((route) => route.effort))],
    effortRequired: true, effortObservation: 'unavailable',
    provenance: 'route-truth', refreshedAt: null,
  },
  workerPolicy: WORKER_POLICY,
  permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
});
class RouteCard {
  constructor(card) { this._card = card; this._onEvent = null; }
  card() { return this._card; }
  onEvent(callback) { this._onEvent = callback; }
  emit(event) { this._onEvent?.(event); }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

/** Open the deployment with HOME scoped to the fixture home and return its doctor snapshot.
 * Readiness is frozen at open, so HOME is restored as soon as openBaton resolves. */
async function doctorOver({ repo, home, routes = null, adapters = null, label }) {
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  let deployment = null;
  try {
    deployment = await openBaton({
      repo,
      advanced: {
        deploymentRoot: join(tmpDir(`deployment-${label}`), 'deployment'),
        ...(routes === null ? {} : { routes }),
        ...(adapters === null ? {} : { adapters }),
        verification: { command: process.execPath, arguments: ['--version'] },
        capacity: {
          estimate: () => ({ bytes: 1, inodes: 1 }),
          observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
        },
      },
    });
    return await deployment.doctor();
  } finally {
    try { await deployment?.close(); } catch { /* the fixture tree is removed below */ }
    process.env.HOME = previousHome;
  }
}

/** The served omp family through a fixture card: the verdict path under test, with every
 * environmental fact (harness version, worker policy) held constant. */
function servedOmpDoctor({ repo, home, label }) {
  return doctorOver({ repo, home, routes: OMP_ROUTES, adapters: { omp: new RouteCard(OMP_CARD) }, label });
}

const ompRows = (doctor) => doctor.routes.filter((route) => route.harness === 'omp');

test('RT-1: doctor reports every served omp route blocked with its own file named, and ready once that file exists', async () => {
  const fixture = repository('doctor-gate');
  const home = fixtureHome({ plantOmp: true });

  // No key files: every served omp route is an admitted, blocked row naming ITS OWN file.
  const blocked = await servedOmpDoctor({ repo: fixture.repo, home, label: 'blocked' });
  const blockedRows = ompRows(blocked);
  assert.equal(blockedRows.length, OMP_ROUTES.length,
    'every served omp route is admitted to doctor and reported');
  for (const row of blockedRows) {
    const expectedFile = deploymentModule.ompProviderKeyFile(row.model);
    assert.notEqual(expectedFile, null, `route ${row.model} must name a registered provider file`);
    assert.equal(row.state, 'blocked', `route ${row.model}@${row.effort} must be blocked without its key file`);
    assert.equal(row.code, 'authentication_required');
    assert.ok(row.summary.includes(expectedFile),
      `the blocked row for ${row.model} must name ${expectedFile}, got: ${row.summary}`);
    assert.ok(row.summary.includes('repository root'), 'the remedy names where the file belongs');
  }
  assert.equal(blocked.ready, false, 'a deployment whose only family is credential-blocked is not ready');

  // One provider's key file: exactly that provider's routes turn ready; every OTHER served
  // provider (zai, kimi-code, whatever the family declares — #440: the list is derived, never
  // hand-kept) stays blocked naming ITS OWN file.
  provisionKey(fixture.repo, 'deepseek_key.json');
  const mixed = await servedOmpDoctor({ repo: fixture.repo, home, label: 'mixed' });
  const deepseek = ompRows(mixed).filter((row) => row.model.startsWith('deepseek/'));
  const others = ompRows(mixed).filter((row) => !row.model.startsWith('deepseek/'));
  assert.equal(deepseek.length, OMP_ROUTES.filter((route) => route.model.startsWith('deepseek/')).length);
  assert.equal(others.length, OMP_ROUTES.filter((route) => !route.model.startsWith('deepseek/')).length);
  assert.ok(others.length > 0, 'the served omp family declares more than one provider');
  assert.equal(deepseek.every((row) => row.state === 'ready'), true,
    `a provisioned deepseek key file must make every deepseek effort ready, got ${JSON.stringify(deepseek.map((row) => [row.model, row.effort, row.state, row.code]))}`);
  for (const row of others) {
    assert.equal(row.state === 'blocked' && row.code === 'authentication_required', true,
      `the deepseek key file must never satisfy ${row.model}`);
    assert.ok(row.summary.includes(deploymentModule.ompProviderKeyFile(row.model)),
      `the blocked ${row.model} row names its own file, got: ${row.summary}`);
  }
  assert.equal(mixed.ready, true, 'a deployment with a ready route is ready');

  // Every key file the served family declares: the whole family reads ready. The file list is
  // the family's own declaration (ompProviderKeyFile over the served routes), so a provider that
  // joins DEFAULT_ROUTES later is provisioned here without anyone editing this row (#440).
  const declaredFiles = new Set(OMP_ROUTES.map((route) => deploymentModule.ompProviderKeyFile(route.model)));
  assert.ok(declaredFiles.size >= 2 && ![...declaredFiles].includes(null), 'every served omp route declares a key file');
  for (const file of declaredFiles) if (file !== 'deepseek_key.json') provisionKey(fixture.repo, file);
  const complete = await servedOmpDoctor({ repo: fixture.repo, home, label: 'complete' });
  assert.equal(ompRows(complete).every((row) => row.state === 'ready'), true,
    `every served omp route must read ready with every declared key file present (${[...declaredFiles].join(', ')}), got ${JSON.stringify(ompRows(complete).map((row) => [row.model, row.effort, row.state, row.code]))}`);
});

test('RT-2: ompRouteReadiness is the one per-provider derivation — never either-file-for-both-providers', () => {
  const fixture = repository('derivation');
  const planted = fixtureHome({ plantOmp: true });
  const bare = fixtureHome({ plantOmp: false });
  const previousHome = process.env.HOME;
  try {
    // The agent database is the first fact: without it no omp route is ready, and it is named.
    process.env.HOME = bare;
    const unconfigured = deploymentModule.ompRouteReadiness(fixture.repo, 'deepseek/deepseek-flash');
    assert.equal(unconfigured.state, 'blocked');
    assert.equal(unconfigured.code, 'omp_agent_unconfigured');
    assert.ok(unconfigured.summary.includes(AGENT_DATABASE),
      `the blocked summary must name the agent database, got: ${unconfigured.summary}`);

    process.env.HOME = planted;
    const withoutKeys = deploymentModule.ompRouteReadiness(fixture.repo, 'deepseek/deepseek-flash');
    assert.equal(withoutKeys.state, 'blocked');
    assert.equal(withoutKeys.code, 'authentication_required');
    assert.ok(withoutKeys.summary.includes('deepseek_key.json'));

    // A deepseek key must NOT make zai routes ready (the deleted either-file law), and vice versa.
    provisionKey(fixture.repo, 'deepseek_key.json');
    assert.equal(deploymentModule.ompRouteReadiness(fixture.repo, 'deepseek/deepseek-flash').state, 'ready');
    assert.equal(deploymentModule.ompRouteReadiness(fixture.repo, 'deepseek/deepseek-v4-pro[1m]').state, 'ready');
    const zaiBlocked = deploymentModule.ompRouteReadiness(fixture.repo, 'zai/glm-5.3-flash');
    assert.equal(zaiBlocked.state, 'blocked');
    assert.ok(zaiBlocked.summary.includes('glm_key.json'));
    provisionKey(fixture.repo, 'glm_key.json');
    assert.equal(deploymentModule.ompRouteReadiness(fixture.repo, 'zai/glm-5.3-flash').state, 'ready');

    // A provider with no deployment credential story fails closed, and the registry agrees with
    // the provider table: every served omp model resolves to a registered key file.
    const unknown = deploymentModule.ompRouteReadiness(fixture.repo, 'unregistered/model');
    assert.equal(unknown.state, 'blocked');
    assert.equal(unknown.code, 'route_unavailable');
    assert.equal(deploymentModule.ompProviderKeyFile('unregistered/model'), null);
    for (const route of OMP_ROUTES) {
      assert.notEqual(deploymentModule.ompProviderKeyFile(route.model), null,
        `served route ${route.model} must name a registered provider credential file`);
    }

    // The ready-when cell the generated table renders is the derivation's own declaration: both
    // name the same agent database and the same key file.
    const readyWhen = deploymentModule.routeReadinessContract({ harness: 'omp', model: 'deepseek/deepseek-flash' });
    assert.ok(readyWhen.includes(AGENT_DATABASE) && readyWhen.includes('deepseek_key.json'),
      `the documented ready-when contract must name the gate's own facts, got: ${readyWhen}`);
    assert.equal(readyWhen.includes(deploymentModule.ompProviderKeyFile('zai/glm-5.3-flash')), false,
      'a route documents its own provider key file only');
  } finally {
    process.env.HOME = previousHome;
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('RT-3: the CLI.md fleet-routes table is a byte-checked generated block rendered from the served registry', async () => {
  // The block target exists, so the gate's staleness check covers it.
  const fleetTarget = surfaceDocs.TARGETS.find((target) => target.marker === surfaceDocs.CLI_FLEET_ROUTES_MARKER);
  assert.notEqual(fleetTarget, undefined, 'the gate must carry a cli-fleet-routes staleness target');
  assert.equal(fleetTarget.render, surfaceDocs.renderCliFleetRoutes);

  const committed = readFileSync(CLI_DOC, 'utf8');
  const block = fleetTarget.render();
  // The committed file is the fixed point of a fresh render: the byte check the gate runs.
  assert.equal(surfaceDocs.injectGeneratedBlock(committed, surfaceDocs.CLI_FLEET_ROUTES_MARKER, block), committed,
    'the committed fleet-routes table must byte-equal the rendered registry table');
  assert.equal(surfaceDocs.checkSurfaceDocs().some((finding) => finding.includes('cli-fleet-routes')), false,
    'a committed, registry-true table must not be reported stale');

  // A drifted (hand-edited) table cannot survive the check: a fresh render repairs it exactly.
  const drifted = committed.replace('deepseek/deepseek-flash', 'deepseek-v4-flash');
  assert.notEqual(drifted, committed, 'the drift fixture must actually change the table');
  assert.equal(surfaceDocs.injectGeneratedBlock(drifted, surfaceDocs.CLI_FLEET_ROUTES_MARKER, block), committed,
    'a fresh render must repair a hand-edited table');

  // The table carries the served ids, ladders and ready-when contracts — and none of the stale
  // pre-#228 harness rows or model ids.
  for (const route of OMP_ROUTES) {
    assert.ok(block.includes(`\`${route.model}\``), `the table must carry the served model id ${route.model}`);
    assert.ok(block.includes(deploymentModule.routeReadinessContract(route)),
      `each ready-when cell is the deployment contract for ${route.model}`);
  }
  assert.ok(block.includes(OMP_ROUTES[0].model) && block.includes('zai/glm-5.3-flash'));
  assert.doesNotMatch(block, /glm-5\.2|deepseek-v4-flash|`glm`|`deepseek`/u,
    'the retired harness rows and model ids must never reappear in the generated table');
  const ompRow = block.split('\n').find((row) => row.startsWith('| `omp` |'));
  assert.ok(ompRow?.includes(AGENT_DATABASE) === true, 'omp rows document the agent database the gate reads');

  // The documented cell and the live verdict are one declaration: the same repo proves both.
  const fixture = repository('table-contract');
  const mixed = await servedOmpDoctor({ repo: fixture.repo, home: fixtureHome({ plantOmp: true }), label: 'contract' });
  const blockedRow = ompRows(mixed).find((row) => row.code === 'authentication_required');
  assert.notEqual(blockedRow, undefined);
  assert.ok(blockedRow.summary.includes(deploymentModule.ompProviderKeyFile(blockedRow.model)));
});

test('RT-4: admission reads the observed agent database, never a declaration', async () => {
  const fixture = repository('admission');

  // A HOME with no agent database advertises no omp route at all: the family's ambient fact is
  // unobserved, exactly as codex/grok/kimi-code read their own credential files.
  const bare = await doctorOver({ repo: fixture.repo, home: fixtureHome({ plantOmp: false }), label: 'bare' });
  assert.equal(ompRows(bare).length, 0,
    'an unobserved omp agent database must not advertise an omp route');
  assert.equal(bare.routes.some((route) => route.harness === 'claude-code'), true,
    'the built-in claude-code family is the documented always-admitted exception');

  // With the agent database observed, the whole served family is admitted — and no route is
  // ready without its own provider key file, whatever the ambient facts.
  const planted = await doctorOver({ repo: fixture.repo, home: fixtureHome({ plantOmp: true }), label: 'planted' });
  const rows = ompRows(planted);
  assert.equal(rows.length, OMP_ROUTES.length,
    'with the agent database observed, every served omp route is admitted');
  assert.equal(rows.every((row) => row.state === 'blocked'), true,
    `no omp route is ready by declaration, got ${JSON.stringify(rows.map((row) => [row.model, row.state, row.code]))}`);
  assert.equal(rows.every((row) => row.code !== 'route_credentials_unprojected'), true,
    'the superseded projection-only verdict never decides an omp row (#293)');
});
