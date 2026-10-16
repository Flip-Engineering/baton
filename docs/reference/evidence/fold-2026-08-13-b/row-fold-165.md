# ROW BRIEF — row-fold165: fold the #165 launch-validation contract

Read `docs/reference/evidence/fold-2026-08-13-b/foundry-brief.md` first — it binds you, INCLUDING
the blind-QA law (row report governs on conflict — the QA's §3 "SOUND with one amendment" was
written WITHOUT the row report; the row's four blockers stand). Your material:

- Contract: `docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md` (FULL read)
- Red-team: `docs/reference/evidence/contract-foundry-2026-08-13/redteam-165.md` — **4 blockers, all binding**:
  - C1 (exit-code miscite): restate the exit-code map (2 = launch/argument refusal, 1 =
    start-refused, receipt-carried harvest verdicts exit 0) and fix the `:96,192-198` anchor.
  - D2-H1 (the bare-path grammar is not closed — prose parses as a path): add a positive path
    shape (no whitespace, `/` or dot-bearing basename), refuse everything else
    `deliverables_malformed`, pin A3 with a whitespace-bearing prose line.
  - D1-H1 (no harvest-time blob backstop on the DRIVER surface): add the blob check to the
    driver's harvest loop (`run-task-wave.mjs:166-185`) or explicitly scope the
    driver-created-directory case out as a named follow-on distinct from OQ2.
  - D2-H4 (no deliverable-coverage check on the `waves.run` surface): extend the coverage
    predicate to the interpreter admission seam (parse the brief at `admitSpec`), or name the
    boundary honestly if the contract chooses driver-only with the interpreter gap recorded.
- QA: `docs/reference/evidence/review-foundry-2026-08-13-b/review-qa.md` §3 — the §3.4 set:
  H1 (one path-normalization pass before the D2 coverage set-difference; pin a `./`-prefix /
  duplicate-slash non-refusal case), the two nits ("four closed tokens" re-count; G2's `:138`
  claim → "a field read"), ship D1a/D1b (file-only law at launch on both surfaces), the
  `## Deliverables` strict grammar, D3's three-axis admission; name OQ2/OQ3 as follow-ons.

Deliverables per the shared frame: the folded contract in place +
`docs/reference/evidence/contract-foundry-2026-08-13/fold-165.md` (attempt line in the FIRST
FIVE lines).
