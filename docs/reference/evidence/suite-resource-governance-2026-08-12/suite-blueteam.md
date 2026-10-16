# #77 BLUE-TEAM SUITE REVIEW — attack the suite-resource-governance red-first suite

**Verdict:** **NEEDS-FOLD**
**Date:** 2026-08-13
**Target:** `impl/test/suite-resource-governance-red.test.mjs` (26 rows: 2 green PINs, 24 red at named
stages — A ×6, B ×2, C ×3, D ×5, E ×2, F ×3, G ×1, H ×2)
**Contract:** `suite-resource-governance-contract.md` v1.1 (folded) · **Fold:** `contract-fold.md`
(the 6 calibration-seam resolutions B1–B6)
**Suite notes:** `suite-draft-notes.md` · **Brief:** `blueteam-77-brief.md` (this campaign)
**Review HEAD:** `c5c678b8fed012933669b96ef01389a7211d9864` (Baton private effective-tree snapshot;
worktree HEAD)

**Read-order executed (in full):** (1) `suite-resource-governance-contract.md` v1.1 — the G1–G12
ground truths, the four decisions (D1 the measured-load calibration model, D2 flake-taxonomy honesty,
D3 the adaptive parallelism posture, D4 the refusal/observability vocabulary), §3 closed literals,
§5 RG-01..RG-13 acceptance pins; (2) `contract-fold.md` — all six blocker resolutions (B1 the
outcome-correctness gate, B2 the closed G4 membership table, B3 the honest-null baseline, B4 the
idle-concurrency preservation, B5 the sub-saturation factor + event-loop-gap probe, B6 the
re-arm-on-progress liveness bound); (3) `impl/test/suite-resource-governance-red.test.mjs` — all 26
rows, the SUITE-PINNED API SURFACE, the G4 membership anchors, and the P1/P2 pins; (4)
`suite-draft-notes.md` — the row map, invented surfaces, PIN list, and suite-law hygiene.

---

## 1. Verification performed (before claiming stage honesty)

### 1.1 The suite was run twice from the repo root (`node --test impl/test/suite-resource-governance-red.test.mjs`)

| Run | tests | pass | fail | cancelled/skipped/todo | wall |
|-----|-------|------|------|------------------------|------|
| 1 | 26 | 2 | 24 | 0 / 0 / 0 | 0.94 s |
| 2 | 26 | 2 | 24 | 0 / 0 / 0 | 1.30 s |

The split is **deterministic across two consecutive runs** — the pass/fail **row set is byte-identical
by name** across the two runs (the only diffs are the per-row measured durations in the log). The 2
passes are exactly the two PIN rows (P1 argv-passthrough, P2 lint-before-child); the 24 failures are
the red rows. The gate run (`node impl/scripts/run-suite.mjs
impl/test/suite-resource-governance-red.test.mjs`) yields the identical split — `tests 26 · pass 2 ·
fail 24` — exits 1 (correct: 24 red rows), and prints **no** `fixture-clock-lint` / `surface-conformance`
/ `baton test runner` harness errors.

### 1.2 Named-stage honesty (verified from the failure log)

Every red row's first failing assertion carries its named stage. All 24 failures are
`AssertionError`s inside the row bodies — zero fixture errors/crashes:

| Row(s) | Failing stage (assertion text) |
|--------|--------------------------------|
| A1–A6, C1, C3, D1–D5, E1, E2, F1–F3, G1, H1, H2 | `stage: calibration-module-missing — impl/scripts/suite-calibration.mjs does not exist (ERR_MODULE_NOT_FOUND)` |
| B1 | `stage: gate-calibration-line-missing — run-suite.mjs emits no calibration line today (RG-01 red state)` |
| B2 | `stage: gate-calibration-env-missing — the child saw no BATON_SUITE_CALIBRATION today (RG-02 red state)` |
| C2 | `stage: gate-concurrency-missing — the gate passes no derived --test-concurrency today (RG-09 red state)` |

The B1/B2 gate probe returns **status 0** at HEAD on the single-fixture nested gate (re-verified
directly: `node impl/scripts/run-suite.mjs <fixture>` → exit 0, `tests 1 · pass 1`, observed
`{"calibration":null}`), so B1/B2 fail at their named stages, not at the `probe.status === 0`
assertion — at HEAD.

### 1.3 Citations verified (`grep -an` / `sed -n`; the two NUL files not opened whole)

Every anchor the contract and draft notes cite was re-verified at the review HEAD. The two
NUL-bearing product-kernel files (`impl/src/application.mjs` — 3 NUL bytes, `impl/src/coordination-store.mjs`
— 3 NUL bytes, both measured with a byte count) are referenced only as untouchable names (§4) and
were never opened whole.

| Citation | Verified at | Matches |
|---|---|---|
| G4 membership: deployment settle `< 500` | `phase56-drain-and-close.test.mjs:268` | `assert.ok(Date.now() - started < 500, 'deployment deadline bounds a never-settling cleanup')` |
| G4 membership: SIGKILL window | `phase56-drain-and-close.test.mjs:645` | `assert.ok(Date.now() - started >= 4_500 && Date.now() - started < 8_000)` |
| G4 membership: request-timeout wait | `grok-acp.test.mjs:648` / `codex-appserver.test.mjs:527` | `assert.ok(elapsed < 2000, 'expected a bounded wait near requestTimeoutMs, took …')` |
| G4 membership: poll-interval wake | `bidirectional-driver-red.test.mjs:1176` | `assert.ok(woke.elapsedMs < 1_000, 'woke before the interval (elapsed …)')` |
| G4 membership: kill-grace floor | `claude-session.test.mjs:633` | `assert.ok(elapsed >= 60, 'the SIGKILL escalation genuinely waited out the grace window…')` |
| Poll vocabulary | `kimi-acp.test.mjs:18` (`waitFor`, 2 000 ms); `grok-acp.test.mjs:73` (`until`, 3 000 ms); `phase8-correctness.test.mjs:75` (`waitUntil`, 1 500 ms) | ✓ |
| Gate argv passthrough / child spawn | `run-suite.mjs:105` (`['--import', watchdogUrl, '--test', ...process.argv.slice(2)]`), `:108-116` (spawn env), `:19` (`lintDefaultTestDirectory()`), `:217/:225/:232/:241` (the G2 STOP-path constants) | ✓ |
| Evidence wrapper STOP path | `run-evidence.mjs:13` (`TERM_GRACE_MS = 5_000`), `:15` (`POLL_MS = 25`), `:122`, `:127`, `:137` | ✓ |
| #42 static guard | `fixture-clock-lint.mjs:1-14, 24-48` (`lintFixtureClocks` with injected `now`) | ✓ |
| #40 evidence hygiene | `suite-hygiene.mjs:1-10, 23-32` (`ownerDead`) | ✓ |
| `npm test` = the gate | `impl/package.json:27` | `"test": "node scripts/run-suite.mjs"` |
| #7 recurrence receipts | `docs/PROGRESS.md:12-14, 401-405, 425-427`; `frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:52` | ✓ |
| #7 class definition + B4 fix | `stall-watchdog-2026-08-07/suite-blueteam.md:246-260` (F7), `:251`, `:256-257` | ✓ |
| #67 control law | `stall-watchdog-2026-08-07/suite-67-brief.md:18-20`; `stall-watchdog-contract.md:422-428` | ✓ |
| #10 honest-null | `waiting-vocabulary-2026-08-06/grounding.md:234-240` | ✓ |
| #80 F2 precedent (poll_floor) | `tg3-window-2026-08-07/suite-blueteam.md:130-142` | ✓ |
| Idiom: dynamic-import module-missing | `impl/test/browser-use-red.test.mjs:96-99`; `impl/test/frame-economics-red.test.mjs:222-241` | ✓ (see F10) |

### 1.4 Hermeticity scan (real timers / load reads)

The suite's only real wall-clock surface is the `spawnSync(..., { timeout: 30_000 })` in `gateProbe()`
(`:246`). No `Date.now()` / `setTimeout` / `setInterval` / `performance.now()` elsewhere; G1 drives the
injected `now()` seam. The only real-host read is `os.availableParallelism()` (a core count, not a load
measurement), used as the deterministic base for synthetic load in A5 (`load.one = cores * 0.6`) and
A4's `cores` shape check. No row asserts a load value from the real host.

---

## 2. Verdict summary

The suite is a strong, stage-clean, well-anchored red-first instrument: the D2.1 discipline is
genuinely pinned by D4/D5 (the outcome-correctness gate, the fails-isolated refusal, the both-legs
blip, the missing-context refusal), the closed literals are pinned by H2, the refusal surface by
E1/E2, the G4 split by F2, the re-arm-on-progress bound by G1, and the calibration-math rows (A1–A6)
are exact and deterministic through the injection seam. It is **not fold-blocking-safe yet**:

- **F1 is a green-side blocker** in the exact habitat the suite exists to govern: B1/B2 run the
  *real* calibration probe on the real host, so under load the nested gate can refuse
  (`suite_calibration_unavailable` after the 2 s probe cap) and false-fail a *correct* implementation
  — the deepest irony the brief named, and a contradiction of the suite's own "no row depends on real
  host load" law.
- **F2** lets the parallelism posture pass on a source-grep alone (concurrency exceeding the host
  bound is invisible to the suite).
- **F3** lets the calibration rows pass with a hardcoded baseline wearing a measurement costume (no
  real sample, no recorded baseline receipt).
- **F4/F5** are the two missing rows the brief asked about: the load-context receipt on a **failing**
  run, and the per-file vs whole-run budget separation.
- **F6–F9** are smaller but concrete completeness holes.

Per the brief's output law the verdict is **NEEDS-FOLD** with the numbered findings below as the fold
work-list.

---

## 3. Numbered findings

### F1 — GREEN-SIDE BLOCKER / HERMETICITY (#7 CLASS): B1/B2 run the real calibration probe on the real host — a flake factory under the exact load the suite governs

- **Row/gap:** B1 (`suite-resource-governance-red.test.mjs:256-265`) and B2 (`:267-276`) spawn the
  **real gate** (`run-suite.mjs`) on a single fixture through the shared `gateProbe()` (`:218-254`).
  Once the v1.1 implementation lands, `run-suite.mjs` will call `measureCalibration()` with **no
  overrides** at startup (D1.1), which reads `os.loadavg()` and times **K = 5 sequential event-loop-gap
  samples**, each with a hard **2 s cap that is refusal semantics** — a sample over 2 s refuses the run
  with `suite_calibration_unavailable` (D1.1, D4), never a truncated value. B1/B2 assert
  `probe.status === 0` *before* their stage assertions (`:258`, `:269`). On a loaded host — the #7
  habitat the contract exists to govern — the 2 s probe cap is a real timer that can fire, the nested
  gate refuses and exits non-zero, and B1/B2 **false-fail a correct implementation**.
- **Attack:** run the suite on the loaded host. The nested gate's real event-loop probe (real timers)
  and its `spawnSync` 30 s wrapper timeout (`:246`) are wall-clock races. This is exactly the #7 class
  ("a wall-clock race between a test stream and a real timer", `suite-blueteam.md:251`), and it
  contradicts the suite-law note in `suite-draft-notes.md` ("the real host is never measured" — true at
  HEAD only, because the gate has no calibration yet; false after implementation). B1/B2's green side
  will depend on the real probe not refusing, i.e. on real host timing.
- **Concrete fix:** give the gate a calibration **injection seam** the nested gate can use (the gate
  honors an env override that short-circuits the measurement, mirroring the RG-04/RG-06 module-level
  overrides), and have `gateProbe()` inject a synthetic record so **no real loadavg/probe measurement
  runs** in B1/B2. The override must follow the `BATON_RG_*` naming the suite already established
  (`BATON_RG_OBSERVED`) — a `BATON_SUITE_*` name would be stripped by the suite's own gateProbe
  sanitizer (`:240-244`) and the nested gate would never see it. Keep asserting the closed key set and
  the single-line count; the rows' purpose (the gate's line + env surface) is preserved without a
  real-timer dependence. Also drop or raise the 30 s `spawnSync` timeout — it is itself a #7-class real
  bound the suite should not carry.

### F2 — RED-SIDE (SHALLOW-GREENABILITY): C2 is a source-grep oracle — an implementation passes it while concurrency stays unadapted, including exceeding the host bound

- **Row/gap:** C2 (`:293-297`) asserts only `gateSource.includes('--test-concurrency')`. Any textual
  occurrence — a comment, dead code, or a hardcoded `--test-concurrency 999` appended to the child argv
  — satisfies it. P1 (`:472-476`) is the same grep shape on `process.argv.slice(2)`. No row observes the
  child's **argv**; B1/B2 observe the env and stderr only. An implementation that always passes
  `--test-concurrency=<cores>` or larger — concurrency **exceeding the host bound**, the exact
  oversubscription D3.1's shed exists to prevent — passes C2 and P1.
- **Attack:** append the literal in a comment (C2 green) while leaving the gate's parallelism
  unchanged, or hardcode an oversubscribed `--test-concurrency` in the child argv; the suite never
  sees the value. RG-09's red state is claimed, but the oracle is textual, not behavioral.
- **Concrete fix:** make RG-09 behavioral. Spawn the gate with a fixture that writes `process.argv`
  (the B1/B2 `BATON_RG_OBSERVED` observation channel already exists) and assert the child received
  `--test-concurrency` equal to `deriveTestConcurrency(cores, factor)` and, at factor 1, `<=
  os.availableParallelism() - 1` (D3.1). This also pins the precedence law (caller args first, derived
  flag last) behaviorally instead of by grep.

### F3 — RED-SIDE (SHALLOW-GREENABILITY / MEASUREMENT COSTUME): no row pins that the probe samples the event loop or that the baseline comes from a recorded receipt

- **Row/gap:** RG-05's oracle — "`measureCalibration()` times K sequential event-loop-gap samples …
  with the baseline from the recorded receipt (D1.5)" — is under-pinned. A1–A6, H1, H2 inject
  `probeMs` / `baselineProbeMs` overrides and assert derivation and shape only; none asserts a real
  sample occurred, and none reads a baseline receipt. A4's unrecorded branch is explicitly
  branch-consistent (the suite cannot force the receipt's absence, `:185-191` accepts either basis and
  a hardcoded recorded value). E2 (`:375-383`) forces an *injected* `probe` to be called, but only when
  an override is provided.
- **Attack:** an implementation that returns `{ probeMs: injected ?? 71, baselineProbeMs: injected ??
  71, baselineBasis: 'recorded', factor: max(1, …) }` and **never samples the event loop nor reads a
  baseline receipt** passes every module row (E2 only requires calling an explicitly injected probe).
  This is the D9 honest-static precedent worn as a costume — a hardcoded constant presented as a
  measured baseline, the "no bigger global constant" law (D1.5) violated in its exact shape.
- **Concrete fix:** add a row that injects a **counting probe** (the D1.1 shape) and asserts it is
  called exactly **K = 5 times, sequentially with non-overlapping cadence windows** (blocker B5(ii) —
  a parallel probe was measured to self-inflate +58 %); and a row that exercises the **baseline-receipt
  read** (inject a baseline-receipt path and assert `baselineBasis: 'recorded'` + the recorded
  `baselineProbeMs` come from it, while an absent receipt yields the honest-null `baselineProbeMs: null`).

### F4 — RED-SIDE (MISSING ROW): the load-context receipt is pinned only on a PASSING child run — the actual flake-report surface (a failing run) is never exercised

- **Row/gap:** B1/B2 use a green fixture (writes `observed.json`, passes) and assert status 0 first.
  RG-07's receipt is defined as "the calibration line (stderr) + the failing row name (`node --test`
  output)". No row asserts the calibration line appears when the child **fails**.
- **Attack:** an implementation that emits the line / sets the env only when the child passes satisfies
  B1/B2 (the fixture passes), while a real failing run carries no load context — the exact gap RG-07
  exists to close. The receipt is written before the child spawns by contract, but the suite never
  proves the failure path carries it.
- **Concrete fix:** add a B-row (or a third `gateProbe` leg) whose fixture **fails** (e.g., throws),
  and assert the calibration line still appears exactly once in stderr and the env is still set for the
  failing child. The receipt must not depend on the child's outcome.

### F5 — RED-SIDE (MISSING ROW): the per-file vs whole-run budget separation is unpinned — a wrong implementation can derive a whole-run budget from per-file deadlines

- **Row/gap:** D3.2's "the whole-run budget is the operator's SIGTERM/SIGINT — a backstop, never a
  product clock, never derived from the per-file deadlines" has no row. C3 pins `deriveStopGrace` (the
  STOP-path grace scaling) only; the draft notes classify the separation as a wrapper-side convention /
  process pin. But a source-grep row — the suite's own C2/P1 technique — is available and assertable.
- **Attack:** an implementation adds a derived whole-run wall budget (e.g., `--test-timeout = sum(per-file
  deadlines) * factor`, or a `Date.now()`-based whole-run cap inside the gate); every row stays green
  and the operator's SIGTERM backstop is silently replaced by a product clock.
- **Concrete fix:** add a source-grep row asserting the gate derives **no** whole-run `--test-timeout`
  / wall budget from the calibration (mirror C2), and (optionally) a row pinning that the only
  whole-run backstop is the signal path (`requestStop` / the double-signal-immediate-SIGKILL escape,
  D3.2).

### F6 — MINOR (MISSING ROW): only the `probe` branch of `suite_calibration_unavailable` is pinned — the `loadavg` branch is untested

- **Row/gap:** D4's refusal table says `suite_calibration_unavailable` "names the failed measurement
  (`probe`/`loadavg`) and the cause". E2 covers the probe branch (regex `/probe/`). No row forces a
  loadavg-measurement failure through the injection seam.
- **Attack:** an implementation that refuses only on probe failure and silently proceeds (or names the
  wrong measurement) when the `os.loadavg()` read fails passes — a partial fail-closed surface.
- **Concrete fix:** extend E2 (or add E3) — inject a throwing load read (e.g., a `load` override whose
  getter throws) and assert the refusal carries `suite_calibration_unavailable` and names `loadavg`.

### F7 — MINOR (SHALLOW-GREENABILITY): F3 exercises `deriveRowBound` for only 3 of the 6 G4 rows — the SIGKILL-window split and the poll wake are pinned only as literals

- **Row/gap:** F3 (`:413-421`) exercises `request-timeout-wait` (absolute-timing), `kill-grace-floor`
  (floor-raw), `deployment-settle-deadline` (scale). `poll-interval-wake` (absolute-timing),
  `sigkill-window-upper` (scale), and **`sigkill-window-lower` (floor-raw)** are pinned only in the F2
  table literal (`:395-411`). If `deriveRowBound` carries an internal mapping independent of
  `G4_MEMBERSHIP`, the three untested members can be misclassified.
- **Attack:** an implementation whose `deriveRowBound` maps `sigkill-window-lower` → scale passes F2
  (the table literal is right) and F3 (only 3 rows tested) — the floor silently scales, the inverse
  violation the brief named (a calibrated deadline below/weakening a floor, D1.4's "floor-raw → never
  scales").
- **Concrete fix:** extend F3 to iterate **all six** G4 members, asserting raw for
  absolute-timing/floor-raw and `base * factor` for scale at a high factor.

### F8 — MINOR (SHALLOW-GREENABILITY): the unmarked default (derivation, load-aware) is unpinned — a wrong implementation can silently flip the fleet's default to raw

- **Row/gap:** D4's marker-default law — "absent both markers, the default is derivation (load-aware),
  because the flake cluster is the default" — is what makes the 285 files' rows load-aware at the
  implementation commit. The suite pins `MARKERS` (F1) and the 6-row `G4_MEMBERSHIP` (F2), but no row
  asserts an **unmarked** rowId derives. F3's three rows are all G4 members.
- **Attack:** an implementation whose `deriveRowBound` returns `base` for any rowId not in
  `G4_MEMBERSHIP` passes — the entire unmarked fleet stays unscaled while the tested rows (all table
  members) derive. The flake cluster's default silently flips to raw.
- **Concrete fix:** add a `deriveRowBound` row with an unmarked rowId at a high factor asserting
  `base * factor`, pinning D4's load-aware default.

### F9 — MINOR (D2.1 COMPLETENESS): the "fails isolated (regardless of load)" discipline is pinned only for the isolated-fail/load-fail combination — the isolated-fail/load-pass combination is untested

- **Row/gap:** D4's isolated case (`:348`) sets **both** legs failed
  (`{ isolated: { failed: true }, load: { failed: true } }`). D2.1's "Fails isolated (regardless of
  load) → REAL BUG" also covers `isolated.failed === true` + `load.failed === false`. The suite never
  tests that receipt.
- **Attack:** an implementation keyed on `load.failed === false` → "passed load = not a bug → return
  cause" would return a cause class for an isolated-failure receipt (a REAL BUG recalibrated away — the
  exact thing D2 exists to kill) and pass D4, whose isolated case has `load.failed === true`.
- **Concrete fix:** add the isolated-true / load-false combination to D4 (expect `null`).

### F10 — MINOR (CITATION PRECISION): the suite header cites the idiom suites at `test/...` but they live at `impl/test/...` — the anchors don't resolve

- **Row/gap:** the header (lines 22-24) cites `test/browser-use-red.test.mjs:96-99` and
  `test/frame-economics-red.test.mjs:222-241`; no top-level `test/` directory exists in this repo.
  `suite-draft-notes.md` cites them correctly. A reviewer following the header anchor lands on a
  nonexistent path.
- **Concrete fix:** correct the header to `impl/test/browser-use-red.test.mjs:96-99` and
  `impl/test/frame-economics-red.test.mjs:222-241`.

*(Note, not a numbered finding:* P1/P2 are source-grep green pins — they protect existing strings and
are acceptable as regression guards, but they are comment-satisfiable; that weakness is folded into
F2's family. *)*

---

## 4. What holds (the suite-law and control-law surfaces)

- **Green-side, module rows:** every A/C/D/E/F/G/H row is greenable under a correct v1.1
  implementation through the injection seam — the fake-load doubles mint every load state the rows need
  deterministically (A5's `load.one = cores * 0.6` + `probeMs: 114 / baselineProbeMs: 71` yields the
  exact `114/71` factor on any host; A2/A3/A6 the exact factor-4 and factor-1 states). No module row
  requires a real load value.
- **D2's anti-masking law:** D4/D5 genuinely pin the outcome-correctness gate (outcome-unconfirmed →
  `null`), the fails-isolated refusal, the both-legs blip, and the missing-context refusal — a wrong
  implementation cannot simply return the receipt's `cause`.
- **Closed literals:** H2's `.sort()`-self test over `RECORD_KEYS`, `LOAD_KEYS`, `CAUSE_CLASSES`,
  `REFUSAL_CODES`, `MARKERS`, `BASELINE_BASIS` pins ACTUAL order with no `localeCompare`; the
  `timer_coalescing` merge into `event_loop_gap` is pinned by D1/D3.
- **Stage honesty + hermeticity:** at HEAD every red row fails at its named stage with zero fixture
  errors; mkdtemp-only fixture worlds with a global `test.after` reap; no real load values asserted;
  G1 drives the injected `now` seam; the B1/B2 nested gate is env-isolated (`BATON_SUITE_*` sanitized,
  `NODE_TEST_CONTEXT` cleared).
- **Control law:** the suite adds no clock to any workflow control surface; the product kernel is
  untouched; no row asserts a wall-clock behavior of the fleet.

---

## 5. Bottom line

The suite is an honest, stage-clean, well-anchored red-first instrument, and its calibration-math,
anti-masking, closed-literal, and re-arm-on-progress rows are genuinely load-bearing. It is **not
fold-blocking-safe yet**: F1 can keep a *correct* implementation from going all-green under the exact
load the suite governs (the nested gate's real probe — the deepest irony), and F2/F3 let the
parallelism posture pass on a grep and the calibration pass with a hardcoded-baseline costume
respectively. F4/F5 are the two missing rows the brief called out (the failing-run receipt, the
per-file vs whole-run budget separation); F6–F9 are smaller but concrete. Per the brief's output law
the verdict is **NEEDS-FOLD** with the numbered findings above as the fold work-list.

**Deployment verification command** (Baton): executable `true`, arguments `[]`, working directory `.`,
expected exit 0 — the authored change is this document, and the calibration line is a pinned
future-gate property (RG-01), not a property the current gate must yet emit.
