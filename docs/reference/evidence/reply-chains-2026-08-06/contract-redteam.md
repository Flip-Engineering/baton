# #105 RED-TEAM REPORT — adversarial review of the reply-chains contract v1.0

**Subject:** `docs/reference/evidence/reply-chains-2026-08-06/reply-chains-contract.md` (v1.0)
**Date:** 2026-08-06
**Verified HEAD:** `a20493ee60ff578966674ae54ad9e176bbe74c1b` (current tree; the contract pins `ac3f9b6`)
**Brief:** `redteam-105-brief.md` (same directory)
**Method:** every citation re-verified by `grep -an`/`sed -n` at the current HEAD; the two NUL-bearing
files (`application.mjs`, `coordination-store.mjs`) were read by grep/sed only, per campaign discipline.
No clocks were introduced anywhere in this report.

**Bottom line:** **NOT FOLD-READY** — 7 numbered blockers (B-1..B-7). The budget-carrying surfaces
(D2 shape, D6 projection, D7 MCP/web) are mostly sound, but the chain-walk/receipt path (D4), the
parent-authorization posture (D2), the replay mechanism (D5), the exhaustion-signal reach (D3), the
D8 routing decidability, and the citation anchor drift each fail current-HEAD verification.

---

## 1. Citation re-verification (every anchor, current HEAD)

The contract's §1 ground truths and decision anchors were checked one by one. Content verifies in
every case; **line numbers drift in three places**, one of which is systemic.

| Anchor (contract) | Verified content | Line at current HEAD | Verdict |
|---|---|---|---|
| `coordinator.mjs:12488-12492` (BD3-C comment) | "the worker reply frame is closed — {inReplyTo, body} ONLY… Reply depth is 1 in v1" | **12504-12508** | content OK, **line drifts +16** |
| `coordinator.mjs:12517-12519` (depth check) | `if (parent.depth >= 1 \|\| parent.reply) refuse('message_depth_exceeded', {depth})` | **12533-12535** | content OK, **line drifts +16** |
| `coordinator.mjs:12505, 12509, 12514, 12518, 12530` (D3 refusal codes) | `message_frame_invalid`/`message_target_caller_named`/`message_parent_not_found`/`message_depth_exceeded`/`spill_body_exceeded` | **12521, 12525, 12530, 12534, 12544** | content OK, **lines drift +16** |
| `coordinator.mjs:12555-12567` (reply envelope + record) | envelope `{messageId, inReplyTo, from, body}`; record `depth: 1, inReplyTo`; `parent.reply = replyEnvelope` | **12573-12589** (`parent.reply =` at 12577, `depth: 1` at 12581) | content OK, **lines drift +16** |
| `coordinator.mjs:12553-12554` (reply id mint) | `canonicalDigest({inReplyTo, from, body, seq})` | **12568-12571** | content OK, **lines drift +16** |
| `coordinator.mjs:6889-6893` (send record `depth: 0`) | `message:<canonicalDigest({kind, to, body, seq})>`; `depth: 0` | **6903-6910** | content OK, **lines drift +16** |
| `coordinator.mjs:6895-6901` (`message.sent` audit) | `recordMessage('message.sent', {messageId, kind, from, to, body, targetCount})` | **6916-6925** | content OK, **lines drift +16** |
| `coordinator.mjs:6932-6937` (`message.delivered` per worker) | per-worker `record.deliveries.set` + `message.delivered` log + row | **6948-6957** | content OK, **lines drift +16** |
| `coordinator.mjs:6956-6973` / `:6979-6996` (`messageReceipt`/`messageRunId`) | the honest receipt + resolve-then-authorize accessor | **6972-6994 / 6995-7011** | content OK, **lines drift +16** |
| `coordinator.mjs:1190` (`_messages = new Map()`) | exact | **1190** | exact |
| `claude-session.mjs:152-166` (`scanForMessageSend`) + `:161` sorted-key `'body,inReplyTo'` | exact; regex `/^message:[a-f0-9]{64}$/u` | **152-166** | exact |
| `claude-session.mjs:34` = `limits.mjs:77` (`MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES` = `scanner.window.message_send` = 20_480) | exact | **34 / 77** | exact |
| `limits.mjs:53-71, 73-86`, `:54-55, :77, :85` (ADMISSION/SUBSTRATE; `message.send.body`=2048, `message.reply.body`=2048, `spill.body`=1 MiB) | exact | **as cited** | exact |
| `coordination-store.mjs:13464-13481` (`recordMessage`) | closed on `message.sent`/`message.delivered`, idempotency-keyed | **13467-13482** | exact |
| `coordination-store.mjs:8747-8750` (replay fold) | message rows appended, delivery state process-scoped | **8747-8750** | exact |
| `application.mjs:12501-12510, 12512-12537, 12539-12546, 12706-12730, 12732-12747` (projection header, normalizers, facades) | exact; `_normalizeMessageSend` closed on `['runId','workerId','kind','body']` | **as cited** | exact |
| `application.mjs:12294-12295` (direct-port dispatch order) | `run.message.send`/`run.message.receipt` dispatched ahead of the gate | **12294-12295** | exact |
| `application.mjs:12520` (NUL-byte rejection, §5) | `body.includes('\0')` → `application_message_send_invalid` | **12519** | **off by one even at the pinned HEAD** |
| `mcp-northbound.mjs:108-109, 585-600, 198-261` (capability classes, tool schemas, `stateFailureCode`) | `baton_run_message_send: ['control','observe']`, receipt `['observe']`; no `message_*` code mapped | **108-109, 585-600, 198-261** | exact |
| `mcp-northbound.mjs:204` (D3 `capability_budget_invalid` precedent) | allowlisted | **207** | **off by three even at the pinned HEAD** |
| `web-northbound.mjs:148-212` (`dispatchFailure`) | `capability_*_invalid` family → 400 | **148-212** | exact |
| `application-semantics.mjs:59-61` (`WAITING_ON_KINDS`) | closed five, frozen, ACTUAL sorted order | **59-61** | exact; matches landed `baecb18` |
| `wave-driver.mjs:189-191` (`BLOCKING_INTERACTION_KINDS`) | closed `answer_decision/answer_question/answer_approval` | **189-191** | exact |
| `bidirectional-v3-decisions.md:60-61` (G1) | "Reply depth 1 in v1… refuses with the depth code, never unknown-parent" | **as cited** | exact |
| `tight-cell-contract.md` GT 14 + Decision 5 (G4) | one-reply slot law + per-member broadcast law | **203-208 / 464-489** | exact as *law*; **per-member is not implemented at HEAD** (see C-4) |
| `impl/test/tight-cell-red.test.mjs:946-984` (G4) | per-member slot RED pin + depth-stays-1 pins | **as cited** | exact (red pin, title `per-member-reply-slot-missing`) |
| `impl/test/bidirectional-v3-red.test.mjs:502-524` (G13 C2) | refusal `includes('depth')`, not unknown-parent | **as cited** | exact |
| `dynamic-workflow-2026-08-03/control-surface-audit.md:115-118, 172` (G11) | send→BLUE reply→receipt round-trip; decision gate | **as cited** | exact |
| `dynamic-workflow-2026-08-03/run-dynamic-workflow.mjs:218-232, 300-308` (G12) | facade send/receipt verbs | **as cited** | exact |
| `dynamic-workflow-2026-08-03/grammar-surface-audit.md:98, 129` (G12) | MESSAGE_SEND has no idempotency guard | **as cited** | exact |
| `frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:32` (Seed) | "Reply depth 1… **#105** (budgeted reply chains)" | **as cited** | exact |

### Citation findings (all blockers under the brief's "wrong citation is automatic" rule)

- **C-1 (systemic line drift, blocker).** The contract pins Verification HEAD `ac3f9b6`, but the current
  tree is `a20493e`, whose `coordinator.mjs` gained 16 lines (the #10 D11 `settleSpawn` insertion at
  `coordinator.mjs:6872-6888`, `git diff ac3f9b6 a20493e -- impl/src/coordinator.mjs`). Every
  post-6872 coordinator.mjs anchor therefore drifts **+16** at the current HEAD. The content verifies
  at the shifted lines, but the contract's "every code anchor below was re-verified against the current
  tree at the verification HEAD" claim is stale — the anchors were verified at `ac3f9b6`, not at the
  current HEAD, and the brief demands current-HEAD verification.
- **C-2 (off-by-one).** `application.mjs:12520` (NUL rejection) is actually **12519** — wrong even at the
  pinned `ac3f9b6`.
- **C-3 (off-by-three).** `mcp-northbound.mjs:204` (`capability_budget_invalid` precedent) is actually
  **207** — wrong even at the pinned `ac3f9b6`.
- **C-4 (G4 overstates a target as a ground truth).** G4 states "One reply per message record —
  per-member for broadcasts" as verified truth. The per-member slot is a **red pin** at HEAD
  (`tight-cell-red.test.mjs:946-984`, title `per-member-reply-slot-missing`); the coordinator still
  holds a single `parent.reply` slot (`coordinator.mjs:12577`). G4's "re-verified at HEAD" wording
  describes a target state, not current reality. This matters for D1 (see B-3).

---

## 2. Decision-by-decision verdicts

### D1 — Budget model: **HOLE** (B-3)

**What holds.** Enforcement at send AND at relay is sound: budget is declared at send, validated there,
and the relay reads `parent.budget` from the parent *record*; the reply wire frame is closed
`{inReplyTo, body}` (scanner sorted-key `'body,inReplyTo'`, `claude-session.mjs:160`), so a worker can
never smuggle or tamper with budget mid-flight. A worker cannot mint a root (no send-side `inReplyTo`),
so *depth laundering by re-rooting at an old message* is impossible — every hop re-checks its own parent
against that parent's carried budget. Default-1 byte-identity holds: with `budget ?? 1`, C2
(`bidirectional-v3-red.test.mjs:502-524`) and the tight-cell per-member depth-stays-1 pins stay green.

**What fails.**
1. **Per-branch vs per-subtree.** The contract's own G4 assumes the tight-cell **per-member** broadcast
   slot law. Under that law, a budget-B root broadcast to N members admits N first-replies (one per
   member), each at depth 1 with the root's budget, and each can spawn its own chain to depth B. Total
   hops in the subtree can reach **N × B** — the budget binds per-branch, never per-root-subtree. The
   D1 law text ("the budget is per-root-subtree, declared at send") is false under forking. The
   brief's forking axis is real if per-member slots land.
2. **The MAX=8 derivation is a category error.** The stated resource bound is "8 × 2,048 = 16,384 body
   bytes < the scanner window 20,480 (`claude-session.mjs:34` = `limits.mjs:77`)". The scanner window
   bounds **one frame scan** — `extractFirstBalancedJsonObject(match[1], MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES)`
   — and a single MESSAGE_SEND frame's JSON is already capped by the 2,048-byte body admission, so no
   depth of any chain can approach 20,480 in a single scan. The 16,384 figure is *conversation
   materialization* (held in `_messages`, `coordinator.mjs:1190`), which the scanner never sees at once.
   The "resource-derived ceiling" therefore does not actually derive 8 from the window. Under forking the
   materialization is N × B × 2,048 (a 64-member cell at budget 8 ≈ 1 MiB — the spill ceiling,
   `limits.mjs:85`), so the closed constant has no honest derivation in the contract.

**Fix.** Declare explicitly that the budget is a **per-branch depth cap** (never a subtree hop total), and
re-derive MAX from the invariant that actually binds (per-frame body cap vs window — which holds at any
depth and any N), or add a subtree-hop ceiling if per-member slots land.

### D2 — Chain shape: **HOLE** (B-2)

**What holds.** The closed wire frame is sound: a smuggled `budget` (or any extra field) in a reply frame
fails the scanner's sorted-key check and drops to prose — never a typed refusal (RC-11 GREEN). The id
mint is untouched; depth/budget/remaining ride records and envelopes only.

**What fails — parent-reference integrity (cross-run escape).** The reply admission
(`coordinator.mjs:12503-12589`) resolves the parent through the **coordinator-global** `_messages` map
and checks only (a) frame shape, (b) `parent` exists, (c) depth/slot. There is **no run-membership or
target check** on the replying worker. Any worker that holds a foreign `messageId` can reply into
another run's chain: the reply lands in that parent's single `reply` slot, consumes one of that run's
budget hops, and is attributed (`from: workerId`) to a worker outside the run. Concretely:

- run Y's orchestrator reads a receipt whose `reply` envelope was authored by a non-member — foreign
  content entering run Y's chain (a prompt-injection surface if that chain feeds an orchestrator or a
  downstream worker);
- run Y's budget is spent by an actor outside its membership;
- within a run, any member that holds a broadcast `messageId` may reply even to a message *targeted* at
  a different worker — the per-member law is not implemented, and the single-slot law does not
  substitute for scope authorization.

The contract's RC-11 pin covers frame closure only; nothing in the contract adds parent authorization.
This is the brief's "cross-run chain escape" axis, and it is **unaddressed**.

**Fix.** Before the depth/slot checks, verify the replying worker is a member of the parent's target run
(or the parent is targeted at the worker); refuse with `message_parent_not_found` (existing, keeps the
code surface closed) or a new `message_target_not_member` otherwise.

### D3 — Refusals: **HOLE** (B-5)

**What holds.** The two budget refusals are distinguishable by code and reach: `message_budget_invalid`
is thrown by the lane and crosses facade → MCP → web (code preserved once the new allowlist entry and the
web 400 branch land; today an unmapped code collapses to `command_outcome_unknown` at
`mcp-northbound.mjs:261` and to **503** `temporarily_unavailable` at `web-northbound.mjs:251` — the D3
branches are genuinely needed and correctly specified). `message_depth_exceeded` stays a worker-stream
event only. The `remaining: 0` vs positive-`remaining` payload distinction (OQ-3) is honest: a
budget-exhaustion refusal on a depth-1/`budget:1` parent carries `remaining: 0`; a slot-law duplicate
refusal on a depth-0 root carries `remaining: 1`.

**What fails.**
1. **Internal inconsistency + direct-ports-law violation.** D3's §3 table says `message_budget_invalid`
   fires when "declared budget **not a safe integer** in [1, MAX]" — but D6 makes the facade refuse
   non-safe-integers as `application_message_send_invalid` before the lane ever runs. Since the lane is a
   public kernel API (direct callers, `coordinator.sendMessage`), the lane must still validate safe
   integers for direct callers — so `budget: 1.5` draws `message_budget_invalid` from the lane and
   `application_message_send_invalid` from the facade: the facade refuses a code the lane would produce
   for the same input, exactly what the direct-ports law (G7) forbids.
2. **The exhaustion signal is unreachable through the orchestrator's surfaces.** The handoff signal D8
   relies on ("the exhaustion refusal `message_depth_exceeded` with `remaining: 0`") is a worker-stream
   event, and **no facade/MCP/web surface exposes the worker's `message.rejected` events** (verified:
   `projectWaitingOn` reads only `health.stall_suspected` internally; nothing surfaces `message.rejected`).
   An orchestrator driving `run.message.receipt` only ever observes a `null` `reply` with no reason.

**Fix.** (a) Make the **lane** the single authority for budget validation (both safe-integer and range →
`message_budget_invalid`) and have the facade pass the raw value through, or document the lane check as
range-only with the safe-integer check facade-owned; (b) define an orchestrator-readable refusal surface
(e.g. a last-refusal field on the receipt, or a `message.rejected` projection on the run view) so the
exhaustion handoff is actually observable.

### D4 — Receipts / chain walkability: **HOLE** (B-1)

The D4 example table ("the chain is walkable root → r1 → r2 → r3 by following each receipt's
`reply.inReplyTo` back to the parent") is **false through the facade**, in both directions.

- A reply to an orchestrator-rooted send is minted with `target: { workerId: parent.from === 'orchestrator' ? null : parent.from }` (`coordinator.mjs:12580`) → `target: { workerId: null }`.
- `messageRunId` (`coordinator.mjs:6995-7011`) returns `null` for such a record (neither `runId` nor a
  string `workerId` present) → the facade `run.message.receipt` throws `application_unauthorized`
  (resolve-to-null ≡ forbidden, FP-05 pin, `workflow-surface-red.test.mjs:637-660`) **for everyone,
  including the parent run's own orchestrator**.
- So the first reply hop r1 (reply to the root) has an unreadable receipt. Walking forward
  (root→r1→r2→r3) requires r1's receipt to reach r2; walking backward (r3→r2→r1) also requires r1's
  receipt. Both die at r1.

`run.message.receipt` on a deeper hop (r2, r3 — whose `parent.from` is a worker id) does resolve, so the
failure is precisely the orchestrator-rooted hop. RC-06 is unachievable without a target fix.

**Fix.** The reply record must inherit the parent's target run for authorization (e.g.
`target: parent.target` when the parent is orchestrator-rooted, or a chain-root run resolution), so every
hop of a chain resolves to the root's run and its receipts are walkable.

### D5 — Replay derivability: **HOLE** (B-4)

**What holds.** The design correctly answers the brief's "envelope-only?" question: the durable
`message.delivered` row for a reply hop carries `inReplyTo` (the parent link) plus depth/budget/remaining
— so the chain is **not** envelope-only, and a lost envelope no longer orphans a hop. `recordMessage`
stays closed on `message.sent`/`message.delivered` (`coordination-store.mjs:13467-13482`), so no new
audit kind is needed.

**What fails — the reconstruction seam is unspecified and does not exist.**
1. The coordinator's `_replay()` (`coordinator.mjs:13274`) does **not** seed `_messages` from store rows,
   and the store replay fold (`coordination-store.mjs:8747-8750`) deliberately ignores message rows. RC-07
   ("a fresh coordinator replaying the durable rows reconstructs each hop") requires new replay machinery
   the contract never specifies.
2. There are **two** `message.sent` audit shapes: the direct lane
   (`coordinator.mjs:6916-6925`, `canonicalDigest({kind, to, body, seq})`) and the legacy alias send
   (`coordinator.mjs:7410-7419`, `canonicalDigest({lane:true, workerId, kind, body, seq})`, key
   `message.sent:<workerId>:<tail>`). The alias rows carry no `depth`/`budget`/`remaining` and no
   corresponding `_messages` record; replay must distinguish them or mis-reconstruct.
3. Under the per-member broadcast law (G4's assumption), a parent can have **multiple** reply rows —
   the single-slot `parent.reply` reconstruction cannot hold them.

**Fix.** Specify the replay fold's row→record mapping: which rows seed root records, which seed reply
records (distinguishing by `inReplyTo` presence), how `parent.reply` is re-linked, how per-member
multi-reply parents replay, and how alias rows are skipped/defaulted.

### D6 — Facade projection: **SOUND** (with notes)

- The byte-stable `APPLICATION_COMMAND_DEFINITIONS` table and the direct-port dispatch order are
  untouched (FP-18 pin, `workflow-surface-red.test.mjs:2094-2130`; `run.message.send`/`receipt` are not
  table keys). Verified.
- Budget fields survive the closed-shape filter: `_normalizeMessageSend` gains `budget` in its closed key
  set; `messageSend`/`messageReceipt` pass the fields through verbatim, preserving the FP-02 invariant
  (`Object.keys(facade) == Object.keys(lane) + schemaVersion`, `workflow-surface-red.test.mjs:516-520`).
- Notes, not holes: the facade's always-present `budget: value.budget ?? 1` changes the *normalized output
  shape* (no current suite pins that exact shape; FP-01's closure cases use non-budget extras, so they
  stay green); the D3 direct-ports tension over safe-integer validation lives here (B-5a).

### D7 — MCP / web: **SOUND** (with notes)

- `schema()` supports `minimum`/`maximum`; the hand-rolled MCP guard for `baton_run_message_send`
  (`mcp-northbound.mjs:1110-1123`) does **not** validate `budget`, so an out-of-range value passes to the
  lane and returns `message_budget_invalid` — consistent across facade/MCP/web. A non-safe-integer value
  passes the MCP guard and is caught by the facade's shape rule — consistent with the contract's D6 split.
- The web mapper's default for an unmapped code is 503 (`web-northbound.mjs:251`), confirming the D3 400
  branch is genuinely required, not defensive.

### D8 — DECISION-request boundary: **HOLE** (B-6)

The routing rule ("blocking → gate, conversational → chain") is **not decidable from the wire**:

- The reply frame is closed `{inReplyTo, body}` — it cannot carry a blocking marker.
- The contract makes the decision **orchestrator choreography** with "no worker-facing law changes", so a
  worker cannot force a gate; it can only write prose in a reply body.
- The brief's ambiguous case — *a follow-up that BLOCKS the orchestrator's next instruction* — lands
  exactly here: the orchestrator must infer blockingness from prose. Mis-inference deadlocks the worker
  (orchestrator sends a fresh root; the worker is actually blocked; the chain repeats the same blocking
  follow-up and burns budget until exhaustion).
- A real worker-side escalation path already exists (`question.asked` → task `input_required`,
  `coordinator.mjs:12596-12630`) but the contract neither wires it into the routing story nor tells the
  worker when to use it.

**Fix.** Route blocking follow-ups to the existing interaction lane (a worker-facing law the contract can
safely state), or define a machine-readable escalation marker in a reply; otherwise document the
inference and a deadlock-recovery path.

### D9 — #10 waitingOn interaction: **SOUND** (with a note)

- Verified against the current tree: `WAITING_ON_KINDS` is the closed five in ACTUAL sorted order
  (`application-semantics.mjs:59-61`), matching the landed `baecb18` commit; `BLOCKING_INTERACTION_KINDS`
  is the closed three (`wave-driver.mjs:189-191`). `projectWaitingOn` (`application.mjs:390-472`) returns
  `null` for a mid-turn working worker (no plan approval, no spawn, no pending task, no stall), so a
  chain-replying worker reads `waitingOn: null`. No new kind is needed; a chain's pending state stays in
  the orchestrator's receipts.
- **Note (deadlock invisibility).** No waitingOn kind encodes a chain-wait, so a **cross-worker chain
  deadlock** (A's reply asks B for X, B's reply asks A for Y, neither proceeds) is invisible: both
  workers read `waitingOn: null`. The contract places detection entirely on the orchestrator's polling of
  receipts; nothing signals that a cycle exists. This is a monitoring gap, not a new-kind requirement.

---

## 3. Open questions and non-goals — verdicts

| Item | Verdict | Why |
|---|---|---|
| **OQ-1** (send-side `inReplyTo`) | SOUND to defer | Keeping the send envelope closed is consistent. But note: until B-1 (D4 target fix) is done, the deferred design cannot serve multi-hop chains through the facade at all; and any future send-side continuation must adopt the D2 parent-authorization fix. Decide from demo evidence, as the contract says. |
| **OQ-2** (reply-frame idempotency) | SOUND to defer | The slot law already **refuses** duplicate replies before minting (the depth/slot check precedes minting at `coordinator.mjs:12533-12535`), so duplicates do not consume budget hops under single-target chains, and a same-member duplicate stays refused under per-member slots. The G12 asymmetry (no `idempotencyKey` on MESSAGE_SEND) is unchanged and still owned by the grammar-surface ledger. |
| **OQ-3** (receipt `remaining` for slot refusals) | SOUND to keep shared code | The `remaining: 0` vs positive payload is honest. Caveat: the payload is only readable on the worker stream (B-5b); no facade surface can currently show it. |
| Non-goal: no clocks | **Respected** | Budget is a count; `remaining` decreases only when a hop lands. No `deadlineAt`, no expiry anywhere in the contract. |
| Non-goal: no new control surfaces | **Respected** | Reply frame stays closed; budget is send-side only. |
| Non-goal: direct-ports law | **Violated as written** | The D3 table (lane rejects non-safe-integers) vs D6 (facade rejects non-safe-integers) splits one input across two codes — a direct-ports-law violation (B-5a). |
| Non-goal: NUL discipline | **Respected** | `body.includes('\0')` rejection unchanged (`application.mjs:12519`); `budget` is an integer, never body text. |
| Non-goal: no new waiting kinds | **Respected** | Closed five and closed three untouched (D9). |

---

## 4. Final verdict: **NOT FOLD-READY** — numbered blockers

Each blocker = what + why + the concrete fix. Any one of B-1..B-7 blocks the fold; the citation blockers
(B-7) are automatic under the brief's "wrong citation is a blocker" law.

- **B-1 (D4 — chain walkability is false).** A reply to an orchestrator-rooted send is minted with
  `target: { workerId: null }` (`coordinator.mjs:12580`), so `messageRunId` resolves to null and the
  facade refuses that hop's receipt as `application_unauthorized` (FP-05) for everyone — including the
  run's own orchestrator. The root→r1→r2→r3 walk (D4, RC-06) dies at r1 in both directions. **Fix:** the
  reply record must inherit the parent's target run for authorization so every hop resolves to the root's
  run.
- **B-2 (D2 — cross-run chain escape).** The reply lane has no run-membership/target authorization on the
  parent (`coordinator.mjs:12503-12589`); any worker holding a foreign `messageId` can inject a reply
  into another run's chain — polluting its receipts with foreign content, consuming its budget hops, and
  spending its single reply slot. **Fix:** verify the replying worker is a member of the parent's run
  (or the parent is targeted at the worker) before the depth/slot checks, refusing
  `message_parent_not_found` or a new `message_target_not_member`.
- **B-3 (D1 — budget is per-branch, not per-root-subtree; MAX=8 has no valid derivation).** Under the
  contract's own per-member broadcast assumption (G4), a budget-B root to N members admits N×B hops; the
  "per-root-subtree" law and the "8×2,048 < 20,480 scanner window" derivation are both wrong (the window
  bounds one frame scan, never a chain). **Fix:** state the budget is a per-branch depth cap and re-derive
  MAX from the per-frame invariant (or add a subtree-hop ceiling).
- **B-4 (D5 — replay mechanism is unspecified and absent).** RC-07 requires a fresh coordinator to rebuild
  chain topology, but `_replay()` (`coordinator.mjs:13274`) does not seed `_messages`, the store fold
  ignores message rows, the legacy alias send writes a second `message.sent` shape
  (`coordinator.mjs:7410-7419`) with no depth/budget, and per-member slots break single-slot `parent.reply`
  reconstruction. **Fix:** specify the replay fold's row→record mapping (distinguish replies by
  `inReplyTo` presence, re-link `parent.reply`, handle per-member multi-reply parents and alias rows).
- **B-5 (D3 — exhaustion signal unreachable; direct-ports split contradicts D3's own table).** (a) No
  facade/MCP/web surface exposes the worker's `message.rejected` events, so the "honest handoff signal"
  D8 depends on cannot be observed by the orchestrator; (b) the D3 table says the lane rejects
  non-safe-integers while D6 makes the facade reject them first — the facade would refuse a code the lane
  would produce for the same input (direct-ports violation). **Fix:** (a) add an orchestrator-readable
  refusal surface (e.g. last-refusal on the receipt); (b) make the lane the single authority for budget
  validation, or document the lane check as range-only.
- **B-6 (D8 — the routing rule is not decidable from the wire).** The closed reply frame carries no
  blocking marker; the contract's "no worker-facing law changes" leaves the orchestrator inferring
  blockingness from prose, and a mis-inference deadlocks the worker with no force-a-gate path. **Fix:**
  wire blocking follow-ups to the existing interaction lane or define a machine-readable escalation
  marker; otherwise document the inference and a deadlock-recovery path.
- **B-7 (Citations — drift at the current HEAD).** (a) All post-6872 `coordinator.mjs` anchors drift +16
  at `a20493e` (settleSpawn insert); (b) `application.mjs:12520` is actually 12519 and
  `mcp-northbound.mjs:204` is actually 207, wrong even at the pinned `ac3f9b6`; (c) G4 cites the
  per-member broadcast slot as verified truth when it is a red pin. **Fix:** re-anchor every citation at
  the current HEAD, re-pin the verification HEAD, and mark G4 as target-state (tight-cell Decision 5), not
  a verified ground truth.

---

## 5. Evidence discipline note

All anchors above were re-verified by `grep -an`/`sed -n` on the current tree
(`a20493ee60ff578966674ae54ad9e176bbe74c1b`). `application.mjs` and `coordination-store.mjs` were read
by grep/sed only (both carry NUL bytes, confirmed via `od`). No clocks were used. The deployment
verification command for this worktree is `true` with no arguments (expected exit 0) — the deliverable
here is this report, which edits only `docs/reference/evidence/reply-chains-2026-08-06/contract-redteam.md`.
