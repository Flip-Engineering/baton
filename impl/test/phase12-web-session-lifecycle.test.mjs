import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore, WebNorthbound, WebSessionStore } from '../src/index.mjs';

const now = Date.parse('2026-07-11T12:00:00.000Z');
const root = () => mkdtempSync(join(tmpdir(), 'baton-session-lifecycle-'));
const bearer = (value) => ({ headers: { authorization: `Bearer ${value}` } });
const ORIGIN = 'https://control.test';
class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.body = body ? JSON.parse(body) : null; }
}
async function request(web, path, body, headers = {}, encrypted = true, method = 'POST') {
  const req = new EventEmitter();
  Object.assign(req, { method, url: path, headers: { origin: ORIGIN, 'content-type': 'application/json; charset=utf-8', ...headers }, socket: { encrypted, remoteAddress: '127.0.0.1' }, destroy() {} });
  const res = new Response(); const pending = web.handle(req, res);
  queueMicrotask(() => { if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  await pending; return res;
}
function system(identityProvider, overrides = {}) {
  const directory = root(); const sessions = new WebSessionStore(directory, { now: () => now });
  const coordination = new CoordinationStore(root()); const fleetCalls = [];
  const web = new WebNorthbound({
    coordinator: new Proxy({}, { get: (_target, key) => () => { fleetCalls.push(key); return []; } }),
    coordination, sessions, identityProvider, repoIds: ['repo-a'], allowedOrigins: [ORIGIN], now: () => now,
    ...overrides,
  });
  return { web, sessions, coordination, fleetCalls };
}

test('IL2/IL4: rotation is one durable event, preserves claims, and never persists credentials', () => {
  const directory = root();
  const sessions = new WebSessionStore(directory, { now: () => now });
  const first = sessions.issue({
    userId: 'provider-user', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000,
  }, { actor: 'provider' });
  const before = sessions.events().length;
  const next = sessions.rotate(first.sessionId, { actor: 'web:provider-user' });
  assert.equal(sessions.events().length, before + 1);
  assert.equal(sessions.events().at(-1).kind, 'session.rotated');
  assert.equal(sessions.authenticate(bearer(first.token)), null);
  assert.deepEqual(sessions.authenticate(bearer(next.token)).capabilities, ['observe']);
  const durable = readFileSync(join(directory, 'sessions.jsonl'), 'utf8');
  assert.equal(durable.includes(first.token), false);
  assert.equal(durable.includes(next.token), false);
});

test('IL2/IL6: restart refuses a rotated predecessor and accepts only its successor', () => {
  const directory = root();
  const sessions = new WebSessionStore(directory, { now: () => now });
  const first = sessions.issue({
    userId: 'provider-user', authMethod: 'cookie', capabilities: ['control'], repoIds: ['repo-a'], ttlMs: 60_000,
  }, { actor: 'provider' });
  const next = sessions.rotate(first.sessionId, { actor: 'web:provider-user' });
  const restarted = new WebSessionStore(directory, { now: () => now });
  assert.equal(restarted.authenticate({ headers: { cookie: `__Host-baton_session=${first.token}` } }), null);
  assert.equal(restarted.authenticate({ headers: { cookie: `__Host-baton_session=${next.token}` } }).credentialId, next.credentialId);
  assert.equal(restarted.isPrincipalActive(sessions.authenticate({ headers: { cookie: `__Host-baton_session=${next.token}` } })), true);
});

test('IL2/IL5: failed rotation append returns no successor and leaves the predecessor active', () => {
  let fail = false;
  const sessions = new WebSessionStore(root(), {
    now: () => now,
    appendFile(path, value, options) {
      if (fail) throw new Error('disk unavailable');
      appendFileSync(path, value, options);
    },
  });
  const first = sessions.issue({
    userId: 'provider-user', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000,
  }, { actor: 'provider' });
  fail = true;
  assert.throws(() => sessions.rotate(first.sessionId, { actor: 'web:provider-user' }), /disk unavailable/);
  assert.ok(sessions.authenticate(bearer(first.token)));
  assert.equal(sessions.events().filter((event) => event.kind === 'session.rotated').length, 0);
});

test('IL1/IL3/IL4: HTTPS login uses only injected claims and returns a strict cookie without leaking credentials', async () => {
  let seen; const s = system(async (body, metadata) => {
    seen = { body, metadata };
    return { userId: 'provider-user', authMethod: 'cookie', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 };
  });
  const res = await request(s.web, '/v1/auth/login', { password: 'never-log-me', userId: 'forged', capabilities: ['emergency_stop'] });
  assert.equal(res.status, 201);
  assert.equal(res.body.identity.userId, 'provider-user');
  assert.deepEqual(res.body.identity.capabilities, ['observe']);
  assert.equal(Object.hasOwn(res.body, 'token'), false);
  assert.match(res.headers['set-cookie'], /^__Host-baton_session=.*; Secure; HttpOnly; SameSite=Strict; Path=\/$/);
  assert.equal(typeof res.body.csrfToken, 'string');
  assert.deepEqual(seen.metadata, { origin: ORIGIN, transport: 'https' });
  assert.equal(JSON.stringify(s.coordination.events()).includes('never-log-me'), false);
  assert.equal(JSON.stringify(s.sessions.events()).includes('never-log-me'), false);
  assert.deepEqual(s.fleetCalls, []);
});

test('IL2/IL3/IL6: cookie refresh requires CSRF, rotates atomically, and logout revokes without fleet control', async () => {
  const s = system(async () => ({ userId: 'u', authMethod: 'cookie', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }));
  const login = await request(s.web, '/v1/auth/login', {});
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.equal((await request(s.web, '/v1/auth/refresh', {}, { cookie })).status, 403);
  const refreshed = await request(s.web, '/v1/auth/refresh', {}, { cookie, 'x-baton-csrf': login.body.csrfToken });
  assert.equal(refreshed.status, 200);
  const nextCookie = refreshed.headers['set-cookie'].split(';')[0];
  assert.equal(s.sessions.authenticate({ headers: { cookie } }), null);
  const active = s.sessions.authenticate({ headers: { cookie: nextCookie } });
  assert.ok(active);
  const logout = await request(s.web, '/v1/auth/logout', {}, { cookie: nextCookie, 'x-baton-csrf': refreshed.body.csrfToken });
  assert.equal(logout.status, 200);
  assert.match(logout.headers['set-cookie'], /Max-Age=0/);
  assert.equal(s.sessions.isPrincipalActive(active), false);
  assert.deepEqual(s.fleetCalls, []);
});

test('IL3/IL5: lifecycle rejects insecure/wrong-origin requests before provider or session mutation and supports CORS preflight', async () => {
  let calls = 0; const s = system(async () => { calls += 1; return { userId: 'u', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }; });
  assert.equal((await request(s.web, '/v1/auth/login', {}, {}, false)).status, 503);
  assert.equal((await request(s.web, '/v1/auth/login', {}, { origin: 'https://evil.test' })).status, 403);
  assert.equal(calls, 0);
  assert.equal(s.sessions.events().length, 0);
  const preflight = await request(s.web, '/v1/auth/login', undefined, { 'access-control-request-method': 'POST' }, true, 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], ORIGIN);
});

test('IL4: bearer login and refresh return one-time JSON tokens while the predecessor immediately fails', async () => {
  const s = system(async () => ({ userId: 'api', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }));
  const login = await request(s.web, '/v1/auth/login', { opaque: 'provider-input' });
  assert.equal(login.status, 201); assert.equal(typeof login.body.token, 'string');
  const refreshed = await request(s.web, '/v1/auth/refresh', {}, { authorization: `Bearer ${login.body.token}` });
  assert.equal(refreshed.status, 200); assert.notEqual(refreshed.body.token, login.body.token);
  assert.equal(s.sessions.authenticate(bearer(login.body.token)), null);
  assert.ok(s.sessions.authenticate(bearer(refreshed.body.token)));
});

test('IL2/IL5: session append is file-synced before in-memory apply and credential return', () => {
  const operations = []; const directory = root();
  const sessions = new WebSessionStore(directory, {
    now: () => now,
    appendFile(path, value, options) { operations.push('append'); appendFileSync(path, value, options); },
    syncPath(path) { operations.push(path.endsWith('sessions.jsonl') ? 'sync-file' : 'sync-dir'); },
  });
  operations.length = 0;
  const issued = sessions.issue({ userId: 'u', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }, { actor: 'provider' });
  assert.deepEqual(operations, ['append', 'sync-file']);
  assert.ok(sessions.authenticate(bearer(issued.token)));
});

test('IL1/IL5: coordination audit failure occurs before login/refresh mutation and returns no credential', async () => {
  const s = system(async () => ({ userId: 'u', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }));
  const original = s.coordination.recordWebAudit.bind(s.coordination);
  s.coordination.recordWebAudit = () => { throw new Error('audit unavailable'); };
  const login = await request(s.web, '/v1/auth/login', {});
  assert.equal(login.status, 503); assert.equal(Object.hasOwn(login.body, 'token'), false); assert.equal(s.sessions.events().length, 0);
  s.coordination.recordWebAudit = original;
  const issued = s.sessions.issue({ userId: 'u', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }, { actor: 'provider' });
  s.coordination.recordWebAudit = () => { throw new Error('audit unavailable'); };
  const refresh = await request(s.web, '/v1/auth/refresh', {}, { authorization: `Bearer ${issued.token}` });
  assert.equal(refresh.status, 503); assert.equal(Object.hasOwn(refresh.body, 'token'), false);
  assert.ok(s.sessions.authenticate(bearer(issued.token)), 'predecessor remains active because audit failed before rotation');
});

test('IL1: provider output outside session policy is the same bounded refusal with no issuance', async () => {
  for (const claims of [
    { userId: 'bad user', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 },
    { userId: 'u', authMethod: 'bearer', capabilities: ['bad capability'], repoIds: ['repo-a'], ttlMs: 60_000 },
    { userId: 'u', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 86_400_001 },
  ]) {
    const s = system(async () => claims);
    const response = await request(s.web, '/v1/auth/login', {});
    assert.equal(response.status, 401); assert.equal(response.body.error.code, 'unauthenticated');
    assert.equal(s.sessions.events().length, 0); assert.deepEqual(s.fleetCalls, []);
  }
});
