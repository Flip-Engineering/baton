// Issue #541 sweep: the CLI's command bound is OPERATOR-DECLARED or none. Unset
// (BATON_COMMAND_TIMEOUT_MS unpinned, no advanced.commandTimeoutMs), the client waits for the
// deployment's answer — no wall clock cuts an admitted command off, and the #288
// cli_command_pending receipt exists only for callers who declared a bound. The server's own
// wait policies (run.inspect's continuation wait, a follow's leg bound) answer on their own.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BatonWebClient } from '../src/application-cli.mjs';

const ORIGIN = 'https://resident.baton.test';

const client = (overrides = {}) => new BatonWebClient({
  baseUrl: ORIGIN, origin: ORIGIN, repoId: 'repo-a', token: 'private-bearer',
  commandTimeoutMs: null, pollMs: 10,
  fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' }),
  clock: Date.now, sleep: async () => {},
  ...overrides,
});

const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });

test('541-w1: a null command bound is a valid client — the operator simply declared none', () => {
  const c = client();
  assert.equal(c.commandTimeoutMs, null);
  assert.equal(c.requestTimeoutMs, null);
  assert.equal(c._requestTimeoutForCommand('swarm.view', {}), null,
    'no bound to stretch over a server wait either');
  assert.equal(c._requestTimeoutForCommand('run.wait', { timeoutMs: 60_000 }), null);
});

test('541-w2: a DECLARED bound keeps its old laws — positive integer, pollMs inside it, stretch over server waits', () => {
  const c = client({ commandTimeoutMs: 1_000 });
  assert.equal(c.commandTimeoutMs, 1_000);
  assert.ok(c._requestTimeoutForCommand('run.wait', { timeoutMs: 60_000 }) > 60_000,
    'a declared bound still stretches over the server-owned wait plus slack');
  for (const bad of [0, -1, 1.5]) {
    assert.throws(() => client({ commandTimeoutMs: bad }), /client_configuration_invalid|config/u,
      `a declared bound must still be a positive integer (${bad})`);
  }
  assert.throws(() => client({ commandTimeoutMs: 100, pollMs: 200 }),
    /client_configuration_invalid|config/u, 'pollMs must sit inside a declared bound');
  assert.doesNotThrow(() => client({ pollMs: 500_000 }),
    'with no declared bound there is nothing for pollMs to exceed');
});

test('541-w3: an unbounded request arms no abort — a slow deployment answer arrives whole', async () => {
  let sawSignal = null;
  const c = client({
    fetchImpl: async (url, options = {}) => {
      sawSignal = options.signal ?? null;
      await new Promise((resolve) => setTimeout(resolve, 120));
      return json({ answered: true });
    },
  });
  const body = await c._json('/v1/slow-probe');
  assert.deepEqual(body, { answered: true },
    'the answer crosses however long the deployment took — no request-bound abort fired');
  assert.ok(sawSignal, 'the fetch still carries a signal for the caller own stop');
  assert.equal(sawSignal.aborted, false);
});

test('541-w4: reconcile with no declared bound waits a command out past any old default', async () => {
  let now = 0;
  let polls = 0;
  const c = client({
    clock: () => now,
    sleep: async (ms) => { now += ms; },
    fetchImpl: async (url) => {
      polls += 1;
      // Ten minutes of polls at pollMs=10 would have thrown the old 90s default's
      // cli_command_pending long before this settles.
      if (polls < 50) return json({ command: { status: 'admitted' } });
      return json({ command: { status: 'settled', outcome: { httpStatus: 200, body: { result: { landed: true } } } } });
    },
  });
  const result = await c.reconcile('cmd-541');
  assert.deepEqual(result, { landed: true },
    'the command settles whenever the deployment finishes it — no wall clock refused the wait');
  assert.equal(polls, 50);
  assert.ok(now >= 490, `the fake clock advanced through the waits (now=${now})`);
});

test('541-w5: a DECLARED bound still ends in the #288 pending receipt with its observation route', async () => {
  let now = 0;
  const c = client({
    commandTimeoutMs: 1_000,
    clock: () => now,
    sleep: async (ms) => { now += ms; },
    fetchImpl: async () => json({ command: { status: 'admitted' } }),
  });
  const error = await c.reconcile('cmd-541b', { name: 'swarm.view' }).then(() => null, (thrown) => thrown);
  assert.equal(error?.code, 'cli_command_pending',
    'a caller who declared a bound still gets the receipt, never silence');
  assert.equal(error?.detail?.commandId, 'cmd-541b');
  assert.ok(error?.detail?.observe, 'the receipt names the observation route');
});
