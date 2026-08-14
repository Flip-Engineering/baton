# RE-DRIVE BRIEF — row-kernel-b: #158 the scratchpad WRITE lane (kernel + admission tables)

You are the kernel-seam impl row (re-driven; the first attempt died mid-flight). **Your
acceptance rows:** `impl/test/scratchpad-write-red.test.mjs` ALL green at named stages (the
kernel write path + the semantic-registry/web/MCP admission tables; the CLI-parser leg is
row-cli-b's). Never edit suites. PINs stay green; adjacents unmoved.

**Read first:** `docs/reference/evidence/scratchpad-write-2026-08-13/contract-fold.md` (your
authority — the kernel's `writeScratchpad` hardcoding `worker:<id>` is the root cause you
replace per the contract's closed semantics) · `impl/test/scratchpad-write-red.test.mjs` (your
rows) · the dir's redteam/fold notes (the WHY).

**You OWN:** `impl/src/coordination-store.mjs` (the write path) ·
`impl/src/application-semantics.mjs` (the append verb's registry row) · the append verb's
admission-table additions in `impl/src/mcp-northbound.mjs` + `impl/src/web-northbound.mjs`
(ONLY those tables — another row owns those files' error paths; stay out of them).

**Craft laws:** no clocks · localeCompare banned · sorted-key literals ACTUAL order · byte
literals only in limits.mjs · additive-only (the new verb + refusals APPEND) · NUL discipline
(`grep -an`/`sed -n` on coordination-store.mjs; don't disturb NUL bytes) · generated docs
regenerate, never hand-edit · work only in your worktree · your `[attempt: <salt> <role>]`
line VERBATIM in your notes' first five lines.

**Verify before you finish:** `node --test impl/test/scratchpad-write-red.test.mjs` green ·
`workflow-dsl-package-red` 12/12 · `mcp-profile-parity-red` still 8/13 at DESIGNED stages.
Write `docs/reference/evidence/honesty-package-2026-08-14/redrive/notes-row-kernel.md`.
