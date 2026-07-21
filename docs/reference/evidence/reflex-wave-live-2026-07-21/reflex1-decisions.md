# REFLEX-1 decisions contract — typed worker→orchestrator decision requests

Ground truth: docs/32 §3.1, issue #16, `impl/src/messages.mjs` (createAsk/createAnswer),
`impl/src/coordinator.mjs` (`respond` :8138, `_handleEvent` approval/question paths,
`approval.resolved` :8364, approval deadline sweep :2028), `impl/src/application.mjs`
(`answer` flow + attention), `impl/src/application-cli.mjs` (`run answer`),
`impl/src/mcp-northbound.mjs` (`fleet_answer`), `impl/src/adapter.mjs` (ask/answer contract,
D1 approve≠answer), MockAdapter `ask` (:580-606).

## Rules

1. **Closed shapes** (validated in `messages.mjs`, NFC/digest rules as existing):
   `createDecisionRequest({ question, options, allowFreeResponse, recommended=null, deadlineMs=null })`
   — options 1..8 of `exact{id: SafeId, label: bounded≤160, summary: bounded≤512|null}`;
   `createDecisionAnswer({ optionId|null, text|null })` — exactly one non-null; optionId must
   name a request option when options exist; text required when allowFreeResponse is the only
   path. Unknown fields/options/expired digests refuse.
2. **Settlement.** Ride the existing single-consumer pending machinery (the approval/question
   family): `decision.requested`/`decision.settled` ledger events with digests; first settle
   wins (`already_handled` otherwise); stop/kill supersedes via `control.interaction_superseded`;
   deadline (when set) settles `decision.expired` — typed and visible, NEVER an auto-answer.
3. **Attention.** Pending decision requests classify `blocked_interaction:decision` (AX-1's
   projection when it lands; until then the request surfaces in `attention[]` with the sanitized
   question + option ids/labels — never worker prose beyond the request's own text).
4. **Surfaces (one authority).** `run.answer(run, request, { optionId } | { text })` accepts the
   typed answer; CLI `baton run answer RUN --option ID | --text "…"`; MCP `fleet_answer` gains
   the typed form; direct command port identical. Adapter cards advertise
   `decision: native|emulated|unsupported` (MockAdapter gets `native` for tests; others report
   `emulated` honestly).
5. **Worker-side grammar.** Briefs gain one section advertising the channel: the worker MAY emit
   `DECISION_REQUEST: <json {question, options?, allowFreeResponse?}>` on its own line to gate
   itself; the adapter parses the first well-formed request (bounded bytes); malformed payloads
   are ignored as prose (never guessed). MockAdapter `ask` gains `kind:'decision'` with
   `options` so tests can drive the flow deterministically.
6. **Red tests first** (`impl/test/reflex1-decision-requests-red.test.mjs`): closed-shape
   refusals; single-consumer settlement (both principals race → one `already_handled`); stale
   fence rejection; stop/kill supersession; deadline expiry is typed and never answers; grammar
   parse (well-formed gated + malformed-ignored); CLI/MCP typed forms; attention projection
   sanitized; replay identity across restart.
7. **Boundaries.** No new Program effect kind; no auto-answering; no provider text trusted; no
   credentials; no new event kinds beyond the three named; settlement machinery otherwise
   untouched (respond/approve/answer split preserved). Do NOT modify `adapter.mjs`'s contract
   except the card `decision` field and the MockAdapter ask kind.
8. **Validation.** Focused suite green, then full suite green from the worktree root. No git
   commits, no scratch/log writes anywhere (including /tmp).
