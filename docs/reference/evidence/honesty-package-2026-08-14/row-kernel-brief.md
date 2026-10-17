# IMPL BRIEF — row-kernel: #158 the scratchpad WRITE lane (kernel + admission tables)

You are the kernel-seam impl row of the honesty-package wave. **Your acceptance rows:**
`impl/test/scratchpad-write-red.test.mjs` ALL green at named stages (its CLI-parser leg is
row-cli's; your rows are the kernel write path + the semantic-registry/web/MCP admission
tables). Never edit suites. PINs stay green; adjacents unmoved.

**Read first:** `docs/reference/evidence/scratchpad-write-2026-08-13/contract-fold.md` (your
authority — the shared-write contract; the kernel's `writeScratchpad` hardcoding `worker:<id>`
is the root cause you replace, per the contract's closed semantics), then
`impl/test/scratchpad-write-red.test.mjs` (your rows), then the dir's `redteam-158.md` /
`fold-158.md` / `fold-suite-158.md` (the WHY).

**You OWN:** `impl/src/coordination-store.mjs` (the write path) ·
`impl/src/application-semantics.mjs` (the append verb's registry row) · the command/admission
TABLE additions in `impl/src/mcp-northbound.mjs` + `impl/src/web-northbound.mjs` (the append
verb's admission rows ONLY — row-errors owns the error-rendering internals of those files;
stay out of their error paths).

**Craft laws:** no clocks · localeCompare banned · sorted-key literals ACTUAL order · byte
literals only in limits.mjs · additive-only on closed vocabularies (the new verb + its
refusals APPEND) · NUL discipline (`grep -an`/`sed -n` on coordination-store.mjs; don't
disturb NUL bytes) · generated docs regenerate, never hand-edit · work only in your worktree ·
your `[attempt: <salt> <role>]` line VERBATIM in your notes' first five lines.

**Verify before you finish:** `node --test impl/test/scratchpad-write-red.test.mjs` green ·
`impl/test/workflow-dsl-package-red.test.mjs` 12/12 · `impl/test/mcp-profile-parity-red.test.mjs`
still 8/13 at its DESIGNED stages. Write
`docs/reference/evidence/honesty-package-2026-08-14/notes-row-kernel.md`.
