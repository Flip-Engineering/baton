# #77 SUITE FOLD-2 — blue-team findings → resolution map (suite-resource-governance red suite)

**Fold source:** `suite-blueteam.md` — verdict **NEEDS-FOLD**, ten numbered findings (F1–F10).
**Fold target:** `impl/test/suite-resource-governance-red.test.mjs` (primary), `suite-draft-notes.md`,
and `suite-resource-governance-contract.md` (v1.2 — the two contract-surface seams the fold requires).
**Fold-2 brief:** `suite-fold-2-brief.md` (this directory). **Verification:** the suite runs twice from
the repo root plus once through the gate — both splits recorded below.

The fold changes the suite's shape from **26 rows (24 RED / 2 PIN)** to **32 rows (30 RED / 2 PIN)**.
Every new row is red at a NAMED stage at HEAD and goes green only on the v1.1 implementation.

| Finding | Verdict | Resolution (row/section) |
|---|---|---|
| **F1** — GREEN-SIDE BLOCKER / HERMETICITY (#7 class): B1/B2 run the real calibration probe on the real host | **FOLDED** | the gate's `BATON_RG_CALIBRATION` injection seam (contract v1.2, D1.1); `spawnNestedGate()` injects a synthetic record and the 30 s `spawnSync` timeout is dropped. B1/B2 keep their closed-key-set + single-line + status-0 assertions (B1, B2). |
| **F2** — RED-SIDE (SHALLOW-GREENABILITY): C2 is a source-grep oracle; concurrency exceeding the host bound is invisible | **FOLDED** | C2 is behavioral — the argv-observing fixture reads the test runner's own command line (`/bin/ps`, the gate's own dependency); asserts the derived `--test-concurrency` value, the factor-1 host bound `<= availableParallelism() - 1`, and caller-first/derived-last precedence (C2). |
| **F3** — RED-SIDE (MEASUREMENT COSTUME): no row pins real sampling or the baseline receipt | **FOLDED** | A7 pins the counting probe: exactly K = 5 sequential, non-overlapping cadence-window calls. A8 pins the baseline-receipt read via the new `baselineReceiptPath` seam (recorded from a present receipt; honest null from an absent one). A4's unrecorded branch is made deterministic through the same seam (A7, A8, A4). |
| **F4** — RED-SIDE (MISSING ROW): the load-context receipt is pinned only on a passing child | **FOLDED** | B3 runs a FAILING fixture and asserts the calibration line appears exactly once in stderr and the env is set for the failing child — the receipt is outcome-independent (RG-07). |
| **F5** — RED-SIDE (MISSING ROW): per-file vs whole-run budget separation unpinned | **FOLDED** | C4 (module-staged) asserts the gate derives no whole-run `--test-timeout` from the calibration and that the only whole-run backstop is the signal path (`requestStop` / the double-signal-immediate-SIGKILL escape, D3.2). |
| **F6** — MINOR (MISSING ROW): only the `probe` branch of `suite_calibration_unavailable` is pinned | **FOLDED** | E3 injects a throwing `load.one` getter and asserts the refusal carries `suite_calibration_unavailable` naming `loadavg`. |
| **F7** — MINOR (SHALLOW-GREENABILITY): F3 exercises 3 of the 6 G4 rows | **FOLDED** | F3 iterates all six G4 members — raw for absolute-timing/floor-raw, `base * factor` for scale at factor 4. |
| **F8** — MINOR (SHALLOW-GREENABILITY): the unmarked default (derivation, load-aware) is unpinned | **FOLDED** | F4 asserts an unmarked rowId derives `base * factor` at a high factor — the flake cluster stays the load-aware default (D4). |
| **F9** — MINOR (D2.1 COMPLETENESS): the isolated-fail/load-pass combination is untested | **FOLDED** | D4 gains the isolated-true / load-false receipt, expecting `null` — a quiet load leg does not mask a REAL BUG. |
| **F10** — MINOR (CITATION PRECISION): the header cites `test/...` but the idiom suites live at `impl/test/...` | **FOLDED** | the header now cites `impl/test/browser-use-red.test.mjs:96-99` and `impl/test/frame-economics-red.test.mjs:222-241`. |

*(Note, not a numbered finding:* the blue-team folded P1/P2's comment-satisfiability into F2's family;
P1/P2 remain green regression guards. *)*

---

## F1 — GREEN-SIDE BLOCKER: the nested gate must never run a real probe (hermeticity, #7 class)

**The fix in the suite.** `gateProbe()` is refactored into a general `spawnNestedGate({ fixture,
args, calibration })` helper that injects a synthetic full record via `BATON_RG_CALIBRATION` — the
gate's injection seam (contract v1.2, D1.1). When present, the gate short-circuits its start-of-run
measurement and uses the injected record verbatim for the D1.3 line and the child env, so B1/B2/B3/C2
never run a real `os.loadavg()` read or event-loop-gap probe. The override deliberately uses the
`BATON_RG_*` observation naming the suite already established — a `BATON_SUITE_*` name would be
stripped by the nested-gate sanitizer and the gate would never see it.

The 30 s `spawnSync` timeout is dropped: a wall bound on the nested gate is itself a #7-class real
race the suite should not carry (the fixtures are trivial write-and-exit scripts and the gate reaps
its own child).

B1/B2 keep their assertions — status 0, exactly one `baton suite calibration:` line, the closed key
set, and the identical child env — so their purpose (RG-01/RG-02) is preserved without a real-timer
dependence.

**The contract change.** D1.1 gains the hermeticity-seam paragraph; the header gains the v1.2 fold-2
note. The gate's contract now names the override an implementer must honor for the suite's gate
probes to be green-side-safe.

## F2 — C2 becomes behavioral (RG-09 is no longer a source-grep oracle)

The fixture now reports the test runner's own argv: node's runner consumes `--test-concurrency` (the
fixture's own `process.argv` is `[node, fixture]`), so the fixture reads its **parent process** command
line via `/bin/ps` — the same command the gate already depends on (`run-suite.mjs` uses it for the
tracked process group). The row asserts:

1. **Presence** — the runner argv carries a `--test-concurrency` flag (the named HEAD stage
   `gate-concurrency-missing`).
2. **Value** — at injected factor 4, the flag equals `deriveTestConcurrency(cores, 4)`, i.e.
   `max(1, ceil((cores - 1) / factor))`.
3. **Host bound** — at factor 1, the flag `<= os.availableParallelism() - 1` (D3.1, blocker B4:
   an oversubscribed `--test-concurrency=cores` can no longer pass).
4. **Precedence** — with a caller `--test-concurrency 999` passed through the gate, the LAST
   occurrence is the derived value (caller args first, derived flag last, D3.1).

The module import is deferred until after the presence assertion, so the row still fails at
`gate-concurrency-missing` at HEAD (not `calibration-module-missing`).

## F3 — the measurement costume is dead (A7, A8, A4)

- **A7** injects a counting probe (the D1.1 per-sample seam) and asserts it is called exactly
  **K = 5 times**, **sequentially** — the probe tracks in-flight calls and the row asserts
  `maxInFlight === 1`, pinning blocker B5(ii)'s non-overlapping cadence windows without a real timer.
- **A8** exercises the baseline-receipt read through the new `baselineReceiptPath` override (contract
  v1.2, D1.4/D1.5): a present receipt JSON yields `baselineBasis: "recorded"` with the recorded
  `baselineProbeMs`; an absent receipt path yields `baselineBasis: "unrecorded"` with the honest-null
  `baselineProbeMs`.
- **A4**'s unrecorded branch (previously branch-consistent because "the suite cannot force the
  receipt's absence") is now deterministic through the same seam — an absent path is forced.

An implementation that returns `{ probeMs: 71, baselineProbeMs: 71, baselineBasis: 'recorded' }` from
a hardcoded constant — never sampling the event loop, never reading a receipt — now fails A7 (no
sampling), A8 (the receipt read), and E2/E3 (fail-closed refusals).

## F4 — the failing-run receipt (B3, RG-07)

B3 runs a fixture that **throws** after writing its observation, and asserts — with **no** status-0
precondition — that the calibration line still appears exactly once in stderr and the failing child
still received `BATON_SUITE_CALIBRATION` identical to the line. The receipt is written by the gate
before the child spawns, so it cannot depend on the child's outcome; B3 is the exact surface a flake
report cites. At HEAD it fails at `gate-calibration-line-missing`.

## F5 — the whole-run budget separation (C4, D3.2)

C4 is staged on the calibration module (red at `calibration-module-missing` at HEAD) and then asserts
from the gate source that the gate derives **no** whole-run `--test-timeout` from the calibration —
the per-file deadlines carry the load-aware calibration, and the whole-run budget is the operator's
SIGTERM/SIGINT backstop, never a product clock. It also pins that the only whole-run backstop is the
signal path (`requestStop` / `signalGroup` + `SIGTERM`/`SIGINT`), mirroring C2's gate-source
technique.

## F6 — the loadavg refusal branch (E3)

E3 injects a `load` override whose `one` getter throws and asserts `measureCalibration` rejects with
`suite_calibration_unavailable` naming `loadavg`. Together with E2 (the probe branch), the full
D4 fail-closed surface is pinned — an implementation that refuses only on probe failure no longer
passes.

## F7 — all six G4 members (F3)

F3 now iterates the full `bounds` map — `request-timeout-wait`, `poll-interval-wake` (absolute-timing,
raw), `sigkill-window-lower`, `kill-grace-floor` (floor-raw, raw), `deployment-settle-deadline`,
`sigkill-window-upper` (scale, `base * 4`). Each rowId is checked against the closed `G4_MEMBERSHIP`
first, so a misclassification surfaces as a failure rather than a silent raw pass.

## F8 — the unmarked default derives (F4, D4)

F4 asserts `deriveRowBound('drain-close-wait', 1000, high) === 4000` and a second unmarked rowId
(`250 * 4 === 1000`) — absent both markers, the default is derivation (load-aware), because the flake
cluster is the default. An implementation that returns `base` for any non-table rowId silently flips
the fleet's default to raw and now fails.

## F9 — fails isolated regardless of load (D4, D2.1)

D4 gains the isolated-true / load-false receipt and asserts `null` — a quiet load leg does not mask a
REAL BUG. An implementation keyed on `load.failed === false` → "return cause" now fails.

## F10 — citation precision

The suite header now cites `impl/test/browser-use-red.test.mjs:96-99` and
`impl/test/frame-economics-red.test.mjs:222-241` — the idiom suites live under `impl/test/`, not a
top-level `test/`.

---

## Verified split (fold-2 HEAD, 2026-08-13, from the repo root)

```
$ node --test impl/test/suite-resource-governance-red.test.mjs   # run 1
ℹ tests 32
ℹ pass 2
ℹ fail 30
$ node --test impl/test/suite-resource-governance-red.test.mjs   # run 2
ℹ tests 32
ℹ pass 2
ℹ fail 30
$ node impl/scripts/run-suite.mjs impl/test/suite-resource-governance-red.test.mjs   # through the gate
ℹ tests 32
ℹ pass 2
ℹ fail 30
```

Two consecutive runs of the folded suite both produce **pass 2 · fail 30**; the pass/fail row set is
byte-identical across the two runs. The 2 passes are exactly the two PIN rows (P1, P2); the 30
failures are the red rows, each confirmed to fail at its NAMED stage (26 `calibration-module-missing`,
2 `gate-calibration-line-missing`, 1 `gate-calibration-env-missing`, 1 `gate-concurrency-missing`) —
zero fixture errors/crashes. The gate run yields the identical split, exits 1 (correct: 30 red rows),
and prints no `baton test runner` / `fixture-clock-lint` / `surface-conformance` harness errors.

## Fold integrity

- **Red-first preserved**: every new row is red at HEAD at a named stage; the PIN rows stay green.
- **Hermetic**: every gate probe injects the synthetic calibration record (no real loadavg/probe
  measurement ever runs); the `spawnSync` timeout is dropped (no #7-class wall bound); mkdtemp-only
  fixture worlds are reaped by the global `test.after`; no real timers and no real load reads in the
  row bodies.
- **No clocks**: the suite never reads the wall clock; G1 drives the injected `now()` seam; A7's
  sequentiality is asserted via the in-flight counter, not timestamps.
- **No `localeCompare`**; sorted-key literals stay ACTUAL order; H2 re-pins every closed literal as
  its own `.sort()` result.
- **NUL discipline**: the only source file read whole is `run-suite.mjs` (P1/P2/C2/C4 — NUL-free);
  the NUL-bearing implementation files are never read.
- **Deployment verification** (Baton): executable `true`, arguments `[]`, working directory `.`,
  expected exit 0 — the authored change is the suite + this map + the draft notes; the calibration
  line is a pinned future-gate property (RG-01), not a property the current gate must yet emit.
