// Issue #494 — the omp provider→key-file routing is operator-extensible, not a closed table.
//
// The shipped `OMP_PROVIDER_KEY_FILES` table (deepseek/zai/kimi-code) remains the default, but an
// operator extends it per deployment through `advanced.ompCredentials.providerKeyFiles` — a
// provider→repository-key-file record merged over the shipped entries. A route on a provider with
// no mapping, operator-supplied or shipped, still fails closed; the blocked row names the
// configuration seam, not just the absence.
//
// 494-A is the acceptance row: a fourth, operator-supplied provider prefix with an
// operator-supplied key-file mapping reads ready once its key file exists — no source edit, only
// deployment configuration. 494-B pins the fail-closed honesty for an unmapped provider. 494-C
// pins the merge: operator entries extend the shipped defaults, never replace them. 494-D pins
// the option's validation.
//
// Fixture safety: hermetic mkdtemp git repos and HOMEs under os.tmpdir(); key files are written
// mode 600 and their contents are never printed; the only subprocess is `git init`; no provider
// process and no network.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as deploymentModule from '../src/application-deployment.mjs';
import { openBaton } from '../src/index.mjs';

const dirs = [];
function tmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue494-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function repository(name) {
  const root = tmpDir(name);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (args) => {
    try { execFileSync('git', args, { cwd: repo }); } catch (error) {
      throw new Error(`git ${args.join(' ')} failed in fixture: ${String(error.stderr)}`, { cause: error });
    }
  };
  git(['init', '-q']);
  git(['config', 'user.email', 'issue494@example.invalid']);
  git(['config', 'user.name', 'Issue 494']);
  writeFileSync(join(repo, 'README.md'), '# Issue 494 fixture\n');
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  return { root, repo };
}
/** A fixture HOME: os.homedir() honors $HOME on POSIX, so the deployment resolves the omp agent
 * database inside the temp directory. */
function fixtureHome() {
  const home = tmpDir('home-omp');
  mkdirSync(join(home, '.omp', 'agent'), { recursive: true });
  writeFileSync(join(home, '.omp', 'agent', 'agent.db'), 'fixture-agent-db\n');
  writeFileSync(join(home, '.omp', 'agent', 'config.yml'), 'fixture-config\n');
  return home;
}

function provisionKey(repo, name) {
  writeFileSync(join(repo, name), `{"${name.replace(/\.json$/u, '')}":"issue-494-fixture"}\n`,
    { mode: 0o600 });
}

/** The fixture card the routes match: a fixture adapter that satisfies every PRE-EXISTING
 * readiness gate (exact route match, observed version, the #230 worker policy), so the doctor
 * row's verdict is decided by the omp readiness derivation alone. */
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

function ompCard(routes) {
  return Object.freeze({
    harness: 'omp',
    version: '1.0.0',
    authPosture: 'api-key',
    modelSelection: {
      mode: 'exact',
      configuredDefault: routes[0].model,
      available: [...new Set(routes.map((route) => route.model))],
      family: 'omp', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [...new Set(routes.map((route) => route.effort))],
      effortRequired: true, effortObservation: 'unavailable',
      provenance: 'issue-494', refreshedAt: null,
    },
    workerPolicy: WORKER_POLICY,
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
  });
}

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

async function doctorOver({ repo, home, routes, providerKeyFiles, label }) {
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  let deployment = null;
  try {
    deployment = await openBaton({
      repo,
      advanced: {
        deploymentRoot: join(tmpDir(`deployment-${label}`), 'deployment'),
        routes,
        adapters: { omp: new RouteCard(ompCard(routes)) },
        ompCredentials: providerKeyFiles === undefined ? {} : { providerKeyFiles },
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

const ompRows = (doctor) => doctor.routes.filter((route) => route.harness === 'omp');

const ACME_ROUTES = Object.freeze([{ harness: 'omp', model: 'acme/acme-flash', effort: 'low' }]);

test('494-A: an operator-supplied provider prefix becomes ready through the operator key-file mapping', async () => {
  const fixture = repository('operator-provider');
  const home = fixtureHome();

  // Fail closed first: the operator mapping names the file, the file is absent.
  const blocked = await doctorOver({
    repo: fixture.repo, home, routes: ACME_ROUTES,
    providerKeyFiles: { acme: 'acme_key.json' }, label: 'blocked',
  });
  const blockedRow = ompRows(blocked).find((row) => row.model === 'acme/acme-flash');
  assert.notEqual(blockedRow, undefined, 'the operator-provider route is admitted to doctor');
  assert.equal(blockedRow.state, 'blocked');
  assert.equal(blockedRow.code, 'authentication_required',
    `the route fails closed on its own missing key file, got: ${blockedRow.code} ${blockedRow.summary}`);
  assert.ok(blockedRow.summary.includes('acme_key.json'),
    `the blocked row names the provision file, got: ${blockedRow.summary}`);

  // Provision the mapped file: the route reads ready. No source edit, only configuration.
  provisionKey(fixture.repo, 'acme_key.json');
  const ready = await doctorOver({
    repo: fixture.repo, home, routes: ACME_ROUTES,
    providerKeyFiles: { acme: 'acme_key.json' }, label: 'ready',
  });
  const readyRow = ompRows(ready).find((row) => row.model === 'acme/acme-flash');
  assert.notEqual(readyRow, undefined);
  assert.equal(readyRow.state, 'ready',
    `the operator-supplied provider must read ready through its mapping, got: ${readyRow.code} ${readyRow.summary}`);
  assert.equal(ready.ready, true, 'the deployment itself is ready on the operator provider');
});

test('494-B: a provider with no mapping still fails closed and names the configuration seam', async () => {
  const fixture = repository('unmapped-provider');
  const home = fixtureHome();
  provisionKey(fixture.repo, 'acme_key.json'); // present, but nothing maps acme to it

  const doctor = await doctorOver({
    repo: fixture.repo, home, routes: ACME_ROUTES, providerKeyFiles: undefined, label: 'unmapped',
  });
  const row = ompRows(doctor).find((r) => r.model === 'acme/acme-flash');
  assert.notEqual(row, undefined);
  assert.equal(row.state, 'blocked');
  assert.equal(row.code, 'route_unavailable',
    `an unmapped provider fails closed, got: ${row.code} ${row.summary}`);
  assert.ok(row.summary.includes('advanced.ompCredentials.providerKeyFiles'),
    `the blocked row names how to configure a new provider, got: ${row.summary}`);
});

test('494-C: operator entries extend the shipped defaults, never replace them', async () => {
  const fixture = repository('merge');
  const home = fixtureHome();
  const routes = [
    { harness: 'omp', model: 'acme/acme-flash', effort: 'low' },
    { harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'low' },
  ];
  // Only the SHIPPED provider's file is provisioned.
  provisionKey(fixture.repo, 'glm_key.json');

  const doctor = await doctorOver({
    repo: fixture.repo, home, routes,
    providerKeyFiles: { acme: 'acme_key.json' }, label: 'merge',
  });
  const rows = ompRows(doctor);
  const glm = rows.find((row) => row.model === 'zai/glm-5.3-flash');
  const acme = rows.find((row) => row.model === 'acme/acme-flash');
  assert.notEqual(glm, undefined);
  assert.notEqual(acme, undefined);
  assert.equal(glm.state, 'ready',
    `the shipped zai mapping survives the operator extension, got: ${glm.code} ${glm.summary}`);
  assert.equal(acme.state, 'blocked');
  assert.equal(acme.code, 'authentication_required');
});

test('494-D: shipped table intact, and the injectable table resolves a fourth provider', () => {
  // The shipped defaults survive untouched.
  assert.equal(deploymentModule.ompProviderKeyFile('deepseek/deepseek-flash'), 'deepseek_key.json');
  assert.equal(deploymentModule.ompProviderKeyFile('zai/glm-5.3-flash'), 'glm_key.json');
  assert.equal(deploymentModule.ompProviderKeyFile('kimi-code/k3'), 'kimi_key.json');
  assert.equal(deploymentModule.ompProviderKeyFile('unregistered/model'), null);
  // The injectable table resolves an operator provider over the same defaults.
  assert.equal(deploymentModule.ompProviderKeyFile('acme/acme-flash', { acme: 'acme_key.json' }),
    'acme_key.json');
  assert.equal(deploymentModule.ompProviderKeyFile('zai/glm-5.3-flash', { acme: 'acme_key.json' }),
    'glm_key.json', 'the injected entries extend the shipped defaults');
});

test('494-E: providerKeyFiles validation refuses malformed mappings at open', async () => {
  const fixture = repository('validation');
  const home = fixtureHome();
  const bad = async (providerKeyFiles) => {
    await assert.rejects(
      () => doctorOver({
        repo: fixture.repo, home, routes: ACME_ROUTES, providerKeyFiles, label: 'invalid',
      }),
      (error) => error.code === 'deployment_config_invalid'
        && error.message.includes('advanced ompCredentials.providerKeyFiles'),
    );
  };
  await bad('acme_key.json'); // not a record
  await bad({}); // empty: an operator extension names at least one provider
  await bad({ 'bad/provider': 'x.json' }); // a provider prefix is a bare name, the id's first path segment
  await bad({ acme: '/etc/acme_key.json' }); // key files live at the repository root, relative
  await bad({ acme: '../escape.json' }); // the key file never escapes the repository root
  await bad({ acme: 42 }); // the value is the repository key filename
});
