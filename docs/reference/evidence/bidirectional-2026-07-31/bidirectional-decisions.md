# Bidirectional ergonomics contract — upward signals, decision gating, real-time wake (v2)

(v2 folds the codex red-team (`redteam-v1.md`, verdict **UNSOUND**, R-BD-1..9). The decisive
correction: v1's core premise was FALSE — every live pause is ALREADY downstream of a
completed `WorkerResult` (non-completed results route to `_failProviderResult` before the
pause path, `coordinator.mjs:10482-10521`), so "parked-working" has no production path and
absence-of-claim carried no meaning; worse, replay reconstructs pauses WITHOUT the result
(`coordinator.mjs:11232-11247`), so the claim bit as designed would flip meaning across a
restart. v2 makes the claim DURABLE: an explicit pause-origin field in the `turn.paused`
event payload. Also folded: exact sanitized summary shape (R-BD-2), the onDecision callback
lifecycle (R-BD-3), one-pending-decision admission (R-BD-4), disposition tombstones for
exactly-once expiry (R-BD-5), a named one-shot follow API with cancellation/cursor laws
(R-BD-6), one ordered per-member reducer that controls BOTH rendering and steering
(R-BD-7), a full adversarial red-row battery (R-BD-8), and citation + surface-fence repairs
(R-BD-9). v1 is retained below as the fold trail.)

## Rules (v2)

1. **The claim is durable, derived only from the pause-origin field.** The `turn.paused`
   event payload gains `origin: {kind: 'turn_completed', resultStatus: 'completed', summary}`
   minted at `_admitPauseRecord` time, sanitized AT MINT (rule 2's exact pipeline), so replay
   reconstructs it byte-for-byte and the projection never depends on the in-memory record.
   `pausedTurnStatus` and the `turn_checkpoint` attention entry carry `claim:
   {status: 'completed', summary}` ONLY when the durable payload carries the origin field —
   pre-v2 events lack it and honestly project no claim. Honest taxonomy (R-BD-1): every live
   `turn_checkpoint` is a completed-result claim candidate; "parked-working" does not exist
   and is deleted from the vocabulary. `claimTurn` still re-runs the live trust gate (claim
   is gate input, never proof); a claim after restart works from the durable origin; a
   dangling pause on a recovered/terminal handle projects no checkpoint steering (the W93-2
   `not_paused` refusal taxonomy already guards the acts); crash-after-pause and watchdog
   action mint no new park kinds (crash-after-pause races cleanup per
   `coordinator.mjs:10534-10565`; the watchdog only interrupts/kills, :7859-7893).
2. **The summary shape and sanitize order are pinned.** Exactly:
   `summary: wrapProse(workerId, boundedAttentionText(workerResult.summary, 240))` — 240
   bounds the wrapped object's `text` field; redaction BEFORE truncation (a credential-shaped
   token must match the redactor before any byte cut); UTF-8 scalar boundaries respected (no
   sliced code points); ONE shared sanitizer (the `messages.mjs:410-438` scalar-aware helper
   with `wrapProse`'s `{provenance:'model-authored', untrusted:true}` wrapper,
   `messages.mjs:367-377`). Empty/missing summaries project `summary: null`, never `''`.
   The total RunView byte ceiling applies after the addition.
3. **Decision gating has a closed callback lifecycle.** `policy.onDecision` is explicitly
   async and awaited; invoked AT MOST ONCE per `(runId, requestId)` (no retry policy in v2);
   its return is validated against the closed union `{optionId} | {text} | undefined` — an
   invalid return is recorded as evidence, never answered. A callback throw is caught and
   recorded as evidence; the interaction stays attention-required; the wave NEVER closes or
   supersedes a pending decision because a callback failed (the `finally` close behavior is
   unchanged — but a callback throw is not a loop exit). Answers ride the member's own
   `run.answer` (`application-client.mjs:1163-1170`; command implementation
   `application.mjs:11245-11264`) with ONE normalized driver outcome union covering
   application exceptions (`application_interaction_not_found`), coordinator results
   (`already_resolved`, `invalid_answer`, `stale_discarded`, `delivery_refused`), and adapter
   throws — recorded in the driver evidence per request.
4. **One pending decision per worker, enforced at admission.** Decision admission
   (`coordinator.mjs:10695-10754`) refuses a worker that already has a pending decision with
   a durable typed rejection (`decision_already_pending`) — defense-in-depth behind the
   adapter's own one-live-request discipline (`claude-session.mjs:952-955`), so the singular
   `handle.pendingDecisionId` projection can never hide a second record (R-BD-4's reentrancy
   hole). The driver's callbacks are serialized per member, request-ID-scoped deduped, and
   follow a fresh status read after every answer.
5. **Disposition tombstones make expiry observable and exactly-once.** The run view gains a
   bounded `decisionSettled` projection (last N per run, N≤8) of `{requestId, disposition:
   answered|expired|superseded|stale_discarded, at}` derived from the durable
   `decision.settled`/`decision.expired` events (`coordinator.mjs:9029-9033,9074-9103`) — an
   answered decision and an expired one are never conflated, and a local clock is never
   consulted (answer and expiry share a single-consumer race, :9070-9079). The driver prints
   exactly one disposition line per `(runId, requestId)`, deduped on the durable event
   cursor — across reattach within one driver invocation (wave-lifetime dedup beyond one
   invocation is NOT claimed).
6. **The wake rides ONE named one-shot API with cancellation and cursor laws.** New facade
   method `run.followOnce({afterCursor, timeoutMs, signal})` riding the existing
   `run.follow` command (`application.mjs:7535-7607`, with its filtering caveat: unrelated
   events return only on backlog/terminal/timeout) — NOT the `changes()` iterator (which
   wakes immediately on its initial inspection and would spin, `application-client.mjs:911-949`).
   Wait-cycle law: retain the cursor from each member's status read; exclude terminal
   members; race the poll timer against ONE follow per live member; abort and AWAIT all
   losers (active-follow count returns to zero every cycle); advance each cursor through
   `follow.throughCursor` even when changes are empty (never rescan the same page, never
   spin on the old cursor); only target changes (checkpoint/decision/terminal) end the sleep
   early — unrelated backlog continues against the remaining interval;
   `application_follow_unavailable` or cancellation downgrades to the plain sleep ONCE per
   member with one evidence line (never fatal, never retried in a loop).
7. **One ordered per-member reducer controls BOTH rendering and steering.** Precedence:
   pending blocking interaction (`answer_decision`/`answer_question`/`answer_approval`,
   stable requestId order) > `checkpoint+claim` > `checkpoint` > `working`. Distinct progress
   classes for question/approval (they are not folded into `decision`). A member with ANY
   pending blocking interaction is suppressed from nudge AND claim for that poll — the
   reducer's output is the steering input, not just a label (R-BD-7's nudge-through-gate
   hole). Multiple pending interactions surface in stable requestId order, first one gated.
8. **No authority moves, with the surface fence stated.** v2 changes only existing
   RunView/direct-read projections and the embedded `createWaveDriver` policy surface. It
   does NOT register `decision.list`, add aliases/profiles/surfaces, or create portable-wave
   grammar (S-3/S-1 own those, per the sibling control-surface v2 contract); `onDecision` is
   an embedded-driver callback only (no CLI/MCP/Web promotion). The pause state machine,
   trust gate, decision records' semantics, and answer authority are otherwise untouched.

## Red-first tests — `impl/test/bidirectional-driver-red.test.mjs` (v2 battery)

1. **BD-1 (durable claim):** a completed-park fixture carries `origin` in the durable
   `turn.paused` payload; `pausedTurnStatus` + the attention entry project
   `claim.status === 'completed'` with the pinned wrapped/bounded summary; a pre-v2-shaped
   event (no origin) projects NO claim; after a simulated restart the claim survives
   byte-for-byte; `claimTurn` re-runs the live gate from the durable origin.
2. **BD-2 (sanitize pipeline):** credential-shaped summary text is redacted BEFORE bounding
   (planted secret-shaped line never appears, even split across the 240 cut); a unicode
   boundary is never sliced mid-scalar; empty summary projects `null`; the wrapper carries
   `untrusted: true`; the RunView byte ceiling holds.
3. **BD-3 (callback lifecycle):** async onDecision awaited; fired exactly once per
   `(runId, requestId)` across polls; `{optionId}` resolves through `run.answer` (durable
   `decision.settled` — the exact event name); `undefined` leaves attention-required; an
   invalid return and a callback throw are each recorded as evidence with the interaction
   still pending and the wave unclosed; the normalized outcome union covers an
   `application_interaction_not_found` exception and each coordinator refusal.
4. **BD-4 (one-pending admission):** a second `DECISION_REQUEST` while one is pending is
   refused `decision_already_pending` durably (the first survives visible); a decision raised
   DURING answer delivery does not lose the first record; per-member callback serialization
   holds under reentrancy.
5. **BD-5 (tombstones):** answered and expired decisions appear in `decisionSettled` with
   distinct dispositions; the driver prints exactly one disposition line per requestId across
   polls AND across a simulated reattach; answer-at-deadline races the expiry sweep and the
   durable outcome (not the local clock) decides the printed disposition.
6. **BD-6 (wake laws):** a decision park during the wait wakes the loop before
   `pollIntervalMs` (wall-clock asserted); unrelated coordination traffic does NOT end the
   sleep early (it continues against the remaining interval); active-follow count returns to
   zero every cycle (instrumented); cursors advance monotonically through `throughCursor` on
   empty pages; `application_follow_unavailable` downgrades once per member with one evidence
   line; terminal members are excluded from follows.
7. **BD-7 (reducer precedence):** a member with both a checkpoint and a pending decision is
   classified `decision` and is NOT nudged or claimed that poll; question/approval classify
   distinctly; multiple pending interactions surface in stable requestId order; a member
   with no interaction and a claim-checkpoint is claimed at the next poll WITHOUT waiting
   for the unproductive budget (the treadmill is for unproductive checkpoints, not claims).
8. **BD-8 (no regression):** L6's budget still terminates an unproductive checkpoint streak;
   nudge dedup per requestId holds; the stall clock and hard cap behave as before
   (wave-driver-policy-red D1–D10 stay green).

Deterministic: MockAdapter/PausableAdapter fixtures (decision script rows,
`adapter.mjs:590-610`), fixed clocks, instrumented wait/AbortSignal fixtures, no live
providers.

## Verification

```text
node --test impl/test/bidirectional-driver-red.test.mjs impl/test/wave-driver-policy-red.test.mjs impl/test/wave-driver-red.test.mjs impl/test/wave-attach-red.test.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v2)

Worker↔worker sharing ergonomics (S-2/S-3); cross-harness decision grammar (Claude-only
scanning is a separate adapter epic); SSE/timeline expansion; `decision.list` registration
or any surface addition (S-3/S-1 fence, rule 8); `wait_turn` driver policy; orchestrator-side
scratchpad elevation; wave-lifetime dedup beyond one driver invocation (rule 5 names the
scope); any change to who may raise or answer interactions.

---

# Bidirectional ergonomics contract — upward signals, decision gating, real-time wake (v1)

(Seed: operator directive 2026-07-31 — "the downstream workers must have the means to provide
reflexive/interactive messaging to the orchestrator… posit a user-question style decision
upwards and gate/await the orchestrator's response before proceeding"; plus the standing
receipt that parked-done vs parked-working is "the single most expensive recurring
orchestration failure mode" (issue #51, the 118-epoch and 153-epoch treadmills). Parent
issues: #51 (upward state feedback), #10 (AX spine), #16-class decision channel (reflex1).
Grounding: full seam inventory 2026-07-31 (explore subagent, file:line-cited). Sibling
contract: control-surface v2 owns conformance/dead-paths; S-2/S-3 own authority moves — this
contract moves NO authority boundary: it is projection + driver ergonomics only.)

## Ground truth

1. **Parked-done is projection-identical to parked-working (#51, the spine).** A pausable
   worker's completed turn parks with its `workerResult` stored on the pause record
   (`coordinator.mjs:2006`, kept so a later `claimTurn` re-runs the SAME trust-gate call,
   :2277-2284) — and then `pausedTurnStatus` deliberately withholds it (:2046-2050) and the
   `turn_checkpoint` attention entry carries only
   `{kind, workerId, taskId, turnEpoch, changedPathsDigest, requestId}`
   (`application.mjs:7102-7109`). The wave driver's only done-signal is the L6
   unchanged-digest treadmill (`wave-driver.mjs:316-325`): nudge, watch nothing change, budget
   out, maybe claim. A worker that SAID it was done (its terminal frame's
   `workerResult.status === 'completed'`, `claude-session.mjs:1007-1015`) sits through
   118-153 nudge epochs while the driver cannot tell.
2. **A decision-parked member is invisible to the shipped wave driver.** The run phase stays
   `running`→`working` (task `input_required`; the legacy phase string never reaches a run
   view — `application-semantics.mjs:45` vs the phase ladders), the driver's only extractor is
   `checkpointOf` (`wave-driver.mjs:134-138`, `turn_checkpoint`-only), so no pause list entry,
   no nudge, no claim, no callback. The attention ARRAY does carry the full
   `answer_decision` item (`projectDecisionAttention`, `application.mjs:337-357` — question,
   options, allowFreeResponse, recommended, requestId) and `wave.progress()` passes it through
   raw (`wave.mjs:107-127`), but the driver bypasses `wave.progress()` and reads `status()`
   directly. The decision then auto-EXPIRES at its own `deadlineMs`
   (`coordinator.mjs:2502-2503, 9074-9103`) and the driver reads the flip back to `working` as
   ordinary liveness. The orchestrator never learns the question was asked.
3. **The decision deadline is enforced but never projected.** `deadlineAt` is recorded
   (`coordinator.mjs:10739`) and swept, but `projectDecisionAttention` drops it — an
   orchestrator cannot prioritize by urgency and only learns about expiry via
   `stale_discarded`/`already_resolved` refusals.
4. **Polling is not the only wake path — the driver just doesn't use the other one.**
   `run.follow` long-polls on the coordination log and returns the full cloned view (attention
   array included) on any event after the cursor (`application.mjs:7535-7607`); a decision
   park mints `task.transitioned` → `input_required`, which passes the follow category filter
   (:7373-7398). The driver sleeps `pollIntervalMs` instead (`wave-driver.mjs:403`).
5. **Answering from a wave is fully wired but unmodeled.** `run.answer(requestId, {optionId|text})`
   works end-to-end (`application-client.mjs:1163`; dispatch `application.mjs:10954-10966`;
   coordinator refusals `not_found`/`already_resolved`/`invalid_answer`/`stale_discarded`);
   `wave.runs.get(role)` exposes the member handle (`wave.mjs:484-486`). Nothing in the wave
   layer knows what a requestId is.

## The question

Does the wave driver gain first-class upward-signal ergonomics — a worker's completion claim
and pending decisions surfaced, classified, and answerable through the driver's own callbacks —
or does every orchestrator keep re-deriving (or missing) signals that are already projected
one layer below? This contract picks the ergonomics, on evidence that the raw material is
already in the views and only the driver's extractors and two projection fields are missing.

## Rules

1. **The claim bit rides the checkpoint (#51 fold).** `pausedTurnStatus` and the
   `turn_checkpoint` attention entry gain a bounded, sanitized `claim` field when the parked
   turn's `workerResult.status === 'completed'`: `{status: 'completed', summary}` with summary
   bounded (≤240 bytes, prose-wrapped untrusted per the existing attention posture). No claim
   field at all for non-completed parked turns (absence IS the distinction — never a
   `claim: null` that re-blurs the line). The trust gate is untouched: claim remains gate
   INPUT, never proof; `claimTurn` still re-runs the live gate.
2. **The driver classifies upward signals, never raw-arrays them.** A sibling extractor
   beside `checkpointOf` extracts decision/question/approval attention
   (`answer_decision`/`answer_question`/`answer_approval`) from the same status view the
   driver already hashes. Per-member progress lines classify: `decision` (with question
   excerpt), `checkpoint+claim` (parked-done), `checkpoint` (parked-working), `working`.
   A member awaiting a decision NEVER prints as bare `working` again.
3. **Decision gating is a first-class driver callback.** `policy.onDecision({role, runId,
   requestId, question, options, allowFreeResponse, recommended, expiresInMs})` fires when a
   member parks at a decision. The callback's return value — `{optionId}`, `{text}`, or
   `undefined` (orchestrator still thinking) — is answered through the member's own
   `run.answer` path with the full refusal taxonomy surfaced to the callback's caller (an
   `already_resolved`/`stale_discarded` is a normal outcome, never a driver crash). A driver
   with no `onDecision` policy surfaces decisions in progress output and treats them as
   attention-required (never nudges past them, never lets them silently expire without one
   progress line naming the expiry).
4. **`deadlineAt` is projected.** `projectDecisionAttention` gains `deadlineAt` (ISO) and the
   driver computes `expiresInMs`; semantic-action targets and `decisionList` carry the same.
   Bounded, additive, never removing an existing field.
5. **The driver's wait is wake-capable.** The poll sleep races a per-member `run.follow`
   continuation (cursor from the same status read); a decision park, checkpoint, or terminal
   transition wakes the loop within the follow's return, capped by `pollIntervalMs` as the
   outer bound (never an unbounded hang — follow's own timeoutMs applies). Where the profile
   disables follow (`followPolicy.mode !== 'enabled'`), the driver falls back to the plain
   sleep and says so once in evidence.
6. **No authority moves.** Projection additions are additive and sanitized; the pause state
   machine, trust gate, decision records, and answer path are untouched; nothing here changes
   who may answer (the existing approve-capability path) or what a worker may raise.

## Red-first tests — `impl/test/bidirectional-driver-red.test.mjs`

1. **BD-1 (claim bit):** a pausable member whose scripted turn completes with
   `workerResult.status:'completed'` parks with `claim.status === 'completed'` and a bounded
   summary in BOTH `pausedTurnStatus` and the `turn_checkpoint` attention entry; a member
   parked mid-work carries NO claim field; `claimTurn` still re-runs the live trust gate
   (refusal path intact).
2. **BD-2 (classification):** driver progress lines classify decision-parked, parked-done
   (`checkpoint+claim`), parked-working, and working members distinctly — a decision-parked
   member never serializes as bare `working`.
3. **BD-3 (decision gating):** a member emitting `DECISION_REQUEST` fires `onDecision` with
   the full payload incl. `expiresInMs`; a callback returning `{optionId}` resolves the
   decision through `run.answer` (worker continues, `decision.resolved` durable); a callback
   returning `undefined` leaves it pending and the driver surfaces it attention-required; an
   expired decision produces exactly one expiry progress line and no driver crash.
4. **BD-4 (deadline projection):** `projectDecisionAttention` and `decisionList` carry
   `deadlineAt`; the semantic action target carries it too; pre-existing fields unchanged.
5. **BD-5 (wake):** with follow enabled, a decision park during the poll sleep wakes the loop
   before `pollIntervalMs` elapses (assert wall-clock); with follow disabled, the driver
   sleeps the interval and records the fallback once.
6. **BD-6 (no regression):** the L6 treadmill still terminates a parked-WORKING member
   (claim-absent) by budget; a parked-DONE member is claimed at the next poll WITHOUT waiting
   for the unproductive budget (the treadmill is for workers, not for claims).

Deterministic: MockAdapter/PausableAdapter fixtures (decision script rows exist,
`adapter.mjs:599-610`), fixed clocks, no live providers.

## Verification

```text
node --test impl/test/bidirectional-driver-red.test.mjs impl/test/wave-driver-policy-red.test.mjs impl/test/wave-driver-red.test.mjs impl/test/wave-attach-red.test.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v1)

- Worker↔worker sharing ergonomics (boards/packages/REPL/knowledge surfacing — S-2/S-3
  contracts); cross-harness decision grammar (DECISION_REQUEST scanning is Claude-only,
  `claude-session.mjs:66` — a separate adapter epic); SSE/timeline expansion
  (`run-timeline.mjs` whitelist); MCP/web surfacing of the new fields beyond the additive
  projection (they ride existing views); `wait_turn` driver policy; orchestrator-side
  scratchpad elevation (S-3); any change to who may raise or answer interactions.
