# FIX BRIEF — the #170 impl's adjacent regressions (fix wave, impl/src serialized)

You are the fix member for the #170 DSL package's follow-on. The package's implementation is
LANDED in your worktree's base (both target suites 35/35 + 12/12 green) — but it broke FOUR
adjacent suites that were fully green before it. Your bar: **all four back to green, both #170
suites still green, no assertion weakened anywhere** (a fix that deletes or softens a pin is a
regression, not a fix).

## The regressions (verified at pre-impl HEAD: 24/24 · 24/24 · 14/14 · 37/37 green)

1. **`impl/test/workflow-surface-red.test.mjs` — FP-14-tools (1 row).** It pins the ordinary
   MCP surface at 35 tools; #170's DR-2(a) MANDATES `baton_waves_compile` (36 now). Legitimate
   collateral: update the pin exactly as the impl member updated phase16/mcp-reflex/phase67/
   phase72/wave-observability (the tool in the definition position after `baton_waves_run` +
   the count); re-verify green.
2. **`impl/test/phase77-recursive-application-red.test.mjs` — RA2** ("public arguments and
   principals cannot inject recursive session or lease authority"): its validation function
   now returns false. The impl's #176 closure checks session-authority markers on the RAW
   context BEFORE normalization (impl-170-notes.md §3); the `command()` 5th-arg
   `rawOptions`/`_authorizeOverride` change is the other suspect. Fix the IMPL so RA2's
   injection-guard pin holds AND the addendum's PG-A/PG-B rows stay green.
3. **`impl/test/board-workerhalf-red.test.mjs` — 14 rows** (BW-03/04/05/06/08/12/13/15/16/17/
   18b/20: grants, scope refusals, CAS fences, restart durability, reads/paging). The board
   kernel is untouched — prime suspects: the `command()`/`_authorizeOverride` change or the
   waves.* raw-context gate catching a board-adjacent verb family. Diagnose from the failing
   assertions; fix the impl.
4. **`impl/test/kg-settlement-red.test.mjs` — KS5/KS6** (exactly-once re-drive; settlement-
   lease sweep). Same prime suspects.

## Method

1. Read `docs/reference/evidence/workflow-dsl-2026-08-13/impl-170-notes.md` §3 (the impl
   member's own decision record — the #176 placement and the command() override are named
   there) BEFORE touching code.
2. Reproduce each failure; name the mechanism per suite in your notes before fixing.
3. The craft laws bind: no clocks · `localeCompare` banned · sorted-key literals ACTUAL order ·
   byte literals only in `limits.mjs` · additive-only on closed vocabularies · NUL discipline
   (`grep -an`/`sed -n` on application.mjs + coordination-store.mjs; never whole-file reads;
   don't disturb NUL bytes) · generated docs REGENERATE, never hand-edit · boundary-commit law
   (your worktree only) · your `[attempt: <salt> <role>]` line VERBATIM in your notes' first
   five lines.
4. **Never weaken a suite.** The only permitted suite edit is FP-14's collateral count update.
   If you believe another row is wrong, DECISION_REQUEST with options instead.

## Acceptance (verify before you finish)

1. The four regression suites: `node --test impl/test/workflow-surface-red.test.mjs
   impl/test/phase77-recursive-application-red.test.mjs impl/test/board-workerhalf-red.test.mjs
   impl/test/kg-settlement-red.test.mjs` — back to 37/37 (with the FP-14 update), 14/14,
   24/24, 24/24.
2. The #170 suites still green: `workflow-dsl-red` 35/35 · `workflow-dsl-package-red` 12/12.
3. The other adjacents still green: `workflow-as-data-red` 30/30 · `wave-observability-red`
   30/30 · `control-surface-truth-red` 7/7 · `mcp-reflex-surface-red` 21/21 ·
   `phase16-mcp-northbound` 29/29 · `phase67`+`phase72` 32/32.
4. Write `docs/reference/evidence/workflow-dsl-2026-08-13/fix-170-notes.md`: the mechanism per
   regression, the fix, the split records, anything not fixed and why.
