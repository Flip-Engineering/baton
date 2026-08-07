# #105 CONTRACT BRIEF — reply chains with a depth budget (conversational depth beyond 1)

You are drafting the implementation contract for issue #105 (reply chains with a budget).
Read fully, in order: (1) the issue — `gh issue view 105`; (2) the BD3-C message-lane artifacts:
`docs/reference/evidence/bidirectional-v3-2026-08-02/` (the v1 contract + fold — find the
depth-1 refusal decision and the envelope/receipt shapes); (3) the current message machinery:
`grep -an 'depth' impl/src/coordinator.mjs` and the message-send path, the MESSAGE_SEND wire
scanner (`coordination-store.mjs`), the facade projection (`#87` — application.mjs, grep -an);
(4) the #94 demo's lived evidence (`docs/reference/evidence/dynamic-workflow-2026-08-03/` —
the replies that RAISED questions).

## The contract must decide

- **The budget model**: `depth >= 1 refuses` becomes `depth >= budget refuses`, budget declared
  per message at send (default 1 — today's exact behavior), counted in the envelope, receipted
  per hop. The budget is a COUNT, never a clock (campaign law). Max-budget bound (a closed
  constant — pick it and justify; unbounded chains are a denial-of-conversation).
- **Refusal vocabulary**: the depth-exhaustion refusal stays depth-coded (name it); a declared
  budget outside the closed bound refuses at send with a named code; the budget field is
  closed-schema (unknown fields refuse).
- **Receipts**: every hop receipts the chain (parent messageId, depth, remaining budget); the
  chain is replay-derivable from durable records (no in-memory thread state).
- **The facade projection (#87 sibling)**: the projected receipt carries the budget fields;
  byte-stable table untouched (the direct-ports law).
- **The DECISION-request boundary**: when SHOULD a worker use a decision gate vs a budgeted
  reply? The contract states the routing rule (heavyweight blocking vs conversational
  follow-up) so workers stop guessing.
- **Interaction with #10 (waiting vocabulary, landing concurrently)**: a worker awaiting a
  reply in a chain reads as which waitingOn kind — or is it `interaction`? Say so.
- **Acceptance pins (red-first)**: a 3-deep exchange lands with per-hop receipts; budget
  exhaustion refuses with the named code; default-1 behavior byte-identical to today; replay
  rebuilds the chain; the facade projection carries the fields; the MCP/web surfaces carry them
  (the stateFailureCode allowlist consequences).

## Laws + deliverable

Ring-2 form (ground truths → decisions → refusal vocabulary → acceptance pins → open questions).
No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key
literals ACTUAL sorted order; `localeCompare` banned. Cross-reference (do not re-spec): #75,
#87, #10, #94, #114. Deliverable: ONLY
`docs/reference/evidence/reply-chains-2026-08-06/reply-chains-contract.md` (v1.0 DRAFT with the
verification HEAD).
