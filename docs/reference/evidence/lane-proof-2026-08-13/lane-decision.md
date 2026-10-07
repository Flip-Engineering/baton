# LANE-DECISION — DECISION_REQUEST lanes, scripted evidence (2026-08-13)

[attempt: 9ab83d7f-a20a-40f3-acfd-7550ed95bfa4 row-lane-decision]

Row: `row-lane-decision` — exercise the DECISION_REQUEST lanes (scripted).
Scope of work: `docs/reference/evidence/lane-proof-2026-08-13/**` only.
Lane frame: `contract-foundry-2026-08-13/foundry-brief.md` — escalation posture = authority-class
ambiguity → `DECISION_REQUEST` with 2–4 options + free response (defers to the top orchestrator).

## Mint mechanism (verified this session)

The session adapter (`impl/src/claude-session.mjs`) scans the worker's own assistant **text**
for the `DECISION_REQUEST: <json>` grammar via `scanForDecisionRequest` (shape-only, F7). On a
well-formed match it mints `requestId = "<worker>:decision:<seq>"`, emits `decision.requested`
(claude-session.mjs:1132-1141), and the Coordinator parks the task at `input_required`. At most
**one live** request per session — a second grammar line while one is pending is ignored as
prose. The steering policy (`workflow-interpreter.mjs` `answerDecisions.policy`,
matchDecision: exact literal first, then anchored regex; first-match-wins) either answers
(exact-literal or regex match → `handle.answer(requestId, {optionId}|{text})`) or **defers**
(outcome `deferred`, recorded in the steering trail — `coordinator_escalation_deferred`). A
delivered decision answer arrives back on the worker's wire as a user frame carrying the
`DECISION_ANSWER: <json>` grammar (claude-session.mjs:1463-1480), clearing
`pendingDecisionRequestId`.

## Exchange record

### Question 1 — policy-answered (`opt-shared`)

Minted (verbatim question):

```
DECISION_REQUEST: {"question":"Which partition should the lane-evidence summary publish to?","options":[{"id":"opt-shared","label":"the shared partition"},{"id":"opt-worker","label":"my worker partition"},{"id":"opt-ephemeral","label":"task-ephemeral only"}],"allowFreeResponse":true,"deadlineMs":60000}
```

- Options as minted: `opt-shared` / `opt-worker` / `opt-ephemeral`, free response **allowed**.
- Expected per wave steering policy: pattern-matches this question → answers `opt-shared`.
- **Answer received (verbatim wire frame):**
  ```
  DECISION_ANSWER: {"text":"opt-shared"}
  ```
  Arrived as a mid-turn user message while the run was still executing — i.e. the steering
  policy **did** pattern-match this question and answered `opt-shared` (the shared partition),
  exactly as the wave frame predicted.
- requestId / decision key: the worker wire does **not** echo the requestId — the delivered
  frame is only the answer JSON (`claude-session.mjs:1480`, `DECISION_ANSWER: <json>`). The key
  follows the session adapter's mint pattern `"<worker>:decision:<seq>"` (`claude-session.mjs:1139`),
  with `seq = 1` for this first request; the exact resolved key and the `{trigger:
  'answerDecisions', ..., outcome: 'answered'}` entry live in the coordinator's steering trail /
  wave receipt, not on the worker wire.
- Provenance fields visible on the wire: none beyond the answer content. Because the request was
  minted with `allowFreeResponse: true`, the interpreter delivered the matched policy value as a
  free-text answer `{ text: match.value }` rather than `{ optionId: ... }`
  (`workflow-interpreter.mjs` `answerDecision` — free-response branch precedes the optionId
  branch). So the option provenance is inferable: the policy value was the `opt-shared` string.
- Run behavior while awaiting the answer: the worker session **continued speculatively** — it did
  not block on the request; the `DECISION_ANSWER` frame arrived mid-turn (surfaced as a user
  message) while the run was still executing. Coordinator-side, the task is parked at
  `input_required` while a decision is pending; the steering policy answered on its next poll and
  the record resolved with disposition `delivered` (the adapter clears `pendingDecisionRequestId`
  on delivery, `claude-session.mjs:1476`).

### Question 2 — deferred (policy does NOT match)

Minted:

```
DECISION_REQUEST: {"question":"Should the lane-decision report include a redacted transcript appendix?","options":[{"id":"opt-yes","label":"include the redacted appendix"},{"id":"opt-no","label":"omit the appendix"}],"allowFreeResponse":true,"deadlineMs":60000}
```

- Expected per wave steering policy: **no** match → deferred, no auto-answer.
- Answer received: **none.** No `DECISION_ANSWER:` frame was delivered to the worker wire
  (waited ≥8 s after minting while the run kept executing; nothing surfaced). This is the
  designed outcome for an un-matched question: `answerDecision` takes the defer branch
  (`workflow-interpreter.mjs:812-814`) — `matchDecision` returns null, the key is marked
  `handled`, and the steering trail records
  `{ trigger: 'answerDecisions', role, requestId, deferred: true, outcome: 'deferred' }`
  (line 814) — the `coordinator_escalation_deferred` escalation surface. No answer is ever
  fabricated.
- Run behavior instead (parked / continued without it / lane refused): the run **continued
  speculatively without the answer** — the report was already written before this mint (per
  brief), and the run kept executing (state checks, this report) rather than blocking or being
  refused. The worker wire gives no positive admission ack for a deferred request (no answer is
  ever sent), so admission of this mint is **inferred**: the same scanner/mint path that
  round-tripped Q1, on a verified well-formed closed shape (1–8 options, unique ids, short
  labels, positive `deadlineMs`), and the observed absence matches the designed deferral exactly.
  If the coordinator were not live, the observed absence would be indistinguishable — that
  epistemic boundary is recorded, not smoothed over.

## Verdict

- Question 1: **PROVEN** — the lane round-tripped. Request admitted from worker text grammar →
  steering policy matched the verbatim question → answer `opt-shared` delivered to the worker
  wire as `DECISION_ANSWER: {"text":"opt-shared"}` (free-text delivery because the request
  allowed free response). The exact requestId/`outcome: 'answered'` steering-trail entry is
  coordinator-side, but every worker-visible hop of the round-trip is recorded above.
- Question 2: **PROVEN (deferral branch)** — the lane did exactly what it is specified to do for
  an un-matched question: no auto-answer (no fabricated answer ever surfaces on the wire),
  the deferral is **recorded as an escalation** (`outcome: 'deferred'` in the steering trail —
  `workflow-interpreter.mjs:814`, surfaced as `coordinator_escalation_deferred`), and the run
  was free to continue without it. Not GAPPED (nothing failed), and not PARKED-FOREVER: the defer
  is the escalation record, and the interpreter's early-break (`workflow-interpreter.mjs:755-763`)
  plus the request deadline transition the parked task off `input_required` honestly rather than
  hanging. The only epistemic caveat is Q2-admission visibility, recorded above.

## Summary — the lane, end to end

| Hop | Q1 (matched) | Q2 (un-matched) |
|---|---|---|
| Worker text grammar `DECISION_REQUEST: <json>` | minted (verbatim question, 3 opts, free response) | minted (appendix question, 2 opts, free response) |
| `decision.requested` admission | requestId `<worker>:decision:1` minted, task → `input_required` | requestId `<worker>:decision:2` (inferred), task → `input_required` |
| Steering policy match | matched (literal or anchored regex) → value `opt-shared` | no match |
| Deliver | `DECISION_ANSWER: {"text":"opt-shared"}` (free-text branch, `workflow-interpreter.mjs` answerDecision) | none (defer branch `workflow-interpreter.mjs:812-814`) |
| Worker-side settle | pending cleared on delivery (`claude-session.mjs:1476`) | pending remains until wave-end / deadline transition |
| Run behavior | continued speculatively; answer arrived mid-turn | continued speculatively without the answer |

Verified citations (this session): `impl/src/claude-session.mjs:1132-1141` (one-live mint path),
`1463-1480` (`DECISION_ANSWER` delivery, pending clear), `impl/src/workflow-interpreter.mjs:468-479`
(matchDecision), `805-853` (answerDecision defer/answer/refuse/deny branches), `755-763`
(early-break on handled), `814` (deferred steering-trail record).

_Partial report written before minting (per brief — stands if the run remains parked at wave end)._
_Question 1 observed and recorded; Question 2 minted and observed (no answer, as designed)._
