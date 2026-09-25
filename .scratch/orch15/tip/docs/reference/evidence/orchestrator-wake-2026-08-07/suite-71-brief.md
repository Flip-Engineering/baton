# #71 SUITE BRIEF — red-first suite for the folded orchestrator-wake contract v1.1

You are drafting the **red-first acceptance suite** for the folded orchestrator-wake contract.
Read fully, in order: (1) `orchestrator-wake-contract.md` (**v1.1** — source of truth); (2)
`contract-fold.md` (the blocker resolutions: the two-cursor split — `storeCursor` +
`reasonsCursor`; the stable-identity `candidacy_review`; the drift/amendment items); (3)
`contract-redteam.md` (the attack surface); (4) idioms:
`impl/test/workflow-surface-red.test.mjs` (facade staging) and
`impl/test/issue10-waiting-vocabulary-red.test.mjs` (the waitingOn vocabulary's own suite — the
wake composes with it).

## Coverage (from the v1.1 acceptance pins)

- **D1 the wake primitive** — a waiter wakes on each closed wake-class (decision pending, plan
  advertised, attention addressed to the orchestrator, wave terminal, waitingOn→interaction);
  the long-poll cursor discipline is race-free (an event landing between the seq read and the
  wait registration is NOT missed); wake-with-nothing is an honest empty; the payload is bounded
  with digest-cited spill.
- **B1 (the two-cursor split)** — a return-trip orchestrator (wake → act → wake again with the
  prior cursors) still sees `member_terminal`/`candidacy_review` reasons (the mixed-cursor
  invisibility is dead); store items and attention reasons page independently.
- **B2 (stable candidacy)** — re-paging never fabricates a fresh candidacy_review reason (an
  honest empty stays empty); a count change refreshes it exactly once.
- **D2 decision-first** — the wake payload carries actionable items first (the pending decision
  with options, the advertised plan with its digest); answer-from-wake is idempotent
  (already_resolved on the second answer); a decision answered between event and delivery is
  revalidated (never delivered as actionable).
- **D3** — a worker principal cannot call the orchestrator wake (authority inversion refuses by
  name); two orchestrator waiters both wake (no claim-on-read).
- **D4 surface mapping** — the MCP long-poll discipline (maxWaitMs honest, cancellation real);
  the web transport bound receipted.
- **D5 (#105 composition)** — a reply-chain hop and a decision wake are machine-readably
  distinct in the payload.
- **Refusals** — every code the contract names, typed, surface-constant.

## Suite law

Red-first (every capability row fails at a NAMED stage at HEAD); namespace imports for invented
surfaces; hermetic (mock adapters, mkdtemp, test.after, no network); run TWICE from the repo
root, record the stable split; header carries the row inventory + stages + invented signatures +
verified split; sorted-key literals ACTUAL order; `localeCompare` banned; no clocks; NUL
discipline.

## Deliverables (edit ONLY these)

`impl/test/orchestrator-wake-red.test.mjs` ·
`docs/reference/evidence/orchestrator-wake-2026-08-07/suite-draft-notes.md`.
