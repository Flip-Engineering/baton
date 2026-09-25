import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS, BATON_CLI_HELP, BatonApplication, CoordinationStore,
  McpFleetServer, MockAdapter, WebNorthbound, createDriver, operatorAsset,
  parseBatonCli, runBatonCli, validateWebCommandEnvelope,
} from '../src/index.mjs';

const REPO_ID = 'repo-phase66-export-projection';
const ORIGIN = 'https://control.example.test';
const DIGEST = 'a'.repeat(64);
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1,
  repoId: REPO_ID,
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const VERIFICATION = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

const EXPORT_POLICY = Object.freeze({
  mode: 'manual', format: 'directory-v1', maxFiles: 128, maxBytes: 4 * 1024 * 1024,
  requireAdoptedResult: true, requireSemanticReview: false, requireIntegration: false,
});

function temporary(t, label) {
  const path = mkdtempSync(join(tmpdir(), `baton-phase66-export-projection-${label}-`));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function adapter() {
  const mock = new MockAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed', delayMs: 5, summary: 'created the export projection fixture',
      edits: [{ path: 'impl/projected.mjs', content: 'export const projected = true;\n' }],
    },
  });
  const card = mock.card.bind(mock);
  mock.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return mock;
}

function profile() {
  return {
    schemaVersion: 1,
    repoId: REPO_ID,
    definitionOfDone: ['deployment verification passes'],
    constraints: ['Keep the change inside the approved repository scope'],
    risk: 'high',
    goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    pathScope: ['impl/**'], verification: VERIFICATION,
    routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
    capabilities: ['code', 'test'], effects: ['repository_edit'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
    exportPolicy: EXPORT_POLICY,
  };
}

function applicationFixture(t, label) {
  const repo = temporary(t, `${label}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase66@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 66'], { cwd: repo });
  mkdirSync(join(repo, 'impl'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), 'projection fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const logDir = temporary(t, `${label}-log`);
  const exportRoot = temporary(t, `${label}-exports`);
  chmodSync(exportRoot, 0o700);
  const driver = createDriver({
    repoRoot: repo, repoId: REPO_ID, logDir, adapters: { mock: adapter() },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: REPO_ID, profiles: { exportable: profile() },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
    exportRoot,
  });
  t.after(() => application.shutdown(principal('shutdown')).catch(() => {}));
  return { repo, logDir, exportRoot, driver, application };
}

async function acceptedAndAdopted(f, runId) {
  const proposed = await f.application.command('run.start', { intent: {
    runId,
    objective: `Project the durable export for ${runId}`,
    profile: 'exportable',
    route: { harness: 'mock', model: 'model-a', effort: 'low' },
    scope: ['impl/**'],
  } }, principal('owner'));
  await f.application.command('run.approve', {
    runId, planDigest: proposed.plan.digest,
  }, principal('approver'));
  const finished = await f.application.command('run.wait', {
    runId, timeoutMs: 5_000,
  }, principal('owner'));
  const beforeAdoption = await f.application.command('run.evidence', { runId }, principal('owner'));
  await f.application.command('run.adopt', {
    runId, nodeKey: finished.result.nodeKey, resultSha: finished.result.sha,
    evidenceDigest: beforeAdoption.manifestDigest, reason: 'Select exact result for export.',
  }, principal('adopter'));
  const evidence = await f.application.command('run.evidence', { runId }, principal('owner'));
  return { finished, evidence };
}

function assertNoServerAuthority(value, privatePaths = []) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [...privatePaths, 'exportRoot', 'retainedResultRef', 'refs/baton/results/']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
}

test('CE9: eligible RunView advertises one export_result next action', async (t) => {
  const f = applicationFixture(t, 'eligible-action');
  const runId = 'run-export-action';
  await acceptedAndAdopted(f, runId);
  const view = await f.application.command('run.status', { runId }, principal('owner'));

  assert.deepEqual(view.export, null);
  assert.deepEqual(view.nextActions.filter((action) => action.kind === 'export_result'), [
    { kind: 'export_result' },
  ]);
  assertNoServerAuthority(view, [f.repo, f.logDir, f.exportRoot]);
});

test('CE10: RunView derives a closed pending export projection from durable admission', async (t) => {
  const f = applicationFixture(t, 'pending-projection');
  const runId = 'run-export-pending';
  const { evidence } = await acceptedAndAdopted(f, runId);
  let entered;
  const materializationEntered = new Promise((resolve) => { entered = resolve; });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const materializeAcceptedResult = f.driver.coordinator.materializeAcceptedResult.bind(f.driver.coordinator);
  f.driver.coordinator.materializeAcceptedResult = async (...args) => {
    entered();
    await blocked;
    return materializeAcceptedResult(...args);
  };
  const exporting = f.application.command('run.export', {
    runId, evidenceDigest: evidence.manifestDigest,
  }, principal('exporter'));
  await materializationEntered;
  const pending = f.driver.coordination.pendingRunResultExports()[0];
  try {
    const view = await f.application.command('run.status', { runId }, principal('owner'));
    assert.deepEqual(view.export, {
      schemaVersion: 1,
      state: 'pending',
      format: pending.format,
      runId: pending.runId,
      nodeKey: pending.nodeKey,
      resultSha: pending.resultSha,
      evidenceDigest: pending.evidenceDigest,
      exportId: pending.exportId,
      locator: pending.locator,
      admittedAt: pending.admittedAt,
    });
    assert.equal(view.nextActions.some((action) => action.kind === 'export_result'), false);
    assertNoServerAuthority(view, [f.repo, f.logDir, f.exportRoot]);
  } finally {
    release();
    await exporting;
  }
});

test('CE10/CE11 red: status reconstructs the immutable completed receipt and download next action', async (t) => {
  const f = applicationFixture(t, 'completed-projection');
  const runId = 'run-export-completed';
  const { evidence } = await acceptedAndAdopted(f, runId);
  const exported = await f.application.command('run.export', {
    runId, evidenceDigest: evidence.manifestDigest,
  }, principal('exporter'));
  assert.deepEqual(Object.keys(exported.delivery).sort(), [
    'archiveBytes', 'archiveDigest', 'exportId', 'format', 'manifestDigest', 'mediaType', 'schemaVersion',
  ]);
  assert.equal(exported.delivery.exportId, exported.export.exportId);
  assert.equal(exported.delivery.manifestDigest, exported.export.manifestDigest);
  const status = await f.application.command('run.status', { runId }, principal('owner'));

  assert.deepEqual(status.export, exported.export);
  assert.deepEqual(status.nextActions.filter((action) => action.kind === 'download_export'), [
    { kind: 'download_export', exportId: exported.export.exportId },
  ]);
  assert.equal(status.nextActions.some((action) => action.kind === 'export_result'), false);
  assertNoServerAuthority(status, [f.repo, f.logDir, f.exportRoot]);
});

test('CE11: application-backed Web authority derives, streams, releases, and revokes the completed export', async (t) => {
  const f = applicationFixture(t, 'integrated-delivery');
  const runId = 'run-export-delivery';
  const { evidence } = await acceptedAndAdopted(f, runId);
  const exported = await f.application.command('run.export', {
    runId, evidenceDigest: evidence.manifestDigest,
  }, principal('exporter'));
  const webPrincipal = {
    userId: 'operator', sessionId: 'session', credentialId: 'credential', authMethod: 'bearer',
    capabilities: ['observe', 'export_result'], repoIds: [REPO_ID],
    expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
  };
  const web = new WebNorthbound({
    coordinator: f.driver.coordinator, coordination: f.driver.coordination, application: f.application,
    allowedOrigins: [ORIGIN], repoIds: [REPO_ID], now: () => Date.parse('2026-07-14T20:00:00.000Z'),
    isPrincipalActive: () => true,
  });
  assert.ok(web.exportDelivery);
  const coordinates = { repoId: REPO_ID, runId, exportId: exported.export.exportId };
  const issued = await web.exportDelivery.issue(webPrincipal, ORIGIN, coordinates);
  assert.equal(issued.status, 201);
  assert.equal(issued.body.delivery.manifestDigest, exported.export.manifestDigest);
  class Response extends EventEmitter {
    constructor() { super(); this.chunks = []; }
    writeHead(status, headers) { this.status = status; this.headers = headers; }
    write(chunk) { this.chunks.push(Buffer.from(chunk)); return true; }
    end(chunk = null) { if (chunk) this.chunks.push(Buffer.from(chunk)); this.ended = true; }
  }
  const response = new Response();
  assert.equal(await web.exportDelivery.open({
    ticket: issued.body.ticket, principal: webPrincipal, origin: ORIGIN,
    requestHeaders: {}, exportId: exported.export.exportId,
  }, response), null);
  assert.equal(response.status, 200);
  assert.equal(Buffer.concat(response.chunks).length, issued.body.delivery.archiveBytes);
  assert.equal(f.application._runDeliveryRegistrations.size, 0);

  const active = new AbortController();
  f.application.registerResultExportDelivery({
    runId, exportId: exported.export.exportId, signal: active.signal, abort: () => active.abort(),
  });
  await f.application.command('run.stop', { runId, reason: 'revoke delivery after proof' }, principal('stopper'));
  assert.equal(active.signal.aborted, true);
  assert.equal(f.application._runDeliveryRegistrations.size, 0);
  assert.equal((await web.exportDelivery.issue(webPrincipal, ORIGIN, coordinates)).status, 403);
});

test('CE11 red: CLI help documents the required local destination after RUN_ID', () => {
  assert.match(BATON_CLI_HELP, /baton run export RUN_ID DIR/u);
});

test('CE11 red: CLI parser retains the local destination outside server command args', () => {
  assert.deepEqual(parseBatonCli([
    'run', 'export', 'run-cli-export', './clean-target', '--idempotency-key', 'export-cli',
  ]), {
    kind: 'export', runId: 'run-cli-export', destination: './clean-target', idempotencyKey: 'export-cli',
  });
});

test('CE11: CLI export fetches evidence and sends only the strict server command fields', async () => {
  const calls = [];
  const client = {
    async command(name, args, key) {
      calls.push({ op: 'command', name, args, key });
      if (name === 'run.evidence') return { manifestDigest: DIGEST };
      return {
        runId: 'run-cli-export',
        export: {
          schemaVersion: 1, state: 'completed', format: 'directory-v1',
          exportId: 'b'.repeat(64), locator: `export:${'b'.repeat(64)}`, manifestDigest: 'c'.repeat(64),
        },
      };
    },
    async downloadExport(input) {
      calls.push({ op: 'download', input });
      return { schemaVersion: 1, state: 'delivered', exportId: input.receipt.exportId };
    },
  };
  const result = await runBatonCli({
    kind: 'export', runId: 'run-cli-export', destination: './clean-target', idempotencyKey: 'export-cli',
  }, client);

  assert.equal(result.state, 'delivered');
  assert.deepEqual(calls, [
    { op: 'command', name: 'run.evidence', args: { runId: 'run-cli-export' }, key: 'export-cli:evidence' },
    {
      op: 'command',
      name: 'run.export',
      args: { runId: 'run-cli-export', evidenceDigest: DIGEST },
      key: 'export-cli:export',
    },
    {
      op: 'download',
      input: {
        runId: 'run-cli-export', destination: './clean-target',
        receipt: {
          schemaVersion: 1, state: 'completed', format: 'directory-v1',
          exportId: 'b'.repeat(64), locator: `export:${'b'.repeat(64)}`, manifestDigest: 'c'.repeat(64),
        },
      },
    },
  ]);
  assert.equal(JSON.stringify(calls.filter((call) => call.op === 'command')).includes('clean-target'), false);
});

function mcpApplication(calls) {
  return {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal) {
      calls.push({ name, args, principal: appPrincipal });
      if (name === 'application.shutdown') return { schemaVersion: 1, state: 'closed' };
      return {
        schemaVersion: 1, runId: args.runId,
        export: {
          schemaVersion: 1, state: 'completed', format: 'directory-v1',
          runId: args.runId, nodeKey: 'work', resultSha: 'd'.repeat(40), evidenceDigest: args.evidenceDigest,
          exportId: 'e'.repeat(64), locator: `export:${'e'.repeat(64)}`,
          treeOid: 'f'.repeat(40), manifestDigest: '1'.repeat(64), fileCount: 1, byteCount: 32,
          checks: { acceptedResultReverified: true, manifestVerified: true, treeExact: true },
          effects: { adopted: false, checkoutChanged: false, deployed: false, integrated: false, published: false },
          receiptDigest: '2'.repeat(64),
        },
        delivery: {
          schemaVersion: 1, format: 'baton-export-tar-v1', mediaType: 'application/x-tar',
          exportId: 'e'.repeat(64), manifestDigest: '1'.repeat(64),
          archiveDigest: '3'.repeat(64), archiveBytes: 2_048,
        },
      };
    },
  };
}

function mcpFixture(t, label) {
  const calls = [];
  const coordination = new CoordinationStore(temporary(t, `${label}-coordination`));
  const server = new McpFleetServer({
    coordinator: {}, coordination, application: mcpApplication(calls), surface: 'combined',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator', sessionId: 'stdio', capabilities: ['observe', 'export_result'],
      repoIds: [REPO_ID], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
    },
    repoIds: [REPO_ID], now: () => Date.parse('2026-07-14T18:00:00.000Z'),
    maxWaitMs: 25_000, maxMessageBytes: 64 * 1024, takeToolQuota: () => ({ ok: true }),
  });
  t.after(() => server.close().catch(() => {}));
  return { calls, coordination, server };
}

async function mcpRequest(server, id, method, params = {}) {
  return server.handle({ jsonrpc: '2.0', id, method, params });
}

async function initializeMcp(server) {
  const initialized = await mcpRequest(server, 1, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'export-red', version: '1' },
  });
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

test('CE11: application MCP inventory contains one strict path-free fleet_run_export tool', async (t) => {
  const { server } = mcpFixture(t, 'mcp-inventory');
  await initializeMcp(server);
  const listed = await mcpRequest(server, 2, 'tools/list');
  const tool = listed.result.tools.find((candidate) => candidate.name === 'fleet_run_export');

  assert.ok(tool, 'fleet_run_export must be present');
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), [
    'evidenceDigest', 'idempotencyKey', 'repoId', 'runId',
  ]);
  assert.deepEqual(tool.inputSchema.required.slice().sort(), [
    'evidenceDigest', 'idempotencyKey', 'repoId', 'runId',
  ]);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(Object.keys(tool.inputSchema.properties).some((key) => /path|dir|root/iu.test(key)), false);
});

test('CE11: MCP export dispatches the exact application command and refuses caller paths', async (t) => {
  const { calls, server } = mcpFixture(t, 'mcp-dispatch');
  await initializeMcp(server);
  const args = {
    repoId: REPO_ID, idempotencyKey: 'mcp-export', runId: 'run-mcp-export', evidenceDigest: DIGEST,
  };
  const response = await mcpRequest(server, 2, 'tools/call', {
    name: 'fleet_run_export', arguments: args,
  });
  assert.equal(response.result.isError, false);
  assert.deepEqual(calls.filter((call) => call.name === 'run.export'), [{
    name: 'run.export',
    args: { runId: 'run-mcp-export', evidenceDigest: DIGEST },
    principal: { actor: 'mcp:operator:stdio', principalId: 'operator', sessionId: 'stdio' },
  }]);
  assert.deepEqual(response.result.structuredContent.delivery, {
    schemaVersion: 1, format: 'baton-export-tar-v1', mediaType: 'application/x-tar',
    exportId: 'e'.repeat(64), manifestDigest: '1'.repeat(64),
    archiveDigest: '3'.repeat(64), archiveBytes: 2_048,
  });
  assertNoServerAuthority(response.result);

  const forged = await mcpRequest(server, 3, 'tools/call', {
    name: 'fleet_run_export', arguments: { ...args, idempotencyKey: 'mcp-export-forged', path: '/srv/baton/exports' },
  });
  assert.equal(forged.result.isError, true);
  assert.equal(calls.filter((call) => call.name === 'run.export').length, 1);
});

test('CE11: Web registry dispatches strict run_export parity and rejects server path fields', async (t) => {
  const calls = [];
  const application = mcpApplication(calls);
  const coordination = new CoordinationStore(temporary(t, 'web-coordination'));
  const web = new WebNorthbound({
    coordinator: {}, coordination, application, repoIds: [REPO_ID], allowedOrigins: [ORIGIN],
    now: () => Date.parse('2026-07-14T18:00:00.000Z'),
  });
  const envelope = {
    schemaVersion: 1, commandId: 'web-export', idempotencyKey: 'web-export', command: 'run_export',
    args: { runId: 'run-web-export', evidenceDigest: DIGEST }, repoId: REPO_ID,
    runId: 'run-web-export', origin: ORIGIN,
  };
  assert.equal(validateWebCommandEnvelope(envelope), null);
  assert.equal(validateWebCommandEnvelope({
    ...envelope, commandId: 'web-export-forged', idempotencyKey: 'web-export-forged',
    args: { ...envelope.args, exportRoot: '/srv/baton/exports' },
  }), 'unknown_argument_field');
  const response = await web.execute({
    principal: {
      userId: 'operator', sessionId: 'browser', credentialId: 'credential', authMethod: 'cookie',
      csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
      capabilities: ['observe', 'export_result'], repoIds: [REPO_ID],
    },
    origin: ORIGIN, csrfToken: 'csrf', remoteAddress: '127.0.0.1', transport: 'https',
  }, envelope);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.filter((call) => call.name === 'run.export'), [{
    name: 'run.export',
    args: { runId: 'run-web-export', evidenceDigest: DIGEST },
    principal: { actor: 'web:operator:browser', principalId: 'operator', sessionId: 'browser' },
  }]);
  assertNoServerAuthority(response);
});

test('CE9: browser Run desk initiates export through the registry-bound application action', () => {
  const html = operatorAsset('/control').body;
  const script = operatorAsset('/control/app.js').body;
  assert.match(html, /id="result-summary"/u);
  assert.match(html, /id="run-actions"/u);
  assert.equal(script.includes('run_export'), false);
  assert.match(script, /actOnRun\(['"]export_result['"]/u);
  assert.equal(script.includes('actionId'), true);
  assert.equal(script.includes('export_result'), true);
  assert.equal(script.includes('view.export'), true);
  assert.equal(script.includes('exportRoot'), false);
  assert.equal(script.includes('retainedResultRef'), false);
});

test('CE11 red: browser download affordance is gated by an active completed receipt', () => {
  const html = operatorAsset('/control').body;
  const script = operatorAsset('/control/app.js').body;
  assert.match(html, /id="export-download"/u);
  assert.match(script, /view\.export(?:\?\.|\.)state\s*===\s*['"]completed['"]/u);
  assert.equal(script.includes('download_export'), true);
  assert.equal(script.includes('exportRoot'), false);
});
