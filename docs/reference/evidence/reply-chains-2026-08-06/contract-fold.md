# Contract fold #105 — red-team report → v1.1 contract

**Source:** `contract-redteam.md` (this directory; verification HEAD `a20493e`)
**Target:** `reply-chains-contract.md` v1.1 (this directory; verification HEAD `d7879f2`)
**Date:** 2026-08-06
**Verdict:** all 7 blockers folded; all 3 open-question verdicts applied. One blocker (B-6) is folded
as a worker-facing law + documented recovery path, not a new wire surface.

---

## Blocker map

### B-1 — Chain walkability dies at r1 via the null-target/FP-05 interaction

**Report:** the reply record mints `target: { workerId: parent.from === 'orchestrator' ? null :
parent.from }` (`coordinator.mjs:12580`), so the first hop of any orchestrator-rooted chain resolves to
null; `messageRunId` returns null; the facade's resolve-then-authorize refuses `application_unauthorized`
for every reader (FP-05: resolve-to-null ≡ forbidden). The root→r1→r2→r3 walk dies at r1 in both
directions.

**Fold — RESOLVED.** Decision D4: the reply record **inherits the parent's target verbatim**
(`target: parent.target`) instead of minting a workerId/null target. Every hop of a chain therefore
resolves to the root's run via `messageRunId`. FP-05 is unchanged — an *unknown* id still resolves to
null; only known, run-owned reply records gain a resolvable target. Acceptance pin RC-06 is reworded to
assert the orchestrator-rooted first hop specifically.

**Section touched:** D4 (chain walkability), D2 table (reply record `target` field), RC-06.

### B-2 — Cross-run chain escape is real today

**Report:** nothing authenticates the replying worker against the parent's run; a worker holding a
foreign `messageId` can reply into another run's chain, consuming the slot and spending budget hops.

**Fold — RESOLVED.** Decision D2 adds a **run-membership authorization** step to the reply admission,
before the depth/slot checks, with the concrete admission order: frame shape →
`message_target_caller_named` → parent exists (`message_parent_not_found`) → **membership (NEW:
`message_target_not_member`)** → depth/slot (`message_depth_exceeded`). The worker is admitted iff
`parent.target.workerId === workerId` OR the worker is a member of the run `messageRunId(parent)`
resolves to. The new code is a **worker-stream** event (D3) — deliberately not added to
`stateFailureCode`, since it never crosses the facade as a thrown error. RC-12 pins the closed escape.

**Section touched:** D2 (admission order + `message_target_not_member`), D3 (refusal table row), §3,
RC-12.

### B-3 — Budget is per-branch not per-subtree; MAX=8 derivation is a category error

**Report:** "per-root-subtree" is false under forking (a broadcast admits N first-replies); the MAX=8
derivation compared conversation materialization (8 × 2,048 = 16,384 < 20,480) against a per-scan window
bound.

**Fold — RESOLVED.** Decision D1: the budget is restated as a **per-branch depth cap** — each parent
bounds its own branch; a broadcast root admits N first-replies (per-member law, G4 target-state) each at
depth 1, so a subtree can materialize N × B hops while no single branch exceeds B. The MAX=8 derivation
is re-cast: the **per-frame invariant** (body cap 2,048 < scanner window 20,480) is the bound that
actually holds at any depth and any N; the 8 is a **closed conversational ceiling** (design constant, not
resource-derived). Subtree materialization under per-member slots is bounded by the 1 MiB spill ceiling
(`limits.mjs:85`) as a natural throttle — not a per-branch control.

**Section touched:** D1 (budget semantics + corrected derivation), G10, §5 non-goals.

### B-4 — Replay unspecified

**Report:** the durable audit records root sends only; reply hops live in the in-memory map and worker
log; replay cannot rebuild chain topology; the legacy alias send's second `message.sent` shape has no
depth/budget and no `_messages` record.

**Fold — RESOLVED.** Decision D5 specifies the replay fold's **row→record mapping completely**: roots are
`message.sent` rows with no `inReplyTo`; replies are `message.delivered` rows **with** `inReplyTo`
(distinguished by presence, not by kind — `recordMessage` stays closed on the two kinds); `parent.reply`
is re-linked by `inReplyTo`; per-member multi-reply parents keep all reply rows (target-state G4, replay
must not lose per-member rows); **legacy alias rows are skipped/defaulted** — distinguished by the
`alias: true` field and the `<workerId>:<tail>` key shape, never seeded as phantom roots. Replay rebuilds
topology from recorded minted ids, never re-mints ids; live delivery state stays process-scoped
(`coordination-store.mjs:8747-8750`). RC-07 asserts the whole mapping.

**Section touched:** D5 (full mapping), G5/G6 notes, RC-07.

### B-5 — Exhaustion signal unreachable + direct-ports contradiction

**Report:** (a) `message.rejected` is stream-only — no orchestrator-readable refusal surface; (b) a
facade `application_message_send_invalid` for a budget value would refuse a code the lane produces for
the same input (G7 direct-ports law).

**Fold — RESOLVED (both halves).**
- (a) **last-refusal on the receipt:** D3 adds `lastRefusal: {reason, depth, budget, remaining}` to the
  parent's receipt, projected verbatim through `run.message.receipt`. RC-13 pins it. OQ-3's caveat is
  resolved by this: the slot-law vs exhaustion distinction is readable on the receipt, not only the
  stream.
- (b) **lane is the single authority for budget validation:** D3/D6 — the safe-integer shape check is
  *removed* from `_normalizeMessageSend`; both shape and range throw `message_budget_invalid` from
  `coordinator.sendMessage`. The facade passes `budget` raw (absent → 1). RC-05 pins that `budget: 1.5`
  and `budget: '3'` surface as `message_budget_invalid`, never `application_message_send_invalid`.

**Section touched:** D3 (receipt field + single authority), D6 (facade raw pass-through), RC-05, RC-13.

### B-6 — Routing rule undecidable from the wire

**Report:** the DECISION-boundary rule reads as an orchestrator-inference duty with no decidable wire
signal, no escalation marker, and no documented deadlock-recovery path.

**Fold — RESOLVED as a worker-facing law + documented recovery (no new surface).** Decision D8: a
follow-up that **blocks** the worker's next instruction goes to the **existing interaction lane** —
`question.asked` with `blocking: true` → task `input_required` (`coordinator.mjs:12614-12631`) — not a
reply. Conversational follow-ups go to the reply lane; the reply frame stays closed `{inReplyTo, body}`.
The orchestrator never infers blockingness from a reply body; it escalates via its own decision gate.
Deadlock-recovery is documented: a stalled chain with no pending interaction recovers via a fresh root
send or a decision gate; the exhaustion signal + `lastRefusal` (B-5a) are the observation surface; D9
notes the residual pure-conversation cycle as an orchestrator polling concern. RC-11 pins the closed frame
(no escalation marker rides a reply).

**Section touched:** D8 (law + recovery), D9 (deadlock visibility note), RC-11, §5 non-goals.

### B-7 — Citation drift

**Report:** systemic +16 drift in post-6872 `coordinator.mjs` anchors; `application.mjs:12520` wrong →
`12519`; `mcp-northbound.mjs:204` wrong → `207`; G4 overstates a target-state (tight-cell Decision 5) as
ground truth.

**Fold — RESOLVED.** All `coordinator.mjs` anchors re-anchored +16 to the current tree (verified at
`d7879f2`, whose `impl/src` is byte-identical to `a20493e`); the two off-by anchors corrected; the
verification HEAD is re-pinned to `d7879f2`. G4 is demoted to **target-state, not ground truth**, with
its red pin cited. §7 records the discipline.

**Section touched:** §1 table (every anchor), G4, §7.

---

## Open-question verdicts (applied)

| OQ | Red-team verdict | Fold |
|----|------------------|------|
| OQ-1 — Orchestrator-addressable chain hops | SOUND to defer | **Deferred** (§6). Requires a send-envelope change (facade closed keys, MCP schema, lane) beyond this epic's surface. Notes B-1 as a prerequisite and the D2 authorization fix as a future-send requirement. Decide from demo evidence. |
| OQ-2 — Reply-frame idempotency | SOUND to defer | **Deferred** (§6). Owned by the grammar-surface ledger (G12). The slot law already refuses duplicates before minting, so duplicates don't consume budget hops under single-target chains. One demo observation before deciding. |
| OQ-3 — Receipt `remaining` semantics for slot-law refusals | SOUND to keep shared code | **Resolved** (§6, D3). Shared `message_depth_exceeded` code kept for tight-cell byte-compatibility (G4); `remaining: 0` is the honest exhaustion signal, positive `remaining` marks a slot refusal; B-5a's `lastRefusal` makes the distinction orchestrator-readable. |

---

## Deliberate non-changes (why nothing else moved)

- **`stateFailureCode`** gains exactly one code (`message_budget_invalid`); worker-stream codes
  (`message_target_not_member` among them) are deliberately absent — they never cross the facade (D3).
- **`WAITING_ON_KINDS` / `BLOCKING_INTERACTION_KINDS`** are byte-unchanged; no new waiting kind (D9).
- **`APPLICATION_COMMAND_DEFINITIONS` and the direct-port dispatch order** are byte-unchanged (D6).
- **`recordMessage`** stays closed on `message.sent`/`message.delivered`; reply hops ride the existing
  delivery kind, distinguished by `inReplyTo` (D5).
- **Id minting** is byte-unchanged; `depth`/`budget`/`remaining` ride records/envelopes/receipts only (D2).
