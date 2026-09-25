// runtime-effects.mjs — issue #259, slice 9 (first tranche) and slice 12 (second tranche). The
// coordinator effect members the seam map names first (§3 rows 6/9/10: _dispatch, _spawnPlanWave,
// _resolveRecord) and the entangled four of tranche 2 (stopRunTargets, _integrate, _deliver,
// _finalizeStop). Tranche 2 splits admission from effect per the slice-12 design: each split
// member's admission prefix lives in runtime-admission.mjs (imported one-way — admission never
// imports effects), and the effect remainder here calls it first, so the body reads admitted →
// act → record. stopRunTargets' two closures lift to module functions carrying a state record.
// Bodies are the members' own with two explicit boundary parameters — the coordinator receiver
// and the injected recorder port (slice 6) — and every recording act routes through the port: the
// operational log (recorder.log.*), evidence mapping (recorder.mapEvent), driver records
// (recorder.recordDriver) and every coordination-store call (recorder.coordination.*). One-way:
// this module never imports the coordinator; the coordinator imports back the relocated
// declarations below.


import { createHash } from 'node:crypto';
import { canonicalDigest } from './coordination-internals.mjs';
import { planBriefMatches } from './goal-plan.mjs';
import { createBrief } from './messages.mjs';
import {
  processAuthorityState, processGroupAlive, reapRecoveredProcessGroup,
  recoveryProcessAbsentPayload, recoveryProcessReapedPayload,
} from './process-lifecycle.mjs';
import * as runtimeAdmission from './runtime-admission.mjs';
import {
  IntegrationError, KILL_RULES, ORIENTATION_DELIVERY, TERMINAL_TASK_STATUSES,
  closedVerificationVerdict, noop, typedTerminalCode,
} from './runtime-recovery.mjs';
import { routeTupleKey } from './route-tuple.mjs';
import { normalizeWorkerPolicyRequest } from './worker-policy.mjs';
import { normalizePhysicalOwnerId, normalizeSparseCheckoutIdentity, normalizeSparsePaths } from './worktree.mjs';


export const WORKTREE_FAILURE = Symbol('worktree-failure');

export function normalizeRunId(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) {
    const error = new TypeError('runId must be a bounded identifier');
    error.code = 'invalid_run_id';
    throw error;
  }
  return value;
}

export class ModelSelectionError extends Error {
  constructor(message, code = 'model_unavailable') {
    super(message);
    this.name = 'ModelSelectionError';
    this.code = code;
  }
}

export class PublicationError extends Error {
  constructor(message, code = 'publication_refused') {
    super(message);
    this.name = 'PublicationError';
    this.code = code;
  }
}

export function _dispatch(coordinator, recorder, task, vendor, model, effort, workerPolicyResolution = null) {
    const handle = coordinator._workers.get(task.assignee);
    const workerId = handle.id;
    if (recorder.coordination) {
      const claim = recorder.coordination.claimTask(task.id, workerId, task.coordinationVersion, {
        actor: 'orchestrator', key: `task.claimed:${task.id}:${task.coordinationVersion}`,
      }, {
        harnessRequested: task.vendorRequested, harnessResolved: coordinator._harnessOf(vendor),
        modelRequested: task.modelRequested ?? null, modelResolved: model ?? null, modelObserved: null,
        effortRequested: task.effortRequested ?? null, effortResolved: effort ?? null, effortObserved: null,
        routeKey: routeTupleKey(coordinator._adapters[vendor]?.card(), model, effort, task.taskType, workerPolicyResolution),
      });
      task.coordinationVersion = claim.task.version;
    }
    coordinator._fences.register(workerId);
    handle.vendor = vendor;
    handle.modelResolved = model ?? null;
    task.modelResolved = model ?? null;
    handle.effortResolved = effort ?? null;
    task.effortResolved = effort ?? null;
    handle.workerPolicyResolution = workerPolicyResolution;
    task.workerPolicyResolution = workerPolicyResolution;
    task.routeKey = routeTupleKey(
      coordinator._adapters[vendor]?.card(), task.modelResolved, task.effortResolved, task.taskType,
      workerPolicyResolution,
    );
    handle.routeKey = task.routeKey;
    const harness = coordinator._harnessOf(vendor);
    handle.currentIncarnation = true;
    handle.localAuthority = true;
    let providerBrief;
    try { providerBrief = coordinator._providerBrief(task.brief, workerId); }
    catch (error) {
      if (task.sessionRequest?.mode === 'new' && task.workspaceAttachment !== true
        && typeof coordinator._worktrees?.releaseCapacity === 'function') coordinator._releaseCapacityDetached(task.id);
      const crashEvent = recorder.log.append({
        worker: workerId, harness, turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'lifecycle.crashed', actor: 'policy', ...coordinator._routeAttribution(handle, task),
        payload: {
          phase: 'context_materialization',
          error: 'Context partition materialization refused',
          code: typedTerminalCode(error?.code, 'context_map_attachment_invalid'),
        },
      });
      const evidence = recorder.mapEvent(crashEvent);
      coordinator._coordTransition(task, 'failed', `task.failed:${task.id}:context_materialization`, evidence);
      task.status = 'failed';
      handle.status = 'exited';
      handle.localAuthority = false;
      return;
    }
    const providerAdmission = coordinator._admitProviderTurn(handle, task, 'spawn');
    if (!providerAdmission.ok) {
      coordinator._failInitialProviderAdmission(handle, task, providerAdmission);
      return;
    }
    let runtime;
    try {
      runtime = coordinator._ensureRuntimeScope(handle);
    } catch (err) {
      try { coordinator._runtimeScopes?.remove?.(workerId); } catch { /* best effort */ }
      if (task.sessionRequest?.mode === 'new' && task.workspaceAttachment !== true
        && typeof coordinator._worktrees?.releaseCapacity === 'function') coordinator._releaseCapacityDetached(task.id);
      coordinator._releaseProviderTurnAdmission(handle, 'runtime_scope_unavailable');
      const crashEvent = recorder.log.append({
        worker: workerId, harness, turnEpoch: coordinator._safeTurnEpoch(handle), kind: 'lifecycle.crashed', actor: 'policy',
        ...coordinator._routeAttribution(handle, task),
        payload: { phase: 'runtime_scope', error: String(err?.message ?? err) },
      });
      const evidence = recorder.mapEvent(crashEvent);
      coordinator._coordTransition(task, 'failed', `task.failed:${task.id}:runtime_scope`, evidence);
      task.status = 'failed';
      handle.status = 'exited';
      return;
    }
    if (runtime) task.runtimeScope = handle.runtimeScope;

    // Create the worktree; the returned readiness promise is handed to the adapter so the
    // worker waits for its checkout to exist before touching disk. Status still flips to
    // 'working' and the adapter is invoked synchronously below (so a bare tick() dispatches
    // in one turn), while the worker's actual work is gated on the worktree being ready.
    handle.worktreeCreationPending = true;
    handle.processGeneration = (handle.processGeneration ?? 0) + 1;
    // Epic #78 Decision 2 (A2-3): the attachment is a durable generation record — replay can
    // derive which grants the replacement generation invalidates. Best-effort: a store without
    // the recordWorkerGeneration surface (pre-#78 fixtures) simply skips the event.
    if (typeof recorder.coordination?.recordWorkerGeneration === 'function') {
      coordinator.recordWorkerGeneration(handle);
    }
    // A resume (native session continuation) and a deliberate attachment (a FRESH native session
    // adopted into an existing shared checkout) are independent axes: both borrow a durable
    // checkout instead of creating one, and neither invents a native session identity for the
    // other. A checkout created for THIS task is the only independent local authority.
    const borrowedCheckout = Boolean(task.sessionContext);
    let worktreeSource;
    if (borrowedCheckout) {
      worktreeSource = Promise.resolve({
          path: task.sessionContext.worktree,
          branch: task.sessionContext.branch,
          baseSha: task.sessionContext.baseSha,
          ownerTaskId: task.sessionContext.ownerTaskId,
          ...(task.sessionContext.logicalTaskId ? { logicalTaskId: task.sessionContext.logicalTaskId } : {}),
          ...(task.sessionContext.ownerReceiptDigest ? { ownerReceiptDigest: task.sessionContext.ownerReceiptDigest } : {}),
          ...(task.sessionContext.sparsePaths ? { sparsePaths: task.sessionContext.sparsePaths } : {}),
          ...(task.sessionContext.sparseCheckoutIdentity ? { sparseCheckoutIdentity: task.sessionContext.sparseCheckoutIdentity } : {}),
          ...(task.sessionContext.toolchainProjection ? { toolchainProjection: task.sessionContext.toolchainProjection } : {}),
          ...(task.sessionContext.capacityReservation ? { capacityReservation: task.sessionContext.capacityReservation } : {}),
        });
    } else {
      try { worktreeSource = Promise.resolve(coordinator._worktrees.create(task.id, task.worktreeBaseSha ?? null, {
        runId: task.runId ?? null,
        attemptId: workerId,
        processGeneration: handle.processGeneration,
      })); }
      catch (error) { worktreeSource = Promise.reject(error); }
    }
    let worktreeReady = worktreeSource
      .then(async (res) => {
        // Issue #10 D6: the worktree window closes the moment the checkout is confirmed — never
        // lagging behind in the readiness `.finally` (a microtask that can land after the next
        // public read, misreporting a settled checkout as still in the worktree window).
        handle.worktreeCreationPending = false;
        if (res && res.path) {
          task.worktree = res.path;
          handle.worktree = res.path;
          // Issue #447: the seat's own checkout is recorded on its runtime lease the moment it
          // is confirmed — the projected git wrapper spools commit observations for no other
          // repository, so a test fixture's temporary repository under this one (or any other
          // repository the seat's PATH reaches) is never attributed to the seat, and never
          // refused. The seat's process is gated on this same readiness, so it cannot commit
          // before its lease knows the checkout.
          coordinator._runtimeScopes?.projectCheckout?.(handle.id, res.path);
          // A resumed or attached session merely borrows its durable session checkout. Only a
          // checkout created for this task is independent local authority that must block drain.
          handle.ownedWorktreeAuthority = !borrowedCheckout;
          handle.physicalWorkspaceCleanupCompleted = false;
          const sessionContext = Object.freeze({
            worktree: res.path,
            ...(coordinator._repoRoot ? { repoRoot: coordinator._repoRoot } : {}),
            ...(res.baseSha ? { baseSha: res.baseSha } : {}),
            ...(res.branch ? { branch: res.branch } : {}),
            ...(res.toolchainProjection ? { toolchainProjection: res.toolchainProjection } : {}),
            ...(res.sparsePaths !== undefined ? { sparsePaths: normalizeSparsePaths(res.sparsePaths) } : {}),
            ...(res.sparseCheckoutIdentity !== undefined ? { sparseCheckoutIdentity: normalizeSparseCheckoutIdentity(res.sparseCheckoutIdentity) } : {}),
            ...(res.capacityReservation ? { capacityReservation: Object.freeze({ ...res.capacityReservation }) } : {}),
            ownerTaskId: res.ownerTaskId ?? task.sessionContext?.ownerTaskId ?? task.id,
            ...(res.logicalTaskId || task.sessionContext?.logicalTaskId
              ? { logicalTaskId: res.logicalTaskId ?? task.sessionContext.logicalTaskId } : {}),
            ...(res.ownerReceiptDigest || task.sessionContext?.ownerReceiptDigest
              ? { ownerReceiptDigest: res.ownerReceiptDigest ?? task.sessionContext.ownerReceiptDigest } : {}),
          });
          task.sessionContext = sessionContext;
          handle.sessionContext = sessionContext;
          if (res.ownerReceipt) {
            recorder.log.append({
              worker: workerId, harness, turnEpoch: coordinator._safeTurnEpoch(handle),
              kind: 'worktree.owner_bound', actor: 'policy',
              payload: {
                schemaVersion: 1,
                physicalOwnerId: res.ownerReceipt.physicalOwnerId,
                deploymentId: res.ownerReceipt.deploymentId,
                controllerId: res.ownerReceipt.controllerId,
                runId: res.ownerReceipt.runId,
                attemptId: res.ownerReceipt.attemptId,
                logicalTaskId: res.ownerReceipt.logicalTaskId,
                processGeneration: res.ownerReceipt.processGeneration,
                branch: res.ownerReceipt.branch,
                worktree: res.ownerReceipt.worktree,
                baseSha: res.ownerReceipt.baseSha,
                receiptDigest: res.ownerReceipt.receiptDigest,
              },
            });
          }
          recorder.log.append({
            worker: workerId, harness, turnEpoch: coordinator._safeTurnEpoch(handle), kind: 'worktree.ready', actor: 'orchestrator',
            payload: sessionContext,
          });
        }
        // SC12 adversarial erratum: a stop can reap before async creation finishes. Once the
        // late worktree exists, reap again while the adapter's cancelled reservation prevents
        // any child from entering it.
        if (handle.status === 'stopping' || handle.status === 'dead' || TERMINAL_TASK_STATUSES.has(task.status)) {
          if (coordinator._worktrees && typeof coordinator._worktrees.remove === 'function') {
            await coordinator._removeOwnedTaskWorktree(handle, task);
          }
        }
        return res;
      });
    // WF1-WF5: readiness is a coordinator-owned prerequisite. Normalize both synchronous and
    // asynchronous creation failure before the adapter can observe the rejection, abort any
    // pending native spawn, release the checkout this attempt owned, write one fixed
    // non-leaking terminal fact, and still rethrow a typed rejection to the adapter so it cannot
    // fall through to the orchestrator cwd. A concurrent stop retains terminal authority; the
    // second reap handles partial creation that failed late.
    worktreeReady = worktreeReady.catch(async (cause) => {
      void cause;
      const failure = new Error('worktree unavailable');
      failure.name = 'WorktreeReadinessError';
      failure.code = 'worktree_unavailable';
      if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) {
        handle.spawnAbort.abort({ reason: failure.code });
      }
      // WF1-WF4: the checkout this attempt owned is released BEFORE the refusal is terminalized,
      // so a task whose result reads `failed` is never observed still holding it — and the
      // refusal path that terminalizes through an installed process reference releases it too.
      // The release is the same preserve-then-reap authority the stop/reap path uses and is
      // idempotent with it through `handle.cleanupPromise`; a retention refusal stays observable
      // on the handle and never replaces the typed readiness failure. A borrowed checkout
      // (resume or deliberate attachment) is not this attempt's to release.
      if (task.sessionRequest?.mode === 'new' && task.workspaceAttachment !== true) {
        try { await coordinator._removeOwnedTaskWorktree(handle, task); } catch { /* best effort */ }
      }
      // The creation window closes only once the checkout is released: the reap's own idle guard
      // reads a handle with no checkout, no owned authority, no live runtime scope and a closed
      // window as already released, so the window must stay open across the release and close
      // before the refusal below can reach the reap a second time.
      handle.worktreeCreationPending = false;
      if (!coordinator._fatalError) coordinator._onSpawnRefused(handle, task, harness, {
        ok: false, reason: failure.message, code: failure.code, [WORKTREE_FAILURE]: true,
      });
      throw failure;
    }).finally(() => { handle.worktreeCreationPending = false; });
    handle.worktreeReady = worktreeReady;
    // Some test/dummy adapters do not consume readiness. The prerequisite still owns failure,
    // while this observer prevents an otherwise-unhandled rejected promise.
    coordinator._bestEffort(worktreeReady, 'worktree_ready_observer');

    const spawnTurnEpoch = coordinator._fences.current(workerId).turnEpoch;
    recorder.log.append({
      worker: workerId, harness, turnEpoch: spawnTurnEpoch, kind: 'lifecycle.spawned', actor: 'orchestrator',
      harnessRequested: task.vendorRequested, harnessResolved: harness,
      modelRequested: task.modelRequested ?? null, modelResolved: task.modelResolved ?? null, modelObserved: null,
      effortRequested: task.effortRequested ?? null, effortResolved: task.effortResolved ?? null, effortObserved: null,
      routeKey: task.routeKey ?? null,
      payload: {
        taskId: task.id, brief: task.brief, vendorRequested: task.vendorRequested, vendorResolved: vendor,
        modelRequested: task.modelRequested, modelResolved: task.modelResolved, modelPolicy: task.modelPolicy,
        effortRequested: task.effortRequested, effortResolved: task.effortResolved, routeKey: task.routeKey,
        workerPolicyRequest: task.workerPolicyRequest,
        workerPolicyResolution: task.workerPolicyResolution,
        ...(handle.providerGovernance ? { providerGovernance: handle.providerGovernance } : {}),
        sessionRequest: task.sessionRequest,
        lineage: task.lineage,
        topology: coordinator._taskTopologyProjection(task.id),
        review: task.review,
      },
    });

    const stamp = coordinator._fences.bumpTurn(workerId);

    const wallMin = task.brief && task.brief.budget && task.brief.budget.wallMin;
    // SC12: adapters receive an explicit cancellation signal in addition to their verb call.
    // Session adapters own the stronger pending-spawn reservation, while this signal makes the
    // coordinator's authority visible across the async worktree boundary.
    const spawnAbort = new AbortController();
    handle.spawnAbort = spawnAbort;
    // SC1d: the spawn Ack is consumed, not discarded — a refused spawn must fail the task
    // instead of leaving a zombie in 'working' (the G1 audit's silent failure mode).
    handle.nativeSpawnPending = true;
    let nativeSpawnSource;
    try {
      nativeSpawnSource = coordinator._adapters[vendor].spawn(workerId, providerBrief, {
        worktreeReady,
        // #163 law (operator ruling): NO wall-time clock feeds a member's fate — fate rests
        // on evidence only (process exit; quiescence-derived wave completion). budget.wallMin
        // stays admitted but is inert for fate; its schema removal is tracked separately.
        signal: spawnAbort.signal,
        model: task.modelResolved ?? undefined,
        reasoningEffort: task.effortResolved ?? undefined,
        workerPolicy: task.workerPolicyResolution ?? undefined,
        serviceTier: task.modelPolicy?.serviceTier,
        session: task.sessionRequest?.mode === 'new' ? undefined : task.sessionRequest,
        env: runtime?.env,
        replaceEnv: runtime?.replaceEnv === true,
        redactProviderFrame: runtime?.redactProviderFrame,
        processGeneration: handle.processGeneration,
        processReapTimeoutMs: Math.max(1, Math.floor(coordinator._stopDeadlineMs * 0.8)),
      });
    } catch (error) { nativeSpawnSource = Promise.reject(error); }
    const nativeSpawnPromise = Promise.resolve(nativeSpawnSource).then((ack) => {
      if (handle.spawnAbort === spawnAbort) handle.spawnAbort = null;
      // Issue #10 D6: the spawn window closes the moment the ack lands — never lagging behind
      // in the `.finally` microtask, which can report a settled spawn as still pending.
      handle.nativeSpawnPending = false;
      if (ack && ack.ok === false) coordinator._onSpawnRefused(handle, task, harness, ack);
    }).catch((err) => {
      if (handle.spawnAbort === spawnAbort) handle.spawnAbort = null;
      handle.nativeSpawnPending = false;
      // SC15: rejection and resolved refusal are the same durable failure channel.
      coordinator._onSpawnRefused(handle, task, harness, { ok: false, reason: String(err?.message ?? err) });
    }).finally(() => {
      if (handle.nativeSpawnPromise === nativeSpawnPromise) handle.nativeSpawnPromise = null;
      handle.nativeSpawnPending = false;
    });
    handle.nativeSpawnPromise = nativeSpawnPromise;

    // A synchronous adapter observation can fail policy and begin a two-phase stop before
    // spawn() returns its Promise. Never overwrite that authoritative terminal/stop transition
    // with the optimistic dispatch state (the same guard protects model/effort mismatches).
    if (!TERMINAL_TASK_STATUSES.has(task.status)
      && !['stopping', 'dead', 'exited'].includes(handle.status)) {
      recorder.log.append({
        worker: workerId, harness, turnEpoch: stamp.turnEpoch, kind: 'lifecycle.turn_started', actor: 'orchestrator', payload: {},
        ...coordinator._routeAttribution(handle, task),
      });
      task.status = 'working';
      handle.status = 'working';
      handle.turnTerminalObserved = false;
      coordinator._clearBudgetStop(handle);
      coordinator._resetWatchdogTurn(handle);
    }
  }

export async function _spawnPlanWave(coordinator, recorder, rawMembers, opts = {}) {
    if (!Array.isArray(rawMembers) || rawMembers.length < 2
      || !coordinator._goalPlanAuthority || typeof recorder.coordination?.createPlanGatedWave !== 'function') {
      throw Object.assign(new Error('plan wave authority is unavailable or invalid'), {
        code: 'plan_wave_invalid',
      });
    }
    if (coordinator._drainState !== 'open') {
      throw Object.assign(new Error('coordinator admission is draining'), { code: 'coordinator_draining' });
    }
    const allowed = ['brief', 'effort', 'goalPlan', 'model', 'runId', 'taskId', 'vendor'];
    const members = rawMembers.map((member) => {
      if (!member || typeof member !== 'object' || Array.isArray(member)
        || Object.keys(member).some((field) => !allowed.includes(field))) {
        throw Object.assign(new Error('plan wave member is invalid'), { code: 'plan_wave_invalid' });
      }
      const runId = normalizeRunId(member.runId);
      normalizePhysicalOwnerId(member.taskId, 'taskId');
      if (!member.goalPlan || member.vendor === 'auto' || member.brief?.goalPlan !== undefined
        || coordinator._tasks.has(member.taskId)) {
        throw Object.assign(new Error('plan wave member authority is invalid'), { code: 'plan_wave_invalid' });
      }
      const workerPolicyRequest = member.brief?.workerPolicy === undefined
        ? null : normalizeWorkerPolicyRequest(member.brief.workerPolicy);
      const explicit = coordinator._resolveExplicitRoute(member.vendor, {
        sessionRequest: { mode: 'new' }, model: member.model,
        effort: member.effort, workerPolicyRequest,
      });
      if (!explicit.ok) {
        throw new ModelSelectionError(
          `harness "${member.vendor}" cannot select the exact wave route`, explicit.reason,
        );
      }
      return {
        ...member, runId, workerPolicyRequest,
        workerId: `w-wave-${createHash('sha256').update(member.taskId).digest('hex').slice(0, 24)}`,
      };
    }).sort((left, right) => (left.goalPlan.nodeKey < right.goalPlan.nodeKey ? -1 : 1));
    if (new Set(members.map((member) => member.taskId)).size !== members.length
      || new Set(members.map((member) => member.goalPlan.nodeKey)).size !== members.length
      || new Set(members.map((member) => member.workerId)).size !== members.length
      || new Set(members.map((member) => member.runId)).size !== 1) {
      throw Object.assign(new Error('plan wave contains duplicate or cross-Run authority'), {
        code: 'plan_wave_invalid',
      });
    }

    const auth = await coordinator._goalPlanAuth({
      actor: opts.actor, principalId: opts.principalId, sessionId: opts.sessionId,
      powers: opts.powers, repoId: coordinator._repoId, runId: members[0].runId,
      idempotencyKey: opts.idempotencyKey,
    }, 'plan:dispatch', 'plan_wave_dispatch', {
      members: members.map(({ goalPlan, taskId, vendor, model, effort }) => ({
        goalPlan, taskId, vendor, model, effort,
      })),
    });
    const prepared = members.map((member) => {
      const route = { vendor: member.vendor, model: member.model, effort: member.effort };
      const state = recorder.coordination.previewPlanDispatch(member.goalPlan, route);
      if (state.node.deps.length !== 0 || !planBriefMatches(member.brief, state.brief)) {
        throw Object.assign(new Error('plan wave member differs from its approved root node'), {
          code: 'plan_wave_invalid',
        });
      }
      const brief = createBrief(state.brief);
      // Preflight every immutable partition before the all-or-clean Wave ledger edge. The
      // materialized value is discarded here and rematerialized only at the provider edge.
      coordinator._providerBrief(brief);
      return {
        ...member, route, brief,
        fields: {
          id: member.taskId, brief, deps: [], refines: null, runId: member.runId,
          taskType: 'general', reservedWorkerId: member.workerId,
          vendorRequested: member.vendor, modelRequested: member.model, modelPolicy: null,
          effortRequested: member.effort, effortResolved: null, effortObserved: null,
          routeKey: null, sessionRequest: { mode: 'new' },
        },
      };
    });

    const reservedCapacityTaskIds = [];
    const releaseWaveCapacity = async () => {
      const taskIds = [...reservedCapacityTaskIds];
      if (taskIds.length === 0) return;
      if (typeof coordinator._worktrees?.releaseCapacityMany === 'function') {
        const outcomes = await Promise.resolve(coordinator._worktrees.releaseCapacityMany(taskIds));
        if (!Array.isArray(outcomes) || outcomes.length !== taskIds.length
          || outcomes.some((released) => released !== true)) {
          throw Object.assign(new Error('plan wave capacity cleanup is incomplete'), {
            code: 'plan_wave_cleanup_incomplete', taskIds,
          });
        }
        return;
      }
      const outcomes = await Promise.allSettled(taskIds.map((taskId) => (
        Promise.resolve(coordinator._worktrees?.releaseCapacity?.(taskId))
      )));
      if (outcomes.some((outcome) => outcome.status === 'rejected' || outcome.value !== true)) {
        throw Object.assign(new Error('plan wave capacity cleanup is incomplete'), {
          code: 'plan_wave_cleanup_incomplete', taskIds,
        });
      }
    };
    if (typeof coordinator._worktrees?.reserveCapacityMany === 'function') {
      const reservations = await Promise.resolve(coordinator._worktrees.reserveCapacityMany(prepared.map(({ taskId, runId, workerId }) => ({
        taskId, requestedBaseSha: null, runId, attemptId: workerId, processGeneration: 1,
      }))));
      if (!Array.isArray(reservations) || reservations.length !== prepared.length) {
        throw Object.assign(new Error('plan wave capacity authority returned an invalid result'), {
          code: 'plan_wave_capacity_invalid',
        });
      }
      prepared.forEach(({ taskId }, index) => {
        if (reservations[index] !== null) reservedCapacityTaskIds.push(taskId);
      });
    } else if (typeof coordinator._worktrees?.reserveCapacity === 'function') {
      const reservations = await Promise.allSettled(prepared.map((member) => (
        coordinator._worktrees.reserveCapacity(member.taskId, null, {
          runId: member.runId, attemptId: member.workerId, processGeneration: 1,
        })
      )));
      prepared.forEach(({ taskId }, index) => {
        if (reservations[index].status === 'fulfilled' && reservations[index].value !== null) {
          reservedCapacityTaskIds.push(taskId);
        }
      });
      const reservationFailure = reservations.find((result) => result.status === 'rejected');
      if (reservationFailure) {
        await releaseWaveCapacity();
        throw reservationFailure.reason;
      }
    }
    if (coordinator._drainState !== 'open') {
      await releaseWaveCapacity();
      throw Object.assign(new Error('coordinator admission is draining'), { code: 'coordinator_draining' });
    }

    try {
      recorder.coordination.createPlanGatedWave(prepared.map((member) => ({
        fields: member.fields, gate: member.goalPlan, route: member.route,
      })), auth);
    } catch (error) {
      await releaseWaveCapacity();
      throw error;
    }

    const priorCleanup = recorder.coordination.events?.().find((event) => (
      event.kind === 'driver.recorded' && event.payload?.kind === 'plan.wave_cleanup_completed'
      && event.payload?.repoId === coordinator._repoId && event.payload?.runId === members[0].runId
      && event.payload?.planDigest === members[0].goalPlan.planDigest
    ));
    if (priorCleanup) {
      const { kind: _kind, cleanupDigest, ...cleanupCore } = priorCleanup.payload;
      // A retried admission may have reserved capacity before discovering the durable cleanup
      // tombstone. Release that reservation even when the tombstone itself proves corrupt; the
      // poison path must not strand a second resource claim while reporting the first fault.
      await releaseWaveCapacity();
      if (cleanupDigest !== canonicalDigest(cleanupCore)) {
        throw coordinator._poisonCoordination(Object.assign(new Error('plan wave cleanup receipt is invalid'), {
          code: 'plan_wave_cleanup_integrity',
        }));
      }
      throw Object.assign(new Error('plan wave was previously compensated after dispatch failure'), {
        code: 'plan_wave_settled_failed', cleanupReceipt: priorCleanup.payload,
      });
    }

    try {
      coordinator._seedCoordinationTasks();
      const handles = prepared.map((member) => {
        const task = coordinator._tasks.get(member.taskId);
        const handle = task ? coordinator._workers.get(task.assignee) : null;
        if (!task || !handle || handle.id !== member.workerId) {
          throw Object.assign(new Error('durable plan wave could not install its exact local handle'), {
            code: 'plan_wave_install_incomplete',
          });
        }
        return handle;
      });
      coordinator.tick();
      return handles.map((handle) => coordinator._publicHandle(handle));
    } catch (error) {
      let cleanupReceipt;
      try {
        // The Wave ledger is already authoritative. Re-seeding is idempotent and ensures every
        // reserved durable worker identity is locally addressable before exact stop/reap.
        coordinator._seedCoordinationTasks();
        const targetWorkerIds = prepared.map((member) => member.workerId).sort();
        const outcome = await coordinator.stopRunTargets(targetWorkerIds, 'policy');
        if (typeof coordinator._worktrees?.settleCapacityMany === 'function') {
          const settled = await Promise.resolve(coordinator._worktrees.settleCapacityMany(
            prepared.map((member) => member.taskId),
          ));
          if (!Array.isArray(settled) || settled.length !== prepared.length
            || settled.some((value) => value !== true)) {
            throw Object.assign(new Error('plan wave capacity settlement is incomplete'), {
              code: 'plan_wave_cleanup_incomplete',
            });
          }
        }
        if (outcome.targetCount !== targetWorkerIds.length || outcome.remainingCount !== 0
          || outcome.counts.pendingCancelled + outcome.counts.killConfirmed
            + outcome.counts.alreadyTerminal !== outcome.targetCount
          || outcome.counts.processesObserved !== outcome.counts.processesClosed
          || outcome.checks.interactionsResolved !== true
          || outcome.checks.runAuthorityReleased !== true) {
          throw Object.assign(new Error('plan wave cleanup did not converge'), {
            code: 'plan_wave_cleanup_incomplete',
          });
        }
        const cleanupCore = {
          schemaVersion: 1, repoId: coordinator._repoId, runId: members[0].runId,
          planDigest: members[0].goalPlan.planDigest,
          taskIds: prepared.map((member) => member.taskId).sort(),
          workerIds: targetWorkerIds,
          targetDigest: canonicalDigest(targetWorkerIds),
          failureCode: typeof error?.code === 'string' ? error.code : 'plan_wave_dispatch_failed',
          outcome: {
            targetCount: outcome.targetCount, remainingCount: outcome.remainingCount,
            counts: { ...outcome.counts }, checks: { ...outcome.checks },
          },
        };
        cleanupReceipt = Object.freeze({
          ...cleanupCore, cleanupDigest: canonicalDigest(cleanupCore),
        });
        recorder.coordination.recordDriver('plan.wave_cleanup_completed', cleanupReceipt, {
          actor: 'policy',
          key: `plan.wave_cleanup_completed:${members[0].runId}:${members[0].goalPlan.planDigest}`,
        });
      } catch (cleanupError) {
        throw coordinator._poisonCoordination(Object.assign(
          new Error('plan wave dispatch failed and cleanup did not converge'),
          { code: 'plan_wave_cleanup_incomplete', cause: cleanupError },
        ));
      }
      throw Object.assign(new Error('plan wave dispatch failed after durable admission; every member was reaped'), {
        code: 'plan_wave_dispatch_failed', cause: error, cleanupReceipt,
      });
    }
  }

export async function _resolveRecord(coordinator, recorder, requestId, answer, actor) {
    const record = coordinator._pending.get(requestId);
    if (!record) return { ok: false, result: 'not_found' };
    if (record.state === 'resolving') {
      // Wait for the reserved delivery. Echo its winner if it commits; retry fairly if the
      // delivery rolls back to pending.
      await record.resolvingDone;
      if (record.state === 'resolved') {
        return { ok: false, result: 'already_resolved', resolution: record.resolution };
      }
      return coordinator._resolveRecord(requestId, answer, actor);
    }
    if (record.state !== 'pending') return { ok: false, result: 'already_resolved', resolution: record.resolution };

    // CI2: reserve the single-consumer slot, but do not COMMIT resolution until the adapter
    // accepts delivery. A failed/throwing wire operation rolls back to pending for retry.
    record.state = 'resolving';
    let releaseResolving;
    record.resolvingDone = new Promise((resolve) => { releaseResolving = resolve; });
    const finishResolving = () => {
      releaseResolving();
      delete record.resolvingDone;
    };

    const handle = coordinator._workers.get(record.worker);

    if (record.kind === 'publication') {
      const decision = answer?.decision;
      if (!['allow', 'deny'].includes(decision)) {
        record.state = 'pending';
        finishResolving();
        return { ok: false, result: 'invalid_decision' };
      }
      const currentFence = handle ? coordinator._fences.current(handle.id).fence : null;
      const fenceValid = actor === 'policy' || answer?.fence === record.fenceAtAsk;
      if (!handle || !fenceValid || currentFence !== record.fenceAtAsk) {
        if (handle) {
          const refusedEvent = recorder.log.append({
            worker: handle.id, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
            kind: 'publication.refused', actor: 'policy',
            payload: { requestId, reason: 'stale_fence', remote: record.publication.remote, ref: record.publication.ref, sha: record.publication.sha },
          });
          const evidence = recorder.mapEvent(refusedEvent);
          recorder.recordDriver('publication.refused', { taskId: handle.taskId, requestId, reason: 'stale_fence', publication: record.publication, evidence }, `driver.publication.refused:${handle.taskId}:${requestId}`, 'policy');
        }
        coordinator._resolveInteractionAuthority(requestId, record);
        record.consumer = actor;
        record.resolution = { decision: 'deny', reason: 'stale_fence' };
        finishResolving();
        return { ok: false, result: 'stale_fence', current: currentFence };
      }
      if (decision === 'deny') {
        const deniedEvent = recorder.log.append({
          worker: handle.id, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
          kind: 'publication.denied', actor,
          payload: { requestId, remote: record.publication.remote, ref: record.publication.ref, sha: record.publication.sha },
        });
        const evidence = recorder.mapEvent(deniedEvent);
        recorder.recordDriver('publication.denied', { taskId: handle.taskId, requestId, publication: record.publication, evidence }, `driver.publication.denied:${handle.taskId}:${requestId}`, actor);
        coordinator._resolveInteractionAuthority(requestId, record);
        record.consumer = actor;
        record.resolution = { decision: 'deny' };
        finishResolving();
        return { ok: true, result: 'denied' };
      }
      if (typeof coordinator._publisher !== 'function') {
        record.state = 'pending';
        finishResolving();
        return { ok: false, result: 'publication_unavailable' };
      }
      let authorizedEvent;
      try {
        authorizedEvent = recorder.log.append({
          worker: handle.id, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
          kind: 'publication.authorized', actor,
          payload: { requestId, remote: record.publication.remote, ref: record.publication.ref, sha: record.publication.sha, fence: record.fenceAtAsk },
        });
        const evidence = recorder.mapEvent(authorizedEvent);
        recorder.recordDriver('publication.authorized', { taskId: handle.taskId, requestId, publication: record.publication, fence: record.fenceAtAsk, evidence }, `driver.publication.authorized:${handle.taskId}:${requestId}`, actor);
      } catch (err) {
        record.state = 'pending';
        finishResolving();
        throw err;
      }
      let published;
      try {
        published = await coordinator._publisher(record.publication);
      } catch (err) {
        record.state = 'pending';
        finishResolving();
        throw new PublicationError(String(err?.message ?? err), 'publisher_failed');
      }
      const task = coordinator._tasks.get(handle.taskId);
      void published;
      const publication = Object.freeze({ requestId, ...record.publication, actor });
      try {
        const publicationEvent = recorder.log.append({
          worker: handle.id, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
          kind: 'publication.completed', actor, payload: publication,
        });
        const publicationEvidence = recorder.mapEvent(publicationEvent);
        recorder.coordination?.completePublication({
          taskId: task.id, publication, evidence: publicationEvidence,
          knowledge: {
          id: `decision:publish:${task.id}:${publicationEvent.seq}`, type: 'Decision',
          body: `Published task ${task.id} to ${publication.remote}/${publication.ref}`,
          grounding: 'observed', informedBy: [`task:${task.id}`],
          evidence: [{ coordinationSeq: publicationEvidence.coordinationSeq }],
          },
        }, { actor, key: `publication.commit:${task.id}:${publicationEvent.seq}` });
        task.publication = publication;
      } catch (err) {
        // The publisher may have advanced, so this reservation cannot roll back for retry. The
        // coordinator is poisoned by either authoritative append path, replay requires the atomic
        // coordination commit below, and a racing responder is released instead of hanging.
        coordinator._resolveInteractionAuthority(requestId, record);
        record.consumer = actor;
        record.resolution = { decision: 'allow', outcome: 'unknown' };
        finishResolving();
        throw err;
      }
      coordinator._resolveInteractionAuthority(requestId, record);
      record.consumer = actor;
      record.resolution = { decision: 'allow' };
      finishResolving();
      return { ok: true, result: 'published', publication };
    }

    if (record.kind === 'decision') {
      return coordinator._resolveDecisionRecord(requestId, record, answer, actor, finishResolving);
    }

    const clearPending = () => {
      if (!handle) return;
      if (record.kind === 'question' && handle.pendingQuestionId === requestId) handle.pendingQuestionId = null;
      if (record.kind === 'approval' && handle.pendingApprovalId === requestId) handle.pendingApprovalId = null;
      if (handle.status === 'blocked') {
        handle.status = 'working';
        const task = coordinator._tasks.get(handle.taskId);
        if (task && task.status === 'input_required') task.status = 'working';
      }
    };

    if (!handle) {
      coordinator._resolveInteractionAuthority(requestId, record);
      record.consumer = actor;
      record.resolution = answer;
      clearPending();
      finishResolving();
      return { ok: true, result: 'applied' };
    }

    const harness = coordinator._harnessOf(handle.vendor);
    const currentTurnEpoch = coordinator._safeTurnEpoch(handle);
    const stale = record.turnEpochAtAsk !== currentTurnEpoch;

    if (stale) {
      const staleEvent = recorder.log.append({ worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'control.stale_rejected', actor, payload: { op: 'respond', requestId } });
      const task = coordinator._tasks.get(handle.taskId);
      if (task && recorder.coordination?.task(task.id)?.status === 'input_required') {
        const evidence = recorder.mapEvent(staleEvent);
        coordinator._coordTransition(task, 'working', `task.working:${task.id}:${staleEvent.seq}`, { ...evidence, interaction: { requestId, disposition: 'stale_discarded' } }, actor);
      }
      coordinator._resolveInteractionAuthority(requestId, record);
      record.consumer = actor;
      record.resolution = answer;
      clearPending();
      finishResolving();
      return { ok: true, result: 'applied', note: 'answer arrived after the asking turn ended; discarded per fencing' };
    }

    let ack;
    try {
      if (record.kind === 'question') {
        ack = await coordinator._adapters[handle.vendor].answer(handle.id, requestId, answer);
      } else {
        const decision = answer && answer.decision;
        ack = await coordinator._adapters[handle.vendor].approve(handle.id, requestId, decision, answer && answer.payload);
      }
    } catch (err) {
      record.state = 'pending';
      record.consumer = null;
      record.resolution = null;
      finishResolving();
      throw err;
    }

    if (!ack || ack.ok !== true) {
      record.state = 'pending';
      record.consumer = null;
      record.resolution = null;
      finishResolving();
      return { ok: false, result: 'delivery_refused', reason: ack?.reason ?? 'adapter did not affirm response delivery' };
    }

    let resolvedEvent;
    try {
      if (record.kind === 'question') {
        const ev = { worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'question.answered', actor, payload: { requestId, answer } };
        if (ack && ack.emulated === true) ev.emulated = true;
        resolvedEvent = recorder.log.append(ev);
      } else {
        const decision = answer && answer.decision;
        const ev = { worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'approval.resolved', actor, payload: { requestId, decision } };
        if (ack && ack.emulated === true) ev.emulated = true;
        resolvedEvent = recorder.log.append(ev);
      }
    } catch (err) {
      // Delivery was accepted by the native adapter and is not safely retryable. Commit the
      // in-memory single-consumer reservation, release racing responders, and rely on poisoned
      // fail-closed behavior plus replay terminalization for the missing durable resolution.
      coordinator._resolveInteractionAuthority(requestId, record);
      record.consumer = actor;
      record.resolution = answer;
      finishResolving();
      throw err;
    }
    const task = coordinator._tasks.get(handle.taskId);
    if (task && recorder.coordination?.task(task.id)?.status === 'input_required') {
      try {
        const evidence = recorder.mapEvent(resolvedEvent);
        coordinator._coordTransition(task, 'working', `task.working:${task.id}:${resolvedEvent.seq}`, { ...evidence, interaction: { requestId, disposition: 'delivered' } }, actor);
      } catch (err) {
        coordinator._resolveInteractionAuthority(requestId, record);
        record.consumer = actor;
        record.resolution = answer;
        finishResolving();
        throw err;
      }
    }

    coordinator._resolveInteractionAuthority(requestId, record);
    record.consumer = actor;
    record.resolution = answer;
    clearPending();
    finishResolving();
    return { ok: true, result: 'applied' };
  }

export async function stopRunTargets(coordinator, recorder, targetWorkerIds, actor = 'orchestrator', opts = {}) {
    runtimeAdmission._admitRunStopTargets(coordinator, recorder, targetWorkerIds, actor, opts);
    // The startup-reconciliation wait stays in the effect, at its verbatim position: an async
    // admission prefix would adopt one settlement hop (the slice-11 lesson), and P91-12 pins the
    // exact hop count — a stop must win a preserved-successor delivery racing it.
    await Promise.all(coordinator._startupCleanupPromises);
    if (coordinator._startupCleanupError) throw Object.assign(new Error('Run stop startup reconciliation is incomplete'), { code: 'coordinator_run_stop_incomplete' });
    const deadline = Date.now() + coordinator._drainPolicy.timeoutMs;
    // A recovered exact-identity reap may signal just before its bounded confirmation probe
    // expires. Preserve that effect across convergence attempts: later authoritative absence is
    // closure of the generation this Run stop targeted, not pre-existing terminal state.
    const state = { actor, deadline, dispositions: new Map(), recoveredSignals: new Map() };


    // #360/#450: first-sight bookkeeping for the named waits — `since` is when THIS stop first
    // observed the wait, so a deadline row reads how long the release has been pending.
    coordinator._drainWaitObserve(targetWorkerIds);
    while (Date.now() <= deadline) {
      // An attempt that never settles (a cleanup or reap that hangs) must not hide the deadline:
      // the wait is raced against it and, past the deadline, named below like any other.
      let deadlineTimer = null;
      const deadlineElapsed = new Promise((resolve) => { deadlineTimer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now())); });
      const attemptsSettled = await Promise.race([Promise.all(targetWorkerIds.map((workerId) => attemptRunStopTarget(coordinator, recorder, state, workerId))).then(() => true), deadlineElapsed]);
      clearTimeout(deadlineTimer);
      if (!attemptsSettled) break;
      const targets = targetWorkerIds.map((id) => coordinator._workers.get(id)).filter(Boolean);
      const resourcesReleased = targets.every((handle) => !coordinator._ownsLocalResources(handle)
        && (!handle.processRef || handle.processRef.state === 'closed'));
      const interactionsResolved = targets.every((handle) => !handle.pendingApprovalId && !handle.pendingQuestionId);
      if (state.dispositions.size === targetWorkerIds.length && resourcesReleased && interactionsResolved) {
        // `resourcesReleased` above already asserts every target's process closed, so the
        // counts are necessarily equal here: no dead branch to break out of (#277 G-23).
        const processesObserved = targets.filter((handle) => handle.processRef !== null).length;
        const processesClosed = targets.filter((handle) => handle.processRef?.state === 'closed').length;
        return Object.freeze({
          targetCount: targetWorkerIds.length,
          remainingCount: 0,
          counts: Object.freeze({
            pendingCancelled: [...state.dispositions.values()].filter((value) => value === 'pendingCancelled').length,
            killConfirmed: [...state.dispositions.values()].filter((value) => value === 'killConfirmed').length,
            alreadyTerminal: [...state.dispositions.values()].filter((value) => value === 'alreadyTerminal').length,
            processesObserved,
            processesClosed,
          }),
          checks: Object.freeze({ interactionsResolved: true, runAuthorityReleased: true }),
        });
      }
      await coordinator._sleep(Math.min(coordinator._drainPolicy.pollMs, Math.max(0, deadline - Date.now())));
    }
    throw Object.assign(new Error('Run stop did not converge before its deadline'), {
      code: 'coordinator_run_stop_incomplete',
      detail: { timeoutMs: coordinator._drainPolicy.timeoutMs, waitingOn: coordinator._stopWaitingOn(targetWorkerIds, state.dispositions, actor) },
    });
}

async function cancelRunStopTarget(coordinator, recorder, state, handle, task, kind) {
      const cancelled = recorder.log.append({
        worker: handle.id, harness: handle.vendor ? coordinator._harnessOf(handle.vendor) : '', turnEpoch: coordinator._safeTurnEpoch(handle),
        kind, actor: state.actor, ...coordinator._routeAttribution(handle, task), payload: {},
      });
      const evidence = recorder.mapEvent(cancelled);
      // #201: a retry_pending park survives the crash-path stop — the task belongs to the
      // successor incarnation's resume, not this dying generation's cancel semantics.
      if (task && !TERMINAL_TASK_STATUSES.has(task.status) && task.status !== 'retry_pending') {
        coordinator._coordTransition(task, 'cancelled', `task.cancelled:${task.id}:${cancelled.seq}`, evidence);
        task.status = 'cancelled';
      }
      handle.status = 'dead';
      const runtimeRemoved = coordinator._removeRuntimeScope(handle);
      await coordinator._removeOwnedTaskWorktree(handle, task);
      if (!runtimeRemoved) throw Object.assign(new Error('Run stop runtime cleanup failed'), { code: 'coordinator_run_stop_incomplete' });
      if (!handle.processRef || handle.processRef.state === 'closed') handle.localAuthority = false;
}

async function attemptRunStopTarget(coordinator, recorder, state, workerId) {
      const handle = coordinator._workers.get(workerId);
      if (!handle) {
        // No in-memory handle means nothing locally ownable is left to converge: the run stop
        // admission already fenced late dispatch and claim, `reservedWorkerId` is immutable
        // per durable task, and no later retry of THIS stop can produce a handle. The worker
        // gets its disposition immediately — a durable non-terminal row with no handle never
        // spins this loop to its deadline (#277 G-22) — and the projection is never re-cloned
        // per poll.
        state.dispositions.set(workerId, 'alreadyTerminal');
        return;
      }
      const task = coordinator._tasks.get(handle.taskId);
      for (const requestId of [handle.pendingApprovalId, handle.pendingQuestionId].filter(Boolean)) {
        try { await coordinator._resolveRecord(requestId, { decision: 'cancel' }, state.actor); } catch { /* kill retries the same authority */ }
      }
      if (task?.status === 'pending' || handle.status === 'pending') {
        await cancelRunStopTarget(coordinator, recorder, state, handle, task, 'control.run_stop_cancelled');
        state.dispositions.set(workerId, 'pendingCancelled');
        return;
      }
      if (!coordinator._ownsLocalResources(handle) && (!handle.processRef || handle.processRef.state === 'closed')) {
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) await cancelRunStopTarget(coordinator, recorder, state, handle, task, 'control.run_stop_cancelled');
        state.dispositions.set(workerId, 'alreadyTerminal');
        return;
      }
      // Replay can signal only a generation carrying a durable kernel-start observation that
      // still matches the group leader. Legacy generations remain absence-only, preserving their
      // no-PID-reuse behavior. A successful recovered reap is policy-observed closure rather than
      // a fabricated acknowledgement from the fresh adapter instance.
      const replayedProcess = handle.currentIncarnation !== true
        && handle.processRef?.state === 'unconfirmed_after_restart';
      const replayedAuthorityState = replayedProcess
        ? processAuthorityState(handle.processRef, handle.processAuthority) : 'unavailable';
      if (replayedProcess && handle.recoveredProcessAuthority === true
        && replayedAuthorityState === 'active') {
        const reaped = await reapRecoveredProcessGroup(handle.processRef, handle.processAuthority, {
          timeoutMs: Math.max(1, Math.min(coordinator._stopDeadlineMs, state.deadline - Date.now())),
        });
        if (reaped.signaled) state.recoveredSignals.set(workerId, Object.freeze({
          generation: handle.processRef.generation,
          pid: handle.processRef.pid,
          processGroupId: handle.processRef.processGroupId,
          pidStart: handle.processAuthority.pidStart,
        }));
        if (reaped.confirmed && reaped.signaled) {
          const closed = recorder.log.append({
            worker: handle.id,
            harness: handle.vendor ? coordinator._harnessOf(handle.vendor) : '',
            turnEpoch: coordinator._safeTurnEpoch(handle),
            kind: 'control.recovery_process_reaped',
            actor: 'policy',
            ...coordinator._routeAttribution(handle, task),
            payload: recoveryProcessReapedPayload(handle.processRef, handle.processAuthority),
          });
          recorder.mapEvent(closed);
          handle.processRef = { ...handle.processRef, state: 'closed', closedSeq: closed.seq };
          handle.recoveredProcessAuthority = false;
          handle.status = 'dead';
          const runtimeRemoved = coordinator._removeRuntimeScope(handle);
          await coordinator._removeOwnedTaskWorktree(handle, task);
          if (!runtimeRemoved) return;
          handle.localAuthority = false;
          state.dispositions.set(workerId, 'killConfirmed');
          state.recoveredSignals.delete(workerId);
          return;
        }
      }
      if (replayedProcess
        && (replayedAuthorityState === 'absent'
          || !processGroupAlive(handle.processRef.processGroupId))) {
        const signaled = state.recoveredSignals.get(workerId);
        const exactSignal = !!signaled
          && signaled.generation === handle.processRef.generation
          && signaled.pid === handle.processRef.pid
          && signaled.processGroupId === handle.processRef.processGroupId
          && signaled.pidStart === handle.processAuthority?.pidStart;
        const closed = recorder.log.append({
          worker: handle.id,
          harness: handle.vendor ? coordinator._harnessOf(handle.vendor) : '',
          turnEpoch: coordinator._safeTurnEpoch(handle),
          kind: exactSignal ? 'control.recovery_process_reaped' : 'control.recovery_process_absent',
          actor: 'policy',
          ...coordinator._routeAttribution(handle, task),
          payload: exactSignal
            ? recoveryProcessReapedPayload(handle.processRef, handle.processAuthority)
            : recoveryProcessAbsentPayload(handle.processRef),
        });
        recorder.mapEvent(closed);
        handle.processRef = { ...handle.processRef, state: 'closed', closedSeq: closed.seq };
        handle.recoveredProcessAuthority = false;
        handle.status = 'dead';
        const runtimeRemoved = coordinator._removeRuntimeScope(handle);
        await coordinator._removeOwnedTaskWorktree(handle, task);
        if (!runtimeRemoved) return;
        handle.localAuthority = false;
        state.dispositions.set(workerId, exactSignal ? 'killConfirmed' : 'alreadyTerminal');
        state.recoveredSignals.delete(workerId);
        return;
      }
      try {
        // One posture under a poisoned coordinator (#277 G-28): the drain token admits the
        // same exact-physical-state emergency path the fleet drain's own attempts take, so a
        // fatal error surfaces as convergence work, never as a silently swallowed throw that
        // burns the whole deadline.
        const result = await coordinator.kill(workerId, state.actor, { drainToken: coordinator._drainKillToken, rule: KILL_RULES.drain });
        if (result?.ok && result.result === 'confirmed') state.dispositions.set(workerId, 'killConfirmed');
        else if (result?.ok && ['already_dead', 'already_stopped', 'already_dead_unlogged'].includes(result.result)
          && !coordinator._ownsLocalResources(handle) && (!handle.processRef || handle.processRef.state === 'closed')) {
          state.dispositions.set(workerId, 'alreadyTerminal');
        }
      } catch { /* bounded convergence below retries exact physical state */ }
}

export async function _integrate(coordinator, recorder, workerId, opts = {}) {
    coordinator.tick();
    const handle = coordinator._getWorker(workerId);
    const task = coordinator._tasks.get(handle.taskId);
    runtimeAdmission._admitIntegration(coordinator, handle, task, opts);
    // The admission prefix computes the same local for its own checks; the effect re-derives it
    // (identical expression, identical value) rather than widening the admission return.
    const strategy = opts.strategy ?? 'ff-only';

    recorder.recordDriver('integration.requested', {
      taskId: task.id, workerId, strategy, sha: task.capturedSha,
      actor: opts.actor ?? 'orchestrator', effect: strategy === 'structured' ? 'staged_local_git_merge' : 'local_git_merge',
    }, `driver.integration.requested:${task.id}:${task.capturedSha}`, opts.actor ?? 'orchestrator');

    if (typeof coordinator._worktrees.retainResult === 'function') {
      task.retainedResultRef = await coordinator._worktrees.retainResult(task.capturedSha);
    }

    const alreadyReaped = handle.processRef === null && handle.runtimeScope?.active !== true;
    if (handle.status === 'idle' && !alreadyReaped) {
      const stopped = await coordinator.kill(workerId, opts.actor ?? 'orchestrator', { rule: KILL_RULES.runStop });
      if (!['confirmed', 'already_dead', 'already_stopped'].includes(stopped.result)) {
        throw new IntegrationError('worker could not be safely stopped before integration', 'worker_stop_failed');
      }
    } else if (handle.status === 'exited') {
      await coordinator.kill(workerId, opts.actor ?? 'orchestrator', { rule: KILL_RULES.runStop });
    }
    await coordinator._removeTaskWorktree(task);

    let integrated; let structuredStage = null; let structuredVerifyPath = null; let structuredFinalizeStarted = false; let structuredToolchainProjection = null;
    try {
      if (strategy === 'ff-only') {
        integrated = await coordinator._worktrees.integrate(task.capturedSha, { strategy });
      } else {
        structuredStage = await coordinator._worktrees.stageStructuredIntegration(task.id, task.capturedSha);
        const created = await coordinator._worktrees.createVerifyWorktree(`${task.id}-structured-merge`, structuredStage.stageSha);
        structuredVerifyPath = created?.path ?? null;
        structuredToolchainProjection = created?.toolchainProjection ?? null;
        const workerToolchainProjection = task.sessionContext?.toolchainProjection ?? null;
        if ((workerToolchainProjection || structuredToolchainProjection)
          && (!workerToolchainProjection || !structuredToolchainProjection || canonicalDigest(workerToolchainProjection) !== canonicalDigest(structuredToolchainProjection))) throw Object.assign(new Error('structured verification toolchain projection mismatch'), { code: 'structured_verification_environment_mismatch' });
        const observedVerdict = await coordinator._referee(task, { verification: { claimedExit: null } }, {
          pinnedVerification: task.brief.verification,
          sandbox: structuredVerifyPath,
        });
        const accepted = coordinator._accept(observedVerdict, {
          expectExit: task.brief.verification.expectExit,
          requireRedGreen: false,
          requireCoverage: false,
          requireMutation: false,
        });
        const verdict = closedVerificationVerdict(observedVerdict, task.brief.verification);
        recorder.log.append({
          worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
          kind: 'integration.merge_reverified', actor: 'policy',
          ...coordinator._routeAttribution(handle, task),
          payload: { strategy, stageSha: structuredStage.stageSha, verdict, accept: accepted, ...(structuredToolchainProjection ? { toolchainProjection: structuredToolchainProjection } : {}) },
        });
        if (!accepted) throw Object.assign(new Error('structured merge candidate failed fresh pinned verification'), { code: 'structured_verification_failed' });
        structuredFinalizeStarted = true;
        integrated = { ...(await coordinator._worktrees.finalizeStructuredIntegration(structuredStage)), verdict, ...(structuredToolchainProjection ? { toolchainProjection: structuredToolchainProjection } : {}) };
      }
    } catch (err) {
      if (structuredVerifyPath) await coordinator._worktrees.removeVerifyWorktree(structuredVerifyPath);
      if (structuredStage) await coordinator._worktrees.removeStructuredIntegration(structuredStage);
      let integrationPostEffect = err?.postEffect === true || err?.code === 'structured_post_effect_inconsistent';
      if (strategy === 'structured' && structuredFinalizeStarted && structuredStage && !integrationPostEffect) {
        try { integrationPostEffect = (await coordinator._worktrees.inspectStructuredIntegration(structuredStage)).effectApplied === true; }
        catch { /* the finalizer owns tagging when Git itself becomes unreadable after the effect */ }
      }
      if (integrationPostEffect) {
        const beforeSha = err?.beforeSha ?? structuredStage?.beforeSha ?? null;
        const afterSha = err?.afterSha ?? null;
        const incompleteEvent = recorder.log.append({
          worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
          kind: 'integration.incomplete', actor: 'policy',
          ...coordinator._routeAttribution(handle, task),
          payload: {
            strategy, beforeSha, afterSha, stageSha: structuredStage?.stageSha ?? null,
            sha: task.capturedSha, retainedResultRef: task.retainedResultRef, postEffect: true,
            reason: String(err?.message ?? err),
          },
        });
        const incompleteEvidence = recorder.mapEvent(incompleteEvent);
        recorder.recordDriver('integration.incomplete', {
          taskId: task.id, strategy, beforeSha, afterSha,
          stageSha: structuredStage?.stageSha ?? null, sha: task.capturedSha,
          retainedResultRef: task.retainedResultRef, postEffect: true,
          reason: String(err?.message ?? err), evidence: incompleteEvidence,
        }, `driver.integration.incomplete:${task.id}:${incompleteEvent.seq}`, 'policy');
        throw coordinator._poisonIntegration(err, strategy);
      }
      const refusedEvent = recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'integration.refused', actor: 'policy',
        ...coordinator._routeAttribution(handle, task),
        payload: { strategy, sha: task.capturedSha, retainedResultRef: task.retainedResultRef, reason: String(err?.message ?? err) },
      });
      const refusedEvidence = recorder.mapEvent(refusedEvent);
      recorder.recordDriver('integration.refused', {
        taskId: task.id, strategy, sha: task.capturedSha, retainedResultRef: task.retainedResultRef,
        reason: String(err?.message ?? err), evidence: refusedEvidence,
      }, `driver.integration.refused:${task.id}:${refusedEvent.seq}`, 'policy');
      throw new IntegrationError(String(err?.message ?? err), err?.code?.startsWith('structured_') ? err.code : 'non_fast_forward_or_dirty');
    }
    if (structuredVerifyPath) await coordinator._worktrees.removeVerifyWorktree(structuredVerifyPath);
    if (structuredStage) await coordinator._worktrees.removeStructuredIntegration(structuredStage);
    // Integration does not end accepted-result ownership. The result pin is shared by SHA and is
    // also the immutable source for evidence-bound export; releasing it here can break another Run
    // that accepted the same commit and makes integration-required delivery impossible. A later
    // durable retention/GC authority may release pins only after every owning Run/export is closed.
    const integration = Object.freeze({
      ...integrated,
      strategy,
      actor: opts.actor ?? 'orchestrator',
      stability: task.verificationStability ?? null,
    });
    const integrationEvent = recorder.log.append({
      worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
      kind: 'integration.completed', actor: opts.actor ?? 'orchestrator', payload: integration,
      ...coordinator._routeAttribution(handle, task),
    });
    const integrationEvidence = recorder.mapEvent(integrationEvent);
    if (recorder.coordination) {
      const acceptingEvidence = recorder.coordination.task(task.id).artifactIds
        .map((artifactId) => recorder.coordination.artifact(artifactId))
        .filter((artifact) => artifact?.accepted === true)
        .flatMap((artifact) => artifact.provenance ?? []);
      recorder.coordination.completeIntegration({
        taskId: task.id, integration, evidence: integrationEvidence,
        artifact: {
          taskId: task.id, kind: 'report', refs: { beforeSha: integration.beforeSha, resultSha: integration.resultSha, afterSha: integration.afterSha },
          mediaType: 'application/vnd.baton.integration+json', accepted: true, provenance: [integrationEvidence, ...acceptingEvidence],
        },
        knowledge: {
          id: `decision:integrate:${task.id}:${integrationEvent.seq}`, type: 'Decision',
          body: `Integrated task ${task.id} at ${integration.afterSha}`, grounding: 'observed',
          informedBy: [`task:${task.id}`], evidence: [{ coordinationSeq: integrationEvidence.coordinationSeq }],
        },
      }, { actor: opts.actor ?? 'orchestrator', key: `integration.commit:${task.id}:${integrationEvent.seq}` });
    }
    task.integration = integration;
    return { ok: true, result: 'integrated', integration };
}

export async function _deliver(coordinator, recorder, handle, message, mode, opts) {
    const workerId = handle.id;
    const admission = runtimeAdmission._admitDelivery(coordinator, recorder, handle, mode, opts);
    if (admission.admitted !== true) return admission.result;
    if (admission.handoff === 'preservedSuccessor') {
      return coordinator._deliverPreservedSuccessor(handle, coordinator._tasks.get(handle.taskId), message, opts);
    }
    if (admission.handoff === 'followUp') {
      return coordinator._deliverFollowUp(handle, coordinator._tasks.get(handle.taskId), message, opts);
    }
    if (admission.handoff === 'nudgeTurn') {
      return coordinator.nudgeTurn(admission.pause.pauseId, message, { actor: opts.actor });
    }
    if (admission.handoff === 'reportedTurn') {
      // The per-worker send queue owns this continuation. Reuse native turn admission,
      // fence advancement, and post-delivery checks for the active reported assignment.
      return coordinator._nudgeReservedTurn({
        record: { reported: true, worker: workerId, taskId: handle.taskId },
        commit: () => {}, rollback: () => {},
      }, null, message, opts);
    }
    if (admission.handoff === 'interruptThenGoverned') {
      return coordinator._interruptThenGoverned(handle, message, opts.actor ?? 'orchestrator');
    }
    const task = coordinator._tasks.get(handle.taskId);
    const stamp = coordinator._fences.issue(workerId);
    const harness = coordinator._harnessOf(handle.vendor);
    if (opts.controlId) {
      recorder.log.append({
        worker: workerId, harness, turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'control.delivery_requested', actor: opts.actor ?? 'orchestrator',
        payload: { controlId: opts.controlId, mode },
      });
    }
    const ack = await coordinator._adapters[handle.vendor].prompt(workerId, message, mode);
    const check = coordinator._fences.check(workerId, stamp);
    const currentTurnEpoch = coordinator._fences.current(workerId).turnEpoch;

    if (!check.ok) {
      recorder.log.append({
        worker: workerId,
        harness,
        turnEpoch: currentTurnEpoch,
        kind: 'control.stale_rejected',
        actor: opts.actor ?? 'orchestrator',
        payload: {
          op: 'send', mode, attempted: stamp, current: check.current, phase: 'post_delivery',
          ...(opts.controlId ? { controlId: opts.controlId } : {}),
        },
      });
      // C3: delivery already happened despite the staleness — say so, loudly.
      recorder.log.append({
        worker: workerId,
        harness,
        turnEpoch: currentTurnEpoch,
        kind: 'control.delivery_amended',
        actor: 'policy',
        payload: {
          op: 'send', mode, message, deliveredDespiteStale: true, attempted: stamp,
          current: check.current, ...(opts.controlId ? { controlId: opts.controlId } : {}),
        },
      });
      return {
        ok: false, result: 'stale_fence', current: check.current,
        deliveredDespiteStale: true,
      };
    }

    if (ack && ack.ok === false) {
      if (opts.controlId) {
        recorder.log.append({
          worker: workerId, harness, turnEpoch: currentTurnEpoch,
          kind: 'control.delivery_refused', actor: opts.actor ?? 'orchestrator',
          payload: { controlId: opts.controlId, mode, result: ack.reason ?? 'delivery_refused' },
        });
      }
      return { ok: false, result: ack.reason ?? 'delivery_refused', reason: ack.reason };
    }

    const kind = opts.internalKindToken === ORIENTATION_DELIVERY
      ? 'knowledge.map_served'
      : mode === 'nudge' ? 'control.nudge' : mode === 'steer' ? 'control.steer' : 'control.send';
    const ev = {
      worker: workerId, harness, turnEpoch: currentTurnEpoch, kind,
      actor: opts.actor ?? 'orchestrator',
      payload: { message, ...(opts.controlId ? { controlId: opts.controlId } : {}), ...(opts.guidance ? { guidance: opts.guidance } : {}) },
    };
    if (ack && ack.emulated === true) ev.emulated = true;
    recorder.log.append(ev);
    // D4 rung 2: an orchestrator claim (control.steer / control.nudge) arms the stall-seam cycle
    // for a currently-declared stall. Neither steer nor nudge is a REARM kind — they never re-arm
    // the watchdog; they claim the stall for the ladder.
    if ((mode === 'steer' || mode === 'nudge') && handle.watchdogActions?.has('stall')) {
      coordinator._armStallCycle(handle, task, { nudgeId: mode === 'nudge' ? `nudge:${workerId}:${recorder.log.tail(workerId)}` : null, controlId: opts.controlId ?? null });
    }
    // BD3-C: run.send / nudge_turn are ALIASES over the lane — the legacy names mint lane
    // receipts (message.sent / message.delivered) with identical worker-visible behavior.
    if (opts.internalKindToken !== ORIENTATION_DELIVERY && recorder.coordination.recordMessage) {
      const laneKind = mode === 'nudge' ? 'nudge' : mode === 'steer' ? 'steer' : 'turn';
      try {
        recorder.coordination.recordMessage('message.sent', {
          messageId: `message:${canonicalDigest({ lane: true, workerId, kind: laneKind, body: message, seq: recorder.log.tail(workerId) })}`,
          kind: laneKind, from: opts.actor ?? 'orchestrator', to: { workerId },
          body: typeof message === 'string' ? message : JSON.stringify(message),
          targetCount: 1, alias: true,
        }, { actor: 'orchestrator', key: `message.sent:${workerId}:${recorder.log.tail(workerId)}` });
      } catch (error) { coordinator._noteFailure('lane_delivery_audit', error); }
    }
    return { ok: true, result: 'ok', emulated: ack && ack.emulated === true };
}

export function _finalizeStop(coordinator, recorder, workerId, waiter) {
    if (waiter.finalized) return;
    waiter.finalized = true;
    // Issue #467: a finalized stop ends its bounded transaction — the attempt count belongs to the
    // NEXT stop of this worker, never to the worker's whole life.
    const finalizedHandle = coordinator._workers.get(workerId);
    if (finalizedHandle) {
      finalizedHandle.stopDeadlineAttempts = 0;
      finalizedHandle.stopAbandoned = null;
    }
    if (waiter.timerHandle != null) coordinator._clearTimeout(waiter.timerHandle);
    if (waiter.reapRetryHandle != null) coordinator._clearTimeout(waiter.reapRetryHandle);
    const handle = coordinator._workers.get(workerId);
    const harness = handle ? coordinator._harnessOf(handle.vendor) : '';
    const kind = waiter.mode === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed';
    const ev = {
      worker: workerId, harness, turnEpoch: handle ? coordinator._safeTurnEpoch(handle) : 0, kind, actor: 'worker',
      payload: {
        ...(waiter.providerSealVerdict?.seal ? { usageSeal: waiter.providerSealVerdict.seal } : {}),
        ...(waiter.controlId ? { controlId: waiter.controlId } : {}),
      },
      ...(handle ? coordinator._routeAttribution(handle) : {}),
    };
    if (waiter.emulated) ev.emulated = true;
    const preservation = coordinator._sessionPreservationReceipt(handle, waiter);
    if (waiter.preserveTurn === true) {
      ev.payload.preservation = preservation;
      ev.payload.preservationRequested = true;
    }
    const stopEvent = recorder.log.append(ev);
    if (waiter.preserveTurn === true) recorder.mapEvent(stopEvent);
    if (handle && waiter.providerSealVerdict && !waiter.providerSealVerdict.ok) {
      coordinator._failTerminalProviderGovernance(handle, stopEvent, waiter.providerSealVerdict.code, false);
    }

    try {
      if (handle) {
        const task = coordinator._tasks.get(handle.taskId);
        if (waiter.mode === 'kill') {
          // #295 item 3: a typed provider fault is a RESUMABLE death — the work the member
          // produced must outlive it, so a checkpoint is preserved on that class even though the
          // task itself settled failed. Any other kill of a terminal task preserves nothing.
          const preserveProgress = Boolean(task && (!TERMINAL_TASK_STATUSES.has(task.status)
            || handle.terminalCause?.kind === 'provider_failure'));
          // #201: retry_pending parks survive the kill-confirmed cancel — the successor resumes.
          if (task && !TERMINAL_TASK_STATUSES.has(task.status) && task.status !== 'retry_pending') {
            const evidence = recorder.mapEvent(stopEvent);
            coordinator._coordTransition(task, 'cancelled', `task.cancelled:${task.id}:${stopEvent.seq}`, evidence);
          }
          handle.status = 'dead';
          handle.sessionPreservation = null;
          handle.preservedTurnEpoch = null;
          const runtimeRemoved = coordinator._removeRuntimeScope(handle);
          if (task && !TERMINAL_TASK_STATUSES.has(task.status) && task.status !== 'retry_pending') task.status = 'cancelled';
          waiter.cleanupPromise = coordinator._preserveProgressBeforeReap(handle, task, stopEvent, preserveProgress)
            .then(() => waiter.retainUnownedWorktree
              ? undefined : coordinator._removeOwnedTaskWorktree(handle, task))
            // Issue #450: the reservation this kill leaves behind is settled once the
            // transaction is over (see the settled continuation below) — after this handle's last
            // hold is released, so the sweep never races the stop it belongs to.
            .then(() => {
              if (!runtimeRemoved) throw Object.assign(new Error('runtime cleanup failed'), { code: 'runtime_cleanup_failed' });
            });
        } else if (waiter.preserveTurn === true) {
          // Phase 91: the semantic interrupt ends one exact provider turn. It does not
          // terminalize the Plan task or release any Run/worktree/session authority.
          handle.turnTerminalObserved = true;
          if (preservation) {
            handle.status = 'interrupted';
            handle.sessionPreservation = preservation;
            handle.preservedTurnEpoch = preservation.turnEpoch;
          } else {
            // Confirmation without exact attached-session proof is uncertainty, never a false
            // preservation claim. If this controller still owns the transport, fail the Plan
            // task and reap it below; a replay-only controller instead leaves a quarantined,
            // stop-only member because it has no safe signaling authority.
            handle.status = 'orphaned';
            handle.sessionPreservation = null;
            handle.preservedTurnEpoch = null;
            if (handle.localAuthority === true && task
              && !TERMINAL_TASK_STATUSES.has(task.status)) {
              const evidence = recorder.mapEvent(stopEvent);
              coordinator._coordTransition(task, 'failed',
                `task.failed:${task.id}:preservation_unproven:${stopEvent.seq}`, evidence);
              task.status = 'failed';
            }
          }
        } else {
          if (waiter.then !== undefined) {
            const stamp = coordinator._fences.bumpTurn(handle.id);
            handle.status = 'working';
            handle.turnTerminalObserved = false;
            coordinator._clearBudgetStop(handle);
            if (task) {
              task.status = 'working';
              task.result = null;
              task.verdict = null;
            }
            recorder.log.append({
              worker: workerId, harness, turnEpoch: stamp.turnEpoch, kind: 'lifecycle.turn_started', actor: 'orchestrator',
              ...coordinator._routeAttribution(handle, task),
              payload: { followUp: true, afterInterrupt: true },
            });
            coordinator._resetWatchdogTurn(handle);
          } else {
            if (task && !TERMINAL_TASK_STATUSES.has(task.status)) {
              const evidence = recorder.mapEvent(stopEvent);
              coordinator._coordTransition(task, 'cancelled', `task.cancelled:${task.id}:${stopEvent.seq}`, evidence);
            }
            handle.status = 'idle';
            if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'cancelled';
          }
        }
      }
    } catch (err) {
      if (handle) {
        handle.status = 'dead';
        const runtimeRemoved = coordinator._removeRuntimeScope(handle);
        waiter.cleanupPromise = coordinator._removeOwnedTaskWorktree(handle, coordinator._tasks.get(handle.taskId)).then(() => {
          if (!runtimeRemoved) throw Object.assign(new Error('runtime cleanup failed'), { code: 'runtime_cleanup_failed' });
        });
        coordinator._bestEffort(Promise.resolve(coordinator._adapters[handle.vendor]?.kill(handle.id)), 'adapter_kill');
      }
      Promise.resolve(waiter.cleanupPromise).then(() => {
        if (handle && (!handle.processRef || handle.processRef.state === 'closed') && handle.cleanupPending !== true) handle.localAuthority = false;
      }, noop).finally(() => {
        coordinator._resolveStopRequests(waiter, { ok: false, result: 'coordination_unavailable' });
        coordinator._stopWaiters.delete(workerId);
      });
      return;
    }

    const governanceInvalid = waiter.preserveTurn === true
      && waiter.providerSealVerdict && waiter.providerSealVerdict.ok !== true;
    const result = governanceInvalid
      ? {
        ok: false, result: 'provider_governance_invalid',
        reason: waiter.providerSealVerdict.code, emulated: waiter.emulated === true,
      }
      : waiter.preserveTurn === true && !preservation
        ? { ok: false, result: 'preservation_unproven', emulated: waiter.emulated === true }
      : {
        ok: true, result: 'confirmed', emulated: waiter.emulated === true,
        ...(preservation ? { preservation } : {}),
      };
    Promise.resolve(waiter.cleanupPromise).then(async () => {
      if (handle && waiter.mode === 'kill') {
        // #265 item 2 and #295 items (2)+(4): the kill reaped this member's transport, so every
        // observed native child is settled (unknown + named gap) and a typed provider death lands
        // as a run-level row naming the route, the fault class, and what was preserved.
        coordinator._settleTransportDeath(handle, coordinator._tasks.get(handle.taskId), stopEvent);
      }
      if (handle && waiter.mode === 'kill') handle.localAuthority = false;
      // The transaction is over the moment its cleanup settles: the waiter must leave the map
      // before anything reads it (a successor delivery, a convergence predicate, a later stop).
      coordinator._stopWaiters.delete(workerId);
      // Issue #450: the kill path settles the capacity reservation the worker it just confirmed
      // left behind — the seam that ALREADY observed the confirmation, one durable
      // `drain.resource_released` row with reason `worker_gone`, never a ledger scan at stop time.
      // Awaited so this stop's own answer is ordered after its release; a release the authority
      // refuses leaves the reservation for the fleet drain's pass to name, never fails the stop.
      try { await coordinator.releaseGoneWorkerReservations(); } catch { /* the stop's result stands */ }
      const preservationReapRequired = waiter.preserveTurn === true && !preservation
        && handle?.localAuthority === true;
      if ((governanceInvalid || preservationReapRequired) && handle) {
        // The interrupt confirmation settles the semantic operation as failed. Transport reap
        // is a distinct kill transaction with its own request/confirmation and cleanup proof.
        coordinator._beginStop(handle, 'kill', undefined, 'policy', { rule: KILL_RULES.preservationUnproven }).then((killResult) => {
          coordinator._resolveStopRequests(waiter, {
            ...result, escalation: killResult?.result ?? 'unknown',
          });
        }, () => {
          coordinator._resolveStopRequests(waiter, { ...result, escalation: 'unknown' });
        });
      } else {
        coordinator._resolveStopRequests(waiter, result);
      }
      coordinator._dispatchPass();
    }, (error) => {
      const preservationFailed = error?.code === 'progress_preservation_failed';
      if (handle && waiter.mode === 'kill') {
        coordinator._settleTransportDeath(handle, coordinator._tasks.get(handle.taskId), stopEvent);
      }
      coordinator._resolveStopRequests(waiter, {
        ok: false, result: preservationFailed ? 'preservation_failed' : 'cleanup_failed',
      });
      coordinator._stopWaiters.delete(workerId);
    });
}
