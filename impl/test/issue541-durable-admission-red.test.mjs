// Issue #541: the recruit/suite/integrate verbs are durable intents, not synchronous RPC —
// red-first acceptance for the removal of every bounded wait on those paths.
//
// Two hard stops in the banned class (#258/#261/#262/#530/#492) go:
//   1. the host-capacity gate's bounded queue wait, the load threshold as an admission gate,
//      and the terminal `host_capacity_queue_timeout` refusal — admission orders under load
//      and admits when capacity frees, never refused for being early;
//   2. the CLI's 30 s command bound (`commandTimeoutMs`, `BATON_COMMAND_TIMEOUT_MS`,
//      `web.wait_ceiling_ms`) and the `cli_command_pending` answer — the CLI answers the
//      receipt when the resident answers; transport liveness stays, completion caps go.
//
// RED-FIRST: every row FAILS at HEAD. The pins ride expected-red-tests.json (reason #541)
// until the removal lands.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { HostCapacityAuthority } from '../src/host-capacity.mjs';
import { acquireSuiteVerifyLease } from '../scripts/suite-host-lease.mjs';

const G = 1024 * 1024 * 1024;
const SRC = (p) => new URL(p, import.meta.url);
const srcText = (p) => readFileSync(SRC(p), 'utf8');

function leaseRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'issue541-lease-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('R1: a worker admits under a saturated host — load no longer gates admission', async (t) => {
  const root = leaseRoot(t);
  const authority = new HostCapacityAuthority({
    root, residentId: 'resident-541',
    observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 166 }),
    pollMs: 15, waitMs: 300,
  });
  const outcome = await authority.acquire('worker', { holder: 'p-541' });
  assert.ok(outcome.token, 'a worker is a durable intent: it admits in order, never refused for a full load average');
  await authority.release(outcome.token);
});

test('R2: a verify behind a held budget admits when the budget frees — no wait bound refuses it', async (t) => {
  const root = leaseRoot(t);
  const observation = () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 1 });
  const holder = new HostCapacityAuthority({
    root, residentId: 'resident-hold', observation, pollMs: 15, waitMs: 60_000,
  });
  const held = await holder.acquire('verify', { holder: 'check-held' });
  const authority = new HostCapacityAuthority({
    root, residentId: 'resident-541', observation, pollMs: 15, waitMs: 200,
  });
  setTimeout(() => { void holder.release(held.token); }, 400);
  const outcome = await authority.acquire('verify', { holder: 'check-541' });
  assert.ok(outcome.token, 'the queued intent drains in order whenever the budget frees, however long that takes');
  await authority.release(outcome.token);
});

test('R3: the admission gate and the suite lease carry no wait constant and no timeout refusal', () => {
  const gate = srcText('../src/host-capacity.mjs');
  assert.ok(!gate.includes('DEFAULT_ADMISSION_WAIT_MS'), 'the authority default wait constant is removed');
  assert.ok(!gate.includes('host_capacity_queue_timeout'), 'the terminal queue-timeout refusal is removed');
  const suite = srcText('../scripts/suite-host-lease.mjs');
  assert.ok(!suite.includes('DEFAULT_SUITE_LEASE_WAIT_MS'), 'the suite 2 s wait constant is removed');
  assert.ok(!suite.includes('BATON_HOST_CAPACITY_WAIT_MS'), 'the operator wait pin is removed');
  const runner = srcText('../scripts/run-suite.mjs');
  assert.ok(!runner.includes('host_capacity_queue_timeout'), 'the runner never judges a queue timeout');
});

test('R4: a standing memory shortfall proceeds degraded at once, without a queue entry', async (t) => {
  const root = leaseRoot(t);
  const authority = new HostCapacityAuthority({
    root, residentId: 'resident-541',
    observation: () => ({ cores: 4, totalBytes: 8 * G, freeBytes: 1 * G, load1m: 1 }),
    pollMs: 15, waitMs: 250,
  });
  const started = Date.now();
  const outcome = await acquireSuiteVerifyLease({
    authority, env: {}, holder: 'run-suite-541',
  });
  assert.equal(outcome.degraded, true, 'a limit no wait could cure degrades immediately — waiting is not admission');
  assert.ok(Date.now() - started < 1000, 'the degraded decision never spends a queue wait');
  assert.equal((await authority.observe()).queue.length, 0, 'the degraded run never enters the host queue');
});

test('R5: the 30 s command vocabulary is gone from the CLI, deployment and registry', () => {
  const baton = srcText('../scripts/baton.mjs');
  assert.ok(!baton.includes('BATON_COMMAND_TIMEOUT_MS'), 'the CLI no longer sends a command completion bound');
  const cli = srcText('../src/application-cli.mjs');
  assert.ok(!cli.includes('cli_command_pending'), 'the pending answer is removed — the CLI waits for the resident');
  assert.ok(!cli.includes('requestBoundElapsed'), 'the request-bound marker is removed with its cap');
  const deployment = srcText('../src/application-deployment.mjs');
  assert.ok(!deployment.includes('commandTimeoutMs ?? 30_000'), 'the resident client default 30 s bound is removed');
  const limits = srcText('../src/limits.mjs');
  assert.ok(!limits.includes('WEB_WAIT_CEILING'), 'the web wait ceiling row and its name are removed');
  for (const name of ['web-northbound.mjs', 'local-web-transport.mjs', 'surface-cli.mjs',
    'production-cli-convergence.mjs', 'production-mcp-convergence.mjs']) {
    assert.ok(!srcText(`../src/${name}`).includes('WEB_WAIT_CEILING_ROW'), `${name} no longer reads the ceiling row`);
  }
});

test('R6: a client without a command bound answers when the resident answers', async () => {
  const { BatonWebClient } = await import('../src/application-cli.mjs');
  let answered = false;
  const fetchImpl = async () => {
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    answered = true;
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ status: 'final', result: { runId: 'run-541', status: 'working' } }),
    };
  };
  const web = new BatonWebClient({
    baseUrl: 'https://resident.baton.test', origin: 'https://resident.baton.test',
    repoId: 'repo-541', token: 'private-bearer',
    pollMs: 10, clock: Date.now, sleep: async () => {},
    fetchImpl,
  });
  const result = await web.command('run.status', { runId: 'run-541' }, 'operation-key-541');
  assert.equal(answered, true, 'the fetch was never aborted by a completion cap');
  assert.deepEqual(result, { runId: 'run-541', status: 'working' }, 'the CLI answers the receipt when the resident answers');
});

test('R7: a wait above the retired ceiling is a legal request', async () => {
  const northbound = srcText('../src/web-northbound.mjs');
  assert.ok(!northbound.includes('webWaitCeilingRefusalCode'), 'the ceiling refusal code derivation has no consumer');
  const convergence = srcText('../src/production-cli-convergence.mjs');
  assert.ok(!convergence.includes('WEB_WAIT_CEILING_ROW'), 'the CLI convergence no longer caps a wait at the ceiling');
});
