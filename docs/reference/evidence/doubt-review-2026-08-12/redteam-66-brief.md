# #66 RED-TEAM BRIEF — adversarial attack on the doubt-review contract v1.0

You are the ADVERSARIAL RED TEAM for `doubt-review-contract.md` (v1.0, same dir — issue #66,
elevated doubts need a queryable surface). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker. The A6 silent-sink
   ruling and the #63 settle-ritual anchors must resolve at the current HEAD.
2. **D1 (elevation)** — doubts now elevate to shared: can this re-create the A6 silent sink in
   a new costume (elevated doubt entries nobody queries)? Does the D4 selection change keep
   NON-doubt elevation byte-identical (no collateral behavior change)?
3. **D2 (the doubt record + lifecycle)** — can a doubt be answered twice (two resolutions race)?
   Can a doubt survive its wave's close without provenance (which worker, which wave — must
   carry)? Replay-exact from durable records?
4. **D3 (the queryable surface)** — `knowledge.doubts`/`openDoubts`: cross-run visibility (a
   worker sees ANOTHER run's doubts — the authority boundary: orchestrator-only or
   wave-scoped)? Bounded + digest-cited spill?
5. **D4 (promote_doubt)** — the answer/dismiss authority: who may resolve (orchestrator only?
   the doubting worker's own resolution — can a worker answer its own doubt and is that
   receipted distinctly)? A forged resolution from a worker (the #73 forge class)?
6. **D5/D6 (settle + the answer push)** — does a doubt vanish if the settle ritual errors
   mid-review? Does the #79 push deliver the ANSWER to the doubting worker (not a different
   one)? UNTRUSTED framing everywhere the question/answer renders?
7. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/doubt-review-2026-08-12/contract-redteam.md`. Laws: no clocks; every
citation re-verified at the current HEAD.
