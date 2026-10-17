# REFLEX-1 decisions contract v2 — typed decision requests + settlement-integrity fixes

Ground truth: docs/32 §3.1, issue #16, issue #20 (settlement-integrity F1-F4), the red-team
report in this directory (reflex-redteam.md, findings F1-F14 — all apply). Code:
`impl/src/messages.mjs`, `impl/src/coordinator.mjs` (`respond` :8138, `_resolveRecord` :8317,
`_pending` :1008-1011, `_replay` :9996, ask handlers :9484-9538, deadline sweep :2027-2031,
`prepareSemanticInterrupt` :6286-6324), `impl/src/application.mjs` (`normalizeAnswer` :205-220,
`answer` :10176, boundedAttentionText :196-203), `impl/src/application-cli.mjs` (`run answer`),
`impl/src/mcp-northbound.mjs` (`fleet_answer`), `impl/src/adapter.mjs` (D1 approve≠answer),
`impl/src/claude-session.mjs` (elicitation mapping :1008-1014, wire ids :840-849), MockAdapter
`ask` (:580-606).

## Part A — settlement-integrity fixes (issue #20, prerequisites)

1. **F1/P0 — durable pending records.** Pending interaction records (approval/question and the
   new decision kind) MUST be ledger-admitted durable records that `_replay()` reconstructs into
   the pending set (or replay-terminalizes with a typed event, never a silent wedge). A blocking
   question asked before a restart MUST be answerable after it. Red test: ask → restart →
   answer settles; `respond` never returns not_found for a replayed pending record.
2. **F2/P0 — resolution/disposition split.** Settlement records become
   `{disposition: delivered|stale_discarded|expired|superseded, answer?}`; a stale-discarded or
   expired settlement never surfaces the answer as the resolution and `respond()` never returns
   `applied` for an undelivered answer (contrast coordinator.mjs:8324-8329 today). Red tests:
   stale-discard after turn end returns the typed disposition, not applied; later principals see
   no answer for non-delivered settlements.
3. **F3/P1 — kind-checked answers at the hub.** `normalizeAnswer` validates the answer shape
   against `interactionStatus(requestId).kind` BEFORE any adapter call: a `{decision}` answer
   may only settle approval-kind records, `{text}` or the typed `{optionId}` only their kinds;
   `optionId ∈ options` and exactly-one-of (optionId XOR text) enforced in the coordinator.
   Adapter cards declare per-kind native/emulated honesty (claude elicitation is `emulated` for
   decision answers). An adapter throw after a flushed wire write MUST NOT roll the record back
   to pending in a way that permits a second different settlement (idempotent retry boundary).
4. **F4/P1 — duplicate requestId rejected.** Admission of `question.asked`/`approval.requested`/
   `decision.requested` with an already-pending requestId fails loudly with a rejection event;
   a pending record is never overwritten (coordinator.mjs:9501, 9538 today).

## Part B — the decision channel (issue #16)

5. **Closed shapes** (messages.mjs): `createDecisionRequest({question, options, allowFreeResponse,
   recommended=null, deadlineMs})` — options 1..8 `exact{id: SafeId, label: bounded≤160,
   summary: bounded≤512|null}`; `createDecisionAnswer({optionId|null, text|null})` exactly one
   non-null; `recommended` must name an option; unknown fields refuse.
6. **Settlement.** Single-consumer via the Part-A machinery: first settle wins, others get
   `already_resolved` (the existing code — never invent `already_handled`); stop/kill supersede
   with an explicit designed path (semantic interrupt supersedes today; stop/kill need their own
   typed supersession, not silence).
7. **Deadline mandatory.** `deadlineMs` is REQUIRED in v1 (the gating-deadlock break, F6). On
   expiry: `decision.expired` ledger event, a typed cancel delivered to the adapter (wire-level
   expiry — the worker's turn must not hang), the task transitions honestly, and an in-flight
   `resolving` settlement wins over the sweep (race pinned). Never an auto-answer.
8. **Attention.** Pending decision requests classify `blocked_interaction:decision` (AX-1's
   projection) with sanitized question + option ids/labels via the boundedAttentionText
   discipline; `recommended` is projected as worker-authored untrusted content (provenance
   marked, never hub-styled). Attention overflow past MAX_ATTENTION truncates with an explicit
   `attentionTruncated` story, not silence.
9. **Emulated grammar.** Briefs advertise `DECISION_REQUEST: <json>` (bounded bytes). The adapter
   parses the FIRST well-formed request as **untrusted prose** (spoof-safe: the worker can
   always re-ask; quoted file content containing the grammar mints no request) — never as
   authority-adjacent control. Malformed payloads are ignored as prose. MockAdapter `ask` gains
   `kind:'decision'` with `options` for deterministic tests.
10. **Surfaces (one authority).** `run.answer(run, request, {optionId}|{text})`; CLI
    `baton run answer RUN --option ID | --text "…"`; MCP `fleet_answer` typed form; direct port
    identical. Adapter cards advertise `decision: native|emulated|unsupported`.

## Part C — red tests first (`impl/test/reflex1-decision-requests-red.test.mjs`)

F1 restart-settles-after-replay; F2 stale-discard disposition honesty; F3 cross-kind refusal +
rollback idempotency; F4 duplicate-id loud rejection; closed-shape refusals; single-consumer
race → one `already_resolved`; stop/kill supersession typed; expiry delivers typed cancel and
transitions the task (no hang); sweep vs in-flight race; emulated grammar (well-formed gated,
malformed ignored, quoted-fixture content mints nothing); CLI/MCP typed forms; attention
sanitized + untrusted `recommended`; replay identity across restart.

## Part D — boundaries

No new Program effect kind; no auto-answering; no provider text trusted; no credentials; no new
event kinds beyond `decision.requested/settled/expired` (and the named replay reconstruction);
respond/approve/answer split preserved (D1). Do NOT rewrite the settlement machinery wholesale —
Part A is surgical and red-first. No git commits, no scratch/log writes (including /tmp).

## Part E — validation

Focused suite green; full suite `node impl/scripts/run-suite.mjs` green from the worktree root.
