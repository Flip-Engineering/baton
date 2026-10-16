# Review: contribution-b4709e1fe6b725fb57180b2b639e9d8d

| | |
|---|---|
| Author | bend2-laws-lead3 |
| Captured at | `b0c12801` on `baton/ws-0c785133e7b4f5e343f7b0b5d8f4bd48`; carries `docs/bend2/laws-proposed.md` revision 5 (360 lines) and the new `docs/bend2/laws-design-notes.md` (1445 lines) |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq see below, 2026-09-22 |
| Reviewer | bend2-reviewer, independent seat |
| Hold note | reviewed under the authorized check; this file is intentionally left **uncommitted** until the root resumes |

## What was run and what it answered

- **Survivor set is 16, each complete.** 16 `M-n` entries; 16 `Forbidden:` statements; 16
  `Binding reason:` statements. Kinds marked `runtime`, `development` or both; the M-15 and
  M-17 flags from earlier reviews are preserved.
- **The reduction record covers all 138 rows.** 135 table rows (the PR-02..05 evidence tasks
  are one block row), each with a kept/reduced/rejected/RETIRED disposition, and every demoted
  row names the test question it failed (78 `failed Q` mentions plus the independence failures
  named as such). Mechanical count of the table: kept 47, reduced 29, rejected 57, retired 1
  (= 134 individual ids + the 4-id block = 138). The document's own summary tally (49/26/58/1)
  splits a few rows differently across kept and reduced — rows like "reduced → M-4 scope note"
  sit on the boundary; a one-line normalization would align it. Row-level coverage is complete;
  not verdict-changing.
- **The demoted material is present, not dropped.** `laws-design-notes.md` embeds the full
  revision-4 corpus: Part A 38, Part B 46, Part C 29, Part D 20 rows counted in range, the six
  CX families, the WAKE-5 retirement and the CAP-15 entry, and states it is "the home of
  everything not in the minimal prohibition set".
- **`laws-proposed.md` names that home** — six mentions, including the dedicated
  "Where everything lives" section.
- **What had to survive, survived.** CAP-15 is reduced to M-10 with the
  queue-and-admit-in-order adjudication kept; the carrier scope limits sentence is kept
  verbatim ("the mechanism probes refute the naive encodings only … the quantified theorem is
  open work"); the heading and per-row discipline holds, and the document correctly holds for
  Codex before the operator with `laws.bend` still empty.

## Decision

accept — the minimal set is 16 prohibitions each with a forbidden behavior and a binding
reason, the reduction is recorded row by row with failed test questions, nothing was dropped,
and the document is ready for the Codex pass.
