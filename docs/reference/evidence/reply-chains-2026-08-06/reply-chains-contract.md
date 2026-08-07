# Epic #105 — Reply chains with a depth budget: implementation contract

**Status:** v1.0 DRAFT (acceptance pins red-first, ring-2 form)
**Date:** 2026-08-06
**Verification HEAD:** `ac3f9b6542df5a779fa7a7cbacd928a6a9d11763`
**Brief:** `contract-105-brief.md` (this directory, 42 lines)

**Seed.** The frontier-sweep ledger names the gap directly — "Reply depth 1: a worker's answer can't
raise a follow-up conversationally \| BD3-C v1 design choice; felt in the demo's one-shot replies \|
**#105** (budgeted reply chains)" (`docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:32`).
BD3-C shipped reply depth 1 as a deliberate v1 pin; #105 is the budgeted generalization. The issue body
itself was unavailable at drafting time (`gh` is not authenticated in this worktree), so the brief's own
decisions carry the requirements; every code anchor below was re-verified against the current tree at the
verification HEAD.

**Read-order executed.** (1) issue body — unavailable, see above; (2) BD3-C artifacts
(`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md`, `test-blueteam.md`);
(3) the current message machinery (`impl/src/coordinator.mjs`, `impl/src/claude-session.mjs`,
`impl/src/application.mjs`, `impl/src/mcp-northbound.mjs`, `impl/src/web-northbound.mjs`,
`impl/src/limits.mjs`, `impl/src/coordination-store.mjs`); (4) the #94 lived evidence
(`docs/reference/evidence/dynamic-workflow-2026-08-03/control-surface-audit.md`, `run-dynamic-workflow.mjs`).
Anchors verified by `grep -an`/`sed -n`; the two NUL-bearing files (`application.mjs`,
`coordination-store.mjs`) were read by grep/sed only, per campaign discipline.

**Cross-references (not re-specified here):** #75 attention inbox, #87 facade projection, #10 waiting
vocabulary, #94 dynamic-workflow lived evidence, #114 workflow-as-data impl brief. Each is cited at the
decision it touches. This contract owns only the reply-chain depth-budget surface.

---

## 1. Ground truths (re-verified at HEAD)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | BD3-C pinned reply depth 1 in v1: "a reply to a reply refuses with the depth code, never unknown-parent". The depth-exhaustion refusal is **depth-coded**, stream-emitted, keyed on `parent.depth >= 1`. | `coordinator.mjs:12488-12492` (the BD3-C comment), `:12517-12519`; `bidirectional-v3-decisions.md:60-61` |
| G2 | The worker reply frame is **closed** `{inReplyTo, body}` — a caller-named `to` draws `message_target_caller_named`; smuggled fields are stripped; the scanner's sorted-key check is `'body,inReplyTo'`; `inReplyTo` must match `/^message:[a-f0-9]{64}$/u`. | `coordinator.mjs:12488-12497, 12508-12511`; `claude-session.mjs:152-166` (`scanForMessageSend`), scanner window `MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES = 20_480` at `claude-session.mjs:34` = `limits.mjs:77` |
| G3 | The send mints depth **0**; the reply record mints depth **1**; the reply envelope `{messageId, inReplyTo, from, body}` and `parent.reply` single-slot fill; the receipt is the honest state machine `{delivered, read, actedOn: null, reply}`. | `coordinator.mjs:6891` (send `depth: 0`), `:12555-12567` (reply envelope + record `depth: 1`), `:12561` (`parent.reply =`), `:6956-6973` (`messageReceipt`), `:6979-6996` (`messageRunId`) |
| G4 | One reply per message record — per-member for broadcasts. A member's second reply to the same broadcast refuses with `message_depth_exceeded` (the slot law and the depth law share the code). | `coordinator.mjs:12517-12519`; `tight-cell-contract.md` ground truth 14 + Decision 5; `impl/test/tight-cell-red.test.mjs:946-984` |
| G5 | The durable audit rows are `message.sent` / `message.delivered`, idempotency-keyed, appended by `recordMessage`; the delivery state machine (delivered/read/actedOn/reply) is **process-scoped**, never store-derived. The worker-log `message.delivered` reply events are `appendAttributed`-only (not yet store-audited). | `coordination-store.mjs:13464-13481` (`recordMessage`), `:8747-8750` (replay fold); `coordinator.mjs:6895-6901` (`message.sent`), `:6932-6937` (`message.delivered` per worker), `:12569-12572` (reply `message.delivered`, log only) |
| G6 | Message ids are minted as `message:<canonicalDigest({kind, to, body, seq})>` / `message:<canonicalDigest({inReplyTo, from, body, seq})>` — `seq` is process-local (`this._messages.size + 1`), so ids are not replay-deterministic; replay can reconstruct **topology** from recorded rows, never re-mint ids. | `coordinator.mjs:6889, 12553-12554`; `_messages = new Map()` at `:1190` |
| G7 | The facade projection (#87) dispatches `run.message.send` / `run.message.receipt` as direct ports ahead of the byte-stable `APPLICATION_COMMAND_DEFINITIONS` table; law is "reach, never semantics". `_normalizeMessageSend` is closed on `['runId','workerId','kind','body']`; `_normalizeMessageReceipt` is closed on `'messageId'`; both surfaces return `deepFreeze({ schemaVersion: 1, ... })`. | `application.mjs:12501-12510` (projection header), `:12512-12537` (`_normalizeMessageSend`, body cap at `:12525-12528`), `:12539-12546` (`_normalizeMessageReceipt`), `:12706-12730` / `:12732-12747` (facades, verbatim lane outcomes) |
| G8 | The MCP northbound carries the lane: `baton_run_message_send` (`['control','observe']`), `baton_run_message_receipt` (`['observe']`). `stateFailureCode` collapses unmapped codes to `command_outcome_unknown`; it currently knows no `message_*` codes. The web mapper is a coded-error ladder with a 400-class for client preconditions. | `mcp-northbound.mjs:108-109` (capability classes), `:585-600` (tool schemas), `:198-261` (`stateFailureCode`); `web-northbound.mjs:148-212` (`dispatchFailure`) |
| G9 | The #10 waiting vocabulary is a **closed five-kind enum** — `['capacity_ceiling','dispatch_pending','plan_approval','provider_stalled','spawning']` (frozen, in ACTUAL sorted order); blocking upward interactions are a **separate closed set** — `answer_decision/answer_question/answer_approval`; a chain's pending replies never enter either. | `application-semantics.mjs:59-61` (`WAITING_ON_KINDS`); `wave-driver.mjs:189-191` (`BLOCKING_INTERACTION_KINDS`) |
| G10 | Frame economy is one declared registry: `message.send.body=2048`, `message.reply.body=2048` (admission, `spill_body_exceeded`), `scanner.window.message_send=20480`, `spill.body=1048576`. The budget's max is derived from these (Decision D1). | `limits.mjs:53-71, 73-86` (ADMISSION/SUBSTRATE), `:54-55, :77, :85` |
| G11 | DECISION_REQUEST is **blocking** (one-pending admission, `deadlineAt` clock, task → `input_required`); the message lane is **non-blocking** (the worker stays working; receipts are truth). A reply chain never transitions a task phase; a decision gate always does. | `bidirectional-v3-decisions.md` (BD3-C blocking/non-blocking split); #94 control-surface round-trip at `dynamic-workflow-2026-08-03/control-surface-audit.md:115-118, 172` |
| G12 | The #94 demo proved the single-hop round-trip (send → BLUE reply → receipt) and surfaced the chain gap: a worker's answer "can't raise a follow-up conversationally", and `MESSAGE_SEND` has **no idempotency guard** (the reply frame is not idempotency-keyed — a grammar-surface asymmetry already on record). | `dynamic-workflow-2026-08-03/run-dynamic-workflow.mjs:218-232, 300-308`; `dynamic-workflow-receipt.json`; `grammar-surface-audit.md:98, 129` |
| G13 | The depth-1 C2 test asserts the refusal **is DEPTH, not unknown-parent** (checks `includes('depth')` on the reason). Under a default budget of 1 the admission envelope is byte-identical, so C2 and the tight-cell per-member pins stay green. | `impl/test/bidirectional-v3-red.test.mjs:502-524` (C2); `impl/test/tight-cell-red.test.mjs:946-984` |

---

## 2. Decisions

### D1 — The budget model: `depth >= budget` refuses; budget per send; default 1; count, never clock

The depth-exhaustion check generalizes from the hardcoded 1 to a declared budget:

```js
// today (coordinator.mjs:12517-12519)
if (parent.depth >= 1 || parent.reply) {
  refuse('message_depth_exceeded', { depth: parent.depth + 1 });
}
// contract
if (parent.depth >= (parent.budget ?? 1) || parent.reply) {
  refuse('message_depth_exceeded', {
    depth: parent.depth + 1,
    budget: parent.budget ?? 1,
    remaining: Math.max(0, (parent.budget ?? 1) - parent.depth),
  });
}
```

- **Budget is declared per message at send**: `sendMessage({kind, to, body, budget = 1}, auth)`. The
  facade normalizes it to a present integer (Decision D6); the lane defaults absent to 1.
- **Default 1 is today's exact admission envelope.** A plain send (no budget) admits exactly one reply
  (depth 1, `0 < 1`); a reply to that reply refuses with `message_depth_exceeded` (parent `depth 1 >= 1`),
  never `message_parent_not_found`. C2 (G13) and the tight-cell per-member slot law (G4) stay green.
  "Byte-identical" governs the *admission decision*; the refusal payload additionally carries
  `budget`/`remaining` (additive, code and `depth` unchanged — see D3).
- **Budget is a COUNT, never a clock** (campaign law). No `deadlineAt`, no ticking, no expiry on a chain;
  `remaining` decreases only when a hop lands. A budget does not run out while idle.
- **The chain is root-anchored and worker-driven.** The depth counter counts hops from the root send
  (root `depth: 0`). A worker reply at depth `d` is admitted iff `parent.depth < parent.budget`; the reply
  record carries `depth: parent.depth + 1`, `budget: parent.budget`, `remaining: parent.budget - depth`.
  The orchestrator continues a conversation with a **fresh root send** (fresh budget) — there is **no
  send-side `inReplyTo`** (the send envelope stays `{kind, to, body, budget?}`; see Open Question OQ-1).
- **`MAX_MESSAGE_DEPTH_BUDGET = 8`** (closed). Derivation:
  - *Resource bound (primary):* the per-hop body cap is 2,048 bytes (`limits.mjs:54-55`). A max-budget
    chain whose hop bodies are all at cap materializes `8 × 2,048 = 16,384` body bytes — strictly less
    than the single scanner window `MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES = 20,480`
    (`claude-session.mjs:34` = `limits.mjs:77`). No depth of a budgeted chain can force the MESSAGE_SEND
    scanner into a partial-window degrade on depth alone. (The receipt side is bounded by view ceilings,
    not this constant.)
  - *Conversation bound (secondary):* beyond 8 hops an exchange has either resolved or must escalate —
    a blocking need goes to DECISION_REQUEST (G11), persistent context goes to the scratchpad. 8 is the
    smallest power of two strictly above the 3-deep acceptance exchange (RC-01) with headroom for the
    #94 four-surveyor broadcast pattern.
  - *Configurability (campaign law):* the per-send budget is declarable in `[1, 8]`; the 8 is a closed
    **resource ceiling**, never a per-run throttle. All work below the ceiling is processed; the ceiling
    is derived from a physical resource bound (the scanner window), not an arbitrary cap.

### D2 — The chain shape: fields on the records, envelopes, and receipts

| Surface | Fields (all additive) |
|---------|------------------------|
| Root send record (`coordinator.mjs:6889-6893`) | keeps `depth: 0`; gains `budget` (declared ?? 1) and `remaining: budget` |
| Reply record (`coordinator.mjs:12562-12567`) | `depth` becomes `parent.depth + 1` (was the hardcoded `1`); gains `budget: parent.budget`, `remaining: parent.budget - (parent.depth + 1)`; keeps `inReplyTo` |
| Reply envelope (`coordinator.mjs:12555-12560`) | `{messageId, inReplyTo, from, body, depth, budget, remaining}` (spill shape unchanged: `spilled/bytes/digest/spill` ride alongside) |
| Receipt (`coordinator.mjs:6956-6973`) | the message's own `{depth, budget, remaining}`, plus existing `{delivered, read, actedOn, reply}`; `reply` is the envelope above |
| Send outcome (`coordinator.mjs:6944-6948`) | gains `budget` (the declared value; `depth: 0` / `remaining: budget` are derivable and not duplicated) |

- **Id minting is untouched.** The reply id mint
  (`canonicalDigest({inReplyTo, from, body, seq})`, `coordinator.mjs:12553-12554`) and the send id mint
  (`canonicalDigest({kind, to, body, seq})`, `:6889`) do NOT include `depth`/`budget`/`remaining` — those
  ride the records and envelopes only, so existing id derivation is byte-unchanged (G6). The `#114`
  impl-serialization discipline (canonical `sort()`-keyed digests) is preserved.
- **The reply wire frame stays closed** `{inReplyTo, body}` (G2). Budget is **send-side only**: a worker
  smuggling `budget` in a reply frame is rejected by the scanner's sorted-key check (`'body,inReplyTo'`,
  `claude-session.mjs:161`) and drops to prose — never a typed refusal (grammar-surface asymmetry kept
  on record, G12).

### D3 — Refusal vocabulary and the two budget refusals

The message-lane coded refusals split by **reach**:

1. **Worker-reply refusals (stream events only, `message.rejected`, never MCP tool errors):**
   `message_frame_invalid`, `message_target_caller_named`, `message_parent_not_found`,
   `message_depth_exceeded`, `spill_body_exceeded` (`coordinator.mjs:12505, 12509, 12514, 12518, 12530`).
   They land on the worker's durable stream via `appendAttributed` (`:12497-12502`). Because they never
   cross the facade as thrown errors, **none are added to `stateFailureCode`** — do not guess otherwise.
   `message_depth_exceeded` stays depth-coded and is keyed on `parent.depth >= (parent.budget ?? 1) ||
   parent.reply`; `remaining: 0` in its payload is the honest exhaustion signal, while a duplicate-reply
   refusal (slot law, G4) may carry positive `remaining` (the slot refused it, not the budget).
2. **Send-side refusal (thrown by the lane, crosses the facade → MCP → web):**
   **`message_budget_invalid`** — thrown by `coordinator.sendMessage` when a declared budget is not a safe
   integer in `[1, MAX_MESSAGE_DEPTH_BUDGET]`. It is the ONE new allowlisted code. This mirrors the
   existing `capability_budget_invalid` precedent (already allowlisted, `mcp-northbound.mjs:204`).
   - `stateFailureCode` (`mcp-northbound.mjs:198-261`) gains `message_budget_invalid` so it never
     collapses to `command_outcome_unknown`.
   - `web-northbound.mjs:148-212` (`dispatchFailure`) gains a `message_budget_invalid` branch →
     `httpStatus: 400`, code preserved (the same "command precondition failed" class as the
     `capability_*_invalid` family, `web-northbound.mjs:195-199`).
   - The other send-side results (`worker_spawning`, `worker_not_active`, `run_not_active`) stay returned
     **outcomes**, not thrown errors (`coordinator.mjs:6868-6887`) — unchanged by this contract.
   - Shape violations that are *not* range violations (a non-safe-integer `budget` value) refuse at the
     facade with `application_message_send_invalid` (Decision D6) — the facade may only refuse codes the
     lane would not produce for the same input (direct-ports law, G7).

### D4 — Receipts: every hop names parent, depth, remaining

`messageReceipt(messageId)` returns the message's own `{depth, budget, remaining}` alongside the existing
`{delivered, read, actedOn, reply}`. Each hop's `reply` envelope carries `{messageId, inReplyTo, from,
body, depth, budget, remaining}`. The chain is walkable **root → r1 → r2 → r3** by following each
receipt's `reply.inReplyTo` back to the parent and reading `depth`/`remaining` at every hop. Concretely,
under a budget-3 root:

| hop | parent (inReplyTo) | depth | budget | remaining | receipt.reply |
|-----|--------------------|-------|--------|-----------|---------------|
| root (send) | — | 0 | 3 | 3 | r1 `{depth: 1, remaining: 2}` |
| r1 (worker reply) | root | 1 | 3 | 2 | r2 `{depth: 2, remaining: 1}` |
| r2 (worker reply) | r1 | 2 | 3 | 1 | r3 `{depth: 3, remaining: 0}` |
| r3 (worker reply) | r2 | 3 | 3 | 0 | null |

A reply to r3 would check `parent.depth (3) >= parent.budget (3)` → refuse
`message_depth_exceeded` `{depth: 4, budget: 3, remaining: 0}`.

### D5 — Replay derivability: the durable records carry the chain

Today the chain's reply hops exist only in the in-memory `_messages` map (G6) and the in-memory worker
log; the store audit records only root sends and their per-worker deliveries (G5). The contract closes
that gap so a fresh coordinator can rebuild chain **topology** from durable records:

- **Root sends:** the `message.sent` audit row (`coordinator.mjs:6895-6901`) gains `{depth: 0, budget,
  remaining: budget}`; each `message.delivered` per-worker row (`:6932-6937`) gains the same. Idempotency
  keys (`message.sent:<id>`, `message.delivered:<id>:<workerId>`) are unchanged.
- **Reply hops:** the reply admission additionally writes a durable audit row via
  `recordMessage('message.delivered', {messageId, inReplyTo, from, depth, budget, remaining, body}
  (spilled shape preserved), {actor, key: 'message.delivered:<replyId>:<workerId>'})` — beside the existing
  worker-log `appendAttributed` (`:12569-12572`). No new audit kind: `recordMessage` stays closed on
  `message.sent`/`message.delivered` (`coordination-store.mjs:13469-13470`).
- **What replay rebuilds:** a fresh coordinator replaying the store rows reconstructs each root and each
  reply hop with its parent link (`inReplyTo`), `depth`, `budget`, and `remaining` — the chain topology —
  from the **recorded** minted ids (G6: ids are not re-derived). The live receipt state machine
  (`delivered/read/actedOn`) stays process-scoped, exactly as `coordination-store.mjs:8747-8750`
  documents; replay never fabricates delivery state.

### D6 — The facade projection (#87 sibling): budget fields ride, table untouched

- `_normalizeMessageSend` (`application.mjs:12512-12537`): the closed key set gains `budget` →
  `['runId', 'workerId', 'kind', 'body', 'budget']`. The shape rule: when present, `budget` must be a safe
  integer (`Number.isSafeInteger`); else `application_message_send_invalid`. Normalized to a **present**
  integer `budget: value.budget ?? 1`. **Range** (`1..MAX`) is NOT validated here — it is passed to the
  lane so the lane throws `message_budget_invalid` (direct-ports law: the facade never refuses a code the
  lane would not produce, G7).
- `messageSend` facade (`application.mjs:12706-12730`): passes `budget` through to
  `coordinator.sendMessage({kind, to, body, budget}, ...)`; the returned `deepFreeze({ schemaVersion: 1,
  ...outcome })` carries the outcome's new `budget` field verbatim.
- `messageReceipt` facade (`application.mjs:12732-12747`): resolve-then-authorize unchanged
  (`messageRunId`, `application_unauthorized` on resolve-to-null); the returned receipt carries
  `{depth, budget, remaining}` verbatim.
- The byte-stable `APPLICATION_COMMAND_DEFINITIONS` table and the direct-port dispatch order
  (`application.mjs:12294-12295, 12501-12510`) are **untouched**. The projection law is "reach, never
  semantics"; no facade-level semantic is introduced.

### D7 — MCP and web surfaces

- `baton_run_message_send` (`mcp-northbound.mjs:585-592`): `inputSchema` gains
  `budget: { type: 'integer', minimum: 1, maximum: 8 }` (optional, default 1; `maxLength` there remains a
  shape hint, never the authority — the body cap lives in `limits.mjs`). Capability class stays
  `['control', 'observe']` (`:108`). The description's body-cap prose is unchanged.
- `baton_run_message_receipt` (`mcp-northbound.mjs:594-600`): capability stays `['observe']` (`:109`);
  the description's receipt shape is updated to the depth-carrying shape (prose only; no code change).
- `stateFailureCode` (`mcp-northbound.mjs:198-261`) and the web mapper (`web-northbound.mjs:148-212`)
  gain `message_budget_invalid` per Decision D3. No other message codes are added (worker-reply refusals
  never cross these surfaces).

### D8 — The DECISION-request boundary (routing rule)

The block between the message lane and DECISION_REQUEST is **blockingness and phase impact** (G11):

- **Blocking** (the worker cannot proceed without the input) → `DECISION_REQUEST` (task →
  `input_required`; one-pending admission; `deadlineAt`). The worker is gated; a task phase transition
  occurs.
- **Conversational follow-up** (the worker keeps working; the exchange is not gating) → the **budgeted
  reply lane**. The worker raises the follow-up in a reply body; the orchestrator reads the receipt and
  either (a) continues the conversation with a **fresh root send** (new budget), or (b) escalates to a
  decision gate.

A reply chain **never** transitions a task phase; a decision gate **always** does. The exhaustion refusal
`message_depth_exceeded` with `remaining: 0` is the honest handoff signal: the orchestrator's next action
is "new root" (conversation continues) or "DECISION_REQUEST" (the matter became blocking). No worker-facing
law changes; this is orchestrator choreography.

### D9 — The #10 waiting-vocabulary interaction

A worker that has replied in a chain (no blocking interaction pending) reads `waitingOn: null` — mid-turn
working, not waiting on a kind. The chain's pending state lives in the **orchestrator's receipts**
(D4), never in the worker's `waitingOn`. Therefore:

- `WAITING_ON_KINDS` stays the closed five
  `['capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning']` (G9) —
  **no change**, no new kind.
- `BLOCKING_INTERACTION_KINDS` stays the closed three `answer_decision/answer_question/answer_approval`
  (G9) — a message reply is not an interaction kind, **no change**.

### D10 — Acceptance suite homes

The red-first pins home as a dedicated suite `impl/test/reply-chains-red.test.mjs` (matching the
`<epic>-red.test.mjs` convention), with the surface pins in the existing northbound suites
(`phase16-mcp-northbound.test.mjs`, `phase12-web-northbound.test.mjs`). The pinned green suites —
`bidirectional-v3-red.test.mjs` (C2), `tight-cell-red.test.mjs` (per-member slot law), the #87 facade
suite, and the #10 waiting-vocabulary suite — must run unchanged.

---

## 3. Refusal vocabulary (closed)

| Code | Reach | Payload | Fires when |
|------|-------|---------|------------|
| `message_depth_exceeded` | worker stream (`message.rejected`) | `{depth, budget, remaining}` | `parent.depth >= (parent.budget ?? 1)` (exhaustion, `remaining: 0`) OR `parent.reply` (duplicate reply per message, slot law) |
| `message_budget_invalid` | thrown by the lane → facade → MCP → web | code preserved; `command_outcome_unknown` never | declared budget not a safe integer in `[1, MAX_MESSAGE_DEPTH_BUDGET]` |
| `application_message_send_invalid` | facade | code preserved | `budget` present but not a safe integer (shape), or any existing `_normalizeMessageSend` shape violation |
| `message_parent_not_found` | worker stream | `{inReplyTo}` | reply names an unknown message id (unchanged) |
| `message_frame_invalid` / `message_target_caller_named` | worker stream | — | closed-frame violations (unchanged) |
| `spill_body_exceeded` | worker stream / lane | cap/actual/gracefulPath (unchanged) | over the spill ceiling (unchanged) |

The wire sorted-key literals remain exactly as today: the reply frame `'body,inReplyTo'`
(`claude-session.mjs:161`), the receipt request `'messageId'` (`application.mjs:12539-12546`), and the
closed-five `WAITING_ON_KINDS` array (G9). No new sorted-key literal is introduced.

---

## 4. Acceptance pins (red-first)

RED = fails at HEAD; GREEN = passes at HEAD and is pinned.

| Pin | Assertion | Today |
|-----|-----------|-------|
| RC-01 | **3-deep exchange lands.** A budget-3 root admits worker replies at depth 1, 2, 3 (each `inReplyTo`-linked); a reply to the depth-3 hop refuses `message_depth_exceeded` with `{depth: 4, budget: 3, remaining: 0}`. | **RED** (reply-to-reply refuses at depth 1) |
| RC-02 | **Default-1 byte-identity.** A plain send (no budget) admits exactly one reply; a reply to that reply refuses with the depth code, never `message_parent_not_found`. C2 and the tight-cell per-member slot law stay green. | **GREEN** (pin) |
| RC-03 | **Exhaustion payload.** The depth-exhaustion refusal carries `{depth, budget, remaining}` with `remaining: 0`; the duplicate-reply refusal (slot law) carries the same shape (positive `remaining` allowed). | **RED** (payload is `{depth}` only) |
| RC-04 | **Budget out of bounds → `message_budget_invalid`.** A send declaring `budget: 0` or `budget: 9` (with MAX 8) refuses at the lane; the code survives `run.message.send` and `baton_run_message_send` verbatim (never `command_outcome_unknown`); the web mapper returns 400. | **RED** (no budget field) |
| RC-05 | **Budget non-integer → `application_message_send_invalid`.** A send declaring `budget: 1.5` or `budget: '3'` refuses at the facade; the lane's code is never masked. | **RED** (no budget field) |
| RC-06 | **Per-hop receipts.** `run.message.receipt` on each hop returns `{delivered, read, actedOn, reply, depth, budget, remaining}`; the reply envelope carries `{messageId, inReplyTo, from, body, depth, budget, remaining}`; the chain root→r1→r2→r3 is walkable. | **RED** (no depth fields) |
| RC-07 | **Replay rebuilds the chain.** A fresh coordinator replaying the durable `message.sent`/`message.delivered` rows reconstructs each hop's `{inReplyTo, depth, budget, remaining}` matching the live chain hop-for-hop. | **RED** (reply hops not store-audited; no budget/remaining) |
| RC-08 | **Facade carries the fields; table byte-stable.** `run.message.send` outcome carries `budget`; `run.message.receipt` carries `{depth, budget, remaining}`; `APPLICATION_COMMAND_DEFINITIONS` and the direct-port dispatch order are byte-unchanged; the projection law holds. | **RED** for the fields; the byte-stability half is pinned |
| RC-09 | **MCP/web surfaces.** `baton_run_message_send` accepts `budget` (`minimum: 1`, `maximum: 8`, optional); an out-of-range budget surfaces as `message_budget_invalid`; `baton_run_message_receipt` returns the depth fields; the web mapper maps `message_budget_invalid` to 400. | **RED** |
| RC-10 | **waitingOn stays null mid-chain.** A worker that has replied (no blocking interaction pending) reads `waitingOn: null`, is not `interaction`-blocked; `WAITING_ON_KINDS` and `BLOCKING_INTERACTION_KINDS` are byte-unchanged. | **GREEN** (pin) |
| RC-11 | **Wire asymmetry.** A reply frame naming `budget` (or any field beyond `{inReplyTo, body}`) is rejected by the scanner's sorted-key check and drops to prose — never a typed refusal, never a budget set by a worker. | **GREEN** (pin) |

---

## 5. Campaign-law constraints and non-goals

- **No clocks.** The budget is a count; `remaining` never ticks, no `deadlineAt`, no expiry (D1).
- **No new control surfaces.** The worker reply frame stays closed `{inReplyTo, body}`; the budget is
  send-side only. No per-run message caps, no turn limits — the budget is per-root-subtree, declared at
  send, bounded by a resource-derived ceiling (D1).
- **Direct-ports law.** The facade reaches, never decides semantics; the byte-stable table is untouched
  (D6, G7). The one new allowlisted code is `message_budget_invalid`; worker-stream refusal codes are
  deliberately absent from `stateFailureCode` (D3).
- **NUL-byte discipline.** The facade's `body.includes('\0')` rejection is unchanged
  (`application.mjs:12520`); `budget` is an integer, never body text.
- **No new waiting kinds.** The closed five and the blocking-interaction three are untouched (D9, G9).
- **Non-goals.** Send-side `inReplyTo` / orchestrator-addressable chain hops (OQ-1); reply-frame
  idempotency (the G12 asymmetry is owned elsewhere, cross-referenced, not fixed here); moving the live
  delivery state machine into the store (explicitly stays process-scoped, D5, G5).

---

## 6. Open questions

- **OQ-1 — Orchestrator-addressable chain hops.** The contract routes conversation continuation to fresh
  root sends (D1). If lived choreography (a #94 successor) requires an orchestrator send that *continues*
  a chain — naming `inReplyTo` and inheriting/re-declaring the budget mid-chain — that is a send-envelope
  change (`_normalizeMessageSend` closed keys, MCP schema, lane) beyond this contract's surface. Decide
  from demo evidence, not speculation.
- **OQ-2 — Reply-frame idempotency.** G12's asymmetry (a duplicate `MESSAGE_SEND` frame mints a fresh
  reply id) is adjacent to this epic but owned by the grammar-surface ledger. Whether the depth budget
  makes accidental duplicate replies more costly (they consume budget hops) is worth one demo observation
  before deciding.
- **OQ-3 — Receipt `remaining` semantics for slot-law refusals.** D3 allows a duplicate-reply refusal to
  carry positive `remaining` (the slot refused, not the budget). If any consumer needs to distinguish the
  two refusals, a distinct code would be required — this contract keeps the shared `message_depth_exceeded`
  code for tight-cell byte-compatibility (G4) and makes the payload honest instead.

---

## 7. Verification

- **HEAD pinned:** `ac3f9b6542df5a779fa7a7cbacd928a6a9d11763`.
- **Evidence discipline:** every anchor in §1 was re-verified by `grep -an`/`sed -n` on the current tree;
  the NUL-bearing files were never read whole. Sorted-key literals appear only as verified (G9, §3).
- **Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
