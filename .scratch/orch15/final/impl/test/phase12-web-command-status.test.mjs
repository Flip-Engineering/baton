import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, WebNorthbound, WebSessionStore, operatorAsset } from '../src/index.mjs';

const NOW = Date.parse('2026-07-11T19:00:00.000Z');
const ORIGIN = 'https://control.test';
const root = (name) => mkdtempSync(join(tmpdir(), `baton-${name}-`));
class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
async function get(web, path, cookie) {
  const req = new EventEmitter();
  Object.assign(req, { method: 'GET', url: path, headers: { cookie, 'sec-fetch-site': 'same-origin' }, socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {} });
  const res = new Response(); await web.handle(req, res); return res;
}
function setup(directory = root('command-status')) {
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const calls = [];
  const coordinator = { list() { calls.push('list'); return []; } };
  const web = new WebNorthbound({ coordinator, coordination, sessions, repoIds: ['repo-a'], allowedOrigins: [ORIGIN], now: () => NOW });
  const issue = (userId = 'user-a', capabilities = ['observe']) => sessions.issue({ userId, authMethod: 'cookie', capabilities, repoIds: ['repo-a'], ttlMs: 60_000 }, { actor: 'test' });
  return { directory, sessions, coordination, calls, web, issue };
}
const cookie = (issued) => `__Host-baton_session=${issued.token}`;
function admit(s, principal, commandId = 'command-1') {
  return s.coordination.admitWebCommand({
    commandId, scopeKey: `scope-${commandId}`, requestDigest: `digest-${commandId}`,
    command: 'spawn', repoId: 'repo-a', runId: null, userId: principal.userId,
    sessionId: principal.sessionId, credentialId: principal.credentialId,
    origin: ORIGIN, expectedFence: null,
  }, { actor: `web:${principal.userId}:${principal.sessionId}`, key: `admit-${commandId}` });
}

test('RC1/RC2/RC3: admitted and terminal status are sanitized and read-only', async () => {
  const s = setup(); const issued = s.issue();
  const principal = s.sessions.authenticate({ headers: { cookie: cookie(issued) } });
  admit(s, principal);
  const admitted = await get(s.web, '/v1/commands/command-1', cookie(issued));
  assert.deepEqual(admitted.body, { ok: true, command: { commandId: 'command-1', command: 'spawn', repoId: 'repo-a', runId: null, expectedFence: null, status: 'admitted', admittedAt: new Date(NOW).toISOString(), completedAt: null, outcome: null } });
  assert.deepEqual(s.calls, []);
  for (const secret of ['userId', 'sessionId', 'credentialId', 'scopeKey', 'requestDigest', 'origin']) assert.equal(admitted.rawBody.includes(secret), false);
  s.coordination.completeWebCommand('command-1', { httpStatus: 200, body: { ok: true, result: { id: 'w-1' } } }, { actor: 'test', key: 'complete-1' });
  const completed = await get(s.web, '/v1/commands/command-1', cookie(issued));
  assert.equal(completed.body.command.status, 'completed'); assert.equal(completed.body.command.outcome.httpStatus, 200);
  assert.deepEqual(s.calls, []);
});

test('RC1/RC2: status survives restart and credential rotation for the same user', async () => {
  const s = setup(); const issued = s.issue(); const principal = s.sessions.authenticate({ headers: { cookie: cookie(issued) } });
  admit(s, principal); const rotated = s.sessions.rotate(principal.sessionId, { actor: 'test' });
  s.coordination.releaseWriterLease();
  const restarted = setup(s.directory);
  const response = await get(restarted.web, '/v1/commands/command-1', cookie(rotated));
  assert.equal(response.status, 200); assert.equal(response.body.command.status, 'admitted');
});

test('RC2/RC4: other-user, unowned, unknown, and malformed commands share not-found', async () => {
  const s = setup(); const owner = s.issue('owner'); const ownerPrincipal = s.sessions.authenticate({ headers: { cookie: cookie(owner) } });
  admit(s, ownerPrincipal);
  const other = s.issue('other');
  s.coordination.admitWebCommand({ commandId: 'legacy', scopeKey: 'legacy-scope', requestDigest: 'legacy-digest', command: 'list', repoId: 'repo-a', runId: null, credentialId: 'legacy', origin: ORIGIN, expectedFence: null }, { actor: 'test', key: 'legacy' });
  for (const path of ['/v1/commands/command-1', '/v1/commands/legacy', '/v1/commands/unknown', '/v1/commands/bad%2Fsegment', `/v1/commands/${'x'.repeat(129)}`]) {
    const response = await get(s.web, path, cookie(other));
    assert.equal(response.status, 404, path); assert.equal(response.body.error.code, 'not_found');
  }
  assert.deepEqual(s.calls, []);
});

test('RC2/RC3: missing observe and audit failure return no command status', async () => {
  const s = setup(); const owner = s.issue('owner'); const principal = s.sessions.authenticate({ headers: { cookie: cookie(owner) } }); admit(s, principal);
  const noObserve = s.issue('owner', ['control']);
  assert.equal((await get(s.web, '/v1/commands/command-1', cookie(noObserve))).status, 403);
  s.coordination.recordWebAudit = () => { throw new Error('audit unavailable'); };
  assert.equal((await get(s.web, '/v1/commands/command-1', cookie(owner))).status, 503);
  assert.deepEqual(s.calls, []);
});

test('RC4: new web command envelopes require bounded URL-safe command and idempotency IDs', async () => {
  const s = setup(); const issued = s.issue('owner', ['observe']); const principal = s.sessions.authenticate({ headers: { cookie: cookie(issued) } });
  const context = { principal, origin: ORIGIN, csrfToken: issued.csrfToken, transport: 'https' };
  for (const fields of [{ commandId: 'bad/id', idempotencyKey: 'ok' }, { commandId: 'ok', idempotencyKey: 'x'.repeat(257) }]) {
    const response = await s.web.execute(context, { schemaVersion: 1, command: 'list', args: {}, repoId: 'repo-a', origin: ORIGIN, ...fields });
    assert.equal(response.status, 400); assert.equal(response.body.error.code, 'invalid_command');
  }
  assert.equal(s.coordination.events().some((event) => event.kind === 'web.command_admitted'), false);
});

test('RC5: operator client reconciles the original command ID without issuing a replacement', () => {
  const script = operatorAsset('/control/app.js').body;
  assert.equal(script.includes('/v1/commands/'), true);
  assert.match(script, /commandId/);
  assert.equal(script.includes('idempotencyKey:crypto.randomUUID()'), false);
});
