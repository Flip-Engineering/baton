import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
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
  execFileSync('git', ['config', 'user.email', 'grok-auth@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Grok auth fixture'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# Grok auth fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return repo;
}

function grokHome(root, credential, marker) {
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
    'if [ "$1" = "models" ]; then',
    `  printf models > ${JSON.stringify(marker)}`,
    "  printf 'grok-4.5\\n'",
    '  exit 0',
    'fi',
    `printf spawned > ${JSON.stringify(marker)}`,
    'exit 70',
    '',
  ].join('\n'));
  chmodSync(executable, 0o700);
  return home;
}

function inspectDeployment({ credential, attemptRun = false }) {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase78-grok-auth-'));
  try {
    const marker = join(root, 'provider-spawned');
    const repo = repository(root);
    const home = grokHome(root, credential, marker);
    const deploymentRoot = join(root, 'deployment');
    const script = [
      `const { openBaton } = await import(${JSON.stringify(MODULE_URL)});`,
      `const route = ${JSON.stringify(ROUTE)};`,
      `const deployment = await openBaton({ repo: ${JSON.stringify(repo)}, advanced: {`,
      `  deploymentRoot: ${JSON.stringify(deploymentRoot)},`,
      '  verification: { command: "node", arguments: ["--version"] },',
      '} });',
      'let runError = null;',
      attemptRun
        ? 'try { const run = await deployment.run("must wait before provider spawn", { exact: route }); await run.approve(); const view = await run.status(); const blocker = view.attention?.find((item) => item.kind === "route_readiness"); runError = blocker ? { code: blocker.blocker.code, message: blocker.blocker.summary } : null; } catch (error) { runError = { code: error?.code, message: error?.message }; }'
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
    return {
      observed: JSON.parse(output), spawned: existsSync(marker),
      diagnostic: existsSync(marker) ? readFileSync(marker, 'utf8') : null, home,
    };
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

test('GR1: expired Grok auth is auth-red before spawn with sanitized login guidance', () => {
  const expired = new Date(Date.now() - 60_000).toISOString();
  const { observed, spawned, home } = inspectDeployment({
    credential: credential(expired, { refreshable: false }),
    attemptRun: true,
  });
  const routes = observed.doctor.routes.filter((candidate) => candidate.harness === 'grok');

  assert.equal(observed.doctor.ready, false);
  assert.equal(routes.length, 3);
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
  assert.deepEqual(observed.readiness, observed.doctor);
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

test('GR4: unexpired Grok metadata is delivered only after the private session-free models probe', () => {
  const future = new Date(Date.now() + (60 * 60 * 1000)).toISOString();
  const { observed, spawned, diagnostic } = inspectDeployment({ credential: credential(future) });
  const routes = observed.doctor.routes.filter((candidate) => candidate.harness === 'grok');

  assert.equal(observed.doctor.ready, true);
  assert.equal(routes.length, 3);
  for (const route of routes) {
    assert.equal(route.state, 'ready');
    assert.equal(route.runtime.authentication.state, 'available');
  }
  assert.equal(spawned, true);
  assert.equal(diagnostic, 'models', 'doctor uses grok models, never agent/session/prompt');
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

test('P92-GR6: refreshable metadata becomes ready only when the projected live models probe succeeds', () => {
  const expired = new Date(Date.now() - 60_000).toISOString();
  const { observed, spawned, diagnostic, home } = inspectDeployment({ credential: credential(expired) });
  const routes = observed.doctor.routes.filter((candidate) => candidate.harness === 'grok');

  assert.equal(routes.length, 3);
  for (const route of routes) {
    assert.equal(route.state, 'ready');
    assert.equal(route.runtime.authentication.state, 'refreshable');
  }
  assert.equal(spawned, true);
  assert.equal(diagnostic, 'models');
  assert.equal(JSON.stringify(observed).includes('fixture-refresh-token'), false);
  assert.equal(JSON.stringify(observed).includes(home), false);
});
