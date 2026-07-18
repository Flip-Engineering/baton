import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, openBaton } from '../src/index.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });

function repository(t, name, files = {}) {
  const root = mkdtempSync(join(tmpdir(), `baton-phase78-readiness-${name}-`));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase78-readiness@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 78 readiness'], { cwd: root });
  for (const [path, content] of Object.entries(files)) {
    const parent = join(root, path, '..');
    mkdirSync(parent, { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if (Object.keys(files).length === 0) writeFileSync(join(root, 'README.md'), '# readiness fixture\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function deploymentRoot(t, name) {
  const owner = mkdtempSync(join(tmpdir(), `baton-phase78-readiness-${name}-owner-`));
  t.after(() => rmSync(owner, { force: true, recursive: true }));
  return join(owner, 'deployment');
}

function effectTrap(observed) {
  const trap = (method) => (..._args) => {
    observed.push(method);
    throw Object.assign(new Error(`preflight crossed into adapter ${method}`), {
      code: 'provider_effect_observed',
    });
  };
  return Object.freeze({
    card: trap('card'),
    spawn: trap('spawn'),
    prompt: trap('prompt'),
    interrupt: trap('interrupt'),
    approve: trap('approve'),
    answer: trap('answer'),
    kill: trap('kill'),
    onEvent: trap('onEvent'),
  });
}

function advanced(root, adapter, verification) {
  return {
    deploymentRoot: root,
    adapters: { codex: adapter },
    routes: [ROUTE],
    verification,
  };
}

test('DP1: a locked Node repository without its required dependency tree refuses before deployment or provider effects', async (t) => {
  const repo = repository(t, 'dependencies', {
    'package.json': '{"private":true,"scripts":{"test":"node --test"}}\n',
    'package-lock.json': '{"name":"phase78-readiness","lockfileVersion":3,"packages":{}}\n',
    'test/smoke.test.mjs': "import test from 'node:test'; test('smoke', () => {});\n",
  });
  const root = deploymentRoot(t, 'dependencies');
  const observed = [];

  await assert.rejects(
    openBaton({
      repo,
      advanced: advanced(root, effectTrap(observed), { command: 'node', arguments: ['--test'] }),
    }),
    (error) => error?.code === 'deployment_preflight_failed'
      && /dependenc/u.test(error.message)
      && /npm ci/u.test(error.message),
  );

  assert.deepEqual(observed, [], 'dependency preflight must precede adapter/driver construction');
  assert.equal(existsSync(root), false, 'failed preflight must not create deployment state/runtime/evidence');
});

test('DP2: an unavailable verification executable refuses during open before deployment or provider effects', async (t) => {
  const repo = repository(t, 'verification');
  const root = deploymentRoot(t, 'verification');
  const observed = [];
  const missing = join(root, 'definitely-missing-verifier');

  await assert.rejects(
    openBaton({
      repo,
      advanced: advanced(root, effectTrap(observed), { command: missing, arguments: [] }),
    }),
    (error) => error?.code === 'deployment_preflight_failed'
      && /verification executable/u.test(error.message)
      && error.message.includes(missing),
  );

  assert.deepEqual(observed, [], 'verification preflight must precede adapter/driver construction');
  assert.equal(existsSync(root), false, 'failed preflight must not create deployment state/runtime/evidence');
});

test('DP3: card and doctor expose authentication-red routes without calling them ready or launching a provider', async (t) => {
  const repo = repository(t, 'auth-red');
  const root = deploymentRoot(t, 'auth-red');
  const adapter = new MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'must not launch', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  let spawnCalls = 0;
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    readiness: {
      state: 'blocked',
      code: 'authentication_required',
      summary: 'The configured subscription is not authenticated.',
    },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: 'openai',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort],
      serviceTier: null, provenance: 'phase78-readiness-fixture', refreshedAt: null,
    },
  });
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return spawn(...args); };

  const deployment = await openBaton({
    repo,
    advanced: advanced(root, adapter, { command: process.execPath, arguments: ['--version'] }),
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  assert.equal(typeof deployment.doctor, 'function', 'deployment exposes the same readiness view directly');
  const doctor = await deployment.doctor();
  const doctorRoute = doctor.routes.find((route) => (
    route.harness === ROUTE.harness && route.model === ROUTE.model && route.effort === ROUTE.effort
  ));
  assert.equal(doctor.ready, false, 'a deployment with no authenticated route is not provider-ready');
  assert.equal(doctor.repository.state, 'ready');
  assert.equal(doctor.verification.state, 'ready');
  assert.equal(doctor.dependencies.state, 'ready');
  assert.equal(doctorRoute?.state, 'blocked');
  assert.equal(doctorRoute?.code, 'authentication_required');

  const cardRoute = deployment.card().readiness?.routes?.find((route) => (
    route.harness === ROUTE.harness && route.model === ROUTE.model && route.effort === ROUTE.effort
  ));
  assert.equal(deployment.card().readiness?.ready, false);
  assert.equal(cardRoute?.state, 'blocked');
  assert.equal(cardRoute?.code, 'authentication_required');
  assert.equal(spawnCalls, 0, 'doctor and card are static readiness reads, not provider probes');
});
