# ROW BRIEF — row-lsp-pool: the hub-managed LSP server pool (#144)

The suite is your contract: `impl/test/issue144-lsp-pool-red.test.mjs` (13 RED pins + 10
PINNED-green guards at HEAD). Read it in full first. It pins `impl/src/lsp-pool.mjs` — a
hub-managed, lazily-started pool, one server per repo+language, with bounded lifecycle and
honest unavailability (a missing server binary is a typed not-ready, never a hang). This is
the diagnostics tier's foundation: symbol-anchored citations and AST-level suite assertions
build on it.

**Your file partition:** `impl/src/lsp-pool.mjs` (new) + the seam the suite names (adapter
or atlas hub — read its imports) + `docs/reference/evidence/impl-lsp-pool-2026-08-14/**`.
Never touch application.mjs / workflow-*.mjs / northbounds / application-cli.mjs. Never edit
the acceptance suite. Hermetic discipline: the suite's fixtures fake the servers — your impl
must not require real LSP binaries at test time.

**Acceptance:** the suite's 13 RED pins green at their named stages with the 10 guards
unmoved; adjacents green-unchanged (paste counts for the suites the suite file itself names
as its neighbors, plus `adapter` 42/42). Notes:
`docs/reference/evidence/impl-lsp-pool-2026-08-14/notes-row-lsp-pool.md` —
`[attempt: <salt> row-lsp-pool]` verbatim in its first five lines. DECISION_REQUEST on
authority-class ambiguity.
