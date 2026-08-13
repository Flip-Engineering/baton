# ROW BRIEF — row-lane-decision: exercise the DECISION_REQUEST lanes (scripted)

Read `foundry-brief.md` first (the lane laws bind you). Your job is to mint REAL
DECISION_REQUESTs and record exactly what happens to each.

## Script (perform both, in order)

1. **The policy-answered question.** Mint a DECISION_REQUEST asking VERBATIM:
   *"Which partition should the lane-evidence summary publish to?"* with options
   `[opt-shared: the shared partition]`, `[opt-worker: my worker partition]`,
   `[opt-ephemeral: task-ephemeral only]` and free response allowed. The wave's steering policy
   pattern-matches this question and answers `opt-shared`. Record: the requestId/decision key,
   the options as minted, the answer you received (and its provenance fields if visible), and
   whether your run PARKED until the answer arrived or continued speculatively.
2. **The deferred question.** Mint a second DECISION_REQUEST asking something the policy does
   NOT match (your choice — make it a real one, e.g. whether your report should include a
   redacted transcript appendix). Record: the question, that NO answer arrived, and what your
   run did instead (parked / continued without it / the lane refused). If you remain parked at
   wave end, your partial report file stands — write it BEFORE asking, and append after if you
   can.

## Then write your report

`docs/reference/evidence/lane-proof-2026-08-13/lane-decision.md`: per question — the full
exchange record, the settle/park behavior, and your verdict: PROVEN (the lane round-tripped)
/ GAPPED (what exactly failed) / PARKED-FOREVER (no answer, no escalation, no timeout honesty).
Attempt line verbatim in the first five lines.
