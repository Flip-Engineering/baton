# notes — row-readme (the README split + product rewrite)

[attempt: 81778a60-c4e6-40a2-9809-32a46e054b3e row-readme]

Docs-only row. Deliverables: the rewritten product `README.md`,
`docs/reference/progress-ledger-2026-08-14.md`, and these notes. `impl/` untouched (verified
below). Base commit `09200e9`.

## What moved where (nothing deleted without a new home)

| Pre-split README content | New home |
|---|---|
| "Reading the status tiers" blockquote (the full red-first methodology note) | Condensed tier legend at the top of the README's **Capability ledger** section; the full text + the accounted-failure-set pointer moved to the progress ledger's "How to read the status tiers" |
| "What baton is" (run-centric fleet application paragraph, fleet list, coordinator paragraph) | Stayed in README, expanded into the substrate framing the operator asked for: coordination store (log-is-truth), fencing, content-addressed pins, waves/workflow interpreter, the DSL (#170), collaboration lanes — each with a citation |
| Architecture mermaid diagram + the three design paragraphs (one authority / waves / turns-not-gates / trust re-derived) | Stayed in README (product architecture). The "Waves are the unit of parallel work" paragraph was folded into the substrate bullets + the workflow-as-data ledger row; its steering-policy name list (`approveOnAdvertisedPlan`, …) moved to the progress-ledger-adjacent homes it already had in #114/#170 material rather than being restated |
| "Capabilities → Shipped" section | README **LANDED** tier — same rows, now every row carries a suite path, a doc, or an issue number (all paths verified to exist on disk) |
| "Capabilities → In flight" section | README **IN-FLIGHT** tier (condensed headline list) + the full staged roster in the progress ledger "In flight" section, carried with stage names intact |
| "Capabilities → Planned" section (the ~112-issue thematic map, all six thematic groups) | Progress ledger "Planned" section, carried in full with per-issue annotations updated where 2026-08-14 waves changed status (see judgment calls); README **PLANNED** tier is the headline form |
| "Run it" section | README **Quickstart** (unchanged commands + the new `waves compile` DSL line) |
| "Documentation map" | README documentation map, updated: progress ledger added as the second bullet; brand-assets link added |
| Banner div | Stays; the Flip persona got the tasteful header reference the operator asked for (one italic line under the banner + a documentation-map bullet + the LANDED-era banner itself is already the Flip mark, per docs/assets/brand/README.md) |

## What I could not verify (stated, not papered over)

1. **`gh issue list --limit 40` was unavailable in this worktree** (no network/credential —
   the call returned nothing). Issue numbers and their open/closed state are therefore as
   cited by the pre-split README, docs/PROGRESS.md, SYSTEM.md, and the git log at `09200e9`;
   they were NOT re-checked against the live tracker. The tier boundary between in-flight and
   planned should be re-audited against the live issue list before any external publication.
2. **Suite pass/fail state was not executed.** This is a docs-only row; I did not run
   `node impl/scripts/run-suite.mjs` (4054 tests, per the 2026-08-13 checkpoint). Every suite
   *path* cited was verified to exist on disk; the claim that LANDED rows are "pinned green"
   inherits the PROGRESS.md checkpoint, not a fresh run.
3. **#79's ship state is taken from docs/PROGRESS.md** ("SHIPPED (d8282d0) … suite 32/32,
   adjacents green, full gate accepted"), not from re-deriving the gate. Commit `d8282d0` is
   not in this worktree's recent log window I inspected; I trusted the ledger's citation.

## Judgment calls

- **#79 reclassified in-flight → LANDED.** The pre-split README's in-flight list still named
  #79, but docs/PROGRESS.md's 2026-08-13 checkpoint records it shipped. README and progress
  ledger both now show it LANDED; the reclassification is flagged explicitly in the ledger so
  the discrepancy is visible, not silent.
- **#170 (the workflow DSL) presented as LANDED**, not in-flight. Git log: `68163cf`
  "feat(#170): the workflow-DSL package LANDS — complete feature, gate-accepted" + both suites
  on disk. A fix wave for four adjacent regressions is packed/in flight — recorded in the
  ledger's 2026-08-14 wavefront, not used to demote the feature row.
- **Knowledge horizons split by path.** Write path + settlement (scratchpad #33, kg-settlement,
  boards #78) = LANDED; the read/activation arc (#24–#27/#186) = IN-FLIGHT per commit `30108cc`
  ("the knowledge plane's READ path; write-only = non-functional"). The pre-split README had
  the whole feature under Shipped and #24–#27 under Planned; both halves are now stated
  honestly at their own tier.
- **The control-surface honesty cluster (#155–#160) placed IN-FLIGHT**, not planned: red-first
  suites landed + folded and impl-honesty waves are running per the git log (`ed22930`,
  `e44d776`, `ee8bc8f`, `9b18ec1`). The pre-split README had these under Planned.
- **2026-08-14 impl dispatches (#149, #99/#179, #146, #161) listed IN-FLIGHT**: their commits
  (`09200e9`, `ac0f5bc`/`7e08216`, `cf298c2`, `f403096`) are "baton workflow base" wave
  bookkeeping — waves dispatched, landings not yet verified from the repo root. I did not
  promote them to LANDED on wave-commit evidence alone.
- **Fleet list updated to GLM 5.2/5.3** per `bf93263` + `impl/scripts/resident.deployment.mjs`
  (both models declared). impl/CLI.md's hand-written fleet table still shows only glm-5.2; I
  cited both sources rather than silently reconciling them. That table lives in impl/ and is
  out of my scope to touch.
- **Citation discipline:** every LANDED row names an on-disk suite, spec dir, or doc (all
  verified with a path-existence sweep — one broken link, `docs/33-agent-repl-layer.md`, was
  found and corrected to `docs/33-shared-objects-repl-layer.md`); issue numbers are cited as
  issue numbers. No capability row rests on prose alone.
- **Kept in README** (product, not campaign): the architecture diagram, the one-authority /
  turns-not-gates / trust-re-derived paragraphs, quickstart. **Moved out**: all stage
  bookkeeping, wave-by-wave campaign narrative, the full planned-issue catalog.

## Scope verification

- Files written: `README.md`, `docs/reference/progress-ledger-2026-08-14.md`,
  `docs/reference/evidence/readme-split-2026-08-14/notes-row-readme.md` (this file).
- `git status` at close: only those three paths modified/added; `impl/` untouched.
- The row's deployment verification command (`true`, cwd `.`, argv `[]`) exits 0 — it mirrors
  the resident deployment's verification binding (`{ command: 'true', arguments: [] }` in
  `impl/scripts/resident.deployment.mjs`), preserving route/result/cleanup truth for a
  docs-only change with no runtime effect.
