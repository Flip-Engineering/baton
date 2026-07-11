import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore, WebNorthbound, WebSessionStore } from '../src/index.mjs';

const root = () => mkdtempSync(join(tmpdir(), 'baton-web-auth-'));
const now = Date.parse('2026-07-11T12:00:00.000Z');
const request = (headers = {}, url = '/v1/commands') => ({ headers, url });

test('WN2/WN8: issued cookie credentials are random, hashed at rest, and use strict host-only attributes', () => {
  const directory = root();
  const sessions = new WebSessionStore(directory, { now: () => now });
  const issued = sessions.issue({
    userId: 'user-1', authMethod: 'cookie', capabilities: ['observe', 'control'], repoIds: ['repo-a'], ttlMs: 60_000,
  }, { actor: 'bootstrap' });
  assert.match(issued.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.match(issued.csrfToken, /^[A-Za-z0-9_-]{40,}$/);
  assert.match(issued.setCookie, /^__Host-baton_session=/);
  assert.match(issued.setCookie, /; Max-Age=60; Secure; HttpOnly; SameSite=Strict; Path=\/$/);
  assert.equal(issued.setCookie.includes('Domain='), false);
  const ledger = readFileSync(join(directory, 'sessions.jsonl'), 'utf8');
  assert.equal(ledger.includes(issued.token), false);
  assert.equal(ledger.includes(issued.csrfToken), false);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, 'sessions.jsonl')).mode & 0o777, 0o600);
});

test('WN2: cookie and bearer authentication return sanitized stable identity, never the raw credential', () => {
  const sessions = new WebSessionStore(root(), { now: () => now });
  const cookie = sessions.issue({ userId: 'cookie-user', authMethod: 'cookie', capabilities: ['control'], repoIds: ['repo-a'], ttlMs: 60_000 }, { actor: 'bootstrap' });
  const bearer = sessions.issue({ userId: 'bearer-user', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-b'], ttlMs: 60_000 }, { actor: 'bootstrap' });
  const cookiePrincipal = sessions.authenticate(request({ cookie: `x=1; __Host-baton_session=${cookie.token}; y=2` }));
  const bearerPrincipal = sessions.authenticate(request({ authorization: `Bearer ${bearer.token}` }));
  assert.equal(cookiePrincipal.userId, 'cookie-user');
  assert.equal(cookiePrincipal.authMethod, 'cookie');
  assert.equal(typeof cookiePrincipal.csrfTokenDigest, 'string');
  assert.equal(JSON.stringify(cookiePrincipal).includes(cookie.token), false);
  assert.equal(bearerPrincipal.userId, 'bearer-user');
  assert.equal(bearerPrincipal.authMethod, 'bearer');
  assert.equal(Object.hasOwn(bearerPrincipal, 'csrfTokenDigest'), false);
  assert.equal(sessions.authenticate(request({}, `/?access_token=${bearer.token}`)), null, 'URL credentials are never accepted');
});

test('WN2/WN7: revocation is immediate, audited, and survives restart', () => {
  const directory = root();
  const sessions = new WebSessionStore(directory, { now: () => now });
  const issued = sessions.issue({ userId: 'user-1', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }, { actor: 'bootstrap' });
  assert.ok(sessions.authenticate(request({ authorization: `Bearer ${issued.token}` })));
  const revoked = sessions.revoke(issued.sessionId, { actor: 'security-admin', reason: 'logout' });
  assert.equal(revoked.result, 'revoked');
  assert.equal(sessions.authenticate(request({ authorization: `Bearer ${issued.token}` })), null);
  const restarted = new WebSessionStore(directory, { now: () => now });
  assert.equal(restarted.authenticate(request({ authorization: `Bearer ${issued.token}` })), null);
  assert.equal(restarted.events().at(-1).kind, 'session.revoked');
});

test('WN2/WN5: expired, malformed, mixed, and overlong credentials fail closed', () => {
  let clock = now;
  const sessions = new WebSessionStore(root(), { now: () => clock, maxCredentialBytes: 128 });
  const issued = sessions.issue({ userId: 'user-1', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 1_000 }, { actor: 'bootstrap' });
  clock += 1_001;
  assert.equal(sessions.authenticate(request({ authorization: `Bearer ${issued.token}` })), null);
  for (const headers of [
    { authorization: 'Basic abc' },
    { authorization: 'Bearer' },
    { authorization: 'Bearer a b' },
    { authorization: `Bearer ${'x'.repeat(129)}` },
    { authorization: `Bearer ${issued.token}`, cookie: `__Host-baton_session=${issued.token}` },
  ]) assert.equal(sessions.authenticate(request(headers)), null);
});

test('WN2: duplicate revoke is idempotent and unknown sessions do not reveal existence', () => {
  const sessions = new WebSessionStore(root(), { now: () => now });
  const issued = sessions.issue({ userId: 'user-1', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 1_000 }, { actor: 'bootstrap' });
  assert.equal(sessions.revoke(issued.sessionId, { actor: 'admin' }).result, 'revoked');
  assert.equal(sessions.revoke(issued.sessionId, { actor: 'admin' }).result, 'not_active');
  assert.equal(sessions.revoke('not-real', { actor: 'admin' }).result, 'not_active');
});

test('WN2/WN5: the session registry protects the command northbound and revocation blocks the next command', async () => {
  const sessions = new WebSessionStore(root(), { now: () => now });
  const issued = sessions.issue({ userId: 'user-1', authMethod: 'cookie', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }, { actor: 'bootstrap' });
  const calls = [];
  const coordination = new CoordinationStore(root());
  const web = new WebNorthbound({
    coordinator: { list() { calls.push('list'); return []; } }, coordination,
    repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => now,
  });
  const command = (id) => ({ schemaVersion: 1, commandId: id, idempotencyKey: id, command: 'list', args: {}, repoId: 'repo-a', origin: 'https://control.example.test' });
  const req = request({ cookie: `__Host-baton_session=${issued.token}` });
  const principal = sessions.authenticate(req);
  const accepted = await web.execute({ principal, origin: 'https://control.example.test', csrfToken: issued.csrfToken, transport: 'https' }, command('before-revoke'));
  assert.equal(accepted.status, 200);
  sessions.revoke(issued.sessionId, { actor: 'admin', reason: 'logout' });
  const refused = await web.execute({ principal: sessions.authenticate(req), origin: 'https://control.example.test', csrfToken: issued.csrfToken, transport: 'https' }, command('after-revoke'));
  assert.equal(refused.status, 401);
  assert.deepEqual(calls, ['list']);
  assert.equal(JSON.stringify(coordination.events()).includes(issued.token), false);
  assert.equal(JSON.stringify(coordination.events()).includes(issued.csrfToken), false);
});

test('WN2/WN6: the session authenticator terminates an established stream after durable revocation', async () => {
  let clock = now;
  const sessions = new WebSessionStore(root(), { now: () => clock });
  const issued = sessions.issue({ userId: 'user-1', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }, { actor: 'bootstrap' });
  const authenticate = sessions.authenticator();
  const req = request({ authorization: `Bearer ${issued.token}` });
  const principal = authenticate(req);
  const coordination = new CoordinationStore(root());
  const web = new WebNorthbound({
    coordinator: { list() { return []; } }, coordination, authenticate,
    repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => clock,
    pollMs: 5, maxFrameBytes: 100_000, maxBufferedBytes: 100_000,
  });
  class Response extends EventEmitter {
    constructor() { super(); this.output = ''; this.writableLength = 0; }
    writeHead(status) { this.status = status; }
    write(value) { this.output += value; return true; }
    end() { this.ended = true; }
  }
  const response = new Response();
  const ticket = web.stream.issue(principal, 'https://control.example.test', 'repo-a');
  web.stream.open({ ticket: ticket.body.ticket, principal, origin: 'https://control.example.test' }, response);
  sessions.revoke(issued.sessionId, { actor: 'security-admin', reason: 'logout' });
  coordination.recordWebAudit({ kind: 'after-revocation-secret' }, { actor: 'test', key: 'after-revocation-secret' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(response.ended, true);
  assert.equal(web.stream.activeConnections, 0);
  assert.equal(response.output.includes('after-revocation-secret'), false);
  assert.equal(coordination.events().some((event) => event.payload.kind === 'stream_authorization_lost'), true);
});
