import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';

// #295 item 4: route readiness reflects an exhausted quota until the reset instant the provider
// itself recorded. A recruit on that route is refused BEFORE any effect (no spawn, no worktree, no
// provider call), the refusal names the reset time, the doctor row reads blocked with that instant,
// and readiness RETURNS when the recorded instant passes — derived from the recorded time, never
// from a polling constant.

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });

function repository(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-quota-readiness-${name}-`));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'quota-readiness@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Quota readiness'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# quota readiness fixture\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function deploymentRoot(t, name) {
  const owner = mkdtempSync(join(tmpdir(), `baton-quota-readiness-${name}-owner-`));
  t.after(() => rmSync(owner, { force: true, recursive: true }));
  return join(owner, 'deployment');
}

async function openDeployment(t, name, adapter) {
  const repo = repository(t, name);
  const root = deploymentRoot(t, name);
  mkdirSync(join(root, '..'), { recursive: true });
  let driverOptions = null;
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters: { codex: adapter },
      routes: [ROUTE],
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  }, (options) => {
    driverOptions = options;
    return createDriver(options);
  });
  t.after(async () => { try { await deployment.close(); } catch { /* closed below */ } });
  return { deployment, driverOptions };
}

function routeRow(readiness) {
  return readiness.routes.find((row) => row.harness === ROUTE.harness && row.model === ROUTE.model);
}

test('QR1: an exhausted route is refused before any effect, reads blocked until its reset, and recovers when it passes', async (t) => {
  const adapter = new MockAdapter({
    harness: 'codex',
    scenario: { outcome: 'completed', delayMs: 1, summary: 'must not launch', files: {} },
  });
  // The deployment admits an exact route only when a matching card advertises it, so the double
  // advertises the route it stands in for — the same shape the readiness pins use.
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: ROUTE.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'quota-readiness-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: [] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: [] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });
  let spawns = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawns += 1; return spawn(...args); };

  const { deployment, driverOptions } = await openDeployment(t, 'quota', adapter);
  const quota = driverOptions.routeQuotaAuthority;
  assert.ok(quota, 'the deployment hands its coordinator the exhausted-route authority');

  // A reset instant already in the past is not a block at all: nothing to refuse.
  quota.record(ROUTE, { resetAt: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(quota.blockFor(ROUTE), null, 'an expired instant never blocks a route');
  assert.equal(routeRow(await deployment.doctor()).state, 'ready');

  // A live block refuses the recruit BEFORE any effect and names the reset time.
  const resetAt = new Date(Date.now() + 60_000).toISOString();
  const blockedSince = Date.now();
  quota.record(ROUTE, { resetAt, at: blockedSince });
  await assert.rejects(
    deployment.run('do the work', { exact: ROUTE }),
    (error) => error?.code === 'provider_quota_exhausted'
      && error?.resetAt === resetAt
      && error.message.includes(resetAt),
  );
  assert.equal(spawns, 0, 'the refusal precedes every adapter effect');
  assert.deepEqual(supportedRouteExact(await deployment.doctor()), {
    state: 'blocked', code: 'provider_quota_exhausted', resetAt,
  });
  // The row also names WHEN the block was observed — derived from the recorded instant, so a
  // reader never sees a field that reads as a time and is always absent.
  assert.equal(routeRow(await deployment.doctor()).quotaBlockedSince,
    new Date(blockedSince).toISOString());
  assert.equal((await deployment.doctor()).ready, false,
    'a fleet whose only route is exhausted is not ready');

  // Readiness returns when the recorded instant passes — derived, never polled.
  quota.record(ROUTE, { resetAt: new Date(Date.now() + 80).toISOString(), at: Date.now() + 1 });
  assert.equal(routeRow(await deployment.doctor()).state, 'blocked');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(routeRow(await deployment.doctor()).state, 'ready',
    'the block lapsed because its recorded instant is in the past');
  assert.equal((await deployment.doctor()).ready, true);
  assert.equal(spawns, 0);
});

function supportedRouteExact(readiness) {
  const row = routeRow(readiness);
  return { state: row.state, code: row.code, resetAt: row.resetAt };
}
