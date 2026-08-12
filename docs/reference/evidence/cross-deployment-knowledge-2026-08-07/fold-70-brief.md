# #70 FOLD BRIEF — fold the red-team report into the cross-deployment-knowledge contract (v1.0 → v1.1)

You are folding an adversarial red-team report into the cross-deployment-knowledge contract.
Read fully, in order: (1) `contract-redteam.md` (NOT FOLD-READY — 8 blockers: 6 MAJOR, 2 MINOR,
plus the open-question verdicts marking OQ1 and OQ5 FOLD-BLOCKING); (2)
`cross-deployment-knowledge-contract.md` (v1.0 — your edit target).

## The blockers, headlined (fold ALL 8 + the two fold-blocking OQs)

- **OQ1 (promotion routing)** and **OQ5 (two declared primaries)** are fold-blocking per the
  report — resolve them now per its analysis.
- **B1 (MAJOR)** — "there is no second promotion path" is false; the primary-only refusal is
  wired incorrectly — fold the report's concrete fix.
- **B2 (MAJOR)** — the split-brain conflict detector is vacuous inside a repo (D1.1's repoId
  equality can't distinguish two roots) — fold the real discriminator.
- **B3 (MAJOR)** — the projection replay law is unspecified and the existing folds cannot replay
  cross-store events — fold the replay rule.
- **B4-B8** per the report (the remaining MAJORs + the 2 MINORs).

## Laws + deliverables

No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key
literals ACTUAL order; `localeCompare` banned. Header to **v1.1** with the fold note. Edit ONLY:
`cross-deployment-knowledge-contract.md` (v1.1) + `contract-fold.md` (blocker → change map, all
8 + the OQ verdicts) — this directory.
