// Issue #288, the web refusal envelopes: U-E15 (a malformed /v1/action-authority envelope is a 400
// naming the judged field, never 403), U-F13 (a 401 says which credential is missing or unusable and
// how to obtain a fresh one), U-E16 (a failed command outcome is never wrapped in a 200 ok:true),
// U-F14 (an idempotency conflict names the axis that moved) and U-F3 (a permanent deployment
// condition is refused typed with retryable:false and its remedy; the unclassified fallthrough is
// the transient row).
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore,
} from '../src/index.mjs';

const NOW = Date.parse('2026-09-14T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue288-web';
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue288-${label}-`));
  roots.push(root);
  return root;
}

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
async function send(web, { method = 'POST', path, body, headers = {}, encrypted = true }) {
  const req = new EventEmitter();
  Object.assign(req, {
    method, url: path, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    socket: { encrypted, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  const pending = web.handle(req, res);
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  await pending;
  return res;
}

function applicationCard() {
  // The facade check demands every web-admitted command on the served card (web-northbound's own
  // constructor contract); the ordinary in-process application serves exactly the registry's keys.
  return { schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) };
}

function fixture({ command } = {}) {
  const directory = scratch('web');
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const application = {
    repoId: REPO_ID, card: applicationCard,
    async authorizeReplay() { return true; },
    async command(name, args) {
      if (command) return command(name, args);
      return { schemaVersion: 1, runId: args?.runId ?? 'run-issue288', phase: 'running' };
    },
    async actionAuthority() {
      return {
        schemaVersion: 1, actionId: 'act-1', kind: 'approve', effect: 'plan_approval',
        requiredCapabilities: ['observe'], authorityDigest: 'a'.repeat(64),
      };
    },
  };
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, application,
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
  });
  const issue = (capabilities = ['observe', 'control', 'approve', 'emergency_stop']) => sessions.issue({
    userId: 'issue288-operator', authMethod: 'bearer', capabilities, repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'issue288-fixture' });
  // A synthetic principal is not a live one: the northbound consults the session store to decide
  // whether a principal is still active, so the ordinary path is exercised with a REAL session
  // while the refused outcomes (expired / revoked / malformed) are synthesized.
  const issued = issue();
  const live = sessions.authenticate({ headers: { authorization: `Bearer ${issued.token}` } });
  const principal = (overrides = {}) => ({ ...live, ...overrides });
  const context = (overrides = {}) => ({
    principal: principal(), origin: ORIGIN, csrfToken: issued.csrfToken, transport: 'https', ...overrides,
  });
  return { directory, sessions, coordination, web, issue, issued, live, principal, context };
}

const envelope = (overrides = {}) => ({
  schemaVersion: 1, commandId: 'issue288-cmd-1', idempotencyKey: 'issue288-key-1',
  command: 'run_status', args: { runId: 'run-issue288' }, repoId: REPO_ID, origin: ORIGIN,
  ...overrides,
});

// -------------------------------------------------------------------------------------------
// U-E15 — envelope validation on the authority preflight refuses 400 and names the field.
// -------------------------------------------------------------------------------------------

test('U-E15: a malformed action-authority envelope is a 400 naming the field, never a 403', async () => {
  const { web, issued } = fixture();
  const cases = [
    [{ runId: 'run-issue288', actionId: 'act-1' }, 'inputs'],
    [{ runId: 'run-issue288', actionId: 'act-1', inputs: {}, bogus: true }, 'bogus'],
  ];
  for (const [args, field] of cases) {
    const response = await send(web, {
      path: '/v1/action-authority',
      body: { schemaVersion: 1, repoId: REPO_ID, idempotencyKey: 'issue288-preflight', args },
      headers: { authorization: `Bearer ${issued.token}` },
    });
    assert.equal(response.status, 400, `${field}: a malformed envelope is a bad request, never forbidden`);
    assert.notEqual(response.body.error.code, 'forbidden');
    assert.equal(response.body.error.field, field, `${field}: the judged field is named`);
    assert.ok(response.body.error.message.length > 0);
  }
});

test('U-E15: an unknown top-level key is refused as such, not as a permission problem', async () => {
  const { web, issued } = fixture();
  const response = await send(web, {
    path: '/v1/action-authority',
    body: {
      schemaVersion: 1, repoId: REPO_ID, idempotencyKey: 'issue288-preflight',
      args: { runId: 'r', actionId: 'a', inputs: {} }, audit: 'yes',
    },
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'invalid_command');
});

test('U-E15: the capability precondition is the one 403, and it names required, held and missing', async () => {
  const { web, issue } = fixture();
  const response = await send(web, {
    path: '/v1/action-authority',
    body: { schemaVersion: 1, repoId: REPO_ID, idempotencyKey: 'issue288-preflight', args: { runId: 'r', actionId: 'a', inputs: {} } },
    headers: { authorization: `Bearer ${issue(['control']).token}` },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'forbidden');
  assert.equal(response.body.error.field, 'capability');
  assert.deepEqual(response.body.error.detail.missing, ['observe']);
  assert.equal(response.body.error.detail.required.includes('observe'), true);
  assert.equal(response.body.error.detail.held.includes('observe'), false);
});

// -------------------------------------------------------------------------------------------
// U-F13 — a web 401 says what is missing and how to obtain it.
// -------------------------------------------------------------------------------------------

test('U-F13: the four authentication outcomes are distinguishable, each naming its remedy', async () => {
  const { web, context, principal } = fixture();
  const cases = [
    [context({ principal: null }), 'absent', null],
    [context({ principal: principal({ revoked: true }) }), 'revoked', 'authorization'],
    [context({ principal: principal({ expiresAt: new Date(NOW - 1_000).toISOString() }) }), 'expired', 'authorization'],
    [context({ principal: principal({ expiresAt: 'not-a-date' }) }), 'malformed', 'authorization'],
  ];
  for (const [ctx, cause, field] of cases) {
    const response = await web.execute(ctx, envelope({ commandId: `cmd-${cause}`, idempotencyKey: `key-${cause}` }));
    assert.equal(response.status, 401, `${cause}: authentication refuses 401`);
    assert.equal(response.body.error.code, 'unauthenticated', 'the typed code is preserved');
    assert.equal(response.body.error.detail.cause, cause, `${cause}: the outcome is named`);
    assert.equal(response.body.error.field, field ?? undefined, `${cause}: the credential that was absent/unusable is named`);
    assert.equal(typeof response.body.error.action, 'string');
    assert.ok(response.body.error.action.length > 0, `${cause}: the remedy is stated`);
  }
});

test('U-F13: an expired bearer credential points at the refresh lane, a revoked one at re-login', async () => {
  const { web, context, principal } = fixture();
  const expired = await web.execute(context({
    principal: principal({ expiresAt: new Date(NOW - 1_000).toISOString() }),
  }), envelope());
  assert.equal(expired.body.error.detail.credential.kind, 'bearer');
  assert.equal(expired.body.error.detail.credential.header, 'authorization');
  assert.match(expired.body.error.action, /\/v1\/auth\/refresh/u);
  assert.equal(expired.body.error.detail.expiresAt, new Date(NOW - 1_000).toISOString(),
    'the expiry the client judged rides the refusal');

  const revoked = await web.execute(context({ principal: principal({ revoked: true }) }), envelope({
    commandId: 'cmd-revoked', idempotencyKey: 'key-revoked',
  }));
  assert.match(revoked.body.error.action, /\/v1\/auth\/login/u);
  assert.doesNotMatch(revoked.body.error.action, /\/v1\/auth\/refresh/u,
    'a revoked credential is never sent to the refresh lane — that lane would refuse it too');
});

test('U-F13: a request with no credential at all names both accepted lanes and where to get one', async () => {
  const { web } = fixture();
  const response = await send(web, { method: 'GET', path: '/v1/commands/unknown-command' });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'unauthenticated');
  assert.equal(response.body.error.detail.cause, 'absent');
  const accepted = response.body.error.detail.accepted.map((row) => row.header).sort();
  assert.deepEqual(accepted, ['authorization', 'cookie']);
  assert.match(response.body.error.action, /\/v1\/auth\/login/u);
});

// -------------------------------------------------------------------------------------------
// U-E16 — a failed command outcome is never a 200 ok:true.
// -------------------------------------------------------------------------------------------

function admit(coordination, principalRow, commandId = 'issue288-status') {
  return coordination.admitWebCommand({
    commandId, scopeKey: `scope-${commandId}`, requestDigest: `digest-${commandId}`,
    command: 'run_status', repoId: REPO_ID, runId: 'run-issue288',
    userId: principalRow.userId, sessionId: principalRow.sessionId, credentialId: principalRow.credentialId,
    origin: ORIGIN, expectedFence: null,
  }, { actor: `web:${principalRow.userId}:${principalRow.sessionId}`, key: `admit-${commandId}` });
}

test('U-E16: a completed command whose outcome failed answers with the outcome status and code', async () => {
  const { web, coordination, issued, live } = fixture();
  admit(coordination, live);
  coordination.completeWebCommand('issue288-status', {
    httpStatus: 409,
    body: { ok: false, error: { code: 'idempotency_conflict', message: 'idempotency conflict: the request moved', field: 'args.runId', retryable: false } },
  }, { actor: 'issue288-fixture', key: 'complete-status' });
  const response = await send(web, {
    method: 'GET', path: '/v1/commands/issue288-status',
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(response.status, 409, 'the status agrees with the outcome');
  assert.equal(response.body.ok, false, 'a failed command is never ok:true');
  assert.equal(response.body.error.code, 'idempotency_conflict', "the outcome's own code crosses");
  assert.equal(response.body.error.field, 'args.runId');
  assert.equal(response.body.error.retryable, false);
  assert.equal(response.body.command.commandId, 'issue288-status', 'the record identity still travels');
  assert.equal(response.body.command.outcome.httpStatus, 409);
});

test('U-E16: a successful outcome (and the admitted receipt) keep the established 200 shape', async () => {
  const { web, coordination, issued, live } = fixture();
  admit(coordination, live, 'issue288-ok');
  const admitted = await send(web, {
    method: 'GET', path: '/v1/commands/issue288-ok', headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(admitted.status, 200);
  assert.equal(admitted.body.ok, true);
  assert.equal(admitted.body.command.status, 'admitted');
  assert.equal(admitted.body.command.outcome, null);

  coordination.completeWebCommand('issue288-ok', { httpStatus: 200, body: { ok: true, result: { runId: 'run-issue288' } } },
    { actor: 'issue288-fixture', key: 'complete-ok' });
  const completed = await send(web, {
    method: 'GET', path: '/v1/commands/issue288-ok', headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.ok, true);
  assert.equal(completed.body.command.outcome.httpStatus, 200);
});

test('U-E16: a command-id conflict is a 409 whose code names the conflict', async () => {
  const { web, coordination, context, live } = fixture();
  admit(coordination, live, 'issue288-taken');
  const response = await web.execute(context(), envelope({
    commandId: 'issue288-taken', idempotencyKey: 'issue288-other-key', command: 'run_stop',
    args: { runId: 'run-issue288', reason: 'Operator cancelled this Run.' },
  }));
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'command_id_conflict');
  assert.notEqual(response.body.error.code, 'invalid_command');
});

// -------------------------------------------------------------------------------------------
// U-F14 — an idempotency conflict names the axis that moved.
// -------------------------------------------------------------------------------------------

test('U-F14: an observation replay that moved one admitted arg names that arg', async () => {
  const { web, context } = fixture();
  const first = await web.execute(context(), envelope({
    command: 'run_inspect', args: { runId: 'run-issue288', depth: 'outline' },
  }));
  assert.equal(first.status, 200);
  const conflict = await web.execute(context(), envelope({
    commandId: 'issue288-cmd-2', command: 'run_inspect',
    args: { runId: 'run-issue288', depth: 'index' },
  }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'idempotency_conflict');
  assert.equal(conflict.body.error.field, 'args.depth', 'the axis that moved is named');
  assert.match(conflict.body.error.message, /args\.depth/u);
  assert.equal(conflict.body.error.detail.movedAxis, 'args.depth');
});

test('U-F14: a durable replay conflict names the moved axis through the store', async () => {
  const { web, context } = fixture();
  const first = await web.execute(context(), envelope({
    commandId: 'issue288-durable-1', idempotencyKey: 'issue288-durable-key', command: 'run_stop',
    args: { runId: 'run-issue288', reason: 'Operator cancelled this Run.' },
  }));
  assert.notEqual(first.status, 409);
  const conflict = await web.execute(context(), envelope({
    commandId: 'issue288-durable-2', idempotencyKey: 'issue288-durable-key', command: 'run_stop',
    args: { runId: 'run-issue288', reason: 'A different reason entirely.' },
  }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'idempotency_conflict');
  assert.equal(conflict.body.error.field, 'args.reason');
  assert.match(conflict.body.error.message, /args\.reason/u);
});

test('U-F14: an identical replay is unchanged — it still replays instead of conflicting', async () => {
  const { web, context } = fixture();
  await web.execute(context(), envelope({ commandId: 'issue288-replay-1' }));
  const replay = await web.execute(context(), envelope({ commandId: 'issue288-replay-2' }));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
});

// -------------------------------------------------------------------------------------------
// U-F3 — permanent causes are typed and not retryable; the fallthrough is the transient row.
// -------------------------------------------------------------------------------------------

test('U-F3: an unclassified internal throw is the TRANSIENT row — retryable, with a next action', async () => {
  const { web, context } = fixture({ command: async () => { throw new Error('internal provider exploded'); } });
  const response = await web.execute(context(), envelope());
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'temporarily_unavailable');
  assert.equal(response.body.error.message, 'command dispatch failed', 'the internal text never leaks');
  assert.equal(response.body.error.retryable, true);
  assert.ok(response.body.error.action.length > 0, 'the transient row names what to do next');
});

test('U-F3: a permanent deployment condition keeps its own code and is not retryable', async () => {
  const permanent = fixture({ command: async () => {
    throw Object.assign(new Error('the projection exceeds the deployment ceiling'), { code: 'application_run_view_oversize' });
  } });
  const view = await permanent.web.execute(permanent.context(), envelope());
  assert.equal(view.status, 503);
  assert.equal(view.body.error.code, 'application_run_view_oversize', 'the cause is typed, never re-spelled');
  assert.equal(view.body.error.retryable, false);
  assert.ok(view.body.error.action.length > 0, 'the remedy is stated');

  // No session store: the deployment wires no Run application AND no principal authority, so the
  // refusal the caller meets is the wiring fact, not a liveness check.
  const unwired = new WebNorthbound({
    coordinator: {}, coordination: new CoordinationStore(join(scratch('unwired'), 'coordination')),
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
  });
  const refusal = await unwired.execute({
    principal: {
      userId: 'issue288-operator', sessionId: 'issue288-session', credentialId: 'issue288-cred',
      authMethod: 'bearer', capabilities: ['observe', 'control'], repoIds: [REPO_ID],
      expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    origin: ORIGIN, transport: 'https',
  }, envelope({ commandId: 'issue288-unwired', idempotencyKey: 'issue288-unwired' }));
  assert.equal(refusal.status, 503);
  assert.equal(refusal.body.error.code, 'application_unavailable');
  assert.equal(refusal.body.error.retryable, false);
  assert.ok(refusal.body.error.action.length > 0);
});

test('U-F3: a plaintext request is refused typed as a permanent transport misconfiguration', async () => {
  const { web, context } = fixture();
  const response = await web.execute(context({ transport: 'http' }), envelope());
  assert.equal(response.status, 503, 'the listener cannot serve it (the status is unchanged)');
  assert.equal(response.body.error.code, 'secure_transport_required', 'the cause is named, never `temporarily_unavailable`');
  assert.equal(response.body.error.field, 'transport');
  assert.equal(response.body.error.retryable, false, 'a plaintext retry is never the remedy');
  assert.match(response.body.error.action, /https:\/\//u);
});
