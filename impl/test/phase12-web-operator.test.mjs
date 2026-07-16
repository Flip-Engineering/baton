import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, WebNorthbound, WebSessionStore } from '../src/index.mjs';

const NOW = Date.parse('2026-07-11T18:00:00.000Z');
const ORIGIN = 'https://control.test';
const root = (name) => mkdtempSync(join(tmpdir(), `baton-${name}-`));

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = headersJson(this.headers) ? JSON.parse(body) : body; }
}
const headersJson = (headers) => headers?.['content-type']?.startsWith('application/json');

async function get(web, path, headers = {}) {
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'GET', url: path, headers,
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response(); await web.handle(req, res); return res;
}

function system(claims = {}) {
  const sessions = new WebSessionStore(root('operator-sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(root('operator-coordination'));
  const fleetCalls = [];
  const application = {
    repoId: 'repo-a',
    card() {
      return {
        schemaVersion: 1, repoId: 'repo-a',
        commands: ['application.help', 'run.start', 'run.inspect', 'run.act', 'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.review', 'run.integrate', 'run.export', 'application.shutdown'],
        profiles: [{
          name: 'standard', digest: 'a'.repeat(64), routes: [{ harness: 'grok', model: 'grok-4-code', effort: 'high' }], pathScope: ['impl/**'],
          reviewPolicy: { mode: 'required', routes: [{ harness: 'reviewer', model: 'review-model', effort: 'low' }], reportPath: '.baton/review.json', maxFindings: 20, maxReportBytes: 65_536 },
          integrationPolicy: { mode: 'manual', strategies: ['ff-only'], requireAdoptedResult: true, requireSemanticReview: true },
          followPolicy: { mode: 'enabled', maxWaitMs: 25_000, maxChanges: 64, maxResponseBytes: 262_144, maxScanEvents: 1_024 },
        }],
      };
    },
    async authorizeReplay() { return true; },
    async command() { throw new Error('asset reads must not dispatch application commands'); },
  };
  const issued = sessions.issue({
    userId: claims.userId ?? 'operator', authMethod: 'cookie',
    capabilities: claims.capabilities ?? ['observe', 'control', 'approve', 'emergency_stop'],
    repoIds: claims.repoIds ?? ['repo-a'], ttlMs: 60_000,
  }, { actor: 'test' });
  const web = new WebNorthbound({
    coordinator: new Proxy({}, { get: (_target, key) => () => { fleetCalls.push(key); return []; } }),
    coordination, sessions, application, repoIds: ['repo-a'], allowedOrigins: [ORIGIN], now: () => NOW,
  });
  return { web, issued, sessions, coordination, fleetCalls };
}

const sessionCookie = (issued) => `__Host-baton_session=${issued.token}`;

test('BU1: operator assets require one active observe-capable repository session', async () => {
  const s = system();
  assert.equal((await get(s.web, '/control')).status, 401);
  for (const path of ['/control', '/control/app.js', '/control/app.css', '/v1/session', '/v1/application-card']) {
    const response = await get(s.web, path, { cookie: sessionCookie(s.issued), 'sec-fetch-site': 'same-origin' });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }
  const noObserve = system({ capabilities: ['control'] });
  assert.equal((await get(noObserve.web, '/control', { cookie: sessionCookie(noObserve.issued), 'sec-fetch-site': 'same-origin' })).status, 403);
  const wrongRepo = system({ repoIds: ['repo-b'] });
  assert.equal((await get(wrongRepo.web, '/control', { cookie: sessionCookie(wrongRepo.issued), 'sec-fetch-site': 'same-origin' })).status, 403);
  assert.deepEqual(s.fleetCalls, []);
});

test('BU1/BU2: HTML and session projection are CSP-bound and sanitized', async () => {
  const s = system(); const headers = { cookie: sessionCookie(s.issued), 'sec-fetch-site': 'same-origin' };
  const page = await get(s.web, '/control', headers);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.match(page.body, /<script src="\/control\/app\.js" defer><\/script>/);
  assert.equal(page.body.includes(s.issued.token), false);

  const session = await get(s.web, '/v1/session', headers);
  assert.deepEqual(session.body, {
    ok: true,
    identity: { userId: 'operator', capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: ['repo-a'] },
    expiresAt: new Date(NOW + 60_000).toISOString(),
  });
  for (const forbidden of ['sessionId', 'credentialId', 'csrfTokenDigest', s.issued.token]) {
    assert.equal(session.rawBody.includes(forbidden), false);
  }
  const card = await get(s.web, '/v1/application-card', headers);
  assert.deepEqual(card.body.application.profiles[0].routes[0], { harness: 'grok', model: 'grok-4-code', effort: 'high' });
  assert.equal(card.rawBody.includes('application.shutdown'), false, 'host lifecycle commands are absent from the remote card');
});

test('BU3/BU4/BU5/BU6: static client makes Run flow primary and keeps fenced reap in the advanced seat without unsafe sinks', async () => {
  const s = system();
  const script = await get(s.web, '/control/app.js', { cookie: sessionCookie(s.issued), 'sec-fetch-site': 'same-origin' });
  assert.match(script.headers['content-type'], /^text\/javascript/);
  for (const term of ['run_start', 'run_status', 'run_follow', 'run_inspect', 'run_act', 'run_wait', 'run_answer', 'run_steer', 'run_stop', 'actionId', 'inputSchema', 'approve_plan', 'semantic_review', 'integrate', 'Follow Run', 'activeFollowPolicy', 'followLoop', 'review-form', 'review-route', 'review-reason', 'integrate-form', 'integration-strategy', 'integration-reason', 'semantic-summary', 'steer-target', 'steer-mode', 'steer-reason', 'stop-form', 'stop-reason', 'progress-list', 'renderProgress', '/v1/application-card', 'harness', 'model', 'effort', 'expectedFence', 'kill', 'drain', 'idempotencyKey', 'crypto.randomUUID', 'x-baton-csrf', '/v1/stream-tickets', 'EventSource', '/v1/auth/logout']) {
    assert.equal(script.body.includes(term), true, term);
  }
  assert.equal(script.body.includes("command('spawn'"), false);
  assert.equal(script.body.includes('innerHTML'), false);
  assert.equal(script.body.includes('document.write'), false);
  assert.match(script.body, /textContent/);
  const css = await get(s.web, '/control/app.css', { cookie: sessionCookie(s.issued), 'sec-fetch-site': 'same-origin' });
  assert.match(css.headers['content-type'], /^text\/css/);
  assert.ok(css.body.length > 100);
  assert.deepEqual(s.fleetCalls, []);
});
