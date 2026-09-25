// Issue #394: the web `wait` arm silently clamped `timeoutMs` to an undeclared 30 s ceiling
// (`Math.min(Number(a.timeoutMs ?? 25000), 30000)`), while the application `run.wait` arm REFUSED
// above the SAME bound — two literals (25000, 30000) and two behaviours for one rule, so a caller
// asking for 120 s was answered after 30 s with no marker.
//
// These rows pin the landed rule: ONE registry row (FRAME_LIMITS['web.wait_ceiling_ms']) declares
// the ceiling; the default wait DERIVES from it (never a second literal); BOTH wait arms refuse
// above it through ONE refusal-code derivation (the application arm's pinned token is the
// 'application' member of that family) instead of clamping; and every row is observed through the
// real served web transport (POST /v1/commands behind the resident seam — the #335/#362 idiom),
// never a private helper.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore } from '../src/index.mjs';
import * as limits from '../src/limits.mjs';

const REPO = 'repo-issue394';
const NOW = Date.parse('2026-09-18T06:00:00.000Z');
const ORIGIN = 'https://control.example.test';
// The live web transport's own source: the static rows read THIS file, so a re-declared literal in
// the module under test can never hide behind a helper.
const WEB_SOURCE = readFileSync(new URL('../src/web-northbound.mjs', import.meta.url), 'utf8');

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

// -------------------------------------------------------------------------------------------
// The ONE registry row, the DERIVED default, and the ONE refusal-code derivation.
// -------------------------------------------------------------------------------------------
function ceilingRow() {
  const row = limits.FRAME_LIMITS?.['web.wait_ceiling_ms'];
  assert.ok(row,
    'stage[wait-ceiling-row-missing]: limits.mjs must declare the web wait ceiling as ONE '
    + 'FRAME_LIMITS row (web.wait_ceiling_ms) that both wait arms of web-northbound.mjs read — '
    + 'at HEAD the bound is re-typed as 30000/30_000 beside a second 25000 default');
  return row;
}
function ceilingMs() { return ceilingRow().value; }
function defaultMs() {
  const derived = limits.WEB_WAIT_DEFAULT_MS;
  assert.ok(Number.isSafeInteger(derived) && derived > 0,
    'stage[wait-default-not-derived]: limits.mjs must export the DERIVED web wait default '
    + '(WEB_WAIT_DEFAULT_MS), so the 25000 literal retires from web-northbound.mjs');
  return derived;
}
function refusalCode(scope) {
  assert.equal(typeof limits.webWaitCeilingRefusalCode, 'function',
    'stage[wait-refusal-derivation-missing]: limits.mjs must export the ONE derivation '
    + '(webWaitCeilingRefusalCode(scope)) both wait arms draw their ceiling refusal code from');
  const code = limits.webWaitCeilingRefusalCode(scope);
  assert.equal(typeof code, 'string');
  return code;
}
function ceilingRefusalText(actual) {
  assert.equal(typeof limits.composeWebWaitCeilingRefusal, 'function',
    'stage[wait-refusal-composer-missing]: limits.mjs must export composeWebWaitCeilingRefusal — '
    + 'the ONE text that names the field, the ceiling and the remedy');
  return limits.composeWebWaitCeilingRefusal(actual);
}

// -------------------------------------------------------------------------------------------
// The real served web transport: WebNorthbound + WebSessionStore + CoordinationStore, driven
// through POST /v1/commands with an issued bearer token (the #335/#362 envelope idiom).
// -------------------------------------------------------------------------------------------
class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
async function send(web, token, envelope) {
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'POST', url: '/v1/commands',
    headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${token}` },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  const pending = web.handle(req, res);
  queueMicrotask(() => { req.emit('data', Buffer.from(JSON.stringify(envelope))); req.emit('end'); });
  await pending;
  return res;
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue394-'));
  roots.push(directory);
  const waits = [];
  const applicationCalls = [];
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const coordinator = {
    async wait(timeoutMs) { waits.push(timeoutMs); return { attention: [], facts: [] }; },
  };
  const application = {
    repoId: REPO,
    card: () => ({ schemaVersion: 1, repoId: REPO, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args) {
      applicationCalls.push({ name, args });
      return { schemaVersion: 1, runId: 'run-issue394', phase: 'running' };
    },
  };
  const web = new WebNorthbound({
    coordinator, coordination, sessions, application, repoIds: [REPO], allowedOrigins: [ORIGIN], now: () => NOW,
  });
  const issued = sessions.issue({
    userId: 'issue394-operator', authMethod: 'bearer', capabilities: ['observe'], repoIds: [REPO], ttlMs: 60_000,
  }, { actor: 'issue394-fixture' });
  return { web, token: issued.token, waits, applicationCalls };
}
const envelope = (command, args, suffix) => ({
  schemaVersion: 1, commandId: `issue394-${suffix}`, idempotencyKey: `issue394-${suffix}`,
  command, args, repoId: REPO, origin: ORIGIN,
});

// -------------------------------------------------------------------------------------------
// (a) the coordinator `wait` arm refuses above the ceiling — typed, naming field/ceiling/remedy.
// -------------------------------------------------------------------------------------------
test('#394 (a): the coordinator wait arm REFUSES timeoutMs above the ceiling, naming field, ceiling and remedy', async () => {
  const ceiling = ceilingMs();
  const requested = ceiling + 1;
  const { web, token, waits } = fixture();
  const response = await send(web, token, envelope('wait', { timeoutMs: requested }, 'coord-over'));
  assert.equal(response.status, 400, 'a wait past the declared ceiling is a refused request, never a clamped one');
  const code = refusalCode('coordinator');
  assert.equal(response.body?.error?.code, code,
    'the refusal draws the ONE derivation for the coordinator arm (was: no refusal at all — the requested wait was silently clamped to the ceiling)');
  assert.equal(response.body.error.code.endsWith('_wait_timeout_exceeds_web_ceiling'), true,
    'the code is a member of the ONE wait-ceiling family');
  assert.equal(response.body.error.field, 'timeoutMs', 'the refusal names the field that must change');
  assert.equal(response.body.error.message, ceilingRefusalText(requested), 'the text is the ONE composer\'s output');
  assert.match(response.body.error.message, new RegExp(String(requested)),
    'the refusal names the requested value');
  assert.match(response.body.error.message, new RegExp(String(ceiling)),
    'the refusal names the ceiling VALUE, not only a code (the web audit\'s F6 finding)');
  assert.match(response.body.error.message, new RegExp(`resend with timeoutMs ≤ ${ceiling} or poll`),
    'the refusal names the remedy: resend at or below the ceiling, or poll');
  assert.deepEqual(waits, [],
    'the refused wait never reaches the coordinator — a refusal, never a silently shortened wait');
});

// -------------------------------------------------------------------------------------------
// (b) the ceiling itself IS admitted, and reaches the coordinator unchanged (no clamp).
// -------------------------------------------------------------------------------------------
test('#394 (b): timeoutMs AT the ceiling is admitted and reaches the coordinator unchanged', async () => {
  const ceiling = ceilingMs();
  const { web, token, waits } = fixture();
  const response = await send(web, token, envelope('wait', { timeoutMs: ceiling }, 'coord-at'));
  assert.equal(response.status, 200, 'the ceiling is inside the bound');
  assert.deepEqual(waits, [ceiling], 'the admitted wait is the caller\'s exact ceiling value — never a clamp of it');
});

// -------------------------------------------------------------------------------------------
// (c) the default (no timeoutMs) IS the derived default.
// -------------------------------------------------------------------------------------------
test('#394 (c): the default wait is the DERIVED default from the ceiling row, never a second literal', async () => {
  const ceiling = ceilingMs();
  const derived = defaultMs();
  assert.ok(derived < ceiling, 'the default wait settles strictly inside the ceiling');
  assert.equal(derived, 25_000, 'the live default (25 s) is preserved');
  assert.equal(derived, Math.round(ceiling * (5 / 6)),
    'the default is a STATED FRACTION of the ceiling (5/6 — one sixth of the transport deadline kept to deliver the answer)');
  const { web, token, waits } = fixture();
  const response = await send(web, token, envelope('wait', {}, 'coord-default'));
  assert.equal(response.status, 200);
  assert.deepEqual(waits, [derived], 'a caller that declares no timeoutMs gets exactly the derived default');
});

// -------------------------------------------------------------------------------------------
// (d) the application run.wait arm draws the SAME derivation and the SAME ceiling.
// -------------------------------------------------------------------------------------------
test('#394 (d): the application run.wait arm draws the same refusal derivation and the same ceiling value', async () => {
  const ceiling = ceilingMs();
  const { web, token, applicationCalls } = fixture();
  const admitted = await send(web, token, envelope('run_wait', { runId: 'run-issue394', timeoutMs: ceiling }, 'app-at'));
  assert.equal(admitted.status, 200, 'the application arm admits the ceiling itself');
  assert.equal(applicationCalls.at(-1)?.args?.timeoutMs, ceiling,
    'the application arm forwards the caller\'s exact ceiling value');

  const refused = await send(web, token, envelope('run_wait', { runId: 'run-issue394', timeoutMs: ceiling + 1 }, 'app-over'));
  assert.equal(refused.status, 400);
  assert.equal(refused.body?.error?.code, 'invalid_command',
    'the application arm keeps its route-shape refusal body (the blind-waits pin: invalid_command)');
  assert.equal(refused.body.error.message, refusalCode('application'),
    'the application token IS the derivation\'s application member — ONE family, one ceiling');
  assert.equal(refusalCode('application').endsWith('_wait_timeout_exceeds_web_ceiling'), true);
  assert.equal(refusalCode('coordinator').endsWith('_wait_timeout_exceeds_web_ceiling'), true);
});

// -------------------------------------------------------------------------------------------
// (e) the registry carries the row, and web-northbound.mjs re-declares neither literal.
// -------------------------------------------------------------------------------------------
test('#394 (e): FRAME_LIMITS carries the row and both wait arms read it — no 30000/25000 literal survives in web-northbound.mjs', () => {
  const row = ceilingRow();
  assert.equal(row.lane, 'web.wait_ceiling_ms', 'the row is keyed by its own lane name');
  assert.equal(row.class, 'substrate', 'the ceiling is a transport resource bound (the route.probe_deadline_ms sibling)');
  assert.equal(row.value, 30_000, 'the live 30 s bound is unchanged');
  assert.equal(row.unit, 'ms');
  assert.equal(row.graceful ?? null, null, 'a request-shape ceiling mints no graceful posture');
  assert.equal(typeof row.enforcedAt, 'string', 'the row names the seam that reads it');
  assert.equal(row.enforcedAt.length > 0, true);
  assert.equal(Object.isFrozen(row), true, 'registry rows stay frozen');

  for (const literal of [/(?<![\d_])30_?000(?![\d_])/u, /(?<![\d_])25_?000(?![\d_])/u]) {
    const hit = WEB_SOURCE.split('\n')
      .map((line, index) => ({ line: index + 1, text: line }))
      .filter(({ text }) => literal.test(text));
    assert.deepEqual(hit, [],
      `web-northbound.mjs must read the ceiling (and its derived default) from the registry row, never re-type it: ${JSON.stringify(hit)}`);
  }

  const ceilingReads = WEB_SOURCE.split('\n').filter((line) => line.includes('WEB_WAIT_CEILING_ROW'));
  assert.equal(ceilingReads.length >= 2, true,
    `both wait arms read the ceiling row (found ${ceilingReads.length} read(s))`);
  assert.equal(WEB_SOURCE.includes('webWaitCeilingRefusalCode(\'application\')'), true,
    'the application arm draws the shared derivation');
  assert.equal(WEB_SOURCE.includes('webWaitCeilingRefusalCode(\'coordinator\')'), true,
    'the coordinator arm draws the shared derivation');
  assert.equal(WEB_SOURCE.includes('WEB_WAIT_DEFAULT_MS'), true,
    'the coordinator wait dispatch reads the derived default from the registry module');
});
