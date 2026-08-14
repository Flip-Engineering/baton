# notes-row-cli2 — the CLI parser legs (append branch + run.watch + teaching)

[attempt: 5e53de2d-33b2-4774-ac68-65f46bb4b5bd row-cli2]

Row: `row-cli2` — recovery of the truncated CLI-seam legs in `impl/src/application-cli.mjs`.
ObjectiveRef: `docs/reference/evidence/honesty-package-2026-08-14/complete/row-cli2-brief.md`.
Acceptance: `impl/test/scratchpad-write-red.test.mjs` (A1-1, A1-2, A9-1) +
`impl/test/doc-truth-conformance-red.test.mjs` (R1, R4, R5), plus `cli-wave-fidelity-red` and
`cli-silent-start-red` staying green.

## What landed (additive, `impl/src/application-cli.mjs` only)

- **`run.scratchpad.append` parse branch** (D2.2/H2.3). `baton run scratchpad append RUN_ID
  --scope shared|worker:ID --kind note|plan|doubt|link --body …` compiles to
  `{kind:'command', name:'run.scratchpad.append', args:{runId, scope, kind, body}}`. `--scope` is
  required and validated against the same `SCRATCHPAD_SCOPE` grammar the read branch uses;
  `--kind` is optional (default `note`) and validated against the closed
  `note|plan|doubt|link` set; `--body` is required. `noRemainder(args)` closes the branch.
- **`scratchpadAppendBody(kind, rawBody)`** — `--kind note` carries `--body` verbatim; the
  non-note kinds JSON-parse `--body` and shape-check against the kernel's closed per-kind shape
  (normalizeScratchpadEntry, coordination-store.mjs:607-696) minus the `kind` key, refusing
  `cli_invalid` naming the expected shape (mirroring the elevate branch's `--entries` handling).
- **Bare/unknown-subverb teaching (D4)** — bare `run scratchpad` refuses
  `run scratchpad requires a subcommand: read|elevate|append`; an unknown subverb refuses
  `run scratchpad has no <sub> subcommand; expected read|elevate|append`. Both replace the old
  `unexpected argument ${sub}` / `unexpected argument undefined` throws.
- **`run watch RUN_ID` → `run.watch`** (R1/R4). The branch lives AFTER the `lifecycleActions`
  literal — watch is neither a facade noun nor a lifecycle verb, so the silent-start (#155)
  recognized-first-token derivation (lifecycle Set literal + pre-gate facade dispatch) stays at
  its pinned 39. Bare `run watch` refuses `cli_invalid` (`Run ID is invalid`, the value-required
  shape — matches `/run id|runId|required/i`).
- **`application help` → `application.help`** (R5 verb-column leg). `application.help`'s
  mechanical cli spelling (`baton application help`, deriveSurfaceNames) compiles to the same
  help command as the taught `baton help` example, so the taught verb is no longer a refusing
  spelling.

## Decisions

- **`run.watch` is not added to `CLI_WEB_COMMANDS`.** It was already served (via the
  `run.follow` → `run.watch` application.commands alias, so `servedCliOrdinaryKeys()` lists it
  and R5's ⊆ law resolves it through `canon('run.watch') = 'run.follow'` ∈ web card). Adding it
  would mint a new whitelisted-but-web-refused name needing a divergence-ledger row —
  `impl/scripts/surface-divergence-ledger.json` is row-docs' file, not mine.
- **`run.scratchpad.append` is NOT added to `CLI_WEB_COMMANDS` either.** The A10-1 three-way
  admission (parser + CLI_WEB_COMMANDS + web four-table + MCP + registry + ledger) is out of this
  row's partition: the surface-divergence ledger and web/mcp/registry files belong to other rows,
  and A10-1's leg (b) regex (`/run\\.scratchpad\\.append/u` — double-backslash) cannot match a
  correct plain-dot admission (the recorded DECISION_REQUEST). Admitting append without the
  coordinated ledger row would break the green `P-CS1-b` conformance main ("novel name divergence:
  cli:run.scratchpad.append:name"), so the admission stays a coordinated follow-up for the ledger
  owner. The parser branch is the honest CLI parse leg this row owns.
- **Watch placement keeps PT-7 at 39** — the cross-seam constraint from
  `notes-row-cli.md` (adding watch as a *recognized first-token* inflates the #155 detection set
  39→40). Serving watch AFTER the `lifecycleActions` literal satisfies both R1/R4 (watch parses)
  and PT-7 (detection stays 39): no re-pin of the #155 suite is required, so no suite edit and no
  silently-broken pin.

## Verification (counts pasted)

- `node --test impl/test/scratchpad-write-red.test.mjs` — **12 pass / 11 fail** (was 5/18 at
  HEAD). My rows green: **A1-1, A1-2, A9-1, A9-2** (plus P-A1 read/elevate substrate). Remaining
  red are the other seams (A2-2, A3-1, A4-1, A4-2, A5-1, A6-1, A7-1, A7-2, A7-3, A8-1) and
  A10-1 (leg (b) broken regex — the recorded DECISION_REQUEST).
- `node --test impl/test/doc-truth-conformance-red.test.mjs` — **9 pass / 4 fail** (was 2/11 at
  HEAD). My rows green: **R1, R4, R5**; P-CS1-b + P-CS4 pins green (`surface-conformance: ok`).
  Remaining red: R3, R8, R9, R11 (other rows' answer-schema / briefing / artifact seams).
- `node --test impl/test/cli-silent-start-red.test.mjs` — **7 pass / 5 fail**, byte-identical to
  the HEAD split. PT-1, PT-3, PT-6, PT-7, PT-8, PT-9, PT-10 pins green; **PT-7
  `detection.size === 39` holds** — the watch branch (placed after the lifecycleActions literal)
  does NOT inflate the #155 detection set, so the cross-wave re-pin is coordinated to 39, not
  silently broken. PT-2a/2b/2c/4/5 remain row-sf160's red.
- `node --test impl/test/cli-wave-fidelity-red.test.mjs` — **16 pass / 0 fail** (unchanged by
  this row; A7-5 `--check` + byte-equality still green).

## Files touched

- `impl/src/application-cli.mjs` (only source change). `impl/CLI.md` was regenerated by the
  shipped renderer and returned byte-identical (no append row — append is not yet admitted), so
  no generated-file diff lands.
