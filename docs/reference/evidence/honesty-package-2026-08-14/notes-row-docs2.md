# ROW-DOCS2 — honesty-package doc-truth remainder (artifact counts + served-set honesty)

[attempt: c78b549c-6c80-4612-a6c4-848f6c3a7a14 row-docs2]

Row: `row-docs2` — the doc-truth remainder of the honesty-package completion wave (wave-f).
ObjectiveRef: `docs/reference/evidence/honesty-package-2026-08-14/complete4/row-docs2-brief.md`.
Acceptance machinery: `impl/test/doc-truth-conformance-red.test.mjs` stages R11 + R5 (docs side).

## State at dispatch (verified in this worktree)

- `node --test impl/test/doc-truth-conformance-red.test.mjs`: **6 pass / 7 fail**. Green: R2, R6,
  R7, R10, P-CS1-b, P-CS4. Red: R1, R3, R4, R5, R8, R9, R11.
  - R11 fails at "lifecycle dispatch gate present" — `impl/src/application-cli.mjs` has no
    `if (!lifecycleActions.has(action)) return parseStart` gate yet (row-cli2's stage).
  - R5 fails only on the parser legs (`application.help` taught verb + `run.watch` example) —
    row-cli2's stage. The served-set honesty (anti-drop + containment) is green.
  - R1/R4/R5-parser = row-cli2; R3/R8/R9 = row-web2. Not this row's stage.
- `node impl/scripts/surface-conformance.mjs`: **ok** (P-CS1-b green).
- `node impl/scripts/render-surface-docs.mjs --check`: exit 0 (docs byte-synced).
- `node --test impl/test/control-surface-truth-red.test.mjs`: 7/7 (adjacent, green-unchanged).

## R11 analysis (the artifact-counts honesty)

- `parserLifecycleActions` in the committed artifact is `0` because the conformance builder's
  fallback extraction (`surface-conformance.mjs` `parserLifecycleDispatchCount()`) returns 0 when
  the parser gate marker is absent. The count must derive from the parser's real lifecycle
  DISPATCH set once row-cli2 lands the gate. **Never hand-maintained; regenerate.**
- `webBusCommands = 31` already matches the R2 card (the 31-name admission). Row-web2's D1
  `webBusAdmittedCommandNames()` accessor must return exactly the 31 card names (R2/R11 leg 1).
- P-CS4 currently passes only because the builder also computes 0. Once row-cli2 lands, the
  committed artifact will be stale and MUST be regenerated via
  `node impl/scripts/surface-conformance.mjs --write-inventory`.

## R7 forward analysis (ledger needs a row for run.scratchpad.append)

- After row-cli2 adds the closed `run.scratchpad.append` CLI parse, the append verb must enter
  `CLI_WEB_COMMANDS` (the registry carries no `application.commands` alias for it, and
  `servedCliOrdinaryKeys()` only serves whitelisted/aliased keys). The 31-name card does not
  admit `run.scratchpad.append`, so R7's forward direction will force a ledger row — same
  disposition as the eight facade ports and `waves.compile`.
- **I must NOT pre-add the ledger row now**: `run.scratchpad.append` is not yet in
  `CLI_WEB_COMMANDS`, so it is not observed (`cliWebRefusedVerbs()` misses it) and `validateLedger`
  would flag the row DEAD, breaking the conformance main. The row lands only after row-cli2's
  `CLI_WEB_COMMANDS` change is in this tree.

## Expected final state (contract-fold v1.1 R11 / B7 / D1 / D2 cross-read)

- `counts.parserLifecycleActions` = **30** after row-cli2 wires `watch` into the lifecycle
  dispatch set (contract-fold R11: "29 at the current HEAD; 30 after D3 #1 wires `watch`").
  Row-cli2 must export `cliParsedCommandNames()` returning the compile-set (canonical operation
  keys) whose `.length` equals the parser's lifecycle dispatch count — the conformance builder
  prefers it, the R11 test's source extraction must agree.
- `counts.webBusCommands` = **31** — the D1 `webBusAdmittedCommandNames()` accessor must return
  exactly the 31-name card (row-web2). The drift names (`waves.compile` #170, `run_scratchpad_append`
  #158) stay OFF the card and stay ledgered; if the accessor returns 32, R2/R7/R11 all break.
- `counts.cliWebCommands` = **40** and `profiles.cli.ordinary` = **39** after row-cli2 adds
  `run.scratchpad.append` to `CLI_WEB_COMMANDS` (the registry has no `application.commands` alias
  for it, so it must be whitelisted to be served). This forces R7 to require a 10th ledger row
  (see below).
- Ledger grows to **10 entries** (the 9 current + `run.scratchpad.append`).

## Await-inputs discipline

- Polling for `notes-row-cli2.md` and `notes-row-web2.md` in this directory (30s cadence).
- Not finalizing the artifact until the parser/CLI rows land. If a row stalls, record + DECISION_REQUEST.

