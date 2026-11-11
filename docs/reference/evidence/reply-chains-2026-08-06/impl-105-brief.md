# #105 IMPL BRIEF — implement the reply-chains lane (conversational depth beyond 1)

Implement the #105 epic: make `impl/test/reply-chains-red.test.mjs` green with ZERO weakening
edits. Read fully, in order: (1) `reply-chains-contract.md` (**v1.1** — the folded contract);
(2) `impl/test/reply-chains-red.test.mjs` (26 tests: 6 green PINs, 20 red at named stages — every
row is your target; the header carries the invented-surface signatures); (3) `contract-fold.md` +
`suite-fold-2.md` (the folded oracles: B-1 the parent-target-run inheritance so the walk resolves
every hop under the resolve-then-authorize law; B-2 membership authorization BEFORE depth/slot
checks; B-3 the per-branch depth cap with the re-derived bound; B-4 the full replay row→record
mapping including the legacy alias row; B-5 the orchestrator-readable refusal surface + the lane
as the single budget authority; B-6 the machine-readable escalation).

## The shape (from the contract)

- **D1 budget model** — `depth >= budget` refuses (the depth-coded refusal carrying
  {depth, budget, remaining}); the budget is declared per send (default 1 — byte-identical to
  today, the A1 PIN); a declared budget outside [1, MAX] refuses AT SEND with
  `message_budget_invalid`; a non-integer budget refuses AT THE LANE (the lane is the single
  shape authority).
- **B-1 the walk** — the reply record inherits the parent's target run for authorization, so
  `messageRunId` resolves EVERY hop and the orchestrator reads her own chain (the FP-05 law
  holds: unknown ≡ foreign ≡ application_unauthorized, byte-identical).
- **B-2 membership** — the replying worker must be a member of the parent's run (or the parent's
  target) BEFORE the depth/slot checks, refusing `message_target_not_member` /
  `message_parent_not_found` (the ordering pinned).
- **B-3 per-branch cap** — sibling branches each get the full depth; the MAX bound is the
  contract's re-derived value.
- **B-4 replay** — a fresh coordinator rebuilds chain topology from durable records (replies by
  `inReplyTo` presence, `parent.reply` re-link, per-member multi-reply parents, the legacy alias
  row by the `alias: true` marker + key shape — never seeding a phantom root).
- **B-5 refusal observability** — the orchestrator-readable last-refusal surface carries a
  budget exhaustion.
- **B-6 escalation** — a blocking follow-up rides the interaction lane (never a reply chain);
  the marker is machine-readable.

## Laws + verify

Campaign law: no clocks as controls; scanners shape-only; `localeCompare` banned; sorted-key
literals ACTUAL order; NUL discipline (`grep -an`/`sed -n` on the two NUL files). **#141
boundary-commit law: commit at natural subsystem boundaries.** **Error payloads ride ONLY
lane-crafted codes (the GP7/GP8 lesson — if you touch the MCP error path, arbitrary typed
messages stay code-only).** If a row is unsatisfiable-as-written, write the contradiction to
`docs/reference/evidence/reply-chains-2026-08-06/impl-blocker.md` (IN your scope). Verify from
the repo root, ALL green, record the splits:
`node --test impl/test/reply-chains-red.test.mjs` (26/26) ·
`node --test impl/test/bidirectional-v3-red.test.mjs` ·
`node --test impl/test/workflow-surface-red.test.mjs` ·
`node --test impl/test/issue10-waiting-vocabulary-red.test.mjs`.

## Scope

`impl/src/**` · `docs/reference/evidence/reply-chains-2026-08-06/impl-blocker.md` · if the lane
adds an MCP tool or surface row (it should not need to — the lane extends the EXISTING message
ports), the generated artifacts (`impl/CLI.md`, `impl/MCP.md`,
`impl/scripts/surface-inventory-artifact.json`) are in scope AFTER regenerating. Do NOT edit any
other test file.
