// Scratch probe (not committed): exercise connection-authority against the nested-orchestration
// fixtures R1/R7/R8 assert, without running the suite.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore, WebSessionStore, mintChildAuthority, revokeChildAuthority, sweepChildOrphans } from './src/index.mjs';
import { canonicalDigest } from './src/coordination-internals.mjs';

const REPO = 'repo-nested-orchestration';
const NOW = '2026-08-06T00:00:00.000Z';
const EXPIRES = '2026-08-06T01:00:00.000Z';
const runLineagePolicy = Object.freeze({ schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 4, maxDescendantsPerRoot: 16, leaseTtlMs: 60_000 });
let clock = NOW;
const dirs = [];
const tmp = (label) => { const d = mkdtempSync(join(tmpdir(), label)); dirs.push(d); return d; };
const digest = (value) => canonicalDigest(value);

function workingParent(store, label, principalId, sessionId) {
  const runId = `run-${label}-parent`;
  const taskId = `task-${label}-parent`;
  const workerId = `worker-${label}-parent`;
  store.createTask({
    id: taskId,
    brief: { objective: 'Serve authenticated recursive Baton commands', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code',
    modelRequested: 'kimi-code/k3', modelPolicy: null, effortRequested: 'max',
    sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = store.claimTask(taskId, workerId, 1, { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
    harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
    modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
    effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
    routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
  }).task;
  const session = { principalId, sessionId, authorityDigest: digest({ kind: 'authenticated-transport-session', principalId, sessionId }), expiresAt: EXPIRES };
  const identity = {
    repoId: REPO, parentRunId: runId, parentTaskId: taskId, parentTaskVersion: task.version,
    workerId, principalId, sessionId, sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  const lease = store.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: REPO, parentTask: { id: taskId, version: task.version }, session,
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` }).lease;
  return { lease, runId, task };
}

try {
  // ── R1
  {
    const coordination = new CoordinationStore(tmp('probe-r1-coordination-'), { repoId: REPO, clock: () => clock, runLineagePolicy });
    const sessions = new WebSessionStore(tmp('probe-r1-session-'), { now: () => Date.parse(clock) });
    const runtimeRoot = tmp('probe-r1-runtime-');
    const parent = workingParent(coordination, 'r1', 'child-r1', 'session-r1');
    const parentConnection = {
      schemaVersion: 1, url: 'https://control.example.test', origin: 'https://control.example.test',
      tokenFile: 'connections/r1-parent.token', token: 'parent-bearer-token-not-to-be-copied',
    };
    const minted = await mintChildAuthority({
      schemaVersion: 1, repoId: REPO, coordination, sessions,
      parentTask: { id: parent.task.id, version: parent.task.version }, parentConnection, runtimeRoot,
    });
    assert.equal(minted.projection.schemaVersion, 1);
    assert.equal(minted.projection.url, parentConnection.url);
    assert.equal(minted.projection.origin, parentConnection.origin);
    const profilePath = join(runtimeRoot, minted.projection.profile);
    const tokenPath = join(runtimeRoot, minted.projection.tokenFile);
    assert.ok(profilePath.startsWith(`${runtimeRoot}/`), 'profile inside runtime root');
    assert.ok(tokenPath.startsWith(`${runtimeRoot}/`), 'token inside runtime root');
    assert.notEqual(minted.session.token, parentConnection.token);
    assert.equal(digest(minted.session.token) === digest(parentConnection.token), false);
    assert.equal(statSync(tokenPath).mode & 0o777, 0o600, 'token mode 0600');
    const principal = sessions.authenticate({ headers: { authorization: `Bearer ${minted.session.token}` } });
    assert.equal(principal.userId, 'child-r1');
    const lease = coordination.activeRunOrchestratorLeaseForSession({
      repoId: REPO, principalId: 'child-r1', sessionId: minted.session.sessionId, expiresAt: minted.session.expiresAt,
    });
    assert.equal(lease.leaseId, minted.lease.leaseId);
    // writer lease stays held for the R7 leg
    console.log('R1 ok:', minted.projection.profile);

    // ── R7 on the same store: revoke a pre-issued child session + this lease
    const childSession = sessions.issue({
      userId: 'child-r1', authMethod: 'bearer', capabilities: ['observe', 'control'], repoIds: [REPO], ttlMs: 3_600_000,
    }, { actor: 'probe:r7' });
    coordination.transitionTask(parent.task.id, 'completed', parent.task.version, { actor: 'policy', key: `r7.terminal:${parent.task.id}` });
    const revoked = await revokeChildAuthority({
      schemaVersion: 1, coordination, sessions, sessionId: childSession.sessionId, leaseId: minted.lease.leaseId, reason: 'parent_terminal',
    });
    assert.equal(revoked.ok, true);
    assert.equal(revoked.result, 'revoked');
    assert.equal(coordination.runOrchestratorLease(minted.lease.leaseId)?.status, 'revoked');
    const revokedPrincipal = sessions.authenticate({ headers: { authorization: `Bearer ${childSession.token}` } });
    assert.equal(revokedPrincipal, null, 'revoked child session does not authenticate');
    // writer lease stays held for the R7 leg
    console.log('R7 ok');
  }

  // ── R8
  {
    clock = NOW;
    const coordination = new CoordinationStore(tmp('probe-r8-coordination-'), { repoId: REPO, clock: () => clock, runLineagePolicy });
    const sessions = new WebSessionStore(tmp('probe-r8-session-'), { now: () => Date.parse(clock) });
    const runtime = tmp('probe-r8-runtime-');
    const parent = workingParent(coordination, 'r8', 'child-r8', 'session-r8');
    const childSession = sessions.issue({
      userId: 'child-r8', authMethod: 'bearer', capabilities: ['observe', 'control'], repoIds: [REPO], ttlMs: 1_000,
    }, { actor: 'probe:r8' });
    coordination.transitionTask(parent.task.id, 'completed', parent.task.version, { actor: 'policy', key: `r8.terminal:${parent.task.id}` });
    clock = new Date(Date.parse(childSession.expiresAt) + 1).toISOString();
    const swept = await sweepChildOrphans({ schemaVersion: 1, coordination, sessions, deadlineMs: 30_000, runtime });
    assert.equal(swept.ok, true);
    assert.ok(Number.isSafeInteger(swept.swept) && swept.swept >= 1, `swept=${swept.swept}`);
    assert.equal(coordination.runOrchestratorLease(parent.lease.leaseId)?.status, 'revoked');
    assert.equal(sessions.authenticate({ headers: { authorization: `Bearer ${childSession.token}` } }), null);
    // writer lease stays held for the R7 leg
    console.log('R8 ok:', swept.swept);
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
