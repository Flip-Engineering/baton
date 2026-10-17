# notes-row-errors — #160 error actionability (error/refusal RENDERING paths)

[attempt: c8a3f4fc-fe15-4311-953e-5fc21b03ec44 row-errors]

Row scope: the error/refusal RENDERING paths in `impl/src/mcp-northbound.mjs`,
`impl/src/web-northbound.mjs`, and `impl/src/application-cli.mjs`'s error line; the
CLI-local tooling-code ledger (`impl/scripts/surface-divergence-ledger.json`) mandated by C3/S2;
and the `canonicalizeLedger` preservation that keeps the surface-conformance adjacent green.
Did NOT touch command/admission tables (row-kernel) or the CLI parser's verb-recognition
constants/machinery beyond the minimal R6/F8 refusal (row-cli's #155 capability rows stay RED at
their documented split). Never edited any suite.

## Verify before finish — all green

| Suite | Result | Note |
|---|---|---|
| `error-actionability-red` (acceptance) | **22/22** | fold-landing split was 22·5/17 → all 17 capability rows green |
| `mcp-reflex-surface-red` | 21/21 | |
| `phase16-mcp-northbound` | 29/29 | one regression from R1 found + fixed (below) |
| `workflow-dsl-red` | 35/35 | |
| `workflow-dsl-package-red` | 12/12 | |
| `workflow-as-data-red` | 30/30 | |
| `wave-observability-red` | 30/30 | |
| `control-surface-truth-red` | 7/7 | |
| `mcp-profile-parity-red` | 8/13 | by design — #156 impl is a later package |
| `blind-waits-red` | 23/11 | by design |
| `orchestrator-plan-object-red` | 5/42 | by design |
| `surface-conformance-red` | 8/8 | SC6 was broken by the ledger change; fixed in `canonicalizeLedger` |

Other honesty-package suites (other rows' own, at documented baselines): `cli-wave-fidelity-red`
(#157) 8/8 = fold `157 (16·8/8)`, verified byte-identical to the HEAD baseline by stash; 
`scratchpad-write-red` (#158) 5/18 = documented "18 red + 5 pin"; `doc-truth-conformance-red`
(#159) 2/11 = documented. `cli-silent-start-red` (#155, a different package) 7/5 = the HEAD
baseline, verified by stash — its 5 capability rows remain RED for row-cli's #155, and its 7 PIN
rows (PT-1/3/6/7/8/9/10) stay green under my C2 hook.

## Decisions

- **R1 validator passthrough NARROWED to the coaching family.** The initial R1 preserved any
  named application-validator code (`typeof cause?.code === 'string'`), which surfaced
  `application_route_invalid` for a malformed route where phase16 UA5 pins `/invalid_run_command/`.
  Investigation showed the coaching byte-law codes DO come through the validator on one real path
  (`run.workstream.notify` oversize → `run_legacy_send_exceeded`, application.mjs:1958), while the
  `run.objective` byte law lives at the `start()` admission seam (dispatch-time, handled by the
  stateful sink's `laneCraftedToolError`). So R1 now preserves ONLY `COACHING_REFUSAL_CODES`
  members and collapses everything else to `invalid_run_command`. phase16 back to 29/29.
- **Ledger representation = top-level `cliLocalToolingCodes` + `canonicalizeLedger` preservation.**
  C3/S2 require the 20 codes present in the ledger's serialized JSON; SC6 requires the file to
  round-trip `canonicalizeLedger`. The codes cannot be `entries` rows (validateLedger flags dead
  rows — cli error codes are not observed surfaces). So they live as a top-level array in the
  contract's first-appearance order, and `canonicalizeLedger` preserves the field (spread copy,
  NOT sorted — SC6 round-trip holds). This is the fold B1 "S2 escape hatch" made canonical.

## Mechanism summary

- **MCP (R1/R2):** `laneCraftedToolError(cause)` at all six sinks. Coaching family
  (`COACHING_REFUSAL_CODES` from FRAME_LIMITS refusalCodes) constructs `{field, cap, actual, unit,
  gracefulPath}` on the Error root into the tool-error `detail`; `wave_member_invalid`/`wave_not_found`
  merge `message` into a lane `detail`; `workflow_*` forwards `cause.detail` VERBATIM (workflow-dsl
  PIN-E deepEqual pin). `toolError` gained a 4th `field` param so M3's member-index field survives.
- **CLI (R6/C2):** `cliRunVerbTypoRefusal` — a single-token Damerau-Levenshtein-1 typo of exactly
  one recognized first-token refuses `cli_command_unavailable` with the closed verb set; zero or
  two-or-more neighbors stay objective-first (never a guess). `RUN_FACADE_VERBS` is an `Object.freeze`
  array (NOT a `new Set([...])` literal) so the PT-4 maximal-set source-scan still resolves to
  lifecycleActions (29 tokens). No `FACADE_NOUNS`/`ALIAS_FIRST_TOKENS`/`RUN_RECOGNIZED_FIRST_TOKENS`
  created (row-cli's constants). C1's `cli_transport_failed` messages name the transport class +
  next action.
- **Ledger (C3/S2):** the 20 CLI-local tooling codes enumerated first-appearance order; S2 closure
  holds (every `cli_*` in the CLI source is in-scope `cli_command_unavailable`/`cli_transport_failed`
  or ledgered).

## Adjacent-scan resolution (gate-wide)

The gate (`npm test` / `scripts/run-suite.mjs`) runs every `test/` suite, so beyond the brief's
list I scanned the run-surface and MCP/web neighbors:

- **phase68-unified-agent-entrypoint 21/21** — the earlier "18/21, 3 failures" was a stale
  observation from the disk-starved period; a clean re-run is all-green. The suspected C2 break was
  a false alarm: `parseBatonCli(['run', 'No silent effort', '--model', …])` takes `action =
  'No silent effort'` (the full multi-word string, application-cli.mjs:1468), and
  `cliRunVerbTypoRefusal`'s `/\s/u` guard returns null for any multi-word token — so multi-word
  objectives always fall through to objective-first `parseStart` (the phase68-pinned
  `cli_invalid manual routing…`). Only single-token distance-1 typos (`run shwo`) fire the hook.
- **phase71-kimi-credential-setup 10/10**, **phase69-verifier-retry-cascade 16/16**,
  **phase70-resumable-work 5/5** — all green; the prior failure reports were disk-starved artifacts
  (phase71 touches `credentials install kimi`, which shares no parse path with the C2 run-verb hook;
  it contains zero `cli_command_unavailable` references).
- **`run watch`** (doc-truth-conformance) and **`run wave`** (orchestrator-plan-object) are unknown
  single tokens but have zero DL-1 neighbors in the recognized set, so they stay objective-first —
  both suites hold their documented baselines (2/11, 5/42).
- Gate surface gates re-run directly: `checkLedgerMonotone(HEAD, current)` OK and the SC6
  `canonicalizeLedger` byte round-trip OK against `impl/scripts/surface-divergence-ledger.json`.

## Not green and why (documented red-by-design)

- `cli-silent-start-red` 5 RED rows — #155 capability rows, row-cli's package; identical to HEAD.
- The other three honesty-package suites' capability rows — other rows' acceptance, at documented splits.
