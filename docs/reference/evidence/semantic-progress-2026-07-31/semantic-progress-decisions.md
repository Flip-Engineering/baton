# P1-C contract — semantic progress classification + "you must act" surfacing (v1)

(Seed: operator directive 2026-07-31 — "#10 AX spine: blocked_interaction classification +
attention surfacing (status() must surface 'you must act')"; the AX report's #1 friction:
"Ninety minutes lost to awaiting_plan_approval because status() doesn't surface 'you must
act' — an agent shouldn't have to know to call actions()". Parent: issue #10 (Phase 92.1),
scoped to its semantic-progress sub-item — the rest of #10 (pagination, help depth, doctor
cascade, flag placement, typed transitions) stays the release track. Grounding: the
control-surface inventory (agent-27) and the bidirectional seam map (agent-28), both
file:line-cited. Sibling: bidirectional v2 owns the wave-DRIVER reducer; this contract owns
the RUN-VIEW projections the driver and every other consumer reads.)

## Ground truth

1. **The timing projection exists but classifies nothing.** `_progressTiming`
   (`application.mjs:7441-7470`) computes `startedAt/observedAt/elapsedMs/lastProgress/
   silenceMs/completedAt` from the MEANINGFUL event filter (`_followCategory`, :7373-7398 —
   thought/tool telemetry already excluded), folded into the run outline and `runs.list`
   items. Nowhere does a `no_progress`/`rate_limited`/`meaningfulProgress` class exist
   (grep: zero hits) — an agent must derive liveness from raw `silenceMs` arithmetic, and
   every consumer sets its own thresholds.
2. **"You must act" is present but not addressable.** The outline carries `blockedInteraction`
   (one-line `{kind, summary}`, `projectBlockedInteraction`, `application.mjs:321-331`) and
   `runs.list` items carry it plus `attention: 'required'|'clear'` and `actions: [kinds]`
   (:10686-10716). What is missing is the DIRECT answer: WHICH action resolves the current
   attention — the top blocking attention item's act kind and target, in the status view
   itself, so an agent never has to enumerate `actions()` to learn "you must
   `approve_plan`/`answer_decision`/`nudge_turn`". The wave driver's
   `attentionFrom` (`wave.mjs:107-127`) already passes the raw array; `checkpointOf` and the
   bidirectional reducer consume subsets; nothing names the resolving action.
3. **The classification vocabulary is unowned.** `no_progress` and `rate_limited` are #10's
   named classes; rate-limit evidence exists in provider results (the claude session-limit
   receipt surfaced as a `content.message` + `provider_turn_failed`, 2026-07-31) — but no
   projection classifies it; a rate-limited run reads identically to a slow run.

## The question

Do the run view and run list name the semantic progress class and the resolving action —
one vocabulary, one projection — or does every consumer keep deriving (or missing) both?
This contract picks the projection, scoped to exactly these two additions.

## Rules

1. **`progressClass` on the run outline and `runs.list` items.** One closed enum, derived by
   ONE named reducer over existing projections (terminal phase/cause, attention array,
   meaningful-cadence from `_progressTiming`, provider error kinds in the run's own
   records): `terminal:<cause>` (terminal, cause verbatim) > `blocked_interaction` (any
   blocking attention item — the existing classification verbatim:
   `approve_plan|select_candidate|answer_required|turn_checkpoint|answer_decision…`) >
   `rate_limited` (the run's latest provider result classified
   `provider_rate_limited`/`authentication_refresh_required`-adjacent limit receipts — the
   classification rides the EXISTING provider-result taxonomy; if no such taxonomy row
   exists for a limit-shaped message, the class stays honest and never guesses from prose) >
   `no_progress` (non-terminal, no blocking attention, `silenceMs` ≥ the named threshold —
   one constant, documented, not per-consumer) > `progressing`. Basis fields ride along
   (`{silenceMs, meaningfulEventAt}`), never a bare label.
2. **`requiredAction` on the same views.** When (and only when) a blocking attention item
   exists: `{kind, actionId?, summary}` — the semantic action kind that resolves the TOP
   blocking item (stable attention order), its advertised `actionId` when one is advertised
   (so the agent can `run.act` directly), and the bounded summary. Absent otherwise (never
   null-stuffed). This is a PROJECTION of the existing semantic-action computation
   (`_semanticActions`, `application.mjs:9073-9103`) — no new actions, no new authority.
3. **One vocabulary, generated.** The `progressClass` enum and the attention classifications
   serialize identically on outline, list, wave progress rows, and the debug member leg
   (the DIAG-1 reducer consumes this vocabulary — no second classifier; DIAG-1's own
   contract is amended to reference this projection).
4. **No authority moves, no new events.** Both additions are read-side projections over
   records the hub already mints; thresholds are named constants; the vocabulary lands in
   the semantics registry's enum tables (with the conformance harness's enum-divergence
   check covering it, per the CS machinery).

## Red-first tests — `impl/test/semantic-progress-red.test.mjs`

1. **SP-1:** each `progressClass` boundary on scripted fixtures — terminal+cause verbatim;
   blocked_interaction with the exact classification; rate_limited ONLY from a classified
   provider-result row (a prose-looking limit message without the taxonomy row classifies
   `progressing`/`no_progress`, never guessed); no_progress at the threshold;
   progressing otherwise; basis fields present.
2. **SP-2:** `requiredAction` carries the resolving kind + advertised actionId + bounded
   summary for each blocking fixture (approve_plan, answer_decision with requestId,
   turn_checkpoint with pauseId); absent when attention is clear; executing the advertised
   actionId through `run.act` resolves the item (end-to-end, not just shape).
3. **SP-3:** vocabulary identity — outline, `runs.list` item, `wave.progress()` row, and the
   `run.debug` member leg serialize the SAME `progressClass`/`requiredAction` fields
   (conformance enum check green).
4. **SP-4:** no regression — timing fields unchanged; `blockedInteraction` one-liner
   unchanged; MAX_RUN_VIEW_BYTES ceiling holds with both additions present.

Deterministic: MockAdapter/PausableAdapter fixtures, fixed clocks, no live providers.

## Verification

```text
node --test impl/test/semantic-progress-red.test.mjs impl/test/wave-driver-red.test.mjs impl/test/issue53-run-debug-red.test.mjs
node impl/scripts/run-suite.mjs
```

## Explicit non-goals (v1)

#10's remaining release scope (runs pagination, help-depth honesty, doctor cascade, flag
placement, typed nudge/synthesize-now/preserve-and-resume transitions for rate-limit);
wave-driver steering changes (BD-B owns those); DIAG-1's state machine (amended to consume
this vocabulary, not redefined here); any provider-taxonomy extension beyond what the
existing rows classify.
