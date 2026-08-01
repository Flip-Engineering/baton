// S-2 v2 board/package authority primitive — red-first contract battery.
// Authority: docs/reference/evidence/control-surface-2026-07-31/
// s2-board-authority-subcontract.md (v2 section only).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationRefusal, CoordinationStore } from '../src/coordination-store.mjs';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');
const repoId = 'repo-board-authority';
const dirs = [];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function dir() {
  const value = mkdtempSync(join(tmpdir(), 'baton-board-authority-'));
  dirs.push(value);
  return value;
}
test.after(() => { for (const value of dirs) rmSync(value, { recursive: true, force: true }); });

function store(clock = () => new Date(NOW).toISOString()) {
  return new CoordinationStore(dir(), {
    repoId, clock,
    runLineagePolicy: {
      schemaVersion: 1, maxDepth: 3, maxChildrenPerRun: 2, maxDescendantsPerRoot: 4,
      leaseTtlMs: 3_600_000, maxReplManifestsPerRun: 4,
    },
  });
}

// issueRunOrchestratorLease pins its idempotency key to the derived lease identity, so the
// fixture computes the same documented identity tuple before issuing it.
function authorityFixture(options = {}) {
  const coordination = store(options.clock);
  const runId = options.runId ?? 'run-a';
  const principalId = options.principalId ?? 'principal-a';
  const sessionId = options.sessionId ?? 'session-a';
  const authorityDigest = options.authorityDigest
    ?? digest({ proof: `${runId}:${principalId}:${sessionId}` });
  const expiresAt = options.expiresAt ?? new Date(NOW + 3_600_000).toISOString();
  const taskId = `task-${runId}-${principalId}`;
  const workerId = `worker-${runId}-${principalId}`;
  coordination.createTask({
    id: taskId, brief: { objective: `orchestrate ${runId}`, capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = coordination.claimTask(taskId, workerId, 1,
    { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
      harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
      modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3',
      modelObserved: 'kimi-code/k3', effortRequested: 'max', effortResolved: 'max',
      effortObserved: 'max', routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
    }).task;
  const identity = {
    repoId, parentRunId: runId, parentTaskId: taskId, parentTaskVersion: task.version,
    workerId, principalId, sessionId, sessionAuthorityDigest: authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  const receipt = coordination.issueRunOrchestratorLease({
    schemaVersion: 1, repoId, parentTask: { id: taskId, version: task.version },
    session: { principalId, sessionId, authorityDigest, expiresAt },
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` });
  const sessionAuthority = Object.freeze({
    schemaVersion: 1, authorityDigest, expiresAt, orchestratorLeaseId: receipt.lease.leaseId,
  });
  return { coordination, receipt, runId, principalId, sessionId, sessionAuthority };
}

function envelope(f, overrides = {}) {
  return {
    sessionAuthority: f.sessionAuthority,
    runId: f.runId,
    board: 'shared',
    item: null,
    mutation: { kind: 'post', title: 'A', detail: null, owner: null, evidence: [] },
    expectedBoardFence: 0,
    idempotencyKey: 'ba:post:a',
    ...overrides,
  };
}

function refusal(code, fn) {
  assert.throws(fn, (error) => error instanceof CoordinationRefusal && error.code === code,
    `expected typed refusal ${code}`);
}

function post(f, overrides = {}) {
  return f.coordination.admitBoardCommand(envelope(f, overrides));
}

test('BA-1 shape: the envelope is closed, complete, and bounded', () => {
  const f = authorityFixture();
  refusal('board_admission_invalid', () => post(f, { surprise: true }));
  const missing = envelope(f); delete missing.runId;
  refusal('board_admission_invalid', () => f.coordination.admitBoardCommand(missing));
  refusal('board_admission_invalid', () => post(f, {
    mutation: { kind: 'post', title: 'x'.repeat(161), detail: null, owner: null, evidence: [] },
  }));
});

test('BA-2 lease + BA-2+ impersonation: absent/expired/revoked proof refuses before session mismatch; forged proof mismatches', () => {
  const f = authorityFixture();
  refusal('board_lease_required', () => post(f, {
    sessionAuthority: { ...f.sessionAuthority, orchestratorLeaseId: `run-orchestrator-lease:${'0'.repeat(64)}` },
  }));
  refusal('board_session_mismatch', () => post(f, {
    sessionAuthority: { ...f.sessionAuthority, authorityDigest: 'f'.repeat(64) },
  }));
  f.coordination.revokeRunOrchestratorLease({
    schemaVersion: 1, leaseId: f.receipt.lease.leaseId,
    leaseDigest: f.receipt.lease.leaseDigest, reason: 'operator',
  }, { actor: 'orchestrator', key: `run.orchestrator_lease.revoke:${f.receipt.lease.leaseId}` });
  refusal('board_lease_required', () => post(f));

  let now = NOW;
  const expired = authorityFixture({ clock: () => new Date(now).toISOString(), expiresAt: new Date(NOW + 1_000).toISOString() });
  now += 2_000;
  refusal('board_lease_required', () => post(expired));
});

test('BA-3 session: proof is caller-supplied and principal identity derives only from its lease', () => {
  const f = authorityFixture();
  const foreign = authorityFixture({ runId: 'run-b', principalId: 'principal-b', sessionId: 'session-b' });
  refusal('board_session_mismatch', () => post(f, {
    sessionAuthority: { ...f.sessionAuthority, authorityDigest: foreign.sessionAuthority.authorityDigest },
  }));
  assert.equal(post(f).event.actor, f.receipt.lease.session.principalId);
});

test('BA-4 run state: a terminal/stopping Run refuses before item existence', () => {
  const f = authorityFixture();
  f.coordination._runStopByTarget.set(f.runId, { runId: f.runId });
  refusal('board_run_closed', () => post(f, {
    item: { itemId: 'board-item:does-not-exist', itemVersion: 1 },
    mutation: { kind: 'close' },
  }));
});

test('BA-4+ binding: foreign-Run authority refuses and a pre-v2 board is adopted exactly once', () => {
  const f = authorityFixture();
  const created = post(f);
  assert.equal(f.coordination.boardSnapshot('shared').runId, 'run-a');
  const leaseB = authorityFixture({ runId: 'run-b', principalId: 'principal-b', sessionId: 'session-b' });
  // Put Run B's valid lease into the same store, preserving a same-repository adversary.
  const b = authorityFixtureOnStore(f.coordination, leaseB);
  refusal('board_session_mismatch', () => f.coordination.admitBoardCommand(envelope(b, {
    board: 'shared', item: { itemId: created.item.itemId, itemVersion: created.item.itemVersion },
    mutation: { kind: 'close' }, expectedBoardFence: 1, idempotencyKey: 'ba:foreign-close',
  })));

  f.coordination.postBoardItem({ board: 'legacy', title: 'pre-v2' }, { actor: 'fixture', key: 'legacy:post' });
  const adopted = post(f, { board: 'legacy', expectedBoardFence: 1, idempotencyKey: 'ba:adopt' });
  assert.equal(adopted.boardRunBinding.result, 'adopted');
  assert.equal(f.coordination.boardSnapshot('legacy').runId, 'run-a');
  refusal('board_session_mismatch', () => f.coordination.admitBoardCommand(envelope(b, {
    board: 'legacy', expectedBoardFence: 2, idempotencyKey: 'ba:adopt-again',
  })));
});

function authorityFixtureOnStore(coordination, source) {
  const { runId, principalId, sessionId, sessionAuthority } = source;
  const taskId = `task-${runId}-${principalId}`;
  const workerId = `worker-${runId}-${principalId}`;
  coordination.createTask({
    id: taskId, brief: { objective: `orchestrate ${runId}`, capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = coordination.claimTask(taskId, workerId, 1,
    { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
      harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
      modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
      effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
      routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
    }).task;
  const identity = {
    repoId, parentRunId: runId, parentTaskId: taskId, parentTaskVersion: task.version,
    workerId, principalId, sessionId, sessionAuthorityDigest: sessionAuthority.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  const receipt = coordination.issueRunOrchestratorLease({
    schemaVersion: 1, repoId, parentTask: { id: taskId, version: task.version },
    session: { principalId, sessionId, authorityDigest: sessionAuthority.authorityDigest, expiresAt: sessionAuthority.expiresAt },
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` });
  return {
    coordination, receipt, runId, principalId, sessionId,
    sessionAuthority: { ...sessionAuthority, orchestratorLeaseId: receipt.lease.leaseId },
  };
}

test('BA-5 fence + BA-5+ append seam: stale CAS refuses and an in-seam interleaving cannot win twice', () => {
  const f = authorityFixture();
  post(f);
  refusal('stale_board_fence', () => post(f, { idempotencyKey: 'ba:stale' }));
  const before = f.coordination.boardSnapshot('shared').items.length;
  f.coordination._boardAdmissionInterleave = () => {
    f.coordination._boardAdmissionInterleave = null;
    f.coordination.postBoardItem({ board: 'shared', title: 'interleaver' }, { actor: 'fixture', key: 'ba:interleaver' });
  };
  refusal('stale_board_fence', () => post(f, { expectedBoardFence: 1, idempotencyKey: 'ba:loser' }));
  assert.equal(f.coordination.boardSnapshot('shared').items.length, before + 1, 'only the interleaver appends');
});

test('BA-6 parent + BA-6+ drop: parent CAS follows fence, and all five mutations advance the fence', () => {
  const f = authorityFixture();
  const a = post(f);
  const mutate = (mutation, key, expectedBoardFence, item = a.item) => f.coordination.admitBoardCommand(envelope(f, {
    item: { itemId: item.itemId, itemVersion: item.itemVersion }, mutation,
    expectedBoardFence, idempotencyKey: key,
  }));
  const retitled = mutate({ kind: 'retitle', title: 'A2', detail: null }, 'ba:retitle', 1);
  refusal('board_parent_stale', () => f.coordination.admitBoardCommand(envelope(f, {
    item: { itemId: a.item.itemId, itemVersion: 1 }, mutation: { kind: 'close' },
    expectedBoardFence: 2, idempotencyKey: 'ba:old-parent',
  })));
  const reordered = mutate({ kind: 'reorder', ordinal: 2 }, 'ba:reorder', 2, retitled.item);
  const dropped = mutate({ kind: 'drop' }, 'ba:drop', 3, reordered.item);
  assert.equal(dropped.item.state, 'dropped');
  assert.equal(f.coordination.boardFence('shared'), 4);

  const second = post(f, { expectedBoardFence: 4, idempotencyKey: 'ba:post:b', mutation: { kind: 'post', title: 'B', detail: null, owner: null, evidence: [] } });
  mutate({ kind: 'close' }, 'ba:close', 5, second.item);
  assert.equal(f.coordination.boardFence('shared'), 6, 'post, retitle, reorder, drop, post, and close each advance exactly once');
});

test('BA-7 read: transported full projection needs bound-Run proof; worker-slice in-process read remains available', () => {
  const f = authorityFixture();
  post(f);
  refusal('board_lease_required', () => f.coordination.admitBoardCommand(envelope(f, {
    sessionAuthority: { ...f.sessionAuthority, orchestratorLeaseId: `run-orchestrator-lease:${'0'.repeat(64)}` },
    mutation: { kind: 'read' }, item: null, expectedBoardFence: null, idempotencyKey: 'ba:read:none',
  })));
  const read = f.coordination.admitBoardCommand(envelope(f, {
    mutation: { kind: 'read' }, item: null, expectedBoardFence: null, idempotencyKey: 'ba:read',
  }));
  assert.equal(read.snapshot.items.length, 1);
  assert.equal(f.coordination.boardSnapshot('shared').items.length, 1, 'in-process worker projection source remains callable');
});

test('BA-8 replay + BA-8+ content binding: key and normalized request both bind idempotency', () => {
  const f = authorityFixture();
  const request = envelope(f);
  const first = f.coordination.admitBoardCommand(request);
  const replay = f.coordination.admitBoardCommand({ ...request, mutation: { ...request.mutation } });
  assert.equal(replay.result, 'idempotent');
  assert.equal(replay.event.seq, first.event.seq);
  assert.equal(f.coordination.boardSnapshot('shared').items.length, 1);
  refusal('board_replay_conflict', () => f.coordination.admitBoardCommand({
    ...request, mutation: { ...request.mutation, detail: 'changed' },
  }));
});

test('BA-9 existence placement: valid authority sees not-found; invalid authority never learns existence', () => {
  const f = authorityFixture();
  const missing = {
    item: { itemId: 'board-item:missing', itemVersion: 1 }, mutation: { kind: 'close' },
    expectedBoardFence: 0, idempotencyKey: 'ba:missing',
  };
  refusal('board_item_not_found', () => post(f, missing));
  refusal('board_session_mismatch', () => post(f, {
    ...missing, idempotencyKey: 'ba:missing-forged',
    sessionAuthority: { ...f.sessionAuthority, authorityDigest: 'f'.repeat(64) },
  }));
});

test('BA-9 MCP thinness + actor honesty: adapter carries proof and no lease/fence guard or actor default', () => {
  const source = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  const boardDispatch = source.slice(source.indexOf("else if (name === 'baton_board_post')"), source.indexOf("else if (name === 'baton_package_admit')"));
  assert.doesNotMatch(boardDispatch, /_requireOrchestratorLease|_requireBoardFence|activeRunOrchestratorLeaseForSession/);
  assert.doesNotMatch(boardDispatch, /actor\s*\?\?\s*['"]orchestrator['"]/);
  assert.match(boardDispatch, /sessionAuthority/);
  for (const kind of ['post', 'retitle', 'reorder', 'close', 'read']) assert.match(boardDispatch, new RegExp(`kind:\\s*['"]${kind}['"]`));

  const coordinator = readFileSync(new URL('../src/coordinator.mjs', import.meta.url), 'utf8');
  const wrappers = coordinator.slice(coordinator.indexOf('// ---- REFLEX-2 boards:'), coordinator.indexOf('// ---- REFLEX-2 boards: worker traffic'));
  assert.doesNotMatch(wrappers, /actor\s*\?\?\s*['"]orchestrator['"]/);
});

test('BA-10 facade acquisition: receipt TTL and revocation are honored; no ambient facade authority exists', () => {
  const f = authorityFixture();
  assert.equal(f.receipt.result, 'issued');
  assert.equal(f.receipt.lease.expiresAt, new Date(NOW + 3_600_000).toISOString());
  refusal('board_lease_required', () => f.coordination.admitBoardCommand(envelope(f, { sessionAuthority: null })));
  post(f);
  f.coordination.revokeRunOrchestratorLease({
    schemaVersion: 1, leaseId: f.receipt.lease.leaseId, leaseDigest: f.receipt.lease.leaseDigest, reason: 'operator',
  }, { actor: f.principalId, key: `run.orchestrator_lease.revoke:${f.receipt.lease.leaseId}` });
  refusal('board_lease_required', () => post(f, { expectedBoardFence: 1, idempotencyKey: 'ba:after-revoke' }));
});
