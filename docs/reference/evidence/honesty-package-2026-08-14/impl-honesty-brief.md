# IMPL BRIEF — the HONESTY PACKAGE (②): #157 + #158 + #159 + #160, one landing

You are the impl member for the campaign's surface-honesty package: four folded contracts,
four blue-teamed+folded red-first suites, ONE landing. **Acceptance bar: every capability row
in all four suites green at its named stage; every PIN row stays green; the adjacents stay
green; the full gate's failure set does not grow beyond the documented red-by-design + flake
sets.**

## Read first (in order)

1. The four contracts (all FOLDED, the authorities):
   - `docs/reference/evidence/cli-wave-fidelity-2026-08-13/contract-fold.md` (#157 — CLI wave
     fidelity: no advertised-but-dead verbs; interpreter-wave registry fidelity)
   - `docs/reference/evidence/scratchpad-write-2026-08-13/contract-fold.md` (#158 — the
     scratchpad WRITE lane: members can publish; the kernel's `writeScratchpad` hardcoding
     `worker:<id>` is the root cause the contract answers)
   - `docs/reference/evidence/doc-truth-conformance-2026-08-13/contract-fold.md` (#159 —
     documented ⇄ parsed ⇄ admitted three-way conformance)
   - `docs/reference/evidence/error-actionability-2026-08-13/contract-fold.md` (#160 — the
     error actionability triple {code, field/cause, next action} across web/MCP/CLI)
2. The four suites (your acceptance machinery — read every row's stage + assertion):
   `impl/test/cli-wave-fidelity-red.test.mjs` · `scratchpad-write-red.test.mjs` ·
   `doc-truth-conformance-red.test.mjs` · `error-actionability-red.test.mjs`
3. Each evidence dir's `redteam-*.md` / `fold-*.md` / `suite-draft-notes.md` /
   `fold-suite-*.md` (the attack surfaces and the fold resolutions — the WHY).

## The craft laws (binding)

No clocks · `localeCompare` banned · sorted-key literals ACTUAL order · byte literals only in
`limits.mjs` · additive-only on closed vocabularies · NUL discipline: application.mjs +
coordination-store.mjs are NUL-bearing (`grep -an`/`sed -n` only; don't disturb the NUL bytes)
· generated surface docs REGENERATE via the shipped generators, never hand-edit ·
boundary-commit law (#141): work commits in your worktree; never touch the operator's main
checkout · your `[attempt: <salt> <role>]` line VERBATIM in your notes' first five lines ·
never edit the suites — a wrong row is a DECISION_REQUEST with options.

## Acceptance (verify before you finish)

1. The four suites: `node --test impl/test/cli-wave-fidelity-red.test.mjs
   impl/test/scratchpad-write-red.test.mjs impl/test/doc-truth-conformance-red.test.mjs
   impl/test/error-actionability-red.test.mjs` — all green.
2. Adjacents green-unchanged: `workflow-dsl-red` (35/35) · `workflow-dsl-package-red` (12/12) ·
   `workflow-as-data-red` (30/30) · `wave-observability-red` (30/30) ·
   `control-surface-truth-red` (7/7) · `mcp-profile-parity-red` (8 pass / 13 red-by-design —
   its #156 impl is a LATER package; its rows must fail at their DESIGNED stages only) ·
   `blind-waits-red` (23/11 by design) · `orchestrator-plan-object-red` (5/42 by design).
3. Write `docs/reference/evidence/honesty-package-2026-08-14/impl-honesty-notes.md`: decisions,
   per-suite split records, the per-issue mechanism summary, anything not green and why.
