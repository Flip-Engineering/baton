// Issue #424: a seat-run suite subset takes the host verify lease like any other verdict.
//
// Evidence (2026-09-18 03:15–03:25 UTC): three seats each ran
// `node impl/scripts/run-suite.mjs --changed impl/src/coordinator.mjs` while the host lease
// directory held nine `worker` leases and NO `verify` lease; load rose from 11 to 58 and every
// other resident's admission queued on `load` and timed out. Neither environment bypass applied
// to those seats: a deployment whose `hostAdmissionDisabled` is true holds no worker lease at all
// (application-deployment.mjs nulls the authority), so the nine worker leases prove the resident
// deployment was WIRED — and RuntimeIsolation projects the deployment's environment onto its seats
// with the BATON_* names intact (only secret- and provider-shaped names are filtered). What made
// the seats' verdicts lease-free was therefore the runner's own pre-lane decision: the host's
// standing `memory` shortfall (available bytes below the suite's 90%-of-RAM share) spends the
// runner's short default wait, and the runner proceeds degraded holding no lease record.
//
// Two rules follow, and both are pinned here: a run that only INHERITS the suite root is a
// verdict like any other (it admits, and its holder names the seat, so #333's participant row
// shows it), while the `nested` bypass requires the parent's own lease token in the environment;
// and the lane width — the one guard that still applies to a degraded run — derives from the
// host's current load, not from cores and memory alone.
//
// Red-before: written before the implementation; rows S424-1..S424-5 fail at HEAD (the suite
// root alone disables the lease, the holder is the runner's pid, the lane width ignores the load,
// and the runner prints its plan only after admission).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { defaultSuiteParallelism, HostCapacityAuthority } from '../src/host-capacity.mjs';
import {
  acquireSuiteVerifyLease, formatSuitePlan, SUITE_VERIFY_LEASE_ENV, suiteLeaseHolder,
  suiteLeaseNested, suiteLeaseTokenDigest,
} from '../scripts/suite-host-lease.mjs';

const G = 1024 ** 3;
const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');

function leaseRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-s424-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function leaseCount(root) {
  return readdirSync(join(root, 'leases')).filter((name) => name.endsWith('.json')).length;
}

// A staged host with room for one verdict, so the row tests the bypass rule, never this machine.
const roomy = () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 0 });

// The seat's projected environment: the suite root a deployment running under a suite hands down,
// plus the bridge identity the runtime projects onto the seat.
const seatEnv = () => Object.freeze({
  BATON_TEST_SUITE_ROOT: '/tmp/not-this-runner-s-suite',
  BATON_SWARM_BRIDGE_SWARM_ID: 'swarm-wave6-20260918',
  BATON_SWARM_BRIDGE_PARTICIPANT_ID: 'omp-424',
});

const SEAT_HOLDER = 'participant:swarm-wave6-20260918:omp-424';

test('S424-1: a run that only inherits the suite root acquires the verify lease — the root alone is no bypass', async (t) => {
  const root = leaseRoot(t);
  const authority = new HostCapacityAuthority({
    root, residentId: 's424-seat', observation: roomy, pollMs: 10,
  });
  const logged = [];
  const lease = await acquireSuiteVerifyLease({
    env: seatEnv(), authority, log: (line) => { logged.push(line); },
  });
  assert.equal(lease.disabled, false,
    'a seat-run suite is a verdict like any other: it admits through the host authority');
  assert.equal(lease.nested, false, 'the suite root alone no longer names a nested runner');
  assert.ok(lease.token, 'the admitted run holds a real lease token');
  assert.equal(leaseCount(root), 1, 'the lease record is visible on the shared authority');
  assert.deepEqual(logged, [], 'an admitted run prints no queue row');
  assert.equal(await lease.release(), true, 'the verdict releases its lease');
  assert.equal(leaseCount(root), 0, 'and leaves no record behind');
});

test('S424-2: the nested bypass needs the parent\'s lease token — the digest the parent itself derives', async (t) => {
  const root = leaseRoot(t);
  const untouched = join(root, 'never-created');
  const authority = new HostCapacityAuthority({
    root, residentId: 's424-parent', observation: roomy, pollMs: 10,
  });
  const parent = await acquireSuiteVerifyLease({ env: {}, authority, log: () => {} });
  const digest = suiteLeaseTokenDigest(parent.token);
  assert.match(digest, /^[a-f0-9]{64}$/u, 'a held lease hands its child one token digest');
  assert.equal(suiteLeaseNested({ [SUITE_VERIFY_LEASE_ENV]: digest }), true,
    'the parent\'s own token digest nests the runner it spawns');
  assert.equal(suiteLeaseNested({ BATON_TEST_SUITE_ROOT: '/tmp/x' }), false,
    'the suite root alone never nests');
  assert.equal(suiteLeaseNested({ [SUITE_VERIFY_LEASE_ENV]: 'not-a-digest' }), false,
    'a stray value is not a token digest');
  assert.equal(
    suiteLeaseNested({ [SUITE_VERIFY_LEASE_ENV]: createHash('sha256').update('forged').digest('hex') }),
    true,
    'a well-formed digest reads as nested: the proof is the parent\'s environment',
  );
  assert.equal(await parent.release(), true);

  const child = await acquireSuiteVerifyLease({
    env: { ...seatEnv(), [SUITE_VERIFY_LEASE_ENV]: digest, BATON_HOST_CAPACITY_ROOT: untouched },
    log: () => { throw new Error('a nested run prints no queue row'); },
  });
  assert.equal(child.disabled, true);
  assert.equal(child.nested, true, 'the child under a lease-holding parent stays unwired');
  assert.equal(await child.release(), false, 'a nested run releases nothing');
  assert.equal(existsSync(untouched), false, 'and touches no lease directory');
  assert.equal(leaseCount(root), 0, 'the parent released its own lease');
});

test('S424-3: the seat\'s suite lease is held under the seat\'s participant holder', async (t) => {
  const root = leaseRoot(t);
  const authority = new HostCapacityAuthority({
    root, residentId: 's424-seat', observation: roomy, pollMs: 10,
  });
  assert.equal(suiteLeaseHolder(seatEnv()), SEAT_HOLDER,
    'the worker env the runtime projects names the seat, so its verdict enqueues under it');
  assert.equal(suiteLeaseHolder({}), `run-suite:${process.pid}`,
    'a runner outside a swarm keeps the runner holder');
  assert.equal(suiteLeaseHolder({ BATON_SWARM_BRIDGE_SWARM_ID: 'swarm-wave6-20260918' }), `run-suite:${process.pid}`,
    'half an identity is no identity');
  const lease = await acquireSuiteVerifyLease({ env: seatEnv(), authority, log: () => {} });
  assert.deepEqual(await authority.observeParticipantVerify(SEAT_HOLDER),
    { state: 'admitted', position: null, ahead: null },
    '#333\'s participant row shows the seat\'s running verdict');
  assert.equal(await authority.observeParticipantVerify('participant:swarm-wave6-20260918:omp-428'), null,
    'a peer seat\'s row stays absent');
  assert.equal(await lease.release(), true);
  assert.equal(leaseCount(root), 0);
});

test('S424-4: the lane width derives from the host\'s current load, not from cores and memory alone', () => {
  // 10 cores, 16 GiB, plenty free: cores and memory alone would fund 9 lanes.
  const loaded = (load1m) => ({ cores: 10, totalBytes: 16 * G, freeBytes: 12 * G, load1m });
  assert.equal(defaultSuiteParallelism(loaded(0)), 9, 'an idle host funds the full derivation');
  assert.equal(defaultSuiteParallelism(loaded(1.5)), 9, 'a merely busy host is not saturated');
  assert.equal(defaultSuiteParallelism(loaded(10)), 1, 'a host at its own core count gets ONE lane');
  assert.equal(defaultSuiteParallelism(loaded(58)), 1, 'a host far past it stays at one lane');
});

test('S424-5: the runner prints the expanded selection count and the resolved lane width before any lane starts', async (t) => {
  assert.equal(formatSuitePlan({ expanded: 3, changedPaths: 1, parallel: 3, serial: 0, parallelism: 3, idleMs: 600_000 }),
    'baton test runner: plan — 3 file(s) expanded from 1 changed path(s): 3 in the parallel lane (x3), 0 in the serial lane; progress deadline 600000 ms per file');
  assert.equal(formatSuitePlan({ expanded: 300, changedPaths: 0, parallel: 291, serial: 9, parallelism: 9, idleMs: 600_000 }),
    'baton test runner: plan — 300 file(s) in the whole suite: 291 in the parallel lane (x9), 9 in the serial lane; progress deadline 600000 ms per file');

  // A staged authority with a full verdict budget: the runner admits nothing, so whatever it
  // decides (refuse before lanes, or degrade visibly) happens AFTER the plan line — the ordering
  // is read off one stream, and the queue row is evidence admission has started.
  const root = leaseRoot(t);
  const blocker = blockVerifyBudget(root, t);
  const parent = mkdtempSync(join(tmpdir(), 'baton-s424-tmp-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const env = {
    ...process.env, BATON_HOST_CAPACITY_ROOT: root,
    BATON_HOST_CAPACITY_POLL_MS: '25', BATON_SUITE_PARALLELISM: '3', BATON_TEST_TMP_PARENT: parent,
  };
  // This test itself runs as a suite child; the runner it spawns is a top-level one.
  delete env.BATON_TEST_SUITE_ROOT;
  delete env[SUITE_VERIFY_LEASE_ENV];
  delete env.BATON_HOST_CAPACITY_DISABLED;
  const child = spawn(process.execPath, [RUNNER, '--changed', 'impl/test/suite-verdict.test.mjs'], {
    cwd: IMPL, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolveClose) => {
    child.once('error', (error) => resolveClose({ code: null, error }));
    child.once('close', (code) => resolveClose({ code, error: null }));
  });
  // #541: admission never refuses. A host that can fund a suite queues behind the blocker and
  // prints the queued row; a host that cannot fund one degrades at once. Either row is
  // admission's own, and it follows the plan line. Once it shows, the blocker is released so a
  // queued run is admitted and finishes.
  const admissionRow = /host capacity queued this verify request at position|proceeding WITHOUT a host verify lease/u;
  while (!admissionRow.test(stderr)) {
    await new Promise((resolveWait) => { setTimeout(resolveWait, 25); });
  }
  rmSync(join(root, 'leases', `lease-verify-${blocker.nonce}.json`), { force: true });
  const terminal = await done;
  assert.equal(terminal.error, null);
  assert.match(stderr,
    /^baton test runner: plan — 1 file\(s\) expanded from 1 changed path\(s\): 1 in the parallel lane \(x3\), 0 in the serial lane; progress deadline \d+ ms per file$/mu,
    'the plan line prints the expanded file count and the lane width the run resolved');
  const planIndex = stderr.search(/^baton test runner: plan —/mu);
  const admittedIndex = stderr.search(admissionRow);
  assert.ok(planIndex !== -1 && planIndex < admittedIndex,
    'the plan line precedes admission, so it precedes any lane');
  assert.equal(terminal.code, 0, 'the run was admitted (or degraded) and finished — never refused');
}, { timeout: 120_000 });

// The staged-authority blocker #333's suite uses: one live verify lease fills the whole verdict
// budget on any machine, so a runner that honours the authority cannot admit beside it.
function blockVerifyBudget(root, t) {
  const nonce = createHash('sha256').update(`${process.pid}:${root}`).digest('hex').slice(0, 32);
  const record = {
    schemaVersion: 1, kind: 'verify', holder: 's424-blocker', nonce, pid: process.pid,
    residentId: 's424-blocker', acquiredAt: new Date().toISOString(),
  };
  mkdirSync(join(root, 'leases'), { recursive: true, mode: 0o700 });
  const path = join(root, 'leases', `lease-verify-${nonce}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  t.after(() => rmSync(path, { force: true }));
  return record;
}
