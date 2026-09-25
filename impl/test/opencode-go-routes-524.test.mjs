// opencode-go-routes-524.test.mjs — issue #524: opencode-go is a served omp route family.
//
// omp already defines an `opencode-go` provider (its own model catalog and its own
// subscription), but Baton's deployment serves no `omp/opencode-go/*` route, so the CLI
// route verb refuses `omp/opencode-go/<model>@<effort>` with application_route_unavailable.
// This file pins the served table (OG-1), the CLI refusal turning into a served row (OG-2),
// the credential gate behind the provider's own key file (OG-3), and the quota-scope check
// that #523's derivation already generalizes to the new provider (OG-4: no quota logic is
// re-implemented here, only the existing derivation is read).
//
// Fixture safety: hermetic mkdtemp git repos and HOMEs under os.tmpdir(); key files are
// written mode 600 and their contents are never printed; the only subprocesses are
// `git init` and the injected `node --version` verification command; no provider process
// and no network.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as deploymentModule from '../src/application-deployment.mjs';
import { runBatonCli } from '../src/application-cli.mjs';
import { providerOfRoute } from '../src/provider-faults.mjs';
import { routeQuotaKey } from '../src/route-quota.mjs';
import { openBaton } from '../src/index.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const OPENCODE_GO_MODELS = Object.freeze([
  'opencode-go/glm-5.3',
  'opencode-go/glm-5.3-flash',
  'opencode-go/deepseek-v4-pro',
  'opencode-go/kimi-k3',
]);
const OPENCODE_GO_EFFORTS = Object.freeze(['low', 'high', 'max']);
const OPENCODE_GO_KEY_FILE = 'opencode_go_key.json';

const dirs = [];
function tmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-opencode-go-524-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function repository(name) {
  const root = tmpDir(name);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'opencode-go-524@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'opencode-go routes'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# opencode-go route fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return { root, repo };
}

/** A fixture HOME carrying the omp agent database, so the omp family is admitted. */
function fixtureHome() {
  const home = tmpDir('home');
  mkdirSync(join(home, '.omp', 'agent'), { recursive: true });
  writeFileSync(join(home, '.omp', 'agent', 'agent.db'), 'fixture-agent-db\n');
  writeFileSync(join(home, '.omp', 'agent', 'config.yml'), 'fixture-config\n');
  return home;
}

test('OG-1: DEFAULT_ROUTES serves the opencode-go family on the omp low/high/max ladder', () => {
  const served = deploymentModule.DEFAULT_BATON_DEPLOYMENT_ROUTES
    .filter((route) => route.harness === 'omp' && route.model.startsWith('opencode-go/'));
  assert.deepEqual(
    [...new Set(served.map((route) => route.model))].sort(),
    [...OPENCODE_GO_MODELS].sort(),
    'the served opencode-go family covers the overlap models Baton already routes directly',
  );
  for (const model of OPENCODE_GO_MODELS) {
    assert.deepEqual(
      served.filter((route) => route.model === model).map((route) => route.effort),
      [...OPENCODE_GO_EFFORTS],
      `${model} rides the omp low/high/max ladder`,
    );
  }
  assert.equal(
    served.every((route) => route.billing === 'subscription'),
    true,
    'opencode-go is an independently-billed subscription, never per-token API billing',
  );
  for (const model of OPENCODE_GO_MODELS) {
    assert.equal(deploymentModule.ompProviderKeyFile(model), OPENCODE_GO_KEY_FILE,
      `${model} resolves to the provider's own deployment credential file`);
  }
  const entries = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
    .split(/\r?\n/u).map((entry) => entry.trim());
  assert.equal(entries.includes(OPENCODE_GO_KEY_FILE), true,
    'the opencode-go key file is ignored like the shipped provider keys');
});

test('OG-2: the CLI route verb serves omp/opencode-go/glm-5.3-flash@high (was application_route_unavailable)', async () => {
  const fixture = repository('cli-route');
  const home = fixtureHome();
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  let deployment = null;
  try {
    deployment = await openBaton({
      repo: fixture.repo,
      advanced: {
        deploymentRoot: join(tmpDir('deployment-cli'), 'deployment'),
        verification: { command: process.execPath, arguments: ['--version'] },
        capacity: {
          estimate: () => ({ bytes: 1, inodes: 1 }),
          observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
        },
      },
    });
  } finally {
    process.env.HOME = previousHome;
  }
  try {
    const row = await runBatonCli({
      kind: 'route',
      exact: { harness: 'omp', model: 'opencode-go/glm-5.3-flash', effort: 'high' },
    }, deployment);
    assert.equal(row.harness, 'omp');
    assert.equal(row.model, 'opencode-go/glm-5.3-flash');
    assert.equal(row.effort, 'high');
  } finally {
    if (deployment) await deployment.close();
  }
});

test('OG-3: the opencode-go credential gate names its own key file, never another provider\'s', () => {
  const fixture = repository('credential-gate');
  const home = fixtureHome();
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const blocked = deploymentModule.ompRouteReadiness(fixture.repo, 'opencode-go/glm-5.3-flash', 'high');
    assert.equal(blocked.state, 'blocked');
    assert.equal(blocked.code, 'authentication_required');
    assert.ok(blocked.summary.includes(OPENCODE_GO_KEY_FILE),
      `the blocked row must name ${OPENCODE_GO_KEY_FILE}, got: ${blocked.summary}`);
    assert.ok(!blocked.summary.includes('glm_key.json'),
      `the opencode-go row must never name the direct zai file, got: ${blocked.summary}`);

    // #591: presence alone is not a credential — the file must carry a usable entry.
    writeFileSync(join(fixture.repo, OPENCODE_GO_KEY_FILE), '{}\n', { mode: 0o600 });
    const empty = deploymentModule.ompRouteReadiness(fixture.repo, 'opencode-go/glm-5.3-flash', 'high');
    assert.equal(empty.state, 'blocked');
    assert.equal(empty.code, 'authentication_required');
    assert.ok(empty.summary.includes(OPENCODE_GO_KEY_FILE),
      `the empty-object row must name ${OPENCODE_GO_KEY_FILE}, got: ${empty.summary}`);
    writeFileSync(join(fixture.repo, OPENCODE_GO_KEY_FILE), 'not json\n', { mode: 0o600 });
    assert.equal(
      deploymentModule.ompRouteReadiness(fixture.repo, 'opencode-go/glm-5.3-flash', 'high').state,
      'blocked',
      'an unparseable key file is not a credential',
    );
    writeFileSync(join(fixture.repo, OPENCODE_GO_KEY_FILE), '{"opencode_go_key":""}\n', { mode: 0o600 });
    assert.equal(
      deploymentModule.ompRouteReadiness(fixture.repo, 'opencode-go/glm-5.3-flash', 'high').state,
      'blocked',
      'a credential entry with an empty value is not a credential',
    );

    writeFileSync(join(fixture.repo, OPENCODE_GO_KEY_FILE),
      '{"opencode_go_key":"opencode-go-524-fixture"}\n', { mode: 0o600 });
    assert.deepEqual(
      deploymentModule.ompRouteReadiness(fixture.repo, 'opencode-go/glm-5.3-flash', 'high'),
      { state: 'ready' },
      'the provisioned opencode-go key file makes the route ready without touching other providers',
    );
    assert.equal(
      deploymentModule.ompRouteReadiness(fixture.repo, 'zai/glm-5.3-flash', 'high').state,
      'blocked',
      'the opencode-go key file must never satisfy the direct zai route',
    );

    const readyWhen = deploymentModule.routeReadinessContract(
      { harness: 'omp', model: 'opencode-go/kimi-k3' });
    assert.ok(readyWhen.includes(OPENCODE_GO_KEY_FILE),
      `the documented ready-when contract must name the gate's own file, got: ${readyWhen}`);
  } finally {
    process.env.HOME = previousHome;
  }
});

test('OG-4: the existing quota derivation scopes opencode-go routes to their own provider pool', () => {
  // #523 re-keyed quota/degrade tracking from (harness, model, effort) to quota scope; this
  // test only reads the existing derivation to confirm it generalizes to the new provider.
  for (const model of OPENCODE_GO_MODELS) {
    assert.equal(
      providerOfRoute({ harness: 'omp', model, effort: 'high' }),
      'opencode-go',
      `${model} resolves to the opencode-go provider, never the harness or another provider`,
    );
  }
  const directCounterparts = Object.freeze({
    'opencode-go/glm-5.3-flash': { harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'high' },
    'opencode-go/deepseek-v4-pro': { harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'high' },
    'opencode-go/kimi-k3': { harness: 'omp', model: 'kimi-code/k3', effort: 'high' },
  });
  for (const [model, direct] of Object.entries(directCounterparts)) {
    const pooled = routeQuotaKey({ harness: 'omp', model, effort: 'high' });
    assert.notEqual(pooled, null, 'an opencode-go route keys its quota block');
    assert.notEqual(pooled, routeQuotaKey(direct),
      `${model} must never share a quota block with its direct-provider counterpart`);
  }
});
