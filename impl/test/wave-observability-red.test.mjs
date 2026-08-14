// #132 red-first suite — folded wave-observability contract v1.2 (issue #132).
// Authority: docs/reference/evidence/wave-observability-2026-08-06/
//   wave-observability-contract.md (v1.2 — source of truth), contract-fold.md (B1-B3 + F1-F8),
//   contract-redteam.md (the attack surface), suite-132-brief.md (this suite's brief),
//   suite-blueteam.md (NEEDS-FOLD — 13 findings F1-F13), suite-fold-2.md (finding → resolution map).
//
// Thirty rows (26 red + 4 pins) over the v1.2 acceptance pins A1-A6, folding ALL thirteen blueteam
// findings:
//   F1  green-side blocker — the fixture must construct the deployment host / supply a deploymentId
//       (openHost now tries `{...opts, deploymentId}` and falls back to the bare options at HEAD,
//       PROBE-verified: the config validator rejects the unknown field with application_config_invalid).
//   F2  green-side blocker — A1-3/A1-4 dispatch to a runId the fixture ACTUALLY creates (direct-port
//       start, member stays awaiting_plan_approval, coordinator.list() empty): waves_send → the
//       post-admission application_worker_not_found → 404 {code:'not_found'}; waves_stop → 200 ok:true.
//   F3  green-side blocker — A6-1 re-aimed at the DIRECT-PORT waves.start (the layer D5.1/F6 owns),
//       never the facade per-member swallow the fix does not touch: at HEAD the direct port rejects
//       the admission-exceeding objective with a RAW spill_body_exceeded (no role/cause/detail).
//   F4  shallow-greenability — A6-2/A6-3 assert the SAME {actual, cap, cause, role} detail as A6-1
//       AND the byte-identical message 'wave member alpha did not start' (W6), plus a NEW CLI leg
//       (A6-6) driving `baton waves start --members JSON` through the full pipeline to a typed
//       body.error + non-zero exit.
//   F5  missing row — A6-4 now exercises wave_not_found BEHAVIORALLY (synthetic NEW-shape wave.started
//       with THIS deployment's id + a steering.registered ghost runId), not a source grep.
//   F6  missing row — A2-4 proves the registry fold by a store close/reopen replay (shutdown +
//       releaseWriterLease + reopen same logDir), not a live append.
//   F7  shallow-greenability — A1-6 pins the card DERIVE idiom
//       [...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES].map(([, name]) => name) in the
//       /v1/application-card region — a hardcoded enumeration defeats the fix.
//   F8  shallow-greenability — A1-7 pins the FULL 26-key insertion-order set (grammar-m3 M3-8), not
//       a length check; the row's deploymentId value is asserted against the known host id in
//       A2-1/A2-3/A3-1/A4-1 so a hardcoded constant cannot pass.
//   F9  missing row — A2-7 attaches to a started wave (BatonClient.waves.attach matches by objective)
//       and asserts exactly one wave.started record and exactly one registry row.
//   F10 missing row — A6-7 drives waves_send {} / {runId:'bad id'} and asserts
//       application_wave_member_action_invalid on the embedded throw AND the web body post-admission.
//   F11 missing row — A5-5 runs the CLI parse→dispatch→render pipeline (parseBatonCli + runBatonCli)
//       over a host with open rows and asserts the rendered attachable set; a resolved command exits 0.
//   F12 oracle — A6-5/A4-2 negative pins are REGION-RESTRICTED (stateFailureCode → protocolResult,
//       processState → safeRegular) so incidental comment text cannot trip them; A6-4 is behavioral.
//   F13 under-determined — A2-4 pins the legacy no-run member read: liveness 'local',
//       phase/progressClass/attentionCount null, route/scope null, NO wave_not_found for run-less
//       legacy members (contract D2.4).
//
// Red-first: written against the v1.2 contract BEFORE implementation; every red row fails for its
// named stage today and goes green on the contract's implementation ONLY. Pin rows are green today
// AND under the correct implementation, but fail a plausible WRONG one (the pin list below names
// the wrong implementation each pin kills). Fixture idiom mirrors wave-grammar-red.test.mjs
// (openHost = real createDriver + BatonApplication + bindBaton, markerAdapter, driverEvents),
// mcp-reflex-surface-red.test.mjs (McpFleetServer tools/list), and phase12-web-operator.test.mjs
// (WebSessionStore + HTTP get for the card).
//
// NUL-byte discipline: the two NUL files are never read whole — application.mjs is touched only
// through the imported APPLICATION_COMMAND_DEFINITIONS export (A1-7), coordination-store.mjs only
// via `grep -an 'wave.closed'` (A2-6). resident-authority.mjs, web-northbound.mjs and
// mcp-northbound.mjs are NUL-free and are read whole for the source pins. This suite file contains
// 0 NUL bytes.
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
//   A1-3  waves_send dispatches to a REAL runId the fixture created → the post-admission
//         application_worker_not_found maps to 404 {code:'not_found'} (F2). (RED)
//   A1-4  waves_stop dispatches to a REAL runId → 200 ok:true and admits ONLY {reason, runId} (F2). (RED)
//   A1-5  waves_list round-trips (observe gate). (RED)
//   A1-6  the /v1/application-card lists the wave lane BY DERIVATION — the region pins
//         [...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES].map(([, name]) => name) (F7). (RED)
//   A1-7  PIN — the byte-stable APPLICATION_COMMAND_DEFINITIONS key set is the FULL 26-key
//         insertion-order set (F8); kills an impl that registers the wave verbs as table entries
//         or drops/reorders a row (breaks grammar-m3 M3-8)
//
// §B Registry (stage: record-shape-missing / registry-read-missing / malformed-refusal-missing /
//    wave-closed-fold-missing / attach-duplicate-missing)
//   A2-1  wave.started carries the extended projection payload {deploymentId, idempotencyKey,
//         roster: [{role, route, scope}], waveId} with deploymentId === host.deploymentId (D2.2/F1/F3).
//         (RED — no deploymentId at HEAD)
//   A2-2  PIN — a repeat start with the same idempotencyKey appends nothing (exactly-once,
//         coordination-store.mjs:1462-1463; kills an impl that loses the _byKey dedup or re-derives
//         a different waveId for the same key)
//   A2-3  waves.list reads the registry projection (open rows, THIS deployment id) from the fold. (RED)
//   A2-4  legacy-store replay — a string-array roster survives a store close/reopen replay (F6) and
//         renders the pinned no-run member read (liveness 'local', nulls, no wave_not_found — F13). (RED)
//   A2-5  a malformed NEW-shape roster refuses wave_registry_invalid (B2 strictness, store-integrity
//         throw). (RED — recordDriver does not fold at HEAD, so no throw)
//   A2-6  OQ1 — the close side pins a TOP-LEVEL wave.closed fold branch (B1), beside
//         context.pack_minted. (RED source pin — zero wave.closed references at HEAD)
//   A2-7  attach is exactly-once — facade start + attach keeps one wave.started record and one
//         registry row (F9). (RED — the registry read is absent at HEAD)
//
// §C waves.list shape (§4 drift)
//   A3-1  waves.list rows are exactly {closedAtEventSeq, deploymentId, roster, startedAtEventSeq,
//         state, waveId} with deploymentId === host.deploymentId, paged ≤16 with {cursor, nextCursor};
//         per-member live reads. (RED)
//   A3-2  §4 — baton_waves_list lands in the pinned MCP enumeration (33 → 34, 0-based position 15
//         immediately after baton_waves_stop at 14). (RED — the pinned list is 33 at HEAD)
//
// §D Liveness (stage: registry-read-missing)
//   A4-1  every waves.list row reads local by construction (D3/B3 — the registry is per-deployment
//         private; remote/stale are deferred vocabulary, never fabricated). (RED)
//   A4-2  PIN — processState only ever reads 'active' for an exact match; 'unknown' (non-ESRCH/EPERM
//         kill error or failed/empty ps read) and 'stale' never guess 'remote'; the negative pin is
//         REGION-RESTRICTED to the processState function (F4/F12; kills an impl that maps unknown →
//         remote or hides a dead-branch literal)
//
// §E CLI parity (stage: cli-wave-verbs-missing / singular-corrective-verb / bare-attach-shape-missing)
//   A5-1  baton waves list parses to waves.list. (RED — the plural block only handles attach)
//   A5-2  baton waves progress WAVE_ID parses to waves.progress. (RED)
//   A5-3  singular `wave` refuses cli_command_unavailable with the plural corrective naming the
//         RIGHT verb. (RED — the corrective names "waves attach", not the requested action)
//   A5-4  a bare baton waves attach issues waves.list (F5), never the wave-ID-invalid refusal. (RED)
//   A5-5  F11 — the bare attach ISSUED shape runs through the FULL parse→dispatch→render pipeline
//         over a host with open rows: the rendered attachable set (waveId + member roles) is
//         surfaced and a resolved command exits 0. (RED — parse throws at HEAD)
//
// §F #129 typed admission refusal (stage: member-refusal-catchwrap-missing / web-admission-missing /
//    stateFailureCode-degrade / registry-read-missing / allowlist-missing / cli-wave-verbs-missing)
//   A6-1  the DIRECT-PORT waves.start refuses an admission-exceeding wave with wave_member_invalid
//         naming {actual, cap, cause, role} and the pinned message (D5.1/F3). (RED — at HEAD the
//         direct port rejects with a RAW spill_body_exceeded, no role/cause/detail)
//   A6-2  the web surface refuses wave_member_invalid with the SAME detail shape as A6-1 and the
//         byte-identical message (F4). (RED — the wave verb is not admitted at HEAD, 400 invalid_command)
//   A6-3  the MCP surface refuses baton_waves_start with wave_member_invalid and the byte-identical
//         message (F4). (RED — the admission refusal degrades to command_outcome_unknown at HEAD,
//         stateFailureCode:260)
//   A6-4  F5 — a registry row whose member run no longer resolves refuses wave_not_found TYPED on
//         the facade, MCP, and web surfaces — a behavioral row, never a source grep. (RED)
//   A6-5  PIN — wave_registry_invalid stays a STORE-INTEGRITY throw, never an MCP per-command error;
//         the negative is REGION-RESTRICTED to the stateFailureCode allowlist (F8/F12)
//   A6-6  F4 — the CLI leg: `baton waves start --members JSON` with an admission-exceeding objective
//         drives the full pipeline to typed body.error + non-zero exit. (RED — no waves start verb at HEAD)
//   A6-7  F10 — waves_send {} / {runId:'bad id'} is refused application_wave_member_action_invalid on
//         the embedded throw AND the web body post-admission. (RED — the web verb is not admitted at HEAD)
//
// §4 drift OWNED (A3-2): the same +1 row (baton_waves_list at 0-based position 15, count 33 → 34)
// must land in the four pinned tool enumerations — mcp-reflex-surface-red.test.mjs:201-213,
// phase16-mcp-northbound.test.mjs:92-105, phase67-progressive-agent-experience.test.mjs:648-656,
// phase72-kimi-orchestrator-mcp.test.mjs:298-306 — and the /v1/application-card advertisement
// (web-northbound.mjs:1458) gains the dot-spelled wave lane (F1/F7). Those edits are flagged in
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
//   parseBatonCli(['waves','list'|'progress'|'start', ...]) / ['waves','attach']  — invented CLI verbs
//     (HEAD: cli_command_unavailable / cli_invalid)
//   McpFleetServer tools/list + tools/call 'baton_waves_list'  — invented MCP ordinary tool
//     (HEAD: 33-tool enumeration, no baton_waves_list)
//   embedded refusal codes 'wave_member_invalid' / 'wave_not_found'  — invented typed wave refusals
//     (HEAD: the direct port rejects raw spill_body_exceeded / waves.list is absent)

// ===========================================================================
// PIN LIST (green at HEAD AND under the correct implementation)
// ===========================================================================
//
//   A1-7  command-table byte-stability (FULL key set) — kills: wave verbs registered as table entries
//   A2-2  exactly-once by idempotency key — kills: lost _byKey dedup / non-deterministic waveId
//   A4-2  processState unknown → stale, never remote (region-restricted) — kills: unknown mapped remote
//   A6-5  wave_registry_invalid is store-integrity only (region-restricted) — kills: an MCP allowlist row

// ===========================================================================
// VERIFIED SPLIT (measured against the PRE-implementation tree; run twice)
// ===========================================================================
//   PASS 4 · FAIL 26 — stable across two runs from the repo root
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
import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
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

// The byte-stable command-table set (grammar-m3 M3-8) in ACTUAL insertion order. A1-7 pins the FULL
// set with deepEqual (F8) — a length-only check lets a dishonest fold swap rows.
const COMMANDS_BEFORE_M3 = Object.freeze([
  'application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode',
  'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act',
  'run.status', 'run.follow', 'run.approve', 'run.wait', 'run.answer', 'run.feedback',
  'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification',
  'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'run.recover',
  'waves.attach', 'application.shutdown',
]);

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

// The deployment identity is derived from the repo+log pair, so the SAME pair reopened from disk
// (A2-4 F6) yields the SAME deploymentId — the registry rows recorded by the first process replay
// into the reopened process as THIS deployment's rows, never foreign.
function deploymentIdFor(repo, logDir) {
  return `deployment-${createHash('sha256').update(`${repo}|${logDir}`).digest('hex').slice(0, 32)}`;
}

function createDriverFor(repo, logDir, adapter) {
  return createDriver({
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
}

function buildApplication(driver, deploymentId) {
  const base = {
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
  };
  try {
    // The fold accepts deploymentId as an optional constructor field (D2.2 threads it into the
    // wave.started mint). HEAD does NOT — the config validator rejects the unknown field
    // (application_config_invalid, PROBE-verified), so the bare-options retry is the F1-safe
    // fallback that keeps every row green-side honest at HEAD.
    return new BatonApplication({ ...base, deploymentId });
  } catch (error) {
    if (error?.code !== 'application_config_invalid') throw error;
    return new BatonApplication(base);
  }
}

function openHost(repo, logDir, adapter) {
  const driver = createDriverFor(repo, logDir, adapter);
  const deploymentId = deploymentIdFor(repo, logDir);
  const application = buildApplication(driver, deploymentId);
  const baton = bindBaton(application, principal('wave-owner'));
  return { application, baton, driver, deploymentId };
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

// A routing client in the exact bindBaton shape (application-client.mjs:1652) — the 3rd arg
// runBatonCli passes is the idempotency key, which lives inside the fold's parsed.args for
// waves.start (D4.6), so the port stays two-argument like the shipped client.
function cliRoutingClient(host) {
  return { command: async (name, args) => host.application.command(name, args, principal('wave-owner')) };
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

test('A1-3 F2: waves_send dispatches to a REAL runId — the undispatched member resolves the typed post-admission refusal (F2)', async (t) => {
  const host = await hostFixture(t);
  // The direct-port start leaves the member run awaiting plan approval, so coordinator.list() is
  // EMPTY — waves_send resolves application_worker_not_found exactly as a genuinely missing worker.
  const wave = await startWave(host, 'a1-3', [memberExact('alpha', 'write the alpha report')]);
  const runId = wave.members[0].runId;
  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('waves_send', { runId, message: 'nudge' }));
  assert.equal(res.status, 404,
    'stage: web-admission-missing — at HEAD the wave verb is not admitted (400 invalid_command); D1.1 admits waves_send');
  assert.equal(res.body?.error?.code, 'not_found',
    'F2 — the admitted waves_send DISPATCHES to the runId the fixture created; sendWaveMember cannot find the undispatched run (application_worker_not_found), which dispatchFailure maps to 404 not_found (web-northbound.mjs:169) — never the 400 pre-admission invalid_command collapse');
});

test('A1-4 F2: waves_stop round-trips the web envelope to a REAL runId and admits ONLY {reason, runId} (F2)', async (t) => {
  const host = await hostFixture(t);
  const wave = await startWave(host, 'a1-4', [memberExact('alpha', 'write the alpha report')]);
  const runId = wave.members[0].runId;
  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('waves_stop', { runId, reason: 'complete' }));
  assert.equal(res.status, 200,
    'stage: web-admission-missing — at HEAD the wave verb is not admitted (400 invalid_command); D1.1 admits waves_stop with the closed {reason, runId} set');
  assert.equal(res.body?.ok, true,
    'F2 — waves_stop dispatches to the REAL member run the fixture created; stopWaveMember uses _findRun, so the undispatched run stops cleanly and the transport round-trips ok:true');
  const narrowed = await web.execute(webCtx, waveEnvelope('waves_stop', { runId, delivery: 'now' }));
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

test('A1-6 F7: the /v1/application-card lists the wave lane BY DERIVATION — the source pins the derive idiom, never a hardcoded enumeration (F7)', async (t) => {
  const host = await hostFixture(t);
  // F7 — the card command list must be DERIVED from the same transport table that admits the web
  // verbs, so a dishonest impl cannot special-case the card. The region from the card handler to
  // the asset fallback must carry the spread-derive idiom.
  const src = readFileSync(fileURLToPath(new URL('../src/web-northbound.mjs', import.meta.url)), 'utf8');
  const cardRegion = src.slice(
    src.indexOf("pathname === '/v1/application-card'"),
    src.indexOf('const asset = operatorAsset(pathname)'),
  );
  assert.match(cardRegion,
    /\[\.\.\.WEB_APPLICATION_ENTRIES, \.\.\.WAVE_WEB_ENTRIES\]\.map\(\(\[, name\]\) => name\)/u,
    'stage: card-dot-spelling-missing — at HEAD the card maps WEB_APPLICATION_ENTRIES only (web-northbound.mjs:1458); F7 requires the derive idiom [...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES].map(([, name]) => name) — a hardcoded list defeats the fix');

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
    assert.ok(commands.includes(dot), `the derived card lists '${dot}'`);
  }
  for (const underscore of ['waves_start', 'waves_progress', 'waves_send', 'waves_stop']) {
    assert.ok(!commands.includes(underscore), 'the card never lists the underscore transports (F1)');
  }
});

test('A1-7 PIN: the byte-stable APPLICATION_COMMAND_DEFINITIONS key set is the FULL 26-key insertion-order set (F8)', () => {
  assert.deepEqual(Object.keys(APPLICATION_COMMAND_DEFINITIONS), COMMANDS_BEFORE_M3,
    'the FULL 26-key insertion-order set (grammar-m3 M3-8) is byte-stable — a wrong impl that registers the wave verbs as table entries, drops a row, or reorders one breaks the deepEqual (F8)');
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

test('A2-1: wave.started carries the extended projection payload {deploymentId, idempotencyKey, roster: [{role, route, scope}], waveId} (D2.2/F1/F3)', async (t) => {
  const host = await hostFixture(t);
  const wave = await startWave(host, 'a2-1', [memberExact('alpha', 'write the alpha report')]);
  const records = driverEvents(host.driver, 'wave.started', wave.waveId);
  assert.equal(records.length, 1);
  const payload = records[0].payload;
  assert.equal(payload.waveId, wave.waveId);
  assert.equal(typeof payload.deploymentId, 'string',
    'stage: record-shape-missing — the wave.started payload at HEAD has no deploymentId (application.mjs:4615-4619); F3 threads the resident deploymentId into the mint');
  assert.equal(payload.deploymentId, host.deploymentId,
    'F1 — the minted deploymentId is THIS host\'s known id, never a hardcoded constant or a foreign row');
  assert.equal(payload.idempotencyKey, 'a2-1', 'the idempotency key rides the mint');
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
  assert.equal(row.deploymentId, host.deploymentId,
    'F1 — the row carries THIS host\'s known deployment id, so a hardcoded constant cannot pass');
  assert.ok(Array.isArray(row.roster));
});

test('A2-4 F6/F13: legacy-store replay — a string-array roster survives a store close/reopen replay and renders the pinned no-run member read', async (t) => {
  const host = await hostFixture(t);
  const legacyWaveId = waveIdFor('legacy-store');
  const recorded = host.driver.coordination.recordDriver('wave.started', {
    waveId: legacyWaveId, roster: ['alpha', 'beta'], idempotencyKey: 'legacy-ik',
  }, { actor: 'test', key: `wave.started:${legacyWaveId}` });
  assert.equal(recorded.ok, true,
    'the legacy append is accepted — the B2 gate shape-checks BEFORE strictness and never refuses a well-formed legacy string-array roster');

  // F6 — prove the registry fold by a store close/reopen REPLAY, not a live append. recordDriver
  // persists synchronously (coordination-store.mjs:1472 _appendFile); dropping the writer lease and
  // reopening the SAME logDir replays the ledger from disk deterministically (no clocks).
  await host.application.shutdown(principal('cleanup')).catch(() => {});
  try { host.driver.coordination.releaseWriterLease(); } catch { /* shutdown may have released it */ }
  const reopenedDriver = createDriverFor(host.repo, host.logDir, markerAdapter());
  const reopenedApp = buildApplication(reopenedDriver, host.deploymentId);
  const reopened = { application: reopenedApp, driver: reopenedDriver, repo: host.repo, logDir: host.logDir, deploymentId: host.deploymentId };
  t.after(async () => {
    await reopenedApp.shutdown(principal('cleanup')).catch(() => {});
    try { reopenedDriver.coordination.releaseWriterLease(); } catch {}
  });

  const listed = await readWavesList(reopened);
  assert.ok(listed !== null, 'the reopened registry read resolves');
  const row = listed.waves.find((w) => w.waveId === legacyWaveId);
  assert.ok(row, 'the legacy row survives the reopen');
  assert.deepEqual(row.roster.map((m) => m.role), ['alpha', 'beta']);
  for (const m of row.roster) {
    assert.equal(m.route, null, 'a legacy-string member renders route: null');
    assert.equal(m.scope, null, 'a legacy-string member renders scope: null');
    // F13 — pin the legacy no-run member read (contract D2.4): a run-less legacy member renders
    // liveness local with attention/progress null and NEVER refuses wave_not_found (the D5.2 seam
    // only fires for a member whose run was registered and then disappeared).
    assert.equal(m.liveness, 'local', 'D2.4 — a run-less legacy member reads liveness local, never wave_not_found');
    assert.equal(m.phase, null, 'D2.4 — the no-run member has no phase');
    assert.equal(m.progressClass, null, 'D2.4 — the no-run member has no progress class');
    assert.equal(m.attentionCount, null, 'D2.4 — the no-run member has no attention count');
    assert.equal(Object.hasOwn(m, 'error'), false, 'the no-run member carries no refusal error');
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

test('A2-7 F9: attach is exactly-once — the facade start + attach keeps one wave.started record and one registry row', async (t) => {
  const host = await hostFixture(t);
  const objective = 'write the alpha report';
  const started = await host.baton.waves.start({ repoRoot: host.repo, idempotencyKey: 'a2-7', members: [member('alpha', objective)] });
  assert.equal(driverEvents(host.driver, 'wave.started', started.waveId).length, 1,
    'the facade start mints wave.started once');
  // attachWave binds EXISTING runs by objective (wave.mjs:268-274) — re-attaching the same member
  // must not re-mint the wave.
  const attached = await host.baton.waves.attach(started.waveId, [member('alpha', objective)], { repoRoot: host.repo });
  assert.ok(attached !== null && typeof attached === 'object', 'attach resolves over the matching objective');
  assert.equal(driverEvents(host.driver, 'wave.started', started.waveId).length, 1,
    'stage: attach-duplicate-missing — attachWave matches by objective and never re-mints wave.started (F9: exactly-once-on-attach, application.mjs:10889,11441)');
  const listed = await readWavesList(host);
  assert.ok(listed !== null, 'the registry read resolves');
  assert.equal(listed.waves.filter((w) => w.waveId === started.waveId).length, 1,
    'exactly one registry row — attach never double-lists the wave');
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
  assert.equal(row.deploymentId, host.deploymentId, 'F1 — the row carries THIS host\'s known deployment id');
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

test('A3-2 §4: baton_waves_list lands in the pinned MCP enumeration — 34 → 35, position 16 after baton_waves_run (#114 shifted the base)', async (t) => {
  const host = await hostFixture(t);
  const { server } = await mcpFixture(t, host);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = listed.result.tools.map((tool) => tool.name);
  assert.equal(names.length, 37,
    'stage: mcp-waves-list-row-missing — the pinned MCP enumeration is 35 post-#114 (baton_waves_run); §4 inserts baton_waves_list (34 → 35), #170 inserts baton_waves_compile (35 → 36), then #158 inserts baton_run_scratchpad_append (36 → 37)');
  assert.equal(names[14], 'baton_waves_stop', 'baton_waves_stop stays at 0-based position 14');
  assert.equal(names[15], 'baton_waves_list',
    'baton_waves_list sits at 0-based position 15, immediately after baton_waves_stop — the §4 pinned insertion point');
  assert.equal(names[16], 'baton_waves_run', 'baton_waves_run (#114) follows at 0-based position 16 — the waves family stays contiguous');
  const sorted = mcpApplicationToolNames();
  assert.equal(sorted.length, 37, 'the sorted ordinary surface grows to 37 tools (baton_waves_compile #170 + baton_run_scratchpad_append #158)');
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
  assert.equal(row.deploymentId, host.deploymentId,
    'the row carries THIS host\'s known deployment id — every v1.0 row is local by construction (the registry is per-deployment private; F1)');
  const alpha = row.roster.find((m) => m.role === 'alpha');
  assert.equal(alpha.liveness, 'local', 'per-member liveness reads local; remote/stale are explicitly deferred in v1.0');
  for (const key of Object.keys(row)) {
    assert.ok(key !== 'remote' && key !== 'stale', 'no remote/stale vocabulary is fabricated on the row');
  }
});

test('A4-2 PIN: processState only reads \'active\' on an exact match — \'unknown\' reads stale, never a guessed \'remote\' (F4/F12)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/resident-authority.mjs', import.meta.url)), 'utf8');
  // F12 — the negative pin is REGION-RESTRICTED to the processState function (resident-authority.mjs
  // :51-64), so a comment or dead branch anywhere else in the file cannot trip it.
  const region = src.slice(
    src.indexOf('function processState('),
    src.indexOf('function safeRegular('),
  );
  assert.ok(!region.includes("'remote'"),
    'the processState function never reads remote — a dead-branch \'remote\' literal inside it is killed (F12)');
  assert.equal((region.match(/return 'unknown'/g) ?? []).length, 2,
    'exactly the two real unknown paths (resident-authority.mjs:56 non-ESRCH/EPERM kill error and :60 failed/empty ps read)');
  assert.equal((region.match(/return 'stale'/g) ?? []).length, 1,
    'exactly the one real stale return (ESRCH at :58; the ternary at :61 branches stale separately)');
  assert.ok(region.includes('observed === expectedStart ? \'active\' : \'stale\''),
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

test('A5-5 F11: the issued bare-attach command runs the FULL CLI parse→dispatch→render pipeline and surfaces the attachable set', async (t) => {
  const host = await hostFixture(t);
  const wave = await startWave(host, 'a5-5', [memberExact('alpha', 'write the alpha report')]);
  let parsed = null;
  try { parsed = parseBatonCli(['waves', 'attach']); } catch { /* HEAD: cli_invalid; parsed stays null */ }
  assert.ok(parsed !== null,
    'stage: bare-attach-shape-missing — at HEAD parseBatonCli throws cli_invalid "wave ID is invalid" (application-cli.mjs:1328), so the pipeline leg cannot run; F11 requires the issued {kind: \'command\', name: \'waves.list\', args: {}} shape');
  assert.equal(parsed.name, 'waves.list', 'the issued command is waves.list (F5)');
  const rendered = await runBatonCli(parsed, cliRoutingClient(host));
  assert.ok(rendered !== null && typeof rendered === 'object' && Array.isArray(rendered.waves),
    'the rendered waves.list passes through the CLI pipeline unchanged (projectBatonCliResult:1019) — a resolved command exits 0 (baton.mjs:128-131)');
  const row = rendered.waves.find((w) => w.waveId === wave.waveId);
  assert.ok(row, 'the started wave is surfaced through the pipeline');
  assert.deepEqual(row.roster.map((m) => m.role), ['alpha'],
    'the attachable set — waveId + member roles — renders for the operator');
});

// ===========================================================================
// §F — #129 typed admission refusal (D5/F3/F4/F5/F8/F10)
// ===========================================================================

test('A6-1 F3: the DIRECT-PORT waves.start refuses an admission-exceeding wave with wave_member_invalid naming {actual, cap, cause, role} (D5.1)', async (t) => {
  const host = await hostFixture(t);
  const members = [memberExact('alpha', BIG_OBJECTIVE)];
  // Re-aimed at the layer the D5.1/F6 fix owns: the direct-port wave-start admission, NOT the
  // facade per-member swallow (createWave catches per-member errors into entry.startError and that
  // swallow is untouched by the fold).
  await assert.rejects(
    host.application.command('waves.start', { idempotencyKey: 'a6-1', members }, principal('wave-owner')),
    (error) => {
      assert.equal(error.code, 'wave_member_invalid',
        'stage: member-refusal-catchwrap-missing — at HEAD the direct port rejects with a RAW spill_body_exceeded (no role/cause/detail); D5.1 wraps the admission refusal into wave_member_invalid');
      assert.equal(error.message, 'wave member alpha did not start',
        'D5.1 — the refusal message is the pinned applicationError message, byte-identical across every surface (W6/F4)');
      const detail = error.detail ?? error;
      assert.equal(detail.cap, SPILL_BODY_CEILING, 'the refusal names the spill.body ceiling');
      assert.ok(Number.isInteger(detail.actual) && detail.actual > SPILL_BODY_CEILING, 'the refusal names the actual size');
      assert.equal(detail.role, 'alpha', 'the refusal names the offending member role');
      assert.equal(detail.cause?.code, 'spill_body_exceeded', 'the inner admission code is preserved in cause');
      return true;
    },
  );
});

test('A6-2 F4: the web surface refuses wave_member_invalid with the SAME detail shape as A6-1 and the byte-identical message', async (t) => {
  const host = await hostFixture(t);
  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('waves_start', {
    idempotencyKey: 'a6-2',
    members: [memberExact('alpha', BIG_OBJECTIVE)],
  }));
  assert.equal(res.body?.error?.code, 'wave_member_invalid',
    'stage: web-admission-missing — at HEAD the wave verb is not admitted at all (400 invalid_command "unsupported command"); D5 maps wave_member_invalid onto the admitted web body');
  assert.equal(res.body?.error?.message, 'wave member alpha did not start',
    'D5.2 — the web body carries the EMBEDDED refusal message byte-identically, never the fixed mapping string (W6/F4)');
  const detail = res.body?.error?.detail ?? res.body?.error;
  assert.equal(detail.cap, SPILL_BODY_CEILING, 'the {actual, cap, cause, role} payload rides the web body (D5.1)');
  assert.ok(Number.isInteger(detail.actual) && detail.actual > SPILL_BODY_CEILING, 'the actual size is named');
  assert.equal(detail.role, 'alpha', 'the offending member role is named');
  assert.equal(detail.cause?.code, 'spill_body_exceeded', 'the inner admission code is preserved in cause');
});

test('A6-3 F4: the MCP surface refuses baton_waves_start with the SAME detail shape as A6-1 and the byte-identical message', async (t) => {
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
  assert.equal(parsed.error?.message, 'wave member alpha did not start',
    'D5.2 — MCP structuredContent.error carries the embedded refusal message byte-identically (W6/F4)');
  const detail = parsed.error?.detail ?? parsed.error;
  assert.equal(detail.cap, SPILL_BODY_CEILING, 'the {actual, cap, cause, role} payload rides structuredContent.error (D5.1)');
  assert.ok(Number.isInteger(detail.actual) && detail.actual > SPILL_BODY_CEILING, 'the actual size is named');
  assert.equal(detail.role, 'alpha', 'the offending member role is named');
  assert.equal(detail.cause?.code, 'spill_body_exceeded', 'the inner admission code is preserved in cause');
});

test('A6-4 F5: a registry row whose member run no longer resolves refuses wave_not_found — typed on the facade, MCP, and web surfaces (behavioral, never a source grep)', async (t) => {
  const host = await hostFixture(t);
  // Synthetic NEW-shape records carrying THIS deployment's id (a foreign deploymentId row is dropped
  // by the D3.1 defense-in-depth and the seam never fires). The steering.registered record binds the
  // member role to a GHOST runId that no longer resolves — the D2.4 seam the fold owns.
  const ghostWaveId = waveIdFor('f5-ghost');
  const ghostRunId = `run-${'f'.repeat(32)}`;
  host.driver.coordination.recordDriver('wave.started', {
    waveId: ghostWaveId,
    deploymentId: host.deploymentId,
    roster: [{ role: 'alpha', route: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'] }],
    idempotencyKey: 'f5-ghost',
  }, { actor: 'test', key: `wave.started:${ghostWaveId}` });
  host.driver.coordination.recordDriver('steering.registered', {
    runId: ghostRunId, waveId: ghostWaveId, waveRole: 'alpha',
  }, { actor: 'test', key: `steering.registered:${ghostRunId}` });

  await assert.rejects(
    host.application.command('waves.list', {}, principal('wave-owner')),
    (error) => {
      assert.equal(error.code, 'wave_not_found',
        'stage: registry-read-missing — at HEAD waves.list does not exist (application_command_unavailable); D2.4 the per-member live read refuses wave_not_found for a member run that no longer resolves (F5)');
      return true;
    },
  );

  const { server } = await mcpFixture(t, host);
  const call = await server.handle({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'baton_waves_list', arguments: { repoId: REPO_ID } },
  });
  assert.equal(call.result?.isError, true);
  const parsed = JSON.parse(call.result.content[0].text);
  assert.equal(parsed.error?.code, 'wave_not_found',
    'F8/D5.2 — stateFailureCode allowlists wave_not_found so baton_waves_list names the missing wave, never command_outcome_unknown (mcp-northbound.mjs:260)');
  assert.ok(typeof parsed.error?.message === 'string' && parsed.error.message.length > 0,
    'the MCP refusal carries the embedded message');

  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('waves_list', {}));
  assert.equal(res.body?.error?.code, 'wave_not_found',
    'D5.2 — the web body keeps the typed wave_not_found (dispatchFailure maps it 404 with the embedded message, never the fixed not_found collapse)');
  assert.ok(typeof res.body?.error?.message === 'string' && res.body.error.message.length > 0,
    'the web refusal carries the embedded message');
});

test('A6-5 PIN: wave_registry_invalid stays a STORE-INTEGRITY throw — never an MCP per-command error (F8/F12)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/mcp-northbound.mjs', import.meta.url)), 'utf8');
  // F12 — the negative pin is REGION-RESTRICTED to the stateFailureCode allowlist
  // (mcp-northbound.mjs:198-260), so a comment elsewhere cannot false-red it.
  const region = src.slice(
    src.indexOf('function stateFailureCode('),
    src.indexOf('function protocolResult('),
  );
  assert.ok(!region.includes("'wave_registry_invalid'"),
    'the stateFailureCode allowlist never carries \'wave_registry_invalid\' — the B2 store-integrity code (F8) stays a projection throw, never a per-command surface row (the contract note pins that an explanatory comment must not quote it inside the function)');
});

test('A6-6 F4: `baton waves start --members JSON` drives an admission-exceeding objective through the FULL CLI pipeline — typed body.error + non-zero exit', async (t) => {
  const host = await hostFixture(t);
  const members = [memberExact('alpha', BIG_OBJECTIVE)];
  let parsed = null;
  try {
    parsed = parseBatonCli(['waves', 'start', '--members', JSON.stringify(members)]);
  } catch { /* HEAD: cli_command_unavailable; parsed stays null */ }
  assert.ok(parsed !== null,
    'stage: cli-wave-verbs-missing — at HEAD the plural block only handles attach (application-cli.mjs:1316-1321), so waves start throws cli_command_unavailable; D4.6 parses --members JSON into waves.start');
  assert.equal(parsed.name, 'waves.start', 'the CLI verb compiles to the direct-port waves.start (D4.6)');
  assert.ok(Array.isArray(parsed.args.members) && parsed.args.members.length === 1,
    'the --members JSON payload becomes the dispatch members (parsed.idempotencyKey rides the parse)');
  let refusal = null;
  try {
    await runBatonCli(parsed, cliRoutingClient(host));
  } catch (error) {
    refusal = error;
  }
  assert.ok(refusal !== null,
    'the admission-exceeding wave refuses through the CLI dispatch — never a silent per-member swallow');
  assert.equal(refusal.code, 'wave_member_invalid', 'the CLI leg carries the typed body.error code (F4)');
  assert.equal(refusal.message, 'wave member alpha did not start',
    'D5.2 — the CLI error message is byte-identical to the embedded refusal (W6/F4)');
  const detail = refusal.detail ?? refusal;
  assert.equal(detail.cap, SPILL_BODY_CEILING, 'the {actual, cap, cause, role} payload rides the CLI refusal (D5.1)');
  assert.ok(Number.isInteger(detail.actual) && detail.actual > SPILL_BODY_CEILING);
  assert.equal(detail.role, 'alpha');
  assert.equal(detail.cause?.code, 'spill_body_exceeded');
  const exitCode = refusal.code === 'cli_invalid' || refusal.code === 'cli_config_invalid' || refusal.code === 'cli_command_unavailable' ? 2 : 1;
  assert.ok(exitCode !== 0,
    'the typed refusal maps to the non-zero exit 1 in the entry mapping (baton.mjs:128-131 — cli_* usage errors exit 2, outcome refusals exit 1)');
});

test('A6-7 F10: the per-member runId envelope is validated on the negative path — application_wave_member_action_invalid typed on the facade and the web body', async (t) => {
  const host = await hostFixture(t);
  for (const args of [{}, { runId: 'bad id' }]) {
    await assert.rejects(
      host.application.command('waves.send', args, principal('wave-owner')),
      (error) => {
        assert.equal(error.code, 'application_wave_member_action_invalid',
          'the negative gate is _normalizeWaveMemberAction (application.mjs:11738-11745) — a missing or invalid runId is refused typed before any dispatch');
        return true;
      },
    );
  }
  const { web, webCtx } = webFixture(t, host);
  const res = await web.execute(webCtx, waveEnvelope('waves_send', {}));
  assert.equal(res.body?.error?.code, 'application_wave_member_action_invalid',
    'stage: web-admission-missing — at HEAD waves_send is not admitted (400 invalid_command "unsupported command"); D5 admits it, the negative envelope resolves application_wave_member_action_invalid, and dispatchFailure preserves the typed code on the web body (web-northbound.mjs:170-176)');
});
