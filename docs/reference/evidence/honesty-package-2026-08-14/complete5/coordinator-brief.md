# COORDINATOR BRIEF — honesty completion wave (wave-c)

You are the coordinator and acceptance gate for the honesty package's completion. The four
recovered rows' work is already in the tree (patches at
`docs/reference/evidence/honesty-package-2026-08-14/recovered/`, applied). Four rows finish
the drain-truncated legs: row-cli2 (CLI parser legs), row-web2 (dispatch/briefing legs),
row-deploy2 (the _authorize restrictor), row-docs2 (artifact-count honesty).

**Await-inputs discipline:** poll (30s cadence) for the four `notes-row-*.md` files in this
directory's parent (`docs/reference/evidence/honesty-package-2026-08-14/`), then run the
acceptance below. If a row parks on a decision in your authority, answer it per its options.

**Acceptance (every claim cited — suite output, anchors, event ids):**
1. `node --test impl/test/scratchpad-write-red.test.mjs` — GREEN at every named stage
   (A1-1…A9-1 set) — this is the package's headline.
2. `impl/test/doc-truth-conformance-red.test.mjs` — green at every named stage (R1…R11).
3. `impl/test/cli-wave-fidelity-red.test.mjs` + `impl/test/error-actionability-red.test.mjs`
   + `impl/test/mcp-reflex-surface-red.test.mjs` — green at their named stages.
4. Adjacents green-unchanged: `cli-silent-start-red` (the PT-7 39→40 re-pin handled
   EXPLICITLY per row-cli's notes — quote how), `phase16-mcp-northbound`,
   `phase67-progressive-agent-experience`, `phase72-kimi-orchestrator-mcp`,
   `wave-observability-red`, `event-log-read-scaling-red`, `waves-list-scaling-red` (WLS-1
   stays RED-by-design until its own wave — name it, don't absorb it).
5. `node impl/scripts/surface-conformance.mjs` reports ok.
6. **Landing blockers (recovered-work collateral, bisect-proven 2026-08-14):** the recovered
   rows introduced two regressions on pre-existing suites — `phase11-persistent-sessions`
   NR1/NR3 + NR3/NR5 (adapter dialect hook: "coordinator uses the immutable admitted Brief…"
   — prime suspect row-kernel's `application-semantics.mjs` registry row or the northbound
   dispatch edits) and `phase12-web-northbound` UA5/WN + WN4/WN5/WN7 (pre-admission refusal
   shapes — prime suspect row-errors' `web-northbound.mjs` admission edits). Both fail
   identically at the recovery base commit (bcca97b), so they are NOT the eventsView work.
   Adjudicate each: either the refusal/adapter surface legitimately moved (restage the suite
   pin with the move quoted) or the impl is wrong (fix it). The package's issues (#157-#160)
   do NOT close while these are red.
7. Cross-check three suite stages against the code they pin — the green must be earned by
   the impl, never by suite edits (the acceptance suites are immutable this wave; the two
   regression suites above are the only restage candidates, and only with quoted proof).

**Deliverable:** `docs/reference/evidence/honesty-package-2026-08-14/complete-qa.md` —
per-row verdicts (sound / needs-fold with blockers), the acceptance evidence, and your final
verdict (land / hold). `[attempt: <salt> coordinator]` verbatim in its first five lines.
