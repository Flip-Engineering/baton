// Issue #512: a runner whose host-wide verify lease is refused at admission must end with a
// terminal row naming the stage it stopped at, the refusal's typed code, the dimension its
// admission wait was spent on (with the numbers the authority reported), and the fact that no
// lane ran and no verdict was produced.
//
// Under load the runner printed four chatter lines and exited 1, which a caller reads exactly
// like a suite that ran and found failures. The refusal itself is correct (#333: a spent wait
// refuses before any lane unless the dimension names a limit no wait could cure); what was
// missing was the terminal fact.
//
// Red-before: S512-1 fails at HEAD because formatSuiteAdmissionRefusal does not exist (the
// module is imported as a namespace so this file still loads); S512-2 and S512-3 fail when the
// staged runner refuses, because HEAD prints only the authority's own message
// (`baton test runner: <message>`) and exits 1 — the stage, the code and the missing verdict are
// nowhere on stderr.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import * as suiteLease from '../scripts/suite-host-lease.mjs';
import { deriveHostCapacity, hostCapacityObservation } from '../src/host-capacity.mjs';

const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');
// The lane fixture: small, self-contained, green. The refusal rows must never need a lane, so
// nothing here depends on what it asserts; S512-3's degraded branch is the one run that
// executes it.
const FIXTURE = 'test/usd.test.mjs';
// The terminal row's own prefix: what a caller greps for as the last word on the run.
const REFUSAL_ROW = 'baton test runner: refused at admission';

function refusalRows(stderr) {
  return stderr.split('\n').filter((line) => line.startsWith(REFUSAL_ROW));
}

function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** One live verify lease for a holder this test process owns: it fills the verdict budget, so a
 * runner that admits through the authority queues behind it on any host (the #333 staging). */
function blockVerifyBudget(root, t) {
  const nonce = randomBytes(16).toString('hex');
  const record = {
    schemaVersion: 1, kind: 'verify', holder: 's512-blocker', nonce, pid: process.pid,
    residentId: 's512-blocker', acquiredAt: new Date().toISOString(),
  };
  mkdirSync(join(root, 'leases'), { recursive: true, mode: 0o700 });
  const path = join(root, 'leases', `lease-verify-${nonce}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  t.after(() => rmSync(path, { force: true }));
  return record;
}

/** The environment a staged runner needs. Ambient suite markers are dropped: the bypass
 * (BATON_HOST_CAPACITY_DISABLED) would admit the child without touching the authority at all,
 * its parent's token digest (BATON_SUITE_VERIFY_LEASE) would nest it unwired (#424), and an
 * inherited wait/poll pin would replace the one this test stages. */
function stagedEnv(root, extra = {}) {
  const env = { ...process.env };
  delete env.BATON_HOST_CAPACITY_DISABLED;
  delete env.BATON_TEST_SUITE_ROOT;
  delete env[suiteLease.SUITE_VERIFY_LEASE_ENV];
  delete env.BATON_HOST_CAPACITY_WAIT_MS;
  delete env.BATON_HOST_CAPACITY_POLL_MS;
  return { ...env, BATON_HOST_CAPACITY_ROOT: root, ...extra };
}

function runRunner({ file, env }) {
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

test('S512-1: the admission refusal row names the stage, the code, the waiting dimension and the missing verdict', () => {
  assert.equal(typeof suiteLease.formatSuiteAdmissionRefusal, 'function',
    'the runner\'s refusal row is one exported formatter beside the queued row');
  // A synthetic refusal: since #541 admission never refuses for waiting, the formatter's input
  // is a genuine authority failure that still carries a shortfall row.
  const waited = Object.assign(new Error('host capacity lease directory is unavailable'), {
    code: 'host_capacity_unavailable',
    queuePosition: 1, queueAhead: 0, leaseKind: 'verify',
    shortfall: { dimension: 'load', observed: 11, required: 10, unit: 'load1m' },
  });
  const row = suiteLease.formatSuiteAdmissionRefusal(waited);
  assert.equal(row, 'baton test runner: refused at admission (host_capacity_unavailable)'
    + ' — waiting on load: 11 load1m observed, 10 required; no lane ran and no verdict was produced');
  assert.equal(row.split('\n').length, 1, 'the refusal is ONE terminal row');
  assert.match(row, /refused at admission \(host_capacity_unavailable\)/u,
    'the row names the stage and the refusal\'s typed code');
  assert.match(row, /waiting on load: 11 load1m observed, 10 required/u,
    'the row carries the dimension and the numbers the admission wait was spent on');
  assert.match(row, /no lane ran and no verdict was produced/u,
    'the row says the run produced no verdict, so a refusal cannot read as a result');

  // A refusal the authority could not measure carries no dimension, and the row invents none.
  const unavailable = Object.assign(new Error('host capacity lease root is not a confined directory'),
    { code: 'host_capacity_unavailable' });
  const bare = suiteLease.formatSuiteAdmissionRefusal(unavailable);
  assert.match(bare, /refused at admission \(host_capacity_unavailable\)/u);
  assert.doesNotMatch(bare, /waiting on/u, 'no dimension was observed, so none is named');
  assert.match(bare, /no lane ran and no verdict was produced/u);

  // An error with no typed code is named by what it has, never by a code it does not carry.
  assert.match(suiteLease.formatSuiteAdmissionRefusal(new TypeError('bad argument')),
    /refused at admission \(TypeError\)/u);
});

test('S512-2: a runner refused at admission exits 1 with one terminal row and no lane output', async (t) => {
  const root = scratch(t, 'baton-s512-unusable-');
  // The staged host: BATON_HOST_CAPACITY_ROOT is a regular file, so the authority cannot prepare
  // its lease root and refuses every admission with host_capacity_unavailable — a refusal the
  // spent-wait decision answers `refuse` (never the memory degrade) on any host.
  writeFileSync(join(root, 'not-a-directory'), 'not a capacity root\n');
  const { done } = runRunner({
    file: FIXTURE,
    env: stagedEnv(join(root, 'not-a-directory'), { BATON_TEST_TMP_PARENT: root }),
  });
  const terminal = await done;
  assert.equal(terminal.signal, null);
  assert.equal(terminal.code, 1, 'a refused admission exits 1');
  assert.match(terminal.stderr, /host capacity lease root is not a confined directory/u,
    'the authority\'s own refusal message stays printed');
  const rows = refusalRows(terminal.stderr);
  assert.equal(rows.length, 1, `exactly one terminal refusal row: ${terminal.stderr}`);
  assert.match(rows[0], /refused at admission \(host_capacity_unavailable\)/u,
    'the terminal row names the stage and the code');
  assert.match(rows[0], /no lane ran and no verdict was produced/u,
    'the terminal row states that the run produced no verdict');
  assert.doesNotMatch(rows[0], /waiting on/u, 'no dimension was observed, so none is named');
  assert.doesNotMatch(terminal.stdout, /^# file /mu, 'no lane started: admission refuses pre-effect');
}, { timeout: 120_000 });

test('S512-3: a run behind another verify lease waits and runs once it releases — never refused for waiting (#541, #561)', async (t) => {
  const root = scratch(t, 'baton-s512-queue-');
  const blocker = blockVerifyBudget(root, t);
  const { done, stderrSoFar } = runRunner({
    file: FIXTURE,
    env: stagedEnv(root, { BATON_HOST_CAPACITY_POLL_MS: '25', BATON_TEST_TMP_PARENT: root, BATON_SUITE_PARALLELISM: '1' }),
  });
  const queuedRow = /host capacity queued this verify request at position 1 \(0 ahead\)/u;
  while (!queuedRow.test(stderrSoFar())) {
    await new Promise((resolveWait) => { setTimeout(resolveWait, 25); });
  }
  assert.match(stderrSoFar(), /waiting on (budget|memory): /u,
    '#561: the row names the dimension it waits on — the observed headroom on a memory-tight host, the budget beside a live verdict');
  rmSync(join(root, 'leases', `lease-verify-${blocker.nonce}.json`), { force: true });
  const terminal = await done;
  assert.equal(terminal.signal, null);
  assert.equal(terminal.code, 0, 'the run proceeded once admitted, never refused');
  assert.equal(refusalRows(terminal.stderr).length, 0, 'no refusal row: nothing was refused for waiting');
  assert.doesNotMatch(terminal.stderr, /admission wait is spent|host_capacity_queue_timeout/u);
  assert.match(terminal.stdout, /^# file /mu, 'the run ran its lane');
  assert.doesNotMatch(terminal.stderr, /proceeding WITHOUT a host verify lease/u,
    '#561 removed the degrade-and-proceed shape');
}, { timeout: 120_000 });
