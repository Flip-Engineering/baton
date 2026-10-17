# #66 SUITE BRIEF — red-first suite for the folded doubt-review contract v1.1

You are drafting the **red-first acceptance suite** for the folded doubt-review contract. Read
fully, in order: (1) `doubt-review-contract.md` (**v1.1** — source of truth); (2)
`contract-fold.md` (the 7 blocker resolutions); (3) `contract-redteam.md` (the attack surface);
(4) idioms: `impl/test/kg-settlement-red.test.mjs` (the settlement ritual's suite) and
`impl/test/bidirectional-v3-red.test.mjs` (the collaboration lane).

## Coverage (from the v1.1 acceptance pins)

- **D1 elevation** — a doubt-kind scratchpad entry elevates to shared (the D4 selection change);
  a NON-doubt entry's elevation is byte-identical to today (no collateral change).
- **D2 the doubt record + lifecycle** — the durable doubt record carries provenance (worker,
  task, wave, the question verbatim, UNTRUSTED-framed everywhere it renders); the state machine
  (open → reviewed → answered/dismissed) receipts each transition, replay-exact; a double
  resolution refuses or dedups per the contract's rule.
- **D3 the queryable surface** — `knowledge.doubts`/`openDoubts` answers per the authority
  boundary the contract pins (orchestrator reads all; a worker reads its own wave's doubts per
  the boundary — never another run's); bounded with digest-cited spill.
- **D4 promote_doubt** — the answer/dismiss authority per the contract (who may resolve; a
  worker's self-resolution receipted distinctly; a forged resolution from a non-authority
  refuses by name).
- **D5 settle composition** — the review surfaces open doubts with their frames at settle; an
  unanswered doubt carries per the contract's rule (never silently dropped); the settle error
  path leaves the doubts intact.
- **D6 the answer push** — the resolution pushes to the DOUBTING worker's brief via the #79 lane
  (never a different worker).
- **Refusals** — every code the contract names, typed, surface-constant.

## Suite law

Red-first (every capability row fails at a NAMED stage at HEAD); namespace imports for invented
surfaces; hermetic (mock adapters, mkdtemp, test.after, no network); run TWICE from the repo
root, record the stable split; header carries the row inventory + stages + invented signatures +
verified split; sorted-key literals ACTUAL order; `localeCompare` banned; no clocks; NUL
discipline (`grep -an`/`sed -n` on the two NUL files).

## Deliverables (edit ONLY these)

`impl/test/doubt-review-red.test.mjs` ·
`docs/reference/evidence/doubt-review-2026-08-12/suite-draft-notes.md`.
