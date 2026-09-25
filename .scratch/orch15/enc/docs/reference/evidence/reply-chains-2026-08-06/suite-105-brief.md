# #105 SUITE BRIEF — red-first suite for the folded reply-chains contract v1.1

You are drafting the **red-first acceptance suite** for the folded reply-chains contract. Read
fully, in order: (1) `reply-chains-contract.md` (**v1.1** — source of truth); (2)
`contract-fold.md` (the 7 blocker resolutions — B-1 parent-target-run inheritance, B-2 membership
authorization, B-3 per-branch depth cap, B-4 the replay mapping, B-5 the refusal surface +
lane-as-authority, B-6 escalation marker, B-7 re-anchors); (3) `contract-redteam.md` (the attack
surface); (4) idioms: `impl/test/bidirectional-v3-red.test.mjs` (the message lane's own suite —
your rows extend its vocabulary) and `impl/test/workflow-surface-red.test.mjs` (facade staging).

## Coverage (from the v1.1 acceptance pins)

- **The budget model (D1)** — default-1 byte-identical to today; a declared budget within the
  bound rides; `depth >= budget` refuses with the depth-coded refusal; a declared budget outside
  the bound refuses AT SEND with the named code; the bound is a count (never a clock).
- **The walk (B-1)** — a root→r1→r2→r3 chain resolves EVERY hop through `messageRunId` under the
  resolve-then-authorize law (parent-target-run inheritance); the orchestrator reads her own
  chain's receipts.
- **Membership (B-2)** — a foreign worker's reply into another run's chain refuses with the named
  membership code BEFORE the depth/slot checks (ordering pinned).
- **Per-branch cap (B-3)** — two sibling branches each get the full depth; a branch cannot spend
  its sibling's hops; the MAX bound derivation the contract states is the one the suite pins.
- **Replay (B-4)** — a fresh coordinator rebuilds chain topology from durable records (the
  row→record mapping: `inReplyTo` presence, `parent.reply` re-link, per-member multi-reply
  parents, the legacy alias row).
- **Refusal observability (B-5)** — the orchestrator-readable last-refusal surface carries a
  budget-exhaustion; the lane is the single budget-validation authority (no facade double-gate).
- **Escalation (B-6)** — a blocking follow-up rides the marker/lane the contract names; the
  deadlock-recovery path is exercised.
- **Facade + MCP/web (D6/D7)** — budget fields ride the projection; the byte-stable table
  untouched; refusals surface-constant.

## Suite law

Red-first (every capability row fails at a NAMED stage at HEAD); namespace imports for invented
surfaces; hermetic (mock adapters, mkdtemp, test.after, no network); run from the repo root
TWICE, record the stable split; header carries the row inventory + stages + invented-surface
signatures + verified split; sorted-key literals ACTUAL sorted order; `localeCompare` banned; no
clocks; NUL discipline (`grep -an`/`sed -n` on the two NUL files).

## Deliverables (edit ONLY these)

`impl/test/reply-chains-red.test.mjs` ·
`docs/reference/evidence/reply-chains-2026-08-06/suite-draft-notes.md`.
