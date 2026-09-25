// runtime-event-handlers/interaction.mjs — issue #259, slice 14. The _handleEvent
// switch's interaction arms (question.*, approval.*, decision.*), verbatim over the dispatcher's
// ctx record; the question.answered/approval.resolved/decision.settled group stays one function
// (the fall-through grouping is the member's own). isInteractionRequestId relocates with its only
// readers. Recording through the port; receiver explicit; no sibling family imports.

import { ValidationError, createDecisionRequest } from '../messages.mjs';
import { TERMINAL_TASK_STATUSES } from '../runtime-recovery.mjs';

function isInteractionRequestId(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

export function questionCancelled(coordinator, recorder, ctx) {
coordinator._bestEffort(coordinator._trackAuthorityPromise(() => coordinator._cancelNativeQuestion(ctx.workerId, ctx.payload?.requestId)), 'native_question_cancel');
}

export function questionAsked(coordinator, recorder, ctx) {
const requestId = ctx.payload?.requestId;
        if (!isInteractionRequestId(requestId)) {
          coordinator._refuseInteractionFrameId({ workerId: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, handle: ctx.handle, appendAttributed: ctx.appendAttributed, family: 'question', requestId });
          return
        }
        if (coordinator._drainState !== 'open') {
          const discarded = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'control.drain_interaction_discarded', actor: 'policy', payload: { requestId, kind: 'question' } });
          const task = coordinator._tasks.get(ctx.handle.taskId); const evidence = recorder.mapEvent(discarded);
          recorder.recordDriver('authority.cancelled', { taskId: task?.id ?? null, workerId: ctx.workerId, requestId, kind: 'question', reason: 'fleet_drain', evidence }, `driver.authority.cancelled:${ctx.workerId}:${requestId}:${discarded.seq}`, 'policy');
          coordinator._bumpInteractionGeneration(ctx.handle.taskId);
          return
        }
        // F4: a reused requestId (harness bug or malice) must never silently collapse two
        // requests into one record. Reject loudly at admission instead of overwriting.
        if (coordinator._pending.has(requestId)) {
          const rejected = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'control.duplicate_interaction_rejected', actor: 'policy', payload: { requestId, kind: 'question' } });
          const task = coordinator._tasks.get(ctx.handle.taskId); const evidence = recorder.mapEvent(rejected);
          recorder.recordDriver('authority.rejected', { taskId: task?.id ?? null, workerId: ctx.workerId, requestId, kind: 'question', reason: 'duplicate_request_id', evidence }, `driver.authority.rejected:${ctx.workerId}:${requestId}:${rejected.seq}`, 'policy');
          coordinator._bumpInteractionGeneration(ctx.handle.taskId);
          return
        }
        const askedEvent = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor, payload: ctx.payload });
        coordinator._bumpInteractionGeneration(ctx.handle.taskId);
        const task = coordinator._tasks.get(ctx.handle.taskId);
        if (task && TERMINAL_TASK_STATUSES.has(task.status)) return
        const record = {
          kind: 'question',
          worker: ctx.workerId,
          state: 'pending',
          resolution: null,
          consumer: null,
          turnEpochAtAsk: coordinator._safeTurnEpoch(ctx.handle),
          deadlineAt: null,
          // D3: mintedAt anchors the null-deadline default (effectiveDeadlineAt = mintedAt +
          // blockingInteractionTimeoutMs) entering _sweepDeadlines.
          mintedAt: coordinator._now(),
          acknowledged: false,
          escalated: false,
        };
        const evidence = recorder.mapEvent(askedEvent);
        if (ctx.payload?.blocking !== false) {
          if (task) {
            coordinator._coordTransition(task, 'input_required', `task.input_required:${task.id}:${askedEvent.seq}`, { ...evidence, interaction: { kind: 'question', requestId, blocking: true } });
          }
        } else {
          recorder.recordDriver('input.requested', { taskId: task?.id ?? null, workerId: ctx.workerId, kind: 'question', requestId, blocking: false, evidence }, `driver.input_requested:${ctx.handle.taskId}:${askedEvent.seq}`, ctx.actor ?? 'worker');
        }
        coordinator._pending.set(requestId, record);
        coordinator._activeInteractionIds.add(requestId);
        if (ctx.payload?.blocking !== false) {
          ctx.handle.status = 'blocked';
          ctx.handle.pendingQuestionId = requestId;
          if (task) task.status = 'input_required';
        }
}

export function approvalRequested(coordinator, recorder, ctx) {
const requestId = ctx.payload?.requestId;
        if (!isInteractionRequestId(requestId)) {
          coordinator._refuseInteractionFrameId({ workerId: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, handle: ctx.handle, appendAttributed: ctx.appendAttributed, family: 'approval', requestId });
          return
        }
        if (coordinator._drainState !== 'open') {
          const discarded = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'control.drain_interaction_discarded', actor: 'policy', payload: { requestId, kind: 'approval' } });
          const task = coordinator._tasks.get(ctx.handle.taskId); const evidence = recorder.mapEvent(discarded);
          recorder.recordDriver('authority.cancelled', { taskId: task?.id ?? null, workerId: ctx.workerId, requestId, kind: 'approval', reason: 'fleet_drain', evidence }, `driver.authority.cancelled:${ctx.workerId}:${requestId}:${discarded.seq}`, 'policy');
          coordinator._bumpInteractionGeneration(ctx.handle.taskId);
          return
        }
        if (coordinator._pending.has(requestId)) {
          const rejected = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'control.duplicate_interaction_rejected', actor: 'policy', payload: { requestId, kind: 'approval' } });
          const task = coordinator._tasks.get(ctx.handle.taskId); const evidence = recorder.mapEvent(rejected);
          recorder.recordDriver('authority.rejected', { taskId: task?.id ?? null, workerId: ctx.workerId, requestId, kind: 'approval', reason: 'duplicate_request_id', evidence }, `driver.authority.rejected:${ctx.workerId}:${requestId}:${rejected.seq}`, 'policy');
          coordinator._bumpInteractionGeneration(ctx.handle.taskId);
          return
        }
        const askedEvent = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor, payload: ctx.payload });
        coordinator._bumpInteractionGeneration(ctx.handle.taskId);
        const task = coordinator._tasks.get(ctx.handle.taskId);
        if (task && TERMINAL_TASK_STATUSES.has(task.status)) return
        const record = {
          kind: 'approval',
          worker: ctx.workerId,
          state: 'pending',
          resolution: null,
          consumer: null,
          turnEpochAtAsk: coordinator._safeTurnEpoch(ctx.handle),
          // #598 F09: no approval timer — the request stays pending for its decision maker;
          // denial is the result of an actual decision.
          deadlineAt: null,
        };
        const evidence = recorder.mapEvent(askedEvent);
        if (ctx.payload?.blocking !== false) {
          if (task) {
            coordinator._coordTransition(task, 'input_required', `task.input_required:${task.id}:${askedEvent.seq}`, { ...evidence, interaction: { kind: 'approval', requestId, blocking: true } });
          }
        } else {
          recorder.recordDriver('input.requested', { taskId: task?.id ?? null, workerId: ctx.workerId, kind: 'approval', requestId, blocking: false, evidence }, `driver.input_requested:${ctx.handle.taskId}:${askedEvent.seq}`, ctx.actor ?? 'worker');
        }
        coordinator._pending.set(requestId, record);
        coordinator._activeInteractionIds.add(requestId);
        if (ctx.payload?.blocking !== false) {
          ctx.handle.status = 'blocked';
          ctx.handle.pendingApprovalId = requestId;
          if (task) task.status = 'input_required';
        }
}

export function decisionRequested(coordinator, recorder, ctx) {
// Part B (issue #16): the emulated up-channel admits a decision request from untrusted
        // worker prose. Malformed payloads never mint a pending record (F7 spoof-safety) — the
        // closed-shape check happens BEFORE any admission side effect.
        const requestId = ctx.payload?.requestId;
        let request;
        try {
          request = createDecisionRequest(ctx.payload?.request);
        } catch (err) {
          if (!(err instanceof ValidationError)) throw err;
          // Decision 5 (the split): an oversize question is NOT scanner-null — it reaches this
          // admission seam and draws the typed, coaching refusal carrying {cap, actual, unit,
          // gracefulPath} (never merely malformed_request strings — the ground-truth-5 leak).
          const coaching = Number.isSafeInteger(err?.cap) && Number.isSafeInteger(err?.actual);
          const rejected = ctx.appendAttributed({
            worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'control.malformed_interaction_rejected',
            actor: 'policy',
            payload: coaching
              ? {
                  requestId: requestId ?? null, kind: 'decision',
                  reason: err.code ?? 'malformed_request',
                  cap: err.cap, actual: err.actual, unit: err.unit ?? 'bytes',
                  gracefulPath: err.gracefulPath, message: (err.errors ?? []).join('; '),
                }
              : { requestId: requestId ?? null, kind: 'decision', errors: err.errors },
          });
          const task = coordinator._tasks.get(ctx.handle.taskId); const evidence = recorder.mapEvent(rejected);
          recorder.recordDriver('authority.rejected', {
            taskId: task?.id ?? null, workerId: ctx.workerId, requestId: requestId ?? null, kind: 'decision',
            reason: coaching ? (err.code ?? 'malformed_request') : 'malformed_request', evidence,
          }, `driver.authority.rejected:${ctx.workerId}:${requestId ?? rejected.seq}:${rejected.seq}`, 'policy');
          coordinator._bumpInteractionGeneration(ctx.handle.taskId);
          return
        }
        if (!isInteractionRequestId(requestId)) {
          coordinator._refuseInteractionFrameId({ workerId: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, handle: ctx.handle, appendAttributed: ctx.appendAttributed, family: 'decision', requestId });
          return
        }
        if (coordinator._drainState !== 'open') {
          const discarded = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'control.drain_interaction_discarded', actor: 'policy', payload: { requestId, kind: 'decision' } });
          const task = coordinator._tasks.get(ctx.handle.taskId); const evidence = recorder.mapEvent(discarded);
          recorder.recordDriver('authority.cancelled', { taskId: task?.id ?? null, workerId: ctx.workerId, requestId, kind: 'decision', reason: 'fleet_drain', evidence }, `driver.authority.cancelled:${ctx.workerId}:${requestId}:${discarded.seq}`, 'policy');
          coordinator._bumpInteractionGeneration(ctx.handle.taskId);
          return
        }
        if (coordinator._pending.has(requestId)) {
          const rejected = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'control.duplicate_interaction_rejected', actor: 'policy', payload: { requestId, kind: 'decision' } });
          const task = coordinator._tasks.get(ctx.handle.taskId); const evidence = recorder.mapEvent(rejected);
          recorder.recordDriver('authority.rejected', { taskId: task?.id ?? null, workerId: ctx.workerId, requestId, kind: 'decision', reason: 'duplicate_request_id', evidence }, `driver.authority.rejected:${ctx.workerId}:${requestId}:${rejected.seq}`, 'policy');
          coordinator._bumpInteractionGeneration(ctx.handle.taskId);
          return
        }
        // Bidirectional v2 rule 4: one pending decision per worker at admission. Defense-in-depth
        // behind the adapter's one-live-request discipline so handle.pendingDecisionId can never
        // hide a second record (R-BD-4). Covers pending AND resolving (answer-in-flight).
        {
          const existingDecision = ctx.handle.pendingDecisionId
            ?? [...coordinator._pending.entries()].find(([, rec]) => (
              rec.kind === 'decision' && rec.worker === ctx.workerId
              && (rec.state === 'pending' || rec.state === 'resolving')
            ))?.[0]
            ?? null;
          if (existingDecision) {
            const rejected = ctx.appendAttributed({
              worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch,
              kind: 'control.decision_already_pending_rejected', actor: 'policy',
              payload: {
                requestId, kind: 'decision', reason: 'decision_already_pending',
                pendingRequestId: existingDecision,
              },
            });
            const task = coordinator._tasks.get(ctx.handle.taskId); const evidence = recorder.mapEvent(rejected);
            recorder.recordDriver('authority.rejected', {
              taskId: task?.id ?? null, workerId: ctx.workerId, requestId, kind: 'decision',
              reason: 'decision_already_pending', pendingRequestId: existingDecision, evidence,
            }, `driver.authority.rejected:${ctx.workerId}:${requestId}:${rejected.seq}`, 'policy');
            coordinator._bumpInteractionGeneration(ctx.handle.taskId);
            return
          }
        }
        const askedEvent = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor, payload: { requestId, request } });
        coordinator._bumpInteractionGeneration(ctx.handle.taskId);
        const task = coordinator._tasks.get(ctx.handle.taskId);
        if (task && TERMINAL_TASK_STATUSES.has(task.status)) return
        // F6: v1 decisions are always blocking (the gating-deadlock break); there is no
        // non-blocking decision admission path.
        const record = {
          kind: 'decision',
          worker: ctx.workerId,
          state: 'pending',
          resolution: null,
          consumer: null,
          turnEpochAtAsk: coordinator._safeTurnEpoch(ctx.handle),
          // #598 F09: the decision stays pending without a declared lifetime; an
          // operator-declared deadlineMs is honored.
          deadlineAt: Number.isSafeInteger(request.deadlineMs) ? coordinator._now() + request.deadlineMs : null,
          options: request.options,
          allowFreeResponse: request.allowFreeResponse,
          question: request.question,
          recommended: request.recommended,
        };
        const evidence = recorder.mapEvent(askedEvent);
        if (task) {
          coordinator._coordTransition(task, 'input_required', `task.input_required:${task.id}:${askedEvent.seq}`, { ...evidence, interaction: { kind: 'decision', requestId, blocking: true } });
        }
        coordinator._pending.set(requestId, record);
        coordinator._activeInteractionIds.add(requestId);
        ctx.handle.status = 'blocked';
        ctx.handle.pendingDecisionId = requestId;
        if (task) task.status = 'input_required';
}

export function interactionSettled(coordinator, recorder, ctx) {
const resolvedEvent = ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor, payload: ctx.payload });
        coordinator._bumpInteractionGeneration(ctx.handle.taskId);
        const task = coordinator._tasks.get(ctx.handle.taskId);
        // KG-1 Part A rule 3: decisionSettleCount is a strict subset of interactionGeneration's
        // kinds — approvals/questions resolving does not feed wave-level learning (docs/34 §4).
        if (ctx.kind === 'decision.settled') coordinator._bumpDecisionSettleCount(task?.runId ?? null);
        if (task && recorder.coordination?.task(task.id)?.status === 'input_required') {
          const evidence = recorder.mapEvent(resolvedEvent);
          coordinator._coordTransition(task, 'working', `task.working:${task.id}:${resolvedEvent.seq}`, evidence, ctx.actor ?? 'worker');
        }
}
