import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const MODULE_URL = pathToFileURL(join(import.meta.dirname, '..', 'src', 'index.mjs')).href;
const ROUTE = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' });

function repository(root) {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'grok-auth@example.invalid', GIT_COMMITTER_EMAIL: 'grok-auth@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Grok auth fixture', GIT_COMMITTER_NAME: 'Grok auth fixture' });
  writeFileSync(join(repo, 'README.md'), '# Grok auth fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return repo;
}

function grokHome(root, credential) {
  const home = join(root, 'home');
  const executable = join(home, '.grok', 'bin', 'grok');
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(join(home, '.grok', 'auth.json'), credential, { mode: 0o600 });
  writeFileSync(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    "  printf 'grok 9.8.7 (fixture) [stable]\\n'",
    '  exit 0',
    'fi',
    'printf spawned > "$BATON_GROK_SPAWN_MARKER"',
    'exit 70',
    '',
  ].join('\n'));
  chmodSync(executable, 0o700);
  return home;
}

function inspectDeployment({ credential, attemptRun = false }) {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase78-grok-auth-'));
  try {
    const repo = repository(root);
    const home = grokHome(root, credential);
    const marker = join(root, 'provider-spawned');
    const deploymentRoot = join(root, 'deployment');
    const script = [
      `const { openBaton } = await import(${JSON.stringify(MODULE_URL)});`,
      `const route = ${JSON.stringify(ROUTE)};`,
      `const deployment = await openBaton({ repo: ${JSON.stringify(repo)}, advanced: {`,
      `  deploymentRoot: ${JSON.stringify(deploymentRoot)},`,
      '  verification: { command: process.execPath, arguments: ["--version"] },',
      '} });',
      'let runError = null;',
      attemptRun
        ? 'try { await deployment.run("must be refused before provider spawn", { exact: route }); } catch (error) { runError = { code: error?.code, message: error?.message }; }'
        : '',
      'const doctor = await deployment.doctor();',
      'const card = deployment.card();',
      'await deployment.close();',
      'process.stdout.write(JSON.stringify({ doctor, readiness: card.readiness, runError }));',
    ].join('\n');
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        PATH: `${join(home, '.grok', 'bin')}:${process.env.PATH ?? ''}`,
        BATON_GROK_SPAWN_MARKER: marker,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    });
    return { observed: JSON.parse(output), spawned: existsSync(marker), home };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function credential(expiresAt, { refreshable = true } = {}) {
  return `${JSON.stringify({
    'https://auth.x.ai::fixture-team': {
      auth_mode: 'oidc',
      key: 'fixture-access-token-must-never-be-public',
      ...(refreshable ? { refresh_token: 'fixture-refresh-token-must-never-be-public' } : {}),
      expires_at: expiresAt,
    },
  })}\n`;
}

/** #439: the pin below covers the readiness truth the GR1 row names — the route rows and the
 * verdict derived from them. It drops the two sections each doctor/card read samples fresh from
 * the host, both quantized to a deployment reserve granularity: `workspace` (the volume's free
 * bytes and inodes, 64MiB and 10k) and `hostCapacity` (free memory and load, 64MiB and whole
 * cores). A read pair taken while a free count crosses one of those boundaries disagrees on those
 * sections alone; routes, routeUsage, ready and served stay pinned as one shared document. */
function withoutCapacityObservations(readiness) {
  const { workspace: _workspace, hostCapacity: _hostCapacity, ...pinned } = readiness;
  return pinned;
}

test('GR1: expired Grok auth is auth-red before spawn with sanitized login guidance', () => {
  const expired = new Date(Date.now() - 60_000).toISOString();
  const { observed, spawned, home } = inspectDeployment({
    credential: credential(expired, { refreshable: false }),
    attemptRun: true,
  });
  const routes = observed.doctor.routes.filter((candidate) => candidate.harness === 'grok');

  assert.equal(observed.doctor.ready, false);
  assert.ok(routes.length > 0, 'grok routes are present');
  for (const route of routes) {
    assert.equal(route.state, 'blocked');
    assert.equal(route.code, 'authentication_refresh_required');
    assert.match(route.summary, /ordinary `grok login` flow/u);
    assert.equal(route.runtime.authentication.state, 'expired');
  }
  assert.equal(observed.runError?.code, 'authentication_refresh_required');
  assert.equal(spawned, false, 'an expired route is refused before Grok ACP is launched');

  const publicOutput = JSON.stringify(observed);
  assert.equal(publicOutput.includes('fixture-access-token'), false);
  assert.equal(publicOutput.includes('fixture-refresh-token'), false);
  assert.equal(publicOutput.includes(home), false, 'doctor and card do not publish credential paths');
  assert.deepEqual(
    withoutCapacityObservations(observed.readiness), withoutCapacityObservations(observed.doctor),
    'card and doctor share one auth-red truth',
  );
});

test('GR2: near-expiry Grok auth matches the CLI early-invalidation window', () => {
  const nearExpiry = new Date(Date.now() + (4 * 60 * 1000)).toISOString();
  const { observed, spawned } = inspectDeployment({
    credential: credential(nearExpiry, { refreshable: false }),
    attemptRun: true,
  });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'grok');

  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'authentication_refresh_required');
  assert.equal(route?.runtime?.authentication?.state, 'expired');
  assert.equal(spawned, false);
});

test('GR3: malformed or ambiguous Grok credential metadata fails closed', () => {
  const future = new Date(Date.now() + (60 * 60 * 1000)).toISOString();
  const ambiguous = JSON.stringify({
    'https://auth.x.ai::team-a': { key: 'secret-a', expires_at: future },
    'https://auth.x.ai::team-b': { key: 'secret-b', expires_at: future },
  });
  const { observed, spawned, home } = inspectDeployment({ credential: ambiguous, attemptRun: true });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'grok');

  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'authentication_metadata_invalid');
  assert.equal(route?.runtime?.authentication?.state, 'invalid');
  assert.equal(observed.runError?.code, 'authentication_metadata_invalid');
  assert.equal(spawned, false);
  assert.equal(JSON.stringify(observed).includes('secret-a'), false);
  assert.equal(JSON.stringify(observed).includes(home), false);
});

test('GR4: bounded, owner-readable, unexpired Grok metadata preserves static readiness', () => {
  const future = new Date(Date.now() + (60 * 60 * 1000)).toISOString();
  const { observed, spawned } = inspectDeployment({ credential: credential(future) });
  const routes = observed.doctor.routes.filter((candidate) => candidate.harness === 'grok');

  assert.equal(observed.doctor.ready, true);
  assert.ok(routes.length > 0, 'grok routes are present');
  for (const route of routes) {
    assert.equal(route.state, 'ready');
    assert.equal(route.runtime.authentication.state, 'available');
  }
  assert.equal(spawned, false, 'static readiness never launches the provider');
});

test('GR5: oversized Grok auth metadata is refused by the bounded static reader', () => {
  const oversized = `${JSON.stringify({
    'https://auth.x.ai::fixture-team': {
      key: 'x'.repeat((64 * 1024) + 1),
      expires_at: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
    },
  })}\n`;
  const { observed, spawned } = inspectDeployment({ credential: oversized, attemptRun: true });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'grok');

  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'authentication_metadata_invalid');
  assert.equal(spawned, false);
});

test('P92-GR6: an expired access token with a bounded refresh token remains statically refreshable', () => {
  const expired = new Date(Date.now() - 60_000).toISOString();
  const { observed, spawned, home } = inspectDeployment({ credential: credential(expired) });
  const routes = observed.doctor.routes.filter((candidate) => candidate.harness === 'grok');

  assert.ok(routes.length > 0, 'grok routes are present');
  for (const route of routes) {
    assert.equal(route.state, 'ready');
    assert.equal(route.runtime.authentication.state, 'refreshable');
  }
  assert.equal(spawned, false, 'readiness does not spend the refresh token or launch Grok');
  assert.equal(JSON.stringify(observed).includes('fixture-refresh-token'), false);
  assert.equal(JSON.stringify(observed).includes(home), false);
});
