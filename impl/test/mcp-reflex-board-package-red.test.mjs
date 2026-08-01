// MCP reflex surface SLICE 2 red suite (docs/reference/evidence/mcp-reflex-live-2026-07-22/
// mcp-reflex-surface-decisions.md v2 FINAL, de68345, Parts A/D/E/F/H scoped to board+package).
//
// Binds baton_board_{post,reorder,retitle,close,read} to the landed hub methods (postBoardItem,
// reorderBoardItem, retitleBoardItem, closeBoardItem, boardSnapshot) through the Coordinator's own
// wrappers, under orchestrator-lease authority + an MCP-layer expectedBoardFence CAS (the hub
// methods themselves take no such parameter). NO claim/report tools this wave (Part D.9) — an MCP
// operator has no (workerId, taskId) identity, so `requestBoardClaim`/`submitBoardReport` would
// wedge exactly like the F8 deadlock; their names are simply absent from the tool inventory.
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

// Mirrors impl/test/repl1-manifest-red.test.mjs's orchestratorLease() helper: a real
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

// A hand-rolled fake mirroring the real Coordinator's board wrappers (coordinator.mjs
// postBoardItem/retitleBoardItem/reorderBoardItem/closeBoardItem/boardSnapshot) exactly —
// coordination-store.mjs's own board hub methods are already exercised end-to-end by
// impl/test/reflex2-boards-red.test.mjs; this suite is scoped to the MCP dispatch layer.
function fakeCoordinator(coordination) {
  return {
    postBoardItem(fields, opts) { return coordination.postBoardItem(fields, { actor: opts.actor ?? 'orchestrator', key: opts.idempotencyKey }); },
    retitleBoardItem(itemId, fields, opts) { return coordination.retitleBoardItem(itemId, fields, { actor: opts.actor ?? 'orchestrator', key: opts.idempotencyKey }); },
    reorderBoardItem(itemId, ordinal, opts) { return coordination.reorderBoardItem(itemId, ordinal, { actor: opts.actor ?? 'orchestrator', key: opts.idempotencyKey }); },
    closeBoardItem(itemId, opts) { return coordination.closeBoardItem(itemId, { actor: opts.actor ?? 'orchestrator', key: opts.idempotencyKey }); },
    boardSnapshot(board) { return coordination.boardSnapshot(board); },
  };
}

const applicationCard = () => ({
  schemaVersion: 1,
  repoId,
  commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.feedback', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'waves.attach', 'application.shutdown'],
});
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

test('registration: every board/package reflex tool is in the combined inventory, frozen, and _meta-stamped', async () => {
  const { coordination } = coordinationFixture();
  const server = setup({ coordination });
  await initialized(server);
  const response = await request(server, 2, 'tools/list', {});
  const names = response.result.tools.map((tool) => tool.name);
  const expected = ['baton_board_post', 'baton_board_retitle', 'baton_board_reorder', 'baton_board_close', 'baton_board_read',
    'baton_package_admit', 'baton_package_attach', 'baton_package_read'];
  for (const name of expected) assert.ok(names.includes(name), `${name} must be registered`);
  for (const name of ['baton_board_claim', 'baton_board_report', 'baton_board_drop']) {
    assert.equal(names.includes(name), false, `${name} must NOT be registered (Part D.9)`);
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
  const response = await request(server, 2, 'tools/call', { name: 'baton_board_read', arguments: { repoId, runId, board: 'shared' } });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'forbidden');
});

// ============================================================
// Part D — board tools
// ============================================================

test('baton_board_post: STATEFUL admitMcpCall path, bumps the board fence, and a stale expectedBoardFence is refused typed', async () => {
  const { coordination } = coordinationFixture();
  issueOrchestratorLease(coordination, { runId, ...leaseSession });
  const server = setup({ coordination });
  await initialized(server);

  const posted = await request(server, 2, 'tools/call', {
    name: 'baton_board_post',
    arguments: { repoId, idempotencyKey: 'post-1', runId, board: 'shared', title: 'Do X', expectedBoardFence: 0 },
  });
  assert.equal(posted.result.isError, false);
  assert.equal(posted.result.structuredContent.result, 'posted');
  assert.equal(coordination.boardFence('shared'), 1);
  assert.ok(coordination.events().some((event) => event.kind === 'mcp.call_admitted' && event.payload.tool === 'baton_board_post'),
    'STATEFUL reflex tools take the admitMcpCall path');

  const stale = await request(server, 3, 'tools/call', {
    name: 'baton_board_post',
    arguments: { repoId, idempotencyKey: 'post-2', runId, board: 'shared', title: 'Do Y', expectedBoardFence: 0 },
  });
  assert.equal(stale.result.isError, true);
  assert.equal(stale.result.structuredContent.error.code, 'stale_board_fence');
  assert.equal(coordination.boardFence('shared'), 1, 'a refused stale post never bumps the fence');

  const won = await request(server, 4, 'tools/call', {
    name: 'baton_board_post',
    arguments: { repoId, idempotencyKey: 'post-3', runId, board: 'shared', title: 'Do Y', expectedBoardFence: 1 },
  });
  assert.equal(won.result.isError, false);
  assert.equal(coordination.boardFence('shared'), 2);
});

test('baton_board_post: replaying the same idempotencyKey returns the admitted outcome without a second append', async () => {
  const { coordination } = coordinationFixture();
  issueOrchestratorLease(coordination, { runId, ...leaseSession });
  const server = setup({ coordination });
  await initialized(server);
  const args = { repoId, idempotencyKey: 'post-replay', runId, board: 'shared', title: 'Do X', expectedBoardFence: 0 };
  const first = await request(server, 2, 'tools/call', { name: 'baton_board_post', arguments: args });
  const second = await request(server, 3, 'tools/call', { name: 'baton_board_post', arguments: args });
  assert.equal(second.result.structuredContent.item.itemId, first.result.structuredContent.item.itemId);
  assert.equal(coordination.boardFence('shared'), 1, 'the replay never re-dispatches to the hub');
});

test('baton_board_post/admit are refused board_lease_required without an active lease', async () => {
  const { coordination } = coordinationFixture();
  const server = setup({ coordination });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_board_post',
    arguments: { repoId, idempotencyKey: 'post-nolease', runId, board: 'shared', title: 'Do X', expectedBoardFence: 0 },
  });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'board_lease_required');
  assert.equal(coordination.boardFence('shared'), 0);
});

test('baton_board_retitle / baton_board_reorder / baton_board_close all CAS against the current board fence', async () => {
  const { coordination } = coordinationFixture();
  issueOrchestratorLease(coordination, { runId, ...leaseSession });
  const server = setup({ coordination });
  await initialized(server);

  const posted = await request(server, 2, 'tools/call', {
    name: 'baton_board_post',
    arguments: { repoId, idempotencyKey: 'post-1', runId, board: 'shared', title: 'Do X', expectedBoardFence: 0 },
  });
  const itemId = posted.result.structuredContent.item.itemId;
  assert.equal(coordination.boardFence('shared'), 1);

  const staleRetitle = await request(server, 3, 'tools/call', {
    name: 'baton_board_retitle',
    arguments: { repoId, idempotencyKey: 'retitle-stale', runId, board: 'shared', itemId, itemVersion: 1, title: 'Do X (edited)', expectedBoardFence: 0 },
  });
  assert.equal(staleRetitle.result.structuredContent.error.code, 'stale_board_fence');

  const retitled = await request(server, 4, 'tools/call', {
    name: 'baton_board_retitle',
    arguments: { repoId, idempotencyKey: 'retitle-1', runId, board: 'shared', itemId, itemVersion: 1, title: 'Do X (edited)', expectedBoardFence: 1 },
  });
  assert.equal(retitled.result.isError, false);
  assert.equal(retitled.result.structuredContent.item.itemVersion, 2);
  assert.equal(coordination.boardFence('shared'), 2);

  const reordered = await request(server, 5, 'tools/call', {
    name: 'baton_board_reorder',
    arguments: { repoId, idempotencyKey: 'reorder-1', runId, board: 'shared', itemId, itemVersion: 2, ordinal: 1, expectedBoardFence: 2 },
  });
  assert.equal(reordered.result.isError, false);
  assert.equal(coordination.boardFence('shared'), 3);

  const closed = await request(server, 6, 'tools/call', {
    name: 'baton_board_close',
    arguments: { repoId, idempotencyKey: 'close-1', runId, board: 'shared', itemId, itemVersion: 3, expectedBoardFence: 3 },
  });
  assert.equal(closed.result.isError, false);
  assert.equal(closed.result.structuredContent.item.state, 'closed');
  assert.equal(coordination.boardFence('shared'), 4);
});

test('baton_board_retitle against an unknown itemId is refused board_item_not_found, never a phantom fence check', async () => {
  const { coordination } = coordinationFixture();
  issueOrchestratorLease(coordination, { runId, ...leaseSession });
  const server = setup({ coordination });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_board_retitle',
    arguments: { repoId, idempotencyKey: 'retitle-missing', runId, board: 'shared', itemId: 'board-item:' + 'a'.repeat(64), itemVersion: 1, title: 'x', expectedBoardFence: 0 },
  });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'board_item_not_found');
});

test('baton_board_read: read-only observe path, full orchestrator slice, non-evented, and typed errors reach the tool boundary', async () => {
  const { coordination } = coordinationFixture();
  issueOrchestratorLease(coordination, { runId, ...leaseSession });
  const server = setup({ coordination });
  await initialized(server);
  await request(server, 2, 'tools/call', {
    name: 'baton_board_post',
    arguments: { repoId, idempotencyKey: 'post-1', runId, board: 'shared', title: 'Do X', owner: 'worker-x', expectedBoardFence: 0 },
  });
  const before = coordination.events().length;
  const read = await request(server, 3, 'tools/call', { name: 'baton_board_read', arguments: { repoId, runId, board: 'shared' } });
  assert.equal(read.result.isError, false);
  assert.equal(read.result.structuredContent.viewer.role, 'orchestrator');
  assert.equal(read.result.structuredContent.items.length, 1);
  assert.equal(read.result.structuredContent.items[0].owner, 'worker-x');
  assert.equal(coordination.events().length, before, 'a board read appends nothing to the ledger');
  assert.equal(coordination.events().some((event) => event.kind === 'mcp.call_admitted' && event.payload.tool === 'baton_board_read'),
    false, 'a read-only reflex tool never takes the admitMcpCall path');
});

test('baton_board_read serves the process-local cache while the fence is unchanged, and a fresh server rebuilds it after a restart', async () => {
  const dir = tmpDir();
  const coordination = new CoordinationStore(join(dir, 'coordination'), {
    repoId, runLineagePolicy, clock: () => new Date(NOW).toISOString(),
  });
  issueOrchestratorLease(coordination, { runId, ...leaseSession });
  const server = setup({ coordination });
  await initialized(server);
  await request(server, 2, 'tools/call', {
    name: 'baton_board_post',
    arguments: { repoId, idempotencyKey: 'post-1', runId, board: 'shared', title: 'Do X', expectedBoardFence: 0 },
  });
  const first = await request(server, 3, 'tools/call', { name: 'baton_board_read', arguments: { repoId, runId, board: 'shared' } });
  const second = await request(server, 4, 'tools/call', { name: 'baton_board_read', arguments: { repoId, runId, board: 'shared' } });
  assert.deepEqual(second.result.structuredContent, first.result.structuredContent);

  const replayed = new CoordinationStore(join(dir, 'coordination'), {
    repoId, runLineagePolicy, clock: () => new Date(NOW).toISOString(),
  });
  const restarted = setup({ coordination: replayed });
  await initialized(restarted);
  const afterRestart = await request(restarted, 5, 'tools/call', { name: 'baton_board_read', arguments: { repoId, runId, board: 'shared' } });
  assert.equal(afterRestart.result.isError, false);
  assert.deepEqual(afterRestart.result.structuredContent.items, first.result.structuredContent.items,
    'replay reconstructs the identical projection input with no ledger event required');
});

test('Part D.9: no claim/report tools are registered — calling them by name is refused at the protocol layer', async () => {
  const { coordination } = coordinationFixture();
  const server = setup({ coordination });
  await initialized(server);
  for (const name of ['baton_board_claim', 'baton_board_report']) {
    const response = await request(server, 2, 'tools/call', { name, arguments: { repoId } });
    assert.equal(response.result, undefined);
    assert.equal(response.error.code, -32602, `${name} must be refused as an unknown tool`);
  }
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
