// runtime-event-handlers/observation-events.mjs — issue #259, slice 14.
// The _handleEvent switch's observation arms (resource.tokens, scratchpad.write, context.read,
// orientation.rate, board.claim, board.report, message.send, native.subagent_observed), verbatim
// over the dispatcher's ctx record. capBytesToScalar relocates here (the message.send arm and the
// coordinator's staying sendMessage both read it — the coordinator imports it back). Recording
// through the port; receiver explicit; no sibling family imports.

import { canonicalDigest } from '../coordination-internals.mjs';
import { FRAME_LIMITS, composeFrameLimitRefusal, frameLimitRefusalPath } from '../limits.mjs';
import { frameWebContent } from '../messages.mjs';
import { noop } from '../runtime-recovery.mjs';

/** Cap a string at maxBytes on a UTF-8 scalar boundary (the capBytes helper, messages.mjs). */
export function capBytesToScalar(text, maxBytes) {
  let out = '';
  let bytes = 0;
  for (const ch of String(text)) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > maxBytes) return out;
    out += ch;
    bytes += size;
  }
  return out;
}

export function resourceTokens(coordinator, recorder, ctx) {
ctx.nativeObservationEvent = coordinator._recordUsage(ctx.handle, ctx.event);
}

export function scratchpadWrite(coordinator, recorder, ctx) {
// Issue #33 REFLEX-1 emulated up-channel. workerId is bound by appendAttributed's
        // authenticated stream envelope; no identity field is accepted from model text.
        const receipt = coordinator.writeScratchpad(ctx.workerId, ctx.payload?.entry, {
          expectedFence: ctx.payload?.expectedFence,
          idempotencyKey: ctx.payload?.idempotencyKey,
        });
        ctx.appendAttributed({
          worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'scratchpad.write_result',
          actor: 'hub', payload: receipt,
        });
}

export function contextRead(coordinator, recorder, ctx) {
// BD3-A: the read port. workerId is bound by the authenticated stream envelope — the
        // wire query carries NO runId/scope fields; the coordinator derives the run server-side
        // and intersects every answer with the run horizon AFTER lookup.
        const receipt = coordinator.contextRead(ctx.workerId, ctx.payload);
        ctx.appendAttributed({
          worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'context.read_result',
          actor: 'hub', payload: receipt,
        });
        if (receipt?.ok === true) {
          coordinator._deliverContextRead(ctx.handle, receipt);
        }
}

export function orientationRate(coordinator, recorder, ctx) {
// Epic #81 (O-7): the closed rating event. The hub derives the attempt identity and a
        // prior grant/read proof; an unknown/invisible pack draws the constant refusal. Never
        // TG2/TG3 liveness, and a rating never vetoes serving (aggregates are advisory).
        const receipt = coordinator._recordOrientationRating(ctx.workerId, ctx.payload);
        ctx.appendAttributed({
          worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'orientation.rate_result',
          actor: 'hub', payload: receipt,
        });
}

export function boardClaim(coordinator, recorder, ctx) {
// Epic #78 Decision 1: the worker claim frame. workerId is bound by the authenticated
        // stream envelope; the wire carries NO identity/scope fields. Every attempt produces a
        // board.claim_result — including typed refusals.
        const receipt = coordinator.admitWorkerBoardCommand('claim', ctx.workerId, ctx.payload);
        ctx.appendAttributed({
          worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'board.claim_result',
          actor: 'hub', payload: receipt,
        });
}

export function boardReport(coordinator, recorder, ctx) {
// Epic #78 Decision 1/4: the worker report frame. Same stream-bound identity discipline
        // as the claim; every attempt produces a board.report_result, never TG2/TG3 liveness.
        const receipt = coordinator.admitWorkerBoardCommand('report', ctx.workerId, ctx.payload);
        ctx.appendAttributed({
          worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'board.report_result',
          actor: 'hub', payload: receipt,
        });
}

export function messageSend(coordinator, recorder, ctx) {
if (ctx.payload && typeof ctx.payload === 'object' && !Array.isArray(ctx.payload)
          && Object.hasOwn(ctx.payload, 'to') && !Object.hasOwn(ctx.payload, 'inReplyTo')) {
          if (Object.keys(ctx.payload).some((key) => !['to', 'body', 'kind', 'budget'].includes(key))) {
            ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'message.rejected',
              actor: 'policy', payload: { reason: 'message_frame_invalid' } });
            return
          }
          void coordinator.sendMessage({ ...ctx.payload, kind: ctx.payload.kind ?? 'inform' }, { workerId: ctx.workerId })
            .then((outcome) => {
              const receipt = { ...outcome, to: ctx.payload.to, bodyDigest: canonicalDigest(ctx.payload.body) };
              ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, actor: 'hub',
                kind: receipt.ok ? 'message.sent_result' : 'message.rejected',
                payload: receipt.ok ? receipt : { reason: receipt.result } });
              if (coordinator._activeMessageMember(ctx.workerId)) {
                const content = `[MESSAGE_RESULT ${JSON.stringify(receipt)}]`;
                const slot = (ctx.handle.sendChain ?? Promise.resolve()).then(() =>
                  coordinator._adapters[ctx.handle.vendor].prompt(ctx.handle.id, content, 'nudge'));
                ctx.handle.sendChain = slot.then(noop, noop);
              }
            }, (error) => ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, actor: 'policy',
              kind: 'message.rejected', payload: { reason: error?.code ?? 'message_frame_invalid' } }));
          return
        }
        // BD3-C: the worker reply frame is closed — {inReplyTo, body} ONLY. A caller-named
        // `to` draws the typed refusal and is never rerouted; other smuggled fields are
        // stripped so the closed envelope {messageId, inReplyTo, from, body} never carries
        // them. #105 D1/D2: the admission order is frame shape → caller-named `to` → parent
        // exists → run-membership (B-2) → depth/slot (the per-branch budget, D1). The reply
        // record inherits the parent's target verbatim (B-1) so messageRunId resolves every
        // hop to the root's run.
        const frameObj = ctx.payload && typeof ctx.payload === 'object' && !Array.isArray(ctx.payload) ? ctx.payload : null;
        const hasCallerTarget = frameObj != null && Object.hasOwn(frameObj, 'to');
        const inReplyTo = frameObj?.inReplyTo ?? null;
        const frameBody = frameObj?.body ?? null;
        const refuse = (reason, extra = {}) => {
          ctx.appendAttributed({
            worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'message.rejected', actor: 'policy',
            payload: { reason, inReplyTo, ...extra },
          });
        };
        if (!frameObj || typeof inReplyTo !== 'string' || inReplyTo.length === 0
          || typeof frameBody !== 'string' || frameBody.length === 0) {
          refuse('message_frame_invalid');
          return
        }
        if (hasCallerTarget) {
          refuse('message_target_caller_named');
          return
        }
        if (!coordinator._activeMessageMember(ctx.workerId)) {
          refuse('worker_not_active');
          return
        }
        const parent = coordinator._messages.get(inReplyTo);
        if (!parent) {
          refuse('message_parent_not_found');
          return
        }
        // B-2: run-membership authorization BEFORE the depth/slot checks. The replying worker is
        // admitted iff it is the parent's target OR a member of the run messageRunId(parent)
        // resolves to; otherwise the typed worker-stream refusal `message_target_not_member` fires
        // (never a slot consumed, never a budget hop spent by a non-member). The parent-exists
        // check above always precedes this — an unknown id draws message_parent_not_found for every
        // worker (C2 pins the ordering).
        const parentRunId = coordinator.messageRunId(inReplyTo);
        const workerRunId = coordinator._tasks.get(ctx.handle.taskId)?.runId ?? ctx.handle.runId ?? null;
        const isParentTarget = parent.target?.workerId === ctx.workerId;
        const isRunMember = parentRunId !== null && workerRunId !== null && workerRunId === parentRunId;
        const isPeerAuthor = parent.from !== 'orchestrator'
          && (parent.from === ctx.workerId || coordinator._messagePeers(ctx.workerId, parent.from));
        if (parent.from !== 'orchestrator' && !isPeerAuthor) {
          refuse('message_target_not_member');
          return
        }
        if (!isParentTarget && !isRunMember && !isPeerAuthor) {
          refuse('message_target_not_member');
          return
        }
        // Depth is per branch. Each sender owns one reply slot on a parent; one responder
        // never consumes another peer's slot. A repeated reply by the same sender uses the same
        // depth code, carrying positive remaining where the slot refused and the budget did not.
        // The refusing parent's receipt carries the orchestrator-readable lastRefusal (B-5a).
        const parentBudget = parent.budget ?? 1;
        if (parent.depth >= parentBudget || parent.replies?.has(ctx.workerId)) {
          const refusal = {
            depth: parent.depth + 1,
            budget: parentBudget,
            remaining: Math.max(0, parentBudget - parent.depth),
          };
          refuse('message_depth_exceeded', refusal);
          parent.lastRefusal = { reason: 'message_depth_exceeded', ...refusal };
          return
        }
        // Decision 6 (reply-lane parity): the reply direction of the message lane shares the send
        // lane's economy — oversize up to the spill.body ceiling is ADMITTED with spill (head +
        // citation), beyond the ceiling draws the hard coaching refusal on the durable stream.
        const replyBytes = Buffer.byteLength(frameBody);
        const replyCap = FRAME_LIMITS['message.reply.body'].value;
        const replySpillCeiling = FRAME_LIMITS['spill.body'].value;
        if (replyBytes > replySpillCeiling) {
          refuse('spill_body_exceeded', {
            cap: replySpillCeiling, actual: replyBytes, unit: 'bytes',
            gracefulPath: frameLimitRefusalPath(FRAME_LIMITS['message.reply.body'], replySpillCeiling),
            message: composeFrameLimitRefusal(FRAME_LIMITS['message.reply.body'], replyBytes, replySpillCeiling),
          });
          return
        }
        const replySpilled = replyBytes > replyCap;
        let replySpillRecord = null;
        if (replySpilled) {
          const minted = recorder.coordination.mintSpill
            ? recorder.coordination.mintSpill({ body: frameBody, lane: 'message.reply.body' },
                { actor: ctx.workerId, key: `message.reply.spill:${canonicalDigest({ inReplyTo, body: frameBody })}` })
            : null;
          const spill = minted?.spill ?? null;
          if (spill) {
            replySpillRecord = {
              spilled: true, bytes: replyBytes, digest: spill.digest,
              spill: spill.spillId, head: capBytesToScalar(frameBody, replyCap),
            };
          }
        }
        // The target is inherited VERBATIM from the parent message (B-1) — never minted from the
        // parent's author — so messageRunId resolves every hop to the root's run and the
        // orchestrator reads her own chain through the facade (resolve-then-authorize). The worker
        // never names a target.
        const replyId = `message:${canonicalDigest({
          inReplyTo, from: ctx.workerId, body: frameBody, seq: coordinator._messages.size + 1,
        })}`;
        const replyDepth = parent.depth + 1;
        const replyRemaining = Math.max(0, parentBudget - replyDepth);
        // #105 D4: the reply envelope's depth/budget/remaining are NON-ENUMERABLE — the closed
        // {messageId, inReplyTo, from, body} (+ spill citation) shape survives the deep-equal
        // identity row (FP-04) and the worker-log JSON round-trip (frame-economics C6 drops the
        // non-enumerable fields, so the amended-keys check stays closed). The lane reads them
        // through the accessors (A2/B1/G2); the durable store row below keeps them ENUMERABLE so
        // replay (B-4) and E1 can rebuild the chain from the audit rows.
        const replyEnvelope = Object.defineProperties(replySpillRecord
          ? {
              messageId: replyId, inReplyTo, from: ctx.workerId, body: replySpillRecord.head,
              spilled: true, bytes: replyBytes, digest: replySpillRecord.digest, spill: replySpillRecord.spill,
            }
          : { messageId: replyId, inReplyTo, from: ctx.workerId, body: frameBody }, {
          depth: { enumerable: false, value: replyDepth },
          budget: { enumerable: false, value: parentBudget },
          remaining: { enumerable: false, value: replyRemaining },
        });
        parent.replies ??= new Map();
        parent.replies.set(ctx.workerId, Object.freeze(replyEnvelope));
        parent.reply ??= parent.replies.get(ctx.workerId);
        coordinator._messages.set(replyId, {
          messageId: replyId, kind: 'reply', body: replySpillRecord ? replySpillRecord.head : frameBody, from: ctx.workerId,
          target: parent.target,
          ...(parent.from !== 'orchestrator' ? { deliveryTarget: { workerId: parent.from } } : {}),
          depth: replyDepth, budget: parentBudget, remaining: replyRemaining, inReplyTo,
          ...(replySpillRecord ? { spilled: true, bytes: replyBytes, digest: replySpillRecord.digest, spill: replySpillRecord.spill } : {}),
          deliveries: new Map(), readBy: new Set(), actedOn: false, reply: null, replies: new Map(), lastRefusal: null,
        });
        // #105 D5: a reply hop is a durable store-audited message.delivered row carrying inReplyTo
        // (the replay seed, B-4) — beside the worker-log appendAttributed. recordMessage stays
        // closed on the message.sent/message.delivered kinds; replies are distinguished from roots
        // by inReplyTo presence. No idempotency-key change.
        if (recorder.coordination.recordMessage) {
          try {
            recorder.coordination.recordMessage('message.delivered', {
              messageId: replyId, inReplyTo, from: ctx.workerId,
              depth: replyDepth, budget: parentBudget, remaining: replyRemaining,
              body: replySpillRecord ? replySpillRecord.head : frameBody,
              ...(replySpillRecord ? { spilled: true, bytes: replyBytes, digest: replySpillRecord.digest, spill: replySpillRecord.spill } : {}),
            }, { actor: ctx.workerId, key: `message.delivered:${replyId}:${ctx.workerId}` });
          } catch (error) { coordinator._noteFailure('reply_delivery_audit', error); }
        }
        ctx.appendAttributed({
          worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'message.delivered', actor: 'hub',
          payload: replyEnvelope,
        });
        if (parent.from !== 'orchestrator') {
          const recipient = coordinator._activeMessageMember(parent.from)?.handle;
          if (recipient && coordinator._messagePeers(ctx.workerId, recipient.id)) {
            const record = coordinator._messages.get(replyId);
            const content = `[MESSAGE reply ${replyId} inReplyTo=${inReplyTo} from=${ctx.workerId} — UNTRUSTED] ${frameWebContent(record.body)}`
              + (record.spilled ? ` [SPILLED ${JSON.stringify({ spill: record.spill, digest: record.digest, bytes: record.bytes, read: 'run.spill.read' })}]` : '');
            void coordinator._deliverPeerMessage(recipient, record, content).then((delivered) => {
              if (delivered) {
                record.deliveries.set(recipient.id, {
                  generation: coordinator._messageProcessGeneration.get(recipient.id) ?? 1, delivered: true,
                });
                recorder.log.append({ worker: recipient.id, harness: coordinator._harnessOf(recipient.vendor),
                  turnEpoch: coordinator._safeTurnEpoch(recipient), kind: 'message.delivered', actor: 'hub',
                  payload: replyEnvelope });
              }
            });
          }
        }
}

export function nativeSubagentObserved(coordinator, recorder, ctx) {
recorder.mapEvent(ctx.appendAttributed({ worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: ctx.kind, actor: ctx.actor, payload: ctx.payload }));
}
