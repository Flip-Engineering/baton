# ROW-DOCS2 — honesty-package wave-e doc-truth remainder (artifact counts + served-set honesty)

[attempt: 5e53de2d-33b2-4774-ac68-65f46bb4b5bd row-docs2]

Row: `row-docs2` — the doc-truth remainder: R11 (committed artifact counts) + R5's docs-side
(served-set honesty). ObjectiveRef:
`docs/reference/evidence/honesty-package-2026-08-14/complete3/row-docs2-brief.md`.
Acceptance machinery: `impl/test/doc-truth-conformance-red.test.mjs`.

## File partition (honored — work confined to my seam)

`impl/scripts/surface-inventory-artifact.json` + `impl/scripts/surface-divergence-ledger.json`
+ `docs/reference/evidence/honesty-package-2026-08-14/**`. `impl/CLI.md` is row-cli2's;
`impl/MCP.md` is row-web2's. I made no edits to suites, `application-cli.mjs`, the northbounds,
`application.mjs`, or `application-deployment.mjs`. My worktree diff is exactly one file:
`docs/reference/evidence/honesty-package-2026-08-14/notes-row-docs2.md` (the artifact and the
ledger are byte-unchanged because regeneration and the R7 ledger check confirm they are already
correct for the merged code — see below).

## Await-inputs — all four recovery rows have landed

Polled the sibling worktrees (30s cadence) per the brief's discipline; every row's notes now
exist with its `[attempt: …]` line:

| Row | Worktree | Landed |
|---|---|---|
| row-cli2 (parser legs) | `ws-60744a55687c08f96e4bf9203312ee01` | `notes-row-cli2.md` |
| row-web2 (web/MCP dispatch + answer/briefing) | `ws-1319b1dd5b0c0a9f750a899f00ead200` | `notes-row-web2.md` |
| row-deploy2 (deployment restrictor) | `ws-499bb7f2d5c75195d7d271af674d7b1b` | `notes-row-deploy2.md` |
| row-docs2 (this row) | `ws-8856c83d969ca1b4d2a0a7a43153abd8` | this file |

## Cross-worktree verification (each row's legs flip green in its own worktree)

`node --test impl/test/doc-truth-conformance-red.test.mjs` (base = 6 pass / 7 fail):

| Leg | row-cli2's tree | row-web2's tree | my tree (base) | Merged expectation |
|---|---|---|---|---|
| R1 / R4 / R5 (parser: run.watch, teaching) | ✅ green | red (base parser) | red | green |
| R3 / R8 / R9 (web/MCP: answer schema, briefing) | red (base web) | ✅ green | red | green |
| R2 / R6 / R7 / R10 / P-CS1-b / P-CS4 | ✅ green | ✅ green | ✅ green | green |
| R11 leg 1 (`webBusCommands` = card 31) | ✅ | ✅ | ✅ | green |
| R11 leg 2 (`parserLifecycleActions`) | **red — gate** | **red — gate** | **red — gate** | **red — blocked** |

The two red sets are disjoint and complementary; the fully-merged tree is expected 12/13 with
R11 leg 2 the sole red. R11 leg 1 is verified green in both code rows' trees (R2 green in
row-web2's tree ⇒ web.bus inventory = the pinned 31-name card; row-web2's `run_scratchpad_append`
is a transport direct-port admission, never a card entry).

## Artifact + ledger — regenerated and verified

`node impl/scripts/surface-conformance.mjs --write-inventory` → **ok**, byte-identical to the
committed artifact (P-CS4 green). Counts: `webBusCommands: 31`, `cliWebCommands: 39`,
`parserLifecycleActions: 0`, plus the MCP/registry counts — the regeneration is a no-op because
the merged code yields the same values as base: row-cli2 kept `CLI_WEB_COMMANDS` at 39
(`base vs row-cli2 identical: true` — they deliberately did NOT admit `run.scratchpad.append`,
deferring the coordinated A10-1 three-way admission as their own DECISION_REQUEST), and row-web2's
web admission does not grow the card. **No new ledger row is required** — R7 is green and the
9-row ledger has no dead rows (every ledgered name is live in `CLI_WEB_COMMANDS`).

## R11 leg 2 is BLOCKED — cross-suite contract conflict (DECISION_REQUEST)

The artifact's `parserLifecycleActions` cannot be honestly computed at this wave's contract
boundaries, and I will not fake the count. The conflict, confirmed:

- The acceptance suite's `parserLifecycleDispatchCount()` (doc-truth-conformance-red.test.mjs:184-202)
  hard-asserts the exact one-line gate string `if (!lifecycleActions.has(action)) return parseStart`
  in `application-cli.mjs` (row-cli2's file) and throws "lifecycle dispatch gate present" otherwise.
- The parser's gate is block-form because the #160 F8 typo-refusal
  (`cliRunVerbTypoRefusal`, `if (!lifecycleActions.has(action)) { … return parseStart … }`) lives
  inside it — error-actionability C2 (`run shwo → cli_command_unavailable`, GREEN 22/22 at base)
  REQUIRES that block. A one-line gate would silently route a distance-1 typo into the
  objective-first `parseStart` and regress C2.
- Commit order proves the assertion is stale: `98bdd1d` (wave-c, the one-line-gate test) is an
  ancestor of `bcca97b` (wave-b-rd1, which introduced `cliRunVerbTypoRefusal`). No row's brief
  owns the R11 gate restructure (row-cli2's brief lists R1/R4/R5 only).
- The honest dispatch count is computable: the lifecycleActions literal has **29 verbs**; the
  literal→gate region is empty at base and gains `action === 'watch'` in row-cli2's code, so the
  honest count is **29 base / 30 after row-cli2**. The conformance B7 fallback
  (surface-conformance.mjs:642-665) silently returns **0** when the gate string is absent, which
  is what the artifact carries — tooling-consistent but NOT honest, and R11 leg 2 rejects it.

DECISION_REQUEST: {"question":"doc-truth R11 leg-2's parserLifecycleDispatchCount() hard-asserts the one-line dispatch gate `if (!lifecycleActions.has(action)) return parseStart` in application-cli.mjs, but the #160 F8 typo-refusal (error-actionability C2, green 22/22) requires the block-form gate — the one-line form would silently route `run shwo` into objective-first parseStart and regress C2. The one-line assertion predates the typo-refusal (98bdd1d < bcca97b) and no row's brief owns the R11 gate (row-cli2 owns R1/R4/R5 only). The artifact's parserLifecycleActions cannot be honestly computed meanwhile (honest set: 29 base / 30 after row-cli2's watch branch; conformance B7 fallback writes 0). Which disposition?","options":[{"id":"opt-suite-update-block-gate","label":"Suite owner updates doc-truth's parserLifecycleDispatchCount() to delimiter on the block-form gate `if (!lifecycleActions.has(action)) {` — preserves #160 F8; honest count 29/30; test intent (dispatch set, not a hand-maintained probe) preserved"},{"id":"opt-cliParsedCommandNames-export","label":"row-cli2 exports cliParsedCommandNames() from application-cli.mjs (conformance B7 already prefers it) and the suite prefers it too — aligns the test with the stated D1 design"},{"id":"opt-move-typo-refusal","label":"row-cli2 restructures to the one-line gate and moves the F8 typo-refusal into parseStart so C2 stays green — both suites satisfied, but parseStart's contract changes"},{"id":"opt-red-by-design","label":"Accept R11 leg-2 as red-by-design this wave; artifact keeps parserLifecycleActions: 0 with an explicit honesty note pending reconciliation"}],"allowFreeResponse":true,"deadlineMs":3600000}

## Honest disposition

I am NOT claiming R11 green. My docs-side deliverables are complete and verified — the artifact
is regenerated and tooling-consistent, the ledger is valid with no dead rows and needs no new row,
R5's docs-side served-set honesty legs are green (containment law: no violations; anti-drop law:
`application.help` and `run.watch` are served), R11 leg 1 is green in both code rows' trees, and
`surface-conformance.mjs` reports ok. R11 leg 2 is blocked on the wave-level gate decision above;
per the brief, that is recorded as a DECISION_REQUEST with options rather than a faked count.
