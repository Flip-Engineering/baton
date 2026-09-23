// Issue #333: the suite runner holds one host-wide verify lease for the whole verdict.
//
// run-suite.mjs acquires a `verify` lease from the host capacity authority before starting
// lanes and releases it at the verdict, printing the queued row (position, ahead, shortfall —
// the #329 shape) while it waits. BATON_HOST_CAPACITY_DISABLED=1 stays the bypass, a runner
// nested under a lease-holding parent (#424: proven by the parent's token digest in
// BATON_SUITE_VERIFY_LEASE) stays unwired, the worker's verify projects onto the swarm view
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
  HostCapacityAuthority, projectParticipantVerify,
} from '../src/host-capacity.mjs';
import {
  acquireSuiteVerifyLease, formatSuiteQueueRow, suiteLeaseDisabled,
  suiteLeaseNested, SUITE_VERIFY_LEASE_ENV,
} from '../scripts/suite-host-lease.mjs';

const G = 1024 ** 3;
const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');

function leaseRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-s333-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// A host with no room for a verify lease: another resident's verdict holds the whole budget,
// so the queued row is deterministic regardless of the machine the suite runs on. #541: the
// wait is not bounded — the runner waits behind that verdict and is admitted when it releases.
const roomy = () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 9 });

test('S333-1: a staged authority with no room queues the suite lease, prints the #329 row, and admits it when the verdict ahead releases', async (t) => {
  const root = leaseRoot(t);
  const blocker = new HostCapacityAuthority({ root, residentId: 's333-blocker', observation: roomy, pollMs: 10 });
  const held = await blocker.acquire('verify', { holder: 'other-verdict' });
  const authority = new HostCapacityAuthority({ root, residentId: 's333-suite', observation: roomy, pollMs: 10 });
  const printed = [];
  let queued = null;
  const pending = acquireSuiteVerifyLease({
    // A bare env: the unit stages the authority itself, so no ambient suite bypass may win.
    env: {},
    authority, holder: 'run-suite:1',
    log: (line) => { printed.push(line); },
    onQueued: (row) => { queued = row; },
  });
  await new Promise((resolveWait) => { setTimeout(resolveWait, 120); });
  assert.deepEqual(queued, {
    position: 1, ahead: 0, running: 1, workerLeases: 0,
    shortfall: { dimension: 'budget', observed: 0, required: 3, unit: 'cores' },
  }, 'the queued row is the #329 shape: position, ahead, shortfall with the numbers — load 9 on 4 cores is not a dimension (#541)');
  assert.equal(printed.length, 1, 'the row is printed once, while waiting');
  assert.equal(printed[0], formatSuiteQueueRow(queued), 'the printed line is the formatter\'s row');
  assert.equal(formatSuiteQueueRow({ position: 2, ahead: 1, shortfall: null }),
    'baton test runner: host capacity queued this verify request at position 2 (1 ahead) (operator bypass: BATON_HOST_CAPACITY_DISABLED=1)');
  assert.match(printed[0], /waiting on budget: 0 cores observed, 3 required/u);
  await blocker.release(held.token);
  const lease = await pending;
  assert.ok(lease.token, 'the suite lease is admitted when the verdict ahead releases — never refused for waiting');
  assert.equal('degraded' in lease, false, '#561 removed the degrade-and-proceed shape: the lease answers admitted or queued, nothing else');
  assert.equal(await lease.release(), true);
  assert.equal((await authority.observe()).queue.length, 0, 'the drained request left the queue');
});

test('S333-1b: a host that cannot fund a suite QUEUES the request durably — no lease, the memory shortfall named, admitted when the host funds it (#561)', async (t) => {
  const root = leaseRoot(t);
  // 4 cores / 32 GB: a suite is entitled to 3 shares (24 GB); 1 GB available cannot fund it.
  const host = { freeBytes: 1 * G };
  const tight = () => ({ cores: 4, totalBytes: 32 * G, freeBytes: host.freeBytes, load1m: 1 });
  const authority = new HostCapacityAuthority({ root, residentId: 's333-tight', observation: tight, pollMs: 10 });
  const printed = [];
  const pending = acquireSuiteVerifyLease({
    env: {}, authority, holder: 'run-suite:2', log: (line) => { printed.push(line); },
  });
  await new Promise((resolveWait) => { setTimeout(resolveWait, 120); });
  assert.equal(printed.length, 1, 'the request queued, so the #329 row printed once');
  assert.match(printed[0], /waiting on memory: 1073741824 bytes observed, 8589934592 required/u,
    'the row names the observed headroom (1 GB) and the one-lane need (8 GB) with their numbers');
  assert.equal((await authority.observe()).queue.length, 1, 'the request waits in the queue, unrefused');
  // The host frees memory: the waiting request is admitted — the wait has no deadline, but it
  // is not forever, because the resource it waits on returned.
  host.freeBytes = 30 * G;
  const lease = await pending;
  assert.ok(lease.token, 'the suite lease is admitted once the observed headroom funds one lane');
  assert.equal(await lease.release(), true);
  assert.equal((await authority.observe()).queue.length, 0, 'the drained request left the queue');
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
  // #424: the parent's own lease token is the proof — the inherited suite root alone is not.
  const parentDigest = randomBytes(32).toString('hex');
  assert.equal(suiteLeaseNested({ BATON_TEST_SUITE_ROOT: '/tmp/x' }), false,
    'the suite root alone never nests a runner: a seat inherits that root and still admits');
  assert.equal(suiteLeaseNested({}), false);
  const nested = await acquireSuiteVerifyLease({
    env: {
      BATON_TEST_SUITE_ROOT: '/tmp/x', [SUITE_VERIFY_LEASE_ENV]: parentDigest,
      BATON_HOST_CAPACITY_ROOT: untouched,
    },
    log: () => { throw new Error('a nested run prints no queue row'); },
  });
  assert.equal(nested.disabled, true);
  assert.equal(nested.nested, true);
  assert.equal(existsSync(untouched), false, 'a nested run touches no lease directory either');
});

test('S333-3: the participant-row derivation reads verify {state, position, ahead, holderAlive} from the holder name', async (t) => {
  const root = leaseRoot(t);
  const authority = new HostCapacityAuthority({
    root, residentId: 's333-deploy', observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 1 }),
    pollMs: 10,
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
    pollMs: 10,
  });
  const pending = waiter.acquire('verify', { holder: 'participant:baton:seat2' });
  await new Promise((resolve) => { setTimeout(resolve, 120); });
  assert.deepEqual(await authority.observeParticipantVerify('participant:baton:seat2'),
    { state: 'queued', position: 1, ahead: 0, holderAlive: true });
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
  return { done: done.then((terminal) => ({ ...terminal, stdout, stderr })), stderrSoFar: () => stderr };
}

test('S333-4: run-suite queues behind a live verdict, prints the row, and runs once the verdict releases (#541: never refused for waiting)', async (t) => {
  const root = leaseRoot(t);
  const blocker = blockVerifyBudget(root, t);
  const parent = mkdtempSync(join(tmpdir(), 'baton-s333-tmp-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.BATON_HOST_CAPACITY_DISABLED;
  // A top-level runner admits through the authority even when this test itself runs as a
  // suite child: drop the suite-child marker the child environment would otherwise inherit.
  delete env.BATON_TEST_SUITE_ROOT;
  // #424: the suite child's parent token would nest the runner this test spawns as a top-level
  // one; drop it with the root marker.
  delete env[SUITE_VERIFY_LEASE_ENV];
  const { done, stderrSoFar } = runRunner(t, { file: 'test/suite-verdict.test.mjs', env: {
    ...env, BATON_HOST_CAPACITY_ROOT: root, BATON_HOST_CAPACITY_POLL_MS: '25', BATON_TEST_TMP_PARENT: parent,
    // One lane: the claim the queued request prices must fit this host's real headroom once the
    // blocker releases, whatever the machine's full derivation would resolve to.
    BATON_SUITE_PARALLELISM: '1',
  } });
  // #561: the request queues — on the budget or, on a memory-tight host, on the observed
  // headroom; either way the row is admission's own and nothing is refused.
  const queuedRow = /host capacity queued this verify request at position 1 \(0 ahead\)/u;
  while (!queuedRow.test(stderrSoFar())) {
    await new Promise((resolveWait) => { setTimeout(resolveWait, 25); });
  }
  assert.match(stderrSoFar(), /waiting on (budget|memory): /u,
    'the row names the dimension the runner waits on with its numbers — never load (#541)');
  // The verdict ahead releases; the runner is admitted and runs its lane.
  rmSync(join(root, 'leases', `lease-verify-${blocker.nonce}.json`), { force: true });
  const terminal = await done;
  assert.equal(terminal.signal, null);
  assert.equal(terminal.code, 0, 'the run proceeded once admitted');
  assert.match(terminal.stdout, /^# file test\/suite-verdict\.test\.mjs/mu, 'the lane ran');
  assert.doesNotMatch(terminal.stderr, /proceeding WITHOUT a host verify lease/u,
    '#561: no runner proceeds without a lease anymore');
  assert.doesNotMatch(terminal.stderr, /admission wait is spent|refused at admission/u, 'nothing was refused for waiting');
  const queued = existsSync(join(root, 'queue'))
    ? readdirSync(join(root, 'queue')).filter((name) => name.endsWith('.json')) : [];
  assert.equal(queued.length, 0, 'the admitted request left the queue');
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
  // A runner spawned from a test file carries BATON_TEST_SUITE_ROOT and its parent's token
  // digest: even with no room on the authority it runs its lanes immediately, because the
  // parent that spawned it holds the very lease the nested verdict would queue behind (#424).
  const { done } = runRunner(t, { file: 'test/suite-verdict.test.mjs', env: {
    ...process.env, BATON_TEST_SUITE_ROOT: join(tmpParent, 'suite-root'),
    [SUITE_VERIFY_LEASE_ENV]: randomBytes(32).toString('hex'),
    BATON_HOST_CAPACITY_ROOT: root, BATON_HOST_CAPACITY_POLL_MS: '25', BATON_TEST_TMP_PARENT: tmpParent,
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
    pollMs: 10,
  });
  // The deployment summary carries observeNow(): a worker's suite (a verify lease held under
  // the participant holder name) must read as a verify lease there.
  const suite = await authority.acquire('verify', { holder: 'participant:baton:seat9' });
  assert.equal(authority.observeNow().used.leases.verify, 1);
  assert.equal(authority.observeNow().used.leases.worker, 0);
  await authority.release(suite.token);
  assert.equal(authority.observeNow().used.leases.verify, 0);
});
