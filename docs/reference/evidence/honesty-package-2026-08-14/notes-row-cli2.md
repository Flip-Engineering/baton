# ROW-CLI2 — honesty-package CLI parser legs (#158 append + #159 run.watch + teaching)

[attempt: b5a27da7-6d21-4daa-a28c-245fafcc79f6 row-cli2]

Row: `row-cli2` — the CLI parser legs the drain truncated.
ObjectiveRef: `docs/reference/evidence/honesty-package-2026-08-14/complete/row-cli2-brief.md`.
Acceptance machinery: `impl/test/scratchpad-write-red.test.mjs` (A1-1, A1-2, A9-1) +
`impl/test/doc-truth-conformance-red.test.mjs` (R1, R4, R5) + paste-count suites
`cli-wave-fidelity-red` / `cli-silent-start-red`.

## Ownership executed (exactly the brief's seam)

- `impl/src/application-cli.mjs` — `CLI_WEB_COMMANDS` admission, the `run.scratchpad.append`
  parse branch + `scratchpadAppendBody` per-kind helper, the D4 bare/unknown-subverb teaching,
  the `run watch` branch, and the `baton application help` verb-column spelling.
- `impl/CLI.md` — regenerated via `render-surface-docs.mjs` (the `run.scratchpad.append` row joined
  the generated inventory; `run.watch` was already served/rendered at `CLI.md:51`).
- `docs/reference/evidence/honesty-package-2026-08-14/**` — this notes file.
- Never touched: `application.mjs` / the northbounds (row-web2's), `application-semantics.mjs`
  (kernel/semantics seam), `impl/scripts/**` (row-docs2's ledger + artifact), any suite.

## Acceptance verification (final, in this worktree)

| Suite | Result |
|---|---|
| `scratchpad-write-red` | **23 tests · 12 pass / 11 fail** — A1-1, A1-2, A9-1, A9-2 green (this row); P-A1..P-A7 green. The 11 red are the kernel/web/MCP/deployment dispatch rows (row-web2/row-deploy2) plus A10-1 leg (b) broken-regex (below). |
| `doc-truth-conformance-red` | **13 tests · 6 pass / 7 fail** — R1, R4, R5 green (this row) + R2/R6/R10 (row-docs); R3/R8/R9 src-owned (row-web2); R7/R11/P-CS1-b/P-CS4 drift → row-docs2 (below). |
| `cli-wave-fidelity-red` | **16/16 green** (paste count, unchanged). |
| `cli-silent-start-red` | **12 tests · 7 pass / 5 fail** (paste count, byte-identical to the HEAD baseline — 7 PIN rows green incl. PT-7; PT-2a/2b/2c/4/5 stay red, the #155 red-by-design capability rows). |

### This row's named-stage rows (all green)

- **A1-1 (cli-append-branch-missing)** — `run scratchpad append RUN --scope … --kind note --body
  TEXT` → `{name:'run.scratchpad.append', args:{runId, scope, kind, body}}`; `--scope` validated
  against the `SCRATCHPAD_SCOPE` grammar (the read branch's check); a second argv shape + a bogus
  scope both behave (no hardcoded first-shape special-case).
- **A1-2 (cli-append-json-shape-missing)** — non-note kinds ride a JSON body parsed + shape-checked
  against the kernel's closed per-kind shape (`scratchpadAppendBody`: plan `{objective, steps,
  supersedes?}` steps `[{text,state}]` state∈todo|doing|done; doubt `{question, context?}`; link
  `{label, relation, target}`); malformed JSON and a wrong-shaped plan both refuse `cli_invalid`
  naming the expected shape (`--body must be JSON matching {…} for kind plan`).
- **A9-1 (bare-scratchpad-teaching-missing)** — bare `run scratchpad` → `cli_invalid`
  `run scratchpad requires a subcommand: read|elevate|append` (never `unexpected argument undefined`).
- **A9-2 (unknown-subverb-teaching-missing)** — `run scratchpad bogus` → `cli_invalid`
  `unknown scratchpad subcommand bogus; expected read|elevate|append` (names the unknown AND the
  closed set).
- **R1 / R4 (run-watch)** — `run watch RUN_ID` → `{name:'run.watch', args:{runId}}` (a registered
  canonical operation key); bare `run watch` → `cli_invalid` `Run ID is invalid` (value-required,
  never a silent `run.start` objective).
- **R5 (cli-example-shape-leg)** — every served row's Example AND taught Verb compile. The residual
  `application.help` verb-column refusal was fixed by admitting `baton application help` →
  `application.help` (the taught spelling of `deriveSurfaceNames('application.help').cli`).

## The PT-7 39→40 coordination (how it was handled — not silently broken)

The recovered row-cli cross-seam map warned that wiring `watch` as a recognized first-token would
inflate cli-silent-start's **derived** detection set 39→40 and break its green PT-7 pin
(`assert.equal(detection.size, 39)`). I wired `watch` **without** inflating the set:

- The `run watch` branch is placed **after** the `const lifecycleActions = new Set([…])` literal and
  **before** the `if (!lifecycleActions.has(action))` typo-guard — so `watch` is dispatched, but it
  is neither a lifecycle Set-literal member, nor a run-branch facade label (`if (action === '…')`
  before the literal), nor an alias first-token (`run.watch` keeps `cli: null` in
  `application-semantics.mjs`). `deriveDetectionSet` therefore still returns **39**.
- PT-4(c)'s `watch-excluded` clause also stays satisfied: `detection.has('watch')` is false and
  `sem.includes("canonical: ['run', 'watch']")` is false (the `cli: null` registry projection is
  left untouched — it lives in `application-semantics.mjs`, outside my partition, and #155's PT-4(c)
  still pins it). I did **not** flip `cli: null` (the contract-fold D3 #1 "flip" is a semantics-seam
  mechanism owned by the kernel/semantics row; R1/R4/R5 are green without it).
- Verified: `cli-silent-start-red` is 7/5, byte-identical to the baseline; PT-7 green; PT-2c's
  `detection.size === 39` assertion passes (its remaining red is the #155 "did you mean" message
  format vs. row-errors' #160 "unknown run verb … expected …" closed-set format — a pre-existing
  cross-wave tension, not this row's change).

## Cross-seam drift my landing introduces (row-docs2's regen, NOT mine)

Adding `run.scratchpad.append` and `run.watch` to `CLI_WEB_COMMANDS` makes the committed
`surface-inventory-artifact.json` stale and creates two `novel name divergence` findings, exactly
as the recovered notes predicted for the append verb. `node impl/scripts/surface-conformance.mjs`
now reports:

```
surface-conformance: novel name divergence: cli:run.scratchpad.append:name
surface-conformance: novel name divergence: cli:run.watch:name
surface-conformance: inventory artifact: inventory artifact is stale; regenerate via node impl/scripts/surface-conformance.mjs --write-inventory
```

Both verbs are web-admitted (not ghosts): `run.scratchpad.append` rides the four-table direct port
(`WAVE_WEB_ENTRIES` → `WEB_DIRECT_PORT_COMMANDS`), and `run.watch` rides the canonical transport
`run_watch` (`CANONICAL_WEB_ENTRIES` derives it from `applicationOperationAliasMap()['run.watch'] =
'run.follow'`, and `run.follow` is card-admitted). Neither appears in the pinned 31-name `web.bus`
card, so each needs a **card-vs-admission-drift** ledger row — the same disposition row-docs already
used for `waves.compile`. row-docs2 must, after this row + row-web2 land:
1. add ledger entries for `run.scratchpad.append` and `run.watch` (surface `cli`, dimension `name`,
   a `note:` naming the card-vs-admission drift), and
2. regenerate the inventory artifact (`--write-inventory`; `counts.cliWebCommands` 39→41,
   `profiles.cli.ordinary` gains `run.scratchpad.append`).

The red-until-then rows are exactly: doc-truth R7/R11/P-CS1-b/P-CS4, error-actionability S1,
control-surface-truth CS1-b/CS4 — all one root cause (stale artifact + two unledgered whitelist
verbs). None is in this row's acceptance.

## A10-1 leg (b) broken-regex (carried DECISION_REQUEST)

`scratchpad-write-red` A10-1 leg (a) (the CLI parser serves the append verb) is now green, but leg
(b) pins `CLI_WEB_COMMANDS` with the regex `/run\\.scratchpad\\.append/u` (double-backslash), which
matches a literal `run\.scratchpad\.append` and can never match the correct plain-dot admission.
P-A1's single-backslash `/run\.scratchpad\.read/` style proves the typo. This is the recovered
row-cli DECISION_REQUEST carried forward — A10-1 leg (b) is not greenable without a suite edit
(forbidden); the verb is in fact admitted. Options (unchanged): (a) restage the pin to single-
backslash, (b) accept as documented red-by-design.

## Craft-law compliance

- No clocks; no `localeCompare`; sorted-key literals in codepoint order; no byte literals outside
  `limits.mjs` (the append byte ceilings stay the kernel's — the CLI adds only the thin JSON-parse +
  shape-check step, per H2.3).
- `CLI.md` regenerated via `render-surface-docs.mjs` (never hand-edited); `run.watch` was already
  served/rendered, so its row is unchanged.
- `application.mjs` / the northbounds / `application-semantics.mjs` / `impl/scripts/**` / suites
  untouched. Work confined to this worktree.
- Deployment verification: `true` (argv `[]`, cwd `.`) exits 0.
