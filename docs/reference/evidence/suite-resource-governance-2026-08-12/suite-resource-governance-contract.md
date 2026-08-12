# Issue #77 — Suite resource governance: end the under-load flake cluster — implementation contract

**Status:** v1.1 (fold of the #77 red-team report — all 6 blockers resolved)
**Date:** 2026-08-12
**Verification HEAD:** `ebb40625ba5401ec3902e74c1ac6f01744537f28` (current worktree HEAD)
**Brief:** `contract-77-brief.md` (this directory, 42 lines)
**Red-team:** `contract-redteam.md` (this directory — NOT FOLD-READY, 6 numbered blockers in §D)
**Fold map:** `contract-fold.md` (this directory — blocker → change map, all 6 + open questions)
**Issue:** #77 — `gh` is not authenticated in this worktree, so the issue body was unavailable at
drafting time; the brief's decisions, the named receipts (PROGRESS.md, the frontier-sweep friction
ledger, the stall-watchdog blue-team), and the D9 cap-recalibration precedent carry the
requirements. Every code anchor below was re-verified against the current tree at the verification
HEAD.

**Fold note (v1.0 → v1.1).** This revision folds the red-team report's six blockers (`contract-
redteam.md` §D): **B1** (D2.1 lets a load-exposed real race be recalibrated as a flake) is closed
by the outcome-confirmation gate between bucket 2 and the cause class; **B2** (the G4 ↔ D1.4
SIGKILL-window contradiction) is closed by the closed G4 membership table with `phase56:645`
marked explicitly; **B3** (D1.5's baseline context vs §3's closed key set) is closed by extending
the closed set with the baseline-context keys and pinning the unrecorded-baseline representation;
**B4** (RG-09's oracle false against D3.1's formula) is closed by deriving
`(cores - 1) / factor`, preserving node's idle default; **B5** (the factor under-reads the #7
sub-saturation habitat) is closed by the direct event-loop-gap probe, sequential probe spawns, and
a continuous (non-ceiling) factor; **B6** (the #67 evidence-check over-claim) is closed by the
re-arm-on-progress evidence form and an explicitly scoped residual. Every open-question verdict is
applied (probe sequencing; probe-cap refusal; the child-side `suite_calibration_invalid` surface;
`--test-concurrency` precedence; bucket-1 receipt accumulation; baseline-context placement).

**Seed.** The campaign's lived evidence names the cluster precisely: "the #7 load-flake cluster
(drain deadlines, start-latency-calibrated caps) surfaced 4x, each passing isolated re-runs — D9's
cap recalibrated honestly (waves.start alone measures ~3.9s under load)"
(`docs/PROGRESS.md:401-403`), then "recurred 8x across gates — every row passes isolated re-runs"
(`docs/PROGRESS.md:425-427`). The current checkpoint still carries the cluster: "the documented #7
load-flake cluster, green twice isolated each" (`docs/PROGRESS.md:12-14`). The frontier sweep's
friction ledger names the operational cost: "Gate load-flakes (#7 cluster) re-run in isolation by
hand every gate | 5 isolated re-runs this sweep (kimi-acp, SC18, DC4/DC5, phase92…)"
(`docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:52`). The #7
class is defined in the stall-watchdog blue-team: "the #7 load-flake class is exactly a wall-clock
race between a test stream and a real timer" (`suite-blueteam.md:251`).

**The control law (operator, campaign), applied to the suite's own surface.** No clocks as
workflow CONTROLS — but the suite's deadlines are TEST INFRASTRUCTURE, a different surface. The law
here, inherited from #67's in-flight-turn gate: **no bound fires on elapsed time without an evidence
check** (`stall-watchdog-contract.md:422-428`). A test's deadline must measure what it claims (a
hung process), never declare a slow-but-healthy machine broken. The suite's evidence surface is
two-fold: (1) the honest in-flight-turn analog — a poll helper that re-arms on predicate progress
(a "no new event since the last tick" deadline is evidence-checked liveness, D1.4); (2) the
receipted calibration — a start-of-run measured-load record that extends deadlines as RECEIPTED
SCALING, never a bigger global constant. Calibrated deadlines are receipted scaling, not themselves
per-fire evidence checks: a host that loads after the start reading can still false-fire one, and
the receipt makes it explainable, not prevented (the B6 fold, D1.4).

**Read-order executed.** (1) the issue — unavailable, see above; (2) the lived evidence — the #7
cluster receipts (`docs/PROGRESS.md:12-14, 401-405, 425-427`), the frontier-sweep friction ledger
row (`orchestrator-friction-ledger.md:52`), the stall-watchdog blue-team F7 finding
(`suite-blueteam.md:246-260`), the D9 cap recalibration (`docs/PROGRESS.md:401-403`); (3) the
current machinery — `impl/scripts/run-suite.mjs` (the gate), `impl/scripts/run-evidence.mjs` (the
evidence wrapper), `impl/scripts/fixture-clock-lint.mjs` (issue #42's static guard),
`impl/scripts/suite-hygiene.mjs` (issue #40's evidence-based sweep), and the per-file deadline
vocabulary in the test files (`phase56-drain-and-close.test.mjs`, `kimi-acp.test.mjs`,
`grok-acp.test.mjs`, `phase8-correctness.test.mjs`, `claude-session.test.mjs`,
`codex-appserver.test.mjs`, `bidirectional-driver-red.test.mjs`); (4) the recalibration precedents —
D9's honest cap (`docs/PROGRESS.md:401-403`) and the stall-watchdog B4 margin fix
(`suite-blueteam.md:246-260`); (5) the receipts — the #7 class definition
(`suite-blueteam.md:251`) and the #67 control-law line (`suite-67-brief.md:18-20`); (6) the red-team
report (`contract-redteam.md`) — every blocker and open-question verdict folded below. No
NUL-bearing source file was opened whole: every `impl/src/*.mjs` anchor below is cited from
`grep -an` output or was not needed (this contract owns the suite surface, not the source kernel).

**Cross-references (not re-specified here):** **#7** — the load-flake cluster itself (every receipt
above; this contract is its governance). **#10** — the waitingOn honest-null law: an honest value
is `null`/absent when not waiting, never a fake empty, and it derives from event seqs, not clocks
(`waiting-vocabulary-2026-08-06/grounding.md:234-240`); the same honesty governs the load-context
receipt below. **#67** — the in-flight-turn gate: a liveness bound fires only on no-progress
EVIDENCE, never "too slow"; a 20-minute compile is not a stall
(`stall-watchdog-contract.md:422-428`; `suite-67-brief.md:18-20`). Each is cited at the decision it
touches. This contract owns only the suite's deadline/governance surface.

---

## 1. Ground truths (re-verified at HEAD)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | **The gate is `node impl/scripts/run-suite.mjs` (`npm test`).** It lints fixture clocks (#42), runs the surface-conformance checks, then spawns `node --import <watchdog> --test <argv>` in a detached process group with a private `baton-suite-*` root (0o700, owner receipt). Its own findings and failures go to stderr; the child's `node --test` output rides `stdio: 'inherit'`. The gate passes `process.argv.slice(2)` through to the test child. | `impl/scripts/run-suite.mjs:19-25, 27-74, 76-117`; `impl/package.json:27` |
| G2 | **The wrapper's drain deadlines are fixed constants.** SIGTERM → 5 s reaping window → SIGKILL → 1 s → tracked-group wait +1 s; a stop request arms a 5 s force-SIGKILL timer. These bound the STOP path (reaping the test group), not any test's own timing. | `run-suite.mjs:217, 225, 232, 241`; `run-evidence.mjs:13-15, 122-127, 137` |
| G3 | **The poll vocabulary is per-file.** Each test file defines its own `until`/`waitFor`/`waitUntil` helper with a fixed default timeout: `phase56-drain-and-close` 3 000 ms, `kimi-acp` 2 000 ms, `grok-acp` 3 000 ms, `phase8-correctness` 1 500 ms, `issue10-waiting-vocabulary-red` 20 000 ms, `orchestrator-wake-red` 400×20 ms, and hundreds of further call sites across the 285 files with the same shape. Under load the Node event loop gaps (GC, other children on the box), the predicate lands late, and the fixed cap fires. | `phase56-drain-and-close.test.mjs:45`; `kimi-acp.test.mjs:18`; `grok-acp.test.mjs:73`; `phase8-correctness.test.mjs:75` |
| G4 | **The elapsed-assertion caps are wall-time machine-speed assertions.** `Date.now() - started < 500` ("deployment deadline bounds a never-settling cleanup"), `elapsed < 2000` ("expected a bounded wait near requestTimeoutMs"), `elapsedMs < 1_000` (the wake interval), `Date.now() - started >= 4_500 && < 8_000` (the SIGKILL-escalation window), `elapsed >= 60` (the grace floor). These are the rows that pass isolated and fire under load; each is classified in the closed D1.4 membership table (the B2 fold). | `phase56-drain-and-close.test.mjs:268, 645`; `grok-acp.test.mjs:648`; `codex-appserver.test.mjs:527`; `bidirectional-driver-red.test.mjs:1176`; `claude-session.test.mjs:633` |
| G5 | **D9's cap recalibration is the honest-static precedent.** "D9's cap recalibrated honestly (waves.start alone measures ~3.9s under load)" — a cap was reset to a MEASURED honest value with the measurement recorded, not to a bigger guess. | `docs/PROGRESS.md:401-403` |
| G6 | **The cluster's recurrence and cost are receipted.** "surfaced 4x, each passing isolated re-runs" (`PROGRESS.md:401-403`); "recurred 8x across gates — every row passes isolated re-runs" (`PROGRESS.md:425-427`); current checkpoint: "green twice isolated each" (`PROGRESS.md:12-14`); "5 isolated re-runs this sweep (kimi-acp, SC18, DC4/DC5, phase92…)" (`orchestrator-friction-ledger.md:52`). | `docs/PROGRESS.md:12-14, 401-405, 425-427`; `orchestrator-friction-ledger.md:52` |
| G7 | **The #7 class is a wall-clock race between a test stream and a real timer.** B4's must-not-stall PIN row ran a 30 ms interval against a 60 ms real `_armWatchdog` timer — a 2× margin that a loaded event loop can bridge, false-REDing a correct implementation. | `suite-blueteam.md:246-260` (the B4 finding; the concrete fix: widen the margin or drive the window through the injected `now()`/`tick()` seam) |
| G8 | **The #67 control-law line.** "a slow-but-productive worker (a long in-flight turn with provider activity) is NEVER declared stalled; no bound fires on elapsed time without an evidence check"; "no bound fires on elapsed time without an evidence check"; "A 20-minute compile is not a stall." | `suite-67-brief.md:18-20`; `stall-watchdog-contract.md:422-428` |
| G9 | **The fixture-clock-lint (#42) is the existing static evidence guard.** It flags the time-bomb shape (a `CoordinationStore` beside a near-dated expiry literal with no injected clock) and refuses the suite at the gate — a precedent for evidence-based suite hygiene, not clock-based control. | `fixture-clock-lint.mjs:1-14, 24-48` |
| G10 | **Suite-root hygiene (#40) is evidence-based.** The next start sweeps sibling roots only when the recorded owner pid is provably dead (ESRCH) — liveness evidence, never an age heuristic. The same philosophy (evidence, not rigid bounds) governs this contract. | `suite-hygiene.mjs:1-10, 23-32` |
| G11 | **`node --test` runs files in parallel and does not adapt to host load.** Verified: 8 files × 2 s each finished in ~3.7 s (all ran concurrently); node's default file-level concurrency is `os.availableParallelism() - 1` (verified: 20×2 s files → 6.89 s default ≈ 9-wide on a 10-parallelism host, `--test-concurrency=10` → 4.97 s, `=9` → 6.96 s). The wrapper passes no `--test-concurrency`; the suite's own parallelism is the load it adds on top of the host's. | `node v25.8.0` (measured); `run-suite.mjs:105` |
| G12 | **No load measurement exists in the suite today.** `os.loadavg()` / `os.availableParallelism()` appear in no `impl/scripts/*.mjs` and no `impl/test/*.mjs`. The calibration surface is empty; a flake report today carries no load context. | `grep -rn 'loadavg\\|availableParallelism\\|cpus()' impl/scripts impl/test` → empty |

---

## 2. Decisions

### D1 — The calibration model: measured-load-derived deadlines, honest static idle defaults

Pick the derived shape the law demands ("measured system load at run time, not a bigger global
constant"), with the D9 honest-static precedent as the factor-1 baseline — the two halves of the
brief's "OR" compose: the idle defaults ARE the honest measurements, and the load factor extends
them. A quiet host (factor 1) is byte-identical to today; a loaded host's deadlines extend, so a
deadline still measures a hung process and never a slow-but-healthy machine.

**D1.1 The measurement — at suite start, before the child spawn.** `run-suite.mjs` takes the
readings:

- `cores = os.availableParallelism()`;
- `load = { fifteen: os.loadavg()[2], five: os.loadavg()[1], one: os.loadavg()[0] }` — the 1/5/15
  minute host load averages (sorted-key literal in ACTUAL order);
- `probeMs` — the median wall time of K = 5 bounded `node -e ''` spawns run **sequentially** (each
  with a hard 2 s cap, a physical-resource bound on the probe itself). The spawns are sequential:
  a parallel probe self-inflates from the probe's own concurrency (measured +58 % on this host:
  sequential median 71 ms vs parallel median 112 ms) and would lax every deadline for the whole run
  (the B5 fold). The probe measures the honest per-process-spawn cost on this host right now — the
  exact operation the start-latency caps time.
- `gapMs` — the **in-process event-loop-gap probe**: a bounded interval-cadence measurement of how
  late a 10 ms interval fires on average (a short, bounded run, e.g. ~100 intervals, each tick
  under a hard cap). This measures the physical phenomenon the #7 class names — a real timer fired
  later than the stream's cadence under a GC pause or a competing child (G7's B4: a 30 ms interval
  bridging a 60 ms window) — which a separate-process spawn probe does not observe (the B5 fold).
- **A probe tick that exceeds its cap is REFUSED**, never recorded as a truncated cap-length value:
  truncation under-reads the factor on a slow host and silently laxes the run. The refusal is
  `suite_calibration_unavailable` (D4), fail-closed (the open-question verdicts 1–2).

**D1.2 The derivation — continuous, floored at 1.**

```
factor = max(1, load.one / cores, probeMs / BASELINE_PROBE_MS, gapMs / BASELINE_GAP_MS)
```

where `BASELINE_PROBE_MS` and `BASELINE_GAP_MS` are recorded idle-host measurements (D1.5), never
invented constants. The load term is continuous — **no saturation `ceil` at sub-saturation** (the
B5 fold): on a 10-core host, `load.one = 6` (60 % busy) contributes 0.6, so a host at 60 % busy
with the gap probe elevated reads factor ≈ 1.6, not the old `max(1, ceil(…)) = 1` that flattened
the exact sub-saturation habitat the #7 class lives in. All terms are measured quantities; the
ratio is the honest oversubscription multiplier, floored at 1 — a calibrated deadline is never
SHORTER than the raw static constant.

**D1.3 The recording — the gate's output names the calibration.** Before spawning the child, the
wrapper writes one stable line to stderr:

```
baton suite calibration: {"baselineBasis":"recorded","baselineGapMs":bg,"baselineProbeMs":b,"cores":N,"date":"<baseline ISO>","factor":F,"gapMs":g,"host":"<host>","load":{"fifteen":f,"five":f,"one":o},"measuredAt":"<ISO>","method":"sequential-spawn+interval-cadence","probeMs":p,"sampleN":K,"schemaVersion":1}
```

and passes the identical JSON to the child via `BATON_SUITE_CALIBRATION` in the spawn env
(`run-suite.mjs:108-116` already carries the suite env). A flake report therefore carries the load
context by construction: the calibration line (wrapper stderr) + the failing row's name (`node
--test` output). The record's key set is closed and written in ACTUAL sorted order (see §3). The
baseline context `{host, date, method, sampleN}` ships as record fields, and the unrecorded-
baseline representation is pinned (D1.5).

**D1.4 The application — time-bounded assertions derive; absolute-timing rows never scale; the G4
rows are classified in a closed table.**

- Poll-until helpers (`until`/`waitFor`/`waitUntil`): `timeoutMs = DEFAULT_TIMEOUT_MS * factor`.
- Elapsed-assertion caps (`Date.now() - started < N`, `elapsedMs < N`, the `X <= elapsed < Y`
  window's upper bound): `bound = N * factor`.
- **Absolute-timing rows do NOT scale.** A row that asserts the implementation's OWN timer
  semantics — `stallMs`, a product SIGKILL grace window, `requestTimeoutMs`, a `spawn({timeoutMs})`
  value — tests product values, not machine speed. Scaling those would make the assertion vacuous
  or wrong. Such rows carry a reviewable marker (`// baton-suite: absolute-timing`) and are
  excluded from derivation. This is the boundary that keeps a load-aware deadline honest: a
  deadline measures a hung process; a product-timing row measures the product.
- **The G4 rows, closed membership (the B2 fold).** The decidable rule: a timer owned by the
  harness/wrapper (run-evidence.mjs's `TERM_GRACE_MS`/`KILL_GRACE_MS`, run-suite.mjs's stop-path
  timers) is machine-speed, so its elapsed bound scales; a timer owned by the product kernel (the
  product's own `_armWatchdog`, `requestTimeoutMs`, a product SIGKILL grace, a `spawn({timeoutMs})`
  value) is absolute-timing and stays raw; a floor assertion (`elapsed >= X`) is never scaled. The
  G4 rows classify as follows:

  | Row | Assertion | Class | Rule |
  |---|---|---|---|
  | `phase56-drain-and-close.test.mjs:268` | `Date.now() - started < 500` | scale | test deadline on a drain/close cleanup — the #7 drain class; machine-speed |
  | `phase56-drain-and-close.test.mjs:645` | `>= 4_500 && < 8_000` | scale-upper / floor-raw | wrapper-owned SIGKILL-escalation window (`TERM_GRACE_MS` + `KILL_GRACE_MS`); upper bound derives, lower stays raw |
  | `grok-acp.test.mjs:648` | `elapsed < 2000` | scale | wait deadline near `requestTimeoutMs`; machine-speed |
  | `codex-appserver.test.mjs:527` | `elapsed < 2000` | scale | wait deadline near `requestTimeoutMs`; machine-speed |
  | `bidirectional-driver-red.test.mjs:1176` | `elapsedMs < 1_000` | scale | interval-wake deadline; machine-speed |
  | `claude-session.test.mjs:633` | `elapsed >= 60` | floor-raw | floor assertion; never scaled (D2.2 `poll_floor`) |

  `phase56:645` is therefore marked explicitly as a **scale-upper / floor-raw** row — it measures
  the wrapper's own escalation (the harness timer), not a product timer — which resolves the G4 ↔
  D1.4 contradiction: D1.4's absolute-timing exclusion names a PRODUCT-kernel-owned SIGKILL grace
  window, not the wrapper's own. Rows outside this table default to derivation (D4) unless they
  carry the `// baton-suite: absolute-timing` marker.
- **The evidence-checked form (the B6 fold).** A deadline that re-arms on predicate progress is
  the suite's honest in-flight-turn analog of #67: the poll helpers (`until`/`waitFor`/`waitUntil`)
  already loop over a predicate, and the `waitFor(events, predicate)` helpers (`kimi-acp.test.mjs:18`,
  `grok-acp.test.mjs:73`) already see the event stream — a "no new event since the last tick"
  deadline is evidence-checked liveness, the exact #67 shape. This form is preferred for #7-class
  helpers where the event stream is available. The scaled window remains the default — and it is
  explicitly **receipted scaling, not a per-fire evidence check**: a host that loads AFTER the start
  reading can still false-fire a calibrated deadline, and the receipt makes it explainable, not
  prevented. The contract does not claim the #67 law is met by the measurement alone.
- A shared helper exposes the derivation to both surfaces: the wrapper's measurement
  (`measureCalibration()`), the child-side read (`readCalibration()`, returns the record or `null`
  when absent — the absent-vs-malformed distinction is D4), and the scaling
  (`scaledTimeout(base) = base * factor`, factor 1 when no record). Suggested home
  `impl/scripts/suite-calibration.mjs`, imported by the wrapper and by the per-file helpers.
  `measureCalibration()` and `readCalibration()` accept injection overrides (a synthetic
  `{cores, load, probeMs, gapMs, baselineProbeMs, baselineGapMs}`) so the red suite can produce
  RG-04/RG-06's synthetic high-probe/load cases (the seam gap closed).

**D1.5 The baseline is a recorded measurement, never a bigger constant.** `BASELINE_PROBE_MS` and
`BASELINE_GAP_MS` ship in the calibration record with their measurement context — `{host, date,
method, sampleN}` as record fields `host`, `date`, `method`, `sampleN` — the D9 method (a measured
honest value with the receipt recorded, `PROGRESS.md:401-403`). The derivation never uses a "bigger
global constant". The unrecorded-baseline representation is pinned (the B3 fold): the closed
literal `baselineBasis` is `"recorded"` when BOTH baselines are recorded, else `"unrecorded"`; when
`"unrecorded"`, `baselineProbeMs` and `baselineGapMs` are `null`, and the factor degrades to
`max(1, load.one / cores)` with the receipt noting the degraded basis — never a silent invented
number.

**Refusal/observability (D1):** §3 (`suite_calibration_unavailable`, `suite_calibration_invalid`).
**Acceptance pins:** RG-01..RG-06, RG-12 (§5).

### D2 — Flake-taxonomy honesty: a recalibrated cap never masks a correctness failure

Some cluster members may be REAL bugs wearing flake clothes — a deadline that catches a genuine
race. The contract pins the review rule that keeps recalibration from masking them.

**D2.1 The isolated-rerun-then-load-rerun discipline.** Before any cap is touched, a failing row is
re-run twice: (a) **isolated** — the file alone; (b) **under a load context** — the host loaded
(the suite's own parallel run qualifies). Each re-run records its own calibration receipt (D1.3),
so an isolated leg run on a loaded host (or a quiet load leg) is interpretable rather than
misclassified. The classification:

- **Passes isolated AND under load** → transient infra blip → the load-context receipt is attached;
  no cap change. The row keeps a receipt trail: a non-reproducible under-load fire recurs with an
  accumulated receipt, and the cluster ends by ACCUMULATING receipts, not by a single
  classification (the open-question 5 verdict — the correct no-guess posture, stated).
- **Passes isolated, fails under load** → load-flake candidate → the row gets the load-context
  receipt (D1.3) and passes the **outcome-confirmation gate (the B1 fold) BEFORE any cause class or
  recalibration**: the load re-run repeats with the deadline extended (per D1) and the awaited
  condition must be observed to land — the drain completed, the event arrived, the ack resolved.
  If the outcome does NOT land even past the extended bound, the row is a REAL BUG — a correctness
  ticket, cap untouched, recalibration refused. Only a timing-confirmed load flake receives a
  cause class (D2.2) and MAY be recalibrated per D1. This is the gate that closes the "never masks
  a correctness failure" law's hole: a real race that only manifests under load cannot be
  recalibrated as a flake.
- **Fails isolated** (regardless of load) → REAL BUG → the cap is NOT touched; the failure is a
  correctness ticket. A recalibration is refused for a row that fails isolated. This is the
  "never masks a correctness failure" law.

**D2.2 The closed cause-class vocabulary** (human-readable, ACTUAL sorted order) — each class names
the measurement that fired and the recalibration that applies:

| Cause class | Fires when | Recalibration |
|---|---|---|
| `drain_deadline` | a drain/close bounded wait exceeded its elapsed assertion under load | derive the bound per D1.4 |
| `event_loop_gap` | a real timer fired later than the test's stream cadence (the #7 class, G7) — the physical mechanism the `gapMs` probe measures | widen the margin or drive the timers through the injected clock seam (the B4 fix, `suite-blueteam.md:256-257`) |
| `margin_window` | a `X <= elapsed < Y` window assertion failed under load | derive the window's upper bound; keep the lower bound raw |
| `poll_floor` | a floor assertion (`elapsed >= X`) failed under load | re-verify it is a product floor, not a load artifact; re-stage on event ordering if it is (the #80 F2 precedent, `tg3-window-2026-08-07/suite-blueteam.md:130-142`) |
| `start_latency` | a process/spawn took longer under load than the cap (the D9 class: waves.start ~3.9 s) | derive the cap from the probe per D1.4 |

`timer_coalescing` is merged into `event_loop_gap`: node timer coalescing under load is the same
physical mechanism (G7's B4) that the `gapMs` probe measures, and a single fire can honestly be
read as either — the merge removes the ambiguity that made "exactly one closed cause class" (RG-08)
un-decidable. A fire is diagnosed as `event_loop_gap`.

**D2.3 The receipt that ships with a recalibration.** A recalibrated cap NEVER ships alone: it
ships with (a) the calibration record that fired (D1.3), (b) the cause class (D2.2), (c) both
re-runs recorded (D2.1), and (d) the outcome-confirmation — the extended-bound re-run that observed
the awaited condition land (the B1 fold). The receipt is the audit trail proving the cap did not
mask a bug.

**D2.4 The honest-null analog (#10 cross-ref).** Just as #10's waitingOn is `null`/absent when not
waiting — never a fake value, derived from event seqs
(`waiting-vocabulary-2026-08-06/grounding.md:234-240`) — a flake report never names a cause class
without its load-context receipt, and a row with no calibration context is never claimed to be a
load flake. No bare number, no un-evidenced "load flake" label.

**Refusal/observability (D2):** the load-context receipt and cause class are the observability
surface. **Acceptance pins:** RG-07, RG-08 (§5).

### D3 — The parallelism posture: concurrency adapts to the host; budgets separated honestly

**D3.1 Concurrency adapts to the host.** The gate derives the file-level concurrency from the
measurement: `--test-concurrency = max(1, ceil((cores - 1) / factor))` passed through
`process.argv` (G1). At factor 1 this is `cores - 1` — node's current default
(`os.availableParallelism() - 1`, G11) — so an idle run keeps today's concurrency byte-identical
(the B4 fold; RG-09's oracle is now consistent with the formula). When the host is loaded
(factor > 1), the suite sheds concurrency instead of amplifying the load — a loaded host gets FEWER
concurrent files, not tighter deadlines. D1 and D3 are coupled: D1 measures the load honestly, D3
ensures the suite does not add to it. The derived flag is appended AFTER the user argv, so it takes
precedence (node takes the last `--test-concurrency`); a user-supplied flag is overridden, and the
calibration line names the concurrency that ran (the open-question 4 verdict).

**D3.2 The wrapper's STOP path is load-aware; the whole-run budget is the operator's.** The
stop-path deadlines (G2: SIGTERM 5 s → SIGKILL 1 s → tracked-group +1 s; the 5 s force-SIGKILL
timer) bound a graceful stop — a loaded machine needs more grace, so they scale by the factor
(`graceMs = BASE_GRACE_MS * factor`). Because the grace is load-extended, the operator keeps a
hard escape: a SECOND SIGTERM/SIGINT during the grace window escalates immediately to SIGKILL (the
double-signal escape), so the operator's budget is never silently exceeded by the very scaling that
load extends (the B.3b fold). The whole-run budget is the operator's SIGTERM/SIGINT — a backstop,
never a product clock, never derived from the per-file deadlines. The per-file time-bounded
assertions carry the load-aware calibration (D1); the whole-run budget is a separate, operator-side
decision.

**Refusal/observability (D3):** the calibration line names the concurrency that ran, so a flake
report shows both the load and the parallelism. **Acceptance pins:** RG-09 (§5).

### D4 — Refusal/observability vocabulary (consolidated)

The gate's output already speaks in typed diagnostics (the `fixture-clock-lint:` and
`surface-conformance:` stderr lines, G1). This contract adds two typed refusals and one stable
observability line:

| Code | Meaning | Message content |
|---|---|---|
| `suite_calibration_unavailable` | the probe could not be measured (a spawn or gap tick failed, exceeded its cap, returned no timing, or `loadavg` was unavailable) — **fail-closed**: an unmeasured run cannot distinguish a hung process from a slow machine, so the gate refuses at the gate rather than silently proceeding at factor 1 | names the failed measurement (`probe`/`loadavg`) and the cause |
| `suite_calibration_invalid` | a child (or helper) received a malformed `BATON_SUITE_CALIBRATION` | names the parse error |
| `baton suite calibration: <record>` | the stable observability line (D1.3), written once per run before the child spawns | the full calibration record (§1 D1.3) |

The refusal surfaces are split by side, and the split is stated (the open-question 3 verdict):
`suite_calibration_unavailable` fires at the GATE (the gate is still pre-spawn, so it can refuse
before any child runs); `suite_calibration_invalid` fires CHILD-SIDE — the gate has already spawned,
so it cannot enforce a child-side parse error. The child-side surface is a typed error
(`SuiteCalibrationError` naming the code) thrown by the parsing helper; the row/helper that hits it
fails with that error. `readCalibration()`'s absent-vs-malformed distinction is pinned: absent env
→ returns `null` (factor 1, derivation proceeds); present-but-malformed → refuses with
`suite_calibration_invalid`.

The load-aware markers are reviewable by grep: `// baton-suite: load-aware` (a helper or file opts
its poll defaults into derivation) and `// baton-suite: absolute-timing` (a row excluded from
derivation, D1.4). Absent both markers, the default is derivation (load-aware), because the flake
cluster is the default and the honest default is to scale. The default sweep is bounded, not silent:
the known load-firing rows are classified in the closed D1.4 membership table (scale /
absolute-timing / floor-raw), rows outside the table derive unless they carry the absolute-timing
marker, and the implementer pins the G4 classification at implementation time rather than leaving
each existing row's status unstated (the B.5 marker-default fold).

**Acceptance pins:** RG-01, RG-10 (§5).

---

## 3. Closed literals (ACTUAL sorted order, `localeCompare` banned)

The calibration record's key set — `baselineBasis, baselineGapMs, baselineProbeMs, cores, date,
factor, gapMs, host, load, measuredAt, method, probeMs, sampleN, schemaVersion` — is closed and
written in ACTUAL sorted order (the `load` sub-object is `fifteen, five, one` in ACTUAL order).
The cause-class vocabulary (D2.2) is `drain_deadline, event_loop_gap, margin_window, poll_floor,
start_latency` in ACTUAL sorted order (`timer_coalescing` merged into `event_loop_gap`, the B.2
fold). The refusal codes (D4) are `suite_calibration_invalid, suite_calibration_unavailable` in
ACTUAL sorted order. The `baselineBasis` literal is `recorded, unrecorded` in ACTUAL order. Each
literal is its own `.sort()` result; `localeCompare` is banned.

## 4. Campaign-law constraints and non-goals

- **No clocks as workflow controls — unchanged.** This contract adds no clock to any workflow
  control surface. The suite's deadlines are TEST INFRASTRUCTURE (the law's explicit different
  surface); the calibration is a recorded measurement, never a control.
- **No new wall-clock gate in the product kernel.** `application.mjs`, `coordinator.mjs`,
  `coordination-store.mjs`, and the driver surfaces are untouched. The suite's elapsed-time bounds
  are the suite's own.
- **Absolute-timing rows stay raw** (D1.4): a product-timing assertion is never scaled into
  vacuity. The B4-margin class (G7) is fixed by widening or by the injected clock seam, not by
  scaling the product timer. `phase56:645` is explicitly a scale-upper / floor-raw row (it measures
  the wrapper's own escalation; D1.4's absolute-timing exclusion names a PRODUCT-kernel SIGKILL
  grace, not the wrapper's).
- **A recalibration never ships alone** (D2.3); a row that fails isolated is never recalibrated
  (D2.1); a load-exposed real race is never recalibrated — the outcome-confirmation gate (D2.1)
  refuses the cause class when the awaited condition does not land past the extended bound.
- **No bigger global constant.** The derivation uses measured ratios and a recorded baseline
  (D1.2, D1.5) — never a raised cap literal.
- **Non-goals.** Per-file re-measurement mid-run (the start measurement + D3's shed is the v1
  bound; a mid-run re-measure is a documented follow-up); a whole-run product wall budget (the
  operator's SIGTERM is the backstop, D3.2); re-specifying #7, #10, or #67 (cross-referenced only).
- **Acknowledged drift-detection consequence** (the B.1 fold). The one-shot start-of-run factor
  applies for the whole run: a suite that starts loaded and finishes idle keeps lax deadlines, so a
  timing DRIFT that stays under the scaled bound passes silently — the calibration measures a hang
  but not a drift. This is the acknowledged price of one-shot sampling, stated: the regression side
  of the two-sided test is softened, and the remedy is either the D1.4 re-arm-on-progress evidence
  form (which re-checks progress per tick) or mid-run re-measurement (a documented follow-up).

## 5. Red-first acceptance

Implementation begins by adding a focused red suite (suggested home
`impl/test/suite-resource-governance-red.test.mjs`) and demonstrating that its positive rows fail
against the current machinery (no calibration line, no `BATON_SUITE_CALIBRATION` env, no shared
helper, no scaled concurrency, no cause-class vocabulary). Every red row fails at a NAMED stage at
HEAD and goes green only on the implementation. Existing suites remain unchanged and green; no
existing assertion is weakened to admit the new behavior. The suite itself honors the control law:
fake timers are fine; no row asserts a wall-clock behavior of the fleet.

| ID | Red state to prove first | Green acceptance oracle |
| --- | --- | --- |
| RG-01 | The gate writes no calibration line today. | `node impl/scripts/run-suite.mjs` emits one `baton suite calibration: <record>` stderr line before spawning the child; the record is stable-parseable JSON with the closed key set (§3). |
| RG-02 | The suite child sees no `BATON_SUITE_CALIBRATION` env today. | The spawned test child receives `BATON_SUITE_CALIBRATION` = the identical record (G1's env seam). |
| RG-03 | No helper derives a scaled deadline today. | `readCalibration()` returns the record; `scaledTimeout(base)` returns `base * factor`; absent a record, `scaledTimeout(base) === base` (byte-identical idle default). |
| RG-04 | The factor is never derived today. | An injected calibration (`factor: 4`, via `measureCalibration()`/`readCalibration()`'s injection overrides) yields `scaledTimeout(2000) === 8000`; a factor-1 record yields `scaledTimeout(2000) === 2000`. |
| RG-05 | The probe is never measured today. | `measureCalibration()` times K sequential probe spawns and the gap probe, returns `{cores, load, probeMs, gapMs, baselineProbeMs, baselineGapMs, factor}` with the baseline from the recorded receipt (D1.5). |
| RG-06 | A loaded host is indistinguishable from an idle one today. | A synthetic high probe/load (injected) yields `factor > 1`; a quiet host yields `factor === 1` (idle runs stay byte-identical). |
| RG-07 | A failing row's report carries no load context today. | The calibration line (stderr) + the failing row name (`node --test`) together form the load-context receipt; the record names `factor`, `load`, `probeMs`, `gapMs`. |
| RG-08 | Load flakes have no cause-class vocabulary today. | A load-flake diagnosis names exactly one closed cause class (D2.2); an unknown class is refused. |
| RG-09 | File-level concurrency never adapts today. | A high factor derives `--test-concurrency = max(1, ceil((cores - 1) / factor))`; an idle run (factor 1) derives `cores - 1`, today's concurrency. |
| RG-10 | A calibration failure silently proceeds today. | A forced probe failure (or cap-exceeded tick) refuses at the gate with `suite_calibration_unavailable` and names the failed measurement; a malformed env record refuses child-side with `suite_calibration_invalid` (a `SuiteCalibrationError` naming the code); absent env is `null`, not a refusal. |
| RG-11 | A cap change can ship without a receipt today. | A recalibrated cap's commit carries (a) the calibration record, (b) the cause class, (c) both re-runs, (d) the outcome-confirmation (D2.3) — asserted by the review discipline, pinned in the suite's header inventory. |
| RG-12 | An absolute-timing row scales today (if it derives at all). | A `// baton-suite: absolute-timing` row is excluded from derivation: `scaledTimeout` is never applied to its product-timer literals (D1.4); the closed G4 membership table classifies each G4 row (scale / absolute-timing / floor-raw). |

**The verification HEAD** is `ebb40625ba5401ec3902e74c1ac6f01744537f28`; every anchor above was
re-verified against it. The deployment verification command is the brief's execution contract
(executable `true`, no arguments, exit code 0) — the authored change is this contract document,
and the calibration line is a pinned future-gate property (RG-01), not a property the current gate
must yet emit.
