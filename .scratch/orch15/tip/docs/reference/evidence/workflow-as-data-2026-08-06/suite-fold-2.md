# Suite-fold-2 — blue-team findings folded (F1-F16)

- **Suite:** `impl/test/workflow-as-data-red.test.mjs` (v1.2 header, 29 rows)
- **Report folded:** `suite-blueteam.md` (verdict **NEEDS-FOLD** — 11 numbered findings F1-F11,
  minors F12-F16; §5 SOUND list kept as-is)
- **Contract:** `workflow-as-data-contract.md` bumped **v1.1 → v1.2** (D1 `report` field F2, D1
  admission union F12, D3 delivered-keying F1 — the only places the report says the CONTRACT was
  wrong; the header carries a one-line fold note)
- **Date:** 2026-08-06

## Fold summary

29 rows (was 25): **4 green guards (P1-P4, unchanged)** · **25 red** — every red row fails at a
NAMED stage at HEAD (the lane is still unimplemented). New rows: **W3-answer-first-match** (F7b),
**W3-answer-free** (F7d), **W4-03** (F4 markerless miss), **W4-04** (F8d mustContain PASS).

Measured split, `node --test impl/test/workflow-as-data-red.test.mjs` from the repo root, twice
(stable):

| run | tests | pass | fail |
|-----|-------|------|------|
| 1   | 29    | 4 (P1-P4) | 25 (all red rows, stage-named) |
| 2   | 29    | 4 (P1-P4) | 25 (all red rows, stage-named) |

Priority obeyed: F1 and F3 are closed first and hardest — every W3 policy row now observes the
REAL wire/store call (adapter spawn brief, `[MESSAGE` prompt frames, resumed-turn prompt, store
elevations, adapter answer ledger, signal frame), and the MessageDeafAdapter is capable of producing
the undelivered state (it THROWS; only a throw yields `delivered: 0`).

Deviations from the report's concrete fixes (none contradict the v1.1 contract):

- **F7a / F7c are DEFERRED** (impractical to exercise deterministically — reasons below).
- **F9** is applied as written; D6's `basis` text is read as *an incomplete verdict forces a
  reference basis* (any `WAVE-INCOMPLETE` → `basis = manifestDigest`, even when all members settled
  `result_ready`), which reconciles the report's fix with the contract with no contract edit.

## Finding → resolution map

| F# | Verdict | Finding (one line) | Resolution |
|----|---------|--------------------|------------|
| F1 | row-breaking, RESOLVED | false-red: the deaf adapter resolved `{ok:false}` which `sendMessage`'s delivery chain counts as delivered | MessageDeafAdapter now THROWS on `[MESSAGE` frames (and records them in `calls.prompt`); W3-message-bounds asserts every attempt receipts `delivered: 0`, exactly **3** `[MESSAGE` frames hit the adapter, and one `steering_message_undelivered`. Contract D3 tightened: a delivery is DELIVERED only on `delivered > 0 && typeof messageId === 'string'`. |
| F2 | contract mismatch, RESOLVED | contract-suite mismatch: the D1 member shape lacks `report`, which the suite's valid members carry | Contract D1 declares `report` as an allowed member field (containment class like `objectiveRef`, never executed) with an explanatory note; the suite's `wadMember`/`validSpec` already carry it — closed schema and suite now agree. |
| F3 | shallow-green, RESOLVED | W3 policy rows could self-author `receipt.steering[]` events with no real wire/store call | Every W3 row observes the REAL observable: W3-approve → adapter spawn brief's advertised `planDigest`; W3-checkpoint → a resumed-turn `mode:'turn'` prompt; W3-message / -message-bounds → the `[MESSAGE` delivery frames carrying the receipted messageId; W3-elevate / -elevate-bounds → the coordination store snapshot's `scratchpad.elevations` with `sourceEntryId`; W3-answer / -bounds / -first-match / -free → the adapter `answer` ledger; W3-signal → the `[MESSAGE` signal frame to the remaining member. |
| F4 | missing-row, RESOLVED | no row pins the D4 attempt-marker verification (`[attempt: <salt>]`) | `carryAttemptMarker` scenario option prepends the wave's REAL salt line (from the spawn brief) to every edit; W4-01/W4-02 assert the recovered content carries `[attempt: `; new W4-03 receipts a NAMED `harvest_miss` when a byte-similar artifact lacks the marker. |
| F5 | row-breaking, RESOLVED | W4's authoritative-sha attribution not discriminated from a plain working-tree read | W4-01 asserts `entry.bytes` is the git blob at the run's authoritative `resultSha`; W4-02 DELETES the working-tree file after settle, then asserts `entry.bytes` still equals the blob at `resultSha` — a working-tree read returns nothing once the file is gone; only the #99 accessor recovers. |
| F6 | minor gap, RESOLVED | the plural verb pinned only positively; the singular exclusion unpinned | W6-01 now asserts `parseBatonCli(['wave','run',specPath])` refuses (`cli_command_unavailable`) or corrects to the plural, and `mcpApplicationToolNames()` does NOT include `baton_wave_run`. |
| F7 | missing-row, PARTIAL (F7b/F7d done, F7a/F7c deferred) | D3 bound rows missing: elevation typed-refusal ≤2; first-match-wins; `(runId,requestId)` dedup; `allowFreeResponse`→`text` | **F7b** → new W3-answer-first-match (two patterns match one question; insertion-order first wins). **F7d** → new W3-answer-free (mapped policy value sent as `text`). **F7a deferred**: the elevation-refusal rows need `scratchpad_partition_exhausted` (512 shared scratchpad entries) or `stale_scratchpad_fence` (fence timing) — neither is reachable deterministically in a hermetic mock; documented in suite-draft-notes.md. **F7c deferred**: the mock's single-ask design cannot replay a same-`requestId` decision — the turn does not re-wait after resolution, so the dedup path is not observable. |
| F8 | missing-row, RESOLVED | <200-byte recovery, exact 64 KiB bound, realpath-symlink containment, mustContain PASS | (a) W4-02's present path is a sub-200-byte report asserted recovered (`ok`). (b) W1-03 writes exactly 64 KiB + 1 objectiveRef → `workflow_objective_ref_invalid` (the D5 bound pinned at its exact value). (c) W1-03 adds a symlink-escape objectiveRef and W1-05 a symlink-escape harvest path (realpath refusal). (d) new W4-04: a MATCHING `mustContain` passes with `expected`/`actual` receipted — never a `harvest_miss`. |
| F9 | missing-row, RESOLVED | D6 `verdict` value (and the incomplete-`basis` branch) unpinned | W1-06 asserts `verdict === 'WAVE-OK'` and `basis === 'completed'`; W2-01 asserts `verdict === 'WAVE-OK'`; W4-02 asserts `verdict === 'WAVE-INCOMPLETE'` and `basis === manifestDigest` (the incomplete verdict forces the reference basis). |
| F10 | row-breaking, RESOLVED | import-law under-pinned: vacuous zero-touch oracle + transitive module-graph rule untested | W5-01 deletes the vacuous recording facade (constructed after the import); keeps the own-source static scan; adds `walkImportGraph` — a recursive walk of the lane's static relative imports asserting no transitively-imported module has a top-level `await openBaton(` or `waves.start(` call site (col-0-anchored, so indented methods/string literals are not flagged). |
| F11 | major, RESOLVED | suite never configures the driver policy — a faithful implementation runs the 20 s default poll | `LANE_DRIVER = { pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 }` threaded via `driveLane` on every happy-path row (P3's vocabulary); pinned in the suite header and draft notes. |
| F12 | minor, RESOLVED (contract) | W1-02 over-pins scope admission beyond "mirrors path-scope.mjs" | Contract D1 admission text now states member admission = **wave.mjs's member laws PLUS path-scope's class**, all refusing `workflow_member_invalid` — the union the suite requires. No suite change (W1-02's cases are the union). |
| F13 | minor, RESOLVED | W6-02 over-pins the allowlist mechanism (quoted literals only) | W6-02 now accepts EITHER the five quoted literals OR a `startsWith('workflow_')` prefix-preservation branch in the `stateFailureCode` region — both satisfy B3's outcome. |
| F14 | minor, RESOLVED | W1-06's receipt-shape oracle loose (hasOwn, not exact key-set/order) | W1-06 asserts `Object.keys(receipt)` deep-equals the seven sorted keys `['basis','harvest','manifestDigest','outcomes','steering','verdict','waveId']` (in ACTUAL sorted order) plus the F9 verdict/basis values. |
| F15 | minor, RESOLVED | W2-01's zero-driver-script static self-check scans the TEST file, not the implementation | The banned-driver-verbs self-check is DROPPED from W2-01; the "no bespoke driver" assertion now lives on the implementation's module graph via the F10b transitive walk. |
| F16 | minor, RESOLVED | hermeticity nits: real clocks and timer budgets | `mockPrincipal` uses a fixed far-future `expiresAt` (FAR_FUTURE_ISO); `realServer` injects a fixed far-future `now` (FAR_FUTURE_MS); scenario `delayMs` budgets re-derived to 100 ms — well under `stallTimeoutMs: 400`, so a deliberate mid-turn pause never trips the wave-level stall clock. |

## Deferred findings (explicit)

| F# | Deferred | Reason |
|----|----------|--------|
| F7a | elevation typed-refusal retry ≤2 | `scratchpad_partition_exhausted` requires a 512-entry shared scratchpad partition; `stale_scratchpad_fence` requires fence timing — neither is reachable deterministically in the hermetic mock (coordination-store refusal codes confirmed at `elevateTaskScratchpad`). The ≤2-retry law stays contract text; the row is a depending-on-real-coordinator row. |
| F7c | `(runId, requestId)` replay dedup | MockAdapter's single-ask design can only answer a live `session.wait`; once resolved the turn does not re-wait on the same requestId, so a same-`requestId` replay cannot be produced to prove exactly-one-answer. |

## SOUND (kept as-is from §5)

P1-P4; W1-01/W1-04; W1-03/W1-05 refusal shapes; W2-01's re-drive structure (minus F15);
W3-answer/-answer-bounds (now with real wire observables); W4-01/W4-02 waveId/resultSha shapes
(now with F4/F5 closures); W5-01's own-source static scan (now with F10b); W6-01's three-surface
payload comparison (now with F6); W6-02 as the B3 proxy (loosened per F13).

## Citations / staging honesty

- Attempt-marker salt: `createWaveDriver` prepends `[attempt: ${salt} ${member.role}]` to the
  member objective (`wave-driver.mjs:312-316`, default `saltObjectives: true`).
- Delivery semantics: `sendMessage` (`coordinator.mjs` ~6785-6900) mints `message:<sha256>`
  unconditionally; the delivery chain is
  `Promise.resolve(adapter.prompt(...)).then(() => ({ok:true}), () => ({ok:false}))` — only a
  rejection yields `delivered: 0`.
- Elevation snapshot: `coordination-store.mjs:11532-11548` `_scratchpadSnapshot` carries the
  `elevations` array with `sourceEntryId`.
- Import-graph law: `index.mjs:50` `openBaton` is a definition (no `await openBaton(` prefix);
  `waves.start` appears only in indented methods/string literals — both verified safe under the
  col-0-anchored banned patterns.
