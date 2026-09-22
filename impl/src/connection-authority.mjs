// Issue #12 (the nested-orchestration rung): the child connection authority.
//
// A nested member is an agent the deployment itself drives. It needs the same connection
// discipline a seat has — its own session, its own run-orchestrator lease over its subtree, and a
// connection profile the discovery contract resolves INSIDE its private runtime — never a copy of
// the orchestrator's credential. This module owns the rung's three operations:
//
//   mintChildAuthority    on child spawn: a FRESH session + a lease bound to it + the projection
//                         files (profile and 0600 token) under the worker-private runtime root.
//   revokeChildAuthority  when the parent reaches a terminal path: revoke the child session and
//                         the child lease together, so a dead parent leaves no live authority.
//   sweepChildOrphans     at startup: revoke child authorities whose parent task is terminal or
//                         whose lease epoch has expired.
//
// Nothing here reads a wall clock: the session store and the coordination store own their clocks,
// the lease TTL is the deployment's own policy row, and the "expired" judgment is the store's own
// active-lease lookup rather than a second clock.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';

import { canonicalDigest } from './coordination-internals.mjs';
import { RUN_ORCHESTRATOR_REVOCATION_REASONS } from './run-lineage.mjs';

/** Where the minted projection lands inside the worker-private runtime root. */
const CONNECTION_DIR = 'connections';
/** The task statuses a parent can rest at: a terminal parent owes no live child authority. */
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled', 'denied', 'stopped']);
/** The capabilities a child session receives — the lease's own run-subtree authority. */
const CHILD_CAPABILITIES = Object.freeze(['control', 'observe']);

function refusal(message, code) {
  return Object.assign(new Error(message), { name: 'ConnectionAuthorityError', code });
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireText(value, label, max = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty string of at most ${max} bytes`);
  }
  return value;
}

function requireHost(value, label) {
  const host = requireRecord(value, label);
  for (const method of ['issueRunOrchestratorLease', 'revokeRunOrchestratorLease', 'runOrchestratorLease', 'runOrchestratorLeases', 'activeRunOrchestratorLeaseForSession', 'runLineagePolicy', 'task']) {
    if (typeof host[method] !== 'function') throw new TypeError(`${label} is missing ${method}()`);
  }
  return host;
}

function requireSessions(value) {
  const sessions = requireRecord(value, 'sessions');
  for (const method of ['issue', 'revoke']) {
    if (typeof sessions[method] !== 'function') throw new TypeError(`sessions is missing ${method}()`);
  }
  return sessions;
}

function requireRuntimeRoot(value) {
  const root = requireText(value, 'runtimeRoot', 4096);
  if (!isAbsolute(root)) throw new TypeError('runtimeRoot must be an absolute path');
  return root;
}

function requireSchemaVersion(value) {
  if (value !== 1) throw new TypeError('schemaVersion must be 1');
}

/** The parent task a lease belongs to, resolved from the store — never a caller-supplied row. */
function requireParentTask(task, label) {
  const row = requireRecord(task, label);
  if (typeof row.id !== 'string' || row.id.length === 0 || !Number.isSafeInteger(row.version)) {
    throw new TypeError(`${label} must carry {id, version}`);
  }
  return { id: row.id, version: row.version };
}

/** The one live lease a parent task holds, or a typed refusal naming what is missing. */
function liveParentLease(coordination, repoId, parentTask) {
  const leases = coordination.runOrchestratorLeases()
    .filter((lease) => lease.repoId === repoId
      && lease.parent.taskId === parentTask.id && lease.parent.taskVersion === parentTask.version);
  const active = leases.filter((lease) => lease.status === 'active');
  if (active.length === 0) {
    throw refusal('the parent task holds no live run-orchestrator lease', 'connection_parent_lease_missing');
  }
  if (active.length > 1) {
    throw refusal('the parent task holds more than one live run-orchestrator lease', 'connection_parent_lease_ambiguous');
  }
  return active[0];
}

/** The child session's own authority digest: derived from the identity the session store minted,
 * never copied from the parent's digest (the child carries its own authority). */
function childAuthorityDigest(repoId, principalId, issued) {
  return canonicalDigest({
    kind: 'child-connection-session', repoId, principalId,
    sessionId: issued.sessionId, credentialId: issued.credentialId,
  });
}

/** Write the projection pair (profile + 0600 token) inside the worker-private runtime root and
 * return the runtime-root-relative names the posture publishes. The credential exists only in the
 * token file; the projection the caller receives is a pointer to it. */
function writeProjection(runtimeRoot, parentConnection, token, name) {
  const directory = join(runtimeRoot, CONNECTION_DIR);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const tokenName = `${name}.token`;
  const tokenRelative = `${CONNECTION_DIR}/${tokenName}`;
  const profileRelative = `${CONNECTION_DIR}/${name}.json`;
  const tokenPath = join(runtimeRoot, tokenRelative);
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(tokenPath, 0o600);
  const profilePath = join(runtimeRoot, profileRelative);
  writeFileSync(profilePath, `${JSON.stringify({
    schemaVersion: 1,
    url: parentConnection.url,
    origin: parentConnection.origin,
    tokenFile: tokenName,
  })}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(profilePath, 0o600);
  return { profileRelative, tokenRelative, tokenPath, profilePath };
}

/**
 * Mint the child connection authority for one parent task: a fresh session, a run-orchestrator
 * lease bound to that session over the parent's subtree, and a connection projection whose
 * profile and 0600 token file land inside the worker-private runtime root.
 *
 * @param {{schemaVersion: number, repoId: string, coordination: object, sessions: object,
 *   parentTask: {id: string, version: number}, parentConnection: {url: string, origin: string},
 *   runtimeRoot: string}} input
 */
export async function mintChildAuthority(input) {
  const fields = requireRecord(input, 'mintChildAuthority input');
  requireSchemaVersion(fields.schemaVersion);
  const repoId = requireText(fields.repoId, 'repoId');
  const coordination = requireHost(fields.coordination, 'coordination');
  const sessions = requireSessions(fields.sessions);
  const parentTask = requireParentTask(fields.parentTask, 'parentTask');
  const parentConnection = requireRecord(fields.parentConnection, 'parentConnection');
  const url = requireText(parentConnection.url, 'parentConnection.url', 2048);
  const origin = requireText(parentConnection.origin, 'parentConnection.origin', 2048);
  const runtimeRoot = requireRuntimeRoot(fields.runtimeRoot);
  const parentLease = liveParentLease(coordination, repoId, parentTask);
  const principalId = requireText(parentLease.session.principalId, 'parent lease session principalId');
  const policy = coordination.runLineagePolicy();
  const ttlMs = Number.isSafeInteger(policy?.leaseTtlMs) && policy.leaseTtlMs > 0
    ? policy.leaseTtlMs
    : (() => { throw refusal('the deployment declares no run-lineage lease TTL', 'connection_policy_missing'); })();
  const issued = sessions.issue({
    userId: principalId,
    authMethod: 'bearer',
    capabilities: [...CHILD_CAPABILITIES],
    repoIds: [repoId],
    ttlMs,
  }, { actor: `connection-authority:${principalId}` });
  if (Date.parse(issued.expiresAt) > Date.parse(parentLease.session.expiresAt)) {
    sessions.revoke(issued.sessionId, { actor: `connection-authority:${principalId}` });
    throw refusal('the child session would outlive its parent session', 'connection_child_outlives_parent');
  }
  const authorityDigest = childAuthorityDigest(repoId, principalId, issued);
  const session = Object.freeze({
    principalId, sessionId: issued.sessionId, authorityDigest, expiresAt: issued.expiresAt,
  });
  const leaseId = `run-orchestrator-lease:${canonicalDigest({
    repoId,
    parentRunId: parentLease.parent.runId,
    parentTaskId: parentLease.parent.taskId,
    parentTaskVersion: parentLease.parent.taskVersion,
    workerId: parentLease.parent.workerId,
    principalId,
    sessionId: issued.sessionId,
    sessionAuthorityDigest: authorityDigest,
  })}`;
  const receipt = coordination.issueRunOrchestratorLease({
    schemaVersion: 1, repoId,
    parentTask: { id: parentLease.parent.taskId, version: parentLease.parent.taskVersion },
    session: { ...session },
  }, { actor: `connection-authority:${principalId}`, key: `run.orchestrator_lease:${leaseId}` });
  const name = leaseId.slice('run-orchestrator-lease:'.length).slice(0, 32);
  const projection = writeProjection(runtimeRoot, { url, origin }, issued.token, name);
  return Object.freeze({
    schemaVersion: 1,
    session: Object.freeze({
      sessionId: issued.sessionId, credentialId: issued.credentialId,
      token: issued.token, expiresAt: issued.expiresAt,
    }),
    lease: Object.freeze({ leaseId: receipt.lease.leaseId, expiresAt: receipt.lease.expiresAt }),
    projection: Object.freeze({
      schemaVersion: 1,
      profile: projection.profileRelative,
      tokenFile: projection.tokenRelative,
      url,
      origin,
    }),
  });
}

/** Revoke one child authority: the child session and its run-orchestrator lease, together. Both
 * stores record their own revocation row; a row already revoked is not owed again. */
export async function revokeChildAuthority(input) {
  const fields = requireRecord(input, 'revokeChildAuthority input');
  requireSchemaVersion(fields.schemaVersion);
  const coordination = requireHost(fields.coordination, 'coordination');
  const sessions = requireSessions(fields.sessions);
  const sessionId = requireText(fields.sessionId, 'sessionId');
  const leaseId = requireText(fields.leaseId, 'leaseId', 512);
  const reason = requireText(fields.reason, 'reason', 128);
  if (!RUN_ORCHESTRATOR_REVOCATION_REASONS.includes(reason)) {
    throw new TypeError(`reason must be one of: ${RUN_ORCHESTRATOR_REVOCATION_REASONS.join(', ')}`);
  }
  const lease = coordination.runOrchestratorLease(leaseId);
  if (!lease) throw refusal('the child authority names no lease this deployment holds', 'connection_lease_not_found');
  const actor = `connection-authority:${lease.session.principalId}`;
  if (lease.status === 'active') {
    coordination.revokeRunOrchestratorLease({
      schemaVersion: 1, leaseId, leaseDigest: lease.leaseDigest, reason,
    }, { actor, key: `run.orchestrator_lease.revoke:${leaseId}` });
  }
  sessions.revoke(sessionId, { actor, reason });
  return Object.freeze({ ok: true, result: 'revoked' });
}

/**
 * The startup sweep: revoke every live child authority whose parent task rests terminal or whose
 * lease epoch has already lapsed. `deadlineMs` is the scan's own bound — a budget on how long the
 * sweep walks, never a clock that decides a member's fate: a lease the budget leaves unvisited
 * stays live and is visited by the next sweep.
 *
 * @param {{schemaVersion: number, coordination: object, sessions: object, deadlineMs: number,
 *   runtime: string}} input
 */
export async function sweepChildOrphans(input) {
  const fields = requireRecord(input, 'sweepChildOrphans input');
  requireSchemaVersion(fields.schemaVersion);
  const coordination = requireHost(fields.coordination, 'coordination');
  const sessions = requireSessions(fields.sessions);
  if (!Number.isSafeInteger(fields.deadlineMs) || fields.deadlineMs <= 0) {
    throw new TypeError('deadlineMs must be a positive integer');
  }
  requireText(fields.runtime, 'runtime', 4096);
  const startedAt = Date.now();
  let swept = 0;
  for (const lease of coordination.runOrchestratorLeases()) {
    if (Date.now() - startedAt > fields.deadlineMs) break;
    if (lease.status !== 'active') continue;
    const task = coordination.task(lease.parent.taskId);
    const parentTerminal = !task || TERMINAL_TASK_STATUSES.has(task.status);
    let stillLive = false;
    if (!parentTerminal) {
      // The store's OWN active-lease lookup answers whether the lease's epoch still holds — the
      // sweep never mints a second clock to judge it. A lease the store refuses to resolve
      // because its parent run no longer admits commands is an authority nothing can hold: the
      // sweep clears it rather than propagating the refusal out of a startup pass.
      try {
        stillLive = coordination.activeRunOrchestratorLeaseForSession({
          repoId: lease.repoId,
          principalId: lease.session.principalId,
          sessionId: lease.session.sessionId,
          expiresAt: lease.session.expiresAt,
        }) !== null;
      } catch (error) {
        if (error?.name !== 'CoordinationRefusal') throw error;
        stillLive = false;
      }
    }
    if (!parentTerminal && stillLive) continue;
    const actor = `connection-authority:${lease.session.principalId}`;
    coordination.revokeRunOrchestratorLease({
      schemaVersion: 1, leaseId: lease.leaseId, leaseDigest: lease.leaseDigest,
      reason: parentTerminal ? 'parent_terminal' : 'review_window_expired',
    }, { actor, key: `run.orchestrator_lease.revoke:${lease.leaseId}` });
    sessions.revoke(lease.session.sessionId, { actor, reason: 'session_revoked' });
    swept += 1;
  }
  return Object.freeze({ ok: true, swept });
}

export { CHILD_CAPABILITIES, CONNECTION_DIR };
