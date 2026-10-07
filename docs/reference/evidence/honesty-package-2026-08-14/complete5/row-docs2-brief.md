# ROW BRIEF — row-docs2: the doc-truth remainder (artifact counts + served-set honesty)

The recovered rows landed the doc body corrections; these legs remain RED.

**Read first:** `impl/test/doc-truth-conformance-red.test.mjs` stages R11 (committed artifact
counts match the admission and the parser dispatch) and R5's docs-side rows (every served row
compiles its Example AND taught Verb; the served set is honest — the CLI-side parser legs are
row-cli2's, yours is the docs/artifact side); the regenerated artifacts
`impl/scripts/surface-inventory-artifact.json` + `impl/scripts/surface-divergence-ledger.json`
(regenerate via `node impl/scripts/surface-conformance.mjs --write-inventory` AFTER the code
rows land — poll for their notes files, 30s cadence); the conformance script itself
`impl/scripts/surface-conformance.mjs`.

**Await-inputs discipline:** your R11 re-pin depends on row-cli2/row-web2's dispatch work
(the counts derive from admission + parser). Poll for `notes-row-cli2.md` and
`notes-row-web2.md` in this directory before finalizing the artifact; if a row stalls,
record it and DECISION_REQUEST rather than faking the counts.

**Your file partition:** `impl/MCP.md` is row-web2's — yours: `impl/CLI.md` is row-cli2's —
yours: `impl/scripts/surface-inventory-artifact.json` + `impl/scripts/surface-divergence-ledger.json`
+ `docs/reference/evidence/honesty-package-2026-08-14/**` ONLY. If R11 forces a docs-page
edit inside CLI.md/MCP.md, DECISION_REQUEST instead of crossing the partition.

**Acceptance:** R11 green (artifact counts honest); the full `doc-truth-conformance-red`
suite green at every named stage once row-cli2/row-web2 land; `surface-conformance.mjs`
reports ok. Notes: `docs/reference/evidence/honesty-package-2026-08-14/notes-row-docs2.md`
with `[attempt: <salt> row-docs2]` verbatim in the first five lines.
