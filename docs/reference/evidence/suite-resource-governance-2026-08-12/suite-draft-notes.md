# #77 Suite Draft Notes — `suite-resource-governance-red.test.mjs`

Date: 2026-08-12 · Contract: **suite-resource-governance v1.1** (folded) · Suite: 26 rows (24 RED / 2 PIN)
Deliverables: `impl/test/suite-resource-governance-red.test.mjs` (this draft's only other deliverable).
Authority: `suite-resource-governance-contract.md` (v1.1 source of truth), `contract-fold.md` (the 6
calibration-seam resolutions — B1 the outcome-correctness gate, B2 the G4 split, B3 the honest-null
baseline, B4 the idle-concurrency preservation, B5 the sub-saturation factor, B6 the re-arm-on-progress
liveness bound), `contract-redteam.md` (attack surface), `suite-77-brief.md` (this suite's brief), and
the idiom suites `frame-economics-red.test.mjs` (the dynamic-import module-missing stage,
`limitsOrError`/`assertLimitsModule` at 222-241) + `browser-use-red.test.mjs` (the same pattern at
96-99) + `phase56-drain-and-close.test.mjs` (the deadline-sensitive family the folded bounds govern).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/suite-resource-governance-red.test.mjs   # run 1, repo root
ℹ tests 26
ℹ pass 2
ℹ fail 24
$ node --test impl/test/suite-resource-governance-red.test.mjs   # run 2, repo root
ℹ tests 26
ℹ pass 2
ℹ fail 24
$ node impl/scripts/run-suite.mjs impl/test/suite-resource-governance-red.test.mjs   # through the gate
ℹ tests 26
ℹ pass 2
ℹ fail 24
```

Two consecutive runs of the finished suite both produced **pass 2 · fail 24**; the pass/fail row set
is byte-identical across the two runs (the header records `tests 26 · pass 2 · fail 24` and the
stability). The 2 passes are exactly the two PIN rows (P1, P2); the 24 failures are the red rows,
each confirmed to fail at its NAMED stage (the per-row stage lives in the header row inventory AND in
each row's first-failing assertion message). The gate run (run-suite.mjs) yields the identical split —
the gate harness neither trips nor masks any row.

The gate exits 1 on the suite (correct: 24 red rows), with no `baton test runner` / `fixture-clock-lint`
/ `surface-conformance` harness errors in its output.

## Row map

Every red row fails at the named stage today and goes green on the v1.1 implementation ONLY. The
stage is the suite's honest HEAD failure seam: for the invented calibration module it is
`calibration-module-missing` (the dynamic import of the absent `impl/scripts/suite-calibration.mjs`
resolves to `ERR_MODULE_NOT_FOUND`, and `assertCalibrationModule` reports the named stage — the
`limitsOrError` precedent); for the gate-surface rows it is a gate-side named stage; for the PIN rows
the row is green today.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1 | RG-03 | | **calibration-module-missing** | `readCalibration()`/`scaledTimeout()` do not exist — the honest idle default (absent env → `null`; `scaledTimeout(2000) === 2000` byte-identical) has no surface to hold (the #10 honest-null analog) |
| A2 | RG-03/04 | | **calibration-module-missing** | `scaledTimeout(base, record)` has no surface — the injected factor-4 record's `8000` (vs the factor-1 record's `2000`) is unobservable (RG-04's measured-load derivation) |
| A3 | RG-04/06 | | **calibration-module-missing** | `measureCalibration`'s factor derivation has no surface — the synthetic high probe (284/71 → factor exactly 4, no ceil) and the quiet host (factor exactly 1) are unobservable; the real host is NEVER measured (test-double overrides only) |
| A4 | RG-05/D1.5 | | **calibration-module-missing** | the closed record shape has no surface — `Object.keys(rec)` ACTUAL order, the `recorded`/`unrecorded` baseline branch, and the honest-null `baselineProbeMs` on an unrecorded baseline (B3) are unobservable |
| A5 | D1.2 | | **calibration-module-missing** | the continuous sub-saturation factor has no surface — a 60%-busy synthetic load with a 1.6x probe ratio must yield `factor === 114/71` (~1.6056), never flattened to 1 and never ceiled (blocker B5) |
| A6 | D1 | | **calibration-module-missing** | the never-under-cut floor has no surface — factor ≥ 1 ⇒ a calibrated deadline is NEVER shorter than the honest static default (the floor law) |
| B1 | RG-01 | | **gate-calibration-line-missing** | the nested gate (real run-suite.mjs on a fixture) emits no `baton suite calibration:` stderr line today — the observable receipt a flake report would cite is absent (RG-01 red state) |
| B2 | RG-02 | | **gate-calibration-env-missing** | the gate's spawned test child sees no `BATON_SUITE_CALIBRATION` today (G1's env seam is absent — RG-02 red state); the fixture's observation (`{calibration: null}`) holds |
| C1 | RG-09 | | **calibration-module-missing** | `deriveTestConcurrency(cores, factor)` has no surface — factor 1 must preserve node's idle `os.availableParallelism() - 1` (blocker B4), a loaded host sheds, and the floor is 1 (no fork-bomb-by-calibration, D3.1) |
| C2 | RG-09 | | **gate-concurrency-missing** | run-suite.mjs passes no derived `--test-concurrency` flag today — the parallelism posture is not host-adapted (RG-09 red state) |
| C3 | D3.2 | | **calibration-module-missing** | `deriveStopGrace(baseGraceMs, factor)` has no surface — the wrapper's STOP path (grace × factor before SIGKILL) is not load-aware (D3.2) |
| D1 | RG-08 | | **calibration-module-missing** | `CAUSE_CLASSES` has no surface — the closed 5 (`timer_coalescing` merged into `event_loop_gap`, v1.1) in ACTUAL sorted order is unpinned |
| D2 | RG-08/D2.2 | | **calibration-module-missing** | `classifyCause(receipt, row)` has no surface — a confirmed load-flake receipt names exactly one closed class (`drain_deadline`; `start_latency` counter-example) |
| D3 | RG-08/D2.2 | | **calibration-module-missing** | the refusal of an unknown class has no surface — including the merged `timer_coalescing`, both must throw the typed `suite_calibration_invalid` |
| D4 | RG-13/B1 | | **calibration-module-missing** | the outcome-correctness gate has no surface — a load-flake whose outcome never lands is a REAL BUG (`null`, cap untouched); an isolated failure and a both-legs blip are also `null` (D2.1) |
| D5 | D2.4 | | **calibration-module-missing** | the missing-context refusal has no surface — a flake report never names a cause class without its calibration receipt (the honest-null analog) |
| E1 | RG-10 | | **calibration-module-missing** | `readCalibration()`'s malformed-env refusal has no surface — `'{not json'` must throw the typed `suite_calibration_invalid` naming the parse error, never a silent factor 1 (open question 3) |
| E2 | RG-10/D1.1 | | **calibration-module-missing** | the probe's fail-closed refusal has no surface — an injected sampler that throws must reject `suite_calibration_unavailable` naming the measurement (D4) |
| F1 | RG-12/D4 | | **calibration-module-missing** | `MARKERS` has no surface — the closed 3 (`absolute-timing`, `floor-raw`, `load-aware`) in ACTUAL order is unpinned |
| F2 | RG-12/D1.4/B2 | | **calibration-module-missing** | the closed G4 membership table has no surface — the SIGKILL window is split upper=scale / lower=floor-raw (blocker B2), every value a closed classification literal |
| F3 | RG-12 | | **calibration-module-missing** | `deriveRowBound` has no surface — `absolute-timing`/`floor-raw` rows are excluded from derivation (raw), a `scale` row derives (500 × factor 4) |
| G1 | D1.4/B6 | | **calibration-module-missing** | the re-arm-on-progress liveness bound has no surface — `createProgressDeadline({timeoutMs, now})` must re-arm on any `observe()` and fire only on `timeoutMs` of silence ("no new event since the last tick", blocker B6; the injected `now` is the fake-clock seam) |
| H1 | RG-07/§3 | | **calibration-module-missing** | the load-context receipt's name law has no surface — the record names `factor`/`load`/`probeMs` inside the closed key set and excludes `host`/`date`/`method`/`sampleN` (the baseline context lives in the separate baseline receipt, B3) |
| H2 | §3 | | **calibration-module-missing** | the ACTUAL-order law has no surface — every closed literal must be its own `.sort()` result; `localeCompare` is banned (the comparator family is canonical byte order) |
| P1 | G1 | PIN | argv-passthrough | green today — run-suite.mjs:105 passes `process.argv.slice(2)` to the test child; the derived `--test-concurrency` append (D3.1) must not disturb it |
| P2 | G9 | PIN | lint-before-child | green today — run-suite.mjs:19 runs `lintDefaultTestDirectory()` (#42) before the child; the calibration seam must add beside it, never disturb it |

## Invented surfaces

Every invented member is absent at HEAD (the seam the red row holds). The first assertion on every
invented export is the `assertCalibrationModule` guard (`assert.ok(!(module instanceof Error),
'stage: calibration-module-missing …')`) so the row fails at the named stage — never on a vacuous
shape assertion that a missing module's `undefined` exports could spuriously satisfy.

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `impl/scripts/suite-calibration.mjs` — the shared calibration module, dynamically imported (the `limitsOrError` precedent) | dynamic `import(URL)` → `assertCalibrationModule` | `ERR_MODULE_NOT_FOUND` (A1–A6, C1, C3, D1–D5, E1, E2, F1–F3, G1, H1, H2) |
| `measureCalibration({ load, probeMs, baselineProbeMs, probe })` → the D1.3 closed-key record — the overrides are the test-double seam (RG-04/RG-06); absent overrides measure the real host, but NO row exercises them | the module | undefined (A3–A6, E2) |
| `readCalibration()` → parsed `BATON_SUITE_CALIBRATION` \| `null`; throws `CalibrationRefusal` (`suite_calibration_invalid`) naming the parse error | the module + real env | undefined (A1, E1) |
| `scaledTimeout(base, record = readCalibration())` → `base * factor`, floored at the static default (factor ≥ 1) | the module | undefined (A1, A2, A6) |
| `deriveTestConcurrency(cores, factor)` → `max(1, ceil((cores - 1) / factor))` — factor 1 preserves `os.availableParallelism() - 1` (blocker B4) | the module | undefined (C1) |
| `deriveStopGrace(baseGraceMs, factor)` → `baseGraceMs * factor` (D3.2) | the module | undefined (C3) |
| `classifyCause(receipt, row)` → a closed cause-class member \| `null` \| throws `CalibrationRefusal` — the D2.1 discipline + the outcome-correctness gate (B1/RG-13) | the module | undefined (D1–D5) |
| `deriveRowBound(rowId, base, record)` → `scaledTimeout` for `scale` rows only (D1.4, RG-12) | the module | undefined (F3) |
| `createProgressDeadline({ timeoutMs, now })` → `{ observe(), expired() }`, the re-arm-on-progress bound (blocker B6) | the module | undefined (G1) |
| `G4_MEMBERSHIP` — frozen closed table: `deployment-settle-deadline`/`sigkill-window-upper` → `scale`, `request-timeout-wait`/`poll-interval-wake` → `absolute-timing`, `sigkill-window-lower`/`kill-grace-floor` → `floor-raw` (blocker B2) | the module | undefined (F2) |
| `CAUSE_CLASSES` = frozen `['drain_deadline','event_loop_gap','margin_window','poll_floor','start_latency']` (ACTUAL order) | the module | undefined (D1, H2) |
| `REFUSAL_CODES` = frozen `['suite_calibration_invalid','suite_calibration_unavailable']` (ACTUAL order) | the module | undefined (H2) |
| `MARKERS` = frozen `['absolute-timing','floor-raw','load-aware']` (ACTUAL order) | the module | undefined (F1, H2) |
| `BASELINE_BASIS` = frozen `['recorded','unrecorded']` (ACTUAL order) | the module | undefined (H2) |
| `CalibrationRefusal` — typed error class; `.code` is a `REFUSAL_CODES` member | the module | undefined (D3, D5, E1, E2) |
| the gate surface — the `baton suite calibration:` stderr line + the `BATON_SUITE_CALIBRATION` child env + the derived `--test-concurrency` flag | the real `run-suite.mjs` (B1, B2, C2) | absent today (each its own named stage) |

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **P1** argv-passthrough | an impl whose derived `--test-concurrency` append (D3.1) swallows or mangles `process.argv.slice(2)` — the gate must keep passing caller-ordered file args through (G1 precedence) |
| **P2** lint-before-child | an impl whose calibration seam removes or reorders the #42 `lintDefaultTestDirectory` run (G9) — the static time-bomb guard must keep firing before any child runs |

## What makes each stage go green (implementer's checklist)

- **calibration-module-missing** → ship `impl/scripts/suite-calibration.mjs` exporting the pinned
  surface (see the SUITE-PINNED API SURFACE in the suite header): `measureCalibration`,
  `readCalibration`, `scaledTimeout`, `deriveTestConcurrency`, `deriveStopGrace`, `classifyCause`,
  `deriveRowBound`, `createProgressDeadline`, the four frozen literals (`G4_MEMBERSHIP`,
  `CAUSE_CLASSES`, `REFUSAL_CODES`, `MARKERS`, `BASELINE_BASIS`), and the `CalibrationRefusal` class.
  The record's key set is the closed D1.3 shape in ACTUAL order: `baselineBasis`, `baselineProbeMs`,
  `cores`, `factor`, `load` (`{fifteen, five, one}`), `measuredAt`, `probeMs`, `schemaVersion`.
- **gate-calibration-line-missing** → D1.3/RG-01: the gate writes exactly one `baton suite
  calibration: <record>` stderr line per run (the record the suite's B1 parses back to the closed key
  set), so a flake report carries the load context verbatim.
- **gate-calibration-env-missing** → D1.3/RG-02/G1: the gate passes the identical record to the test
  child via `BATON_SUITE_CALIBRATION` (the spawn-env seam at run-suite.mjs:108-116), so the child-side
  `readCalibration()` and the gate-side line always agree.
- **gate-concurrency-missing** → D3.1/RG-09: the gate appends `--test-concurrency
  <deriveTestConcurrency(availableParallelism(), factor)>` to the child argv (precedence: caller file
  args first, the derived flag last — P1 holds).
- The module's derivation notes: `factor = max(1, load.one/cores, probeMs/BASELINE_PROBE_MS)` —
  continuous, never ceiled, floored at 1 (D1.2/B5); a calibrated deadline is never shorter than the
  honest static default (A6); the baseline is `recorded` when a real baseline receipt exists and
  `unrecorded` with an honest `null` `baselineProbeMs` otherwise (D1.5/B3); `classifyCause` follows
  the D2.1 discipline and refuses rather than guess (`suite_calibration_invalid`), and the
  outcome-correctness gate (B1/RG-13) returns `null` for a load-flake whose outcome never lands.
- The G4 membership table and its anchor rows are enumerated in the suite header — an implementer who
  reclassifies a row must update the header and the F2 literal together, never one without the other.

## Suite-law hygiene (verified)

- **Hermetic**: `mkdtempSync` fixture worlds for the gate probes only; a global `test.after` reaps
  every world; no network; no repo mutation. The nested gate is given a private `BATON_TEST_TMP_PARENT`
  (its allocated suite root is a descendant, cleaned with the world).
- **No REAL host load**: every load/factor/probe row injects the test-double overrides (`load`,
  `probeMs`, `baselineProbeMs`, `probe`); the real host is never measured. The only real-host read is
  `os.availableParallelism()` (a core count, not a load measurement) and it is used as the BASE for a
  synthetic load value (`load.one = cores * 0.6`) so the asserted factor is deterministic regardless of
  the host. B1/B2 assert the emitted record's closed key set only — never load values.
- **Red-first at named stages**: every RED row's first failing assertion carries the named stage (the
  `assertCalibrationModule` guard for module rows, the explicit `stage:` message for the gate rows);
  the stage names live in the header inventory AND in each row's assertion message. 24 RED / 2 PIN,
  byte-stable across consecutive runs.
- **No clocks as controls**: the suite never reads the wall clock. G1 is the only timing row and it
  drives the injected `now` clock seam (`createProgressDeadline({timeoutMs: 100, now: () => now})`) —
  fake timers are allowed by design (D1.4/B6). A4's `measuredAt` check asserts ISO shape only, never
  an instant.
- **No `localeCompare`**: the suite never calls it; H2 asserts every closed literal (the suite's own
  `RECORD_KEYS`/`LOAD_KEYS` and the module's four literals) is its own `.sort()` result — ACTUAL byte
  order, `localeCompare` banned.
- **NUL discipline**: `suite-resource-governance-red.test.mjs` and `run-suite.mjs` (the only source
  file the suite reads whole, for P1/P2/C2) are NUL-free; the NUL-bearing implementation files are
  never read — only the invented module's exports are probed via dynamic import.
- **Nested-gate isolation**: the gate probe sanitizes `BATON_SUITE_*`/`BATON_TEST_SUITE_ROOT` from the
  nested gate's env so the calibration seam stays isolated, and clears `NODE_TEST_CONTEXT` — a nested
  `node --test` otherwise refuses to run files when it inherits the parent test-runner's marker env
  ("node:test run() is being called recursively"), which silently skips the fixture. The observation
  channel is named `BATON_RG_OBSERVED` (never a `BATON_SUITE_*` name, which the sanitizer strips).

## Deployment verification

The brief's deployment-verification command — executable `true`, args `[]`, cwd `.`, expected exit 0 —
passes as specified (a no-op command is the Baton result-policy stub; the suite itself is red-first by
design, so the gate exits 1 until the implementation lands).
