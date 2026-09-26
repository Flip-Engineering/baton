// issue612-route-read-command-entry.test.mjs — issue #612 (the second half): the per-command legs
// at the dispatch entry serve the commands that read a route.
//
// OBSERVED (2026-09-26, resident restarted onto bd4014d4; the root's #612 comment): with eight
// seats working, `baton swarm list` answered in 16.6 s and an 8 s profile (5123 samples) put
// `_drainCommitObservations` → `_preserveTurnBoundaries` → `coordinator.list` → `_publicHandle` →
// `clone` at 1643 samples and `_performAutoReroutes` → `_autoRerouteOne` → `_deploymentRouteRows`
// at 1432. Both legs read the fleet, and #486's rule puts a route read where a route is read.
//
// The contract pinned here:
//   E1 a command that reads no route (`swarm.list`) runs neither leg: it materializes no worker
//      handle for a turn boundary and performs no pending re-route — while the fault observation
//      itself (the proposal's mint) still runs at that entry.
//   E2 a command that reads a route (`swarm.view`) still reconciles turn boundaries and still
//      performs the pending re-route, whose successor is then a member.
//
// Hermetic: a real CoordinationStore, the real SwarmRuntime, and a coordinator stub that answers
// the provider-fault death seam; no git, no provider process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { PROVIDER_FAULT_CODES } from '../src/provider-faults.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const FAULTED = Object.freeze({ harness: 'zai', model: 'glm-5.3-flash', effort: 'low' });
const CANDIDATE = Object.freeze({ harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'low' });
const SWARM = 'route-read-entry';
const WORKSPACE_ID = `ws-${'a'.repeat(32)}`;
const BASE_SHA = 'c'.repeat(40);

/** One usage row exactly as the deployment's own derivation publishes it (#341 part 3 / #429). */
function usageRow(route, { intelligence = 40, ceiling = 4, inUse = 0 } = {}) {
  return Object.freeze({
    route: Object.freeze({ ...route }),
    profile: Object.freeze({
      slug: route.model, intelligence, coding: intelligence, tps: 60, ttftS: 1,
      price: null, priceReason: 'subscription',
      measuredAt: '2026-09-18T00:00:00.000Z', design: null, designReason: null,
    }),
    state: 'ready', code: null, resetAt: null,
    usage: Object.freeze({ turns: 0, tokens: 0, usd: 0 }),
    concurrency: Object.freeze({ ceiling, inUse }),
    lastProviderRefusal: null,
    credential: null,
    quota: Object.freeze({ state: 'ok', resetAt: null }),
    degraded: null,
  });
}

/** The death the coordinator's own seam recorded (#442): the typed fault and its exact route. */
const deathRow = (workerId, seq) => Object.freeze({
  workerId, taskId: 't-1', runId: 'run-alpha', seq, at: '2026-09-26T21:00:00.000Z',
  code: PROVIDER_FAULT_CODES.quota, route: Object.freeze({ ...FAULTED }),
  resetAt: null, resetAtText: null, snapshotSha: null, retainedWorktree: null,
});

function world(t) {
  const dir = mkdtempSync(join(tmpdir(), 'baton-issue612-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, '.baton', 'wt', WORKSPACE_ID), { recursive: true });
  const store = new CoordinationStore(join(dir, 'store'));
  const workers = [];
  const attachments = new Map();
  const deaths = new Map();
  const listCalls = [];
  const sessionContext = (workspaceId) => Object.freeze({
    repoRoot: repo, worktree: join(repo, '.baton', 'wt', workspaceId), baseSha: BASE_SHA, branch: 'master',
  });
  const coordinator = {
    list: () => { listCalls.push(workers.length); return workers; },
    pausedTurns: () => [],
    workspaceAttachment: (workerId) => attachments.get(workerId) ?? null,
    predecessorWorkspaceContext: (workspaceId) => ({ sessionContext: sessionContext(workspaceId), holders: [] }),
    providerFaultDeathFor: (workerId) => deaths.get(workerId) ?? null,
    // The spool a live coordinator offers every entry to drain (#425/#438). Empty here: the test
    // counts the turn-boundary reconcile the drain's tail runs, not a commit observation.
    _runtimeScopes: { leases: new Map(), takeCommitObservations: () => [] },
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {},
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null,
      routeUsage: [usageRow(CANDIDATE)] }),
    situationGit: { repoRoot: repo, head: () => null, commitsSince: () => [] },
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async (request) => {
      const index = workers.length + 1;
      const id = `w-${index}`;
      workers.push({ id, taskId: `t-${index}`, runId: request.runId, status: 'working', paused: false });
      attachments.set(id, {
        workspaceId: WORKSPACE_ID, sessionContext: sessionContext(WORKSPACE_ID), holderCount: 1,
      });
    },
  });
  let keys = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, {
    ...(command === 'list' ? {} : { swarmId: SWARM }),
    ...(['view', 'list'].includes(command) ? {} : { idempotencyKey: `entry-${command}-${++keys}` }), ...args,
  }, { actor: 'owner', principalId: 'owner' });
  return { store, runtime, call, workers, deaths, listCalls };
}

/** The two legs, counted at their own entry: the turn-boundary reconcile the drain runs and the
 * pending re-route the dispatch entry performs. */
function spyLegs(runtime) {
  const counts = { turnBoundaries: 0, reroutes: 0 };
  const boundaries = runtime._preserveTurnBoundaries.bind(runtime);
  runtime._preserveTurnBoundaries = () => { counts.turnBoundaries += 1; return boundaries(); };
  const reroutes = runtime._performAutoReroutes.bind(runtime);
  runtime._performAutoReroutes = (...args) => { counts.reroutes += 1; return reroutes(...args); };
  return counts;
}

const rowsOf = (store, kind) => store.eventsView()
  .filter((row) => (row.kind === 'driver.recorded' ? row.payload?.kind : row.kind) === kind);

test('612-E1: a command that reads no route runs neither the turn-boundary reconcile nor the re-route check', async (t) => {
  const w = world(t);
  await w.call('create', { swarmId: SWARM, purpose: 'route-read command entry (#612)' });
  await w.call('recruit', { swarmId: SWARM, participantId: 'alpha', objective: 'hold the lane' });
  const workerId = w.store.swarm(SWARM).participants.alpha.bindings.at(-1).workerId;
  w.deaths.set(workerId, deathRow(workerId, 1));

  const legs = spyLegs(w.runtime);
  const calls = w.listCalls.length;
  await w.call('list');

  assert.equal(rowsOf(w.store, 'swarm.reroute_proposed').length, 1,
    'the fault observation still mints the decision row at this entry');
  assert.deepEqual(rowsOf(w.store, 'swarm.rerouted'), [],
    'and the pending decision stays pending: this command reads no route');
  assert.equal(legs.turnBoundaries, 0, 'swarm.list reconciles no turn boundary');
  assert.equal(legs.reroutes, 0, 'swarm.list performs no pending re-route');
  assert.equal(w.listCalls.length - calls, 0,
    'so no worker handle is materialized for a command that reads no route');
});

test('612-E2: a command that reads a route still reconciles turn boundaries and performs the pending re-route', async (t) => {
  const w = world(t);
  await w.call('create', { swarmId: SWARM, purpose: 'route-read command entry (#612)' });
  await w.call('recruit', { swarmId: SWARM, participantId: 'alpha', objective: 'hold the lane' });
  const workerId = w.store.swarm(SWARM).participants.alpha.bindings.at(-1).workerId;
  w.deaths.set(workerId, deathRow(workerId, 1));
  await w.call('list');

  const legs = spyLegs(w.runtime);
  await w.call('view');

  assert.ok(legs.turnBoundaries > 0, 'the view reconciles turn boundaries');
  assert.ok(legs.reroutes > 0, 'the view runs the #574 re-route check');
  const rerouted = rowsOf(w.store, 'swarm.rerouted');
  assert.equal(rerouted.length, 1, 'the pending decision is performed by the route read');
  const successor = w.store.swarm(SWARM).participants[rerouted[0].payload.successor];
  assert.equal(successor.status, 'active', 'and its successor is a member');
  assert.deepEqual({ ...successor.route }, { ...CANDIDATE },
    'admitted on the one candidate the route rows offered');
});
