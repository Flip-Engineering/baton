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
