# NOTES — row-result-accessor (#99+#179, Lane179)

[attempt: harvest-accessor-lane179-20260921 row-result-accessor]
Worktree: ws-d10ebfeb43b81a20d34d5d5cb8eaab05. Suite: impl/test/harvest-accessor-red.test.mjs.
RED baseline: 34 fail / 5 pass (guards I2/I5/I6/M1/M2 green). Final measured state this
window: 31 pass / 8 fail — see the per-row disposition below.

## Landed (implementation in impl/src)
- impl/src/harvest-accessor.mjs (NEW): the accessor's pure helpers — closed-shape validators
  (application_run_resultpin_invalid / application_waves_harvest_invalid BEFORE authorize),
  the pin-verification lane (pinned/missing/mismatch/unverifiable off worktrees.resolveResult),
  the recorded-base ancestry gate, changedPathsAtCommit projection, the changedFiles page
  (256 KiB cap, full-set digest, cursor, one `git cat-file --batch` for content digests), the
  non-destructive three-way conflict probe (throwaway detached worktree, engine's merge
  invocation, porcelain classes, no residue), and the engine→harvest code translations.
- impl/src/application.mjs (ADDITIVE ONLY): one import, a two-line direct-port dispatch
  intercept ahead of the recursive-session gate (FP-18), and three new methods —
  `resultPin`, `wavesHarvest`, `_resultRecordForRun` (+ `_attributingTaskRecord`) — contract
  Decisions 1-3: recorded-base law, ordered typed preconditions (onto-invalid → pin → ancestry
  → onto-dirty → already-contained → base-diverged → empty-delta → probe → engine stage/
  finalize), typed refusal vocabulary.
- impl/src/application-cli.mjs (ADDITIVE): `baton run resultpin RUN_ID` and
  `baton waves harvest SHA|RUN_ID [--onto PATH]` parse branches (I1 green; I2/I5 guards stay
  green). CLI_CARD_LEDGERED_PORTS + divergence-ledger cli rows were landed and then REVERTED
  (option (b)) to keep Lane156b's RG-P1 green until the final landing re-lands them together
  with the registry rows.

## Rows green this window (31)
A1-A4, B1, C1, C2, D1-D6, E1, E2, F1, G2, J1, J2, K1, K2, L1, L2, N1, N2 (facade lanes),
plus guards I1, I2, I5, I6, M1, M2.

## Rows red, with reasons
- F2-three-way-conflict — UNSATISFIABLE AS WRITTEN (suite bug class, not implementation):
  the row asserts `refusal.conflicts`, `refusal.ontoHeadSha`, `refusal.resultSha`, but its
  capture helper `facadeError` (line 191) returns exactly `{code, message}` — the payload
  fields cannot reach the assertion through it. Verified empirically. My lane THROWS the
  contract-pinned payload (Object.assign on the typed error: conflicts [{class,path}]
  byte-wise sorted, ontoHeadSha, resultSha), and row lines 714/721/722/723 (code, onto
  untouched, clean, content preserved) pass. Suggested fold: extend facadeError to carry the
  error's own enumerable fields (or assert via the thrown error), then this row goes green
  with zero implementation change.
- H1-H5, I3, I4 — the #99↔#156 MCP advertisement collision (Main-adjudicated, sequencing
  decision on record): the folded #156 suite pins the ordinary table at 49 and its fold cut
  the pair's definition rows (and the 11 memory rows incl. baton_run_message_send used by
  H3/H4). My machinery (CAPABILITY/EXPLICIT/dispatch/guards/stateFailureCode vocabulary +
  translations) is written and was verified green mid-session (H2/H5 passed; H3/H4 failed
  only on the later advertisement cut). Staged final landing after #156's commit, per Main:
  registry rows (application-semantics CANONICAL_OPERATION_SPECS +2), web-bus admission
  (WAVE_WEB_ENTRIES +2) + ledger cli rows re-land, the pair re-landed wholesale in
  mcp-northbound, H1 re-cut to the DERIVATION form (pair advertised; literal only as
  redundant secondary), #156 count rows 49→51 in the same commit, artifact + docs regen.

## DECISION_REQUEST / resolved-by-Main
- Authority-class ambiguity and the exact-count collision: resolved by Main's adjudication
  (option c, derivation rows) + the sequencing decision (#156 first, #99 re-fold second).
- F2 remains OPEN: needs the suite-side fold above; unsatisfiable as written.

## FINAL LANDING STATE (post-adjudication, measured)
Full verification set: harvest-accessor-red + mcp-profile-parity-red = 60 tests, 59 pass,
1 fail (F2 only — Main accepted the suite-side helper defect and will fold it at landing).
- mcp-profile-parity-red: 21/21 (composition re-fold: counts are the MEASURED totals 56
  ordinary / 109 combined with the full breakdown in the composition comments and the
  derivation asserts 35+14+3+2+2 / 86+2+14+3+2+2).
- surface-conformance: ok; surface-gate --check: ok (artifacts regenerated:
  surface-inventory-artifact.json, surface-parity matrix, CLI.md/MCP.md blocks).
- suite-manifest-reasons: 12/12; phase87: 12/12.
- H1 re-cut per adjudication: derivation assert (dupes-free served table) + membership +
  measured totals 56/109 as the redundant secondary.
- Final landing files: application-semantics.mjs (+2 canonical rows), web-northbound.mjs
  (+2 bus admissions), application-cli.mjs (+2 ledgered ports), mcp-northbound.mjs (pair
  re-landed wholesale + 3 wakes restored + message send/receipt restored),
  surface-divergence-ledger.json left at its pinned set (conformance refuses new cli ledger
  appends: 'ledger append forbidden' — the pair rides the bus admission + LEDGERED_PORTS).
- MANIFEST (docs/44) staged for Main's commit: move the 33 satisfied '#99' rows out of
  expected-red-tests.json, retain F2 with the helper-defect reason above.
