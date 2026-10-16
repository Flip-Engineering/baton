# ROW BRIEF — row-readme: the README split + product rewrite (operator directive)

The current `README.md` mixes product description with campaign progress tracking — wrong
for both audiences. The operator's directive: a REAL project README + progress tracking in
its own doc, nothing lost.

**Read first:** `README.md` (current), `SYSTEM.md`, `GLOSSARY.md`, `impl/CLI.md`,
`impl/MCP.md` (the served surface truth), and `docs/00-brief.md` + `docs/04-architecture-options.md`
for the architecture spine. For current state ground truth: the git log (last 55 commits)
and `gh issue list --limit 40`.

**Your work (docs-only; never touch impl/):**
1. `docs/reference/progress-ledger-2026-08-14.md` — the progress/campaign content moved out
   of the README, cross-referenced; NOTHING deleted without a new home.
2. `README.md` rewritten as the product doc: what baton IS (the orchestration substrate:
   coordination store, fencing, content-addressed pins, waves/workflows, the DSL, the
   collaboration lanes), architecture diagram (ASCII or mermaid), quickstart, and a CLEARLY
   MARKED capability ledger with three tiers: LANDED (gate-verified) / IN-FLIGHT (waves
   running) / PLANNED (issues filed). Every capability claim must cite a suite, a doc, or an
   issue number — no aspirational prose presented as fact. The Flip persona/branding
   (docs/assets/brand/) gets a tasteful header reference.
3. `docs/reference/evidence/readme-split-2026-08-14/notes-row-readme.md` — what moved where,
   what you could not verify, judgment calls. `[attempt: <salt> row-readme]` verbatim in its
   first five lines.

**Scope discipline:** README.md + the progress doc + your notes ONLY. DECISION_REQUEST on
anything that wants code changes.
