// Issue #392 (audit-20260918 C13): the CLI's wait tables resolve the alias table the dispatch
// itself uses (`run watch` dispatches run_watch; `run.view` dispatches run.inspect), so a
// caller-named wait is read from the spelling that actually crosses the wire.
//
// #541: the client arms NO transport cut over a command that names a server wait — the resident's
// own bound ends the request — while a command that names no wait keeps the caller's declared
// command bound.

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

test('392-w1: the run.watch spelling reads the follow leg wait, which the resident answers', async () => {
  const c = client();
  const seen = [];
  c._json = async (url, options, timeoutMs) => { seen.push(timeoutMs); return settled(); };
  await c.command('run.watch', { runId: 'r-392', timeoutMs: 60_000 });
  assert.equal(seen[0], null,
    `the follow leg's own bound is the wait (saw ${seen[0]}; the declared command bound is 1_000 and must not cut it)`);
});

test('392-w2: the run.view spelling reads the run.inspect continuation wait the command names', async () => {
  const c = client();
  const seen = [];
  c._json = async (url, options, timeoutMs) => { seen.push(timeoutMs); return settled(); };
  await c.command('run.view', { runId: 'r-392', cursor: 0, waitMs: 30_000 });
  assert.equal(seen[0], null,
    `the named continuation wait is answered by the resident (saw ${seen[0]}; the declared command bound is 1_000)`);
  // No named continuation wait means the run.inspect spelling names no server wait at all, so the
  // caller's own declared command bound governs the request.
  await c.command('run.view', { runId: 'r-392', cursor: 0 });
  assert.equal(seen[1], 1_000);
});
