// Issue #333: the suite runner holds one host-wide verify lease for the whole verdict.
//
// run-suite.mjs acquires a `verify` lease from the host capacity authority before starting
// lanes and releases it at the verdict, printing the queued row (position, ahead, shortfall —
// the #329 shape) while it waits. BATON_HOST_CAPACITY_DISABLED=1 stays the bypass, a
// suite-runner child stays unwired, the worker's verify projects onto the swarm view
// participant row as verify {state, position, ahead} from the lease holder name
// participant:<swarm>:<seat>, and the deployment summary's hostCapacity.used.leases.verify
// counts worker suites.
//
// Red-before: written before the implementation; rows S333-1..S333-5 fail at HEAD (the helper
// module and the derivation do not exist, and run-suite.mjs acquires nothing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  deriveHostCapacity, hostCapacityObservation, HostCapacityAuthority, projectParticipantVerify,
} from '../src/host-capacity.mjs';
import {
  acquireSuiteVerifyLease, DEFAULT_SUITE_LEASE_WAIT_MS, formatSuiteQueueRow, suiteLeaseDisabled,
  suiteLeaseNested, suiteLeaseWaitMs, suiteQueueTimeoutDecision,
} from '../scripts/suite-host-lease.mjs';

const G = 1024 ** 3;
const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');

function leaseRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-s333-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// A host with no room for a verify lease: saturated, so the queued row is deterministic
// regardless of the machine the suite runs on.
const saturated = () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 9 });

test('S333-1: a staged authority with no room queues the suite lease and prints the #329 row', async (t) => {
  const root = leaseRoot(t);
  const authority = new HostCapacityAuthority({
    root, residentId: 's333-suite', observation: saturated, pollMs: 10, waitMs: 120,
  });
  const printed = [];
  let queued = null;
  await assert.rejects(
    acquireSuiteVerifyLease({
      // A bare env: the unit stages the authority itself, so no ambient suite bypass may win.
      env: {},
      authority, holder: 'run-suite:1',
      log: (line) => { printed.push(line); },
      onQueued: (row) => { queued = row; },
    }),
    (error) => error.code === 'host_capacity_queue_timeout',
  );
  assert.deepEqual(queued, {
    position: 1, ahead: 0, running: 0, workerLeases: 0,
    shortfall: { dimension: 'load', observed: 9, required: 4, unit: 'load1m' },
  }, 'the queued row is the #329 shape: position, ahead, shortfall with the numbers');
  assert.equal(printed.length, 1, 'the row is printed once, while waiting');
  assert.equal(printed[0], formatSuiteQueueRow(queued), 'the printed line is the formatter\'s row');
  assert.equal(formatSuiteQueueRow({ position: 2, ahead: 1, shortfall: null }),
    'baton test runner: host capacity queued this verify request at position 2 (1 ahead) (operator bypass: BATON_HOST_CAPACITY_DISABLED=1)');
  assert.match(printed[0], /host capacity queued this verify request at position 1 \(0 ahead\)/u);
  assert.match(printed[0], /waiting on load: 9 load1m observed, 4 required/u);
  assert.match(printed[0], /BATON_HOST_CAPACITY_DISABLED=1/u);
  assert.equal(readdirSync(join(root, 'queue')).filter((name) => name.endsWith('.json')).length, 0,
    'a spent suite wait withdraws its own queue record');
  assert.equal(readdirSync(join(root, 'leases')).filter((name) => name.endsWith('.json')).length, 0,
    'a refused suite run holds no lease');
});

test('S333-2: the bypass never touches the lease directory', async (t) => {
  const parent = leaseRoot(t);
  const untouched = join(parent, 'never-created');
  const outcome = await acquireSuiteVerifyLease({
    env: { BATON_HOST_CAPACITY_DISABLED: '1', BATON_HOST_CAPACITY_ROOT: untouched },
    log: () => { throw new Error('a bypassed run prints no queue row'); },
  });
  assert.equal(outcome.disabled, true);
  assert.equal(outcome.token, null);
  assert.equal(await outcome.release(), false, 'releasing a bypassed lease is a no-op');
  assert.equal(existsSync(untouched), false, 'the bypass creates neither the root nor a record');
  assert.equal(suiteLeaseDisabled({ BATON_HOST_CAPACITY_DISABLED: '1' }), true);
  assert.equal(suiteLeaseDisabled({}), false);
  assert.equal(suiteLeaseNested({ BATON_TEST_SUITE_ROOT: '/tmp/x' }), true,
    'a runner spawned from a test file stays unwired');
  assert.equal(suiteLeaseNested({}), false);
  const nested = await acquireSuiteVerifyLease({
    env: { BATON_TEST_SUITE_ROOT: '/tmp/x', BATON_HOST_CAPACITY_ROOT: untouched },
    log: () => { throw new Error('a nested run prints no queue row'); },
  });
  assert.equal(nested.disabled, true);
  assert.equal(nested.nested, true);
  assert.equal(existsSync(untouched), false, 'a nested run touches no lease directory either');
  assert.equal(suiteLeaseWaitMs({}), DEFAULT_SUITE_LEASE_WAIT_MS,
    'the runner\'s own wait defaults short — verify leases are held for minutes, so a longer wait only delays the same decision');
  assert.equal(suiteLeaseWaitMs({ BATON_HOST_CAPACITY_WAIT_MS: '60000' }), 60000,
    'the operator extends the wait when queuing behind a known-finishing holder');
  assert.equal(suiteLeaseWaitMs({ BATON_HOST_CAPACITY_WAIT_MS: 'soon' }), DEFAULT_SUITE_LEASE_WAIT_MS,
    'an unparseable pin falls back to the default, never to unbounded');
});

test('S333-3: the participant-row derivation reads verify {state, position, ahead} from the holder name', async (t) => {
  const root = leaseRoot(t);
  const authority = new HostCapacityAuthority({
    root, residentId: 's333-deploy', observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 1 }),
    pollMs: 10, waitMs: 5_000,
  });
  const holder = 'participant:baton:seat1';
  assert.equal(await authority.observeParticipantVerify(holder), null,
    'a seat with no verify lease and no queue entry carries no verify row — absence, never a guess');
  assert.equal(projectParticipantVerify([], new Set(), holder), null);
  assert.equal(projectParticipantVerify([], new Set(), null), null);
  const held = await authority.acquire('verify', { holder });
  assert.deepEqual(await authority.observeParticipantVerify(holder),
    { state: 'admitted', position: null, ahead: null });
  assert.deepEqual(projectParticipantVerify([], new Set([holder]), holder),
    { state: 'admitted', position: null, ahead: null });
  assert.equal(await authority.observeParticipantVerify('participant:baton:other'), null,
    'one seat\'s lease never projects onto another seat\'s row');
  // A second verify does not fit beside the first (one verdict lane on four cores), so the
  // other seat queues behind it with a visible place.
  const waiter = new HostCapacityAuthority({
    root, residentId: 's333-worker', observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 1 }),
    pollMs: 10, waitMs: 5_000,
  });
  const pending = waiter.acquire('verify', { holder: 'participant:baton:seat2' });
  await new Promise((resolve) => { setTimeout(resolve, 120); });
  assert.deepEqual(await authority.observeParticipantVerify('participant:baton:seat2'),
    { state: 'queued', position: 1, ahead: 0 });
  await authority.release(held.token);
  await pending.then((outcome) => waiter.release(outcome.token));
  assert.equal(await authority.observeParticipantVerify('participant:baton:seat2'), null,
    'a drained queue returns the row to absence');
});

function blockVerifyBudget(root, t) {
  // One live verify lease fills the whole verdict budget (usableCores == suiteCores), so a
  // runner that honours the authority must queue behind it on any machine.
  const nonce = randomBytes(16).toString('hex');
  const record = {
    schemaVersion: 1, kind: 'verify', holder: 's333-blocker', nonce, pid: process.pid,
    residentId: 's333-blocker', acquiredAt: new Date().toISOString(),
  };
  mkdirSync(join(root, 'leases'), { recursive: true, mode: 0o700 });
  const path = join(root, 'leases', `lease-verify-${nonce}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  t.after(() => rmSync(path, { force: true }));
  return record;
}

function runRunner(t, { file, env }) {
  const child = spawn(process.execPath, [RUNNER, file], {
    cwd: IMPL, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolveClose) => {
    child.once('error', (error) => resolveClose({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolveClose({ code, signal, error: null }));
  });
  return { done: done.then((terminal) => ({ ...terminal, stdout, stderr })) };
}

test('S333-4: a staged authority with no room queues run-suite, which prints the row', async (t) => {
  const root = leaseRoot(t);
  blockVerifyBudget(root, t);
  const parent = mkdtempSync(join(tmpdir(), 'baton-s333-tmp-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.BATON_HOST_CAPACITY_DISABLED;
  // A top-level runner admits through the authority even when this test itself runs as a
  // suite child: drop the suite-child marker the child environment would otherwise inherit.
  delete env.BATON_TEST_SUITE_ROOT;
  const { done } = runRunner(t, { file: 'test/suite-verdict.test.mjs', env: {
    ...env, BATON_HOST_CAPACITY_ROOT: root, BATON_HOST_CAPACITY_WAIT_MS: '1500',
    BATON_HOST_CAPACITY_POLL_MS: '25', BATON_TEST_TMP_PARENT: parent,
  } });
  const terminal = await done;
  assert.equal(terminal.signal, null);
  assert.match(terminal.stderr, /host capacity queued this verify request at position 1 \(0 ahead\)/u,
    'the runner prints the queued row while it waits');
  assert.match(terminal.stderr, /waiting on (budget|memory|load): [\d.]+ (cores|bytes|load1m) observed/u,
    'the row names the dimension the runner waits on (load reads fractional)');
  // The spent wait's outcome follows the live host's own gating dimension (the shortfall
  // order is load, then memory, then budget): a host its own measurement gates refuses
  // before lanes, while a host that cannot fund a suite's share runs degraded with a
  // warning instead of bricking — both after printing the same queued row.
  const live = deriveHostCapacity(hostCapacityObservation());
  if (!live.saturated && live.memoryTight) {
    assert.match(terminal.stderr, /waiting on memory/u);
    assert.match(terminal.stderr, /proceeding WITHOUT a host verify lease/u,
      'a standing memory limit degrades visibly instead of bricking the suite');
    assert.match(terminal.stderr, /concurrent suites here will contend/u);
    assert.equal(terminal.code, 0, 'the degraded run still judges its file');
    assert.match(terminal.stdout, /^# file test\/suite-verdict\.test\.mjs/mu, 'the lane ran');
  } else {
    assert.equal(terminal.code, 1, 'a runner the host cannot admit refuses instead of running starved');
    assert.match(terminal.stderr, /admission wait is spent/u, 'the spent wait names itself');
    assert.doesNotMatch(terminal.stdout, /^# file /mu, 'no lane started: admission refuses pre-effect');
  }
  const queued = existsSync(join(root, 'queue'))
    ? readdirSync(join(root, 'queue')).filter((name) => name.endsWith('.json')) : [];
  assert.equal(queued.length, 0, 'the spent wait withdrew its queue entry either way');
  assert.equal(readdirSync(join(root, 'leases')).filter((name) => name.endsWith('.json')).length, 1,
    'the run disturbed no other lease');
});

test('S333-8: the spent-wait decision refuses when waiting could help and degrades only on a standing memory limit', () => {
  const timeout = (shortfall) => ({ code: 'host_capacity_queue_timeout', shortfall });
  assert.equal(suiteQueueTimeoutDecision(timeout({ dimension: 'budget' })), 'refuse',
    'another lease holds the lane: waiting can admit, so a spent wait refuses');
  assert.equal(suiteQueueTimeoutDecision(timeout({ dimension: 'load' })), 'refuse',
    'an oversubscribed host: waiting can admit, so a spent wait refuses');
  assert.equal(suiteQueueTimeoutDecision(timeout({ dimension: 'memory' })), 'proceed-degraded',
    'a host that cannot fund a suite: no wait would admit, so the run degrades visibly');
  assert.equal(suiteQueueTimeoutDecision(timeout(null)), 'refuse', 'an unnamed shortfall fails closed');
  assert.equal(suiteQueueTimeoutDecision(timeout(undefined)), 'refuse');
  assert.equal(suiteQueueTimeoutDecision({ code: 'host_capacity_unavailable' }), 'refuse',
    'only the queue-timeout refusal degrades');
  assert.equal(suiteQueueTimeoutDecision(null), 'refuse');
});

test('S333-5: a bypassed run-suite run never touches the lease directory', async (t) => {
  const parent = leaseRoot(t);
  const untouched = join(parent, 'never-created');
  const tmpParent = mkdtempSync(join(tmpdir(), 'baton-s333-tmp-'));
  t.after(() => rmSync(tmpParent, { recursive: true, force: true }));
  // Drop the suite-child marker so the DISABLED bypass is what is exercised, not the nested one.
  const env = { ...process.env, BATON_HOST_CAPACITY_DISABLED: '1', BATON_HOST_CAPACITY_ROOT: untouched };
  delete env.BATON_TEST_SUITE_ROOT;
  const { done } = runRunner(t, { file: 'test/suite-verdict.test.mjs', env: {
    ...env, BATON_TEST_TMP_PARENT: tmpParent,
  } });
  const terminal = await done;
  assert.equal(terminal.signal, null);
  assert.equal(terminal.code, 0, 'the bypassed run executes its file normally');
  assert.match(terminal.stdout, /^# file test\/suite-verdict\.test\.mjs/mu, 'the lane ran');
  assert.equal(existsSync(untouched), false, 'the bypassed run created no lease directory');
});

test('S333-7: a nested runner stays unwired — the suite\'s self-checks never queue behind their parent\'s lease', async (t) => {
  const root = leaseRoot(t);
  blockVerifyBudget(root, t);
  const tmpParent = mkdtempSync(join(tmpdir(), 'baton-s333-tmp-'));
  t.after(() => rmSync(tmpParent, { recursive: true, force: true }));
  // A runner spawned from a test file carries BATON_TEST_SUITE_ROOT: even with no room on
  // the authority it runs its lanes immediately, the way deployments stay unwired for suite
  // children (a suite host is oversubscribed by design).
  const { done } = runRunner(t, { file: 'test/suite-verdict.test.mjs', env: {
    ...process.env, BATON_TEST_SUITE_ROOT: join(tmpParent, 'suite-root'),
    BATON_HOST_CAPACITY_ROOT: root, BATON_HOST_CAPACITY_WAIT_MS: '1500',
    BATON_HOST_CAPACITY_POLL_MS: '25', BATON_TEST_TMP_PARENT: tmpParent,
  } });
  const terminal = await done;
  assert.equal(terminal.signal, null);
  assert.equal(terminal.code, 0, 'the nested run executes its file instead of queuing');
  assert.match(terminal.stdout, /^# file test\/suite-verdict\.test\.mjs/mu, 'the lane ran');
  assert.doesNotMatch(terminal.stderr, /host capacity queued/u, 'no queue row was ever printed');
  const queued = existsSync(join(root, 'queue'))
    ? readdirSync(join(root, 'queue')).filter((name) => name.endsWith('.json')) : [];
  assert.equal(queued.length, 0, 'the nested run enqueued nothing');
});

test('S333-6: the deployment summary\'s hostCapacity.used.leases.verify counts worker suites', async (t) => {
  const root = leaseRoot(t);
  const authority = new HostCapacityAuthority({
    root, residentId: 's333-deploy', observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 1 }),
    pollMs: 10, waitMs: 5_000,
  });
  // The deployment summary carries observeNow(): a worker's suite (a verify lease held under
  // the participant holder name) must read as a verify lease there.
  const suite = await authority.acquire('verify', { holder: 'participant:baton:seat9' });
  assert.equal(authority.observeNow().used.leases.verify, 1);
  assert.equal(authority.observeNow().used.leases.worker, 0);
  await authority.release(suite.token);
  assert.equal(authority.observeNow().used.leases.verify, 0);
});
