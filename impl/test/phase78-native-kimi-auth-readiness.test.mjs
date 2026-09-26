import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { MockAdapter, openBaton } from '../src/index.mjs';
import { DEFAULT_BUDGET, laneHorizonMs } from '../src/application-deployment.mjs';

const MODULE_URL = pathToFileURL(join(import.meta.dirname, '..', 'src', 'index.mjs')).href;
const ROUTE = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' });

/** #346/#348's horizon is DERIVED from the deployment's own wall envelope (DEFAULT_BUDGET.wallMin)
 * — the battery pins the derivation, never a number of its own. */
const HORIZON_MS = DEFAULT_BUDGET.wallMin * 60_000;

function repository(root) {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'kimi-auth@example.invalid', GIT_COMMITTER_EMAIL: 'kimi-auth@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Kimi auth fixture', GIT_COMMITTER_NAME: 'Kimi auth fixture' });
  writeFileSync(join(repo, 'README.md'), '# native Kimi auth fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return repo;
}

function kimiHome(root, credential) {
  const home = join(root, 'home');
  const kimi = join(home, '.kimi-code');
  for (const relative of ['bin/kimi', 'credentials/kimi-code.json', 'oauth/kimi-code']) {
    mkdirSync(dirname(join(kimi, relative)), { recursive: true });
  }
  writeFileSync(join(kimi, 'config.toml'), '[auth]\nmethod = "oauth"\n');
  writeFileSync(join(kimi, 'device_id'), 'phase78-device\n', { mode: 0o600 });
  writeFileSync(join(kimi, 'oauth', 'kimi-code'), '');
  writeFileSync(join(kimi, 'credentials', 'kimi-code.json'), credential, { mode: 0o600 });
  writeFileSync(join(kimi, 'bin', 'kimi'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    "  printf 'Kimi Code v9.8.7\\n'",
    '  exit 0',
    'fi',
    'printf spawned > "$BATON_KIMI_SPAWN_MARKER"',
    'exit 70',
    '',
  ].join('\n'));
  chmodSync(join(kimi, 'bin', 'kimi'), 0o700);
  return home;
}

function inspectDeployment({ credential, attemptRun = false }) {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase78-kimi-auth-'));
  try {
    const repo = repository(root);
    const home = kimiHome(root, credential);
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
        BATON_KIMI_SPAWN_MARKER: marker,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    });
    return { observed: JSON.parse(output), spawned: existsSync(marker), home };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function credential(expiresAt, { refreshToken = true } = {}) {
  return `${JSON.stringify({
    access_token: 'fixture-access-token-must-never-be-public',
    refresh_token: refreshToken ? 'fixture-refresh-token-must-never-be-public' : '',
    expires_at: expiresAt,
    expires_in: 3600,
    scope: 'fixture',
    token_type: 'Bearer',
  })}\n`;
}

/** #439: the pin below covers the readiness truth the KA1 row names — the route rows and the
 * verdict derived from them. It drops the two sections each doctor/card read samples fresh from
 * the host, both quantized to a deployment reserve granularity: `workspace` (the volume's free
 * bytes and inodes, 64MiB and 10k) and `hostCapacity` (free memory and load, 64MiB and whole
 * cores). A read pair taken while a free count crosses one of those boundaries disagrees on those
 * sections alone; routes, routeUsage, ready and served stay pinned as one shared document. */
function withoutCapacityObservations(readiness) {
  const { workspace: _workspace, hostCapacity: _hostCapacity, ...pinned } = readiness;
  return pinned;
}

test('KA1: an expired native Kimi subscription is auth-red before spawn with an actionable sanitized summary', () => {
  const expiresAt = Math.floor(Date.now() / 1000) - 60;
  const { observed, spawned, home } = inspectDeployment({
    credential: credential(expiresAt),
    attemptRun: true,
  });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'kimi-code');

  assert.equal(observed.doctor.ready, false);
  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'authentication_refresh_required');
  assert.match(route?.summary ?? '', /ordinary `kimi` login flow/u);
  assert.equal(route?.runtime?.authentication?.state, 'expired');
  assert.equal(observed.runError?.code, 'authentication_refresh_required');
  assert.equal(spawned, false, 'an expired route is refused before native Kimi is launched');

  const publicOutput = JSON.stringify(observed);
  assert.equal(publicOutput.includes('fixture-access-token'), false);
  assert.equal(publicOutput.includes('fixture-refresh-token'), false);
  assert.equal(publicOutput.includes(home), false, 'doctor and card do not publish the credential path');
  assert.deepEqual(
    withoutCapacityObservations(observed.readiness), withoutCapacityObservations(observed.doctor),
    'card and doctor share one auth-red truth',
  );
});

test('KA1b: a native Kimi rejected-refresh tombstone is refresh-required, not malformed metadata', () => {
  const { observed, spawned, home } = inspectDeployment({
    credential: `${JSON.stringify({
      access_token: '', refresh_token: '', expires_at: 0, expires_in: 0,
      scope: 'fixture', token_type: 'Bearer',
    })}\n`,
    attemptRun: true,
  });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'kimi-code');

  assert.equal(observed.doctor.ready, false);
  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'authentication_refresh_required');
  assert.equal(route?.runtime?.authentication?.state, 'revoked');
  assert.equal(observed.runError?.code, 'authentication_refresh_required');
  assert.equal(spawned, false, 'a rejected-refresh tombstone is refused before native Kimi launch');
  assert.equal(JSON.stringify(observed).includes(home), false);
});

test('KA1c: near-tombstone metadata with an extra field remains invalid and cannot launch Kimi', () => {
  const { observed, spawned } = inspectDeployment({
    credential: `${JSON.stringify({
      access_token: '', refresh_token: '', expires_at: 0, expires_in: 0,
      scope: 'fixture', token_type: 'Bearer', unexpected: 'must-not-relax-the-wire-shape',
    })}\n`,
    attemptRun: true,
  });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'kimi-code');

  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'authentication_metadata_invalid');
  assert.equal(route?.runtime?.authentication?.state, 'invalid');
  assert.equal(observed.runError?.code, 'authentication_metadata_invalid');
  assert.equal(spawned, false);
  assert.equal(JSON.stringify(observed).includes('must-not-relax-the-wire-shape'), false);
});

test('KA2: malformed native Kimi credential metadata fails closed without provider work or secret/path projection', () => {
  const { observed, spawned, home } = inspectDeployment({
    credential: '{"access_token":"fixture-secret","expires_at":"not-a-timestamp"}\n',
    attemptRun: true,
  });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'kimi-code');

  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'authentication_metadata_invalid');
  assert.equal(route?.runtime?.authentication?.state, 'invalid');
  assert.equal(observed.runError?.code, 'authentication_metadata_invalid');
  assert.equal(spawned, false);
  assert.equal(JSON.stringify(observed).includes('fixture-secret'), false);
  assert.equal(JSON.stringify(observed).includes(home), false);
});

test('KA2b: oversized native Kimi credential metadata is refused by the bounded static reader', () => {
  const oversized = `${JSON.stringify({
    access_token: 'x'.repeat((64 * 1024) + 1),
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
  })}\n`;
  const { observed, spawned } = inspectDeployment({ credential: oversized, attemptRun: true });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'kimi-code');

  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'authentication_metadata_invalid');
  assert.equal(observed.runError?.code, 'authentication_metadata_invalid');
  assert.equal(spawned, false);
});

test('KA3: bounded, owner-readable, unexpired native Kimi metadata preserves static route readiness', () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const { observed, spawned } = inspectDeployment({ credential: credential(expiresAt) });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'kimi-code');

  assert.equal(observed.doctor.ready, true);
  assert.equal(route?.state, 'ready');
  assert.equal(route?.runtime?.authentication?.state, 'available');
  assert.equal(spawned, false, 'static readiness never launches a provider');
});

// ── Issue #348 item 3: the projection rule rides the route, and a seat that cannot outlive the ──
// ── token is refused before any effect ──────────────────────────────────────────────────────────

test('KA5: a ready native Kimi route records the projection rule its credential is materialised with', () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const { observed } = inspectDeployment({ credential: credential(expiresAt) });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'kimi-code');
  const usage = observed.doctor.routeUsage.find((candidate) => candidate.route.harness === 'kimi-code');
  const cardRow = observed.readiness.routes.find((candidate) => candidate.harness === 'kimi-code');

  assert.equal(route?.state, 'ready');
  assert.deepEqual(route?.credential, {
    mechanism: 'file_snapshot',
    ttlSeconds: 3600,
    refreshable: true,
    expiresAt: expiresAt * 1000,
  }, 'the route publishes the mechanism, the token\'s declared lifetime, whether the projected copy can renew it, and the instant it expires');
  assert.deepEqual(cardRow?.credential, route?.credential, 'the route card carries the same rule');
  assert.deepEqual(usage?.credential, route?.credential, 'and so does the usage row a recruit compares');
  assert.equal(JSON.stringify(observed).includes('fixture-access-token'), false);
  assert.equal(JSON.stringify(observed).includes('fixture-refresh-token'), false);
});

test('KA6: a snapshot with no refresh token that expires inside the lane horizon is refused before any effect', () => {
  // The access token is live (readiness admits it) but one hour of declared life cannot cover a
  // lane whose horizon IS the deployment wall envelope (480 min), and a snapshot with no refresh
  // token has nothing to renew it with: the seat would die mid-lane.
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const { observed, spawned } = inspectDeployment({
    credential: credential(expiresAt, { refreshToken: false }),
    attemptRun: true,
  });
  const route = observed.doctor.routes.find((candidate) => candidate.harness === 'kimi-code');

  assert.equal(route?.state, 'blocked');
  assert.equal(route?.code, 'credential_expires_before_horizon');
  assert.equal(route?.credential.refreshable, false, 'the deployment has no refresh path for this snapshot');
  assert.equal(route?.credential.mechanism, 'file_snapshot');
  assert.equal(route?.credentialHorizonMs, HORIZON_MS, 'and the horizon it judged it against');
  assert.equal(laneHorizonMs(), HORIZON_MS, 'the horizon IS the deployment wall envelope');
  assert.match(route?.summary ?? '', /file_snapshot/u, 'the summary names the projection mechanism');
  assert.equal(observed.runError?.code, 'credential_expires_before_horizon',
    'a recruit on the route is refused pre-effect');
  assert.match(observed.runError?.message ?? '', new RegExp(String(HORIZON_MS), 'u'),
    'and the refusal names the horizon');
  assert.equal(spawned, false, 'the refusal precedes every provider effect');
});

test('KA4: a provider Authentication required spawn refusal projects one typed remediable Run cause', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase78-kimi-provider-auth-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const repo = repository(root);
  const adapter = new MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'must not run', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    version: 'Kimi Code v9.8.7',
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: 'kimi',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort],
      serviceTier: null, provenance: 'phase78-kimi-auth-fixture', refreshedAt: null,
    },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'provider', mechanisms: ['fixture-yolo'],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: ['fixture-host'],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  adapter.spawn = async () => ({ ok: false, code: 'authentication_required', rpcCode: -32000, reason: 'Authentication required' });

  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: join(root, 'deployment'),
      adapters: { 'kimi-code': adapter },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--version'] },
      capacity: {
        estimate: () => ({ bytes: 1, inodes: 1 }),
        observe: () => ({
          freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER,
        }),
      },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  const run = await deployment.run('Exercise sanitized provider authentication failure.', { exact: ROUTE });
  const view = await run.complete();
  assert.equal(view.terminal, true);
  assert.equal(view.outline?.phase, 'failed');
  assert.deepEqual(view.outline?.terminalCause, {
    kind: 'provider_failure', code: 'authentication_required', category: 'provider_authentication',
    summary: 'The selected provider route requires authentication.',
    remediation: 'Establish or refresh the harness-native login outside Baton, rerun baton doctor, then retry the Run.',
    retryable: true,
  });
  assert.match(view.outline?.narrative ?? '', /authentication_required/u);
});
