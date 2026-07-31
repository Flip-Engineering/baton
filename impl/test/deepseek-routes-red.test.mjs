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

test('DS-1: DEFAULT_ROUTES registers flash as the full-ladder DeepSeek default and pro[1m] as the pre-update low/medium opt-in', () => {
  const routes = deploymentModule.DEFAULT_BATON_DEPLOYMENT_ROUTES
    .filter((route) => route.harness === 'deepseek');
  const flash = routes.filter((route) => route.model === 'deepseek-v4-flash');
  const pro = routes.filter((route) => route.model === 'deepseek-v4-pro[1m]');

  assert.deepEqual(flash.map((route) => route.effort), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(pro.map((route) => route.effort), ['low', 'medium']);
  assert.equal(routes[0]?.model, 'deepseek-v4-flash', 'the adapter-configuring first route is flash');
  assert.equal(routes.length, 7, 'no uncontracted DeepSeek model or effort is registered');
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
    const doctor = await deployment.doctor();
    const routes = doctor.routes.filter((route) => route.harness === 'deepseek');
    assert.equal(routes.length, 7, 'doctor retains the whole configured DeepSeek family');
    assert.equal(routes.every((route) => route.state === 'blocked'), true);
    assert.equal(routes.every((route) => /deepseek_key\.json/u.test(route.summary)), true,
      'every blocked route names the missing credential file');
  } finally {
    if (deployment) await deployment.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('DS-4: deepseek_key.json is ignored beside the existing GLM key', () => {
  const entries = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
    .split(/\r?\n/u).map((entry) => entry.trim());
  assert.equal(entries.includes('glm_key.json'), true, 'the GLM ignore rule remains present');
  assert.equal(entries.includes('deepseek_key.json'), true);
});
