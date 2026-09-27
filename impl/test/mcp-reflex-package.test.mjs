// MCP reflex surface SLICE 2 suite (docs/reference/evidence/mcp-reflex-live-2026-07-22/
// mcp-reflex-surface-decisions.md v2 FINAL, de68345, Parts A/E/F/H scoped to package).
//
// Binds baton_package_{admit,attach,read} directly to the coordination-store hub methods
// (admitContextPackage, attachContextPackage, resolveContextPackageBranch, contextPackage) — attach
// is the fenced O(1) pointer binding (no branch re-read); read surfaces missing/changed bytes as
// the one typed `artifact_unavailable` tool error, never a silent recompute.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, McpFleetServer } from '../src/index.mjs';
import { mockApplicationCard } from '../scripts/surface-truth.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program-policy.mjs';

const NOW = Date.parse('2026-07-22T00:00:00.000Z');
const repoId = 'repo-reflex-bp';

const runLineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 3, maxChildrenPerRun: 2, maxDescendantsPerRoot: 4,
  leaseTtlMs: 3_600_000, maxReplManifestsPerRun: 4,
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-mcp-reflex-bp-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// A minimal context-artifact resolver: every branch is an `artifact` ref keyed by content, so
// admission/resolve/read exercise the real hub byte-verification path (F11.3/artifact_unavailable).
function resolver() {
  const artifacts = new Map();
  const calls = [];
  const read = (reference) => {
    calls.push(reference);
    if (!artifacts.has(reference.handle)) {
      const error = new Error('context package artifact is unavailable');
      error.code = 'context_artifact_unavailable';
      throw error;
    }
    return artifacts.get(reference.handle);
  };
  return { artifacts, calls, read };
}

function artifactBranch(name, res, content = { hello: name }) {
  const artifactDigest = digest(content);
  const handle = `art:sha256:${artifactDigest}`;
  res.artifacts.set(handle, content);
  return {
    name, source: null, valueRef: null, schema: null,
    artifact: {
      kind: 'context_value', digest: artifactDigest, handle,
      mediaType: 'application/vnd.baton.context-value+json',
      bytes: Buffer.byteLength(JSON.stringify(content)),
    },
  };
}

function packageFields(branches, overrides = {}) {
  return {
    schemaVersion: 1, kind: 'baton.context_package', branches,
    provenance: { runId: overrides.runId ?? 'run-a', principalId: overrides.principalId ?? 'principal-a' },
    policyDigest: DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest,
    ...overrides.provenanceExtra ? { provenance: { ...overrides.provenanceExtra } } : {},
  };
}

function coordinationFixture() {
  const res = resolver();
  const coordination = new CoordinationStore(join(tmpDir(), 'coordination'), {
    repoId, runLineagePolicy,
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: '2'.repeat(64),
    contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: res.read,
    contextSourceAttest: () => { throw new Error('not used in this suite'); },
    deploymentBaseSha: '1'.repeat(40),
    clock: () => new Date(NOW).toISOString(),
  });
  return { coordination, res };
}

function reopenCoordination(path, res) {
  return new CoordinationStore(path, {
    repoId, runLineagePolicy,
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: '2'.repeat(64),
    contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: res.read,
    contextSourceAttest: () => { throw new Error('not used in this suite'); },
    deploymentBaseSha: '1'.repeat(40),
    clock: () => new Date(NOW).toISOString(),
  });
}

// Mirrors impl/test/repl1-manifest.test.mjs's orchestratorLease() helper: a real
// run-orchestrator lease minted against a plain CoordinationStore (task created + claimed with
// the `baton_orchestrator` capability, then issueRunOrchestratorLease binds the session).
function issueOrchestratorLease(coordination, { runId, principalId, sessionId, expiresAt }) {
  const workerId = `worker-${runId}`;
  coordination.createTask({
    id: `task-${runId}`,
    brief: { objective: `orchestrate ${runId}`, capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${runId}` });
  const task = coordination.claimTask(`task-${runId}`, workerId, 1,
    { actor: 'orchestrator', key: `task.claimed:${runId}` }, {
      harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture', modelRequested: 'kimi-code/k3',
      modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3', effortRequested: 'max',
      effortResolved: 'max', effortObserved: 'max', routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
    }).task;
  const session = {
    principalId, sessionId,
    authorityDigest: digest({ kind: 'authenticated-worker-session', principalId, sessionId }),
    expiresAt,
  };
  const identity = {
    repoId, parentRunId: runId, parentTaskId: `task-${runId}`, parentTaskVersion: task.version,
    workerId: task.assignee, principalId, sessionId, sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  return coordination.issueRunOrchestratorLease(
    { schemaVersion: 1, repoId, parentTask: { id: `task-${runId}`, version: task.version }, session },
    { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` },
  ).lease;
}

// The package tools bind directly to the coordination store; the fake coordinator is empty.
function fakeCoordinator() {
  return {};
}

// The card's commands derive from the command table (surface-truth.mjs).
const applicationCard = () => mockApplicationCard(repoId);
function fakeApplication() {
  return {
    repoId, card: applicationCard,
    async authorizeReplay() { return true; },
    async command() { return {}; },
  };
}

function principal(overrides = {}) {
  return {
    userId: 'orchestrator-a', sessionId: 'session-a', capabilities: ['observe'],
    repoIds: [repoId], expiresAt: new Date(NOW + 3_600_000).toISOString(), revoked: false,
    ...overrides,
  };
}

function setup({ coordination, coordinator } = {}) {
  const basePrincipal = principal();
  const lease = coordination?.activeRunOrchestratorLeaseForSession({
    repoId, principalId: basePrincipal.userId, sessionId: basePrincipal.sessionId,
    expiresAt: basePrincipal.expiresAt,
  }) ?? null;
  const authenticatedPrincipal = lease ? {
    ...basePrincipal,
    sessionAuthority: {
      schemaVersion: 1, authorityDigest: lease.session.authorityDigest,
      expiresAt: lease.session.expiresAt, orchestratorLeaseId: lease.leaseId,
    },
  } : basePrincipal;
  const server = new McpFleetServer({
    coordinator: coordinator ?? fakeCoordinator(coordination),
    coordination, application: fakeApplication(),
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    surface: 'combined',
    principal: authenticatedPrincipal, repoIds: [repoId], now: () => NOW,
    maxWaitMs: 25_000, maxMessageBytes: 256 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  return server;
}

const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

const runId = 'run-reflex-bp';
const leaseSession = { principalId: 'orchestrator-a', sessionId: 'session-a', expiresAt: new Date(NOW + 3_600_000).toISOString() };

// ============================================================
// Part A / Part H — registration + inventory
// ============================================================

test('registration: every package reflex tool is in the combined inventory, frozen, and _meta-stamped', async () => {
  const { coordination } = coordinationFixture();
  const server = setup({ coordination });
  await initialized(server);
  const response = await request(server, 2, 'tools/list', {});
  const names = response.result.tools.map((tool) => tool.name);
  const expected = ['baton_package_admit', 'baton_package_attach', 'baton_package_read'];
  for (const name of expected) assert.ok(names.includes(name), `${name} must be registered`);
  for (const name of ['baton_board_post', 'baton_board_read']) {
    assert.equal(names.includes(name), false, `${name} must NOT be registered`);
  }
  const reflexTools = response.result.tools.filter((tool) => expected.includes(tool.name));
  assert.equal(reflexTools.length, expected.length);
  for (const tool of reflexTools) {
    assert.equal(tool.execution.taskSupport, 'forbidden');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.hasOwnProperty('_meta'), `${tool.name} must carry _meta`);
    assert.ok(tool._meta['baton/registryDigest'], `${tool.name} _meta must carry a registryDigest`);
  }
});

test('registration: a principal without observe capability is refused forbidden on every reflex tool', async () => {
  const { coordination } = coordinationFixture();
  const server = new McpFleetServer({
    coordinator: fakeCoordinator(coordination), coordination, application: fakeApplication(),
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    surface: 'combined', principal: principal({ capabilities: [] }), repoIds: [repoId], now: () => NOW,
    maxWaitMs: 25_000, maxMessageBytes: 256 * 1024, takeToolQuota: () => ({ ok: true }),
  });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', { name: 'baton_package_read', arguments: { repoId, packageDigest: '0'.repeat(64) } });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'forbidden');
});


// ============================================================
// Part E — package tools
// ============================================================

test('baton_package_admit refuses a submitter-supplied provenance.packageEvent as reserved_package_field', async () => {
  const { coordination, res } = coordinationFixture();
  issueOrchestratorLease(coordination, { runId, ...leaseSession });
  const server = setup({ coordination });
  await initialized(server);
  const fields = packageFields([artifactBranch('a', res)]);
  fields.provenance = { ...fields.provenance, packageEvent: { sourceEventSeq: 1, sourceEventDigest: '0'.repeat(64) } };
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_package_admit', arguments: { repoId, idempotencyKey: 'admit-bad', runId, package: fields },
  });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'reserved_package_field');
});

test('baton_package_admit is refused board_lease_required without an active lease', async () => {
  const { coordination, res } = coordinationFixture();
  const server = setup({ coordination });
  await initialized(server);
  const fields = packageFields([artifactBranch('a', res)]);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_package_admit', arguments: { repoId, idempotencyKey: 'admit-nolease', runId, package: fields },
  });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'board_lease_required');
});

test('baton_package_admit -> baton_package_attach -> baton_package_read round-trips, and attach never re-reads branch bytes', async () => {
  const { coordination, res } = coordinationFixture();
  issueOrchestratorLease(coordination, { runId, ...leaseSession });
  const server = setup({ coordination });
  await initialized(server);

  const fields = packageFields([artifactBranch('a', res)], { runId });
  const admitted = await request(server, 2, 'tools/call', {
    name: 'baton_package_admit', arguments: { repoId, idempotencyKey: 'admit-1', runId, package: fields },
  });
  assert.equal(admitted.result.isError, false);
  assert.equal(admitted.result.structuredContent.result, 'admitted');
  const packageDigest = admitted.result.structuredContent.package.packageDigest;

  res.calls.length = 0;
  const attached = await request(server, 3, 'tools/call', {
    name: 'baton_package_attach', arguments: { repoId, idempotencyKey: 'attach-1', packageDigest, runId, scope: 'run' },
  });
  assert.equal(attached.result.isError, false);
  assert.equal(attached.result.structuredContent.result, 'attached');
  assert.equal(res.calls.length, 0, 'attach is a fenced O(1) pointer binding — never a re-read of branch bytes');

  const metadata = await request(server, 4, 'tools/call', {
    name: 'baton_package_read', arguments: { repoId, packageDigest },
  });
  assert.equal(metadata.result.isError, false);
  assert.equal(metadata.result.structuredContent.packageDigest, packageDigest);
  assert.equal(metadata.result.structuredContent.branches.length, 1);

  const branch = await request(server, 5, 'tools/call', {
    name: 'baton_package_read', arguments: { repoId, packageDigest, branchName: 'a' },
  });
  assert.equal(branch.result.isError, false);
  assert.equal(branch.result.structuredContent.provenance, 'untrusted');
  assert.ok(branch.result.structuredContent.artifact.includes('"hello":"a"'));
});

test('baton_package_read surfaces missing branch bytes as the typed artifact_unavailable tool error at resolve time', async () => {
  const { coordination, res } = coordinationFixture();
  issueOrchestratorLease(coordination, { runId, ...leaseSession });
  const server = setup({ coordination });
  await initialized(server);
  const branch = artifactBranch('a', res);
  const fields = packageFields([branch], { runId });
  const admitted = await request(server, 2, 'tools/call', {
    name: 'baton_package_admit', arguments: { repoId, idempotencyKey: 'admit-1', runId, package: fields },
  });
  const packageDigest = admitted.result.structuredContent.package.packageDigest;
  res.artifacts.delete(branch.artifact.handle);

  const response = await request(server, 3, 'tools/call', {
    name: 'baton_package_read', arguments: { repoId, packageDigest, branchName: 'a' },
  });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'artifact_unavailable');
  assert.equal(coordination.events().some((event) => event.kind === 'mcp.call_admitted' && event.payload.tool === 'baton_package_read'),
    false, 'package read is a read-only observe-path tool');
});

test('baton_package_read against an unknown packageDigest is refused artifact_unavailable, never a silent empty result', async () => {
  const { coordination } = coordinationFixture();
  const server = setup({ coordination });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_package_read', arguments: { repoId, packageDigest: 'f'.repeat(64) },
  });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'artifact_unavailable');
});
