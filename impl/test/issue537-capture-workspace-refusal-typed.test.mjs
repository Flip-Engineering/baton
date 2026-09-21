// Issue #537 — swarm capture's unmapped 503.
//
// The capture leg (impl/src/runtime-admission.mjs `captureContribution`) refuses when the
// author workspace is already closing or closed, spelling the code
// `contribution_workspace_unavailable`. That code held no row in the swarm family's ONE closed
// refusal set (SWARM_REFUSAL_CODES in impl/src/swarm-refusals.mjs), and the web layer's swarm
// arm derives from that table — so the refusal crossed POST /v1/commands as 503
// `temporarily_unavailable` "retry once": the root was told to retry a state that never
// returns, and the #430 narration named the gap on stderr.
//
// The fix: the owner row carries the code (409, raised by the coordinator's capture leg), and
// the swarm.capture arm attaches the seat facts it alone knows — the participant named and the
// workspace state the leg observed (the #473 shape: the leg's own code and message stay
// byte-stable). The rows below drive the REAL leg and the REAL served transport (the
// #430/#485 fixture shape): the mint site's spelling, and the 409 the root reads.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound, WebSessionStore } from '../src/index.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { captureContribution } from '../src/runtime-admission.mjs';

const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue537-web';
const SWARM_ID = 's-issue537';

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

/** The real capture leg's admission guards, bound to a fixture coordinator: the mint site this
 * issue pins — a worker whose handle is stopping/dead/exited refuses the capture. */
function captureLegCoordinator(workers) {
  return {
    _withAuthorityOp: (operation) => operation(),
    _contributionOperations: () => ({ captured: () => null }),
    _getWorker: (workerId) => workers.find((row) => row.id === workerId),
    _tasks: new Map(),
    _worktrees: { snapshot: () => ({}) },
  };
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue537-'));
  roots.push(directory);
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'),
    { clock: () => new Date(NOW).toISOString() });
  const workers = [];
  const swarmRuntime = new SwarmRuntime({
    store: coordination,
    coordinator: {
      list: () => workers,
      // The REAL capture leg, not a canned answer: the refusal this issue pins is minted by
      // runtime-admission's own admission guards.
      captureContribution: (workerId, options) =>
        captureContribution(captureLegCoordinator(workers), null, workerId, options),
    },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: true });
    },
    stopRun: async () => {},
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
    userId: 'issue537-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control'], repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'issue537-fixture' });
  const principal = { actor: 'direct:issue537-root', principalId: 'issue537-root', sessionId: 'issue537-root' };
  let key = 0;
  const call = (command, args) => swarmRuntime.command(command,
    { swarmId: SWARM_ID, idempotencyKey: `issue537-setup-${++key}`, ...args }, principal);
  return { web, issued, workers, call };
}

const envelope = (command, args) => ({
  schemaVersion: 1, commandId: `issue537-${command}`, idempotencyKey: `issue537-${command}-key`,
  command, args, repoId: REPO_ID, origin: ORIGIN,
});

test('#537: the capture leg refuses a settling workspace with the family spelling', async () => {
  const workers = [{ id: 'w-1', taskId: 't-1', status: 'stopping' }];
  await assert.rejects(
    captureContribution(captureLegCoordinator(workers), null, 'w-1', { contributionId: 'c-1' }),
    (error) => error.code === 'contribution_workspace_unavailable'
      && /closing or closed/u.test(error.message),
    'the leg that mints the refusal spells the code the owner row must hold',
  );
});

test('#537: capturing from a settling workspace crosses 409 contribution_workspace_unavailable, naming the seat', async () => {
  const { web, issued, workers, call } = fixture();
  await call('swarm.create', { purpose: 'issue537 capture against a settling workspace' });
  await call('swarm.recruit', { participantId: 'builder', objective: 'work as builder' });
  workers[0].status = 'stopping';
  const response = await send(web, {
    token: issued.token,
    body: envelope('swarm.capture', { swarmId: SWARM_ID, participantId: 'builder', contributionId: 'c-settling' }),
  });
  assert.equal(response.status, 409, 'a workspace that is settling is a state the caller observes, not a transient fault');
  assert.equal(response.body.error.code, 'contribution_workspace_unavailable', 'the capture leg\'s code crosses as itself');
  assert.equal(response.body.error.retryable, false, 'the same capture refuses the same way on retry');
  assert.equal(response.body.error.detail?.participantId, 'builder', 'the refusal names the seat the capture named');
  assert.equal(response.body.error.detail?.workspaceState, 'stopping', 'and the workspace state the leg observed');
});
