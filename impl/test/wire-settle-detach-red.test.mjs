// wire-settle-detach-red.test.mjs — red-first pin for #232: the synchronous settle path is
// admitted on the WEB wire.
//
// Defect: runWorkflow (application.mjs) has honored `request.detach !== false` since #173 — the
// synchronous path returns the D6 seven-key settle receipt, whose outcomes carry each member's
// typed startError (the phantom surfacing, workflow-interpreter.mjs). But the web lane's argument
// admission (web-northbound.mjs WAVE_ARG_FIELDS.waves_run) refused the `detach` key outright
// (unknown_argument_field), so no web/MCP-bridge caller could reach the settle receipt — the
// detached acceptance receipt was the only reachable answer.
//
// The fix: admit `detach` (boolean, default true) through the web ARG_FIELDS gate; the
// application-side normalizer refuses a non-boolean detach typed, naming the field.
//
// Suite law: hermetic (mkdtemp fixtures, fake transports only — nothing fires at the real
// resident); ESM node:test + node:assert/strict.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { APPLICATION_COMMAND_DEFINITIONS, BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { createDriver } from '../src/index.mjs';
import { WebNorthbound } from '../src/web-northbound.mjs';

// ---------------------------------------------------------------------------
// Web-lane fixture (the phase12-web-northbound pattern: WebNorthbound over a fake application
// that records the forwarded args — the server-side analogue of the fake client).
// ---------------------------------------------------------------------------

const REPO = 'repo-wire-settle';
const ORIGIN = 'https://control.example.test';

// A representative D6 seven-key settle receipt (the shape detach:false reaches); the phantom
// member outcome carries the typed startError — the whole point of #232.
const SETTLE_RECEIPT = Object.freeze({
  basis: 'completed',
  harvest: [],
  manifestDigest: 'a'.repeat(64),
  outcomes: [{
    role: 'coordinator', phase: 'failed', terminal: true, resultSha: null,
    terminalCause: 'start',
    error: { code: 'workflow_member_start_failed', message: 'the typed start error' },
  }],
  steering: {},
  verdict: 'WAVE-INCOMPLETE',
  waveId: 'wave:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
});

const WEB_SPEC = Object.freeze({
  schemaVersion: 1,
  idempotencyKey: 'wsd-web-spec',
  members: [{
    role: 'coordinator',
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['reports/**'],
    objectiveRef: 'objectives/coordinator.md',
    report: 'reports/coordinator.md',
  }],
  steering: {},
  harvest: { paths: [] },
});

const webPrincipal = () => ({
  userId: 'user-1', sessionId: 'session-1', credentialId: 'cred-1', authMethod: 'cookie',
  csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
  capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO],
});
const webContext = () => ({
  principal: webPrincipal(), origin: ORIGIN, csrfToken: 'csrf-1',
  remoteAddress: '127.0.0.1', transport: 'https',
});

function makeWebFixture() {
  const calls = [];
  const application = {
    repoId: REPO,
    card: () => ({ schemaVersion: 1, repoId: REPO, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args) {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      return SETTLE_RECEIPT;
    },
  };
  const coordination = new CoordinationStore(mkdtempSync(join(tmpdir(), 'baton-wsd-web-')));
  const web = new WebNorthbound({
    coordinator: {}, coordination, repoIds: [REPO], allowedOrigins: [ORIGIN],
    now: () => Date.parse('2026-08-15T12:00:00.000Z'),
    application,
  });
  return { web, calls };
}

let commandSeq = 0;
function wavesRunEnvelope(args) {
  commandSeq += 1;
  return {
    schemaVersion: 1,
    commandId: `wsd-cmd-${commandSeq}`,
    idempotencyKey: `wsd-key-${commandSeq}`,
    command: 'waves_run',
    args,
    repoId: REPO,
    origin: ORIGIN,
  };
}

test('WS-1 (stage[unknown_argument_field]): waves_run with detach:false is admitted on the web wire and forwards detach to the application', async () => {
  const { web, calls } = makeWebFixture();
  const response = await web.execute(webContext(), wavesRunEnvelope({ spec: WEB_SPEC, detach: false }));
  assert.equal(response.status, 200,
    `stage[unknown_argument_field]: the wire must not refuse detach — got ${JSON.stringify(response.body)}`);
  assert.equal(calls.length, 1, 'exactly one application dispatch');
  assert.equal(calls[0].name, 'waves.run', 'the direct port maps to the dot-spelled application verb');
  assert.equal(calls[0].args.detach, false, 'detach:false is forwarded verbatim to the application');
  assert.deepEqual(response.body.result, SETTLE_RECEIPT,
    'the synchronous settle receipt (with the member startError) is the wire answer');
});

test('WS-2 (pin): waves_run without detach behaves exactly as today — no detach:false semantics forwarded', async () => {
  const { web, calls } = makeWebFixture();
  const response = await web.execute(webContext(), wavesRunEnvelope({ spec: WEB_SPEC }));
  assert.equal(response.status, 200, `the omitted-detach call still succeeds — ${JSON.stringify(response.body)}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.detach, undefined, 'no detach key (or undefined) rides the forwarded args');
  assert.deepEqual(response.body.result, SETTLE_RECEIPT);
});

// ---------------------------------------------------------------------------
// Application-lane fixture (the waves-run-detach-red pattern): the REAL BatonApplication —
// the direct port's closed normalizer is the argument authority for every surface.
// ---------------------------------------------------------------------------

const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400 });
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

function appRoot(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wsd-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

const principalOf = (id) => Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });

const PROFILE = Object.freeze({
  schemaVersion: 1, repoId: REPO, definitionOfDone: ['verification passes'],
  constraints: [], risk: 'low',
  goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: [],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536,
    requiredPredecessorEvidence: [],
  },
  routes: [ROUTE],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

async function makeApplicationFixture(t, key) {
  const repo = appRoot(`${key}-repo`);
  const logDir = appRoot(`${key}-log`);
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  writeFileSync(join(repo, 'objectives', 'coordinator.md'), 'write the coordinator report\n(marker:coordinator)\n');
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: {
      mock: new MockAdapter({
        harness: 'mock',
        scenariosByMarker: {
          coordinator: { outcome: 'completed', carryAttemptMarker: true, edits: [{ path: 'reports/coordinator.md', content: 'coordinator report\n' }] },
        },
      }),
    },
    stopDeadlineMs: 2_000,
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('wsd-planner'),
      dispatcher: principalOf('wsd-dispatcher'),
      observer: principalOf('wsd-observer'),
    },
    authorize: async () => true,
  });
  await application.ready;
  t.after(async () => {
    try { await application.shutdown(principalOf('wsd-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, driver };
}

const appSpec = (key) => ({
  schemaVersion: 1,
  idempotencyKey: key,
  members: [{
    role: 'coordinator',
    exact: { ...ROUTE },
    scope: ['reports/**'],
    objectiveRef: 'objectives/coordinator.md',
    report: 'reports/coordinator.md',
  }],
  steering: {},
  harvest: { paths: [] },
});

test('WS-3 (stage[detach-untyped]): a non-boolean detach refuses typed at the application normalizer, naming the field', async (t) => {
  const { application } = await makeApplicationFixture(t, 'ws3');
  await assert.rejects(
    application.command('waves.run', { spec: appSpec('wsd-ws3'), detach: 'yes' }, principalOf('wsd-owner')),
    (error) => error?.code === 'invalid_workflow_run' && /detach/u.test(String(error?.message)),
    'stage[detach-untyped]: a string detach must refuse typed (today it silently detaches)',
  );
});
