# ROW BRIEF — row-web2: the dispatch + briefing legs (web/MCP append dispatch, answer schema, initialize briefing)

The honesty package's kernel write path (appendScratchpad) and admission tables landed via
recovery; the drain truncated the dispatch legs. The acceptance suites are RED at exactly
your stages — turn them green, correctly.

**Read first:** `impl/test/scratchpad-write-red.test.mjs` stages A2-2, A3-1 (MCP + web append
dispatch to a receipt, never protocolError/`unsupported command`) and
`impl/test/doc-truth-conformance-red.test.mjs` stages R3, R8, R9 (renamed/refused answer
forms refuse invalid_arguments on both consumers; the initialize briefing names no non-MCP
command; the answer schema is decision-free and the guard covers fleet_run_answer);
row-kernel's recovered notes `docs/reference/evidence/honesty-package-2026-08-14/notes-row-kernel.md`
(the appendScratchpad contract: envelope closure, body bound, idempotency — dispatch MUST
route into it, never re-implement). NUL discipline on application.mjs / coordination-store.mjs
(`grep -an`/`sed -n` only).

**Your file partition:** `impl/src/application.mjs` (the `_commandDispatch` append branch
ONLY — additive) + `impl/src/mcp-northbound.mjs` + `impl/src/web-northbound.mjs` +
`impl/MCP.md` + `docs/reference/evidence/honesty-package-2026-08-14/**`. Never touch
application-cli.mjs/CLI.md (row-cli2's) or the deployment seam (row-deploy2's). Never edit
the acceptance suites. Watch the NUL bytes.

**Implement:** web + MCP `run_scratchpad_append` dispatch into the kernel appendScratchpad
with the envelope's auth plumbed through (A2-2/A3-1); the answer-schema corrections (R3/R9);
the initialize briefing honesty (R8); MCP.md matching served reality.

**Acceptance:** A2-2, A3-1, R3, R8, R9 green; `mcp-reflex-surface-red`,
`phase16-mcp-northbound`, `phase72-kimi-orchestrator-mcp` green (paste counts).
Notes: `docs/reference/evidence/honesty-package-2026-08-14/notes-row-web2.md` with
`[attempt: <salt> row-web2]` verbatim in the first five lines.
