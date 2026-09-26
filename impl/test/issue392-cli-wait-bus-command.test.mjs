// Issue #392 (audit-20260918 C13): the CLI's command wait bound keys on the dispatched bus
// command at BOTH envelope sites. The dispatched spelling is the canonical operation key
// (`run watch` dispatches run_watch on the wire; the resident serves it under the run.follow
// wait policy), so the bound must resolve the alias table the dispatch itself uses and keep the
// serverWaitMs+slack stretch — a long-poll follow must not abort at the bare declared bound
// with a spurious transport refusal while the same command spelled run.follow keeps it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BatonWebClient } from '../src/application-cli.mjs';

const ORIGIN = 'https://resident.baton.test';

const client = (overrides = {}) => new BatonWebClient({
  baseUrl: ORIGIN, origin: ORIGIN, repoId: 'repo-a', token: 'private-bearer',
  commandTimeoutMs: 1_000, pollMs: 10,
  fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' }),
  clock: Date.now, sleep: async () => {},
  ...overrides,
});

const settled = () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ status: 'settled', outcome: { httpStatus: 200, body: { result: { landed: true } } } }) });

test('392-w1: the non-list envelope stretches the declared bound over the follow leg the run.watch spelling dispatches', async () => {
  const c = client();
  const seen = [];
  c._json = async (url, options, timeoutMs) => { seen.push(timeoutMs); return settled(); };
  await c.command('run.watch', { runId: 'r-392', timeoutMs: 60_000 });
  assert.ok(seen[0] >= 60_000 + 15_000,
    `the follow leg's server wait rides the bound (saw ${seen[0]}; the bare declared bound is 1_000)`);
});

test('392-w2: the run.view spelling keeps the continuation wait stretch the run.inspect key owns', async () => {
  const c = client();
  const seen = [];
  c._json = async (url, options, timeoutMs) => { seen.push(timeoutMs); return settled(); };
  await c.command('run.view', { runId: 'r-392', cursor: 0 });
  assert.ok(seen[0] >= 30_000 + 15_000,
    `the continuation wait rides the bound (saw ${seen[0]}; the bare declared bound is 1_000)`);
});
