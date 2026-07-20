import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MockAdapter, RouteReadinessAuthority, formatRouteSelector, openBaton, parseBatonCli,
} from '../src/index.mjs';

const KIMI = Object.freeze({
  harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max',
});

function binding(overrides = {}) {
  return {
    harness: 'kimi-code', version: '0.27.0', model: 'kimi-code/k3', effort: 'max',
    serviceTier: null, taskType: 'general', workerPolicy: null,
    card: {
      harness: 'kimi-code', version: '0.27.0',
      modelSelection: { family: 'kimi-code' },
    },
    ...overrides,
  };
}

test('P94-RA1: private readiness leases are exact, short-lived, single-use, and fail closed on mutation', async () => {
  let now = 1_000;
  let epoch = 'credential-epoch-a';
  let state = { state: 'ready', summary: 'Exact route is ready.' };
  const authority = new RouteReadinessAuthority({
    routes: [KIMI], now: () => now, leaseTtlMs: 50,
    credentialEpoch: () => epoch,
    assess: async () => state,
  });

  const lease = await authority.lease(binding());
  assert.equal(Object.hasOwn(lease, 'credentialEpoch'), false, 'credential epochs stay opaque');
  assert.equal(authority.consume(lease, binding()).state, 'admitted');
  assert.throws(() => authority.consume(lease, binding()), { code: 'route_readiness_lease_spent' });

  const expired = await authority.lease(binding());
  now += 51;
  assert.throws(() => authority.consume(expired, binding()), { code: 'route_readiness_lease_expired' });

  const mutated = await authority.lease(binding());
  assert.throws(
    () => authority.consume(mutated, binding({ effort: 'high' })),
    { code: 'route_readiness_binding_mismatch' },
  );

  const credentialChanged = await authority.lease(binding());
  epoch = 'credential-epoch-b';
  assert.throws(
    () => authority.consume(credentialChanged, binding()),
    { code: 'route_readiness_credential_epoch_mismatch' },
  );

  authority.invalidate(KIMI, 'authentication_refresh_required');
  state = { state: 'ready', summary: 'stale probe must not override invalidation' };
  await assert.rejects(authority.lease(binding()), { code: 'authentication_refresh_required' });
});

test('P94-SEL1: preferred native-Kimi selector is canonical and verbose legacy spelling remains exact', () => {
  assert.equal(formatRouteSelector(KIMI), 'kimi-code/k3@max');
  assert.deepEqual(parseBatonCli(['route', 'kimi-code/k3@max']).exact, KIMI);
  assert.deepEqual(parseBatonCli(['route', 'kimi-code/kimi-code/k3@max']).exact, KIMI);
  assert.throws(() => parseBatonCli(['route', 'kimi/k3@maximum']), /exact|configured|invalid/iu);
});

function repository(t) {
  const repo = mkdtempSync(join(tmpdir(), 'baton-phase94-waiting-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase94@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 94'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# route waiting fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return repo;
}

test('P94-WAIT1: approved auth-red native Kimi waits with zero spawn and zero ownership, then retries once', async (t) => {
  const repo = repository(t);
  const adapter = new MockAdapter({
    harness: 'kimi-code',
    scenario: { outcome: 'blocked', blocker: 'hold', delayMs: 60_000 },
  });
  const baseCard = adapter.card.bind(adapter);
  let blocked = true;
  let spawnCalls = 0;
  adapter.card = () => ({
    ...baseCard(), version: 'Kimi Code v0.27.0', authPosture: 'subscription',
    readiness: blocked ? {
      state: 'blocked', code: 'authentication_refresh_required',
      summary: 'Refresh Kimi authentication with the ordinary `kimi` login flow, then retry this route.',
    } : { state: 'ready' },
    providerCompatibility: { credentialState: blocked ? 'revoked' : 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: KIMI.model, available: [KIMI.model],
      family: 'kimi-code', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [KIMI.effort], serviceTier: null,
      provenance: 'phase94-test', refreshedAt: null,
    },
  });
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return spawn(...args); };

  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: join(repo, '.phase94-deployment'), adapters: { 'kimi-code': adapter },
      routes: [KIMI], verification: { command: process.execPath, arguments: ['--version'] },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  const run = await deployment.explore('Prove route waiting does not allocate.', { exact: KIMI });
  await run.approve();
  const waiting = await run.outline();
  assert.equal(waiting.outline.phase, 'waiting_for_route');
  assert.equal(waiting.outline.dispatch.state, 'waiting_for_route');
  assert.equal(waiting.outline.ownership.workers, 0);
  assert.equal(waiting.outline.cleanup.state, 'reaped');
  assert.equal(spawnCalls, 0, 'revoked native Kimi metadata cannot launch the provider');
  assert.ok(waiting.outline.actions.some((action) => action.kind === 'retry_route'));
  assert.equal(JSON.stringify(waiting).includes('.phase94-deployment'), false);

  blocked = false;
  await run.retryRoute();
  await run.retryRoute();
  assert.equal(spawnCalls, 1, 'idempotent route retry dispatches the approved route at most once');
});
