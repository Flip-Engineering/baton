import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore, FixedWindowQuota, WebEdgePolicy, WebNorthbound, WebSessionStore, createAuthenticatedWebServer, resolveEdgeRequest } from '../src/index.mjs';

const ORIGIN = 'https://control.test';
const root = () => mkdtempSync(join(tmpdir(), 'baton-web-edge-'));
class Response { writeHead(status, headers) { this.status = status; this.headers = headers; } end(body = '') { this.body = body ? JSON.parse(body) : null; } }
class StreamResponse extends EventEmitter { constructor() { super(); this.output = ''; this.writableLength = 0; } writeHead(status, headers) { this.status = status; this.headers = headers; } write(value) { this.output += value; return true; } end() { this.ended = true; } }
async function request(web, { path, body, headers = {}, encrypted = true, address = '127.0.0.1', method = 'POST' }) {
  const req = new EventEmitter(); Object.assign(req, { method, url: path, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, socket: { encrypted, remoteAddress: address }, destroy() {} });
  const res = new Response(); const pending = web.handle(req, res); queueMicrotask(() => { if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); }); await pending; return res;
}
function edge(overrides = {}) { return new WebEdgePolicy({ addressKey: 'test-address-key-material', now: () => 1_000, ...overrides }); }
function system({ edgePolicy = edge(), identityProvider, readinessChecks, stream } = {}) {
  const sessions = new WebSessionStore(root(), { now: () => 1_000 }); const coordination = new CoordinationStore(root()); const fleetCalls = [];
  const coordinator = new Proxy({}, { get: (_target, key) => (...args) => { fleetCalls.push({ key, args }); return []; } });
  const web = new WebNorthbound({ coordinator, coordination, sessions, identityProvider, edge: edgePolicy, stream, readinessChecks, allowedOrigins: [ORIGIN], repoIds: ['repo-a'], now: () => 1_000 });
  return { web, sessions, coordination, fleetCalls };
}

test('EP1/EP4: untrusted forwarding is ignored; trusted proxy selects a bounded exact hop and HTTPS signal', () => {
  const direct = resolveEdgeRequest({ socket: { remoteAddress: '203.0.113.9', encrypted: true }, headers: { 'x-forwarded-for': '198.51.100.1', 'x-forwarded-proto': 'http' } }, { trustedProxies: ['192.0.2.1'] });
  assert.deepEqual(direct, { address: '203.0.113.9', transport: 'https', proxied: false });
  const proxied = resolveEdgeRequest({ socket: { remoteAddress: '192.0.2.1', encrypted: false }, headers: { 'x-forwarded-for': '198.51.100.2, 192.0.2.9', 'x-forwarded-proto': 'https' } }, { trustedProxies: ['192.0.2.1'], forwardedHop: 1, requireForwardedHttps: true });
  assert.deepEqual(proxied, { address: '198.51.100.2', transport: 'https', proxied: true });
  const standard = resolveEdgeRequest({ socket: { remoteAddress: '192.0.2.1', encrypted: false }, headers: { forwarded: 'for=198.51.100.2;proto=https, for=192.0.2.9;proto=https' } }, { trustedProxies: ['192.0.2.1'], forwardedHop: 1, requireForwardedHttps: true });
  assert.deepEqual(standard, { address: '198.51.100.2', transport: 'https', proxied: true });
  const directPolicy = edge();
  assert.deepEqual(directPolicy.resolve({ socket: { remoteAddress: '192.0.2.1', encrypted: false }, headers: { 'x-forwarded-for': '198.51.100.2', 'x-forwarded-proto': 'https' } }), { address: '192.0.2.1', transport: 'http', proxied: false });
  assert.throws(() => edge({ trustedProxies: ['192.0.2.1'], proxyMode: false }), /direct mode/);
  const ipv6 = resolveEdgeRequest({ socket: { remoteAddress: '2001:db8::ff', encrypted: false }, headers: { forwarded: 'for="[2001:db8::1]";proto=https' } }, { trustedProxies: ['2001:db8::ff'], requireForwardedHttps: true });
  assert.equal(ipv6.address, '2001:db8::1');
  assert.throws(() => resolveEdgeRequest({ socket: { remoteAddress: '2001:db8::ff' }, headers: { forwarded: 'for="[2001:db8::1]:443";proto=https' } }, { trustedProxies: ['2001:db8::ff'] }), /invalid forwarding/);
  assert.equal(resolveEdgeRequest({ socket: { remoteAddress: '::ffff:127.0.0.1', encrypted: true }, headers: {} }, { trustedProxies: ['127.0.0.1'] }).proxied, false, 'mapped and unmapped addresses are intentionally exact, not aliases');
  assert.throws(() => resolveEdgeRequest({ socket: { remoteAddress: '192.0.2.1' }, headers: { forwarded: 'for=1.2.3.4', 'x-forwarded-for': '1.2.3.4' } }, { trustedProxies: ['192.0.2.1'] }), /mixed forwarding/);
});

test('EP2: quota windows expire deterministically and key cardinality remains bounded', () => {
  let now = 0; const quota = new FixedWindowQuota({ limit: 3, windowMs: 1_000, maxKeys: 1, now: () => now });
  assert.equal(quota.take('a', 2).ok, true); assert.equal(quota.take('a', 2).ok, false);
  assert.equal(quota.take('b').reason, 'capacity'); assert.equal(quota.size, 1);
  now = 1_001; assert.equal(quota.take('b', 3).ok, true); assert.equal(quota.size, 1);
});

test('EP2/EP7: edge configuration is closed and direct/proxy postures cannot be mixed', () => {
  assert.throws(() => edge({ limits: { invented: 1 } }), /unknown quota policy/);
  assert.throws(() => edge({ proxyMode: true }), /trusted proxies/);
  assert.throws(() => edge({ forwardedHop: 1 }), /direct mode/);
});

test('EP3: login address quota refuses before a second provider call or session/fleet mutation', async () => {
  let providerCalls = 0; const s = system({
    edgePolicy: edge({ limits: { login: 1 } }),
    identityProvider: async () => { providerCalls += 1; return null; },
  });
  assert.equal((await request(s.web, { path: '/v1/auth/login', body: {} })).status, 401);
  const refused = await request(s.web, { path: '/v1/auth/login', body: { large: 'still bounded' } });
  assert.equal(refused.status, 429); assert.equal(refused.headers['retry-after'], '59');
  assert.equal(providerCalls, 1); assert.equal(s.sessions.events().length, 0); assert.deepEqual(s.fleetCalls, []);
  const audit = s.coordination.events().find((event) => event.payload?.kind === 'quota_refused');
  assert.match(audit.payload.addressDigest, /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(audit).includes('127.0.0.1'), false);
});

test('EP3/EP4: a trusted cleartext backend uses forwarded HTTPS while an untrusted peer cannot', async () => {
  const policy = edge({ proxyMode: true, trustedProxies: ['192.0.2.1'] }); let providerCalls = 0;
  const s = system({ edgePolicy: policy, identityProvider: async () => { providerCalls += 1; return { userId: 'u', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }; } });
  const headers = { 'x-forwarded-for': '198.51.100.8', 'x-forwarded-proto': 'https' };
  assert.equal((await request(s.web, { path: '/v1/auth/login', body: {}, headers, encrypted: false, address: '192.0.2.1' })).status, 201);
  assert.equal((await request(s.web, { path: '/v1/auth/login', body: {}, headers, encrypted: false, address: '203.0.113.9' })).status, 503);
  assert.equal(providerCalls, 1);
});

test('EP3: authenticated principal and weighted cost quotas refuse before durable command admission', async () => {
  const policy = edge({ limits: { principal: 1, cost: 1 } }); const s = system({ edgePolicy: policy });
  const issued = s.sessions.issue({ userId: 'u', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }, { actor: 'provider' });
  const envelope = (id) => ({ schemaVersion: 1, commandId: id, idempotencyKey: id, command: 'list', args: {}, repoId: 'repo-a', origin: ORIGIN });
  const ctx = { principal: s.sessions.authenticate({ headers: { authorization: `Bearer ${issued.token}` } }), origin: ORIGIN, transport: 'https' };
  assert.equal((await s.web.execute(ctx, envelope('one'))).status, 200);
  assert.equal((await s.web.execute(ctx, envelope('two'))).status, 429);
  assert.equal(s.coordination.events().filter((event) => event.kind === 'web.command_admitted').length, 1);
  assert.equal(s.fleetCalls.filter((call) => call.key === 'list').length, 1);
});

test('EP2/EP3: weighted refusal does not consume the separate command-count bucket', () => {
  const policy = edge({ limits: { principal: 1, cost: 1 } });
  assert.equal(policy.takeCommand('credential', 2).quota, 'cost');
  assert.equal(policy.takeCommand('credential', 1).ok, true);
});

test('EP5/EP6: readiness is non-disclosing and shutdown is bounded/idempotent with no fleet effect', async () => {
  let ready = true; let streamStops = 0; let serverCloses = 0;
  const stream = { shutdown() { streamStops += 1; } };
  const s = system({ stream, readinessChecks: [() => ready] });
  let response = await request(s.web, { method: 'GET', path: '/readyz' });
  assert.equal(response.status, 200); assert.deepEqual(response.body, { ready: true });
  ready = false; response = await request(s.web, { method: 'GET', path: '/readyz' });
  assert.equal(response.status, 503); assert.deepEqual(response.body, { ready: false });
  assert.equal(s.coordination.events().filter((event) => event.payload?.kind === 'readiness_transition').length, 2);
  const server = { close(cb) { serverCloses += 1; cb(); } };
  const first = s.web.shutdown({ server, drainMs: 50 }); const second = s.web.shutdown({ server, drainMs: 50 });
  await Promise.all([first, second]);
  assert.equal(streamStops, 1); assert.equal(serverCloses, 1); assert.deepEqual(s.fleetCalls, []);
  assert.equal((await request(s.web, { path: '/v1/auth/login', body: {} })).status, 503);
});

test('EP5: readiness fails closed when session health or durable audit probing is unavailable', async () => {
  const s = system();
  s.sessions.healthCheck = () => false;
  assert.equal((await request(s.web, { method: 'GET', path: '/readyz' })).status, 503);
  s.sessions.healthCheck = () => true;
  s.coordination.recordWebAudit = () => { throw new Error('audit unavailable'); };
  const refused = await request(s.web, { method: 'GET', path: '/readyz' });
  assert.equal(refused.status, 503); assert.deepEqual(refused.body, { ready: false });
});

test('EP6/EP7: drain deadline forces connections and never reports completion before listener closure', async () => {
  const s = system(); let callback; let forced = 0;
  const server = { close(cb) { callback = cb; }, closeIdleConnections() {}, closeAllConnections() { forced += 1; callback(); } };
  const outcome = await s.web.shutdown({ server, drainMs: 5 });
  assert.deepEqual(outcome, { ok: true, result: 'closed' }); assert.equal(forced, 1);
  const terminal = s.coordination.events().filter((event) => ['shutdown_completed', 'shutdown_timed_out'].includes(event.payload?.kind));
  assert.equal(terminal.length, 1); assert.equal(terminal[0].payload.kind, 'shutdown_completed');
});

test('EP4/EP5: health has an independent quota and never consumes the ordinary address bucket', async () => {
  const s = system({ edgePolicy: edge({ limits: { health: 1, address: 1 } }) });
  assert.equal((await request(s.web, { method: 'GET', path: '/healthz' })).status, 200);
  assert.equal((await request(s.web, { method: 'GET', path: '/healthz' })).status, 429);
  assert.equal((await request(s.web, { path: '/v1/auth/login', body: {} })).status, 401);
});

test('EP2/EP6: per-credential connection leases are fair, preserve refused tickets, and release exactly once', () => {
  const s = system({ edgePolicy: edge({ limits: { connection: 1 } }) });
  const issue = (user) => {
    const token = s.sessions.issue({ userId: user, authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 }, { actor: 'provider' });
    return s.sessions.authenticate({ headers: { authorization: `Bearer ${token.token}` } });
  };
  const a = issue('a'); const b = issue('b');
  const ticketA1 = s.web.stream.issue(a, ORIGIN, 'repo-a'); const ticketA2 = s.web.stream.issue(a, ORIGIN, 'repo-a'); const ticketB = s.web.stream.issue(b, ORIGIN, 'repo-a');
  const outA = new StreamResponse(); assert.equal(s.web.stream.open({ ticket: ticketA1.body.ticket, principal: a, origin: ORIGIN }, outA), null);
  const refused = s.web.stream.open({ ticket: ticketA2.body.ticket, principal: a, origin: ORIGIN }, new StreamResponse());
  assert.equal(refused.status, 429); assert.equal(refused.headers['retry-after'], '1');
  const outB = new StreamResponse(); assert.equal(s.web.stream.open({ ticket: ticketB.body.ticket, principal: b, origin: ORIGIN }, outB), null);
  outA.emit('close');
  const retried = new StreamResponse(); assert.equal(s.web.stream.open({ ticket: ticketA2.body.ticket, principal: a, origin: ORIGIN }, retried), null);
  outB.emit('close'); retried.emit('close');
  assert.equal(s.web.stream.activeConnections, 0);
});

test('EP6: shutdown wins races with provider completion and permanently refuses future stream opens', async () => {
  let release; const provider = new Promise((resolve) => { release = resolve; });
  const s = system({ identityProvider: async () => provider });
  const pending = request(s.web, { path: '/v1/auth/login', body: {} });
  await new Promise((resolve) => setImmediate(resolve));
  const shutdown = s.web.shutdown({ server: { close(cb) { cb(); } }, drainMs: 50 });
  release({ userId: 'u', authMethod: 'bearer', capabilities: ['observe'], repoIds: ['repo-a'], ttlMs: 60_000 });
  assert.equal((await pending).status, 503); assert.equal(s.sessions.events().length, 0); await shutdown;
  const principal = { userId: 'u', sessionId: 's', credentialId: 'c', expiresAt: '2099-01-01T00:00:00.000Z', capabilities: ['observe'], repoIds: ['repo-a'] };
  assert.equal(s.web.stream.open({ ticket: 'never', principal, origin: ORIGIN }, new StreamResponse()).status, 503);
});

test('EP4/EP6: server assembly permits cleartext only behind explicit trusted proxy policy and exposes bounded shutdown', () => {
  const trusted = system({ edgePolicy: edge({ proxyMode: true, trustedProxies: ['127.0.0.1'] }) });
  const server = createAuthenticatedWebServer(trusted.web, { proxy: { cleartextBackend: true } });
  assert.equal(typeof server.batonShutdown, 'function');
  const direct = system({ edgePolicy: edge() });
  assert.throws(() => createAuthenticatedWebServer(direct.web, { proxy: { cleartextBackend: true } }), /trusted-proxy edge policy/);
});
