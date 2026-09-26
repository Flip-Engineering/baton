// issue591-static-block-recruit-precheck.test.mjs — Issue #591: a route the doctor blocks for a
// non-provider reason (a credential, the harness, the route policy) reads `ready` in the swarm
// side's route rows, and every swarm-side reader lies with it: the recruit refusal's ready list
// names it, the brief's route table marks it recruitable, and a recruit onto it is admitted — a
// seat that can never start.
//
// Observed 2026-09-25/26 on this deployment: recruit refusals listed `codex/gpt-6-astra` under
// "routes ready now" while the route was in fact unusable. The usage row's `state` is the
// SUBSCRIPTION's answer (#523 — a static block is not a provider-level fact), but the swarm side
// read that one field as the whole verdict. The repair, pinned here: the doctor's static verdict
// rides the usage row beside the subscription facts (`staticBlock`), the eligibility predicate
// refuses on it, the refusal names it as `blocked` with its own code, and the renderer prints it —
// while the row's `state` keeps answering for the provider (#523's contract, unchanged).
//
// Hermetic: temp dirs under os.tmpdir(), a real store, fixture rows, no network, no provider.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { renderRouteUsageLines } from '../src/adapter.mjs';

const BLOCKED_CODE = 'credential_expires_before_horizon';

const BLOCKED_ROUTE = Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-6', effort: 'high' });
const READY_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

function usageRow(route, { state = 'ready', staticBlock = null, turns = 0 } = {}) {
  return Object.freeze({
    route: Object.freeze({ ...route }),
    state, code: null, resetAt: null,
    usage: Object.freeze({ turns, tokens: 0, usd: 0 }),
    concurrency: Object.freeze({ ceiling: null, inUse: 0 }),
    lastProviderRefusal: null,
    quota: Object.freeze({ state: 'ok', resetAt: null }),
    staticBlock: staticBlock === null ? null : Object.freeze({ ...staticBlock }),
  });
}

async function refusalOf(promise) {
  try { await promise; } catch (error) { return error; }
  assert.fail('expected a typed refusal');
}

// ── the swarm fixture: the real runtime over a real store, with the deployment's rows injected ──

function swarmFixture(t, rows) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-static-block-591-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers, pausedTurns: () => [] },
    authorize: async () => {},
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: rows }),
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working' });
      return { taskId: `t-${workers.length}` };
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
    { swarmId: 'baton', ...(command === 'view' ? {} : { idempotencyKey: `591-${++key}` }), ...args }, owner);
  return { call, runtime, workers };
}

// ── BLOCK-591-A: a recruit onto a statically blocked route refuses pre-effect, truthfully ───────

test('BLOCK-591-A: a recruit onto a statically blocked route refuses route_exhausted naming the block', async (t) => {
  const rows = [
    usageRow(BLOCKED_ROUTE, {
      staticBlock: { code: BLOCKED_CODE, summary: 'the credential cannot outlive the lane horizon' },
    }),
    usageRow(READY_ROUTE),
  ];
  const f = swarmFixture(t, rows);
  await f.call('create', { purpose: 'static block precheck' });

  const err = await refusalOf(
    f.call('recruit', { participantId: 'seat-a', objective: 'work', options: { exact: BLOCKED_ROUTE } }),
  );
  assert.equal(err.code, 'route_exhausted', 'the refusal code is route_exhausted');
  assert.equal(err.detail.reason, 'blocked', 'the reason is the block, not a vague ineligibility');
  assert.equal(err.detail.code, BLOCKED_CODE, 'the code names the doctor\'s own verdict');
  assert.equal(err.detail.considered[0].staticBlock.code, BLOCKED_CODE,
    'the considered row carries the static block beside the provider facts');
  assert.equal(err.detail.ready.includes(`${BLOCKED_ROUTE.harness}/${BLOCKED_ROUTE.model}@${BLOCKED_ROUTE.effort}`),
    false, 'the ready list never names the blocked route');
  assert.ok(err.detail.ready.length > 0, 'the ready list names the route that IS usable');
  assert.equal(f.workers.length, 0, 'no seat was started — the refusal precedes every effect');
});

// ── BLOCK-591-B: a ready sibling under the same selector still admits ──────────────────────────

test('BLOCK-591-B: a prefix recruit whose match includes a ready route admits on that route', async (t) => {
  const rows = [
    usageRow(BLOCKED_ROUTE, {
      staticBlock: { code: BLOCKED_CODE, summary: 'the credential cannot outlive the lane horizon' },
    }),
    usageRow(READY_ROUTE),
  ];
  const f = swarmFixture(t, rows);
  await f.call('create', { purpose: 'static block with a ready sibling' });

  const recruited = await f.call('recruit', {
    participantId: 'seat-b', objective: 'work', options: { effort: 'high' },
  });
  assert.equal(recruited.admission.state, 'admitted', 'the recruit admits — one named route is usable');
  assert.equal(f.workers.length, 1, 'the seat starts');
});

// ── BLOCK-591-C: the renderer prints the block beside the subscription state ────────────────────

test('BLOCK-591-C: the route table renders the static block on the row that carries it', () => {
  const lines = renderRouteUsageLines([
    // The brief composition (swarm-runtime `_situation`) adds `recruitable` from the eligibility
    // predicate; the renderer only prints it when the row carries the boolean.
    { ...usageRow(BLOCKED_ROUTE, {
      staticBlock: { code: BLOCKED_CODE, summary: 'the credential cannot outlive the lane horizon' },
    }), recruitable: false },
    { ...usageRow(READY_ROUTE), recruitable: true },
  ]);
  assert.match(lines[0], new RegExp(`${BLOCKED_ROUTE.harness}/${BLOCKED_ROUTE.model}@${BLOCKED_ROUTE.effort}: ready \\| .*blocked=${BLOCKED_CODE}`),
    'the blocked row prints its block beside the provider state (#523 kept, #591 surfaced)');
  assert.match(lines[0], /recruitable=false/, 'the row is not recruitable');
  assert.doesNotMatch(lines[1], /blocked=/, 'the ready row prints no block');
});
