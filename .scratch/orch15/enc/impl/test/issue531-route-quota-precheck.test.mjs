// issue531-route-quota-precheck.test.mjs — Issue #531: recruits to routes marked exhausted or
// blocked refuse immediately before host-capacity queue entry.
//
// The observed gap: a recruit to a route whose quota is exhausted enters hostCapacity.acquire and
// waits up to 120s, then fails. The route's ineligibility is knowable before the queue — the same
// usage rows the route comparison reads say `quota.state: 'exhausted'` — so the recruit should
// refuse typed (`route_exhausted`) at the same pre-effect point the `route_degraded` refusal does.
//
// Rows:
//   EXHAUST-531-A   a recruit to an exhausted route refuses immediately (no hostCapacity wait)
//   EXHAUST-531-B   a recruit to a prefix where ALL routes are exhausted refuses immediately
//   EXHAUST-531-C   a prefix where ONE route is ready admits (the exhaust check passes through)
//   EXHAUST-531-D   a recruit to a blocked route refuses immediately (no hostCapacity wait)
//   EXHAUST-531-E   the refusal names the route, reason, code, and ready alternatives
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, no network, no provider process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { PROVIDER_FAULT_CODES } from '../src/provider-faults.mjs';

const QUOTA_CODE = PROVIDER_FAULT_CODES.quota;
const AUTH_CODE = 'provider_auth_expired';

const ROUTE_A = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const ROUTE_B = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });
const ROUTE_C = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const RESET_AT = new Date(Math.floor(Date.now() / 1000) * 1000 + 6 * 60 * 60 * 1000).toISOString();

function usageRow(route, {
  state = 'ready', code = null, resetAt = null, turns = 0,
  ceiling = null, inUse = 0, quotaState = 'ok', quotaResetAt = null,
} = {}) {
  return Object.freeze({
    route: Object.freeze({ ...route }),
    state, code, resetAt,
    usage: Object.freeze({ turns, tokens: 0, usd: 0 }),
    concurrency: Object.freeze({ ceiling, inUse }),
    lastProviderRefusal: null,
    quota: Object.freeze({ state: quotaState, resetAt: quotaResetAt }),
  });
}

async function refusalOf(promise) {
  try { await promise; } catch (error) { return error; }
  assert.fail('expected a typed refusal');
}

// ── the swarm fixture: the real runtime over a real store, with the deployment's rows injected ──

function swarmFixture(t, rows, { hostCapacity = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-exhaust-531-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = { list: () => workers, pausedTurns: () => [] };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, hostCapacity,
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: rows }),
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async (request) => {
      if (!workers.some((row) => row.runId === request.runId)) {
        workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
          runId: request.runId, status: 'working', paused: false });
      }
    },
    stopRun: async (runId) => {
      const row = workers.find((candidate) => candidate.runId === runId);
      if (row) row.status = 'dead';
      return { state: 'closed' };
    },
  });
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  let key = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(command === 'view' ? {} : { idempotencyKey: `request-${++key}` }), ...args }, owner);
  return { call, runtime, workers };
}

// ── EXHAUST-531-A: an exact recruit to an exhausted route refuses immediately ─────────────────

test('EXHAUST-531-A: an exact recruit to a quota-exhausted route refuses immediately with route_exhausted', async (t) => {
  const rows = [
    usageRow(ROUTE_A, { state: 'blocked', code: QUOTA_CODE, resetAt: RESET_AT,
      quotaState: 'exhausted', quotaResetAt: RESET_AT }),
  ];
  // Wire a hostCapacity that would block for a long time — the test asserts the refuse happens
  // WITHOUT entering this acquire.
  let acquireCalled = false;
  const hostCapacity = {
    acquire: async () => { acquireCalled = true; return { token: 'lease-1' }; },
  };
  const f = swarmFixture(t, rows, { hostCapacity });
  await f.call('create', { purpose: 'exhaust precheck' });

  const err = await refusalOf(
    f.call('recruit', { participantId: 'seat-a', objective: 'work', options: { exact: ROUTE_A } }),
  );
  assert.equal(err.code, 'route_exhausted', 'the refusal code is route_exhausted');
  assert.equal(err.detail.reason, 'quota_exhausted', 'the reason names quota exhaustion');
  assert.deepEqual(err.detail.route, ROUTE_A, 'the refusal names the route');
  assert.equal(err.detail.resetAt, RESET_AT, 'the refusal carries the reset instant');
  assert.equal(acquireCalled, false, 'hostCapacity.acquire was never called');
});

// ── EXHAUST-531-B: a prefix where ALL routes are exhausted refuses immediately ────────────────

test('EXHAUST-531-B: a prefix recruit where every matching route is exhausted refuses immediately', async (t) => {
  const rows = [
    usageRow(ROUTE_A, { state: 'blocked', code: QUOTA_CODE, resetAt: RESET_AT,
      quotaState: 'exhausted', quotaResetAt: RESET_AT }),
    usageRow(ROUTE_B, { state: 'blocked', code: QUOTA_CODE,
      quotaState: 'exhausted' }),
  ];
  let acquireCalled = false;
  const hostCapacity = {
    acquire: async () => { acquireCalled = true; return { token: 'lease-1' }; },
  };
  const f = swarmFixture(t, rows, { hostCapacity });
  await f.call('create', { purpose: 'exhaust precheck prefix' });

  const err = await refusalOf(
    f.call('recruit', { participantId: 'seat-b', objective: 'work', options: { harness: 'codex' } }),
  );
  assert.equal(err.code, 'route_exhausted');
  assert.ok(err.detail.considered.length >= 2, 'the refusal names every considered route');
  assert.equal(acquireCalled, false, 'hostCapacity.acquire was never called');
});

// ── EXHAUST-531-C: a prefix where ONE route is ready admits normally ──────────────────────────

test('EXHAUST-531-C: a prefix recruit where one route is ready admits normally (the exhaust check passes)', async (t) => {
  const rows = [
    usageRow(ROUTE_A, { state: 'blocked', code: QUOTA_CODE, resetAt: RESET_AT,
      quotaState: 'exhausted', quotaResetAt: RESET_AT }),
    usageRow(ROUTE_B), // ready
  ];
  const f = swarmFixture(t, rows);
  await f.call('create', { purpose: 'one ready route' });

  const recruited = await f.call('recruit', {
    participantId: 'seat-c', objective: 'work', options: { harness: 'codex' },
  });
  assert.equal(recruited.admission.state, 'admitted', 'the recruit admits on the ready route');
});

// ── EXHAUST-531-D: a recruit to a blocked route refuses immediately ───────────────────────────

test('EXHAUST-531-D: an exact recruit to a blocked (non-quota) route refuses immediately', async (t) => {
  const rows = [
    usageRow(ROUTE_A, { state: 'blocked', code: AUTH_CODE }),
  ];
  let acquireCalled = false;
  const hostCapacity = {
    acquire: async () => { acquireCalled = true; return { token: 'lease-1' }; },
  };
  const f = swarmFixture(t, rows, { hostCapacity });
  await f.call('create', { purpose: 'blocked precheck' });

  const err = await refusalOf(
    f.call('recruit', { participantId: 'seat-d', objective: 'work', options: { exact: ROUTE_A } }),
  );
  assert.equal(err.code, 'route_exhausted');
  assert.equal(err.detail.reason, 'blocked', 'the reason names the blocked state');
  assert.equal(err.detail.code, AUTH_CODE, 'the refusal carries the block code');
  assert.equal(acquireCalled, false, 'hostCapacity.acquire was never called');
});

// ── EXHAUST-531-E: the refusal names ready alternatives ───────────────────────────────────────

test('EXHAUST-531-E: the route_exhausted refusal names the routes that are ready now', async (t) => {
  const OTHER = Object.freeze({ harness: 'kimi', model: 'k2', effort: 'high' });
  const rows = [
    usageRow(ROUTE_A, { state: 'blocked', code: QUOTA_CODE, resetAt: RESET_AT,
      quotaState: 'exhausted', quotaResetAt: RESET_AT }),
    usageRow(OTHER), // ready, different harness
  ];
  const f = swarmFixture(t, rows);
  await f.call('create', { purpose: 'ready alternatives' });

  const err = await refusalOf(
    f.call('recruit', { participantId: 'seat-e', objective: 'work', options: { exact: ROUTE_A } }),
  );
  assert.equal(err.code, 'route_exhausted');
  assert.ok(Array.isArray(err.detail.ready), 'the refusal carries a ready array');
  assert.ok(err.detail.ready.length > 0, 'the ready array names the route that is ready');
  assert.ok(err.detail.ready.some((label) => label.includes('kimi')),
    'the ready array includes the kimi route');
  assert.match(err.message, /routes ready now/u, 'the message text names ready alternatives');
});
