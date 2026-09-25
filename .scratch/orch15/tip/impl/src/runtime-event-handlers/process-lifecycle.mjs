// runtime-event-handlers/process-lifecycle.mjs — issue #259, slice 14. The
// _handleEvent switch's process-lifecycle arms (lifecycle.process_started / process_ready /
// process_closed / process_reap_unconfirmed), moved verbatim over the mutable ctx record the
// dispatcher threads (seam-slice-14-design.md §3). Recording routes through the recorder port;
// the coordinator receiver is explicit. One-way: family modules import no sibling family module.

import {
  processAuthorityPayload, validProcessClosedPayload, validProcessReadyPayload,
  validProcessReapUnconfirmedPayload, validProcessStartedPayload,
} from '../process-lifecycle.mjs';
import {
  KILL_RULES, TERMINAL_TASK_STATUSES, boundedProcessObservation, deepFreeze,
} from '../runtime-recovery.mjs';

export function processStarted(coordinator, recorder, ctx) {
const valid = ctx.actor === 'worker' && validProcessStartedPayload(ctx.payload)
          && ctx.handle.currentIncarnation === true && ctx.handle.localAuthority === true
          && (ctx.handle.nativeSpawnPending === true || ctx.handle.recoveryPending === true)
          && ctx.payload.generation === ctx.handle.processGeneration
          && (!ctx.handle.processRef || ctx.handle.processRef.state === 'closed' || ctx.handle.processRef.state === 'unconfirmed_after_restart');
        if (!valid) {
          ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: coordinator._safeTurnEpoch(ctx.handle), kind: 'lifecycle.process_attribution_refused', actor: 'policy', payload: boundedProcessObservation(ctx.event, 'invalid_process_start') });
          const lateCurrentStart = ctx.actor === 'worker' && validProcessStartedPayload(ctx.payload)
            && ctx.handle.currentIncarnation === true && ctx.payload.generation === ctx.handle.processGeneration
            && (!ctx.handle.processRef || ctx.handle.processRef.state === 'closed' || ctx.handle.processRef.state === 'unconfirmed_after_restart');
          if (lateCurrentStart) {
            // A spawn Ack promises that no later process start can occur. If an adapter violates
            // that boundary while this controller can still observe it, reacquire exact transport
            // ownership and require another two-phase kill plus correlated process close.
            ctx.handle.processRef = { generation: ctx.payload.generation, pid: ctx.payload.pid, processGroupId: ctx.payload.processGroupId, state: 'initializing', ready: false, startedSeq: null, closedSeq: null };
            ctx.handle.processAuthority = null;
            ctx.handle.recoveredProcessAuthority = false;
            ctx.handle.localAuthority = true;
            coordinator._stopInBackground(ctx.handle, 'kill', KILL_RULES.processObservationRefused);
          } else if (!['dead', 'stopping', 'exited'].includes(ctx.handle.status)) coordinator._stopInBackground(ctx.handle, 'kill', KILL_RULES.processObservationRefused);
          return
        }
        const started = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor, payload: ctx.payload });
        ctx.handle.processRef = { generation: ctx.payload.generation, pid: ctx.payload.pid, processGroupId: ctx.payload.processGroupId, state: 'initializing', ready: false, startedSeq: started.seq, closedSeq: null };
        ctx.handle.processAuthority = null;
        ctx.handle.recoveredProcessAuthority = false;
        const authorityPayload = processAuthorityPayload(ctx.handle.processRef);
        if (authorityPayload) {
          ctx.appendAttributed({
            worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch,
            kind: 'lifecycle.process_authority', actor: 'policy', payload: authorityPayload,
          });
          ctx.handle.processAuthority = { ...authorityPayload };
        }
}

export function processReady(coordinator, recorder, ctx) {
// Live parity with the replay case (14092): an adapter's exact contract-shaped
        // process_ready promotes the initializing processRef to ready — without it the later
        // process_closed exact-close validation (`payload.ready === current.ready`) can never
        // match for an adapter that reports readiness this way (omp), and every stop degrades
        // into attribution-refused noise. Adapters that promote via a threadId-carrying
        // spawned payload are untouched (the initializing-state gate makes this idempotent).
        const current = ctx.handle.processRef;
        const valid = ctx.actor === 'worker' && validProcessReadyPayload(ctx.payload) && current
          && current.state === 'initializing'
          && ctx.payload.generation === current.generation && ctx.payload.pid === current.pid
          && ctx.payload.processGroupId === current.processGroupId;
        if (!valid) {
          ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: coordinator._safeTurnEpoch(ctx.handle), kind: 'lifecycle.process_attribution_refused', actor: 'policy', payload: boundedProcessObservation(ctx.event, 'invalid_process_ready') });
          return
        }
        ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor, payload: ctx.payload });
        ctx.handle.processRef = { ...current, state: 'ready', ready: true };
}

export function processClosed(coordinator, recorder, ctx) {
const current = ctx.handle.processRef;
        const valid = ctx.actor === 'worker' && validProcessClosedPayload(ctx.payload) && current
          && ['initializing', 'ready', 'unconfirmed_after_restart'].includes(current.state)
          && ctx.payload.generation === current.generation && ctx.payload.pid === current.pid
          && ctx.payload.processGroupId === current.processGroupId
          && ctx.payload.ready === current.ready;
        if (!valid) {
          ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: coordinator._safeTurnEpoch(ctx.handle), kind: 'lifecycle.process_attribution_refused', actor: 'policy', payload: boundedProcessObservation(ctx.event, 'invalid_process_close') });
          if (!['dead', 'stopping', 'exited'].includes(ctx.handle.status)) coordinator._stopInBackground(ctx.handle, 'kill', KILL_RULES.processObservationRefused);
          return
        }
        const closed = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor, payload: ctx.payload });
        const preservationLost = ctx.handle.sessionPreservation?.state === 'preserved';
        ctx.handle.processRef = { ...current, state: 'closed', ready: ctx.payload.ready, closedSeq: closed.seq };
        ctx.handle.recoveredProcessAuthority = false;
        if (preservationLost) {
          const task = coordinator._tasks.get(ctx.handle.taskId);
          ctx.handle.sessionPreservation = null;
          ctx.handle.preservedTurnEpoch = null;
          ctx.handle.status = 'exited';
          ctx.handle.terminalCause ??= deepFreeze({
            kind: 'provider_failure', code: 'transport_closed_after_preservation',
          });
          if (task && !TERMINAL_TASK_STATUSES.has(task.status)) {
            const evidence = recorder.mapEvent(closed);
            coordinator._coordTransition(task, 'failed',
              `task.failed:${task.id}:transport_closed_after_preservation:${closed.seq}`, evidence);
            task.status = 'failed';
          }
        }
        coordinator._finishUntrustedTransportReap(ctx.handle, ctx.handle.processRef);
        const stopWaiter = coordinator._stopWaiters.get(ctx.handle.id);
        if (stopWaiter?.mode === 'kill') coordinator._maybeFinalizeStop(ctx.handle.id, stopWaiter);
        if (!stopWaiter && ctx.handle.status === 'dead' && ctx.handle.cleanupPending !== true) ctx.handle.localAuthority = false;
        if (!stopWaiter && ctx.handle.status === 'dead' && ctx.handle.cleanupPending === true && !ctx.handle.untrustedTransportReap) {
          coordinator._cleanupTransportInBackground(ctx.handle, coordinator._tasks.get(ctx.handle.taskId), closed);
        }
        if (!stopWaiter && !ctx.handle.untrustedTransportReap && preservationLost) {
          coordinator._cleanupTransportInBackground(ctx.handle, coordinator._tasks.get(ctx.handle.taskId), closed);
        } else if (!stopWaiter && !ctx.handle.untrustedTransportReap && ctx.turnWasTerminal
          && !['dead', 'stopping', 'orphaned'].includes(ctx.handle.status)) {
          ctx.handle.status = 'exited';
          coordinator._cleanupTransportInBackground(ctx.handle, coordinator._tasks.get(ctx.handle.taskId), closed);
        }
}

export function processReapUnconfirmed(coordinator, recorder, ctx) {
const current = ctx.handle.processRef;
        const valid = ctx.actor === 'worker' && validProcessReapUnconfirmedPayload(ctx.payload) && current
          && ['initializing', 'ready', 'unconfirmed_after_restart'].includes(current.state)
          && ctx.payload.generation === current.generation && ctx.payload.pid === current.pid
          && ctx.payload.processGroupId === current.processGroupId;
        if (!valid) {
          ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: coordinator._safeTurnEpoch(ctx.handle), kind: 'lifecycle.process_attribution_refused', actor: 'policy', payload: boundedProcessObservation(ctx.event, 'invalid_process_reap_unconfirmed') });
        } else {
          ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor, payload: ctx.payload });
          ctx.handle.processRef = { ...current, state: 'unconfirmed_after_restart' };
          ctx.handle.localAuthority = true;
        }
        coordinator._retryProcessReap(ctx.handle);
}
