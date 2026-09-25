# Epic #105 — Reply chains with a depth budget: implementation contract

**Status:** v1.1 DRAFT (acceptance pins red-first, ring-2 form)
**Date:** 2026-08-06
**Verification HEAD:** `d7879f22f7d94df9a9b649561b19cde3f3d02ca9`
**Brief:** `contract-105-brief.md` (this directory, 42 lines)
**Fold:** `contract-redteam.md` (this directory) — all 7 blockers (B-1..B-7) folded; §3 open-question
verdicts applied. Fold map: `contract-fold.md` (this directory).

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
`coordination-store.mjs`) were read by grep/sed only, per campaign discipline. The red-team's citation
re-verification (contract-redteam §1, current tree `a20493e`) was re-run at this worktree's HEAD
(`d7879f2`, whose `impl/src` tree is byte-identical); all post-6872 `coordinator.mjs` anchors are
re-anchored **+16** per that check.

**Cross-references (not re-specified here):** #75 attention inbox, #87 facade projection, #10 waiting
vocabulary, #94 dynamic-workflow lived evidence, #114 workflow-as-data impl brief. Each is cited at the
decision it touches. This contract owns only the reply-chain depth-budget surface.

---

## 1. Ground truths (re-verified at HEAD)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | BD3-C pinned reply depth 1 in v1: "a reply to a reply refuses with the depth code, never unknown-parent". The depth-exhaustion refusal is **depth-coded**, stream-emitted, keyed on `parent.depth >= 1`. | `coordinator.mjs:12504-12508` (the BD3-C comment), `:12533-12535`; `bidirectional-v3-decisions.md:60-61` |
| G2 | The worker reply frame is **closed** `{inReplyTo, body}` — a caller-named `to` draws `message_target_caller_named`; smuggled fields are stripped; the scanner's sorted-key check is `'body,inReplyTo'`; `inReplyTo` must match `/^message:[a-f0-9]{64}$/u`. | `coordinator.mjs:12504-12512, 12524-12527`; `claude-session.mjs:152-166` (`scanForMessageSend`), scanner window `MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES = 20_480` at `claude-session.mjs:34` = `limits.mjs:77` |
| G3 | The send mints depth **0**; the reply record mints depth **1**; the reply envelope `{messageId, inReplyTo, from, body}` and `parent.reply` single-slot fill; the receipt is the honest state machine `{delivered, read, actedOn: null, reply}`. | `coordinator.mjs:6907` (send `depth: 0`), `:12573-12589` (reply envelope + record `depth: 1`), `:12577` (`parent.reply =`), `:6972-6994` (`messageReceipt`), `:6995-7011` (`messageRunId`) |
| G4 | **Target-state, not ground truth:** the per-member broadcast reply slot is the tight-cell Decision 5 target (`tight-cell-contract.md` ground truth 14 + Decision 5). At HEAD the coordinator holds a **single** `parent.reply` slot (`coordinator.mjs:12577`, reply record `:12578-12584`); the per-member slot is a **RED pin** (`impl/test/tight-cell-red.test.mjs:946-984`, title `per-member-reply-slot-missing`). D1's per-branch budget semantics must hold for both the single-slot HEAD and the target-state. | `coordinator.mjs:12577, 12578-12584`; `tight-cell-contract.md:203-208` (GT 14) + `:464-489` (Decision 5); `impl/test/tight-cell-red.test.mjs:946-984` |
| G5 | The durable audit rows are `message.sent` / `message.delivered`, idempotency-keyed, appended by `recordMessage`; the delivery state machine (delivered/read/actedOn/reply) is **process-scoped**, never store-derived. The worker-log `message.delivered` reply events are `appendAttributed`-only (not yet store-audited). | `coordination-store.mjs:13467-13482` (`recordMessage`), `:8747-8750` (replay fold); `coordinator.mjs:6913-6922` (`message.sent`), `:6948-6957` (`message.delivered` per worker), `:12585-12589` (reply `message.delivered`, log only) |
| G6 | Message ids are minted as `message:<canonicalDigest({kind, to, body, seq})>` / `message:<canonicalDigest({inReplyTo, from, body, seq})>` — `seq` is process-local (`this._messages.size + 1`), so ids are not replay-deterministic; replay can reconstruct **topology** from recorded rows, never re-mint ids. | `coordinator.mjs:6904, 12568-12571`; `_messages = new Map()` at `:1190` |
| G7 | The facade projection (#87) dispatches `run.message.send` / `run.message.receipt` as direct ports ahead of the byte-stable `APPLICATION_COMMAND_DEFINITIONS` table; law is "reach, never semantics". `_normalizeMessageSend` is closed on `['runId','workerId','kind','body']`; `_normalizeMessageReceipt` is closed on `'messageId'`; both surfaces return `deepFreeze({ schemaVersion: 1, ... })`. | `application.mjs:12501-12510` (projection header), `:12512-12537` (`_normalizeMessageSend`, body cap at `:12525-12528`), `:12539-12546` (`_normalizeMessageReceipt`), `:12706-12730` / `:12732-12747` (facades, verbatim lane outcomes) |
| G8 | The MCP northbound carries the lane: `baton_run_message_send` (`['control','observe']`), `baton_run_message_receipt` (`['observe']`). `stateFailureCode` collapses unmapped codes to `command_outcome_unknown`; it currently knows no `message_*` codes. The web mapper is a coded-error ladder with a 400-class for client preconditions. | `mcp-northbound.mjs:108-109` (capability classes), `:585-600` (tool schemas), `:198-261` (`stateFailureCode`, `:207` `capability_budget_invalid`); `web-northbound.mjs:149-232` (`dispatchFailure`, `:195-199` the `capability_*_invalid` 400 family) |
| G9 | The #10 waiting vocabulary is a **closed five-kind enum** — `['capacity_ceiling','dispatch_pending','plan_approval','provider_stalled','spawning']` (frozen, in ACTUAL sorted order); blocking upward interactions are a **separate closed set** — `answer_decision/answer_question/answer_approval`; a chain's pending replies never enter either. | `application-semantics.mjs:59-61` (`WAITING_ON_KINDS`); `wave-driver.mjs:189-191` (`BLOCKING_INTERACTION_KINDS`) |
| G10 | Frame economy is one declared registry: `message.send.body=2048`, `message.reply.body=2048` (admission, `spill_body_exceeded`), `scanner.window.message_send=20480`, `spill.body=1048576`. The budget's max is a closed conversational ceiling (Decision D1). | `limits.mjs:53-71, 73-86` (ADMISSION/SUBSTRATE), `:54-55, :77, :85` |
| G11 | DECISION_REQUEST is **blocking** (one-pending admission, `deadlineAt` clock, task → `input_required`); the message lane is **non-blocking** (the worker stays working; receipts are truth). A reply chain never transitions a task phase; a decision gate always does. The worker-side blocking escalation path exists today: `question.asked` with `blocking: true` → task `input_required` (`coordinator.mjs:12614-12631`). | `bidirectional-v3-decisions.md` (BD3-C blocking/non-blocking split); #94 control-surface round-trip at `dynamic-workflow-2026-08-03/control-surface-audit.md:115-118, 172`; `coordinator.mjs:12614-12631` |
| G12 | The #94 demo proved the single-hop round-trip (send → BLUE reply → receipt) and surfaced the chain gap: a worker's answer "can't raise a follow-up conversationally", and `MESSAGE_SEND` has **no idempotency guard** (the reply frame is not idempotency-keyed — a grammar-surface asymmetry already on record). | `dynamic-workflow-2026-08-03/run-dynamic-workflow.mjs:218-232, 300-308`; `dynamic-workflow-receipt.json`; `grammar-surface-audit.md:98, 129` |
| G13 | The depth-1 C2 test asserts the refusal **is DEPTH, not unknown-parent** (checks `includes('depth')` on the reason). Under a default budget of 1 the admission envelope is byte-identical, so C2 and the tight-cell per-member pins stay green. | `impl/test/bidirectional-v3-red.test.mjs:502-524` (C2); `impl/test/tight-cell-red.test.mjs:946-984` |

---

## 2. Decisions

### D1 — The budget model: `depth >= budget` refuses; budget per send; default 1; count, never clock

The depth-exhaustion check generalizes from the hardcoded 1 to a declared budget:

```js
// today (coordinator.mjs:12533-12535)
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
- **The budget is a PER-BRANCH depth cap, never a per-root-subtree hop total.** Each reply admits one
  hop of depth+1; the budget carried by a parent bounds the chain *down that parent's own branch*. A
  broadcast root with a per-member slot law (G4 target-state) admits **N** first-replies, one per
  member, **each** at depth 1 with the root's budget — so the subtree can materialize up to **N × B**
  hops while **no single branch** exceeds B. "The budget is per-root-subtree" is false under forking;
  the honest statement is per-branch. The per-member law is target-state, so at HEAD (single slot) the
  two readings coincide — but the law text below is the per-branch one.
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
- **`MAX_MESSAGE_DEPTH_BUDGET = 8`** (closed). Derivation (corrected — B-3):
  - *Per-frame invariant (the bound that actually holds):* the scanner window
    `MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES = 20,480` bounds **one frame scan** —
    `extractFirstBalancedJsonObject(match[1], MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES)`
    (`claude-session.mjs:152-166`). A single MESSAGE_SEND frame's JSON is already capped by the 2,048-byte
    body admission (`limits.mjs:54`), so **no depth of any chain can approach 20,480 in a single scan**.
    The per-frame invariant (body cap 2,048 < window 20,480) holds at **any depth and any N** — the window
    never degrades on depth. The earlier "8 × 2,048 = 16,384 < 20,480" text was a **category error**: it
    compared *conversation materialization* (`_messages`, `coordinator.mjs:1190`) against a *per-scan*
    bound. It is withdrawn.
  - *Conversation bound (the real ceiling):* beyond 8 hops an exchange has either resolved or must
    escalate — a blocking need goes to DECISION_REQUEST (G11), persistent context goes to the scratchpad.
    8 is the smallest power of two strictly above the 3-deep acceptance exchange (RC-01) with headroom for
    the #94 four-surveyor broadcast pattern.
  - *Subtree materialization (target-state note):* under the per-member broadcast law (G4 target-state), a
    budget-B root to N members materializes up to N × B × 2,048 body bytes. The substrate spill ceiling is
    1 MiB (`limits.mjs:85`); a 64-member cell at budget 8 ≈ 1 MiB. This is a natural materialization
    throttle (the spill ceiling), **not** a per-branch control; the budget itself stays per-branch.
  - *Configurability (campaign law):* the per-send budget is declarable in `[1, 8]`; the 8 is a closed
    conversational ceiling, never a per-run throttle. All work below the ceiling is processed; the ceiling
    is a design constant, not an arbitrary cap.

### D2 — The chain shape: fields on the records, envelopes, and receipts

| Surface | Fields (all additive) |
|---------|------------------------|
| Root send record (`coordinator.mjs:6904-6910`) | keeps `depth: 0`; gains `budget` (declared ?? 1) and `remaining: budget` |
| Reply record (`coordinator.mjs:12578-12584`) | `depth` becomes `parent.depth + 1` (was the hardcoded `1`); gains `budget: parent.budget`, `remaining: parent.budget - (parent.depth + 1)`; keeps `inReplyTo`; **`target` inherits the parent's target verbatim** (`target: parent.target` — B-1) |
| Reply envelope (`coordinator.mjs:12571-12577`) | `{messageId, inReplyTo, from, body, depth, budget, remaining}` (spill shape unchanged: `spilled/bytes/digest/spill` ride alongside) |
| Receipt (`coordinator.mjs:6972-6994`) | the message's own `{depth, budget, remaining}`, plus existing `{delivered, read, actedOn, reply}`; `reply` is the envelope above; plus `lastRefusal` (B-5) |
| Send outcome (`coordinator.mjs:6961-6964`) | gains `budget` (the declared value; `depth: 0` / `remaining: budget` are derivable and not duplicated) |

- **Id minting is untouched.** The reply id mint
  (`canonicalDigest({inReplyTo, from, body, seq})`, `coordinator.mjs:12568-12571`) and the send id mint
  (`canonicalDigest({kind, to, body, seq})`, `:6904`) do NOT include `depth`/`budget`/`remaining` — those
  ride the records and envelopes only, so existing id derivation is byte-unchanged (G6). The `#114`
  impl-serialization discipline (canonical `sort()`-keyed digests) is preserved.
- **The reply wire frame stays closed** `{inReplyTo, body}` (G2). Budget is **send-side only**: a worker
  smuggling `budget` in a reply frame is rejected by the scanner's sorted-key check (`'body,inReplyTo'`,
  `claude-session.mjs:161`) and drops to prose — never a typed refusal (grammar-surface asymmetry kept
  on record, G12).
- **Parent authorization (B-2).** The reply admission resolves the parent through the coordinator-global
  `_messages` map (`coordinator.mjs:12509-12531`). Before the depth/slot checks, the replying worker must
  be a member of the parent's target run (or the parent is targeted at the worker). Concretely, the
  admission order becomes:
  1. frame shape (`message_frame_invalid`, `:12521`),
  2. caller-named `to` (`message_target_caller_named`, `:12525`),
  3. parent exists (`message_parent_not_found`, `:12530`),
  4. **run-membership authorization (NEW)** — the worker is admitted iff `parent.target.workerId ===
     workerId` OR the worker is a member of the run `messageRunId(parent)` resolves to; otherwise refuse
     **`message_target_not_member`** (new worker-stream code, D3),
  5. depth/slot (`message_depth_exceeded`, `:12534`).
  `message_parent_not_found` keeps its existing meaning (unknown parent id); `message_target_not_member`
  is the new distinct refusal for "parent exists but you are not a member of its run". Both are
  worker-stream events (D3) — neither is added to `stateFailureCode`.

### D3 — Refusal vocabulary and the two budget refusals

The message-lane coded refusals split by **reach**:

1. **Worker-reply refusals (stream events only, `message.rejected`, never MCP tool errors):**
   `message_frame_invalid`, `message_target_caller_named`, `message_parent_not_found`,
   `message_depth_exceeded`, **`message_target_not_member`** (new, B-2), `spill_body_exceeded`
   (`coordinator.mjs:12521, 12525, 12530, 12534, 12544`; the new code is emitted at the membership
   check inserted before `:12534`). They land on the worker's durable stream via `appendAttributed`
   (`:12513-12517`). Because they never cross the facade as thrown errors, **none are added to
   `stateFailureCode`** — do not guess otherwise. `message_depth_exceeded` stays depth-coded and is keyed
   on `parent.depth >= (parent.budget ?? 1) || parent.reply`; `remaining: 0` in its payload is the honest
   exhaustion signal, while a duplicate-reply refusal (slot law, G4) may carry positive `remaining` (the
   slot refused it, not the budget).
2. **Send-side refusal (thrown by the lane, crosses the facade → MCP → web):**
   **`message_budget_invalid`** — thrown by `coordinator.sendMessage` when a declared budget is not a safe
   integer in `[1, MAX_MESSAGE_DEPTH_BUDGET]`. It is the ONE new allowlisted code. This mirrors the
   existing `capability_budget_invalid` precedent (already allowlisted, `mcp-northbound.mjs:207`).
   - `stateFailureCode` (`mcp-northbound.mjs:198-261`) gains `message_budget_invalid` so it never
     collapses to `command_outcome_unknown`.
   - `web-northbound.mjs:149-232` (`dispatchFailure`) gains a `message_budget_invalid` branch →
     `httpStatus: 400`, code preserved (the same "command precondition failed" class as the
     `capability_*_invalid` family, `web-northbound.mjs:195-199`).
   - **Direct-ports resolution (B-5b): the lane is the single authority for budget validation** — both the
     safe-integer shape check and the range check live in `coordinator.sendMessage` and both throw
     `message_budget_invalid`. The facade (D6) passes `budget` through **raw** (normalizing absent → 1)
     and never refuses a budget value; the D3-table "shape vs range" split is dropped. This removes the
     direct-ports contradiction (a facade `application_message_send_invalid` for `budget: 1.5` would
     refuse a code the lane produces for the same input — forbidden by G7).
   - The other send-side results (`worker_spawning`, `worker_not_active`, `run_not_active`) stay returned
     **outcomes**, not thrown errors (`coordinator.mjs:6868-6902`) — unchanged by this contract.

### D4 — Receipts: every hop names parent, depth, remaining, and walks to the root's run

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

**Chain walkability (B-1).** The reply record **inherits the parent's target verbatim**
(`target: parent.target`) instead of minting `target: { workerId: parent.from === 'orchestrator' ? null :
parent.from }` (`coordinator.mjs:12580`). This makes every hop of a chain resolve to the **root's run**
via `messageRunId` (`coordinator.mjs:6995-7011`): an orchestrator-rooted send's reply record now carries
the root's own `{runId}` (or `{workerId}`) target instead of a null workerId, so `messageRunId` returns a
run, and the facade `run.message.receipt` (resolve-then-authorize, `application.mjs:12732-12747`) admits
the run's own orchestrator. Without this, the first hop r1 of any orchestrator-rooted chain resolves to
null and the receipt is refused as `application_unauthorized` for everyone (FP-05 pin,
`workflow-surface-red.test.mjs:637-660`) — the root→r1→r2→r3 walk dies at r1 in both directions. FP-05
itself is unchanged: an **unknown** id still resolves to null (resolve-to-null ≡ forbidden); the fix only
gives *known, run-owned* reply records a resolvable target. RC-06 is unachievable without this fix.

### D5 — Replay derivability: the durable records carry the chain

Today the chain's reply hops exist only in the in-memory `_messages` map (G6) and the in-memory worker
log; the store audit records only root sends and their per-worker deliveries (G5). The contract closes
that gap so a fresh coordinator can rebuild chain **topology** from durable records. **B-4 specifies the
replay fold's row→record mapping completely**:

- **Root sends:** the `message.sent` audit row (`coordinator.mjs:6913-6922`) gains `{depth: 0, budget,
  remaining: budget}`; each `message.delivered` per-worker row (`:6948-6957`) gains the same. Idempotency
  keys (`message.sent:<id>`, `message.delivered:<id>:<workerId>`) are unchanged. A `message.sent` row is
  a root seed **iff it has no `inReplyTo` field**.
- **Reply hops:** the reply admission additionally writes a durable audit row via
  `recordMessage('message.delivered', {messageId, inReplyTo, from, depth, budget, remaining, body}
  (spilled shape preserved), {actor, key: 'message.delivered:<replyId>:<workerId>'})` — beside the existing
  worker-log `appendAttributed` (`:12585-12589`). No new audit kind: `recordMessage` stays closed on
  `message.sent`/`message.delivered` (`coordination-store.mjs:13467-13482`). A `message.delivered` row is
  a reply seed **iff it has an `inReplyTo` field** (replies are distinguished from per-worker root
  deliveries by `inReplyTo` presence).
- **Legacy alias rows are skipped/defaulted (B-4).** The legacy alias send writes a **second**
  `message.sent` shape (`coordinator.mjs:7409-7421`): key `message.sent:<workerId>:<tail>`, digest
  `canonicalDigest({lane: true, workerId, kind, body, seq})`, no `depth`/`budget`/`remaining`, no
  corresponding `_messages` record. Replay must distinguish these by the `alias: true` field (and the
  `<workerId>:<tail>` key shape) and **skip them** — they are delivery aliases, not chain records; a
  mis-reconstruction would seed phantom roots.
- **`parent.reply` re-linking:** after seeding root and reply records, replay links each reply record to
  its parent by `inReplyTo` and fills `parent.reply` with the reconstructed envelope (the single slot at
  HEAD, G4). Under the per-member broadcast law (G4 target-state) a parent may have **multiple** reply
  rows (one per member); the mapping keeps them all (per-member reply collection keyed by `workerId`) and
  the single-slot `parent.reply` is only meaningful for single-reply parents — replay must not lose
  per-member rows.
- **What replay rebuilds:** a fresh coordinator replaying the store rows reconstructs each root and each
  reply hop with its parent link (`inReplyTo`), `depth`, `budget`, and `remaining` — the chain topology —
  from the **recorded** minted ids (G6: ids are not re-derived). The live receipt state machine
  (`delivered/read/actedOn`, and the new `lastRefusal`, D3) stays process-scoped, exactly as
  `coordination-store.mjs:8747-8750` documents; replay never fabricates delivery state. `_replay()`
  (`coordinator.mjs:13274`) does **not** seed `_messages` from store rows today — RC-07 requires new
  replay machinery implementing this mapping (red-first).

### D6 — The facade projection (#87 sibling): budget fields ride, table untouched

- `_normalizeMessageSend` (`application.mjs:12512-12537`): the closed key set gains `budget` →
  `['runId', 'workerId', 'kind', 'body', 'budget']`. **No budget-value validation at the facade (B-5b):**
  the value is passed through raw (the safe-integer shape check is **removed** from here — the lane is
  the single authority, D3), and normalized to a present integer `budget: value.budget ?? 1`. A
  non-safe-integer budget (e.g. `1.5`, `'3'`) passes the facade and draws `message_budget_invalid` from
  the lane — never `application_message_send_invalid` (direct-ports law, G7).
- `messageSend` facade (`application.mjs:12706-12730`): passes `budget` through to
  `coordinator.sendMessage({kind, to, body, budget}, ...)`; the returned `deepFreeze({ schemaVersion: 1,
  ...outcome })` carries the outcome's new `budget` field verbatim.
- `messageReceipt` facade (`application.mjs:12732-12747`): resolve-then-authorize unchanged
  (`messageRunId`, `application_unauthorized` on resolve-to-null); the returned receipt carries
  `{depth, budget, remaining}` and `lastRefusal` verbatim.
- The byte-stable `APPLICATION_COMMAND_DEFINITIONS` table and the direct-port dispatch order
  (`application.mjs:12294-12295, 12501-12510`) are **untouched**. The projection law is "reach, never
  semantics"; no facade-level semantic is introduced.

### D7 — MCP and web surfaces

- `baton_run_message_send` (`mcp-northbound.mjs:585-593`): `inputSchema` gains
  `budget: { type: 'integer', minimum: 1, maximum: 8 }` (optional, default 1; `maxLength` there remains a
  shape hint, never the authority — the body cap lives in `limits.mjs`). Capability class stays
  `['control', 'observe']` (`:108`). The description's body-cap prose is unchanged.
- `baton_run_message_receipt` (`mcp-northbound.mjs:594-600`): capability stays `['observe']` (`:109`);
  the description's receipt shape is updated to the depth-carrying shape (prose only; no code change).
- `stateFailureCode` (`mcp-northbound.mjs:198-261`) and the web mapper (`web-northbound.mjs:149-232`)
  gain `message_budget_invalid` per Decision D3. No other message codes are added (worker-reply refusals
  never cross these surfaces; `message_target_not_member` is worker-stream only, D3).
- The hand-rolled MCP guard for `baton_run_message_send` (`mcp-northbound.mjs:1110-1123`) does **not**
  validate `budget` — an out-of-range value passes to the lane and returns `message_budget_invalid`; a
  non-safe-integer also passes the guard and reaches the lane (B-5b's single authority). Consistent
  across facade/MCP/web.

### D8 — The DECISION-request boundary (routing rule)

The block between the message lane and DECISION_REQUEST is **blockingness and phase impact** (G11). The
worker-facing law is now stated so the rule is decidable from the wire (B-6):

- **Blocking follow-ups go to the existing interaction lane.** A worker whose follow-up BLOCKS its own
  next instruction — it cannot proceed without the input — raises it via the existing worker-side
  escalation path: `question.asked` with `blocking: true` → task `input_required`
  (`coordinator.mjs:12614-12631`). This is a worker-facing law this contract can state without new
  machinery: the interaction lane already exists, is one-pending-admission, and surfaces as a task state
  transition the orchestrator can see.
- **Conversational follow-ups go to the reply lane.** A follow-up that does not gate the worker's next
  step (the worker keeps working) is a **budgeted reply**. The reply frame stays closed `{inReplyTo,
  body}`; no machine-readable escalation marker rides it (RC-11).
- **The orchestrator never infers blockingness from a reply body.** A reply body is conversational by
  construction. If the orchestrator reads a reply and decides the matter became blocking, it escalates
  via a **decision gate** (its own `input_required` path) — never by re-rooting the same blocked chain.
- **Deadlock-recovery path (B-6).** A chain deadlock (A's reply asks B for X, B's reply asks A for Y,
  neither proceeds) is detectable because a genuinely *blocked* worker must raise `question.asked` →
  `input_required` (a task-visible interaction), not a prose reply. If an orchestrator observes a stalled
  chain with no pending interaction, the recovery is a **fresh root send** (the conversation re-roots with
  a new budget) or a **decision gate** (the matter escalated). The exhaustion signal
  (`message_depth_exceeded` with `remaining: 0`) and the new `lastRefusal` receipt field (D3) give the
  orchestrator the observation surface; the D9 monitoring note documents the residual cross-worker
  pure-conversation cycle as an orchestrator-polling concern, not a new waiting kind.

A reply chain **never** transitions a task phase; a decision gate **always** does. No new worker-facing
surface is introduced; the law is "blocking → interaction lane, conversational → reply lane".

### D9 — The #10 waiting-vocabulary interaction

A worker that has replied in a chain (no blocking interaction pending) reads `waitingOn: null` — mid-turn
working, not waiting on a kind. The chain's pending state lives in the **orchestrator's receipts**
(D4), never in the worker's `waitingOn`. Therefore:

- `WAITING_ON_KINDS` stays the closed five
  `['capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning']` (G9) —
  **no change**, no new kind.
- `BLOCKING_INTERACTION_KINDS` stays the closed three `answer_decision/answer_question/answer_approval`
  (G9) — a message reply is not an interaction kind, **no change**.
- **Deadlock visibility note (B-6, D8).** A cross-worker chain deadlock is invisible in `waitingOn` (both
  workers read `null`) only while both workers keep working. Under D8's law a genuinely blocked worker
  raises `question.asked` → `input_required`, which **is** visible (task state, `BLOCKING_INTERACTION_KINDS`).
  The residual — a pure-conversational cycle neither side escalates — remains an orchestrator receipt-polling
  concern; the exhaustion signal and `lastRefusal` (D3) make the stall observable. This is a monitoring
  gap, not a new-kind requirement.

### D10 — Acceptance suite homes

The red-first pins home as a dedicated suite `impl/test/reply-chains-red.test.mjs` (matching the
`<epic>-red.test.mjs` convention), with the surface pins in the existing northbound suites
(`phase16-mcp-northbound.test.mjs`, `phase12-web-northbound.test.mjs`). The B-2 membership pin and the
B-5 `lastRefusal` pin home in the reply-chains suite; the B-1 walkability pin homes in the facade
workflow-surface suite alongside FP-05/FP-18. The pinned green suites —
`bidirectional-v3-red.test.mjs` (C2), `tight-cell-red.test.mjs` (per-member slot law), the #87 facade
suite, and the #10 waiting-vocabulary suite — must run unchanged.

---

## 3. Refusal vocabulary (closed)

| Code | Reach | Payload | Fires when |
|------|-------|---------|------------|
| `message_depth_exceeded` | worker stream (`message.rejected`) | `{depth, budget, remaining}` | `parent.depth >= (parent.budget ?? 1)` (exhaustion, `remaining: 0`) OR `parent.reply` (duplicate reply per message, slot law) |
| `message_budget_invalid` | thrown by the lane → facade → MCP → web | code preserved; `command_outcome_unknown` never | declared budget not a safe integer in `[1, MAX_MESSAGE_DEPTH_BUDGET]` (single lane authority — shape AND range, B-5b) |
| `application_message_send_invalid` | facade | code preserved | any existing `_normalizeMessageSend` shape violation (unknown key, bad kind, body cap) — **never** a budget value (B-5b) |
| `message_parent_not_found` | worker stream | `{inReplyTo}` | reply names an unknown message id (unchanged) |
| `message_target_not_member` | worker stream | `{inReplyTo}` | parent exists but the replying worker is not a member of the parent's target run and the parent is not targeted at the worker (B-2) |
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
| RC-05 | **Budget non-integer → `message_budget_invalid` (single lane authority).** A send declaring `budget: 1.5` or `budget: '3'` refuses **at the lane** with `message_budget_invalid` — the facade passes the raw value through and never masks the lane's code with `application_message_send_invalid` (B-5b). | **RED** (no budget field; facade would not exist today) |
| RC-06 | **Per-hop receipts, chain walkable to the root's run.** `run.message.receipt` on each hop returns `{delivered, read, actedOn, reply, depth, budget, remaining}`; the reply envelope carries `{messageId, inReplyTo, from, body, depth, budget, remaining}`; the chain root→r1→r2→r3 is walkable **including the orchestrator-rooted first hop** (reply record inherits the parent's target, B-1). | **RED** (no depth fields; r1's receipt resolves to null via `target: {workerId: null}` at `coordinator.mjs:12580`) |
| RC-07 | **Replay rebuilds the chain.** A fresh coordinator replaying the durable `message.sent`/`message.delivered` rows reconstructs each hop's `{inReplyTo, depth, budget, remaining}` matching the live chain hop-for-hop; replies are distinguished from roots by `inReplyTo` presence; legacy alias `message.sent` rows (no depth/budget, `alias: true`) are skipped (B-4). | **RED** (reply hops not store-audited; no budget/remaining; alias rows undifferentiated) |
| RC-08 | **Facade carries the fields; table byte-stable.** `run.message.send` outcome carries `budget`; `run.message.receipt` carries `{depth, budget, remaining}`; `APPLICATION_COMMAND_DEFINITIONS` and the direct-port dispatch order are byte-unchanged; the projection law holds. | **RED** for the fields; the byte-stability half is pinned |
| RC-09 | **MCP/web surfaces.** `baton_run_message_send` accepts `budget` (`minimum: 1`, `maximum: 8`, optional); an out-of-range budget surfaces as `message_budget_invalid`; `baton_run_message_receipt` returns the depth fields; the web mapper maps `message_budget_invalid` to 400. | **RED** |
| RC-10 | **waitingOn stays null mid-chain.** A worker that has replied (no blocking interaction pending) reads `waitingOn: null`, is not `interaction`-blocked; `WAITING_ON_KINDS` and `BLOCKING_INTERACTION_KINDS` are byte-unchanged. | **GREEN** (pin) |
| RC-11 | **Wire asymmetry.** A reply frame naming `budget` (or any field beyond `{inReplyTo, body}`) is rejected by the scanner's sorted-key check and drops to prose — never a typed refusal, never a budget set by a worker. | **GREEN** (pin) |
| RC-12 | **Cross-run chain escape closed (B-2).** A worker holding a foreign `messageId` replying into another run's chain refuses `message_target_not_member` (stream event, never `message_depth_exceeded`, never a slot consumed, never a budget hop spent by a non-member); a member of the parent's run is admitted. | **RED** (no membership check; foreign reply lands today) |
| RC-13 | **Orchestrator-readable refusal surface (B-5a).** After a depth-exhaustion refusal, the parent's receipt carries `lastRefusal: {reason: 'message_depth_exceeded', depth, budget, remaining: 0}` through `run.message.receipt`; the honest handoff signal is observable without reading the worker stream. | **RED** (no `lastRefusal`; `message.rejected` is stream-only) |

---

## 5. Campaign-law constraints and non-goals

- **No clocks.** The budget is a count; `remaining` never ticks, no `deadlineAt`, no expiry (D1).
- **No new control surfaces.** The worker reply frame stays closed `{inReplyTo, body}`; the budget is
  send-side only. No per-run message caps, no turn limits — the budget is a per-branch depth cap,
  declared at send, bounded by a closed conversational ceiling (D1).
- **Direct-ports law.** The facade reaches, never decides semantics; the byte-stable table is untouched
  (D6, G7). The one new allowlisted code is `message_budget_invalid`; the lane is its single authority
  (shape AND range — B-5b). Worker-stream refusal codes are deliberately absent from `stateFailureCode`
  (D3); `message_target_not_member` is worker-stream only.
- **NUL-byte discipline.** The facade's `body.includes('\0')` rejection is unchanged
  (`application.mjs:12519`); `budget` is an integer, never body text.
- **No new waiting kinds.** The closed five and the blocking-interaction three are untouched (D9, G9).
- **Non-goals.** Send-side `inReplyTo` / orchestrator-addressable chain hops (OQ-1); reply-frame
  idempotency (the G12 asymmetry is owned elsewhere, cross-referenced, not fixed here); moving the live
  delivery state machine into the store (explicitly stays process-scoped, D5, G5); a machine-readable
  blocking marker on the reply frame (RC-11 — blocking goes to the interaction lane instead, D8).

---

## 6. Open questions

- **OQ-1 — Orchestrator-addressable chain hops.** **SOUND to defer** (red-team verdict). The contract
  routes conversation continuation to fresh root sends (D1). If lived choreography (a #94 successor)
  requires an orchestrator send that *continues* a chain — naming `inReplyTo` and inheriting/re-declaring
  the budget mid-chain — that is a send-envelope change (`_normalizeMessageSend` closed keys, MCP schema,
  lane) beyond this contract's surface. Note (red-team OQ-1): until B-1's target inheritance lands, the
  deferred design cannot serve multi-hop chains through the facade at all; and any future send-side
  continuation must adopt the D2 parent-authorization fix. Decide from demo evidence, not speculation.
- **OQ-2 — Reply-frame idempotency.** **SOUND to defer** (red-team verdict). G12's asymmetry (a duplicate
  `MESSAGE_SEND` frame mints a fresh reply id) is adjacent to this epic but owned by the grammar-surface
  ledger. The slot law already refuses duplicates before minting (`coordinator.mjs:12533-12535`), so
  duplicates do not consume budget hops under single-target chains, and a same-member duplicate stays
  refused under per-member slots. Worth one demo observation before deciding.
- **OQ-3 — Receipt `remaining` semantics for slot-law refusals.** **SOUND to keep shared code**
  (red-team verdict). D3 allows a duplicate-reply refusal to carry positive `remaining` (the slot refused,
  not the budget). The shared `message_depth_exceeded` code is kept for tight-cell byte-compatibility
  (G4) and the payload is honest instead. Caveat resolved by B-5a: the payload is now readable on the
  receipt via `lastRefusal`, not only the worker stream.

---

## 7. Verification

- **HEAD pinned:** `d7879f22f7d94df9a9b649561b19cde3f3d02ca9` (current worktree HEAD; `impl/src` tree
  byte-identical to the red-team's verified `a20493e`).
- **Evidence discipline:** every anchor in §1 was re-verified by `grep -an`/`sed -n` on the current tree;
  the NUL-bearing files were never read whole. Sorted-key literals appear only as verified (G9, §3).
  All post-6872 `coordinator.mjs` anchors are re-anchored **+16** from the v1.0 pin (B-7); the two
  off-by anchors (`application.mjs:12520` → `12519`, `mcp-northbound.mjs:204` → `207`) are corrected (B-7).
- **Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
