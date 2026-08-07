// #132 red-first suite — folded wave-observability contract v1.1 (issue #132).
// Authority: docs/reference/evidence/wave-observability-2026-08-06/
//   wave-observability-contract.md (v1.1 — source of truth), contract-fold.md (B1-B3 + F1-F8),
//   contract-redteam.md (the attack surface), suite-132-brief.md (this suite's brief).
//
// Twenty-six rows (22 red + 4 pins) over the v1.1 acceptance pins A1-A6: web admission round-trip
// per wave verb (D1 + F1 dot spellings + F2 stop narrowing + the WEB_DIRECT_PORT_COMMANDS validator
// skip), the registry projection (D2 + B1 top-level wave.closed fold + B2 legacy gate + exactly-once
// + OQ1 close-side pin), the waves.list row shape + §4 MCP enumeration drift (A3 + F1 card),
// cross-deployment liveness honesty scoped local-only (D3/B3 + F4), CLI parity (D4 + F5), and the
// #129 typed admission refusal on facade/web/MCP identically (D5 + F6/F7/F8).
//
// Red-first: written against the v1.1 contract BEFORE implementation; every red row fails for its
// named stage today and goes green on the contract's implementation ONLY. Pin rows are green today
// AND under the correct implementation, but fail a plausible WRONG one (the pin list below names
// the wrong implementation each pin kills). Fixture idiom mirrors wave-grammar-red.test.mjs
// (openHost = real createDriver + BatonApplication + bindBaton, markerAdapter, driverEvents),
// mcp-reflex-surface-red.test.mjs (McpFleetServer tools/list), and phase12-web-operator.test.mjs
// (WebSessionStore + HTTP get for the card).
//
// NUL-byte discipline: the two NUL files are never read whole — application.mjs is touched only
// through the imported APPLICATION_COMMAND_DEFINITIONS export (A1-7), coordination-store.mjs only
// via `grep -an 'wave.closed'` (A2-6). resident-authority.mjs and mcp-northbound.mjs are NUL-free
// and are read whole for the two source pins. This suite file contains 0 NUL bytes.
//
// No clocks: the only timestamps are the fixed NOW constant passed to the surfaces' clock/now hooks;
// every projection assertion rides event seqs only (G10). localeCompare is never used; sorted-key
// literals below are in ACTUAL sorted order.

// ===========================================================================
// ROW INVENTORY (the stage is the HEAD failure seam, named per row; the split at
// the bottom was measured against the PRE-implementation tree)
// ===========================================================================
//
// §A Web admission (stage: web-admission-missing / card-dot-spelling-missing / table-drift PIN)
//   A1-1  waves_start round-trips the web envelope; a control-less principal is refused 403. (RED)
//   A1-2  waves_progress round-trips (observe gate). (RED)
//   A1-3  waves_send round-trips (control gate). (RED)
//   A1-4  waves_stop round-trips (emergency_stop gate) and admits ONLY {reason, runId} (F2). (RED)
//   A1-5  waves_list round-trips (observe gate). (RED)
//   A1-6  the /v1/application-card lists the DOT spellings (F1), never the underscore transports. (RED)
//   A1-7  PIN — the byte-stable APPLICATION_COMMAND_DEFINITIONS key set is unchanged (the wave lane
//         stays WEB_DIRECT_PORT_COMMANDS direct ports; waves.attach stays the one table row; kills
//         an impl that registers the wave verbs as command-table entries and breaks grammar-m3 M3-8)
//
// §B Registry (stage: record-shape-missing / registry-read-missing / malformed-refusal-missing /
//    wave-closed-fold-missing)
//   A2-1  wave.started carries the extended projection payload {deploymentId, idempotencyKey,
//         roster: [{role, route, scope}], waveId} (D2.2/F3). (RED — no deploymentId at HEAD)
//   A2-2  PIN — a repeat start with the same idempotencyKey appends nothing (exactly-once,
//         coordination-store.mjs:1462-1463; kills an impl that loses the _byKey dedup or re-derives
//         a different waveId for the same key)
//   A2-3  waves.list reads the registry projection (open rows, this deployment) from the fold. (RED)
//   A2-4  legacy-store replay — a string-array roster replays clean and renders raw (B2/OQ4). (RED)
//   A2-5  a malformed NEW-shape roster refuses wave_registry_invalid (B2 strictness, store-integrity
//         throw). (RED — recordDriver does not fold at HEAD, so no throw)
//   A2-6  OQ1 — the close side pins a TOP-LEVEL wave.closed fold branch (B1), beside
//         context.pack_minted. (RED source pin — zero wave.closed references at HEAD)
//
// §C waves.list shape (§4 drift)
//   A3-1  waves.list rows are exactly {closedAtEventSeq, deploymentId, roster, startedAtEventSeq,
//         state, waveId}, paged ≤16 with {cursor, nextCursor}; per-member live reads. (RED)
//   A3-2  §4 — baton_waves_list lands in the pinned MCP enumeration (33 → 34, 0-based position 15
//         immediately after baton_waves_stop at 14). (RED — the pinned list is 33 at HEAD)
//
// §D Liveness (stage: registry-read-missing)
//   A4-1  every waves.list row reads local by construction (D3/B3 — the registry is per-deployment
//         private; remote/stale are deferred vocabulary, never fabricated). (RED)
//   A4-2  PIN — processState only ever reads 'active' for an exact match; 'unknown' (non-ESRCH/EPERM
//         kill error or failed/empty ps read) and 'stale' never guess 'remote' (F4; kills an impl
//         that maps unknown → remote)
//
// §E CLI parity (stage: cli-wave-verbs-missing / singular-corrective-verb / bare-attach-shape-missing)
//   A5-1  baton waves list parses to waves.list. (RED — the plural block only handles attach)
//   A5-2  baton waves progress WAVE_ID parses to waves.progress. (RED)
//   A5-3  singular `wave` refuses cli_command_unavailable with the plural corrective naming the
//         RIGHT verb. (RED — the corrective names "waves attach", not the requested action)
//   A5-4  a bare baton waves attach issues waves.list (F5), never the wave-ID-invalid refusal. (RED)
//
// §F #129 typed admission refusal (stage: run-less-success-shape / web-admission-missing /
//    stateFailureCode-degrade / allowlist-missing)
//   A6-1  the facade refuses an admission-exceeding waves.start with wave_member_invalid naming
//         {actual, cap, cause, role} (D5/F6). (RED — at HEAD the facade resolves with a run-less
//         wave handle, the #129 witness)
//   A6-2  the web surface refuses wave_member_invalid identically. (RED — the wave verb is not
//         admitted at HEAD, 400 invalid_command)
//   A6-3  the MCP surface refuses baton_waves_start with wave_member_invalid. (RED — the admission
//         refusal degrades to command_outcome_unknown at HEAD, stateFailureCode:260)
//   A6-4  F8 — wave_not_found is MCP-allowlisted, never a command_outcome_unknown degrade. (RED
//         source pin — zero references at HEAD)
//   A6-5  PIN — wave_registry_invalid stays a STORE-INTEGRITY throw, never an MCP per-command error
//         (F8; kills an impl that gives the store-integrity code a surface row)
//
// §4 drift OWNED (A3-2): the same +1 row (baton_waves_list at 0-based position 15, count 33 → 34)
// must land in the four pinned tool enumerations — mcp-reflex-surface-red.test.mjs:201-213,
// phase16-mcp-northbound.test.mjs:92-105, phase67-progressive-agent-experience.test.mjs:648-656,
// phase72-kimi-orchestrator-mcp.test.mjs:298-306 — and the /v1/application-card advertisement
// (web-northbound.mjs:1458) gains the dot-spelled wave lane (F1). Those edits are flagged in
// suite-draft-notes.md; this suite asserts the resulting contract shape here, at the source.

// ===========================================================================
// INVENTED SURFACES (all probed through REAL surface entry points — no invented
// module is imported; the invented members below are absent from the surfaces at HEAD)
// ===========================================================================
//
//   application.command('waves.list', args, principal)  — invented direct-port dispatch name
//     (HEAD: application_command_unavailable at application.mjs:1812)
//   web.execute(ctx, {command: 'waves_start'|'waves_progress'|'waves_send'|'waves_stop'|'waves_list'})
//     — invented web transports (HEAD: 400 invalid_command "unsupported command")
//   parseBatonCli(['waves','list'|'progress', ...]) / ['waves','attach']  — invented CLI verbs
//     (HEAD: cli_command_unavailable / cli_invalid)
//   McpFleetServer tools/list + tools/call 'baton_waves_list'  — invented MCP ordinary tool
//     (HEAD: 33-tool enumeration, no baton_waves_list)
//   embedded refusal code 'wave_member_invalid'  — invented typed admission refusal on the facade
//     (HEAD: the facade resolves with a run-less wave handle)

// ===========================================================================
// PIN LIST (green at HEAD AND under the correct implementation)
// ===========================================================================
//
//   A1-7  command-table byte-stability  — kills: wave verbs registered as APPLICATION_COMMAND_DEFINITIONS entries
//   A2-2  exactly-once by idempotency key — kills: lost _byKey dedup / non-deterministic waveId
//   A4-2  processState unknown → stale, never remote — kills: unknown mapped to a confident remote
//   A6-5  wave_registry_invalid is store-integrity only — kills: an MCP surface row for the code

// ===========================================================================
// VERIFIED SPLIT (measured against the PRE-implementation tree; run twice)
// ===========================================================================
//   PASS 4 · FAIL 22 — stable across two runs from the repo root
//   (split recorded in suite-draft-notes.md)

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MockAdapter } from '../src/adapter.mjs';
import { APPLICATION_COMMAND_DEFINITIONS, BatonApplication } from '../src/application.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import {
  bindBaton, createDriver, CoordinationStore, McpFleetServer, WebNorthbound, WebSessionStore,
} from '../src/index.mjs';
import { mcpApplicationToolNames } from '../src/mcp-northbound.mjs';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const ORIGIN = 'https://wave-obs.test';
const REPO_ID = 'repo-wave-132';
// limits.mjs:85 — spill.body, the ONE substrate ceiling that mints a hard refusal. An objective
// beyond it is the F7 admission refusal that FIRES at HEAD (never the spill-ADMITTED ≤1 MiB case).
const SPILL_BODY_CEILING = 1_048_576;
const BIG_OBJECTIVE = 'x'.repeat(SPILL_BODY_CEILING + 1);

let envelopeSeq = 0;

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-132-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: dir });
  return dir;
}

function principal(id, overrides = {}) {
  return Object.freeze({
    actor: 'test', principalId: id, sessionId: `session-${id}`,
    ...overrides,
  });
}

function waveIdFor(idempotencyKey) {
  return `wave:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

// The markerAdapter card override is required for exact-route admission (the run.start lane checks
// the deployment card's modelSelection before admitting the member route).
function markerAdapter() {
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'wave-observability-132', refreshedAt: null,
    },
  });
  return adapter;
}

function openHost(repo, logDir, adapter) {
  const driver = createDriver({
    repoRoot: repo,
    repoId: REPO_ID,
    logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1,
        repoId: REPO_ID,
        mandatory: true,
        approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO_ID,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1,
        repoId: REPO_ID,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('wave-owner'));
  return { application, baton, driver };
}

// Facade member shape (embedded surface): top-level harness/model/effort.
const member = (role, objective) => ({
  role,
  objective,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
});

// Direct-port member shape (waves.start / waves_attach): the closed `exact` route object.
const memberExact = (role, objective) => ({
  role, objective, exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
  scope: ['reports/**'],
});

function driverEvents(driver, kind, waveId = null) {
  return driver.coordination.events().filter((event) => (
    event.kind === 'driver.recorded' && event.payload?.kind === kind
    && (waveId === null || event.payload?.waveId === waveId)
  ));
}

async function hostFixture(t) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const host = openHost(repo, logDir, markerAdapter());
  host.repo = repo;
  host.logDir = logDir;
  host.owner = principal('wave-owner');
  t.after(async () => {
    await host.application.shutdown(principal('cleanup')).catch(() => {});
    try { host.driver.coordination.releaseWriterLease(); } catch { /* already released by shutdown */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return host;
}

async function startWave(host, ik, members) {
  return host.application.command('waves.start', { idempotencyKey: ik, members }, principal('wave-owner'));
}

// The invented waves.list read. At HEAD the direct-port dispatch branch does not exist, so
// application.command throws application_command_unavailable (application.mjs:1812) — the row fails
// cleanly at its named stage here, before any shape assertion runs.
async function readWavesList(host) {
  return host.application.command('waves.list', {}, principal('wave-owner')).catch((error) => {
    assert.equal(error.code, 'application_command_unavailable',
      'stage: registry-read-missing — at HEAD the waves.list surface does not exist; the direct-port dispatch branch (application.mjs:12329-12332) is absent');
    return null;
  });
}

function webFixture(t, host) {
  const web = new WebNorthbound({
    coordinator: {},
    coordination: new CoordinationStore(join(host.logDir, 'web-coord'), {
      clock: () => new Date(NOW).toISOString(),
    }),
    repoIds: [REPO_ID],
    allowedOrigins: [ORIGIN],
    now: () => NOW,
    application: host.application,
  });
  const webCtx = {
    principal: {
      userId: 'web-op', sessionId: 'web-sess', credentialId: 'web-cred',
      authMethod: 'cookie', csrfToken: 'csrf-132',
      expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
      capabilities: ['observe', 'control', 'emergency_stop'], repoIds: [REPO_ID],
    },
    origin: ORIGIN, csrfToken: 'csrf-132',
    remoteAddress: '127.0.0.1', transport: 'https',
  };
  return { web, webCtx };
}

async function mcpFixture(t, host) {
  const coordination = new CoordinationStore(join(host.logDir, 'mcp-coord'), {
    clock: () => new Date(NOW).toISOString(),
  });
  const server = new McpFleetServer({
    coordinator: {},
    coordination,
    application: host.application,
    surface: 'application',
    principal: {
      userId: 'mcp-op', sessionId: 'mcp-sess',
      capabilities: ['observe', 'control', 'emergency_stop'],
      repoIds: [REPO_ID],
      expiresAt: new Date(NOW + 60_000).toISOString(),
      revoked: false,
    },
    repoIds: [REPO_ID],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 64 * 1024,
    takeToolQuota: async () => ({ ok: true }),
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
  });
  const init = await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wave132', version: '0' } },
  });
  assert.ok(init?.result?.protocolVersion, 'mcp initialize resolves');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  t.after(async () => { await server.close().catch(() => {}); });
  return { server };
}

function waveEnvelope(command, args) {
  envelopeSeq += 1;
  return {
    schemaVersion: 1,
    commandId: `c132-${envelopeSeq}`,
    idempotencyKey: `ik132-${envelopeSeq}`,
    command,
    args,
    repoId: REPO_ID,
    origin: ORIGIN,
  };
}

// ── HTTP read helper (phase12-web-operator idiom) for the /v1/application-card row ─────────────
class Response {
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  end(body = '') { this.rawBody = body; this.body = JSON.parse(body); }
}
async function webGet(web, path, headers = {}) {
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'GET', url: path, headers,
    socket: { encrypted: true, remoteAddress: '127.0.0.1' }, destroy() {},
  });
  const res = new Response();
  await web.handle(req, res);
  return res;
}

// ===========================================================================
// §A — Web admission (D1)
// ===========================================================================

test('A1-1: waves_start round-trips the web envelope and the capability gate refuses a control-less principal', async (t) => {
  const host = await hostFixture(t);
  const { web, webCtx } = webFixture(t, host);
  const envelope = waveEnvelope('waves_start', {
    idempotencyKey: 'a1-1',
    members: [memberExact('alpha', 'write the alpha report')],
  });
  const res = await web.execute(webCtx, envelope);
  assert.equal(res.status, 200,
    'stage: web-admission-missing — at HEAD the wave verb is not admitted (400 invalid_command "unsupported command"); D1.1 admits waves_start with {idempotencyKey, members}');
  assert.equal(res.body?.ok, true, 'the admitted envelope dispatches');
  const controlLess = { ...webCtx, principal: { ...webCtx.principal, capabilities: ['observe'] } };
  const refused = await web.execute(controlLess, waveEnvelope('waves_start', {
    idempotencyKey: 'a1-1-cl',
    members: [memberExact('alpha', 'write the alpha report')],
  }));
  assert.equal(refused.status, 403, 'waves_start = [control, observe]; a control-less principal is refused 403 forbidden, never unsupported command (D1.3)');
});

test('A1-2: waves_progress round-trips the web envelope (observe gate)', async (t) => {
  const host = await hostFixture(t);
  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('waves_progress', { waveId: waveIdFor('a1-2'), cursor: 0 }));
  assert.equal(res.status, 200,
    'stage: web-admission-missing — at HEAD the wave verb is not admitted (400 invalid_command); D1.1 admits waves_progress with {cursor, waveId}');
  assert.equal(res.body?.ok, true);
});

test('A1-3: waves_send round-trips the web envelope (control gate)', async (t) => {
  const host = await hostFixture(t);
  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('waves_send', { runId: 'run-a', message: 'nudge' }));
  assert.equal(res.status, 200,
    'stage: web-admission-missing — at HEAD the wave verb is not admitted (400 invalid_command); D1.1 admits waves_send');
  assert.equal(res.body?.ok, true);
});

test('A1-4: waves_stop round-trips the web envelope and admits ONLY {reason, runId} (F2)', async (t) => {
  const host = await hostFixture(t);
  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('waves_stop', { runId: 'run-a', reason: 'complete' }));
  assert.equal(res.status, 200,
    'stage: web-admission-missing — at HEAD the wave verb is not admitted (400 invalid_command); D1.1 admits waves_stop with the closed {reason, runId} set');
  assert.equal(res.body?.ok, true);
  const narrowed = await web.execute(webCtx, waveEnvelope('waves_stop', { runId: 'run-a', delivery: 'now' }));
  const refusedToken = narrowed.body?.error?.message ?? narrowed.body?.error?.code ?? '';
  assert.equal(refusedToken, 'unknown_argument_field',
    'F2 — waves_stop admits only {reason, runId}; a web waves_stop carrying delivery/claimGrant/message is refused with the unknown_argument_field token (web-northbound.mjs:361-363; execute surfaces the validateEnvelope token at :708-711)');
});

test('A1-5: waves_list round-trips the web envelope (observe gate)', async (t) => {
  const host = await hostFixture(t);
  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('waves_list', {}));
  assert.equal(res.status, 200,
    'stage: web-admission-missing — at HEAD the wave verb is not admitted (400 invalid_command); D1.1 admits waves_list (observe-only)');
  assert.equal(res.body?.ok, true);
});

test('A1-6: the /v1/application-card lists the wave lane with DOT spellings, never the underscore transports (F1)', async (t) => {
  const host = await hostFixture(t);
  const sessions = new WebSessionStore(join(host.logDir, 'sessions'), { now: () => NOW });
  const web = new WebNorthbound({
    coordinator: {},
    coordination: new CoordinationStore(join(host.logDir, 'card-coord'), { clock: () => new Date(NOW).toISOString() }),
    sessions,
    application: host.application,
    repoIds: [REPO_ID],
    allowedOrigins: [ORIGIN],
    now: () => NOW,
  });
  const issued = sessions.issue({
    userId: 'card-op', authMethod: 'cookie',
    capabilities: ['observe', 'control', 'emergency_stop'], repoIds: [REPO_ID], ttlMs: 60_000,
  }, { actor: 'test' });
  const res = await webGet(web, '/v1/application-card', {
    cookie: `__Host-baton_session=${issued.token}`, 'sec-fetch-site': 'same-origin',
  });
  assert.equal(res.status, 200);
  const commands = res.body?.application?.commands ?? [];
  for (const dot of ['waves.start', 'waves.progress', 'waves.send', 'waves.stop', 'waves.list']) {
    assert.ok(commands.includes(dot),
      `stage: card-dot-spelling-missing — the card does not list '${dot}' at HEAD; F1 requires the ([, name]) => name DOT spellings over [...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES] (web-northbound.mjs:1458)`);
  }
  for (const underscore of ['waves_start', 'waves_progress', 'waves_send', 'waves_stop']) {
    assert.ok(!commands.includes(underscore), 'the card never lists the underscore transports (F1)');
  }
});

test('A1-7 PIN: the byte-stable APPLICATION_COMMAND_DEFINITIONS key set is unchanged (the wave lane stays direct ports)', () => {
  assert.equal(Object.keys(APPLICATION_COMMAND_DEFINITIONS).length, 26,
    'stage: table-drift — the grammar-m3 M3-8 guard pins 26 command-table keys; a wrong implementation that registers the wave verbs as table entries breaks it');
  for (const verb of ['waves.start', 'waves.progress', 'waves.send', 'waves.stop', 'waves.list']) {
    assert.equal(Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, verb), false,
      `${verb} stays a WEB_DIRECT_PORT_COMMANDS direct port (application.mjs:12329-12332), never a table row`);
  }
  assert.equal(Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, 'waves.attach'), true,
    'waves.attach stays the one table-registered wave row');
});

// ===========================================================================
// §B — Registry (D2)
// ===========================================================================

test('A2-1: wave.started carries the extended projection payload {deploymentId, idempotencyKey, roster: [{role, route, scope}], waveId} (D2.2/F3)', async (t) => {
  const host = await hostFixture(t);
  const wave = await startWave(host, 'a2-1', [memberExact('alpha', 'write the alpha report')]);
  const records = driverEvents(host.driver, 'wave.started', wave.waveId);
  assert.equal(records.length, 1);
  const payload = records[0].payload;
  assert.equal(payload.waveId, wave.waveId);
  assert.equal(typeof payload.deploymentId, 'string',
    'stage: record-shape-missing — the wave.started payload at HEAD has no deploymentId (application.mjs:4615-4619); F3 threads the resident deploymentId into the mint');
  assert.ok(Array.isArray(payload.roster) && payload.roster.every((m) => m && typeof m === 'object'),
    'stage: record-shape-missing — D2.2 pins a member-OBJECT roster [{role, route: {effort, harness, model}, scope}], not the legacy role-string array (application.mjs:11563)');
  const alpha = payload.roster.find((m) => m.role === 'alpha');
  assert.equal(alpha.route.harness, 'mock');
  assert.deepEqual(alpha.route, { effort: 'low', harness: 'mock', model: 'mock-model' });
  assert.deepEqual(alpha.scope, ['reports/**']);
});

test('A2-2 PIN: a repeat start with the same idempotencyKey appends nothing (exactly-once)', async (t) => {
  const host = await hostFixture(t);
  const members = [memberExact('alpha', 'write the alpha report')];
  const first = await startWave(host, 'a2-2', members);
  const second = await startWave(host, 'a2-2', members);
  assert.equal(second.waveId, first.waveId, 'the same idempotencyKey resolves to the same waveId');
  assert.equal(driverEvents(host.driver, 'wave.started', first.waveId).length, 1,
    'exactly one wave.started record — _append key dedup (coordination-store.mjs:1462-1463) holds across repeat starts');
});

test('A2-3: waves.list reads the registry projection — open rows for THIS deployment', async (t) => {
  const host = await hostFixture(t);
  const wave = await startWave(host, 'a2-3', [memberExact('alpha', 'write the alpha report')]);
  const listed = await readWavesList(host);
  assert.ok(listed !== null, 'the registry read resolves');
  assert.equal(listed.waves.length, 1, 'the started wave is the open row');
  const row = listed.waves[0];
  assert.equal(row.waveId, wave.waveId);
  assert.equal(row.state, 'open');
  assert.equal(row.startedAtEventSeq, driverEvents(host.driver, 'wave.started', wave.waveId)[0].seq,
    'startedAtEventSeq is the record\'s OWN event seq (D9 G10 — no wall-clock claim)');
  assert.equal(row.closedAtEventSeq, null);
  assert.equal(typeof row.deploymentId, 'string');
  assert.ok(Array.isArray(row.roster));
});

test('A2-4: legacy-store replay — a string-array roster replays clean and renders raw (B2/OQ4)', async (t) => {
  const host = await hostFixture(t);
  const legacyWaveId = waveIdFor('legacy-store');
  const recorded = host.driver.coordination.recordDriver('wave.started', {
    waveId: legacyWaveId, roster: ['alpha', 'beta'], idempotencyKey: 'legacy-ik',
  }, { actor: 'test', key: `wave.started:${legacyWaveId}` });
  assert.equal(recorded.ok, true,
    'the legacy append is accepted — the B2 gate shape-checks BEFORE strictness and never refuses a well-formed legacy string-array roster');
  const listed = await readWavesList(host);
  assert.ok(listed !== null, 'the registry read resolves');
  const row = listed.waves.find((w) => w.waveId === legacyWaveId);
  assert.ok(row, 'the legacy row is present');
  assert.deepEqual(row.roster.map((m) => m.role), ['alpha', 'beta']);
  for (const m of row.roster) {
    assert.equal(m.route, null, 'a legacy-string member renders route: null');
    assert.equal(m.scope, null, 'a legacy-string member renders scope: null');
  }
});

test('A2-5: a malformed NEW-shape roster refuses wave_registry_invalid (B2 strictness)', async (t) => {
  const host = await hostFixture(t);
  const malformedWaveId = waveIdFor('malformed');
  assert.throws(
    () => host.driver.coordination.recordDriver('wave.started', {
      waveId: malformedWaveId, roster: 'not-an-array', idempotencyKey: 'bad-ik',
    }, { actor: 'test', key: `wave.started:${malformedWaveId}` }),
    (error) => {
      assert.equal(error.code, 'coordination_projection_poisoned',
        'stage: malformed-refusal-missing — at HEAD recordDriver does not fold wave.started at all, so the malformed append succeeds; the B2 fold throws wave_registry_invalid, wrapped by _poisonProjection (coordination-store.mjs:1480-1481)');
      assert.equal(error.cause?.code, 'wave_registry_invalid',
        'the store-integrity code rides the poison\'s cause — the ledger stays authoritative, replay is required');
      return true;
    },
  );
});

test('A2-6 OQ1: the close side pins a TOP-LEVEL wave.closed fold branch beside context.pack_minted (B1)', () => {
  let out = '';
  try {
    out = execFileSync('grep', ['-an', 'wave.closed',
      fileURLToPath(new URL('../src/coordination-store.mjs', import.meta.url))],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) { out = error?.stdout?.toString?.() ?? ''; }
  assert.ok(out.includes('wave.closed'),
    'stage: wave-closed-fold-missing — at HEAD the coordination store has zero wave.closed references; B1 folds event.kind === "wave.closed" at the TOP LEVEL of _apply, beside context.pack_minted (coordination-store.mjs:8727-8731), consuming #103\'s actual record');
});

// ===========================================================================
// §C — waves.list shape + §4 drift (A3)
// ===========================================================================

test('A3-1: waves.list rows carry the exact registry shape and page ≤16 with {cursor, nextCursor}', async (t) => {
  const host = await hostFixture(t);
  const wave = await startWave(host, 'a3-1', [memberExact('alpha', 'write the alpha report')]);
  const listed = await readWavesList(host);
  assert.ok(listed !== null, 'the registry read resolves');
  assert.equal(listed.waves.length, 1);
  const row = listed.waves[0];
  assert.deepEqual(Object.keys(row).sort(),
    ['closedAtEventSeq', 'deploymentId', 'roster', 'startedAtEventSeq', 'state', 'waveId'],
    'the row is exactly the D2.3 closed shape (sorted-key literal in ACTUAL sorted order)');
  assert.equal(row.state, 'open');
  const alpha = row.roster.find((m) => m.role === 'alpha');
  assert.ok(alpha, 'the per-member render is present');
  assert.deepEqual(Object.keys(alpha).sort(),
    ['attentionCount', 'liveness', 'phase', 'progressClass', 'role'],
    'per-member shape is exactly {attentionCount, liveness, phase, progressClass, role} (D3)');
  assert.equal(alpha.liveness, 'local');
  assert.equal(typeof alpha.attentionCount, 'number');
  assert.equal(listed.cursor, 0, 'pagination starts at cursor 0');
  assert.equal(listed.nextCursor, null, 'one open row does not page');
  // The paging cap (D2.4, ≤16 rows with an explicit nextCursor) is exercised for real: 17 open rows
  // must page as 16 + nextCursor, and the second page drains the remaining row.
  for (let i = 1; i < 17; i += 1) {
    await startWave(host, `a3-1-p${i}`, [memberExact('alpha', `page row ${i}`)]);
  }
  const pageOne = await host.application.command('waves.list', {}, principal('wave-owner')).catch(() => null);
  assert.ok(pageOne !== null, 'the paged read resolves');
  assert.equal(pageOne.waves.length, 16, 'a page is exactly 16 open rows');
  assert.ok(pageOne.nextCursor !== null, '17 open rows page — nextCursor is set');
  const pageTwo = await host.application.command('waves.list', { cursor: pageOne.nextCursor }, principal('wave-owner')).catch(() => null);
  assert.ok(pageTwo !== null, 'the cursor read resolves');
  assert.equal(pageTwo.waves.length, 1, 'the second page drains the remaining row');
  assert.equal(pageTwo.nextCursor, null, 'the last page closes the cursor');
});

test('A3-2 §4: baton_waves_list lands in the pinned MCP enumeration — 33 → 34, position 15 after baton_waves_stop', async (t) => {
  const host = await hostFixture(t);
  const { server } = await mcpFixture(t, host);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = listed.result.tools.map((tool) => tool.name);
  assert.equal(names.length, 34,
    'stage: mcp-waves-list-row-missing — the pinned MCP enumeration is 33 at HEAD (mcp-reflex-surface-red.test.mjs:201); §4 inserts baton_waves_list (33 → 34)');
  assert.equal(names[14], 'baton_waves_stop', 'baton_waves_stop stays at 0-based position 14');
  assert.equal(names[15], 'baton_waves_list',
    'baton_waves_list sits at 0-based position 15, immediately after baton_waves_stop — the §4 pinned insertion point');
  const sorted = mcpApplicationToolNames();
  assert.equal(sorted.length, 34, 'the sorted ordinary surface grows to 34 tools');
  assert.ok(sorted.includes('baton_waves_list'), 'the sorted ordinary surface carries baton_waves_list');
});

// ===========================================================================
// §D — Liveness (D3/B3/F4)
// ===========================================================================

test('A4-1: waves.list rows read local by construction — remote/stale are deferred vocabulary, never fabricated (B3)', async (t) => {
  const host = await hostFixture(t);
  const wave = await startWave(host, 'a4-1', [memberExact('alpha', 'write the alpha report')]);
  const listed = await readWavesList(host);
  assert.ok(listed !== null, 'the registry read resolves');
  const row = listed.waves.find((w) => w.waveId === wave.waveId);
  assert.ok(row, 'this deployment row is present');
  assert.equal(typeof row.deploymentId, 'string', 'the row carries THIS deployment id — every v1.0 row is local by construction (the registry is per-deployment private)');
  const alpha = row.roster.find((m) => m.role === 'alpha');
  assert.equal(alpha.liveness, 'local', 'per-member liveness reads local; remote/stale are explicitly deferred in v1.0');
  for (const key of Object.keys(row)) {
    assert.ok(key !== 'remote' && key !== 'stale', 'no remote/stale vocabulary is fabricated on the row');
  }
});

test('A4-2 PIN: processState only reads \'active\' on an exact match — \'unknown\' reads stale, never a guessed \'remote\' (F4)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/resident-authority.mjs', import.meta.url)), 'utf8');
  assert.ok(!src.includes('return \'remote\''),
    'the liveness vocabulary never guesses remote (resident-authority.mjs)');
  const unknownCount = (src.match(/return 'unknown'/g) ?? []).length;
  assert.ok(unknownCount >= 2,
    'both the non-ESRCH/EPERM process.kill path (resident-authority.mjs:56) and the failed/empty ps -o lstart= read (:60) return unknown');
  assert.ok(src.includes('observed === expectedStart ? \'active\' : \'stale\''),
    'only exactly \'active\' can ever produce a future remote; \'unknown\' reads stale (F4)');
});

// ===========================================================================
// §E — CLI parity (D4)
// ===========================================================================

test('A5-1: baton waves list parses to waves.list (D4)', () => {
  const parsed = parseBatonCli(['waves', 'list']);
  assert.equal(parsed.kind, 'command',
    'stage: cli-wave-verbs-missing — at HEAD the plural block only handles attach (application-cli.mjs:1316-1321), so this throws cli_command_unavailable');
  assert.equal(parsed.name, 'waves.list');
  assert.deepEqual(parsed.args, {});
});

test('A5-2: baton waves progress WAVE_ID parses to waves.progress (D4)', () => {
  const waveId = 'wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const parsed = parseBatonCli(['waves', 'progress', waveId]);
  assert.equal(parsed.kind, 'command',
    'stage: cli-wave-verbs-missing — at HEAD the plural block only handles attach, so this throws cli_command_unavailable');
  assert.equal(parsed.name, 'waves.progress');
  assert.deepEqual(parsed.args, { waveId });
});

test('A5-3: singular wave refuses cli_command_unavailable with the plural corrective naming the RIGHT verb (D4)', () => {
  assert.throws(
    () => parseBatonCli(['wave', 'list']),
    (error) => {
      assert.equal(error.code, 'cli_command_unavailable');
      assert.match(error.message, /waves list/u,
        'stage: singular-corrective-verb — at HEAD the singular corrective names "waves attach" (application-cli.mjs:1312), not the plural verb for the requested action');
      return true;
    },
  );
});

test('A5-4: a bare baton waves attach issues waves.list — never the wave-ID-invalid refusal (F5)', () => {
  const parsed = parseBatonCli(['waves', 'attach']);
  assert.equal(parsed.kind, 'command',
    'stage: bare-attach-shape-missing — at HEAD a bare attach throws cli_invalid "wave ID is invalid" (application-cli.mjs:1328); F5 pins the issued shape {kind: \'command\', name: \'waves.list\', args: {}}');
  assert.equal(parsed.name, 'waves.list');
  assert.deepEqual(parsed.args, {});
});

// ===========================================================================
// §F — #129 typed admission refusal (D5/F6/F7/F8)
// ===========================================================================

test('A6-1: the facade refuses an admission-exceeding waves.start with wave_member_invalid naming {actual, cap, cause, role} (D5/F6)', async (t) => {
  const host = await hostFixture(t);
  const members = [member('alpha', BIG_OBJECTIVE)];
  await assert.rejects(
    host.baton.waves.start({ repoRoot: host.repo, idempotencyKey: 'a6-1', members }),
    (error) => {
      assert.equal(error.code, 'wave_member_invalid',
        'stage: run-less-success-shape — at HEAD the facade resolves with a run-less wave handle (the #129 witness, createWave catches per-member errors into entry.startError); D5.1 refuses instead');
      const detail = error.detail ?? error;
      assert.equal(detail.cap, SPILL_BODY_CEILING, 'the refusal names the spill.body ceiling');
      assert.ok(Number.isInteger(detail.actual) && detail.actual > SPILL_BODY_CEILING, 'the refusal names the actual size');
      assert.equal(detail.role, 'alpha', 'the refusal names the offending member role');
      assert.equal(detail.cause?.code, 'spill_body_exceeded', 'the inner admission code is preserved in cause');
      return true;
    },
  );
});

test('A6-2: the web surface refuses wave_member_invalid with the surface-constant code (D5)', async (t) => {
  const host = await hostFixture(t);
  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('waves_start', {
    idempotencyKey: 'a6-2',
    members: [memberExact('alpha', BIG_OBJECTIVE)],
  }));
  assert.equal(res.body?.error?.code, 'wave_member_invalid',
    'stage: web-admission-missing — at HEAD the wave verb is not admitted at all (400 invalid_command "unsupported command"); D5 maps wave_member_invalid onto the admitted web body');
});

test('A6-3: the MCP surface refuses baton_waves_start with wave_member_invalid (D5/F8)', async (t) => {
  const host = await hostFixture(t);
  const { server } = await mcpFixture(t, host);
  const call = await server.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: {
      name: 'baton_waves_start',
      arguments: {
        repoId: REPO_ID,
        idempotencyKey: 'a6-3',
        members: [memberExact('alpha', BIG_OBJECTIVE)],
      },
    },
  });
  assert.equal(call.result?.isError, true);
  const parsed = JSON.parse(call.result.content[0].text);
  assert.equal(parsed.error?.code, 'wave_member_invalid',
    'stage: stateFailureCode-degrade — at HEAD the admission refusal degrades to command_outcome_unknown (mcp-northbound.mjs:260); D5 allowlists wave_member_invalid in stateFailureCode');
  assert.ok(typeof parsed.error?.message === 'string', 'the typed refusal carries the pinned {code, message} payload');
});

test('A6-4 F8: wave_not_found is MCP-allowlisted — never a command_outcome_unknown degrade', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/mcp-northbound.mjs', import.meta.url)), 'utf8');
  assert.ok(src.includes('wave_not_found'),
    'stage: allowlist-missing — at HEAD mcp-northbound.mjs has zero wave_not_found references; F8 adds it to the stateFailureCode allowlist (mcp-northbound.mjs:198+) so baton_waves_list can name the missing wave');
});

test('A6-5 PIN: wave_registry_invalid stays a STORE-INTEGRITY throw — never an MCP per-command error (F8)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/mcp-northbound.mjs', import.meta.url)), 'utf8');
  assert.ok(!src.includes('wave_registry_invalid'),
    'the store-integrity code (B2) never gains an MCP surface row (F8)');
});
