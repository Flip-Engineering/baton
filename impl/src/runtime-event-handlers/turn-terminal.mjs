// runtime-event-handlers/turn-terminal.mjs — issue #259, slice 14. The
// _handleEvent switch's turn-terminal arms (lifecycle.turn_completed / lifecycle.crashed /
// lifecycle.exited), verbatim over the dispatcher's ctx record. Recording through the port;
// receiver explicit; no sibling family imports.

import { PROVIDER_FAULT_CODES } from '../provider-faults.mjs';
import {
  KILL_RULES, TERMINAL_TASK_STATUSES, boundedProcessObservation, deepFreeze, typedTerminalCode,
} from '../runtime-recovery.mjs';

/** Issue #572: at every turn end the seat's orchestrator is woken with the turn's report. The
 * delivery rides the participant runtime extension the swarm access registered for this run
 * (swarm-native-access.mjs → SwarmRuntime.reportTurnEnd): a seat with a parent delivers through
 * the guidance path, a seat with none is addressed to the root. A run with no extension (a
 * non-swarm run, a bare fixture) reports to no one. Delivery runs off the terminal seam's own
 * authority and its failure is recorded, never silent. */
function reportTurn(coordinator, ctx, event, report) {
  const participantRuntime = coordinator._participantRuntimes?.get(ctx.handle.runId);
  if (typeof participantRuntime?.onTurnCompleted !== 'function') return;
  coordinator._trackAuthorityPromise(() => Promise.resolve().then(() => participantRuntime.onTurnCompleted({
    workerId: ctx.workerId, turnSeq: event.seq, turnEpoch: ctx.turnEpoch, report,
    assignmentDone: participantRuntime.isDone?.() === true,
  })), true).catch((error) => coordinator._recordOperationFailure(
    'swarm.turn_report_delivery_failed', ctx.handle, 'turn_report_delivery_failed', error,
    { turnSeq: event.seq }));
}

export function turnCompleted(coordinator, recorder, ctx) {
// Adapters may wrap the WorkerResult as { result } (MockAdapter) or emit it directly
        // (coordinator.test). Normalize so the logged claim and the gate both see the WorkerResult.
        const wr = (ctx.payload && ctx.payload.result !== undefined && ctx.payload.status === undefined) ? ctx.payload.result : ctx.payload;
        // BD3-D: a completed turn is a member-terminal transition — mint the attention wake
        // (coalescing with distribution, memberState terminal-at-mint). Reads and nudges never
        // answer this; the driver's own stall machinery is untouched (the D5 pin).
        if (wr?.status === 'completed') {
          coordinator._mintMemberTerminal(ctx.handle, coordinator._tasks.get(ctx.handle.taskId), wr);
        }
        const sealVerdict = coordinator._validateTerminalUsageSeal(ctx.handle, ctx.payload?.usageSeal ?? null);
        const terminalEvent = ctx.appendAttributed({
          worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor,
          payload: sealVerdict.seal ? { ...wr, usageSeal: sealVerdict.seal } : wr,
        });
        const participantRuntime = coordinator._participantRuntimes?.get(ctx.handle.runId);
        reportTurn(coordinator, ctx, terminalEvent, wr);
        // D2 blk-5 / C4: the turn-terminal seam clears the liveness marker (a zombie flag would
        // hold liveness forever and make rung-3 reap impossible).
        ctx.handle.turnInFlight = false;
        coordinator._clearWatchdog(ctx.handle);
        if (!sealVerdict.ok) {
          coordinator._failTerminalProviderGovernance(ctx.handle, terminalEvent, sealVerdict.code);
          return
        }
        if (sealVerdict.seal) {
          ctx.handle.providerTerminalSeal = sealVerdict.seal;
          if (ctx.handle.providerTurn) ctx.handle.providerTurn.sealed = true;
        }
        // A provider-native failed/blocked result is terminal evidence, never a claim eligible
        // for repository capture and hub verification. Verification proves the candidate tree;
        // it cannot transmute a failed provider turn (or an unchanged passing base) into success.
        if (wr?.status !== 'completed') {
          // #295 item 2: a transient transport fault is re-driven in place — as a new turn on the
          // same session and worktree — BEFORE any kill is considered, under the member's
          // declared turn budget. A retry that was admitted owns the turn; a fault that is not
          // transient (a quota refusal), a transport that is already gone, or a spent budget
          // falls through to the ordinary settlement below.
          if (coordinator._queueTransientProviderTurnRetry(ctx.handle, terminalEvent, wr, coordinator._tasks.get(ctx.handle.taskId))) return
          coordinator._failProviderResult(ctx.handle, terminalEvent, wr);
          return
        }
        // REFLEX-1 live finding (decision-live-2026-07-22, w-144): the emulated blocking
        // decision channel is turn-ending by construction — the worker asks, the hub parks the
        // task input_required, and THEN the provider's result frame arrives as an ordinary
        // completed turn. A turn that ends with a blocking interaction STILL PENDING (unsettled)
        // has by definition not produced its final diff, so the trust gate must not evaluate it
        // (required_effect_absent killed the gated worker before the orchestrator could
        // answer). Deferral, never exemption: the post-settlement continuation turn faces the
        // gate. The guard keys on an actually-pending record — a turn that completes DURING
        // answer delivery (record resolving/resolved, e.g. elicitation-style questions, CK2/CK8
        // phase11) is a completed result and must verify normally.
        {
          const task = coordinator._tasks.get(ctx.handle.taskId);
          const parkedUnsettled = task?.status === 'input_required'
            && [...coordinator._pending.values()].some((record) => record.worker === ctx.handle.id && record.state === 'pending');
          if (parkedUnsettled) return
        }
        // Issue #31 §2.1(1)-(2), as revised 2026-09-12: a 'pausable' card's completed turn is a
        // CHECKPOINT, not an implicit claim — the trust gate does not dispatch, no gate event is
        // written, and (native-completion-loop) the coordinator does not self-drive the pause
        // either: no policy nudge, no window, no expiry verdict. A 'claim' card (the default —
        // every card without the field) never reaches this branch and falls straight through to
        // the pre-existing gate below, byte-identically to before. A driven and an un-driven
        // checkpoint are now identical: both park visibly for an explicit `claim_turn` (the real
        // verifier) or `nudge_turn` (a real continuation). Issue #572: the park is never silent —
        // reportTurn above woke the seat's orchestrator with this turn's report, and a seat that
        // declared its assignment complete parks no longer: its turn faces the gate below and its
        // worker is retired when the gate settles.
        {
          const task = coordinator._tasks.get(ctx.handle.taskId);
          // A turn can legally end AFTER its task was already terminalized (run stop, fleet
          // drain, a provider turn landing post-cancellation). Parking a terminal task is
          // impossible by TRANSITIONS and would throw `terminal` out of transitionTask — so skip
          // the pause entirely and fall through, mirroring the interaction family's own
          // `if (task && TERMINAL_TASK_STATUSES.has(task.status)) break;` precedent.
          if (task && !TERMINAL_TASK_STATUSES.has(task.status)
            && participantRuntime?.isDone?.() !== true
            && coordinator._turnCompletionOf(ctx.handle) === 'pausable') {
            const settled = coordinator._admitPauseRecord(ctx.handle, task, terminalEvent, wr, ctx.appendAttributed);
            if (!settled) return
          }
        }
        if (coordinator._drainState === 'open' && ctx.handle.status !== 'stopping' && ctx.handle.status !== 'dead') {
          const releaseAuthority = coordinator._acquireAuthorityOp();
          // Adapters are required to consume worktreeReady, but terminal authority must remain
          // correct even for a native/test adapter that emits completion before that promise's
          // bookkeeping callback runs. Never capture through the logical placeholder path.
          Promise.resolve(ctx.handle.worktreeReady).then(() => coordinator._runTrustGate(ctx.handle, wr))
            .then(() => {
              if (participantRuntime?.isDone?.() === true
                && !['stopping', 'dead', 'exited'].includes(ctx.handle.status)) {
                coordinator._stopInBackground(ctx.handle, 'kill', KILL_RULES.terminalObservation);
              }
            })
            .catch((error) => coordinator._recordTrustGateEscape(ctx.handle, error))
            .finally(releaseAuthority);
        }
}

export function crashed(coordinator, recorder, ctx) {
ctx.handle.turnInFlight = false;
        coordinator._clearWatchdog(ctx.handle);
const sealVerdict = coordinator._validateTerminalUsageSeal(ctx.handle, ctx.payload?.usageSeal ?? null);
        const terminalEvent = ctx.appendAttributed({
          worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor,
          payload: sealVerdict.seal ? { ...ctx.payload, usageSeal: sealVerdict.seal } : ctx.payload,
        });
        // Issue #572: a crashed turn is a turn end — the orchestrator is woken with the failure
        // report exactly as for a completed turn. A crash landing after the turn already settled
        // (turnWasTerminal) reported at that settlement and does not report twice.
        if (!ctx.turnWasTerminal) reportTurn(coordinator, ctx, terminalEvent,
          { ...ctx.payload, status: 'failed' });
        // #295: the crash cert is a provider-shaped payload — the adapter types the same fault and
        // the same bounded detail (route, reset instant) it typed on the turn, so a rate-limited
        // death that arrives as a dead transport still reads with its class, its route and its
        // reset time instead of as an anonymous exit.
        const crashFault = coordinator._providerFaultOf(ctx.payload);
        ctx.handle.terminalCause ??= deepFreeze({
          kind: 'provider_failure',
          code: crashFault?.code ?? typedTerminalCode(ctx.payload?.code, 'provider_crashed'),
          ...(crashFault?.detail ? { detail: crashFault.detail } : {}),
        });
        // A quota refusal is a fact about the ROUTE however the transport died: the route is
        // blocked for the next recruit until the instant the provider itself named.
        if (crashFault?.code === PROVIDER_FAULT_CODES.quota) {
          coordinator._recordProviderQuotaBlock(ctx.handle, crashFault, coordinator._tasks.get(ctx.handle.taskId));
        }
        if (!sealVerdict.ok) coordinator._failTerminalProviderGovernance(ctx.handle, terminalEvent, sealVerdict.code);
        if (sealVerdict.seal) {
          ctx.handle.providerTerminalSeal = sealVerdict.seal;
          if (ctx.handle.providerTurn) ctx.handle.providerTurn.sealed = true;
        }
        const task = coordinator._tasks.get(ctx.handle.taskId);
        const failActiveTask = task && !TERMINAL_TASK_STATUSES.has(task.status)
          && task.status !== 'verifying' && !ctx.turnWasTerminal;
        // #201 durable member retry: a death-cert crash under retry authority parks the task
        // retry_pending (evidence-bound, never failed) so the successor incarnation can resume
        // by the cert's handle. Authority OFF (default) settles failed exactly as before.
        const deathCert = {
          exitCode: ctx.payload?.exitCode ?? null, signal: ctx.payload?.signal ?? null,
          ...(typeof ctx.payload?.sessionId === 'string' && ctx.payload.sessionId.length > 0
            ? { sessionId: ctx.payload.sessionId } : {}),
          ...(typeof ctx.payload?.sessionFile === 'string' && ctx.payload.sessionFile.length > 0
            ? { sessionFile: ctx.payload.sessionFile } : {}),
        };
        const resumeHandle = typeof deathCert.sessionId === 'string' ? deathCert.sessionId : null;
        const retryEligible = failActiveTask && coordinator._memberRetryAttempts !== null
          && (ctx.handle.memberRetries ?? 0) < coordinator._memberRetryAttempts;
        if (retryEligible) {
          ctx.handle.memberRetries = (ctx.handle.memberRetries ?? 0) + 1;
          if (resumeHandle) {
            ctx.handle.sessionRef = deepFreeze({ id: resumeHandle, persistence: 'native' });
          }
          const evidence = recorder.mapEvent(terminalEvent);
          const retryEvidence = evidence ? {
            ...evidence,
            deathCert: { ...deathCert },
            retry: { attempt: ctx.handle.memberRetries, of: coordinator._memberRetryAttempts },
          } : null;
          if (retryEvidence) coordinator._coordTransition(task, 'retry_pending',
            `task.retry_pending:${task.id}:${retryEvidence.coordinationSeq}`, retryEvidence);
          task.status = 'retry_pending';
        } else if (failActiveTask) {
          const evidence = recorder.mapEvent(terminalEvent);
          if (evidence) coordinator._coordTransition(task, 'failed', `task.failed:${task.id}:${evidence.coordinationSeq}`, evidence);
          if (!TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
        }
        // A turn crash does not normally prove transport death. A matching process_closed event
        // immediately before this crash does, so reap directly instead of arming an impossible
        // stop waiter for a child that can no longer emit kill.confirmed.
        if (ctx.handle.processRef?.state === 'closed' && !coordinator._stopWaiters.has(ctx.handle.id)) {
          ctx.handle.status = 'exited';
          coordinator._cleanupTransportInBackground(ctx.handle, task, terminalEvent);
        } else if (ctx.handle.status !== 'dead' && ctx.handle.status !== 'stopping') {
          coordinator._stopInBackground(ctx.handle, 'kill', KILL_RULES.providerCrash);
        }
}

export function exited(coordinator, recorder, ctx) {
const terminalEvent = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor, payload: ctx.payload });
        // Issue #572: an exit that ends the turn reports to the orchestrator like any turn end;
        // an exit after the turn already settled reported at that settlement.
        if (!ctx.turnWasTerminal) reportTurn(coordinator, ctx, terminalEvent,
          { ...ctx.payload, status: 'failed' });
        const task = coordinator._tasks.get(ctx.handle.taskId);
        const failActiveTask = task && !TERMINAL_TASK_STATUSES.has(task.status)
          && task.status !== 'verifying' && !ctx.turnWasTerminal;
        if (failActiveTask) {
          const evidence = recorder.mapEvent(terminalEvent);
          if (evidence) coordinator._coordTransition(task, 'failed', `task.failed:${task.id}:${evidence.coordinationSeq}`, evidence);
        }
        if (failActiveTask && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
        ctx.handle.turnInFlight = false;
        coordinator._clearWatchdog(ctx.handle);
        if (ctx.handle.processRef && ctx.handle.processRef.state !== 'closed') {
          ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: coordinator._safeTurnEpoch(ctx.handle), kind: 'lifecycle.process_attribution_refused', actor: 'policy', payload: boundedProcessObservation(ctx.event, 'terminal_without_process_close') });
          if (!['dead', 'stopping'].includes(ctx.handle.status)) coordinator._stopInBackground(ctx.handle, 'kill', KILL_RULES.processObservationRefused);
        } else if (!coordinator._stopWaiters.has(ctx.handle.id)) {
          if (ctx.handle.status !== 'dead') ctx.handle.status = 'exited';
          coordinator._cleanupTransportInBackground(ctx.handle, task, terminalEvent);
        }
}
