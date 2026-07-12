import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, OidcBrowserFlow, WebNorthbound, WebSessionStore } from '../src/index.mjs';

const NOW = Date.parse('2026-07-11T17:00:00.000Z');
const ORIGIN = 'https://control.test';
const CALLBACK = `${ORIGIN}/v1/auth/oidc/callback`;
const ISSUER = 'https://identity.test';
const CLIENT_ID = 'baton-browser';
const root = (name) => mkdtempSync(join(tmpdir(), `baton-${name}-`));

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.body = body ? JSON.parse(body) : null; }
}

async function request(web, path, headers = {}, ResponseClass = Response) {
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'GET', url: path,
    headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', ...headers },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' },
    destroy() {},
  });
  const res = new ResponseClass();
  await web.handle(req, res);
  return res;
}

function flow(overrides = {}) {
  return new OidcBrowserFlow({
    authorizationEndpoint: `${ISSUER}/authorize`, issuer: ISSUER, clientId: CLIENT_ID,
    redirectUri: CALLBACK, scopes: ['openid', 'profile'], now: () => NOW,
    completeAuthorization: async ({ expectedNonce }) => ({
      issuer: ISSUER, audience: CLIENT_ID, subject: 'subject-1', nonce: expectedNonce,
      claims: { role: 'operator' },
    }),
    mapClaims: () => ({ userId: 'oidc-user', capabilities: ['observe', 'control'], repoIds: ['repo-a'], ttlMs: 60_000 }),
    ...overrides,
  });
}

function system(overrides = {}) {
  const sessions = new WebSessionStore(root('oidc-sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(root('oidc-coordination'));
  const fleetCalls = [];
  const web = new WebNorthbound({
    coordinator: new Proxy({}, { get: (_target, key) => () => { fleetCalls.push(key); return []; } }),
    coordination, sessions, oidc: overrides.oidc ?? flow(), repoIds: ['repo-a'],
    allowedOrigins: [ORIGIN], now: () => NOW, ...overrides,
  });
  return { web, sessions, coordination, fleetCalls };
}

function flowCookie(headers) {
  const value = headers['set-cookie'];
  const rows = Array.isArray(value) ? value : [value];
  return rows.find((row) => row.startsWith('__Host-baton_oidc='))?.split(';')[0];
}

function callbackFrom(start, code = 'code-1') {
  const authorization = new URL(start.headers.location);
  return `/v1/auth/oidc/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(authorization.searchParams.get('state'))}`;
}

test('BO1: start creates exact bounded Authorization Code + PKCE parameters', () => {
  const oidc = flow();
  const started = oidc.begin();
  const url = new URL(started.location);
  assert.equal(url.origin + url.pathname, `${ISSUER}/authorize`);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), CALLBACK);
  assert.equal(url.searchParams.get('scope'), 'openid profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(url.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(url.searchParams.get('nonce'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(started.setCookie, /^__Host-baton_oidc=.*; Max-Age=300; Secure; HttpOnly; SameSite=Lax; Path=\/v1\/auth\/oidc\/callback$/);
  assert.equal(started.location.includes('code_verifier'), false);
  started.rollback();
});

test('BO1/BO5: invalid configuration and bounded pending capacity fail closed', () => {
  for (const field of [
    { authorizationEndpoint: 'http://identity.test/authorize' },
    { authorizationEndpoint: `${ISSUER}/authorize?client=forged` },
    { redirectUri: `${CALLBACK}?x=1` },
    { scopes: ['profile'] },
    { maxPending: 0 },
    { providerTimeoutMs: 0 },
  ]) assert.throws(() => flow(field), TypeError);
  const oidc = flow({ maxPending: 1 });
  oidc.begin();
  assert.throws(() => oidc.begin(), (error) => error?.code === 'flow_capacity');
});

test('BO1/BO3: active exchange capacity, provider timeout, and flow expiry remain bounded', async () => {
  let release;
  const pendingProvider = new Promise((resolveProvider) => { release = resolveProvider; });
  const oidc = flow({ maxPending: 1, completeAuthorization: async () => pendingProvider });
  const started = oidc.begin(); const state = new URL(started.location).searchParams.get('state');
  const completion = oidc.complete({ state, code: 'code', cookieHeader: started.setCookie.split(';')[0] });
  await new Promise((resolveTick) => setImmediate(resolveTick));
  assert.throws(() => oidc.begin(), (error) => error?.code === 'flow_capacity');
  release({ issuer: ISSUER, audience: CLIENT_ID, subject: 'sub', nonce: new URL(started.location).searchParams.get('nonce'), claims: {} });
  await completion;

  const timed = flow({ providerTimeoutMs: 10, maxPending: 1, completeAuthorization: async () => new Promise(() => {}) });
  const timedStart = timed.begin(); const timedState = new URL(timedStart.location).searchParams.get('state');
  await assert.rejects(() => timed.complete({ state: timedState, code: 'code', cookieHeader: timedStart.setCookie.split(';')[0] }), (error) => error?.code === 'provider_timeout');
  assert.throws(() => timed.begin(), (error) => error?.code === 'flow_capacity', 'a provider ignoring abort retains one bounded detached slot');

  let clock = NOW;
  const expiring = flow({ flowTtlMs: 1_000, now: () => clock, completeAuthorization: async (input) => {
    clock += 1_000;
    return { issuer: ISSUER, audience: CLIENT_ID, subject: 'sub', nonce: input.expectedNonce, claims: {} };
  } });
  const expiringStart = expiring.begin(); const expiringState = new URL(expiringStart.location).searchParams.get('state');
  await assert.rejects(() => expiring.complete({ state: expiringState, code: 'code', cookieHeader: expiringStart.setCookie.split(';')[0] }), (error) => error?.code === 'invalid_flow');
});

test('BO2/BO3: callback binds cookie/state, verifies PKCE/issuer/audience/nonce, and is one-time', async () => {
  let exchange; let mapped;
  const oidc = flow({
    completeAuthorization: async (input) => {
      exchange = input;
      return { issuer: ISSUER, audience: [CLIENT_ID, 'other'], subject: 'sub', nonce: input.expectedNonce, claims: { email: 'u@example.test' } };
    },
    mapClaims: (verified) => { mapped = verified; return { userId: 'u', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 30_000 }; },
  });
  const started = oidc.begin();
  const state = new URL(started.location).searchParams.get('state');
  const completed = await oidc.complete({ state, code: 'code-1', cookieHeader: started.setCookie.split(';')[0] });
  assert.match(exchange.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(exchange.redirectUri, CALLBACK); assert.equal(exchange.clientId, CLIENT_ID);
  assert.equal(mapped.subject, 'sub'); assert.equal(mapped.claims.email, 'u@example.test');
  assert.deepEqual(completed, { userId: 'u', authMethod: 'cookie', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 30_000 });
  await assert.rejects(() => oidc.complete({ state, code: 'code-1', cookieHeader: started.setCookie.split(';')[0] }), (error) => error?.code === 'invalid_flow');
});

test('BO2/BO3: wrong browser binding and invalid verified identity consume no provider/session authority', async () => {
  let calls = 0;
  const bound = flow({ completeAuthorization: async () => { calls += 1; return {}; } });
  const boundStart = bound.begin(); const boundState = new URL(boundStart.location).searchParams.get('state');
  await assert.rejects(() => bound.complete({ state: boundState, code: 'code', cookieHeader: '__Host-baton_oidc=wrong' }));
  assert.equal(calls, 0);
  await assert.rejects(() => bound.complete({ state: boundState, code: 'code', cookieHeader: boundStart.setCookie.split(';')[0] }));
  assert.equal(calls, 0, 'wrong-cookie attempt consumes the one-time flow before provider work');

  for (const providerResult of [
    { issuer: 'https://evil.test', audience: CLIENT_ID, subject: 'sub', nonce: 'nonce', claims: {} },
    { issuer: ISSUER, audience: 'other-client', subject: 'sub', nonce: 'nonce', claims: {} },
  ]) {
    const oidc = flow({ completeAuthorization: async (input) => { calls += 1; return { ...providerResult, nonce: providerResult.nonce === 'nonce' ? input.expectedNonce : providerResult.nonce }; } });
    const started = oidc.begin(); const state = new URL(started.location).searchParams.get('state');
    await assert.rejects(() => oidc.complete({ state, code: 'code', cookieHeader: started.setCookie.split(';')[0] }));
  }
  assert.equal(calls, 2);
});

test('BO4/BO5: real start/callback routes issue existing session and redirect to a clean fixed URL', async () => {
  let exchange;
  const s = system({ oidc: flow({ completeAuthorization: async (input) => { exchange = input; return { issuer: ISSUER, audience: CLIENT_ID, subject: 'sub', nonce: input.expectedNonce, claims: {} }; } }) });
  const start = await request(s.web, '/v1/auth/oidc/start', { 'sec-fetch-site': 'same-origin' });
  assert.equal(start.status, 302); assert.equal(new URL(start.headers.location).origin, ISSUER);
  const callback = await request(s.web, callbackFrom(start), { cookie: flowCookie(start.headers), 'sec-fetch-site': 'cross-site' });
  assert.equal(callback.status, 303); assert.equal(callback.headers.location, '/control');
  assert.equal(callback.headers['cache-control'], 'no-store'); assert.equal(callback.headers['referrer-policy'], 'no-referrer');
  const cookies = callback.headers['set-cookie'];
  assert.ok(Array.isArray(cookies));
  assert.ok(cookies.some((row) => /^__Host-baton_session=.*HttpOnly; SameSite=Strict/.test(row)));
  assert.ok(cookies.some((row) => /^__Host-baton_csrf=.*SameSite=Strict/.test(row) && !row.includes('HttpOnly')));
  assert.ok(cookies.some((row) => /^__Host-baton_oidc=; Max-Age=0/.test(row)));
  assert.equal(exchange.code, 'code-1');
  assert.equal(s.sessions.events().filter((event) => event.kind === 'session.issued').length, 1);
  assert.deepEqual(s.fleetCalls, []);
  assert.equal(JSON.stringify(s.coordination.events()).includes('code-1'), false);
});

test('BO1/BO4: WebNorthbound refuses an OIDC callback origin/path it does not serve', () => {
  assert.throws(() => system({ oidc: flow({ redirectUri: 'https://other.test/v1/auth/oidc/callback' }) }), /redirectUri/);
  assert.throws(() => system({ oidc: flow({ redirectUri: `${ORIGIN}/different-callback` }) }), /redirectUri/);
});

test('BO2/BO4: callback replay, malformed query, and audit failure issue no additional session', async () => {
  const s = system();
  const start = await request(s.web, '/v1/auth/oidc/start', { 'sec-fetch-site': 'none' });
  const path = callbackFrom(start); const cookie = flowCookie(start.headers);
  assert.equal((await request(s.web, `${path}&state=duplicate`, { cookie, 'sec-fetch-site': 'cross-site' })).status, 400);
  assert.equal(s.sessions.events().length, 0);

  const next = await request(s.web, '/v1/auth/oidc/start', { 'sec-fetch-site': 'same-origin' });
  const nextPath = callbackFrom(next); const nextCookie = flowCookie(next.headers);
  const original = s.coordination.recordWebAudit.bind(s.coordination);
  s.coordination.recordWebAudit = () => { throw new Error('audit unavailable'); };
  assert.equal((await request(s.web, nextPath, { cookie: nextCookie, 'sec-fetch-site': 'cross-site' })).status, 503);
  assert.equal(s.sessions.events().length, 0);
  s.coordination.recordWebAudit = original;
  assert.notEqual((await request(s.web, nextPath, { cookie: nextCookie, 'sec-fetch-site': 'cross-site' })).status, 303);
});

test('BO4: synchronous callback delivery failure revokes the exact issued session', async () => {
  class ThrowingResponse extends Response { writeHead() { throw new Error('socket closed'); } }
  const s = system();
  const start = await request(s.web, '/v1/auth/oidc/start', { 'sec-fetch-site': 'same-origin' });
  await assert.rejects(() => request(s.web, callbackFrom(start), { cookie: flowCookie(start.headers), 'sec-fetch-site': 'cross-site' }, ThrowingResponse), /socket closed/);
  const events = s.sessions.events();
  assert.equal(events.filter((event) => event.kind === 'session.issued').length, 1);
  assert.equal(events.filter((event) => event.kind === 'session.revoked').length, 1);
});
