# #159 CONTRACT-FOLD BRIEF — fold the red-team into the contract

You are folding an adversarial red-team report into the #159 contract. Read fully, in order:
(1) `contract-redteam.md` (NOT FOLD-READY — numbered blockers at the end, each with its
concrete fix); (2) `doc-truth-conformance-contract.md` (v1 — your edit source).

## Deliverable

Write `contract-fold.md` (this dir) — the folded contract **v1.1**, self-contained, opening
with a fold-map table (finding → resolution → where in v1.1). Fold EVERY numbered blocker
with the red-team's concrete fix (choose where a choice is offered, and say why); fold the
non-blocking minors with their fixes; keep everything verdict'd SOUND byte-stable in
substance. Laws: no clocks; every citation re-verified at current HEAD (NUL discipline:
`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs`); sorted-key literals
ACTUAL order; `localeCompare` banned. Write ONLY `contract-fold.md`.
