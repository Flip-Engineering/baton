// Issues #484 and #485 — the web pre-dispatch argument arm dropped the cause's own teaching.
//
// #481's lane found it from one side: a `swarm.contribution_recorded` body that is its own JSON
// document refuses at the contract with `field: payload.body`, rule `object` and the admitted
// report shape, and the served transport answered `field: "view"` — the first declared argument
// the caller happened not to send — with no `detail` at all. #484 found it from the other:
// `swarm guide --priority bogus` answered `field: "inReplyTo"` beside a message that correctly
// said `priority must be one of: next_boundary, now`.
//
// The arm composed `{code, message, field}` itself and re-derived `field` with
// `applicationArgField`, so every contract-arg refusal lost the field the failing check named.
// The two rows below drive the REAL served transport (#430's web fixture shape: no resident, no
// worker turn, no git) and pin what a web caller now reads: the cause's own field, and the
// cause's own detail when it minted one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore } from '../src/index.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue485-web';
const SWARM_ID = 's-issue485';

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}

/** One authenticated envelope through the served transport, answered by the WebNorthbound seam. */
async function send(web, { body, token }) {
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'POST', url: '/v1/commands',
    headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${token}` },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  const pending = web.handle(req, res);
  queueMicrotask(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  await pending;
  return res;
}

/** The served swarm stack behind the web seam — the fixture shape #430/#481's rows use. */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue485-'));
  roots.push(directory);
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'),
    { clock: () => new Date(NOW).toISOString() });
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: { list: () => [], pausedTurns: () => [] },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => ({}),
    stopRun: async () => ({}),
  });
  const application = {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args, principal, context) {
      return swarmRuntime.command(name, args, {
        actor: `web:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId, sessionId: principal.sessionId,
      }, context);
    },
  };
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, application,
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
  });
  const issued = sessions.issue({
    userId: 'issue485-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control'], repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'issue485-fixture' });
  return { web, issued };
}

const envelope = (command, args, overrides = {}) => ({
  schemaVersion: 1, commandId: `issue485-${command}`, idempotencyKey: `issue485-${command}-key`,
  command, args, repoId: REPO_ID, origin: ORIGIN, ...overrides,
});

test('#485: a contract-arg refusal crosses with the contract\'s own field (payload.body) and detail', async () => {
  const { web, issued } = fixture();
  // The report serialized one time more than the contract expects — #481's incident body.
  const response = await send(web, {
    token: issued.token,
    body: envelope('swarm.update', {
      swarmId: SWARM_ID, event: 'swarm.contribution_recorded', idempotencyKey: 'issue485-publish',
      payload: { contributionId: 'c-encoded', participantId: 'builder', body: JSON.stringify({ subject: 'x' }) },
    }),
  });
  assert.equal(response.status, 400, 'a body that is not the report is a request fault');
  assert.equal(response.body.error.code, 'swarm_command_invalid', 'the contract code crosses as itself');
  assert.equal(response.body.error.field, 'payload.body',
    'the field the failing check named — not the first declared argument the caller omitted');
  const admitted = 'the contribution report object (subject, commit, items, verification, needsFromOthers)';
  assert.deepEqual(response.body.error.detail,
    { field: 'payload.body', rule: 'object', admitted, correction: 'the report was JSON-encoded twice; pass the object' },
    'the contract\'s own teaching crosses with it: the rule, the admitted form and the remedy');
});

test('#484: a closed-set refusal names the argument that failed, not the first one the caller omitted', async () => {
  const { web, issued } = fixture();
  const response = await send(web, {
    token: issued.token,
    body: envelope('swarm.guide', {
      swarmId: SWARM_ID, participantId: 'seat', message: 'continue', idempotencyKey: 'issue485-guide',
      priority: 'bogus',
    }),
  });
  assert.equal(response.status, 400, 'a value outside the closed set is a request fault');
  assert.equal(response.body.error.code, 'swarm_command_invalid', 'the swarm contract code crosses as itself');
  assert.match(response.body.error.message, /priority must be one of: next_boundary, now/u,
    'the message names the argument that failed');
  assert.equal(response.body.error.field, 'priority',
    'and the field agrees with the message instead of naming the neighbouring inReplyTo');
  assert.deepEqual(response.body.error.detail?.admitted, ['next_boundary', 'now'],
    'the closed set the field is judged against crosses too');
});
