// Issue #335 (application half): refusals that hide the route grammar.
//
// `application_route_not_allowed` used to read "requested route is outside the deployment
// profile" — naming neither the requested selector, the selector grammar, nor any served
// route. The CLI half pre-checks before sending, but the swarm_recruit_follow path and every
// non-CLI caller (MCP bridge, swarm client, web) bypass that pre-check, so the application's
// own refusal is their only teaching. All four throw sites in application.mjs now compose ONE
// teaching from the deployment's own readiness rows (the same rows doctor prints):
//   message — the requested selector as typed, the grammar ([provider/]model per harness,
//             HARNESS/MODEL@EFFORT for the exact form), and the served routes of the
//             requested harness with their readiness state (or the served harnesses when the
//             requested harness serves nothing);
//   detail  — {field ('options.exact' | 'route'), requested, grammar,
//             served: [{harness, model, effort, state, code}]}.
// The code stays `application_route_not_allowed`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BatonApplication, CoordinationStore, MockAdapter, WebNorthbound, WebSessionStore, createDriver,
} from '../src/index.mjs';

const ORIGIN = 'https://control.example.test';
const REPO_ID = 'repo-issue335-application';
const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const policy = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID, mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

// The deployment profile mirrors the issue: muse serves a BARE model
// (muse-spark-1.3-contributor) while omp routes carry a provider prefix
// (deepseek/deepseek-flash).
const profile = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID,
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification,
  routes: [
    { harness: 'muse', model: 'muse-spark-1.3-contributor', effort: 'high' },
    { harness: 'muse', model: 'muse-spark-1.3-contributor', effort: 'low' },
    { harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'high' },
  ],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const principal = (principalId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
});

function mockHarness(harness, models, efforts) {
  const adapter = new MockAdapter({ harness, model: models[0], scenario: { outcome: 'completed' } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: models[0], available: models, family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: efforts,
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue335-application-'));
  roots.push(directory);
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue335 test', GIT_COMMITTER_NAME: 'Issue335 test' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue335@example.invalid', GIT_COMMITTER_EMAIL: 'issue335@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO_ID, logDir: join(directory, 'log'),
    adapters: {
      muse: mockHarness('muse', ['muse-spark-1.3-contributor'], ['low', 'high']),
      omp: mockHarness('omp', ['deepseek/deepseek-flash'], ['high']),
    },
    goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000,
  });
  const app = new BatonApplication({
    driver, repoId: REPO_ID, profiles: { standard: profile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true,
  });
  t.after(async () => { await app.shutdown(principal('cleanup')); });
  await app.ready;
  const sessions = new WebSessionStore(join(directory, 'sessions'), { now: () => NOW });
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, application: app,
    repoIds: [REPO_ID], allowedOrigins: [ORIGIN], now: () => NOW,
  });
  const issued = sessions.issue({
    userId: 'issue335-operator', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'issue335-fixture' });
  return { app, web, issued };
}

class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = body ? JSON.parse(body) : null; }
}
async function send(web, { path, body, token }) {
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'POST', url: path,
    headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${token}` },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  const pending = web.handle(req, res);
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  await pending;
  return res;
}
const commandEnvelope = (overrides = {}) => ({
  schemaVersion: 1, commandId: 'issue335-cmd-1', idempotencyKey: 'issue335-key-1',
  command: 'run.start', args: {}, repoId: REPO_ID, origin: ORIGIN, ...overrides,
});

// The issue's wrong muse spelling: provider-qualified where the served route is bare.
const WRONG_MUSE = Object.freeze({
  harness: 'muse', model: 'muse/muse-spark-1.3-contributor', effort: 'high',
});

const byRoute = (left, right) => (
  left.harness !== right.harness ? (left.harness < right.harness ? -1 : 1)
    : left.model !== right.model ? (left.model < right.model ? -1 : 1)
      : left.effort !== right.effort ? (left.effort < right.effort ? -1 : 1) : 0
);
const doctorServedShape = (app, harness) => app.doctorReadiness().routes
  .filter((row) => row.harness === harness)
  .map((row) => ({
    harness: row.harness, model: row.model, effort: row.effort,
    state: row.state, code: row.code ?? null,
  }))
  .sort(byRoute);

// -------------------------------------------------------------------------------------------
// (a) a recruit with the wrong muse spelling refuses through the REAL web transport.
// -------------------------------------------------------------------------------------------

test('(a) a recruit with the wrong muse spelling refuses with the route teaching', async (t) => {
  const { app, web, issued } = await fixture(t);
  await app.command('swarm.create', {
    swarmId: 's-issue335', purpose: 'route teaching', idempotencyKey: 'issue335:create',
  }, principal('orchestrator'));
  // The REAL web transport: the recruit rides POST /v1/commands behind the resident seam.
  const response = await send(web, {
    path: '/v1/commands',
    body: commandEnvelope({
      commandId: 'issue335-recruit-1', idempotencyKey: 'issue335-recruit-1',
      command: 'swarm.recruit',
      args: {
        swarmId: 's-issue335', participantId: 'builder',
        objective: 'Build the contribution',
        options: { exact: { ...WRONG_MUSE } },
        idempotencyKey: 'issue335-recruit-args-1',
      },
    }),
    token: issued.token,
  });
  assert.equal(response.status, 400, 'a route outside the profile is a bad request');
  assert.equal(response.body.error.code, 'application_route_not_allowed', 'the code is unchanged');
  // The application's own refusal — the teaching every non-CLI caller meets — is the same
  // throw the transport received: it names the selector as typed, the grammar, and the
  // served muse routes with their readiness state.
  const refusal = await app.command('swarm.recruit', {
    swarmId: 's-issue335', participantId: 'teaching-probe',
    objective: 'Build the contribution',
    options: { exact: { ...WRONG_MUSE } },
    idempotencyKey: 'issue335-recruit-direct-1',
  }, principal('orchestrator')).then(
    () => { throw new Error('a wrong muse spelling must refuse'); },
    (error) => error,
  );
  assert.equal(refusal.code, 'application_route_not_allowed');
  assert.match(refusal.message, /muse\/muse-spark-1\.3-contributor/u, 'the message names the selector as typed');
  assert.match(refusal.message, /\[provider\/\]model/u, 'the message teaches the model grammar');
  assert.match(refusal.message, /HARNESS\/MODEL@EFFORT/u, 'the message teaches the exact form');
  assert.match(refusal.message, /muse-spark-1\.3-contributor/u, 'the message names the served muse spelling');
  assert.match(refusal.message, /ready/u, 'the message carries the readiness state');
  assert.equal(refusal.detail.field, 'options.exact', 'an exact tuple judges options.exact');
  assert.deepEqual(refusal.detail.requested, { ...WRONG_MUSE }, 'detail carries the selector as typed');
  assert.match(refusal.detail.grammar, /\[provider\/\]model/u);
  assert.match(refusal.detail.grammar, /HARNESS\/MODEL@EFFORT/u);
  assert.deepEqual([...refusal.detail.served].sort(byRoute), doctorServedShape(app, 'muse'));
});

// -------------------------------------------------------------------------------------------
// (b) a run.start with a provider-qualified model the profile does not serve refuses the same way.
// -------------------------------------------------------------------------------------------

test('(b) run.start with an unserved provider-qualified model refuses with the teaching', async (t) => {
  const { app } = await fixture(t);
  const requested = { harness: 'omp', model: 'deepseek/deepseek-chat', effort: 'high' };
  const refusal = await app.command('run.start', {
    intent: { objective: 'Probe the omp spelling the profile does not serve', route: requested },
  }, principal('orchestrator')).then(
    () => { throw new Error('an unserved omp model must refuse'); },
    (error) => error,
  );
  assert.equal(refusal.code, 'application_route_not_allowed');
  assert.match(refusal.message, /deepseek\/deepseek-chat/u, 'the message names the selector as typed');
  assert.match(refusal.message, /\[provider\/\]model/u);
  assert.match(refusal.message, /HARNESS\/MODEL@EFFORT/u);
  assert.match(refusal.message, /deepseek\/deepseek-flash/u, 'the message names the served omp spelling');
  assert.equal(refusal.detail.field, 'options.exact');
  assert.deepEqual(refusal.detail.requested, requested);
  assert.deepEqual([...refusal.detail.served].sort(byRoute), doctorServedShape(app, 'omp'));

  // A partial selector (no harness) judges the `route` field and teaches every served route.
  const selectorRefusal = await app.command('run.start', {
    intent: { objective: 'Probe a model no harness serves', route: { model: 'no-such-model', effort: 'high' } },
  }, principal('orchestrator')).then(
    () => { throw new Error('an unserved model selector must refuse'); },
    (error) => error,
  );
  assert.equal(selectorRefusal.code, 'application_route_not_allowed');
  assert.equal(selectorRefusal.detail.field, 'route', 'a partial selector judges route');
  assert.deepEqual(selectorRefusal.detail.requested, { model: 'no-such-model', effort: 'high' });
  const allServed = app.doctorReadiness().routes.map((row) => ({
    harness: row.harness, model: row.model, effort: row.effort,
    state: row.state, code: row.code ?? null,
  })).sort(byRoute);
  assert.deepEqual([...selectorRefusal.detail.served].sort(byRoute), allServed);
});

// -------------------------------------------------------------------------------------------
// (c) a workflow team-member refusal carries the teaching.
// -------------------------------------------------------------------------------------------

test('(c) a workflow team member outside the profile refuses with the teaching', async (t) => {
  const { app } = await fixture(t);
  const refusal = await app.command('run.start', {
    intent: {
      objective: 'Probe the workflow team-member route refusal',
      route: { harness: 'muse', model: 'muse-spark-1.3-contributor', effort: 'high' },
      composition: {
        strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
        team: [
          { role: 'reviewer', route: { harness: 'muse', model: 'muse-spark-1.3-contributor', effort: 'high' } },
          { role: 'challenger', route: { ...WRONG_MUSE } },
        ],
      },
    },
  }, principal('orchestrator')).then(
    () => { throw new Error('a team member outside the profile must refuse'); },
    (error) => error,
  );
  assert.equal(refusal.code, 'application_route_not_allowed');
  assert.match(refusal.message, /challenger/u, 'the message names the refused role');
  assert.match(refusal.message, /muse\/muse-spark-1\.3-contributor/u, 'the message names the selector as typed');
  assert.match(refusal.message, /\[provider\/\]model/u);
  assert.match(refusal.message, /HARNESS\/MODEL@EFFORT/u);
  assert.match(refusal.message, /muse-spark-1\.3-contributor/u, 'the message names the served spelling');
  assert.equal(refusal.detail.field, 'options.exact');
  assert.deepEqual(refusal.detail.requested, { ...WRONG_MUSE });
  assert.deepEqual([...refusal.detail.served].sort(byRoute), doctorServedShape(app, 'muse'));
});

// -------------------------------------------------------------------------------------------
// (d) an unknown harness lists served harnesses.
// -------------------------------------------------------------------------------------------

test('(d) a harness the deployment does not serve lists the served harnesses', async (t) => {
  const { app } = await fixture(t);
  const requested = { harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' };
  const refusal = await app.command('run.start', {
    intent: { objective: 'Probe a harness the deployment does not serve', route: requested },
  }, principal('orchestrator')).then(
    () => { throw new Error('an unserved harness must refuse'); },
    (error) => error,
  );
  assert.equal(refusal.code, 'application_route_not_allowed');
  assert.match(refusal.message, /codex/u, 'the message names the requested harness');
  assert.match(refusal.message, /serves no routes/u, 'the message says the harness serves nothing');
  assert.match(refusal.message, /muse/u, 'the message lists a served harness');
  assert.match(refusal.message, /omp/u, 'the message lists every served harness');
  assert.deepEqual(refusal.detail.requested, requested);
  assert.deepEqual(refusal.detail.served, [], 'no served rows for an unserved harness');
  assert.deepEqual(
    [...(refusal.detail.servedHarnesses ?? [])].sort(),
    [...new Set(app.doctorReadiness().routes.map((row) => row.harness))].sort(),
    'detail lists the served harnesses',
  );
});

// -------------------------------------------------------------------------------------------
// (e) the detail's served rows equal the doctor's rows for that harness.
// -------------------------------------------------------------------------------------------

test('(e) served rows equal the doctor rows for the requested harness', async (t) => {
  const { app } = await fixture(t);
  const refusal = await app.command('run.start', {
    intent: { objective: 'Probe served-row equality', route: { ...WRONG_MUSE } },
  }, principal('orchestrator')).then(
    () => { throw new Error('a wrong muse spelling must refuse'); },
    (error) => error,
  );
  assert.equal(refusal.code, 'application_route_not_allowed');
  const doctorRows = app.doctorReadiness().routes.filter((row) => row.harness === 'muse');
  assert.ok(doctorRows.length > 0, 'the fixture serves muse routes');
  assert.deepEqual([...refusal.detail.served].sort(byRoute), doctorServedShape(app, 'muse'));
  for (const row of refusal.detail.served) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ['code', 'effort', 'harness', 'model', 'state'],
      'each served row carries exactly harness, model, effort, state, code',
    );
  }
});
