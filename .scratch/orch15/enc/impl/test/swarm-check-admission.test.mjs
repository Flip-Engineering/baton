// Issue #269 items 2 and 4 (red-before): a queued check is visible on swarm.view, and a
// participant cannot check its own contribution.
//
// Item 4: swarm.check by the contributing seat refuses with typed `self_check_refused` naming
// the reviewer rule (checks are independent observations, never a substitute for the author's
// own status) — before any effect: no check runs, no review row lands.
// Item 2: while a swarm.check waits on the host capacity authority, the contribution row and
// the attention list show it as queued with the position, ahead and shortfall the #329 queued
// row carries — the same durable swarm.admission_queued / admitted / timeout rows recruits get,
// folded the same way the #329 admission slice folds them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const SHA = 'b'.repeat(40);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(t, { hostCapacity = null, checkBehavior = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-check-admission-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const checks = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    checkContribution: async (workerId, { contributionId, checkId }) => {
      checks.push({ workerId, contributionId, checkId });
      if (typeof checkBehavior === 'function') return checkBehavior({ workerId, contributionId, checkId });
      return { passed: true, sha: SHA, attempt: { cleanup: { state: 'closed' } } };
    },
  };
  const ports = {
    store, coordinator, authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: true });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
    ...(hostCapacity ? { hostCapacity } : {}),
  };
  const runtime = new SwarmRuntime(ports);
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(['list'].includes(command) ? {} : { swarmId: 'baton' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }),
      ...args }, caller);
  const recruit = (participantId, permissions, caller = owner) => call('recruit', {
    participantId, objective: `Continue working as ${participantId}`, ...(permissions ? { permissions } : {}),
  }, caller);
  return { store, runtime, workers, checks, call, recruit };
}

async function twoSeats(f) {
  await f.call('create', { purpose: 'Check admission' });
  await f.recruit('builder');
  await f.recruit('reviewer', ['read', 'review', 'communicate']);
  const builder = principal('w-1');
  const reviewer = principal('w-2');
  await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c1', participantId: 'builder', body: 'A finished piece of work.' } }, builder);
  return { builder, reviewer };
}

const admissionRows = (store) => store.eventsView()
  .filter((event) => event.kind === 'driver.recorded' && String(event.payload?.kind ?? '').startsWith('swarm.admission_'));

test('#269 item 4: swarm.check by the contributing seat refuses self_check_refused and runs nothing', async (t) => {
  const f = fixture(t);
  const { builder, reviewer } = await twoSeats(f);
  // Sanity: a reviewer checking the builder's contribution is the normal flow and still passes.
  const ok = await f.call('check', { participantId: 'builder', contributionId: 'c1', checkId: 'allowed' }, reviewer);
  assert.equal(ok.passed, true);
  // The contributing seat checking its own contribution refuses with the typed refusal.
  await assert.rejects(
    f.call('check', { participantId: 'builder', contributionId: 'c1', checkId: 'self' }, builder),
    { code: 'self_check_refused' });
  assert.equal(f.checks.filter((row) => row.checkId === 'self').length, 0, 'a refused self-check runs no check');
  const swarm = f.store.swarm('baton');
  assert.ok(!(swarm.reviews?.['c1'] ?? []).some((review) => String(review?.reason ?? '').includes('self')),
    'a refused self-check records no review row');
  const refusals = f.store.eventsView().filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.operation_refused' && event.payload?.code === 'self_check_refused');
  assert.equal(refusals.length, 1, 'the refusal is a durable row');
  assert.match(String(refusals[0].payload?.rule ?? ''), /independence/,
    'the refusal row names the reviewer rule');
});

test('#269 item 2: a check that waits on the host authority reads queued on the view while it waits', async (t) => {
  let releaseCheck = null;
  const gate = new Promise((resolve) => { releaseCheck = resolve; });
  const hostCapacity = {
    observeNow: () => ({
      // #541: load is not a shortfall dimension; a check waits on the budget another verdict holds.
      capacity: { saturated: true, cores: 4, load1m: 9, memoryTight: false,
        suiteCores: 3, suiteBytes: 100, coreShareBytes: 10, usableCores: 3, usableBytes: 1000, availableBytes: 500 },
      used: { cores: 3, bytes: 100, leases: { verify: 1, worker: 0 } },
      queue: [{ position: 1, ahead: 0, kind: 'verify', holder: 'check:c1:k1', residentId: 'r', enqueuedAt: 't' }],
    }),
  };
  const f = fixture(t, { hostCapacity,
    checkBehavior: async () => {
      await gate;
      return { passed: true, sha: SHA, attempt: { cleanup: { state: 'closed' } },
        admission: { state: 'admitted', authority: 'host', position: 1, ahead: 0, queuedAt: 't' } };
    } });
  const { reviewer } = await twoSeats(f);
  const pending = f.call('check', { participantId: 'builder', contributionId: 'c1', checkId: 'k1' }, reviewer);
  await sleep(150);
  try {
    const waiting = await f.call('view', {}, reviewer);
    const admission = waiting.admission.find((row) => row.command === 'swarm.check');
    assert.ok(admission, 'the waiting check folds into the admission slice');
    assert.equal(admission.state, 'queued');
    assert.equal(admission.contributionId, 'c1');
    assert.equal(admission.checkId, 'k1');
    assert.equal(admission.position, 1);
    assert.equal(admission.ahead, 0);
    assert.deepEqual(admission.shortfall,
      { dimension: 'budget', observed: 0, required: 3, unit: 'cores' });
    const queued = waiting.attention.find((row) => row.kind === 'check_queued');
    assert.ok(queued, 'the waiting check mints a check_queued attention row');
    assert.equal(queued.contributionId, 'c1');
    assert.equal(queued.position, 1);
    assert.equal(queued.ahead, 0);
    assert.deepEqual(queued.shortfall, admission.shortfall);
    const contribution = waiting.contributions.find((row) => row.contributionId === 'c1');
    assert.ok(contribution, 'the contribution row is on the view');
    assert.equal(contribution.admission?.state, 'queued');
    assert.equal(contribution.admission?.position, 1);
    assert.equal(contribution.admission?.ahead, 0);
    assert.deepEqual(contribution.admission?.shortfall, admission.shortfall);
  } finally {
    releaseCheck();
  }
  const result = await pending;
  assert.equal(result.passed, true, 'the check still settles once admitted');
  const after = await f.call('view', {}, reviewer);
  assert.equal(after.attention.some((row) => row.kind === 'check_queued'), false,
    'the queued attention retires once the check is admitted');
  assert.equal(after.admission.find((row) => row.command === 'swarm.check')?.state, 'admitted');
});

test('#269 item 2: a check admitted after queueing leaves the durable queued/admitted rows', async (t) => {
  const f = fixture(t, { checkBehavior: async () => ({ passed: true, sha: SHA,
    attempt: { cleanup: { state: 'closed' } },
    admission: { state: 'admitted', authority: 'host', position: 2, ahead: 1, queuedAt: 't' } }) });
  const { reviewer } = await twoSeats(f);
  await f.call('check', { participantId: 'builder', contributionId: 'c1', checkId: 'k2' }, reviewer);
  const rows = admissionRows(f.store).filter((event) => event.payload?.command === 'swarm.check');
  assert.deepEqual(rows.map((event) => event.payload?.kind),
    ['swarm.admission_queued', 'swarm.admission_admitted']);
  assert.equal(rows[0].payload?.contributionId, 'c1');
  assert.equal(rows[0].payload?.checkId, 'k2');
  assert.equal(rows[0].payload?.position, 2);
  assert.equal(rows[0].payload?.ahead, 1);
  const view = await f.call('view', {}, reviewer);
  assert.equal(view.admission.find((row) => row.command === 'swarm.check')?.state, 'admitted');
});

test('#269 item 2: a check the host cannot admit records admission_timeout and refuses typed', async (t) => {
  const shortfall = { dimension: 'memory', observed: 10, required: 100, unit: 'bytes' };
  const f = fixture(t, { checkBehavior: async () => {
    throw Object.assign(new Error('host capacity queued this verify request at position 2 (1 ahead)'
      + ' and the 5000ms admission wait is spent; no capacity effect was applied'
      + ' (operator bypass: BATON_HOST_CAPACITY_DISABLED=1)'),
    { code: 'host_capacity_queue_timeout', queuePosition: 2, queueAhead: 1, shortfall,
      waitMs: 5000, bypass: 'BATON_HOST_CAPACITY_DISABLED=1', leaseKind: 'verify' });
  } });
  const { reviewer } = await twoSeats(f);
  await assert.rejects(
    f.call('check', { participantId: 'builder', contributionId: 'c1', checkId: 'k3' }, reviewer),
    { code: 'host_capacity_queue_timeout' });
  const rows = admissionRows(f.store).filter((event) => event.payload?.command === 'swarm.check');
  const timeout = rows.find((event) => event.payload?.kind === 'swarm.admission_timeout');
  assert.ok(timeout, 'the spent wait records swarm.admission_timeout against the check');
  assert.equal(timeout.payload?.contributionId, 'c1');
  assert.equal(timeout.payload?.position, 2);
  assert.equal(timeout.payload?.ahead, 1);
  assert.deepEqual(timeout.payload?.shortfall, shortfall);
  assert.equal(timeout.payload?.bypass, 'BATON_HOST_CAPACITY_DISABLED=1');
  const view = await f.call('view', {}, reviewer);
  const attention = view.attention.find((row) => row.kind === 'check_queue_timeout');
  assert.ok(attention, 'the spent wait mints a check_queue_timeout attention row');
  assert.equal(attention.contributionId, 'c1');
  assert.equal(attention.checkId, 'k3');
  assert.deepEqual(attention.shortfall, shortfall);
  assert.equal(attention.bypass, 'BATON_HOST_CAPACITY_DISABLED=1');
});
