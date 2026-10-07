# Issue #77 — Suite resource governance: end the under-load flake cluster — implementation contract

**Status:** v1.2 DRAFT (folded)
**Date:** 2026-08-12
**Verification HEAD:** `8bd27e9bd67a65b7f295e36d7500f8d0c7522d1b` (current worktree HEAD at fold)
**Fold note:** v1.0 was NOT FOLD-READY — `contract-redteam.md` returns six numbered blockers (§D)
plus verdict'd open questions. This v1.1 folds all six (B1–B6) and the open-question verdicts; the
blocker → change map is `contract-fold.md` (this directory). The v1.0 verification HEAD
(`5ac5e65f595e472710b576a16a699a6d6fc3dfbc`) was stale — that snapshot predates this directory; every
cited target is byte-identical across the compared snapshots (`git diff 5ac5e65..HEAD -- <file>`
empty for all cited files), so all anchors resolve identically at the fold HEAD.
**Fold-2 note (v1.2):** the suite blue-team's fold (`suite-blueteam.md` → `suite-fold-2.md`, this
directory) resolved two contract-surface seams that the suite's own gate probes depend on. (1) **The
gate's calibration injection seam** (blue-team F1): `run-suite.mjs` honors a `BATON_RG_CALIBRATION`
env override carrying a full calibration record — when present, the start-of-run measurement is
short-circuited and the injected record is used verbatim (D1.1). The red suite's B1/B2/B3/C2 gate
probes inject it so no real host measurement runs in a nested gate (a real event-loop probe under
load could refuse a CORRECT implementation — the #7-class flake the suite exists to govern). The
override deliberately uses the suite's `BATON_RG_*` observation naming — a `BATON_SUITE_*` name is
stripped by the suite's own nested-gate sanitizer. (2) **The baseline-receipt injection seam** (F3):
`measureCalibration` gains a `baselineReceiptPath` override (D1.5) so the `recorded`/`unrecorded`
basis and the honest-null `baselineProbeMs` are deterministically exercisable (D1.4). v1.2 changes
no decision, no G4 classification, and no closed literal.
**Brief:** `contract-77-brief.md` (this directory, 42 lines) + `contract-redteam.md` (this directory)
**Issue:** #77 — `gh` is not authenticated in this worktree, so the issue body was unavailable at
drafting time; the brief's decisions, the named receipts (PROGRESS.md, the frontier-sweep friction
ledger, the stall-watchdog blue-team), and the D9 cap-recalibration precedent carry the
requirements. Every code anchor below was re-verified against the current tree at the verification
HEAD.

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

**The control law (operator, campaign), applied to the suite's own surface.** No clocks as workflow
CONTROLS — but the suite's deadlines are TEST INFRASTRUCTURE, a different surface. The law here,
inherited from #67's in-flight-turn gate: **no bound fires on elapsed time without an evidence
check** (`stall-watchdog-contract.md:422-428`). A test's deadline must measure what it claims (a
hung process), never declare a slow-but-healthy machine broken. **v1.1 scoping (blocker B6):** the
calibration below is a start-of-run, **receipted scaling** — a static multiplier taken once before
the child spawns, not a per-fire evidence check. It inherits #67's philosophy (never a bigger global
constant; the idle factor is 1) but does not satisfy the law by measurement alone: a host that loads
*after* the start reading can still false-fire a calibrated deadline, and the receipt makes that
explainable, not prevented. The honest per-fire evidence check in this contract is the poll helpers'
**re-arm-on-progress** deadline (D1.4): a bound that re-arms on any new event — "no new event since
the last tick" is the liveness evidence — is a true evidence-checked liveness bound. Rows governed
by that mechanism are evidence-checked; rows governed by scaling alone are receipted, and the
contract says so.

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
(`suite-blueteam.md:251`) and the #67 control-law line (`suite-67-brief.md:18-20`). No NUL-bearing
source file was opened whole: every `impl/src/*.mjs` anchor below is cited from `grep -an` output
or was not needed (this contract owns the suite surface, not the source kernel).

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
| G4 | **The elapsed-assertion caps are elapsed-time assertions.** `Date.now() - started < 500` ("deployment deadline bounds a never-settling cleanup"), `elapsed < 2000` ("expected a bounded wait near requestTimeoutMs"), `elapsedMs < 1_000` (the wake interval), `Date.now() - started >= 4_500 && < 8_000` (the SIGKILL-escalation window), `elapsed >= 60` (the grace floor). These are the rows that pass isolated and fire under load; each is classified scale / absolute-timing / floor-raw by the closed membership table in D1.4 (blocker B2). | `phase56-drain-and-close.test.mjs:268, 645`; `grok-acp.test.mjs:648`; `codex-appserver.test.mjs:527`; `bidirectional-driver-red.test.mjs:1176`; `claude-session.test.mjs:633` |
| G5 | **D9's cap recalibration is the honest-static precedent.** "D9's cap recalibrated honestly (waves.start alone measures ~3.9s under load)" — a cap was reset to a MEASURED honest value with the measurement recorded, not to a bigger guess. | `docs/PROGRESS.md:401-403` |
| G6 | **The cluster's recurrence and cost are receipted.** "surfaced 4x, each passing isolated re-runs" (`PROGRESS.md:401-403`); "recurred 8x across gates — every row passes isolated re-runs" (`PROGRESS.md:425-427`); current checkpoint: "green twice isolated each" (`PROGRESS.md:12-14`); "5 isolated re-runs this sweep (kimi-acp, SC18, DC4/DC5, phase92…)" (`orchestrator-friction-ledger.md:52`). | `docs/PROGRESS.md:12-14, 401-405, 425-427`; `orchestrator-friction-ledger.md:52` |
| G7 | **The #7 class is a wall-clock race between a test stream and a real timer.** B4's must-not-stall PIN row ran a 30 ms interval against a 60 ms real `_armWatchdog` timer — a 2× margin that a loaded event loop can bridge, false-REDing a correct implementation. | `suite-blueteam.md:246-260` (the B4 finding; the concrete fix: widen the margin or drive the window through the injected `now()`/`tick()` seam) |
| G8 | **The #67 control-law line.** "a slow-but-productive worker (a long in-flight turn with provider activity) is NEVER declared stalled; no bound fires on elapsed time without an evidence check"; "no bound fires on elapsed time without an evidence check"; "A 20-minute compile is not a stall." | `suite-67-brief.md:18-20`; `stall-watchdog-contract.md:422-428` |
| G9 | **The fixture-clock-lint (#42) is the existing static evidence guard.** It flags the time-bomb shape (a `CoordinationStore` beside a near-dated expiry literal with no injected clock) and refuses the suite at the gate — a precedent for evidence-based suite hygiene, not clock-based control. | `fixture-clock-lint.mjs:1-14, 24-48` |
| G10 | **Suite-root hygiene (#40) is evidence-based.** The next start sweeps sibling roots only when the recorded owner pid is provably dead (ESRCH) — liveness evidence, never an age heuristic. The same philosophy (evidence, not rigid bounds) governs this contract. | `suite-hygiene.mjs:1-10, 23-32` |
| G11 | **`node --test` runs files in parallel and does not adapt to host load.** Verified: 8 files × 2 s each finished in ~3.7 s (all ran concurrently); the default file-level concurrency is `os.availableParallelism() - 1` (20×2 s files finish in 6.89 s under the default ≈ 9-wide on a 10-parallelism host, vs 4.97 s at `--test-concurrency=10`). The wrapper passes no `--test-concurrency`; the suite's own parallelism is the load it adds on top of the host's. | `node v25.8.0` (measured); `run-suite.mjs:105` |
| G12 | **No load measurement exists in the suite today.** `os.loadavg()` / `os.availableParallelism()` appear in no `impl/scripts/*.mjs` and no `impl/test/*.mjs`. The calibration surface is empty; a flake report today carries no load context. | `grep -rn 'loadavg\|availableParallelism\|cpus()' impl/scripts impl/test` → empty |

---

## 2. Decisions

### D1 — The calibration model: measured-load-derived deadlines, honest static idle defaults

Pick the derived shape the law demands ("measured system load at run time, not a bigger global
constant"), with the D9 honest-static precedent as the factor-1 baseline — the two halves of the
brief's "OR" compose: the idle defaults ARE the honest measurements, and the load factor extends
them. A quiet host (factor 1) is byte-identical to today; a loaded host's deadlines extend, so a
deadline still measures a hung process and never a slow-but-healthy machine.

**D1.1 The measurement — at suite start, before the child spawn.** `run-suite.mjs` takes three
readings:

- `cores = os.availableParallelism()`;
- `load = { fifteen: os.loadavg()[2], five: os.loadavg()[1], one: os.loadavg()[0] }` — the 1/5/15
  minute host load averages (sorted-key literal in ACTUAL order);
- `probeMs` — the median in-process **event-loop-gap** measurement: how late a bounded 10 ms
  interval cadence fires on average (K = 5 samples, each with a hard 2 s cap — a physical-resource
  bound on the probe itself). The probe measures the exact phenomenon the poll-until / elapsed-gap
  / margin rows time (blocker B5(i)): an in-process event-loop gap under load, not a
  separate-process spawn cost. The K samples run **sequentially** — non-overlapping cadence windows
  — so the probe's own concurrency cannot inflate the sample (blocker B5(ii); a parallel probe was
  measured to self-inflate +58 % on this host: sequential median 71 ms vs parallel median 112 ms).
  The 2 s cap is **refusal semantics** (open question 2): a sample that exceeds 2 s refuses the run
  with `suite_calibration_unavailable` — never a truncated 2000 ms that under-reads the factor on a
  slow host. The start-latency caps (the D9 class, `start_latency` in D2.2) derive from the same
  factor: their factor-1 baseline stays the recorded honest static value (D1.5) and the load term
  `load.one / cores` is the honest host-oversubscription measure that captures spawn degradation
  under load.

**The hermeticity seam (v1.2, fold-2 F1).** The gate honors a `BATON_RG_CALIBRATION` env override
carrying a **full calibration record**: when present, the start-of-run measurement above (the
`os.loadavg()` reads and the K event-loop-gap samples) is short-circuited and the injected record is
used verbatim for the D1.3 line and the child env. The override uses the suite's `BATON_RG_*`
observation naming — a `BATON_SUITE_*` name is stripped by the suite's own nested-gate sanitizer and
the gate would never see it. The red suite's gate probes (B1/B2/B3/C2) inject it, so no row depends
on real host timing: under load the nested gate cannot refuse (`suite_calibration_unavailable`) and
false-fail a correct implementation — the #7-class race the suite exists to govern.

**D1.2 The derivation (blocker B5(iii)).**

```
factor = max(1, load.one / cores, probeMs / BASELINE_PROBE_MS)
```

A continuous multiplier, floored at 1 — no `ceil`, no saturation step. Under v1.0's
`ceil(max(load.one / cores, probeMs / BASELINE_PROBE_MS))` every sub-saturation host (the #7 habitat,
G7) flattened to factor 1; dropping the `ceil` lets a fractional probe ratio express itself: a host
at 60 % busy whose event-loop probe reads 1.6× baseline yields factor ≈ 1.6, not 1.
`BASELINE_PROBE_MS` is a recorded idle-host measurement (D1.5), never an invented constant. Both
terms are measured quantities; the ratio is the honest oversubscription multiplier.

**D1.3 The recording — the gate's output names the calibration.** Before spawning the child, the
wrapper writes one stable line to stderr:

```
baton suite calibration: {"baselineBasis":"recorded","baselineProbeMs":b,"cores":N,"factor":F,"load":{"fifteen":f,"five":f,"one":o},"measuredAt":"<ISO>","probeMs":p,"schemaVersion":1}
```

and passes the identical JSON to the child via `BATON_SUITE_CALIBRATION` in the spawn env
(`run-suite.mjs:108-116` already carries the suite env). A flake report therefore carries the load
context by construction: the calibration line (wrapper stderr) + the failing row's name (`node
--test` output). The record's key set is closed and written in ACTUAL sorted order (see §3).

**D1.4 The application — time-bounded assertions derive; the G4 membership table is closed.**

- Poll-until helpers (`until`/`waitFor`/`waitUntil`): `timeoutMs = DEFAULT_TIMEOUT_MS * factor`.
- Elapsed-assertion caps (`Date.now() - started < N`, `elapsedMs < N`, the `X <= elapsed < Y`
  window's upper bound): `bound = N * factor`.
- **The G4 membership table is closed and decidable (blocker B2).** A row's classification follows
  the ownership of the timer the assertion bounds:
  - a timer owned by the harness/wrapper (`run-evidence.mjs`'s `TERM_GRACE_MS` / `KILL_GRACE_MS`,
    `run-suite.mjs`'s signal timers) is **machine-speed** → its upper bound scales;
  - a timer owned by the product kernel (`stallMs`, `requestTimeoutMs`, `drainPolicy.timeoutMs`,
    `killGraceMs`, `pollIntervalMs`, a `spawn({timeoutMs})` value) is **absolute-timing** → stays raw;
  - a floor assertion (`elapsed >= X`) is **floor-raw** → never scales (scaling a floor would
    weaken the regression-detection side of the two-sided test).

  | G4 row | Anchor | Classification | Rule basis |
  |---|---|---|---|
  | deployment deadline bounds a never-settling cleanup | `phase56-drain-and-close.test.mjs:268` (`< 500`) | **scale** | the #7 drain-deadline class (D2.2 `drain_deadline`): a suite-side machine-speed cap on the drain operation's settle time; the `drainPolicy.timeoutMs` is the internal trigger, not the asserted bound |
  | expected a bounded wait near requestTimeoutMs | `grok-acp.test.mjs:648` / `codex-appserver.test.mjs:527` (`< 2000`) | **absolute-timing** | the aborting timer is the product's `requestTimeoutMs` — D1.4's named product-timer exclusion; the cap is already 10× the product value |
  | woke before the interval | `bidirectional-driver-red.test.mjs:1176` (`elapsedMs < 1_000`) | **absolute-timing** | the asserted semantic is the product's `pollIntervalMs` wake |
  | the SIGKILL-escalation window | `phase56-drain-and-close.test.mjs:645` (`>= 4_500 && < 8_000`) | **upper bound scale; lower bound floor-raw** | the window bounds the harness's own signal-escalation path (`TERM_GRACE_MS` → `KILL_GRACE_MS` → tracked-group): the `< 8_000` upper bound is harness-owned machine-speed and scales; the `>= 4_500` lower bound is a floor-raw — the escalation genuinely waited out the grace, never scaled |
  | the SIGKILL-escalation grace floor | `claude-session.test.mjs:633` (`elapsed >= 60`) | **floor-raw** | a floor on the product's `killGraceMs`; stays raw |

- **Absolute-timing and floor-raw rows do NOT scale.** A row that asserts the implementation's OWN
  timer semantics tests product values, not machine speed; scaling those would make the assertion
  vacuous or wrong. v1.0's blanket "a SIGKILL grace window never scales" is corrected here: the
  window's lower bound (a floor) never scales, but its upper bound is harness-owned and scales
  (`phase56:645`, above). Such rows carry a reviewable marker (`// baton-suite: absolute-timing` /
  `// baton-suite: floor-raw`) and are excluded from derivation. A raw row that load-fires is
  re-staged on the injected clock seam or re-armed on progress (below) — never scaled. This is the
  boundary that keeps a load-aware deadline honest: a deadline measures a hung process;
  a product-timing row measures the product.
- **The honest per-fire evidence check (blocker B6).** The poll helpers (`until`/`waitFor`/
  `waitUntil`) already loop over a predicate; the `waitFor(events, predicate)` helpers in
  `kimi-acp.test.mjs:18` / `grok-acp.test.mjs:73` already see the event stream. A deadline that
  **re-arms on any new event** — "no new event since the last tick" is the liveness evidence — is a
  true evidence-checked bound (the #67 analog made concrete). Rows that opt into re-arm-on-progress
  are evidence-checked liveness, not scaling. The default for a deadline is the derived scaling
  (above), receipted; the contract claims only that the scaling is honest at start-of-run, not that
  it is a per-fire evidence check.
- A shared helper exposes the derivation to both surfaces: the wrapper's measurement
  (`measureCalibration()`), the child-side read (`readCalibration()`, returns the record or `null`
  when absent), and the scaling (`scaledTimeout(base) = base * factor`, factor 1 when no record).
  Suggested home `impl/scripts/suite-calibration.mjs`, imported by the wrapper and by the per-file
  helpers. `measureCalibration({ load, probeMs, baselineProbeMs, probe, baselineReceiptPath } = {})`
  accepts explicit overrides — the injection seam RG-04/RG-06 need to produce a synthetic high
  probe/load. `probe` is an injected async sampler, called exactly K = 5 times, sequentially with
  non-overlapping cadence windows (D1.1/B5(ii)). `baselineReceiptPath` points at the baseline
  receipt (D1.5): a present receipt yields `baselineBasis: "recorded"` with the recorded
  `baselineProbeMs`; an absent receipt yields `baselineBasis: "unrecorded"` with the honest-null
  `baselineProbeMs` (v1.2, fold-2 F3).

**The one-shot consequence, acknowledged (v1.1, B.1).** The reading is taken once at suite start
before the child spawns; a suite that starts loaded and finishes idle keeps lax deadlines for the
whole run. The regression-detection side of the two-sided test is softened: a timing *regression*
(a cleanup that now takes 900 ms instead of 400 ms) silently passes at factor 2. This is the v1.0
non-goal "no mid-run re-measurement", now stated with its consequence: a calibrated deadline still
measures a hang; it stops measuring a drift. The receipt makes the drift visible post-hoc.

**D1.5 The baseline is a recorded measurement, never a bigger constant.** `BASELINE_PROBE_MS` is the
recorded idle-host event-loop-gap measurement, shipped in a **separate baseline receipt** (e.g.
`suite-baseline.json` in the evidence directory) carrying its measurement context `{host, date,
method, sampleN}` — the D9 method (a measured honest value with the receipt recorded,
`PROGRESS.md:401-403`). The calibration record references that receipt (blocker B3): `baselineProbeMs`
carries the recorded value, or `null` when the baseline is unrecorded; the closed literal
`baselineBasis` is `"recorded"` or `"unrecorded"`. When unrecorded, the factor degrades to
`max(1, load.one / cores, probeMs / BASELINE_PROBE_MS)` with `baselineBasis: "unrecorded"` and
`baselineProbeMs: null` — the receipt notes the degraded basis, never a silent invented number. The
baseline receipt is a defined separate object the calibration record references; the measurement
context does not enter the record's closed key set (see §3).

**Refusal/observability (D1):** §3 (`suite_calibration_unavailable`, `suite_calibration_invalid`).
**Acceptance pins:** RG-01..RG-06, RG-12 (§5).

### D2 — Flake-taxonomy honesty: a recalibrated cap never masks a correctness failure

Some cluster members may be REAL bugs wearing flake clothes — a deadline that catches a genuine
race. The contract pins the review rule that keeps recalibration from masking them.

**D2.1 The isolated-rerun-then-load-rerun discipline.** Before any cap is touched, a failing row is
re-run twice: (a) **isolated** — the file alone; (b) **under a load context** — the host loaded
(the suite's own parallel run qualifies). Each leg carries its own calibration receipt (D1.3) so the
legs are interpretable: a loaded host during the isolated leg can misclassify a pure flake as a REAL
BUG (the conservative direction — no masking), and a quiet host during the load leg makes the load
leg pass → bucket 1 (the flake recurs). The receipts make both legible. The classification:

- **Passes isolated AND under load** → transient infra blip → the load-context receipt is attached;
  no cap change. A non-reproducible under-load fire does not end in a single classification
  (open question 5): the cluster ends by **accumulating receipts** across gates — the recurrence is
  tracked and re-checked, not dismissed by one pass.
- **Passes isolated, fails under load** → load-flake candidate → **the outcome-correctness gate
  (blocker B1) runs before any cause class is assigned**: the row is re-run once more with the
  deadline extended past the derived bound, and the awaited condition — the drain completed, the
  event arrived, the ack resolved — must be **observed to land**. If the outcome never lands even
  past the extended bound, the row is a REAL BUG (correctness ticket, cap untouched): no cause
  class, no recalibration. Only a row whose outcome lands once the deadline is extended is
  timing-only, and only then does it get the load-context receipt (D1.3) + a cause class (D2.2); the
  cap MAY then be recalibrated per D1.
- **Fails isolated** (regardless of load) → REAL BUG → the cap is NOT touched; the failure is a
  correctness ticket. A recalibration is refused for a row that fails isolated. This is the
  "never masks a correctness failure" law.

**D2.2 The closed cause-class vocabulary** (human-readable, ACTUAL sorted order) — each class names
the measurement that fired and the recalibration that applies:

| Cause class | Fires when | Recalibration |
|---|---|---|
| `drain_deadline` | a drain/close bounded wait exceeded its elapsed assertion under load | derive the bound per D1.4 |
| `event_loop_gap` | a real timer fired later than the test's stream cadence under load — the #7 class (G7); includes Node timer coalescing (v1.1: `timer_coalescing` merged here — same physical mechanism, identical recalibration; blocker B.2's vocabulary redundancy) | widen the margin or drive the timers through the injected clock seam (the B4 fix, `suite-blueteam.md:256-257`) |
| `margin_window` | a `X <= elapsed < Y` window assertion failed under load | derive the window's upper bound; keep the lower bound raw (floor-raw, D1.4) |
| `poll_floor` | a floor assertion (`elapsed >= X`) failed under load | re-verify it is a product floor, not a load artifact; re-stage on event ordering if it is (the #80 F2 precedent, `tg3-window-2026-08-07/suite-blueteam.md:130-142`) |
| `start_latency` | a process/spawn took longer under load than the cap (the D9 class: waves.start ~3.9s) | derive the cap from the factor per D1.4 (the load term is the honest spawn-degradation driver; the factor-1 baseline stays the recorded honest static value, D1.5) |

The vocabulary is closed; the diagnosis names **exactly one** class. The validating surface is
`classifyCause(receipt, row)` in `suite-calibration.mjs`: it returns a member of the closed set, or
refuses with `suite_calibration_invalid` — the refusing surface RG-08 requires (v1.1, RG-08).

**D2.3 The receipt that ships with a recalibration.** A recalibrated cap NEVER ships alone: it
ships with (a) the calibration record that fired (D1.3), (b) the cause class (D2.2), (c) both
re-runs recorded (D2.1), and (d) the **outcome confirmation** — the extended-bound re-run's observed
landing that the awaited condition completed (blocker B1). The receipt is the audit trail proving
the cap did not mask a bug.

**D2.4 The honest-null analog (#10 cross-ref).** Just as #10's waitingOn is `null`/absent when not
waiting — never a fake value, derived from event seqs
(`waiting-vocabulary-2026-08-06/grounding.md:234-240`) — a flake report never names a cause class
without its load-context receipt, and a row with no calibration context is never claimed to be a
load flake. No bare number, no un-evidenced "load flake" label.

**Refusal/observability (D2):** the load-context receipt, the outcome confirmation, and the cause
class are the observability surface. **Acceptance pins:** RG-07, RG-08, RG-13 (§5).

### D3 — The parallelism posture: concurrency adapts to the host; budgets separated honestly

**D3.1 Concurrency adapts to the host (blocker B4).** The gate derives the file-level concurrency
from the measurement: `--test-concurrency = max(1, ceil((cores - 1) / factor))` passed through
`process.argv` (G1). At factor 1 this preserves node's default (`os.availableParallelism() - 1` —
measured: 20×2 s files finish in 6.89 s under the default ≈ 9-wide on a 10-parallelism host, vs
4.97 s at `--test-concurrency=10`), so an idle run is byte-identical to today and keeps one slot of
headroom for the gate, the probe, and the host. When the host is loaded (factor > 1), the suite
sheds concurrency instead of amplifying the load. v1.0's `ceil(cores / factor)` at factor 1 derived
`cores` — one MORE than today's default — which is corrected here. **Precedence (open question 4):**
the gate appends the derived flag after the user argv it passes through (node takes the last
occurrence), so the derived flag is authoritative; a user who wants to pin concurrency sets
`BATON_SUITE_TEST_CONCURRENCY` in the env, which the gate honors before deriving. D1 and D3 are
coupled: D1 measures the load honestly, D3 ensures the suite does not add to it — a loaded host gets
FEWER concurrent files, not tighter deadlines.

**D3.2 The wrapper's STOP path is load-aware; the whole-run budget is the operator's.** The stop-path
deadlines (G2: SIGTERM 5 s → SIGKILL 1 s → tracked-group +1 s; the 5 s force-SIGKILL timer) bound a
graceful stop — a loaded machine needs more grace, so they scale by the factor
(`graceMs = BASE_GRACE_MS * factor`). The scaling is load-softened (v1.1 scoping, B.3b): the
stop-path's liveness evidence is the `groupAlive()` poll — SIGKILL fires only while the group is
still alive, so a progressing shutdown is never SIGKILLed; but the *scaling* can under-grace a host
that loads after the start reading, so a **second** SIGTERM/SIGINT during the scaled stop forces
immediate SIGKILL (the double-signal-immediate-SIGKILL escape, v1.1). The whole-run budget is the
operator's SIGTERM/SIGINT — a backstop, never a product clock, never derived from the per-file
deadlines. The per-file time-bounded assertions carry the load-aware calibration (D1); the whole-run
budget is a separate, operator-side decision.

**Refusal/observability (D3):** the calibration line names the concurrency that ran, so a flake
report shows both the load and the parallelism. **Acceptance pins:** RG-09 (§5).

### D4 — Refusal/observability vocabulary (consolidated)

The gate's output already speaks in typed diagnostics (the `fixture-clock-lint:` and
`surface-conformance:` stderr lines, G1). This contract adds two typed refusals and one stable
observability line, surface-constant across the gate:

| Code | Meaning | Message content |
|---|---|---|
| `suite_calibration_unavailable` | the probe could not be measured (a spawn failed, returned no timing, or a sample exceeded the 2 s cap) — **fail-closed**: an unmeasured run cannot distinguish a hung process from a slow machine, so the gate refuses rather than silently proceeding at factor 1 | names the failed measurement (`probe`/`loadavg`) and the cause |
| `suite_calibration_invalid` | a child (or helper) received a malformed `BATON_SUITE_CALIBRATION` | names the parse error |
| `baton suite calibration: <record>` | the stable observability line (D1.3), written once per run before the child spawns | the full calibration record (§1 D1.3) |

**The child-side refusal surface (v1.1, open question 3 / B.5).** `suite_calibration_invalid` fires
*child-side* — the gate cannot enforce it (it has already spawned). `readCalibration()` is the
enforcing surface: an **absent** `BATON_SUITE_CALIBRATION` yields `null` (factor 1 — the honest idle
default); a **malformed** record **throws a typed error** that the per-file helper surfaces as
`suite_calibration_invalid` naming the parse error. A helper that needs the record calls
`readCalibration()`; the throw fails the row with the typed refusal — never a silent factor 1 on
malformed data.

The load-aware markers are reviewable by grep: `// baton-suite: load-aware` (a helper or file opts
its poll defaults into derivation) and `// baton-suite: absolute-timing` (a row excluded from
derivation, D1.4) / `// baton-suite: floor-raw` (a floor row, D1.4). Absent both markers, the default
is derivation (load-aware), because the flake cluster is the default and the honest default is to
scale. **v1.1 scoping (B.5):** that default means every existing row across the 285 files silently
becomes load-aware at the implementation commit; the G4 membership table (D1.4) is the closed
mechanism that carves the product-timer and floor rows out of that default — an implementer does not
rely on the author-placed marker alone.

**Acceptance pins:** RG-01, RG-10 (§5).

---

## 3. Closed literals (ACTUAL sorted order, `localeCompare` banned)

The calibration record's key set — `baselineBasis, baselineProbeMs, cores, factor, load, measuredAt,
probeMs, schemaVersion` — is closed and written in ACTUAL sorted order (the `load` sub-object is
`fifteen, five, one` in ACTUAL order; the `baselineBasis` literal is `recorded, unrecorded` in
ACTUAL order). The cause-class vocabulary (D2.2) is `drain_deadline, event_loop_gap, margin_window,
poll_floor, start_latency` in ACTUAL sorted order (`timer_coalescing` merged into `event_loop_gap`,
v1.1). The refusal codes (D4) are `suite_calibration_invalid, suite_calibration_unavailable` in
ACTUAL sorted order. Each literal is its own `.sort()` result; `localeCompare` is banned.

## 4. Campaign-law constraints and non-goals

- **No clocks as workflow controls — unchanged.** This contract adds no clock to any workflow
  control surface. The suite's deadlines are TEST INFRASTRUCTURE (the law's explicit different
  surface); the calibration is a recorded measurement, never a control.
- **No new wall-clock gate in the product kernel.** `application.mjs`, `coordinator.mjs`,
  `coordination-store.mjs`, and the driver surfaces are untouched. The suite's elapsed-time bounds
  are the suite's own.
- **Absolute-timing and floor-raw rows stay raw** (D1.4): a product-timing assertion is never scaled
  into vacuity; a floor is never scaled into a weaker regression detector. The B4-margin class (G7)
  is fixed by widening or by the injected clock seam, not by scaling the product timer.
- **A recalibration never ships alone** (D2.3); a row that fails isolated is never recalibrated
  (D2.1); a load-flake candidate is never recalibrated without the outcome confirmation (B1, D2.1).
- **No bigger global constant.** The derivation uses measured ratios and a recorded baseline
  (D1.2, D1.5) — never a raised cap literal.
- **The #67 law is inherited as philosophy, satisfied where the mechanism delivers (v1.1, B6):** the
  poll helpers' re-arm-on-progress deadline is an evidence-checked liveness bound; the default
  calibrated deadline is receipted scaling, not a per-fire evidence check. The contract no longer
  claims measurement alone satisfies the law.
- **Non-goals.** Per-file re-measurement mid-run (the start measurement + D3's shed is the v1
  bound; a mid-run re-measure is a documented follow-up); a whole-run product wall budget (the
  operator's SIGTERM is the backstop, D3.2); drift detection on a one-shot calibration (a
  start-loaded run keeps lax deadlines and a timing drift is receipted, not caught — D1,
  acknowledged); re-specifying #7, #10, or #67 (cross-referenced only).

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
| RG-04 | The factor is never derived today. | `measureCalibration()` accepts explicit overrides (the injection seam); an injected record (`factor: 4`) yields `scaledTimeout(2000) === 8000`; a factor-1 record yields `scaledTimeout(2000) === 2000`. |
| RG-05 | The probe is never measured today. | `measureCalibration()` times K sequential event-loop-gap samples, returns `{baselineBasis, baselineProbeMs, cores, load, probeMs, factor}` with the baseline from the recorded receipt (D1.5) and `baselineBasis: "unrecorded"` when the receipt is absent. |
| RG-06 | A loaded host is indistinguishable from an idle one today. | A synthetic high probe/load (injected via the RG-04 overrides) yields `factor > 1`; a quiet host yields `factor === 1` (idle runs stay byte-identical). |
| RG-07 | A failing row's report carries no load context today. | The calibration line (stderr) + the failing row name (`node --test`) together form the load-context receipt; the record names `factor`, `load`, `probeMs`. |
| RG-08 | Load flakes have no cause-class vocabulary today. | A load-flake diagnosis names exactly one closed cause class (D2.2); `classifyCause()` refuses an unknown class with `suite_calibration_invalid` (the refusing surface). |
| RG-09 | File-level concurrency never adapts today. | A high factor derives `--test-concurrency = max(1, ceil((cores - 1) / factor))`; an idle run (factor 1) keeps today's concurrency (`os.availableParallelism() - 1`). |
| RG-10 | A calibration failure silently proceeds today. | A forced probe failure refuses with `suite_calibration_unavailable` and names the failed measurement; a malformed env record refuses with `suite_calibration_invalid`. |
| RG-11 | A cap change can ship without a receipt today. | **Process pin, not a red-suite oracle (v1.1, B.5):** a recalibrated cap's commit carries (a) the calibration record, (b) the cause class, (c) both re-runs, (d) the outcome confirmation (D2.3) — asserted by the review discipline, pinned in the suite's header inventory. The red suite cannot assert a review discipline; RG-11 is enforced by review, not by a red test. |
| RG-12 | An absolute-timing row scales today (if it derives at all). | A `// baton-suite: absolute-timing` / `// baton-suite: floor-raw` row is excluded from derivation: `scaledTimeout` is never applied to its product-timer or floor literals (D1.4). |
| RG-13 | A load-exposed real race is classified by the isolated/load pattern alone today; no outcome-confirmation step exists. | A load-flake candidate whose extended-bound re-run never lands the awaited condition is a REAL BUG (cap untouched, correctness ticket); only a timing-only failure (the outcome lands once the deadline is extended) gets a cause class and a recalibration; the receipt carries the outcome confirmation (B1, D2.1, D2.3). |

**The verification HEAD** is `8bd27e9bd67a65b7f295e36d7500f8d0c7522d1b` (current worktree HEAD at
fold); every anchor above was re-verified against it. The v1.0 contract named `5ac5e65…` as "current
worktree HEAD" — stale (that snapshot predates this directory; all cited targets are byte-identical
across the snapshots, so the anchors resolve identically). The deployment verification command is
the brief's execution contract (executable `true`, no arguments, exit code 0) — the authored change
is this contract document, and the calibration line is a pinned future-gate property (RG-01), not a
property the current gate must yet emit.
