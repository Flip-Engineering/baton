// runtime-api.mjs — issue #259, slice 13. The coordinator's surface bucket (seam-map §5, the
// runtime-api cell): 46 members, 45 of them surface:no_authority_touched — payload keys, digests,
// pure predicates, in-memory projections — plus _publicHandle, the caller-facing handle
// projection that anchors the module. Per the map's §4 finding 4 this is the coordinator's
// authority-free fallback bucket (the counterpart of the store's coordination-internals.mjs), not
// a transport: the façade the servers call is the Coordinator class itself, whose public verbs
// are now delegates into the seam modules.
//
// Receiver convention: the bare coordinator — no recorder parameter, because no member records
// (slice 3's runtime-briefing.mjs precedent). The transform is verbatim with the single reroute
// this. -> coordinator.; self-calls to moved members route through the class delegate, so
// instance patches keep firing (the RO3 discipline). WorkerNotFoundError and canonicalActionPath
// relocate here with their only readers; the coordinator re-exports WorkerNotFoundError, so its
// export surface is unchanged. Two imports reach runtime-* modules — typedTerminalCode/REARM_KINDS
// (runtime-recovery) and pathInScope (runtime-observation) — a design-doc erratum: AP1's "no other
// runtime-* module" was written before the closure was computed; the acyclic invariant that
// matters holds because nothing imports this module except the coordinator.

import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { normalizeConcurrencyCeiling } from './concurrency-policy.mjs';
import { canonicalDigest } from './coordination-internals.mjs';
import { boundedAttentionText } from './messages.mjs';
import { normalizeProviderRoute, readProviderFaultDetail } from './provider-faults.mjs';
import {
  attachedToExistingCheckout, isPhysicalWorkspaceId, workspaceAttachmentOf,
  workspaceCustodyRecord, workspaceHolders,
} from './shared-workspace-custody.mjs';
import { pathInScope } from './runtime-observation.mjs';
import { REARM_KINDS, typedTerminalCode } from './runtime-recovery.mjs';
import { sanitizeVerifierDiagnosticText } from './verifier-diagnostics.mjs';

export class WorkerNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkerNotFoundError';
  }
}

function canonicalActionPath(path) {
  let existing = resolve(path); const suffix = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(path);
    suffix.unshift(basename(existing));
    existing = parent;
  }
  try { return resolve(realpathSync(existing), ...suffix); }
  catch { return resolve(path); }
}

export function _deadlineDue(coordinator) {
    const now = coordinator._now();
    for (const record of coordinator._pending.values()) {
      if (record.state !== 'pending') continue;
      if (record.deadlineAt != null) {
        if (now >= record.deadlineAt) return true;
        continue;
      }
      if (record.kind === 'question' && record.acknowledged !== true && record.escalated !== true
        && now >= record.mintedAt + coordinator._watchdog.blockingInteractionTimeoutMs) return true;
    }
    for (const waiter of coordinator._stopWaiters.values()) {
      if (!waiter.finalized && waiter.deadlineAt != null && now >= waiter.deadlineAt) return true;
    }
    for (const handle of coordinator._workers.values()) {
      const stall = handle.stallSeamCycle;
      if (stall && stall.answered === false && now >= stall.mintedAt + stall.windowMs) return true;
    }
    return false;
  }

export function supervisedProcesses(coordinator) {
    return coordinator._supervised;
  }

export function _localResourceOwnership(coordinator, handle) {
    if (!handle) return Object.freeze({});
    const holds = {
      localAuthority: handle.localAuthority === true,
      process: (handle.currentIncarnation === true || handle.recoveredProcessAuthority === true)
        && !!handle.processRef && handle.processRef.state !== 'closed',
      runtimeScope: handle.runtimeScope?.active === true,
      worktree: handle.ownedWorktreeAuthority === true && !!handle.worktree,
      worktreeCreationPending: handle.worktreeCreationPending === true,
      nativeSpawnPending: handle.nativeSpawnPending === true,
      recoverySpawnPending: handle.recoverySpawnPending === true,
      cleanupPending: handle.cleanupPending === true,
      cleanupAfterVerification: handle.cleanupAfterVerification === true,
      cleanupPromise: !!handle.cleanupPromise,
      untrustedTransportReap: !!handle.untrustedTransportReap,
      recoveryPending: handle.recoveryPending === true,
      stopWaiter: coordinator._stopWaiters.has(handle.id),
      fatalStopWaiter: coordinator._fatalStopWaiters.has(handle.id),
    };
    return Object.freeze(Object.fromEntries(Object.entries(holds).filter(([, held]) => held)));
  }

export function providerSilenceAttention(coordinator, workerId) {
    const handle = coordinator._workers.get(workerId);
    if (!handle || handle.turnInFlight !== true) return null;
    const observation = coordinator._log.read(workerId).findLast?.(
      (event) => event.kind === 'lifecycle.transport_liveness',
    ) ?? null;
    const payload = observation?.payload ?? null;
    if (!payload || payload.providerTraffic === true) return null;
    return {
      kind: 'provider_silent',
      workerId,
      summary: 'no provider traffic observed this turn',
      note: typeof payload.note === 'string' ? payload.note : null,
      lastTrafficAt: typeof payload.lastTrafficAt === 'string' ? payload.lastTrafficAt : null,
    };
  }

export async function _claimLivenessPreflight(coordinator, handle, task, record) {
    // CP2 trigger (brief arm): mirror the gate's would-fire test verbatim (:12530).
    if (task.brief?.analysis || !task.brief?.requiredEffects?.includes('repository_edit')) {
      return { ok: true };
    }
    // CP2 fidelity law 1: capture with the gate-identical worktree + authority kwargs (:12490-12498).
    await Promise.resolve(handle.worktreeReady);
    const captured = await coordinator._captureTrustWorktree(handle, task);
    const sha = captured && captured.sha;
    const changedPaths = Array.isArray(captured?.changedPaths) ? captured.changedPaths : [];
    const inScopeChangedPaths = changedPaths.filter((path) => pathInScope(task.brief.pathScope, path));
    // CP2 fidelity laws 2-3: baseSha derives sessionContext ?? captured (:12531); the in-scope
    // filter is the gate's own (:12511). The gate would fire (diffless) when ANY arm of the
    // five-way test holds (:12532) — only a real in-scope diff lets the claim proceed.
    const baseSha = task.sessionContext?.baseSha ?? captured?.baseSha ?? null;
    if (sha && baseSha && sha !== baseSha && changedPaths.length > 0 && inScopeChangedPaths.length > 0) {
      return { ok: true };
    }
    // CP3 + CP4: scan the worker's OWN stream inside the pause epoch for the CLOSED counted set.
    // Every class is a hub-receipted ok:true, a governance/watchdog-observed worker content event,
    // or a resolution minted inside the window. Failed receipts, pending interactions, lifecycle
    // markers, board.claim_result and capability_op (CP7) never count; stale-epoch events never
    // count (CP4's anti-stale law).
    //
    // Epoch spaces: worker-stream events (tool_calls, messages, provider_calls, hub receipts) are
    // logged at the WIRE epoch, the pause record's `turnEpoch` is the terminal event's wire epoch,
    // but resolution mints (question.answered/approval.resolved/decision.settled) carry the
    // COORDINATOR fence epoch (`_safeTurnEpoch`). `wireEpochOffset` is the stable wire→fence
    // alignment set at the first qualifying wire event, so a resolution's fence epoch equals
    // `record.turnEpoch + wireEpochOffset` exactly when it was resolved inside the pause's own
    // asking turn (a stale answer mints `control.stale_rejected`, never a resolution — fencing
    // keeps the epoch comparison honest on both sides).
    const epochOffset = handle.wireEpochOffset ?? 0;
    const inPauseEpoch = (event) => (
      event.kind === 'question.answered' || event.kind === 'approval.resolved' || event.kind === 'decision.settled'
        ? event.turnEpoch === record.turnEpoch + epochOffset
        : event.turnEpoch === record.turnEpoch
    );
    const counts = {
      analysisMessages: 0, approvalsResolved: 0, contextReadOk: 0, decisionsSettled: 0,
      providerCalls: 0, questionsAnswered: 0, scratchpadWriteOk: 0, toolCalls: 0,
    };
    let counted = 0;
    for (const event of coordinator._log.read(record.worker)) {
      if (!inPauseEpoch(event) || event.seq > record.mintedEvent) continue;
      if (event.kind === 'scratchpad.write_result' && event.payload?.ok === true) counts.scratchpadWriteOk += 1;
      else if (event.kind === 'context.read_result' && event.payload?.ok === true) counts.contextReadOk += 1;
      else if (event.kind === 'content.tool_call' && event.actor === 'worker') counts.toolCalls += 1;
      else if (event.kind === 'content.message' && event.actor === 'worker') counts.analysisMessages += 1;
      else if (event.kind === 'resource.provider_call' && event.actor === 'worker') counts.providerCalls += 1;
      else if (event.kind === 'question.answered') counts.questionsAnswered += 1;
      else if (event.kind === 'approval.resolved') counts.approvalsResolved += 1;
      else if (event.kind === 'decision.settled') counts.decisionsSettled += 1;
      else continue;
      counted += 1;
    }
    if (counted === 0) return { ok: true };
    return {
      ok: false,
      liveness: counts,
      reason: 'worker shows read-only liveness inside this pause epoch but no in-scope diff; '
        + 'nudge the worker to continue and claim the NEXT checkpoint, or wait — '
        + 'this pause remains claimable',
    };
  }

export function _sharedCheckoutCustody(coordinator, handle, task) {
    if (attachedToExistingCheckout(task)) return true;
    const physicalOwnerId = handle?.sessionContext?.ownerTaskId ?? null;
    return isPhysicalWorkspaceId(physicalOwnerId)
      && coordinator.liveWorkspaceHolders(physicalOwnerId).length > 1;
  }

export function _captureTrustWorktree(coordinator, handle, task, { snapshot = false } = {}) {
    // A checkout this handle shares with another live holder is captured live through the isolated
    // index, whatever the caller asked for: the committed capture stages the REAL index and commits
    // on the shared branch its peers are using. Only a checkout this handle alone works in may use
    // the mutating primitive, and a resume (a native session continuing its own checkout) keeps it.
    const live = snapshot || coordinator._sharedCheckoutCustody(handle, task);
    const capture = live && typeof coordinator._worktrees.snapshot === 'function'
      ? coordinator._worktrees.snapshot : coordinator._worktrees.capture;
    const operation = capture.call(coordinator._worktrees, handle.worktree ?? task.worktree, {
      vendor: handle.vendor,
      model: handle.modelObserved ?? handle.modelResolved,
      ...((handle.effortObserved ?? handle.effortResolved) ? { effort: handle.effortObserved ?? handle.effortResolved } : {}),
      ownerTaskId: task.sessionContext?.ownerTaskId ?? task.id,
      ...(live ? { ownerReceiptDigest: task.sessionContext?.ownerReceiptDigest } : {}),
      ...(task.sessionContext?.baseSha ? { expectedBaseSha: task.sessionContext.baseSha } : {}),
      ...(task.sessionContext?.branch ? { expectedBranch: task.sessionContext.branch } : {}),
      ...(task.sessionContext?.sparseCheckoutIdentity ? { workerSparseCheckoutIdentity: task.sessionContext.sparseCheckoutIdentity } : {}),
    });
    if (!live) return operation;
    // A live snapshot describes the CHECKOUT it observed: which physical workspace it was, how
    // many holders were working in it, and the HEAD it showed before the capture. These are
    // observations of shared state — never an authorship claim over the recorded paths.
    return Promise.resolve(operation).then((captured) => {
      const physicalOwnerId = task.sessionContext?.ownerTaskId ?? null;
      const workspace = workspaceCustodyRecord(
        physicalOwnerId, coordinator.liveWorkspaceHolders(physicalOwnerId).length,
      );
      return {
        ...captured,
        ...(workspace ? { workspace } : {}),
        ...(captured?.observedHead ? { observedHead: captured.observedHead } : {}),
      };
    });
  }

export function _capacityOwnerIds(coordinator, handle, task = null) {
    const ids = new Set();
    for (const value of [
      handle?.sessionContext?.ownerTaskId, task?.sessionContext?.ownerTaskId, task?.id, handle?.taskId,
    ]) {
      if (typeof value === 'string' && value.length > 0) ids.add(value);
    }
    return Object.freeze([...ids]);
  }

export function _capacityOwnerHeld(coordinator, ownerTaskId) {
    for (const handle of coordinator._workers.values()) {
      if (!coordinator._capacityOwnerIds(handle, coordinator._tasks.get(handle.taskId)).includes(ownerTaskId)) continue;
      // A stop in flight still owns what it is about to release; a FINALIZED waiter no longer can
      // (its cleanup already settled), so it is not a holder.
      const waiter = coordinator._stopWaiters.get(handle.id) ?? coordinator._fatalStopWaiters.get(handle.id) ?? null;
      if (waiter && waiter.finalized !== true) return true;
      if (handle.processRef && handle.processRef.state !== 'closed') return true;
    }
    return false;
  }

export function releasedResources(coordinator) {
    return Object.freeze((coordinator._drainReleased ?? []).map((row) => Object.freeze({ ...row })));
  }

export function _drainWaitObserve(coordinator, targetWorkerIds) {
    coordinator._drainWaitSince ??= new Map();
    const at = Date.now();
    for (const workerId of targetWorkerIds) {
      const handle = coordinator._workers.get(workerId);
      if (!handle) continue;
      for (const hold of Object.keys(coordinator._localResourceOwnership(handle))) {
        const key = `${workerId}\0local_resources:${hold}`;
        if (!coordinator._drainWaitSince.has(key)) coordinator._drainWaitSince.set(key, at);
      }
      if (handle.processRef && handle.processRef.state !== 'closed') {
        const key = `${workerId}\0process:${handle.processRef.state}`;
        if (!coordinator._drainWaitSince.has(key)) coordinator._drainWaitSince.set(key, at);
      }
    }
  }

export function _drainWaitEntry(coordinator, resource, reaper, sinceMs) {
    const entry = {
      resource,
      reaper: reaper ?? null,
      since: typeof sinceMs === 'number' ? new Date(sinceMs).toISOString() : new Date().toISOString(),
    };
    // The host's wait narration joins the entries with `+`; the resource string renders there.
    Object.defineProperty(entry, 'toString', { value: () => entry.resource, enumerable: false });
    return Object.freeze(entry);
  }

export function _capabilityRegistry(coordinator) {
    if (coordinator._capabilities) return coordinator._capabilities;
    const error = new Error('capability registry is unavailable');
    error.code = 'capability_unavailable';
    throw error;
  }

export function _poisonDeferral(coordinator, refusal) {
    coordinator._poisonCoordination(refusal);
    return refusal;
  }

export function _firstSaturatedCandidate(coordinator, cards, inFlight) {
    for (const name of Object.keys(cards)) {
      const ceiling = normalizeConcurrencyCeiling(cards[name].concurrencyCeiling, `${name} concurrencyCeiling`);
      if (ceiling === null) continue;
      const active = inFlight[name] ?? 0;
      if (active >= ceiling) return { vendor: name, ceiling, inFlight: active };
    }
    return null;
  }

export function _inFlightCount(coordinator, vendor) {
    let n = 0;
    for (const h of coordinator._workers.values()) {
      if (h.vendor === vendor && (h.status === 'working' || h.status === 'stopping' || h.status === 'blocked')) n++;
    }
    return n;
  }

export function _harnessOf(coordinator, vendor) {
    const card = coordinator._adapters[vendor]?.card();
    return card ? `${card.harness}@${card.version}` : '';
  }

export function _turnCompletionOf(coordinator, handle) {
    if (coordinator._coordination?.hasSwarmParticipantRun?.(handle?.runId)) return 'pausable';
    return coordinator._adapters[handle?.vendor]?.card()?.turnCompletion ?? 'claim';
  }

export function _routeAttribution(coordinator, handle, task = coordinator._tasks.get(handle.taskId)) {
    return {
      taskId: task?.id ?? handle.taskId ?? null,
      runId: task?.runId ?? handle.runId ?? null,
      harnessRequested: task?.vendorRequested ?? null,
      harnessResolved: handle.vendor ? coordinator._harnessOf(handle.vendor) : null,
      modelRequested: handle.modelRequested ?? null,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
      effortRequested: handle.effortRequested ?? null,
      effortResolved: handle.effortResolved ?? null,
      effortObserved: handle.effortObserved ?? null,
      workerPolicyRequestDigest: handle.workerPolicyRequest?.schemaVersion
        ? handle.workerPolicyResolution?.requestDigest ?? null : null,
      workerPolicyResolutionDigest: handle.workerPolicyResolution?.resolutionDigest ?? null,
      workerPolicyObservationDigest: handle.workerPolicyObserved?.observationDigest ?? null,
      routeKey: handle.routeKey ?? task?.routeKey ?? null,
    };
  }

export function _gateVerdictItemForWorker(coordinator, workerId, verdictKinds) {
    // #286 G-39: the two verdict kinds arrive as the log's own per-kind buckets — the latest
    // candidate by seq, exactly as the single filtered scan produced it.
    const others = verdictKinds.errors.filter((event) => event.payload?.['phase'] === 'trust_gate');
    const reverified = verdictKinds.reverified.filter((event) => event.payload?.accept === false);
    const event = [...others, ...reverified].reduce(
      (latest, candidate) => (latest === null || candidate.seq > latest.seq ? candidate : latest), null,
    );
    if (!event) return null;
    const liveCode = event.kind === 'verify.reverified'
      ? (typeof event.payload?.verdict?.diagnosticCode === 'string'
        ? event.payload.verdict.diagnosticCode : 'trust_gate_failed')
      : (typeof event.payload?.code === 'string' ? event.payload.code : 'trust_gate_failed');
    let gate;
    if (liveCode === 'worker_path_scope_violation') gate = 'scope';
    else if (liveCode === 'forbidden_effect_observed') gate = 'forbidden_effect';
    else if (liveCode === 'verification_red_green_failed') gate = 'red_green';
    else if (liveCode === 'verification_coverage_failed') gate = 'coverage';
    else if (liveCode === 'plan_route_mismatch' || liveCode === 'recovery_route_mismatch') gate = 'route_mismatch';
    else gate = 'unknown';
    let detail = {};
    if (gate === 'scope') {
      const evidence = event.payload?.pathScopeEvidence && typeof event.payload.pathScopeEvidence === 'object'
        ? event.payload.pathScopeEvidence : {};
      detail = {
        digests: {
          changedPathsDigest: typeof evidence.changedPathsDigest === 'string' ? evidence.changedPathsDigest : null,
          inScopeChangedPathsDigest: typeof evidence.inScopeChangedPathsDigest === 'string'
            ? evidence.inScopeChangedPathsDigest : null,
          outOfScopeChangedPathsDigest: typeof evidence.outOfScopeChangedPathsDigest === 'string'
            ? evidence.outOfScopeChangedPathsDigest : null,
        },
        counts: {
          changedPathCount: Number.isSafeInteger(evidence.changedPathCount) ? evidence.changedPathCount : 0,
          inScopeChangedPathCount: Number.isSafeInteger(evidence.inScopeChangedPathCount)
            ? evidence.inScopeChangedPathCount : 0,
          outOfScopeChangedPathCount: Number.isSafeInteger(evidence.outOfScopeChangedPathCount)
            ? evidence.outOfScopeChangedPathCount : 0,
        },
      };
    } else if (gate === 'red_green' || gate === 'coverage') {
      const raw = typeof event.payload?.verdict?.failureCapsule?.text === 'string'
        ? event.payload.verdict.failureCapsule.text
        : typeof event.payload?.verdict?.output === 'string' ? event.payload.verdict.output : '';
      detail = { tail: sanitizeVerifierDiagnosticText(raw).text };
    }
    const message = typeof event.payload?.message === 'string' && event.payload.message.length > 0
      ? sanitizeVerifierDiagnosticText(event.payload.message).text : null;
    return {
      kind: 'gate_verdict',
      requestId: `gate:${event.seq}`,
      workerId: typeof event.worker === 'string' ? event.worker : workerId,
      gate,
      code: liveCode,
      message,
      detail,
    };
  }

export function _spillUnavailableItem(coordinator, workerId, { refusal, beyondCap, shed }) {
    const overflowIds = beyondCap.map((item) => item.requestId);
    const shedIds = shed.map((item) => item.requestId);
    return {
      kind: 'spill_unavailable',
      requestId: `spill_unavailable:${canonicalDigest([...overflowIds, ...shedIds])}`,
      workerId,
      code: refusal?.code ?? 'spill_unavailable',
      reason: refusal?.reason ?? 'mint_failed',
      overflowIds,
      shedIds,
      count: overflowIds.length + shedIds.length,
      // The ids come FIRST so the render-side bound can only truncate the explanation, never the
      // identity of what is missing; the structured sets above are always complete.
      text: boundedAttentionText(
        `not in this block (spill lane ${refusal?.reason ?? 'mint_failed'}): ${overflowIds.length > 0 ? overflowIds.join(' ') : 'none'}; `
        + `short form only: ${shedIds.length > 0 ? shedIds.join(' ') : 'none'}`,
      ),
    };
  }

export function _autoTaskId(coordinator) {
    let id;
    do { id = `task-${++coordinator._taskSeq}`; }
    while (coordinator._tasks.has(id) || coordinator._replayedIds.tasks.has(id) || Boolean(coordinator._coordination?.task?.(id)));
    return id;
  }

export function _allocWorkerId(coordinator) {
    let id;
    do { id = `w-${++coordinator._workerSeq}`; }
    while (coordinator._workers.has(id) || coordinator._replayedIds.workers.has(id));
    return id;
  }

export function _publicHandle(coordinator, handle, opts = {}) {
    let fence = null;
    let turnEpoch = null;
    if (handle.status !== 'pending') {
      try {
        const s = coordinator._fences.current(handle.id);
        fence = s.fence;
        turnEpoch = s.turnEpoch;
      } catch {
        // not yet registered — leave null
      }
    }
    return {
      id: handle.id,
      vendor: handle.vendor,
      modelRequested: handle.modelRequested ?? null,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
      harnessRequested: coordinator._tasks.get(handle.taskId)?.vendorRequested ?? null,
      harnessResolved: handle.vendor ? coordinator._harnessOf(handle.vendor) : null,
      effortRequested: handle.effortRequested ?? null,
      effortResolved: handle.effortResolved ?? null,
      effortObserved: handle.effortObserved ?? null,
      workerPolicy: coordinator._workerPolicyProjection(handle),
      routeKey: handle.routeKey ?? null,
      modelMismatch: handle.modelMismatch ?? null,
      effortMismatch: handle.effortMismatch ?? null,
      modelPolicy: handle.modelPolicy ?? null,
      sessionRequest: handle.sessionRequest ?? { mode: 'new' },
      sessionRef: handle.sessionRef ?? null,
      sessionContext: handle.sessionContext ?? null,
      lineage: handle.lineage ?? null,
      topology: coordinator._taskTopologyProjection(handle.taskId),
      runtimeScope: handle.runtimeScope ?? null,
      processRef: handle.processRef ? { ...handle.processRef } : null,
      review: coordinator._tasks.get(handle.taskId)?.review ?? null,
      taskId: handle.taskId,
      runId: coordinator._tasks.get(handle.taskId)?.runId ?? handle.runId ?? null,
      worktree: handle.worktree,
      ...(handle.worktreeObservation ? { worktreeObservation: { ...handle.worktreeObservation } } : {}),
      // A detach is a positive outcome: this says the checkout was deliberately left to its
      // remaining holders instead of being destroyed with this handle's stop.
      workspaceCleanupDeferred: handle.workspaceCleanupDeferred ?? null,
      fence,
      turnEpoch,
      status: handle.recoveryPending === true && opts.exposeRecovery !== true ? 'orphaned' : handle.status,
      // Issue #10 D6: the spawn-pending UNION (worktreeCreationPending || nativeSpawnPending ||
      // recoverySpawnPending) the local-authority check (_ownsLocalResources :2014-2015) trusts.
      // spawnWindow is the window the union is in, precedence worktree > spawn > recovery — the
      // windows are sequential in practice (a slide never passes through null). LIVE-STATE only:
      // a restart reconstructs all three false, and the member reads `orphaned` via the
      // recoveryPending mask above.
      spawnPending: handle.worktreeCreationPending === true || handle.nativeSpawnPending === true
        || handle.recoverySpawnPending === true,
      spawnWindow: handle.worktreeCreationPending === true ? 'worktree'
        : handle.nativeSpawnPending === true ? 'spawn'
          : handle.recoverySpawnPending === true ? 'recovery' : null,
      pendingApprovalId: handle.pendingApprovalId,
      pendingQuestionId: handle.pendingQuestionId,
      pendingDecisionId: handle.pendingDecisionId ?? null,
      budgetUsed: { ...handle.budgetUsed },
      providerGovernance: handle.providerGovernance ?? null,
      providerPolicyDigest: handle.providerPolicyDigest ?? null,
      providerTurn: handle.providerTurn ? {
        admissionSeq: handle.providerTurn.admissionSeq,
        phase: handle.providerTurn.phase,
        usage: { ...handle.providerTurn.usage },
        providerCalls: handle.providerTurn.providerCalls,
        toolCalls: handle.providerTurn.toolCalls,
        violation: handle.providerTurn.violation,
        sealed: handle.providerTurn.sealed,
      } : null,
      activeProviderTurns: handle.status === 'working' || handle.status === 'blocked' ? 1 : 0,
      controllableAttached: handle.status === 'interrupted'
        && handle.sessionPreservation?.state === 'preserved',
      terminalCause: handle.terminalCause ? { ...handle.terminalCause } : null,
      // #295 item 5: a retained checkout and the reason its checkpoint could not be written stay
      // on the worker's own row after death, so the work a dead member produced is never an
      // unnamed directory. #265 item 2: the observed native children the kill settled ride here
      // too, with the named gap that says why their terminal frame can no longer arrive.
      preservationFailure: handle.preservationFailure ? { ...handle.preservationFailure } : null,
      nativeChildSettlement: handle.nativeChildSettlement ? { ...handle.nativeChildSettlement } : null,
      providerQuotaBlock: handle.providerQuotaBlock ? { ...handle.providerQuotaBlock } : null,
      sessionPreservationCapable: Boolean(handle.sessionRef)
        && ['native', 'emulated'].includes(
          coordinator._adapters[handle.vendor]?.card()?.sessions?.multiTurn,
        ),
      sessionPreservation: handle.sessionPreservation
        ? { ...handle.sessionPreservation } : null,
      semanticControlBinding: coordinator._semanticControlBinding(handle),
      providerTerminalSeal: handle.providerTerminalSeal ?? null,
      providerPolicyHardExceeded: handle.providerPolicyHardExceeded === true,
      providerTelemetryFailed: handle.providerTelemetryFailed === true,
      createdAt: handle.createdAt,
    };
  }

export function _getWorker(coordinator, workerId) {
    const h = coordinator._workers.get(workerId);
    if (!h) throw new WorkerNotFoundError(`unknown worker "${workerId}"`);
    return h;
  }

export function messageRunId(coordinator, messageId) {
    const record = coordinator._messages.get(messageId);
    if (!record) return null;
    if (typeof record.target?.runId === 'string') return record.target.runId;
    if (typeof record.target?.workerId === 'string') {
      const handle = coordinator._workers.get(record.target.workerId);
      // A worker handle that is gone is NOT a live target: resolve-to-null (Decision 4 note(b))
      // — the message's run is not a valid authorization scope, so resolve-to-null ≡ unknown ≡
      // forbidden (FP-05 pins the row). "Gone" = never registered, reaped (dead/exited), or
      // stopping WITHOUT ever having engaged a turn (wireEpochOffset is set on the first
      // turn_started). A worker that engaged remains a live target while stopping, so its run
      // stays a valid authorization scope (FP-04's C3 identity row serves the honest receipt).
      if (!handle || ['dead', 'exited'].includes(handle.status)
        || (handle.status === 'stopping' && handle.wireEpochOffset === undefined)) return null;
      return coordinator._tasks.get(handle.taskId)?.runId ?? handle.runId ?? null;
    }
    return null;
  }

export function _poisonCoordination(coordinator, err) {
    if (!coordinator._fatalError) {
      const fatal = new Error(`authoritative coordination mutation failed: ${err?.message ?? err}`, { cause: err });
      fatal.name = 'CoordinationWriteIntegrityError';
      fatal.code = 'coordination_write_unavailable';
      coordinator._fatalError = fatal;
      for (const handle of coordinator._workers.values()) {
        if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) handle.spawnAbort.abort({ reason: 'coordination_write_unavailable' });
        if (handle.recoverySpawnAbort && !handle.recoverySpawnAbort.signal.aborted) handle.recoverySpawnAbort.abort({ reason: 'coordination_write_unavailable' });
      }
    }
    return coordinator._fatalError;
  }

export function _poisonIntegration(coordinator, err, strategy = 'structured') {
    if (!coordinator._fatalError) {
      const fatal = new Error(`${strategy} integration crossed its Git effect boundary before final validation completed: ${err?.message ?? err}`, { cause: err });
      fatal.name = 'IntegrationWriteIntegrityError';
      fatal.code = strategy === 'structured'
        ? 'structured_post_effect_inconsistent' : 'integration_post_effect_inconsistent';
      coordinator._fatalError = fatal;
      for (const handle of coordinator._workers.values()) {
        if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) handle.spawnAbort.abort({ reason: fatal.code });
        if (handle.recoverySpawnAbort && !handle.recoverySpawnAbort.signal.aborted) handle.recoverySpawnAbort.abort({ reason: fatal.code });
      }
    }
    return coordinator._fatalError;
  }

export function liveWorkspaceHolders(coordinator, physicalOwnerId, { excludeHandleId = null } = {}) {
    return workspaceHolders(coordinator._workers.values(), physicalOwnerId, { excludeHandleId });
  }

export function workspaceAttachment(coordinator, workerId) {
    if (typeof workerId !== 'string' || workerId.length === 0) return null;
    return workspaceAttachmentOf(coordinator._workers.values(), workerId);
  }

export function predecessorWorkspaceContext(coordinator, workspaceId) {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) return null;
    const allHandles = [...coordinator._workers.values()];
    let context = null;
    for (const handle of allHandles) {
      if (handle.sessionContext?.ownerTaskId !== workspaceId) continue;
      context = handle.sessionContext;
      break;
    }
    if (!context) return null;
    const holders = workspaceHolders(allHandles, workspaceId);
    return { sessionContext: context, holders };
  }

export function unregisterParticipantRuntime(coordinator, runId) {
    coordinator._participantRuntimes?.delete(runId);
  }

export function _removeRuntimeScope(coordinator, handle) {
    if (!handle || !coordinator._runtimeScopes || typeof coordinator._runtimeScopes.remove !== 'function') return true;
    // Confirmed close may converge an installed untrusted-transport cleanup with an ordinary stop
    // waiter. They share worktree cleanup through handle.cleanupPromise; make the synchronous
    // runtime half equally exact-once once its lease has already been released.
    if (handle.runtimeLease == null && handle.runtimeScope?.active === false) return true;
    try { coordinator._runtimeScopes.remove(handle.id); } catch {
      handle.cleanupPending = true;
      handle.cleanupError = 'runtime_cleanup_failed';
      return false;
    }
    handle.runtimeLease = null;
    if (handle.runtimeScope) handle.runtimeScope = { ...handle.runtimeScope, active: false };
    if (!handle.cleanupPromise) handle.cleanupPending = false;
    handle.cleanupError = null;
    return true;
  }

export function watchdogConfig(coordinator) {
    return Object.freeze({
      stallMs: coordinator._watchdog.stallMs,
      basis: 'no_progress_evidence',
      rearmKinds: [...REARM_KINDS],
    });
  }

export function _relativeActionPath(coordinator, handle, path) {
    if (typeof path !== 'string' || path.length === 0) return null;
    if (!isAbsolute(path)) return path.replace(/^\.\//, '');
    if (!handle.worktree) return path;
    const rel = relative(canonicalActionPath(handle.worktree), canonicalActionPath(path));
    return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
  }

export function _freshTurnProgress(coordinator, turnEpoch) {
    return {
      turnEpoch, toolCalls: 0, fileEdits: 0,
      toolTitles: [], editedPaths: [], commits: [], rowsSinceCheckpoint: 0,
    };
  }

export function abandonedWorkers(coordinator) {
    return Object.freeze([...coordinator._workers.values()]
      .filter((handle) => handle.stopAbandoned)
      .map((handle) => Object.freeze({
        workerId: handle.id, attempt: handle.stopAbandoned.attempts,
        alive: handle.stopAbandoned.alive, holds: Object.freeze([...handle.stopAbandoned.holds]),
      })));
  }

export function abandonedCapacityReservations(coordinator) {
    const rows = [];
    for (const handle of coordinator._workers.values()) {
      if (!handle.stopAbandoned) continue;
      for (const ownerTaskId of coordinator._capacityOwnerIds(handle, coordinator._tasks.get(handle.taskId) ?? null)) {
        rows.push(Object.freeze({
          workerId: handle.id, taskId: handle.taskId, ownerTaskId, resource: `worker:${ownerTaskId}`,
        }));
      }
    }
    return Object.freeze(rows);
  }

export async function _claimInteraction(coordinator, requestId, opts = {}) {
    if (typeof requestId !== 'string' || requestId.length === 0) return { ok: false, result: 'not_found' };
    const record = coordinator._pending.get(requestId);
    if (!record) return { ok: false, result: 'not_found' };
    if (record.state !== 'pending') return { ok: false, result: 'already_resolved' };
    const actor = opts.actor ?? 'orchestrator';
    record.acknowledged = true;
    record.acknowledgedAt = coordinator._now();
    record.acknowledgedBy = actor;
    return { ok: true, result: 'acknowledged', requestId, kind: record.kind };
  }

export function _stripCapabilityPaths(coordinator, result) {
    if (!result || typeof result !== 'object' || !Array.isArray(result.refs) || result.refs.length === 0) return result;
    let changed = false;
    const refs = result.refs.map((ref) => {
      if (!ref || typeof ref !== 'object' || !Object.hasOwn(ref, 'path')) return ref;
      changed = true;
      const { path, ...projected } = ref;
      return projected;
    });
    return changed ? { ...result, refs } : result;
  }

export function interactionGeneration(coordinator, taskId) { return coordinator._interactionGeneration.get(taskId) ?? 0; }

export function decisionSettleCount(coordinator, runId) { return coordinator._decisionSettleCount.get(runId) ?? 0; }

export function _horizonCacheGet(coordinator, kind, scopeIdentity, fenceTuple, compute) {
    const cacheKey = `${kind}:${scopeIdentity}`;
    const fenceKey = JSON.stringify(fenceTuple);
    const cached = coordinator._horizonCache.get(cacheKey);
    if (cached && cached.fenceKey === fenceKey) return cached.value;
    const value = compute();
    coordinator._horizonCache.set(cacheKey, { fenceKey, fenceTuple, value, computedAt: coordinator._now() });
    return value;
  }

export function _cursorStateFile(coordinator, workerId) {
    return join(coordinator._log.dir, '.cursors', `${workerId}.floor`);
  }

export function _providerFaultOf(coordinator, workerResult) {
    const code = typedTerminalCode(workerResult?.failure?.code ?? workerResult?.code, null);
    if (code === null) return null;
    const detail = readProviderFaultDetail(workerResult?.failure?.detail ?? workerResult?.detail);
    return Object.freeze({ code, detail });
  }

export function _providerRouteOf(coordinator, handle) {
    return normalizeProviderRoute({
      harness: handle?.vendor ? coordinator._harnessOf(handle.vendor) : null,
      model: handle?.modelResolved ?? handle?.modelRequested ?? null,
      effort: handle?.effortResolved ?? handle?.effortRequested ?? null,
    });
  }
