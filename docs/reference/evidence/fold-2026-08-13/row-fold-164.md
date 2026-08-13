# ROW BRIEF — row-fold164: fold the #164 contract per its red-team + QA + top-orchestrator decision

Read `docs/reference/evidence/fold-2026-08-13/foundry-brief.md` first — it binds you. Your material:

- Contract: `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md` (FULL read)
- Red-team: `docs/reference/evidence/blind-waits-2026-08-13/redteam-164.md` (blockers led by the
  transport-principal recheck over-claim)
- QA: `docs/reference/evidence/review-foundry-2026-08-13/review-qa.md` §4 (esp. §4.4; verdict
  NEEDS-WORK — one amendment-class seam gap, the rest sound)

The QA's §4.4 fold instruction set:
1. Fix H1 — extend the durable-stop predicate to the settle-block (default) loop, not just the
   terminal loop; state it in D2's `run.wait` row and D3.1.
2. Add `application_wait_invalid` (existing) to the refusal table (H2).
3. Keep the RA6/RA7 pins, the FP-05 unknown≡foreign pin (A5), and the additive-only law as written.

**TOP-ORCHESTRATOR DECISION (law, apply):**
- **DR-1 (OQ2, durable-stop signal vs the terminal vocabulary):** option (a) — a wait-local
  terminal-truth helper only. Do NOT amend `applicationTerminal` (the #10/#74 closed vocabulary
  stays closed); the durable-stop signal rides the wait-local helper, and `stopping` stays
  non-terminal. State this explicitly where the contract names the vocabulary boundary.

Also fold the red-team's lead blocker honestly: the per-cycle transport-principal recheck was
over-claimed — the contract must state what IS delivered (post-wait/post-dispatch checks at the
cited seams) and add the wait-local durable-stop truth, not claim a mid-wait recheck that no
cited code performs.

Deliverables per the shared frame: the folded contract in place +
`docs/reference/evidence/blind-waits-2026-08-13/fold-164.md` (the blocker→resolution map,
attempt line verbatim in its header).
