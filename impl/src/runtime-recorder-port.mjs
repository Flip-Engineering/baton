import { createRecoveryAttemptCompletion } from './recovery-attempt.mjs';

// The recorder port groups the observation-layer authorities that the effect
// and recovery seams share (seam-map §4.3). Every operation below is derived
// from evidence: the recording primitives the coordinator's effect bucket
// (102 members) and recovery bucket (43 members) actually call.
//
// Log authority — this._log.append(partial):
//   133 call sites across 68 coordinator members.
//
// Coordination store write methods — this._coordination.*:
//   65 distinct write methods, ~100 call sites. The port carries the store;
//   each consumer calls the specific methods its body needs.
//
// Route authority — this._route.record(routeKey, ...):
//   2 call sites, 1 member (_runTrustGate). Guarded by typeof at call sites.

export function createRecorderPort({ log, coordination, route }) {
  if (!log || typeof log.append !== 'function') {
    throw new TypeError('recorderPort requires a log with append()');
  }
  return Object.freeze({
    log,
    coordination: coordination ?? null,
    route: route ?? null,

    mapEvent(event) {
      if (!event) return null;
      if (!coordination) return null;
      return coordination.mapOperationalEvent(
        event,
        { actor: 'policy', key: `evidence:${event.worker}:${event.seq}` },
      ).evidence;
    },

    recordDriver(kind, payload, key, actor = 'policy') {
      if (!coordination) return null;
      if (kind === 'authority.rejected'
        && typeof coordination.recordAuthorityRejected === 'function') {
        return coordination.recordAuthorityRejected(payload, { actor, key }).event;
      }
      return coordination.recordDriver(kind, payload, { actor, key }).event;
    },
  });
}

// ---------------------------------------------------------------------------
// Proof consumers: one effect member and one recovery member, migrated
// against the port. Each keeps a same-name same-arity delegate on Coordinator.
// ---------------------------------------------------------------------------

export function detachSharedWorkspace(coordinator, recorder, handle, remainingHolders) {
  const physicalOwnerId = handle.sessionContext?.ownerTaskId ?? null;
  handle.worktree = null;
  handle.ownedWorktreeAuthority = false;
  handle.physicalWorkspaceCleanupCompleted = false;
  handle.workspaceCleanupDeferred = 'holders_remain';
  handle.cleanupPending = handle.runtimeScope?.active === true;
  handle.cleanupError = null;
  try {
    const event = recorder.log.append({
      worker: handle.id, harness: coordinator._harnessOf(handle.vendor),
      turnEpoch: coordinator._safeTurnEpoch(handle),
      kind: 'worktree.custody_deferred', actor: 'policy', ...coordinator._routeAttribution(handle),
      payload: { physicalOwnerId, reason: 'holders_remain', holders: [...remainingHolders] },
    });
    recorder.mapEvent(event);
  } catch { /* The detachment remains authoritative when evidence is unavailable. */ }
  return Promise.resolve(Object.freeze({
    ok: true, result: 'workspace_cleanup_deferred', reason: 'holders_remain',
    physicalOwnerId, holders: Object.freeze([...remainingHolders]),
  }));
}

export function completeDurableRecoveryAttempt(recorder, attempt, state, actor) {
  if (!attempt || attempt.state !== 'pending') return attempt ?? null;
  const completion = createRecoveryAttemptCompletion({
    attemptId: attempt.attemptId,
    admissionDigest: attempt.admissionDigest,
    state,
    receipt: {
      schemaVersion: 1,
      effectStarted: state !== 'not_started',
      transportDisposition: state,
    },
  });
  return recorder.coordination.completeRecoveryAttempt(completion, {
    actor, key: `recovery.attempt.complete:${attempt.attemptId}`,
  }).attempt;
}
