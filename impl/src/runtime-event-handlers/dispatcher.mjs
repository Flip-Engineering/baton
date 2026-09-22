// runtime-event-handlers/dispatcher.mjs — issue #259, slice 14. The _handleEvent
// reducer's spine: the prologue guards, the switch, the post-switch tail, and the
// dispatcher-local arms (the two stop-confirmation delegations and the default arm — too small
// to be modules). The 20 family arms live in the four sibling modules, called with
// (coordinator, recorder, ctx). ctx is the ONE mutable channel: every prologue local an arm
// reads, plus nativeObservationEvent — the only key an arm assigns (the resource.tokens and
// default arms), read by the tail. Recording routes through the recorder port.

import { ownedHarnessRetry, processReadyPayload } from '../process-lifecycle.mjs';
import { boundedProcessObservation, KILL_RULES, TERMINAL_TASK_STATUSES } from '../runtime-recovery.mjs';
import {
  compareWorkerPolicyObservation, normalizeWorkerPolicyObservation, workerPolicyObservationRequired,
} from '../worker-policy.mjs';
import {
  processStarted, processReady, processClosed, processReapUnconfirmed,
} from './process-lifecycle.mjs';
import { turnCompleted, crashed, exited } from './turn-terminal.mjs';
import {
  questionCancelled, questionAsked, approvalRequested, decisionRequested, interactionSettled,
} from './interaction.mjs';
import {
  resourceTokens, scratchpadWrite, contextRead, orientationRate, boardClaim, boardReport,
  messageSend, nativeSubagentObserved,
} from './observation-events.mjs';

export function handleEvent(coordinator, recorder, event, sourceVendor = null, opts = {}) {
    const { worker: workerId, kind, harness, turnEpoch, payload, actor } = event;
    const handle = coordinator._workers.get(workerId);
    if (!handle) return;
    if (sourceVendor !== null && handle.vendor !== sourceVendor) {
      recorder.log.append({
        worker: workerId,
        harness: coordinator._harnessOf(handle.vendor),
        turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'lifecycle.process_attribution_refused',
        actor: 'policy',
        payload: boundedProcessObservation(event, 'cross_adapter_worker', { sourceVendor, ownerVendor: handle.vendor }),
      });
      if (!['dead', 'stopping', 'exited'].includes(handle.status)) coordinator._stopInBackground(handle, 'kill', KILL_RULES.processObservationRefused);
      return;
    }
    if (actor === 'worker'
      && ['lifecycle.turn_completed', 'lifecycle.crashed', 'lifecycle.exited'].includes(kind)
      && handle.currentIncarnation !== true
      && ['closed', 'unconfirmed_after_restart'].includes(handle.processRef?.state)) {
      // Once controller recovery seals a historical process generation, its detached transport
      // may no longer contribute a terminal result. Exact process close/reap remains admissible,
      // but late provider completion is fenced before checkout or task state can be consulted.
      recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor),
        turnEpoch: coordinator._safeTurnEpoch(handle), kind: 'control.stale_rejected', actor: 'policy',
        ...coordinator._routeAttribution(handle),
        payload: {
          op: 'terminal', reason: 'recovered_process_generation_sealed',
          processGeneration: handle.processRef.generation,
        },
      });
      return;
    }
    if (actor === 'worker' && coordinator._worktreeAuthorityAvailable(handle) === false) {
      coordinator._failWorktreeAuthority(handle);
      // Process-terminal observations must still close exact process authority. All other
      // worker output is rejected once its checkout identity has disappeared.
      if (!['lifecycle.process_closed', 'lifecycle.process_reap_unconfirmed',
        'kill.confirmed', 'lifecycle.crashed', 'lifecycle.exited'].includes(kind)) return;
    }
    const turnWasTerminal = handle.turnTerminalObserved === true;
    if (actor === 'worker' && kind === 'lifecycle.spawned') {
      const providerId = payload?.threadId ?? payload?.sessionId;
      const processBound = handle.processRef !== null
        || (payload?.processGeneration !== undefined && payload?.pid !== undefined);
      const validProviderReady = !processBound || ((handle.processRef?.state === 'initializing'
        || ((opts.admittedReady === true || handle.turnAdmission)
          && (handle.processRef?.state === 'ready'
          || (handle.processRef?.state === 'unconfirmed_after_restart'
            && handle.recoveredProcessAuthority === true))))
        && payload?.processGeneration === handle.processRef.generation
        && payload?.pid === handle.processRef.pid
        && typeof providerId === 'string' && providerId.length > 0);
      // #199 (the double-spawn window): a second `lifecycle.spawned` whose wire identity does not
      // match the bound processRef is the harness RETRY the coordinator owns while its own spawn
      // is still being confirmed. It binds to the same member in the spawned arm below instead of
      // being refused — the phantom-failure class, where a member is verdict-failed while its
      // process keeps working orphaned.
      const ownedRetry = !validProviderReady && ownedHarnessRetry(handle, payload);
      if (!validProviderReady && !ownedRetry) {
        recorder.log.append({
          worker: workerId, harness, turnEpoch: coordinator._safeTurnEpoch(handle),
          kind: 'lifecycle.process_attribution_refused', actor: 'policy',
          payload: boundedProcessObservation(event, 'invalid_provider_ready'),
          ...coordinator._routeAttribution(handle),
        });
        if (!['dead', 'stopping', 'exited'].includes(handle.status)) coordinator._stopInBackground(handle, 'kill', KILL_RULES.terminalObservation);
        return;
      }
    }
    if (handle.turnAdmission && actor === 'worker' && ![
      'lifecycle.crashed', 'lifecycle.exited', 'kill.confirmed', 'lifecycle.process_started',
      'lifecycle.process_closed', 'worker_policy.observed',
    ].includes(kind)) {
      handle.turnAdmission.events.push(event);
      if (kind === 'lifecycle.spawned') {
        // Provider readiness is process telemetry even while recovery/follow-up admission is
        // transactional. Promote only the exact current PID here so a racing close can carry
        // ready:true; session identity, route observations, and turn effects remain buffered.
        const providerId = payload?.threadId ?? payload?.sessionId;
        if (handle.processRef?.state === 'initializing'
          && payload?.processGeneration === handle.processRef.generation
          && payload?.pid === handle.processRef.pid
          && typeof providerId === 'string' && providerId.length > 0) {
          const readyPayload = processReadyPayload(payload.processGeneration, payload.pid);
          recorder.log.append({
            worker: workerId, harness, turnEpoch, kind: 'lifecycle.process_ready', actor: 'policy',
            payload: readyPayload, ...coordinator._routeAttribution(handle),
          });
          handle.processRef = { ...handle.processRef, state: 'ready', ready: true };
        }
        handle.turnAdmission.resolveSpawned?.(event);
      }
      return;
    }

    if (actor === 'worker' && [
      'lifecycle.turn_completed', 'lifecycle.crashed', 'lifecycle.exited',
      'question.asked', 'question.cancelled', 'approval.requested', 'message.send',
    ].includes(kind)) {
      const currentEpoch = coordinator._safeTurnEpoch(handle);
      if (handle.wireEpochOffset == null && typeof turnEpoch === 'number') handle.wireEpochOffset = currentEpoch - turnEpoch;
      const normalizedEpoch = typeof turnEpoch === 'number' ? turnEpoch + (handle.wireEpochOffset ?? 0) : currentEpoch;
      const preservedEpochSealed = handle.sessionPreservation?.state === 'preserved'
        && Number.isSafeInteger(handle.preservedTurnEpoch)
        && normalizedEpoch <= handle.preservedTurnEpoch;
      if (normalizedEpoch < currentEpoch || preservedEpochSealed) {
        recorder.log.append({
          worker: workerId, harness, turnEpoch: currentEpoch, kind: 'control.stale_rejected', actor: 'policy',
          modelRequested: handle.modelRequested ?? null, modelResolved: handle.modelResolved ?? null, modelObserved: handle.modelObserved ?? null,
          payload: {
            op: ['lifecycle.turn_completed', 'lifecycle.crashed', 'lifecycle.exited'].includes(kind)
              ? 'terminal' : kind,
            attemptedTurnEpoch: normalizedEpoch, currentTurnEpoch: currentEpoch,
            ...(preservedEpochSealed ? {
              reason: 'preserved_turn_epoch_sealed', preservedTurnEpoch: handle.preservedTurnEpoch,
            } : {}),
          },
        });
        return;
      }
    }
    if (actor === 'worker' && kind === 'lifecycle.turn_started' && typeof turnEpoch === 'number') {
      const currentEpoch = coordinator._safeTurnEpoch(handle);
      if (handle.wireEpochOffset == null) handle.wireEpochOffset = currentEpoch - turnEpoch;
    }
    if (kind === 'lifecycle.turn_started') {
      handle.turnTerminalObserved = false;
      coordinator._clearBudgetStop(handle);
      // BD3-C: the worker's first turn_started in the SAME process generation marks prior
      // deliveries read. A respawned process (process_closed between delivery and now) does
      // NOT inherit its predecessor's reads — receipts are process-scoped honestly.
      const gen = coordinator._messageProcessGeneration.get(workerId) ?? 1;
      for (const record of coordinator._messages.values()) {
        const delivery = record.deliveries.get(workerId);
        if (delivery && delivery.generation === gen && !record.readBy.has(workerId)) {
          record.readBy.add(workerId);
        }
      }
    } else if (['lifecycle.turn_completed', 'lifecycle.crashed', 'lifecycle.exited'].includes(kind)) {
      handle.turnTerminalObserved = true;
      coordinator._clearBudgetStop(handle);
    }
    if (kind === 'lifecycle.process_closed') {
      // A process generation ends at process close; deliveries in the prior generation can
      // never be marked read by a turn in the new generation.
      coordinator._messageProcessGeneration.set(workerId, (coordinator._messageProcessGeneration.get(workerId) ?? 1) + 1);
    }

    if (kind === 'lifecycle.spawned' && actor === 'worker') {
      const nativeId = payload?.threadId ?? payload?.sessionId;
      if (typeof nativeId === 'string' && nativeId.length > 0) {
        handle.sessionRef = {
          vendor: handle.vendor,
          kind: payload?.threadId ? 'thread' : 'session',
          id: nativeId,
          persistence: coordinator._adapters[handle.vendor]?.card()?.sessions?.resume === 'native' ? 'native' : 'process',
          source: 'wire',
        };
        const refTask = coordinator._tasks.get(handle.taskId);
        if (refTask) refTask.sessionRef = handle.sessionRef;
      }
      if (handle.processRef?.state === 'initializing'
        && payload?.processGeneration === handle.processRef.generation
        && payload?.pid === handle.processRef.pid
        && typeof nativeId === 'string' && nativeId.length > 0) {
        handle.processRef = { ...handle.processRef, state: 'ready', ready: true };
      }
      // #199: bind the owned retry to the SAME member — the process identity advances to the
      // retry's exact coordinates, no new claim is minted, and the member keeps working.
      if (ownedHarnessRetry(handle, payload)
        && Number.isSafeInteger(payload?.pid) && Number.isSafeInteger(payload?.processGeneration)
        && (payload.pid !== handle.processRef?.pid
          || payload.processGeneration !== handle.processRef?.generation)) {
        if (payload.processGeneration > handle.processGeneration) handle.processGeneration = payload.processGeneration;
        handle.processRef = {
          generation: payload.processGeneration, pid: payload.pid,
          processGroupId: payload.processGroupId ?? payload.pid,
          state: 'initializing', ready: false, startedSeq: null, closedSeq: null,
        };
        handle.processAuthority = null;
        handle.recoveredProcessAuthority = false;
        handle.localAuthority = true;
      }
    }
    const policyObservationEvent = actor === 'worker'
      && (kind === 'worker_policy.observed' || (kind === 'lifecycle.spawned' && payload?.workerPolicyObserved));
    if (kind === 'worker_policy.observed') {
      const current = handle.processRef;
      const valid = actor === 'worker' && current
        && ['initializing', 'ready'].includes(current.state)
        && payload?.processGeneration === current.generation
        && payload?.pid === current.pid
        && payload?.processGroupId === current.processGroupId;
      if (!valid) {
        recorder.log.append({
          worker: workerId, harness, turnEpoch: coordinator._safeTurnEpoch(handle),
          kind: 'lifecycle.process_attribution_refused', actor: 'policy',
          payload: boundedProcessObservation(event, 'invalid_worker_policy_observation'),
          ...coordinator._routeAttribution(handle),
        });
        if (!['dead', 'stopping', 'exited'].includes(handle.status)) coordinator._stopInBackground(handle, 'kill', KILL_RULES.terminalObservation);
        return;
      }
    }
    if (policyObservationEvent) {
      const rawObservation = payload?.workerPolicyObserved;
      if (!handle.workerPolicyResolution) {
        coordinator._failWorkerPolicyObservation(handle, turnEpoch, [{
          axis: 'resolution', reason: 'unexpected_observation', expected: null, observed: 'present',
        }]);
        if (kind === 'worker_policy.observed') return;
      } else {
        let observation = null;
        let mismatches = null;
        try {
          observation = normalizeWorkerPolicyObservation(rawObservation);
          mismatches = compareWorkerPolicyObservation(handle.workerPolicyResolution, observation);
        } catch (error) {
          mismatches = [{
            axis: 'observation', reason: error?.code ?? 'worker_policy_observation_invalid',
            expected: handle.workerPolicyResolution.resolutionDigest, observed: null,
          }];
        }
        if (mismatches.length > 0) {
          coordinator._failWorkerPolicyObservation(handle, turnEpoch, mismatches, observation);
          if (kind === 'worker_policy.observed') return;
        } else {
          handle.workerPolicyObserved = observation;
          const policyTask = coordinator._tasks.get(handle.taskId);
          if (policyTask) policyTask.workerPolicyObserved = observation;
        }
      }
    }
    if (actor === 'worker' && kind === 'lifecycle.spawned' && handle.workerPolicyResolution
      && workerPolicyObservationRequired(handle.workerPolicyResolution)
      && !handle.workerPolicyObserved && !handle.workerPolicyMismatch) {
      coordinator._failWorkerPolicyObservation(handle, turnEpoch, [{
        axis: 'observation', reason: 'required_observation_missing',
        expected: handle.workerPolicyResolution.resolutionDigest, observed: null,
      }]);
    }
    if (actor === 'worker' && kind === 'lifecycle.turn_completed' && handle.workerPolicyResolution
      && workerPolicyObservationRequired(handle.workerPolicyResolution)
      && !handle.workerPolicyObserved && !handle.workerPolicyMismatch) {
      coordinator._failWorkerPolicyObservation(handle, turnEpoch, [{
        axis: 'observation', reason: 'required_observation_missing',
        expected: handle.workerPolicyResolution.resolutionDigest, observed: null,
      }]);
    }
    // Only adapter-mapped native lifecycle/usage metadata may establish provider identity.
    // Result/content/unknown worker payloads are untrusted and cannot forge a policy mismatch.
    const nativeObservation = actor === 'worker' && (kind === 'lifecycle.spawned' || kind === 'resource.tokens');
    const observedModel = nativeObservation ? (payload?.modelObserved ?? payload?.modelId ?? payload?.model) : null;
    if (typeof observedModel === 'string' && observedModel.length > 0) {
      handle.modelObserved = observedModel;
      const task = coordinator._tasks.get(handle.taskId);
      if (task) task.modelObserved = observedModel;

      const selection = coordinator._adapters[handle.vendor]?.card()?.modelSelection;
      const requestedAlias = selection?.acceptedAliases?.includes(handle.modelResolved);
      const legacyAliasObservation = requestedAlias && !handle.providerGovernance;
      if (handle.modelResolved && observedModel !== handle.modelResolved && !legacyAliasObservation && !handle.modelMismatch) {
        handle.modelMismatch = { requested: handle.modelResolved, observed: observedModel };
        const mismatchTask = coordinator._tasks.get(handle.taskId);
        if (mismatchTask) {
          mismatchTask.modelMismatch = handle.modelMismatch;
        }
        const mismatchEvent = recorder.log.append({
          worker: workerId, harness, turnEpoch, kind: 'model.mismatch', actor: 'policy',
          ...coordinator._routeAttribution(handle, mismatchTask),
          payload: { requested: handle.modelResolved, observed: observedModel, action: 'fail_and_kill' },
        });
        if (mismatchTask && !TERMINAL_TASK_STATUSES.has(mismatchTask.status)) {
          const evidence = recorder.mapEvent(mismatchEvent);
          coordinator._coordTransition(mismatchTask, 'failed', `task.failed:${mismatchTask.id}:${mismatchEvent.seq}`, evidence);
          mismatchTask.status = 'failed';
        }
        // Use the ordinary confirmed two-phase stop so process/worktree ownership remains live
        // until the adapter proves the mismatched session is gone.
        coordinator._stopInBackground(handle, 'kill', KILL_RULES.terminalObservation);
      }
    }
    // Only an adapter's explicitly mapped native lifecycle/usage observation is authoritative.
    // In particular, worker result/content fields named `effort` are untrusted prose/data.
    const observedEffort = nativeObservation ? payload?.effortObserved : null;
    if (typeof observedEffort === 'string' && observedEffort.length > 0) {
      handle.effortObserved = observedEffort;
      const effortTask = coordinator._tasks.get(handle.taskId);
      if (effortTask) effortTask.effortObserved = observedEffort;
      if (handle.effortResolved && observedEffort !== handle.effortResolved && !handle.effortMismatch) {
        handle.effortMismatch = { requested: handle.effortResolved, observed: observedEffort };
        const mismatchEvent = recorder.log.append({ worker: workerId, harness, turnEpoch, kind: 'effort.mismatch', actor: 'policy',
          ...coordinator._routeAttribution(handle, effortTask),
          payload: { requested: handle.effortResolved, observed: observedEffort, action: 'fail_and_kill' } });
        if (effortTask && !TERMINAL_TASK_STATUSES.has(effortTask.status)) {
          const evidence = recorder.mapEvent(mismatchEvent);
          coordinator._coordTransition(effortTask, 'failed', `task.failed:${effortTask.id}:${mismatchEvent.seq}`, evidence);
          effortTask.status = 'failed';
        }
        coordinator._stopInBackground(handle, 'kill', KILL_RULES.terminalObservation);
      }
    }
    const attribution = coordinator._routeAttribution(handle);
    const appendAttributed = (partial) => recorder.log.append({ ...partial, ...attribution });

    const ctx = { event, workerId, kind, harness, turnEpoch, payload, actor,
      handle, turnWasTerminal, appendAttributed, nativeObservationEvent: null };

    switch (kind) {
      case 'lifecycle.process_started': {
        processStarted(coordinator, recorder, ctx); break;
      }
      case 'lifecycle.process_ready': {
        processReady(coordinator, recorder, ctx); break;
      }
      case 'lifecycle.process_closed': {
        processClosed(coordinator, recorder, ctx); break;
      }
      case 'lifecycle.process_reap_unconfirmed': {
        processReapUnconfirmed(coordinator, recorder, ctx); break;
      }
      case 'resource.tokens':
        resourceTokens(coordinator, recorder, ctx); break;
      case 'lifecycle.turn_completed': {
        turnCompleted(coordinator, recorder, ctx); break;
      }
      case 'lifecycle.crashed': {
        crashed(coordinator, recorder, ctx); break;
      }
      case 'lifecycle.exited': {
        exited(coordinator, recorder, ctx); break;
      }
      case 'scratchpad.write': {
        scratchpadWrite(coordinator, recorder, ctx); break;
      }
      case 'context.read': {
        contextRead(coordinator, recorder, ctx); break;
      }
      case 'orientation.rate': {
        orientationRate(coordinator, recorder, ctx); break;
      }
      case 'board.claim': {
        boardClaim(coordinator, recorder, ctx); break;
      }
      case 'board.report': {
        boardReport(coordinator, recorder, ctx); break;
      }
      case 'message.send': {
        messageSend(coordinator, recorder, ctx); break;
      }
      case 'question.cancelled': {
        questionCancelled(coordinator, recorder, ctx); break;
      }
      case 'question.asked': {
        questionAsked(coordinator, recorder, ctx); break;
      }
      case 'approval.requested': {
        approvalRequested(coordinator, recorder, ctx); break;
      }
      case 'decision.requested': {
        decisionRequested(coordinator, recorder, ctx); break;
      }
      case 'question.answered':
      case 'approval.resolved':
      case 'decision.settled': {
        interactionSettled(coordinator, recorder, ctx); break;
      }
      case 'control.interrupt_confirmed':
        coordinator._onStopConfirmed(handle, 'interrupt', payload);
        break;
      case 'kill.confirmed':
        coordinator._onStopConfirmed(handle, 'kill', payload);
        break;
      case 'native.subagent_observed':
        nativeSubagentObserved(coordinator, recorder, ctx); break;
      default:
        ctx.nativeObservationEvent = appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
    }
    if (nativeObservation && ctx.nativeObservationEvent
      && ((typeof observedModel === 'string' && observedModel.length > 0) || (typeof observedEffort === 'string' && observedEffort.length > 0))) {
      const task = coordinator._tasks.get(handle.taskId);
      const evidence = recorder.mapEvent(ctx.nativeObservationEvent);
      recorder.recordDriver('route.observed', {
        taskId: task?.id ?? handle.taskId, workerId, ...coordinator._routeAttribution(handle, task), evidence,
      }, `driver.route_observed:${task?.id ?? handle.taskId}:${ctx.nativeObservationEvent.seq}`);
    }
    coordinator._observeWatchdogEvent(handle, event);
    // Issue #305: the mid-turn progress checkpoint observer rides the same live-only
    // observation point — construction replay never reaches `_handleEvent`.
    coordinator._observeTurnProgress(handle, event);
}
