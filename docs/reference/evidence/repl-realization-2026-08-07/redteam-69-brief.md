# #69 RED-TEAM BRIEF — adversarial attack on the REPL-realization contract v1.0

You are the ADVERSARIAL RED TEAM for `repl-realization-contract.md` (v1.0, same dir — issue #69,
the REPL realization rung: cited context objects, tiered objects, worker manifests). Read it
FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1/D2 (the citation + cite-into-brief seam)** — can a cited object inject instructions into
   a worker's brief past the UNTRUSTED frame (the frame is the only thing between a cited
   attacker-controlled cell and the worker's instructions — is the frame actually applied at the
   render seam, byte-checked)? Can a huge cited object blow the frame budget (the #89 law:
   item-count/byte bound + digest-cited spill — is the spill resolvable by the worker)? Can a
   citation dangle (a binding whose cell never settles — what does the brief render: a typed
   absence or a crash)?
3. **D3 (admission authority)** — can a worker mint an orchestrator-scoped object (scope
   escalation through the manifest/binding path)? Cross-run/cross-wave reads (a workflow-tier
   object read by a different wave's member)?
4. **D4/D5 (tiers + promotion)** — can a task-ephemeral object outlive its task (GC honesty)?
   Can promotion skip the orchestrator review (the settlement ritual's candidacy is a PROPOSAL
   path, never auto-promote — verify the contract holds that)? Does a promoted object carry its
   provenance (which worker authored, which wave)?
5. **D6 (worker manifests)** — the review-by-projection: can a manifest smuggle a binding the
   projection doesn't show (a shadow field)? Is approval replay-safe?
6. **D7 (composition)** — the rendering order vs #79's pending-attention and #105's chains: can
   the sections push each other out of the byte budget (which yields? is the order pinned)?
7. **The no-arbitrary-code law** — is there ANY path where a REPL object's content is eval'd,
   `Function`'d, or executed (the docs/33:11 line)? A `specPath`-style loader that imports a
   `.mjs` would be the escape — check the loader discipline.
8. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/repl-realization-2026-08-07/contract-redteam.md`. Laws: no clocks;
every citation re-verified at the current HEAD.
