[attempt: 64cd747d row-readme]
# Row `row-readme` — README split + product rewrite: notes (2026-08-14, redrive3)

Row: `row-readme` — the README split per the operator directive (README = product doc;
campaign tracking = its own doc, nothing lost).
ObjectiveRef: `docs/reference/evidence/readme-split-2026-08-14/redrive3/row-readme-brief.md`.
Deliverables (exactly the brief's scope, nothing else):
`README.md`, `docs/reference/progress-ledger-2026-08-14.md`,
`docs/reference/evidence/readme-split-2026-08-14/redrive3/notes-row-readme.md` (this file).

## What moved where (the split map)

| README content (pre-split) | New home |
|---|---|
| "Project updates" blockquote — the dated campaign-report links (baton-update-2026-08-14, baton-campaign-state-2026-08-14, baton-foundry-day-2026-08-13, baton-24h-report) | progress-ledger §2 (Campaign reports) |
| "Reading the status tiers" — the full red-first methodology note (shipped/in-flight/planned, red-first suites exit nonzero by construction, the red set == the in-flight roster) | progress-ledger §3; README keeps a one-line pointer in the ledger header |
| The in-flight pipeline-stage vocabulary ("contract → adversarial red-team → fold → red-first suite → blue-team → fold → implementation") | progress-ledger §3 + §5 (the 12-stage law, the wave roster) |
| Current-checkpoint / campaign-state numbers (no-clock law, detached bus, uncapped fleet, DSL, foundry engine, gate 4054/3677) | progress-ledger §4 |
| The live wave fleet / pack roster (v19 fired packs, LANDED-WAVE-OK rows, in-flight evidence packs) | progress-ledger §5 |
| "Documentation map" campaign-era entries (reports, PROGRESS.md, evidence dirs, friction ledger) | progress-ledger §6 (cross-references), mirrored in README's own map |
| Capability tiers roster (Shipped / In flight / Planned) | retained in README as the three-tier capability ledger, now with per-claim citations (suite / doc / issue / commit) |

Nothing from the README was deleted: the ledger §1 records the same map and every pre-split
campaign line has a home there. The README retains the product spine (identity, architecture,
quickstart, capability ledger, doc map) plus a new Flip-brand header reference and a pointer to
the ledger.

## What I could not verify

1. **`gh` is unauthenticated in this worktree** (the spawn message warned; confirmed by
   `gh issue list` → "run: gh auth login"). I could not pull the live issue tracker, so every
   PLANNED/IN-FLIGHT issue citation comes from the repo's own sources: the git log (last 55
   commits), the campaign reports under `reviews/` (baton-update-2026-08-14.html,
   baton-campaign-state-2026-08-14.html), and the evidence packs under
   `docs/reference/evidence/`. Issue numbers cited in the capability ledger are those the repo's
   docs attribute; I did not re-verify them against GitHub.
2. **I did not run the canonical suite** (`node impl/scripts/run-suite.mjs`). The brief's scope
   is docs-only ("never touch impl/"), and `npm ci` would write `node_modules` outside the row's
   three-path scope. Gate counts and suite pass numbers are therefore *attributed* to their
   sources (the 2026-08-13 PROGRESS checkpoint and the 2026-08-14 campaign reports) rather than
   re-derived here. All suite *files* I cite were verified to exist by `ls` (`impl/test/…`).
3. **Landing-vs-gate status of the newest commits.** The git log shows `feat(#144)` and
   `feat(#161)` "LAND … to master" commits and the campaign report marks them "LANDED WAVE-OK on
   v18 … gate verification rides the flood's QA". I marked them LANDED (the impl commits exist)
   and cite the commit + the red-first suite that flips green on the landing; I did not re-run
   the gate to confirm the flip.
4. **The exact "waves run" invocation path extension.** The pre-split README said
   `baton waves run path/to/workflow.json`; the DSL (#170) and every `.wavefile` in the repo use
   a `.wavefile` extension. I used `.wavefile` and did not run the CLI to confirm the accepted
   filename pattern (grounded in the repo's own wavefile artifacts and the #170 report text).
5. **`docs/reference/README.md` index.** It has a per-dossier table; adding a row for the new
   progress ledger would be consistent but is outside the row's three-path scope, so I did not
   edit it.

## Judgment calls (recorded)

1. **Two ledgers, complementary.** The repo already had `docs/PROGRESS.md` (the oldest-first
   per-phase narrative). The operator's directive named `docs/reference/progress-ledger-2026-08-14.md`
   as the new home for the README's campaign content, so I made it the *current-state and
   campaign companion* (report index + methodology + checkpoint + live fleet), explicitly
   cross-linked to PROGRESS.md rather than duplicating the phase history. The notes file records
   this relationship so a reader doesn't expect a merged history.
2. **Capability tiers stay in the README.** The brief explicitly wants the capability ledger in
   the README (three tiers, cited). Only the *methodology* (how to read the tiers / why the gate
   is red) and the campaign narrative moved to the ledger.
3. **"Gate-verified" is defined by the repo's own honesty law.** The gate has red-by-design rows
   (declared in-flight pins), so "LANDED" means *green on the capability's own rows*, with the
   red set being exactly the in-flight roster. I stated this in the ledger §3 and the README's
   ledger header rather than implying a fully-green gate.
4. **PLANNED tier is thematic, not exhaustive.** The pre-split README's planned section was
   already thematic with a "lossless catalog" pointer; I kept that shape, refreshed with the
   campaign-state report's lane taxonomy (C1/C2/C3/C4/K/P/D/G/E) and newer issue numbers, and
   pointed to docs/28 + the issue tracker for the complete map. An exhaustive 100+-issue list
   would drown the product doc the brief asks for.
5. **IN-FLIGHT = waves with evidence packs or landed red-first pins.** I only listed items whose
   wave pack exists under `docs/reference/evidence/` or whose issue/suite is named in the git
   log; items the campaign report marks as still on launchers without a named pack are described
   as such.
6. **Brand reference is header-only and tasteful** per the brief: a two-line blockquote pointing
   at `docs/assets/brand/` and `docs/38-flip-experience.md`, no inline mascot art in the README
   body (the banner already carries Flip; machine channels stay clean per docs/38).
7. **Relative links verified against the tree.** Every link in the README/ledger resolves to a
   file or directory that exists at this worktree's HEAD (checked via `ls`/`test -e`).

## Scope discipline

- Wrote exactly three files: the README (rewritten), the progress ledger (new), these notes
  (new, in `redrive3/`). No `impl/` files, no suites, no other docs touched (`git status` shows
  only `README.md` modified + the two new files untracked).
- No push, no destructive commands. Deployment verification for this row is the execution
  contract's `true` (exit 0) executable — the row is docs-only and its acceptance is the
  reviewer's exact-contract check plus the coordinator's verify pass.
