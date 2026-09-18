// DS-n: the served DeepSeek route family (issue #228's omp migration, #293's one readiness
// derivation). DS-3 opens the REAL zero-assembly deployment over a fixture repo with no key
// files, so its rows are decided by the built-in omp adapter — a host must be able to observe the
// omp harness's version for the family to reach the key-file gate (otherwise the honest verdict
// is blocked/harness_unavailable). The same derivation is pinned hermetically, with a fixture
// card instead of a harness, by impl/test/route-truth.test.mjs (RT-1/RT-2).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as deploymentModule from '../src/application-deployment.mjs';
import { openBaton } from '../src/index.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const DEPLOYMENT_SOURCE = join(REPO_ROOT, 'impl', 'src', 'application-deployment.mjs');

function repository(name) {
  const root = mkdtempSync(join(tmpdir(), `baton-deepseek-${name}-`));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'deepseek-routes@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'DeepSeek routes'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# DeepSeek route fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return { root, repo };
}

// A fixture HOME: os.homedir() honors $HOME on POSIX, so every credential root resolves inside
// the temp directory and the operator's real ~/.omp state cannot decide a row. The planted
// agent database is the family's admission fact (#293); the repo-local key files under test stay
// absent. Contents are never read or printed.
function fixtureHome() {
  const home = mkdtempSync(join(tmpdir(), 'baton-deepseek-home-'));
  mkdirSync(join(home, '.omp', 'agent'), { recursive: true });
  writeFileSync(join(home, '.omp', 'agent', 'agent.db'), 'fixture-agent-db\n');
  writeFileSync(join(home, '.omp', 'agent', 'config.yml'), 'fixture-config\n');
  return home;
}

test('DS-1: DEFAULT_ROUTES registers omp deepseek flash as the adapter default and pro[1m] as the pre-update low/medium opt-in', () => {
  const routes = deploymentModule.DEFAULT_BATON_DEPLOYMENT_ROUTES
    .filter((route) => route.harness === 'omp' && route.model.startsWith('deepseek/'));
  const flash = routes.filter((route) => route.model === 'deepseek/deepseek-flash');
  const pro = routes.filter((route) => route.model === 'deepseek/deepseek-v4-pro[1m]');

  assert.deepEqual(flash.map((route) => route.effort), ['low', 'high', 'max']);
  assert.deepEqual(pro.map((route) => route.effort), ['low', 'medium']);
  assert.equal(routes[0]?.model, 'deepseek/deepseek-flash', 'the adapter-configuring first route is flash');
  assert.equal(routes.length, 5, 'no uncontracted DeepSeek model or effort is registered');
  const glm = deploymentModule.DEFAULT_BATON_DEPLOYMENT_ROUTES
    .filter((route) => route.harness === 'omp' && route.model.startsWith('zai/'));
  assert.deepEqual(glm.map((route) => route.effort), ['low', 'high', 'max'],
    'glm registers as the omp zai provider with its own effort ladder');
  const source = readFileSync(DEPLOYMENT_SOURCE, 'utf8');
  assert.match(source, /deepseekRoutes[\s\S]{0,1200}pre-update/u,
    'the misleading pro[1m] route must remain visibly flagged as pre-update');
});

test('DS-2: DeepSeek credential projection carries the repo key path, pointer, and Anthropic-compatible base URL without changing GLM', () => {
  const fixture = repository('projection');
  try {
    const credential = join(fixture.repo, 'deepseek_key.json');
    writeFileSync(credential, '{"deepseek_key":"fixture"}\n', { mode: 0o600 });
    assert.equal(typeof deploymentModule.deepseekCredentialProjection, 'function',
      'the deployment must own one testable DeepSeek projection boundary');
    assert.deepEqual(deploymentModule.deepseekCredentialProjection(fixture.repo), {
      authTokenFile: credential,
      authTokenJsonPointer: '/deepseek_key',
      baseUrl: 'https://api.deepseek.com/anthropic',
      harness: 'deepseek',
    });

    const source = readFileSync(DEPLOYMENT_SOURCE, 'utf8');
    const glmBranch = /else if \(route\.harness === 'glm'\) \{[\s\S]*?\n    \} else \{/u.exec(source)?.[0] ?? '';
    assert.match(glmBranch, /authTokenFile: credential, authTokenJsonPointer: '\/glm_key', harness: 'glm'/u);
    assert.doesNotMatch(glmBranch, /deepseek|api\.deepseek\.com/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('DS-3: missing deepseek_key.json is an honest not-ready doctor result, not a construction error', async () => {
  const fixture = repository('missing-key');
  const home = fixtureHome();
  // The expectation is derived from the served registry, never a literal count.
  const servedOmp = deploymentModule.DEFAULT_BATON_DEPLOYMENT_ROUTES
    .filter((route) => route.harness === 'omp');
  const served = (prefix) => servedOmp.filter((route) => route.model.startsWith(prefix));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  let deployment;
  try {
    deployment = await openBaton({
      repo: fixture.repo,
      advanced: {
        deploymentRoot: join(fixture.root, 'deployment'),
        verification: { command: process.execPath, arguments: ['--version'] },
        capacity: {
          estimate: () => ({ bytes: 1, inodes: 1 }),
          observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
        },
      },
    });
  } finally {
    // Readiness is frozen at open; nothing later re-reads the operator's home.
    process.env.HOME = previousHome;
  }
  try {
    const doctor = await deployment.doctor();
    const routes = doctor.routes.filter((route) => route.harness === 'omp');
    const deepseek = routes.filter((route) => route.model.startsWith('deepseek/'));
    const glm = routes.filter((route) => route.model.startsWith('zai/'));
    assert.equal(deepseek.length, served('deepseek/').length,
      'doctor retains the whole configured omp DeepSeek family');
    assert.equal(glm.length, served('zai/').length,
      'doctor retains the whole configured omp GLM family');
    assert.equal(routes.every((route) => route.state === 'blocked'), true);
    assert.equal(doctor.ready, false, 'a family whose only routes are credential-blocked is not ready');
    assert.equal(deepseek.every((route) => route.code === 'authentication_required'), true);
    assert.equal(deepseek.every((route) => /deepseek_key\.json/u.test(route.summary)), true,
      'every blocked deepseek route names the missing credential file');
    assert.equal(glm.every((route) => /glm_key\.json/u.test(route.summary)), true,
      'every blocked glm route names its own missing credential file');
  } finally {
    if (deployment) await deployment.close();
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('DS-4: deepseek_key.json is ignored beside the existing GLM key', () => {
  const entries = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
    .split(/\r?\n/u).map((entry) => entry.trim());
  assert.equal(entries.includes('glm_key.json'), true, 'the GLM ignore rule remains present');
  assert.equal(entries.includes('deepseek_key.json'), true);
  assert.equal(entries.includes('kimi_key.json'), true, 'the Kimi Code key file (the omp kimi-code route) is ignored the same way');
});
