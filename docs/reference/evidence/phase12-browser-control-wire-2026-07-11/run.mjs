#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CoordinationStore, OidcBrowserFlow, WebNorthbound, WebSessionStore } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = process.env.BATON_TEST_TLS_KEY;
const CERT_PATH = process.env.BATON_TEST_TLS_CERT;
if (!KEY_PATH || !CERT_PATH) throw new Error('BATON_TEST_TLS_KEY and BATON_TEST_TLS_CERT are required');
const ROOT = mkdtempSync(join(tmpdir(), 'baton-browser-wire-'));
const sessions = new WebSessionStore(join(ROOT, 'sessions'));
const coordination = new CoordinationStore(join(ROOT, 'coordination'));
const codes = new Map();
let web;

const server = createServer({ key: readFileSync(KEY_PATH), cert: readFileSync(CERT_PATH), minVersion: 'TLSv1.2' }, (req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname === '/fake-idp/authorize') {
    const code = randomUUID();
    codes.set(code, {
      nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge'),
      redirectUri: url.searchParams.get('redirect_uri'), state: url.searchParams.get('state'),
    });
    res.writeHead(302, {
      location: `${url.searchParams.get('redirect_uri')}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(url.searchParams.get('state'))}`,
      'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    });
    res.end();
    return;
  }
  web.handle(req, res);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
const origin = `https://127.0.0.1:${address.port}`;
const oidc = new OidcBrowserFlow({
  authorizationEndpoint: `${origin}/fake-idp/authorize`, issuer: `${origin}/fake-idp`,
  clientId: 'baton-browser-wire', redirectUri: `${origin}/v1/auth/oidc/callback`,
  completeAuthorization: async ({ code, codeVerifier, expectedNonce }) => {
    const row = codes.get(code); codes.delete(code);
    if (!row || row.nonce !== expectedNonce
      || createHash('sha256').update(codeVerifier).digest('base64url') !== row.challenge) throw new Error('fake provider refusal');
    return { issuer: `${origin}/fake-idp`, audience: 'baton-browser-wire', subject: 'wire-user', nonce: row.nonce, claims: { role: 'operator' } };
  },
  mapClaims: () => ({ userId: 'wire-user', capabilities: ['observe', 'control'], repoIds: ['repo-a'], ttlMs: 60_000 }),
});
const coordinator = {
  list: () => [], result: async () => ({}), wait: async () => ({}),
  spawn: async () => { throw new Error('not used'); }, send: async () => { throw new Error('not used'); },
  interrupt: async () => { throw new Error('not used'); }, kill: async () => { throw new Error('not used'); },
  respond: async () => { throw new Error('not used'); },
};
web = new WebNorthbound({ coordinator, coordination, sessions, oidc, repoIds: ['repo-a'], allowedOrigins: [origin] });

function request(path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const payload = body == null ? null : Buffer.from(body);
    const call = httpsRequest({
      hostname: '127.0.0.1', port: address.port, path, method, rejectUnauthorized: false,
      headers: { ...headers, ...(payload ? { 'content-length': payload.length } : {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolveRequest({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    call.once('error', rejectRequest);
    if (payload) call.write(payload);
    call.end();
  });
}

function cookiePair(rows, name) {
  const values = Array.isArray(rows) ? rows : [rows];
  return values.find((row) => row?.startsWith(`${name}=`))?.split(';')[0] ?? null;
}

function openSnapshot(path, headers) {
  return new Promise((resolveStream, rejectStream) => {
    const call = httpsRequest({ hostname: '127.0.0.1', port: address.port, path, method: 'GET', rejectUnauthorized: false, headers }, (res) => {
      let output = '';
      const timer = setTimeout(() => { call.destroy(); rejectStream(new Error('SSE snapshot timeout')); }, 5000);
      res.on('data', (chunk) => {
        output += chunk.toString('utf8');
        if (output.includes('event: snapshot')) {
          clearTimeout(timer); call.destroy(); resolveStream({ status: res.statusCode, output });
        }
      });
    });
    call.once('error', (error) => { if (error.code !== 'ECONNRESET') rejectStream(error); });
    call.end();
  });
}

const checks = {};
let details = {};
try {
  const start = await request('/v1/auth/oidc/start', { headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' } });
  const flowCookie = cookiePair(start.headers['set-cookie'], '__Host-baton_oidc');
  checks.startRedirect = start.status === 302 && start.headers.location?.startsWith(`${origin}/fake-idp/authorize`) && !!flowCookie;

  const provider = await request(new URL(start.headers.location).pathname + new URL(start.headers.location).search);
  checks.providerRedirect = provider.status === 302 && provider.headers.location?.startsWith(`${origin}/v1/auth/oidc/callback?`);

  const callbackUrl = new URL(provider.headers.location);
  const callback = await request(callbackUrl.pathname + callbackUrl.search, {
    headers: { cookie: flowCookie, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'same-origin' },
  });
  const sessionCookie = cookiePair(callback.headers['set-cookie'], '__Host-baton_session');
  const csrfCookie = cookiePair(callback.headers['set-cookie'], '__Host-baton_csrf');
  const cookies = `${sessionCookie}; ${csrfCookie}`;
  checks.callbackSession = callback.status === 303 && callback.headers.location === '/control' && !!sessionCookie && !!csrfCookie;

  const page = await request('/control', { headers: { cookie: cookies, 'sec-fetch-site': 'same-origin' } });
  checks.operatorPage = page.status === 200 && page.body.includes('Baton') && !page.body.includes(sessionCookie);

  const session = await request('/v1/session', { headers: { cookie: cookies, 'sec-fetch-site': 'same-origin' } });
  const identity = JSON.parse(session.body);
  checks.sessionProjection = session.status === 200 && identity.identity?.userId === 'wire-user' && !session.body.includes('credentialId');

  const csrf = csrfCookie.split('=')[1];
  const command = await request('/v1/commands', {
    method: 'POST', headers: { cookie: cookies, origin, 'content-type': 'application/json', 'x-baton-csrf': csrf },
    body: JSON.stringify({ schemaVersion: 1, commandId: 'wire-list-1', idempotencyKey: 'wire-list-1', command: 'list', args: {}, repoId: 'repo-a', origin }),
  });
  checks.command = command.status === 200 && Array.isArray(JSON.parse(command.body).result);

  const ticket = await request('/v1/stream-tickets', {
    method: 'POST', headers: { cookie: cookies, origin, 'content-type': 'application/json', 'x-baton-csrf': csrf },
    body: JSON.stringify({ repoId: 'repo-a' }),
  });
  const ticketBody = JSON.parse(ticket.body);
  const snapshot = await openSnapshot(`/v1/events?ticket=${encodeURIComponent(ticketBody.ticket)}`, { cookie: cookies, origin });
  checks.stream = ticket.status === 201 && snapshot.status === 200 && snapshot.output.includes('event: snapshot');

  const logout = await request('/v1/auth/logout', {
    method: 'POST', headers: { cookie: cookies, origin, 'content-type': 'application/json', 'x-baton-csrf': csrf }, body: '{}',
  });
  const revoked = await request('/v1/session', { headers: { cookie: cookies, 'sec-fetch-site': 'same-origin' } });
  checks.logoutRevokes = logout.status === 200 && revoked.status === 401;
  details = { origin, auditEvents: coordination.events().length, sessionEvents: sessions.events().length };
} finally {
  await web.shutdown({ server, drainMs: 1000 }).catch(() => {});
  rmSync(ROOT, { recursive: true, force: true });
}

const summary = { at: new Date().toISOString(), checks, details, pass: Object.values(checks).every(Boolean) };
writeFileSync(join(HERE, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (!summary.pass) process.exitCode = 1;
