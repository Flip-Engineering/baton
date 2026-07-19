import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync,
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

  await assert.rejects(
    deployment.run('This must be rejected before provider spawn.', { exact: ROUTE }),
    (error) => error?.code === 'authentication_required'
      && /not authenticated/u.test(error.message),
  );
  assert.equal(spawnCalls, 0, 'doctor and card are static readiness reads, not provider probes');
});

test('DP3b: adapter authentication is probed only inside the projected private worker runtime', async (t) => {
  const repo = repository(t, 'projected-auth-red');
  const root = deploymentRoot(t, 'projected-auth-red');
  const route = { harness: 'claude-code', model: 'claude-opus-4-6', effort: 'xhigh' };
  const spawnCalls = { count: 0 };
  const adapter = routedAdapter(route, { version: 'Claude Code v9.8.7', spawnCalls });
  const probes = [];
  adapter.authenticationReadiness = ({ env }) => {
    probes.push({
      home: env.HOME, config: env.CLAUDE_CONFIG_DIR,
      anthropicKeyPresent: env.ANTHROPIC_API_KEY !== undefined,
    });
    return {
      state: 'blocked', code: 'authentication_refresh_required',
      credentialState: 'refresh_required', summary: 'must be replaced by deployment summary',
    };
  };

  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: root, adapters: { 'claude-code:claude': adapter }, routes: [route],
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  assert.equal(probes.length, 1);
  const resolvedRoot = realpathSync(root);
  assert.equal(probes[0].home.startsWith(resolvedRoot), true);
  assert.equal(probes[0].config.startsWith(resolvedRoot), true);
  assert.equal(probes[0].anthropicKeyPresent, false,
    'ambient provider secrets must not enter readiness or worker environments');
  const routeReadiness = (await deployment.doctor()).routes[0];
  assert.equal(routeReadiness.state, 'blocked');
  assert.equal(routeReadiness.code, 'authentication_refresh_required');
  assert.equal(routeReadiness.runtime.authentication.state, 'refresh_required');
  assert.equal(JSON.stringify(routeReadiness).includes('must be replaced'), false);
  await assert.rejects(
    deployment.run('must remain pre-provider', { exact: route }),
    (error) => error?.code === 'authentication_refresh_required',
  );
  assert.equal(spawnCalls.count, 0);
});

function routedAdapter(route, { version, credentialState = 'available', spawnCalls }) {
  const adapter = new MockAdapter({
    harness: route.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'must not launch', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    version,
    authPosture: route.harness === 'glm' ? 'api_key' : 'subscription',
    providerCompatibility: { credentialState },
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness === 'claude-code' ? 'claude' : route.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [route.effort],
      serviceTier: null, provenance: 'phase78-route-truth-fixture', refreshedAt: null,
    },
    isolation: {
      filesystem: 'unverified', osSandbox: 'unverified', network: 'uncontrolled',
      configHome: 'driver-scoped', environment: 'driver-scoped', credentialProjection: 'explicit',
    },
    permissions: {
      mode: 'unattended-full',
      boundary: 'boundary-canary /private/credential-do-not-project',
    },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { default: 'unattended' },
      access: { default: 'full' },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable',
      },
    },
  });
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls.count += 1; return spawn(...args); };
  return adapter;
}

test('DP4: credential-present Grok, Claude, GLM, and native Kimi stay blocked when executable compatibility is unobserved', async (t) => {
  const repo = repository(t, 'harness-unavailable');
  const root = deploymentRoot(t, 'harness-unavailable');
  const routes = [
    { harness: 'grok', model: 'grok-4.5', effort: 'high' },
    { harness: 'claude-code', model: 'claude-opus-4-6', effort: 'high' },
    { harness: 'glm', model: 'glm-5.2', effort: 'xhigh' },
    { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' },
  ];
  const spawnCalls = { count: 0 };
  const adapters = Object.fromEntries(routes.map((route) => [
    route.harness,
    routedAdapter(route, {
      version: 'unrecognized-probe-output boundary-canary /private/credential-do-not-project',
      spawnCalls,
    }),
  ]));
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: root, adapters, routes,
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  const doctor = await deployment.doctor();
  assert.equal(doctor.ready, false);
  assert.equal(doctor.routes.length, routes.length);
  for (const route of doctor.routes) {
    assert.equal(route.state, 'blocked');
    assert.equal(route.code, 'harness_unavailable');
    assert.deepEqual(route.runtime.version, { state: 'unknown', value: 'unknown' });
    assert.equal(route.runtime.authentication.state, 'available');
    assert.equal(route.runtime.permissions.mode, 'unattended-full');
    assert.equal(route.runtime.permissions.sandbox, 'unobserved');
    assert.equal(route.runtime.containment.filesystem, 'unverified');
    assert.equal(route.runtime.containment.hostProcess, 'same_uid');
    assert.deepEqual(route.runtime.containment.guarantees, ['private_runtime']);
  }
  const publicJson = JSON.stringify(deployment.card().readiness);
  assert.equal(publicJson.includes('boundary-canary'), false, 'adapter prose is not a route-summary field');
  assert.equal(publicJson.includes('/private/credential-do-not-project'), false, 'paths do not enter route summaries');

  await assert.rejects(
    deployment.run('must stay pre-provider', { exact: routes[0] }),
    (error) => error?.code === 'harness_unavailable',
  );
  assert.equal(spawnCalls.count, 0);
});

test('DP5: an observed route publishes bounded permission, containment, authentication, and version truth', async (t) => {
  const repo = repository(t, 'route-truth');
  const root = deploymentRoot(t, 'route-truth');
  const route = { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' };
  const spawnCalls = { count: 0 };
  const adapter = routedAdapter(route, {
    version: 'Kimi Code v9.8.7+fixture', spawnCalls,
  });
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: root, adapters: { 'kimi-code': adapter }, routes: [route],
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  const doctor = await deployment.doctor();
  assert.equal(doctor.ready, true);
  assert.deepEqual(doctor.routes[0], {
    ...route,
    state: 'ready',
    summary: 'The exact route passed static deployment readiness.',
    runtime: {
      version: { state: 'observed', value: '9.8.7+fixture' },
      authentication: { posture: 'subscription', state: 'available' },
      permissions: {
        mode: 'unattended-full', sandbox: 'unobserved', autonomy: 'unattended', access: 'full',
      },
      containment: {
        filesystem: 'unverified', osSandbox: 'unverified', network: 'uncontrolled',
        hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable',
      },
    },
  });
  assert.equal(spawnCalls.count, 0, 'doctor is a static probe projection, not provider work');
});
