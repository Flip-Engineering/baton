// shared-workspace-custody.mjs — which live handles are working in ONE physical checkout, and
// whether that checkout may be closed.
//
// Deliberate shared workspaces let several live participants share one physical owner (`ws-…`):
// one checkout, one branch, one capacity reservation, and each participant its own native
// session. Custody truth is the controller's own live worker handles. It is deliberately NOT
// swarm membership: a participant that left the swarm still holds its process, and a participant
// that is still a member is not evidence that any native holder is alive. It is also not the
// owner receipt, whose field set stays a single-controller Git lease (worktree.mjs).
//
// worktree.mjs stays the only destruction authority (content preservation, receipt and capacity
// settlement). This module answers one question — "is another live holder still in this
// checkout?" — so the coordinator's detach gate and the manager's reap backstop cannot disagree.

// The one spelling of the physical-workspace-id token. The predicate below and every regex that
// needs the shape — worktree.mjs's receipt-filename patterns — derive from this string, so the
// literal is written once in the repository.
export const PHYSICAL_WORKSPACE_ID_TOKEN_SOURCE = 'ws-[a-f0-9]{32}';
export const PHYSICAL_WORKSPACE_ID = new RegExp(`^${PHYSICAL_WORKSPACE_ID_TOKEN_SOURCE}$`, 'u');

// A handle that is still working in the checkout — or closing in it — holds it: its process may
// still be running, and a peer must detach rather than destroy the resource underneath it.
export const WORKSPACE_HOLDER_STATUSES = Object.freeze([
  'pending', 'working', 'blocked', 'stopping', 'idle',
]);

// A closing checkout never takes a new holder: a fresh session must start only in a checkout whose
// holder is still working in it.
const ATTACHABLE_STATUSES = Object.freeze(['pending', 'working', 'blocked', 'idle']);

export function isPhysicalWorkspaceId(value) {
  return typeof value === 'string' && PHYSICAL_WORKSPACE_ID.test(value);
}

/** Whether this handle still holds the checkout it names.
 *
 * Holding is an UNRELEASED hold, not merely a live status: a terminal handle whose own cleanup has
 * not finalized (killed, awaiting its release, or retained by a preservation refusal) still needs
 * the checkout to finish that release, so a peer that closed it out from under the release would
 * strand exactly the handle the drain is waiting for. A handle that detached (`holders_remain`) or
 * finalized its cleanup has released its hold and no longer counts. */
export function holdsWorkspace(handle) {
  if (!handle) return false;
  if (WORKSPACE_HOLDER_STATUSES.includes(handle.status)) return true;
  return handle.workspaceCleanupDeferred == null
    && handle.physicalWorkspaceCleanupCompleted !== true
    && (handle.worktree !== null && handle.worktree !== undefined || handle.ownedWorktreeAuthority === true);
}

/** Issue #595: how one holder of a checkout stands, for a decision about handing the checkout on.
 *  - `live`: its status is one a working process has; it is still in the checkout.
 *  - `cleanup_in_flight`: it is terminal and its own cleanup, capture or runtime release is still
 *    running; the checkout is protected until that settles.
 *  - `processless`: it is terminal, nothing of its cleanup is running, and its process is proven
 *    closed (its process reference is closed, which startup also records for a process proven
 *    absent after a restart). Its hold can be released without removing anything.
 *  - `unresolved`: it is terminal but its process is not proven closed; a survivor may exist.
 * Returns null for a handle that does not hold the checkout. */
export function classifyWorkspaceHolder(handle) {
  if (!holdsWorkspace(handle)) return null;
  if (WORKSPACE_HOLDER_STATUSES.includes(handle.status)) return 'live';
  if (handle.cleanupPromise || handle.contributionCapturePending || handle.runtimeScope?.active === true
    || handle.worktreeCreationPending === true) return 'cleanup_in_flight';
  if (handle.processRef?.state === 'closed') return 'processless';
  return 'unresolved';
}

/**
 * Every other live holder of one physical checkout, as worker identities.
 * @param {Iterable<object>} handles live worker handles
 * @param {string} physicalOwnerId
 * @param {{excludeHandleId?: string|null}} [opts]
 * @returns {string[]}
 */
export function workspaceHolders(handles, physicalOwnerId, { excludeHandleId = null } = {}) {
  if (!isPhysicalWorkspaceId(physicalOwnerId)) return [];
  const holders = [];
  for (const handle of handles) {
    if (!holdsWorkspace(handle)) continue;
    if (handle.sessionContext?.ownerTaskId !== physicalOwnerId) continue;
    if (excludeHandleId !== null && handle.id === excludeHandleId) continue;
    holders.push(handle.id);
  }
  return holders;
}

/**
 * The live shared-checkout attachment a fresh participant may adopt, or null when that holder is
 * absent, unnamed, orphaned/closed, or not in a checkout at all.
 * @returns {{workspaceId: string, sessionContext: object, holderCount: number}|null}
 */
export function workspaceAttachmentOf(handles, workerId) {
  // Materialize once: callers pass a live Map iterator, and a partially consumed iterator would
  // silently undercount the holders of the checkout being adopted.
  const rows = [...handles];
  for (const handle of rows) {
    if (handle.id !== workerId) continue;
    if (!ATTACHABLE_STATUSES.includes(handle.status)) return null;
    const workspaceId = handle.sessionContext?.ownerTaskId;
    if (!isPhysicalWorkspaceId(workspaceId)) return null;
    return Object.freeze({
      workspaceId,
      sessionContext: handle.sessionContext,
      holderCount: workspaceHolders(rows, workspaceId).length,
    });
  }
  return null;
}

/** A FRESH native session working in a checkout that already existed — the deliberate shared-checkout
 * attachment. It is not a native-session resume (the only other way a task carries a session
 * context), and it is not a checkout this task created: the three are independent axes. */
export function attachedToExistingCheckout(task) {
  return task?.workspaceAttachment === true && task?.sessionRequest?.mode !== 'resume';
}

/** The honest description of a captured revision's checkout, for a contribution receipt: the
 * checkout's own identity and how many holders were in it — never an authorship claim. */
export function workspaceCustodyRecord(physicalOwnerId, holderCount) {
  if (!isPhysicalWorkspaceId(physicalOwnerId) || !Number.isSafeInteger(holderCount)) return null;
  return Object.freeze({ physicalOwnerId, shared: holderCount > 1, holderCount });
}
