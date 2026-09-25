// Issue #393 (audit-20260918 consolidated report item C14; umbrella #382): BatonWebClient.session
// pinned the exact key set of the resident's /v1/session answer, so ONE additive field on a newer
// resident broke every CLI session with `invalid authenticated session` while the same client
// already read the limits handshake additively. The fix validates the required fields by their own
// shape checks and lets additive fields ride past.
//
// R1 is the red-first row: at HEAD it fails with cli_protocol_failed on a body that carries one
// extra top-level field and one extra identity field. R2-R4 are the pins that guard the validation
// the fix must NOT drop (a required field is still required, and an expired session still refuses).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BatonWebClient } from '../src/application-cli.mjs';

const FUTURE = '2030-01-01T00:00:00.000Z';

function clientServing(t, body) {
  const calls = [];
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: 'https://baton.local', repoId: 'repo-x', token: 't',
    commandTimeoutMs: 30_000, pollMs: 250, clock: () => 0, sleep: () => Promise.resolve(),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, calls };
}

function sessionBody({ identity = {}, topLevel = {} } = {}) {
  return {
    ok: true,
    expiresAt: FUTURE,
    identity: { userId: 'user-1', sessionId: 'session-1', capabilities: ['observe'], repoIds: ['repo-x'], ...identity },
    ...topLevel,
  };
}

test('R1 (#393 red-first): an additive field on the session answer and on its identity does not break the session read', async (t) => {
  const body = sessionBody({
    identity: { additiveIdentityField: { nested: true } },
    topLevel: { additiveTopLevelField: 'a newer resident published this' },
  });
  const { client, calls } = clientServing(t, body);
  const session = await client.session();
  assert.equal(session.identity.userId, 'user-1', 'the required identity fields survive the read');
  assert.equal(session.identity.sessionId, 'session-1');
  assert.deepEqual([...session.identity.capabilities], ['observe']);
  assert.deepEqual([...session.identity.repoIds], ['repo-x']);
  assert.equal(session.expiresAt, new Date(FUTURE).toISOString());
  assert.equal(Object.hasOwn(session, 'additiveTopLevelField'), false,
    'the returned projection is the client\'s own closed shape, so the additive field never crosses');
  assert.equal(Object.hasOwn(session.identity, 'additiveIdentityField'), false);
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), ['GET https://baton.local/v1/session']);
});

test('R2 (#393 pin): a session missing a required identity field still refuses typed', async (t) => {
  const { client } = clientServing(t, sessionBody({ identity: { userId: undefined } }));
  await assert.rejects(client.session(), (error) => {
    assert.equal(error.code, 'cli_protocol_failed');
    assert.match(error.message, /invalid authenticated session/u);
    return true;
  });
});

test('R3 (#393 pin): a session missing expiresAt still refuses typed', async (t) => {
  const body = sessionBody();
  delete body.expiresAt;
  const { client } = clientServing(t, body);
  await assert.rejects(client.session(), (error) => error?.code === 'cli_protocol_failed');
});

test('R4 (#393 pin): an expired session still refuses typed', async (t) => {
  const { client } = clientServing(t, sessionBody({ topLevel: {} }));
  const expired = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: 'https://baton.local', repoId: 'repo-x', token: 't',
    commandTimeoutMs: 30_000, pollMs: 250, clock: () => Date.parse('2031-01-01T00:00:00.000Z'),
    sleep: () => Promise.resolve(),
    fetchImpl: async () => new Response(JSON.stringify(sessionBody()), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
  assert.ok(client, 'the fixture client is the same construction');
  await assert.rejects(expired.session(), (error) => {
    assert.equal(error.code, 'cli_protocol_failed');
    assert.match(error.message, /invalid authenticated session/u);
    return true;
  });
});

test('R5 (#393 pin): a session that does not serve the connected repository still refuses', async (t) => {
  const { client } = clientServing(t, sessionBody({ identity: { repoIds: ['repo-other'] } }));
  await assert.rejects(client.session(), (error) => error?.code === 'cli_protocol_failed');
});
