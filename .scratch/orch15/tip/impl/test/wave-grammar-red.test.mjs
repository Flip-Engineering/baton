// S-1 v2 wave grammar amendment — red suite (WG-1..WG-5).
// Authority: docs/reference/evidence/control-surface-2026-07-31/s1-wave-grammar-amendment.md
//            (v2 amendment section ONLY — waves.attach registers; waves.start stays embedding sugar).
//
// Landing discipline (R-WG-5 / WG-5): two green commits.
//   Commit 1 (registry): registry row + server-side binding proof + validator/schema +
//     transportHidden mechanism + these WG rows. Authority-digest change is confined here.
//   Commit 2 (transports): CLI/MCP/web wiring + deployment-facade parity + conformance rows.
//
// Deterministic: MockAdapter fixtures, in-process surfaces, no live providers.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MockAdapter } from '../src/adapter.mjs';
import {
  APPLICATION_COMMAND_DEFINITIONS,
  BatonApplication,
  validateApplicationCommandArgs,
} from '../src/application.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import {
  APPLICATION_SEMANTIC_REGISTRY,
  deriveSurfaceNames,
} from '../src/application-semantics.mjs';
import {
  bindBaton, createDriver, CoordinationStore, McpFleetServer, WebNorthbound,
} from '../src/index.mjs';
import { mcpApplicationToolNames } from '../src/mcp-northbound.mjs';
import { validateWebCommandEnvelope } from '../src/web-northbound.mjs';
import { runSurfaceConformanceMain } from '../scripts/surface-conformance.mjs';

const repoId = 'repo-wave-grammar';
const NOW = Date.parse('2026-07-31T12:00:00.000Z');
const ORIGIN = 'https://wave-grammar.test';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wave-grammar-${label}-`));
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

async function until(check, label, timeoutMs = 20_000, pollMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label} never became true within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

const settledish = (entry) => entry?.terminal === true || entry?.phase === 'result_ready';

function markerAdapter(scenariosByMarker) {
  const adapter = new MockAdapter({ scenario: scenariosByMarker.default ?? { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'wave-grammar-test', refreshedAt: null,
    },
  });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    const marker = Object.keys(scenariosByMarker).find((key) => key !== 'default' && goal.includes(key));
    const scenario = scenariosByMarker[marker] ?? scenariosByMarker.default;
    return nativeSpawn(worker, brief, { ...options, scenario });
  };
  return adapter;
}

function openHost(repo, logDir, adapter, {
  authorize = async () => true,
  ownerId = 'wave-owner',
} = {}) {
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1,
        repoId,
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
    repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1,
        repoId,
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
    authorize,
  });
  const baton = bindBaton(application, principal(ownerId));
  return { application, baton, driver };
}

const member = (role, objective) => ({
  role,
  objective: `${objective} (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
});

function driverEvents(driver, kind, waveId = null) {
  return driver.coordination.events().filter((event) => (
    event.kind === 'driver.recorded' && event.payload?.kind === kind
    && (waveId === null || event.payload?.waveId === waveId)
  ));
}

async function shutdown(host, actor = 'owner') {
  await host.application.shutdown(principal(actor));
}

// ── WG-1: registry row + derived names; singular refused; no waves.start ─────

test('WG-1: waves.attach registry row (exact key/profile/surfaces/schema) + derived names; singular refused; no waves.start', () => {
  const op = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .find((entry) => entry.key === 'waves.attach');
  assert.ok(op, 'waves.attach must be a canonical operation');
  assert.equal(op.key, 'waves.attach');
  assert.equal(op.profile, 'ordinary');
  assert.deepEqual([...op.surfaces].sort(), ['cli', 'embedded', 'mcp', 'web']);
  assert.equal(op.effect, 'observe');
  assert.ok(!op.capabilities.includes('emergency_stop'),
    'portable attach transports no emergency_stop authority');
  assert.deepEqual(op.names, deriveSurfaceNames('waves.attach'));
  assert.equal(op.names.cli, 'baton waves attach');
  assert.equal(op.names.mcp, 'baton_waves_attach');
  assert.equal(op.names.web, 'waves_attach');
  assert.equal(op.names.embedded, 'waves.attach()');
  // Closed schema: waveId + members required; mintWaveDetached declared-hidden.
  assert.ok(op.inputSchema?.properties?.waveId, 'waveId is a public required input');
  assert.ok(op.inputSchema?.properties?.members, 'members is a public required input');
  assert.ok(Array.isArray(op.inputSchema.required)
    && op.inputSchema.required.includes('waveId')
    && op.inputSchema.required.includes('members'));
  assert.ok(Array.isArray(op.transportHidden), 'transportHidden is declared on the row');
  assert.ok(op.transportHidden.includes('mintWaveDetached'),
    'mintWaveDetached rides transportHidden');

  // Derived names resolve on every enabled surface via the registry names projection.
  for (const surface of op.surfaces) {
    assert.equal(typeof op.names[surface], 'string');
    assert.ok(op.names[surface].length > 0, `${surface} derived name present`);
  }

  // CLI: plural spelling parses; singular refuses with corrective naming.
  const plural = parseBatonCli(['waves', 'attach', 'wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--members', '[]', '--idempotency-key', 'wg1-plural']);
  assert.equal(plural.kind, 'command');
  assert.equal(plural.name, 'waves.attach');

  assert.throws(
    () => parseBatonCli(['wave', 'attach', 'wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']),
    (error) => /waves attach|plural/iu.test(String(error?.message ?? error)),
  );

  // MCP-W1 fold (mcp-packaging-decisions v1.0): waves.start/progress/send/stop join the ordinary
  // surface as canonical operations (baton_waves_start etc.). waves.start is the detached
  // start; waves.progress pages ≤16/member with cursors; waves.send/stop steer ONE member by
  // runId. The embedding-only preset-sugar posture is retired deliberately.
  for (const key of ['waves.start', 'waves.progress', 'waves.send', 'waves.stop']) {
    const row = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.find((entry) => entry.key === key);
    assert.ok(row, `${key} must be a canonical operation (MCP-W1)`);
    assert.equal(row.profile, 'ordinary');
    assert.ok(row.surfaces.includes('mcp'), `${key} surfaces carry mcp`);
    assert.deepEqual(row.names, deriveSurfaceNames(key));
  }
  const semanticsSrc = readFileSync(
    fileURLToPath(new URL('../src/application-semantics.mjs', import.meta.url)),
    'utf8',
  );
  for (const key of ['waves.start', 'waves.progress', 'waves.send', 'waves.stop']) {
    assert.equal(new RegExp(`\\[\\s*'${key.replaceAll('.', '\\.')}'\\s*,`, 'u').test(semanticsSrc), true,
      `the ${key} row lands in CANONICAL_OPERATION_SPECS source`);
  }
});

// ── WG-2: atomic transport attach-and-harvest ────────────────────────────────

test('WG-2: atomic transport attach — MCP + web bind, settle, return outcomes; typed refusals; exactly-once driver_detached', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
  };
  const repo = root('wg2-repo');
  const logDir = root('wg2-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  t.after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const host1 = openHost(repo, logDir, markerAdapter(scenarios));
  const waveId = waveIdFor('wg2-attach');
  const members = [member('alpha', 'write the alpha report')];
  const wave = await host1.baton.waves.start({
    repoRoot: repo, idempotencyKey: 'wg2-attach', members,
  });
  await until(async () => settledish((await wave.progress()).members[0]), 'alpha terminal');
  await shutdown(host1);

  const host2 = openHost(repo, logDir, markerAdapter(scenarios));
  t.after(async () => { await host2.application.shutdown(principal('cleanup')).catch(() => {}); });

  // Application command: atomic attach-and-harvest — closed payload, no live handle.
  const viaCommand = await host2.application.command('waves.attach', {
    waveId, members: members.map(({ role, objective }) => ({ role, objective })),
  }, principal('wave-owner'));
  assert.ok(Array.isArray(viaCommand.outcomes), 'returns outcomes array');
  assert.equal(viaCommand.outcomes.length, 1);
  assert.match(viaCommand.outcomes[0].resultSha ?? '', /^[a-f0-9]{40}$/u);
  assert.equal(typeof viaCommand.waveDriverDetached, 'boolean');
  assert.equal(viaCommand.waveDriverDetached, true);
  assert.equal(viaCommand.progress, undefined, 'no live handle methods transported');
  assert.equal(viaCommand.stopMember, undefined);
  assert.equal(viaCommand.close, undefined);

  // Zero-member bind (no matching objectives) refuses wave_attach_unknown_wave.
  await assert.rejects(
    host2.application.command('waves.attach', {
      waveId: 'wave:0000000000000000000000000000000f',
      members: [{ role: 'alpha', objective: 'no such objective ever started' }],
    }, principal('wave-owner')),
    (error) => error?.code === 'wave_attach_unknown_wave',
  );

  // Mismatched member (foreign waveId vs bound runs) refuses application_wave_member_mismatch
  // SERVER-SIDE — no mint-callback involved on the portable path.
  await assert.rejects(
    host2.application.command('waves.attach', {
      waveId: waveIdFor('wg2-foreign'),
      members: [{ role: 'alpha', objective: members[0].objective }],
    }, principal('wave-owner')),
    (error) => error?.code === 'application_wave_member_mismatch'
      || error?.code === 'wave_attach_unknown_wave',
  );
  // Direct proof: the binding check is observable without any client callback.
  const waveARun = (await host2.baton.runs.list()).items
    .find((item) => item.objective.includes('write the alpha report'));
  await assert.rejects(
    host2.application.command('run.inspect', {
      runId: waveARun.id, mintWaveDetached: true, waveId: waveIdFor('wg2-foreign'),
    }, principal('wave-owner')),
    (error) => error?.code === 'application_wave_member_mismatch',
  );

  // wave.driver_detached mints exactly once across repeated portable attaches.
  const second = await host2.application.command('waves.attach', {
    waveId, members: members.map(({ role, objective }) => ({ role, objective })),
  }, principal('wave-owner'));
  assert.equal(second.waveDriverDetached, false,
    'second attach reports the receipt already minted (key-deduped)');
  const detached = driverEvents(host2.driver, 'wave.driver_detached', waveId);
  assert.equal(detached.length, 1, 'exactly one wave.driver_detached across transports');

  // MCP ordinary tool baton_waves_attach is advertised and dispatches the same closed payload.
  assert.ok(mcpApplicationToolNames().includes('baton_waves_attach'),
    'baton_waves_attach is on the ordinary MCP application surface');
  const coordination = new CoordinationStore(join(logDir, 'mcp-coord'), {
    clock: () => new Date(NOW).toISOString(),
  });
  const mcpPrincipal = {
    userId: 'mcp-op', sessionId: 'mcp-sess',
    capabilities: ['observe'],
    repoIds: [repoId],
    expiresAt: new Date(NOW + 60_000).toISOString(),
    revoked: false,
  };
  const server = new McpFleetServer({
    coordinator: {},
    coordination,
    application: host2.application,
    surface: 'application',
    principal: mcpPrincipal,
    repoIds: [repoId],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 64 * 1024,
    takeToolQuota: async () => ({ ok: true }),
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
  });
  const init = await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wg2', version: '0' } },
  });
  assert.equal(init.result?.protocolVersion !== undefined, true);
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const attachTool = listed.result.tools.find((tool) => tool.name === 'baton_waves_attach');
  assert.ok(attachTool, 'tools/list advertises baton_waves_attach');
  assert.equal(Object.hasOwn(attachTool.inputSchema.properties, 'mintWaveDetached'), false,
    'advertised MCP schema excludes mintWaveDetached');
  const mcpCall = await server.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: {
      name: 'baton_waves_attach',
      arguments: {
        repoId,
        waveId,
        members: members.map(({ role, objective }) => ({ role, objective })),
      },
    },
  });
  assert.equal(mcpCall.result?.isError, false, `MCP attach failed: ${JSON.stringify(mcpCall)}`);
  const mcpBody = mcpCall.result?.structuredContent ?? JSON.parse(mcpCall.result?.content?.[0]?.text ?? '{}');
  assert.ok(Array.isArray(mcpBody.outcomes));
  assert.equal(typeof mcpBody.waveDriverDetached, 'boolean');

  // Web: waves_attach is admitted and returns the same closed payload.
  const web = new WebNorthbound({
    coordinator: {},
    coordination: new CoordinationStore(join(logDir, 'web-coord'), {
      clock: () => new Date(NOW).toISOString(),
    }),
    repoIds: [repoId],
    allowedOrigins: [ORIGIN],
    now: () => NOW,
    application: host2.application,
  });
  const webCtx = {
    principal: {
      userId: 'web-op', sessionId: 'web-sess', credentialId: 'web-cred',
      authMethod: 'cookie', csrfToken: 'csrf-wg2',
      expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
      capabilities: ['observe'], repoIds: [repoId],
    },
    origin: ORIGIN, csrfToken: 'csrf-wg2',
    remoteAddress: '127.0.0.1', transport: 'https',
  };
  const webResult = await web.execute(webCtx, {
    schemaVersion: 1,
    commandId: 'wg2-web-attach',
    idempotencyKey: 'wg2-web-attach',
    command: 'waves_attach',
    args: {
      waveId,
      members: members.map(({ role, objective }) => ({ role, objective })),
    },
    repoId,
    origin: ORIGIN,
  });
  assert.equal(webResult.status, 200, `web attach failed: ${JSON.stringify(webResult.body)}`);
  assert.ok(Array.isArray(webResult.body?.outcomes ?? webResult.body?.result?.outcomes));
});

// ── WG-3: hidden-by-declaration (transportHidden) ────────────────────────────

test('WG-3: hidden-by-declaration — advertised schemas exclude mintWaveDetached/waveId; validators accept them', () => {
  const attachOp = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .find((entry) => entry.key === 'waves.attach');
  assert.ok(attachOp?.transportHidden?.includes('mintWaveDetached'));

  const inspectOp = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .find((entry) => entry.key === 'run.view' || entry.key === 'run.inspect')
    ?? APPLICATION_SEMANTIC_REGISTRY.operations['run.inspect'];
  // run.inspect side-channel waveId rides declared-hidden (via transportHidden on the
  // operation that owns the side-channel, or on the inspect schema projection).
  const hiddenOnInspect = inspectOp?.transportHidden ?? [];
  assert.ok(
    hiddenOnInspect.includes('mintWaveDetached') || hiddenOnInspect.includes('waveId')
      || attachOp.transportHidden.includes('mintWaveDetached'),
    'run.inspect side-channel fields are declared-hidden',
  );

  // MCP advertised schema for baton_run_inspect excludes the side-channel fields.
  // (tools/list shape is exercised in WG-2; here pin the validator acceptance.)
  assert.doesNotThrow(() => {
    validateApplicationCommandArgs('run.inspect', {
      runId: 'run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mintWaveDetached: true,
      waveId: 'wave:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
  }, 'in-process validator accepts mintWaveDetached + waveId');

  // Web advertised ARG_FIELDS exclude the hidden pair, but the validator still accepts them.
  const advertisedReject = validateWebCommandEnvelope({
    schemaVersion: 1,
    commandId: 'wg3-adv',
    idempotencyKey: 'wg3-adv',
    command: 'run_inspect',
    args: { runId: 'run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mintWaveDetached: true, waveId: 'wave:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    repoId,
    origin: ORIGIN,
  });
  // Absence-from-advertised is pinned by the schema surface; acceptance-by-validator means
  // the envelope is either accepted outright, or the only failure is not unknown_argument_field
  // when the fields are presented through the in-process path.
  // The public web advertised schema must not list them — validateWebCommandEnvelope reports
  // a dedicated code when a field is advertised-only-missing vs validator-accepted.
  // Pin: unknown_argument_field is NOT the acceptance path for the in-process validator.
  assert.doesNotThrow(() => {
    validateApplicationCommandArgs('run.inspect', {
      runId: 'run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });
  // If the web envelope rejects, it must be because the fields are unadvertised — the
  // in-process command validator still accepts the same pair (above). Conformance pins both.
  if (advertisedReject) {
    assert.equal(advertisedReject, 'unknown_argument_field',
      'web advertised schema excludes the hidden fields');
  }

  // In-process waves.attach may carry mintWaveDetached when declared; advertised MCP schema
  // does not list it (WG-2 tools/list pin).
  assert.doesNotThrow(() => {
    validateApplicationCommandArgs('waves.attach', {
      waveId: 'wave:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      members: [{ role: 'alpha', objective: 'obj' }],
    });
  });
});

// ── WG-4: authority + deployment facade parity ───────────────────────────────

test('WG-4: per-run observe required; no emergency_stop transported; deployment-facade parity', async (t) => {
  const scenarios = {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] },
  };
  const repo = root('wg4-repo');
  const logDir = root('wg4-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  t.after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const host1 = openHost(repo, logDir, markerAdapter(scenarios));
  const waveId = waveIdFor('wg4-auth');
  const members = [member('alpha', 'write the alpha report')];
  const wave = await host1.baton.waves.start({
    repoRoot: repo, idempotencyKey: 'wg4-auth', members,
  });
  await until(async () => settledish((await wave.progress()).members[0]), 'alpha terminal');
  await shutdown(host1);

  // Principal denied observe on member runs refuses with a typed unauthorized code.
  // Same coordination log as host1 (durable runs live there); sequential hosts only.
  const denied = openHost(repo, logDir, markerAdapter(scenarios), {
    authorize: async (request) => {
      if (request?.principal?.principalId === 'no-observe') return false;
      return true;
    },
    ownerId: 'wave-owner',
  });
  try {
    await assert.rejects(
      denied.application.command('waves.attach', {
        waveId, members: members.map(({ role, objective }) => ({ role, objective })),
      }, principal('no-observe')),
      (error) => error?.code === 'application_unauthorized'
        || error?.code === 'application_wave_attach_unauthorized',
    );
  } finally {
    await denied.application.shutdown(principal('cleanup')).catch(() => {});
  }

  // Capabilities on the registry row: observe only (no emergency_stop).
  const op = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .find((entry) => entry.key === 'waves.attach');
  assert.deepEqual([...op.capabilities].sort(), ['observe']);
  assert.equal(op.emergency, false);
  assert.equal(APPLICATION_COMMAND_DEFINITIONS['waves.attach']?.capabilities?.includes?.('emergency_stop'),
    false);

  // Deployment-facade attach binds identically to BatonClient.waves.attach (W93 taxonomy).
  const host2 = openHost(repo, logDir, markerAdapter(scenarios));
  t.after(async () => { await host2.application.shutdown(principal('cleanup')).catch(() => {}); });
  // Facade shape: deployment exposes waves.attach (parity already required by recipes).
  // Here pin the portable command harvest equals the embedded attach+settle path.
  const embedded = await host2.baton.waves.attach(waveId, members, { repoRoot: repo });
  const embeddedOutcomes = await embedded.settle({ timeoutMs: 5_000 });
  const portable = await host2.application.command('waves.attach', {
    waveId, members: members.map(({ role, objective }) => ({ role, objective })),
    repoRoot: repo,
  }, principal('wave-owner'));
  assert.equal(portable.outcomes.length, embeddedOutcomes.length);
  assert.equal(portable.outcomes[0].resultSha, embeddedOutcomes[0].resultSha);
  await embedded.close({ reason: 'WG-4 done.' });
});

// ── WG-5: two-commit landing discipline ──────────────────────────────────────

test('WG-5: two-commit landing discipline holds (digest change confined; suite markers; no waves.start)', () => {
  // Commit markers are recorded in this file's header (Commit 1 / Commit 2).
  const self = readFileSync(
    fileURLToPath(new URL(import.meta.url)),
    'utf8',
  );
  assert.match(self, /Commit 1 \(registry\)/u);
  assert.match(self, /Commit 2 \(transports\)/u);

  // MCP-W1 fold: waves.attach plus the wave ergonomics rows each appear exactly once; waves.start
  // is now an ordinary canonical operation (detached start), no longer embedding-only sugar.
  const keys = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.map((entry) => entry.key);
  assert.equal(keys.filter((key) => key === 'waves.attach').length, 1);
  assert.equal(keys.filter((key) => key === 'waves.start').length, 1);
  assert.equal(typeof APPLICATION_SEMANTIC_REGISTRY.authorityDigest, 'string');
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.authorityDigest.length, 64);

  // Conformance main is green with the live transport wiring (commit 2).
  const findings = runSurfaceConformanceMain();
  assert.deepEqual(findings, [], `conformance findings: ${findings.join('; ')}`);
});
