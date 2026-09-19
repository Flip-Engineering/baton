// runtime-effects.mjs — issue #259, slice 9 (first tranche). The coordinator effect members the
// seam map names first (§3 rows 6/9/10): _dispatch, _spawnPlanWave, _resolveRecord. Bodies are the
// members' own with two explicit boundary parameters — the coordinator receiver and the injected
// recorder port (slice 6) — and every recording act routes through the port: the operational log
// (recorder.log.append), evidence mapping (recorder.mapEvent), driver records (recorder.recordDriver)
// and every coordination-store call (recorder.coordination.*). One-way: this module never imports
// the coordinator; the coordinator imports back the four relocated declarations below.


import { createHash } from 'node:crypto';
import { canonicalDigest } from './coordination-internals.mjs';
import { planBriefMatches } from './goal-plan.mjs';
import { createBrief } from './messages.mjs';
import { TERMINAL_TASK_STATUSES, typedTerminalCode } from './runtime-recovery.mjs';
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
    // pending native spawn, write one fixed non-leaking terminal fact, and still rethrow a typed
    // rejection to the adapter so it cannot fall through to the orchestrator cwd. A concurrent
    // stop retains terminal authority; the second reap handles partial creation that failed late.
    worktreeReady = worktreeReady.catch((cause) => {
      void cause;
      const failure = new Error('worktree unavailable');
      failure.name = 'WorktreeReadinessError';
      failure.code = 'worktree_unavailable';
      if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) {
        handle.spawnAbort.abort({ reason: failure.code });
      }
      const terminalized = coordinator._fatalError ? false : coordinator._onSpawnRefused(handle, task, harness, {
        ok: false, reason: failure.message, code: failure.code, [WORKTREE_FAILURE]: true,
      });
      if (!terminalized && task.sessionRequest?.mode === 'new' && task.workspaceAttachment !== true) coordinator._bestEffort(coordinator._removeOwnedTaskWorktree(handle, task), 'worktree_release');
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

