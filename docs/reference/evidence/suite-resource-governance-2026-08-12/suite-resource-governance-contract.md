# Issue #77 — Suite resource governance: end the under-load flake cluster — implementation contract

**Status:** v1.0 DRAFT
**Date:** 2026-08-12
**Verification HEAD:** `5ac5e65f595e472710b576a16a699a6d6fc3dfbc` (current worktree HEAD)
**Brief:** `contract-77-brief.md` (this directory, 42 lines)
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

**The control law (operator, campaign), applied to the suite's own surface.** No clocks as
workflow CONTROLS — but the suite's deadlines are TEST INFRASTRUCTURE, a different surface. The law
here, inherited from #67's in-flight-turn gate: **no bound fires on elapsed time without an evidence
check** (`stall-watchdog-contract.md:422-428`). A test's deadline must measure what it claims (a
hung process), never declare a slow-but-healthy machine broken. The evidence check for a suite
deadline is the measured host-load calibration recorded at run time — never a bigger global
constant.

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
| G4 | **The elapsed-assertion caps are absolute machine-speed assertions.** `Date.now() - started < 500` ("deployment deadline bounds a never-settling cleanup"), `elapsed < 2000` ("expected a bounded wait near requestTimeoutMs"), `elapsedMs < 1_000` (the wake interval), `Date.now() - started >= 4_500 && < 8_000` (the SIGKILL-escalation window), `elapsed >= 60` (the grace floor). These are the rows that pass isolated and fire under load. | `phase56-drain-and-close.test.mjs:268, 645`; `grok-acp.test.mjs:648`; `codex-appserver.test.mjs:527`; `bidirectional-driver-red.test.mjs:1176`; `claude-session.test.mjs:633` |
| G5 | **D9's cap recalibration is the honest-static precedent.** "D9's cap recalibrated honestly (waves.start alone measures ~3.9s under load)" — a cap was reset to a MEASURED honest value with the measurement recorded, not to a bigger guess. | `docs/PROGRESS.md:401-403` |
| G6 | **The cluster's recurrence and cost are receipted.** "surfaced 4x, each passing isolated re-runs" (`PROGRESS.md:401-403`); "recurred 8x across gates — every row passes isolated re-runs" (`PROGRESS.md:425-427`); current checkpoint: "green twice isolated each" (`PROGRESS.md:12-14`); "5 isolated re-runs this sweep (kimi-acp, SC18, DC4/DC5, phase92…)" (`orchestrator-friction-ledger.md:52`). | `docs/PROGRESS.md:12-14, 401-405, 425-427`; `orchestrator-friction-ledger.md:52` |
| G7 | **The #7 class is a wall-clock race between a test stream and a real timer.** B4's must-not-stall PIN row ran a 30 ms interval against a 60 ms real `_armWatchdog` timer — a 2× margin that a loaded event loop can bridge, false-REDing a correct implementation. | `suite-blueteam.md:246-260` (the B4 finding; the concrete fix: widen the margin or drive the window through the injected `now()`/`tick()` seam) |
| G8 | **The #67 control-law line.** "a slow-but-productive worker (a long in-flight turn with provider activity) is NEVER declared stalled; no bound fires on elapsed time without an evidence check"; "no bound fires on elapsed time without an evidence check"; "A 20-minute compile is not a stall." | `suite-67-brief.md:18-20`; `stall-watchdog-contract.md:422-428` |
| G9 | **The fixture-clock-lint (#42) is the existing static evidence guard.** It flags the time-bomb shape (a `CoordinationStore` beside a near-dated expiry literal with no injected clock) and refuses the suite at the gate — a precedent for evidence-based suite hygiene, not clock-based control. | `fixture-clock-lint.mjs:1-14, 24-48` |
| G10 | **Suite-root hygiene (#40) is evidence-based.** The next start sweeps sibling roots only when the recorded owner pid is provably dead (ESRCH) — liveness evidence, never an age heuristic. The same philosophy (evidence, not rigid bounds) governs this contract. | `suite-hygiene.mjs:1-10, 23-32` |
| G11 | **`node --test` runs files in parallel and does not adapt to host load.** Verified: 8 files × 2 s each finished in ~3.7 s (all ran concurrently). The wrapper passes no `--test-concurrency`; the suite's own parallelism is the load it adds on top of the host's. | `node v25.8.0` (measured); `run-suite.mjs:105` |
| G12 | **No load measurement exists in the suite today.** `os.loadavg()` / `os.availableParallelism()` appear in no `impl/scripts/*.mjs` and no `impl/test/*.mjs`. The calibration surface is empty; a flake report today carries no load context. | `grep -rn 'loadavg\\|availableParallelism\\|cpus()' impl/scripts impl/test` → empty |

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
- `probeMs` — the median wall time of K = 5 bounded `node -e ''` spawns (each with a hard 2 s cap,
  a physical-resource bound on the probe itself). The probe measures the honest per-process-spawn
  cost on this host right now — the exact operation the start-latency caps time.

**D1.2 The derivation.** `factor = max(1, ceil(max(load.one / cores, probeMs / BASELINE_PROBE_MS)))`
where `BASELINE_PROBE_MS` is a recorded idle-host measurement (D1.5), never an invented constant.
Both terms are measured quantities; the ratio is the honest oversubscription multiplier.

**D1.3 The recording — the gate's output names the calibration.** Before spawning the child, the
wrapper writes one stable line to stderr:

```
baton suite calibration: {"baselineProbeMs":b,"cores":N,"factor":F,"load":{"fifteen":f,"five":f,"one":o},"measuredAt":"<ISO>","probeMs":p,"schemaVersion":1}
```

and passes the identical JSON to the child via `BATON_SUITE_CALIBRATION` in the spawn env
(`run-suite.mjs:108-116` already carries the suite env). A flake report therefore carries the load
context by construction: the calibration line (wrapper stderr) + the failing row's name (`node
--test` output). The record's key set is closed and written in ACTUAL sorted order (see §3).

**D1.4 The application — time-bounded assertions derive; absolute-timing rows never scale.**

- Poll-until helpers (`until`/`waitFor`/`waitUntil`): `timeoutMs = DEFAULT_TIMEOUT_MS * factor`.
- Elapsed-assertion caps (`Date.now() - started < N`, `elapsedMs < N`, the `X <= elapsed < Y`
  window's upper bound): `bound = N * factor`.
- **Absolute-timing rows do NOT scale.** A row that asserts the implementation's OWN timer
  semantics — `stallMs`, a SIGKILL grace window, `requestTimeoutMs`, a `spawn({timeoutMs})` value —
  tests product values, not machine speed. Scaling those would make the assertion vacuous or wrong.
  Such rows carry a reviewable marker (`// baton-suite: absolute-timing`) and are excluded from
  derivation. This is the boundary that keeps a load-aware deadline honest: a deadline measures a
  hung process; a product-timing row measures the product.
- A shared helper exposes the derivation to both surfaces: the wrapper's measurement
  (`measureCalibration()`), the child-side read (`readCalibration()`, returns the record or `null`
  when absent), and the scaling (`scaledTimeout(base) = base * factor`, factor 1 when no record).
  Suggested home `impl/scripts/suite-calibration.mjs`, imported by the wrapper and by the per-file
  helpers.

**D1.5 The baseline is a recorded measurement, never a bigger constant.** `BASELINE_PROBE_MS`
ships in the calibration record with its measurement context `{host, date, method, sampleN}` — the
D9 method (a measured honest value with the receipt recorded, `PROGRESS.md:401-403`). The derivation
never uses a "bigger global constant"; if the baseline is unrecorded, the record says so and the
factor degrades to `max(1, ceil(load.one / cores))` with the receipt noting the degraded basis —
never a silent invented number.

**Refusal/observability (D1):** §3 (`suite_calibration_unavailable`, `suite_calibration_invalid`).
**Acceptance pins:** RG-01..RG-06, RG-12 (§5).

### D2 — Flake-taxonomy honesty: a recalibrated cap never masks a correctness failure

Some cluster members may be REAL bugs wearing flake clothes — a deadline that catches a genuine
race. The contract pins the review rule that keeps recalibration from masking them.

**D2.1 The isolated-rerun-then-load-rerun discipline.** Before any cap is touched, a failing row is
re-run twice: (a) **isolated** — the file alone; (b) **under a load context** — the host loaded
(the suite's own parallel run qualifies). The classification:

- **Passes isolated AND under load** → transient infra blip → the load-context receipt is attached;
  no cap change.
- **Passes isolated, fails under load** → load-flake candidate → the row gets the load-context
  receipt (D1.3) + a human-readable cause class (D2.2); the cap MAY be recalibrated per D1.
- **Fails isolated** (regardless of load) → REAL BUG → the cap is NOT touched; the failure is a
  correctness ticket. A recalibration is refused for a row that fails isolated. This is the
  "never masks a correctness failure" law.

**D2.2 The closed cause-class vocabulary** (human-readable, ACTUAL sorted order) — each class names
the measurement that fired and the recalibration that applies:

| Cause class | Fires when | Recalibration |
|---|---|---|
| `drain_deadline` | a drain/close bounded wait exceeded its elapsed assertion under load | derive the bound per D1.4 |
| `event_loop_gap` | a real timer fired later than the test's stream cadence (the #7 class, G7) | widen the margin or drive the timers through the injected clock seam (the B4 fix, `suite-blueteam.md:256-257`) |
| `margin_window` | a `X <= elapsed < Y` window assertion failed under load | derive the window's upper bound; keep the lower bound raw |
| `poll_floor` | a floor assertion (`elapsed >= X`) failed under load | re-verify it is a product floor, not a load artifact; re-stage on event ordering if it is (the #80 F2 precedent) |
| `start_latency` | a process/spawn took longer under load than the cap (the D9 class: waves.start ~3.9 s) | derive the cap from the probe per D1.4 |
| `timer_coalescing` | Node timer coalescing under load delayed an interval (G7's B4 mechanism) | same as `event_loop_gap` |

**D2.3 The receipt that ships with a recalibration.** A recalibrated cap NEVER ships alone: it
ships with (a) the calibration record that fired (D1.3), (b) the cause class (D2.2), (c) both
re-runs recorded (D2.1). The receipt is the audit trail proving the cap did not mask a bug.

**D2.4 The honest-null analog (#10 cross-ref).** Just as #10's waitingOn is `null`/absent when not
waiting — never a fake value, derived from event seqs
(`waiting-vocabulary-2026-08-06/grounding.md:234-240`) — a flake report never names a cause class
without its load-context receipt, and a row with no calibration context is never claimed to be a
load flake. No bare number, no un-evidenced "load flake" label.

**Refusal/observability (D2):** the load-context receipt and cause class are the observability
surface. **Acceptance pins:** RG-07, RG-08 (§5).

### D3 — The parallelism posture: concurrency adapts to the host; budgets separated honestly

**D3.1 Concurrency adapts to the host.** The gate derives the file-level concurrency from the
measurement: `--test-concurrency = max(1, ceil(cores / factor))` passed through `process.argv`
(G1). When the host is loaded (factor > 1), the suite sheds concurrency instead of amplifying the
load. D1 and D3 are coupled: D1 measures the load honestly, D3 ensures the suite does not add to
it — a loaded host gets FEWER concurrent files, not tighter deadlines.

**D3.2 The wrapper's STOP path is load-aware; the whole-run budget is the operator's.** The stop-path
deadlines (G2: SIGTERM 5 s → SIGKILL 1 s → tracked-group +1 s; the 5 s force-SIGKILL timer) bound a
graceful stop — a loaded machine needs more grace, so they scale by the factor
(`graceMs = BASE_GRACE_MS * factor`). The whole-run budget is the operator's SIGTERM/SIGINT — a
backstop, never a product clock, never derived from the per-file deadlines. The per-file
time-bounded assertions carry the load-aware calibration (D1); the whole-run budget is a separate,
operator-side decision.

**Refusal/observability (D3):** the calibration line names the concurrency that ran, so a flake
report shows both the load and the parallelism. **Acceptance pins:** RG-09 (§5).

### D4 — Refusal/observability vocabulary (consolidated)

The gate's output already speaks in typed diagnostics (the `fixture-clock-lint:` and
`surface-conformance:` stderr lines, G1). This contract adds two typed refusals and one stable
observability line, surface-constant across the gate:

| Code | Meaning | Message content |
|---|---|---|
| `suite_calibration_unavailable` | the probe could not be measured (spawn failed or returned no timing) — **fail-closed**: an unmeasured run cannot distinguish a hung process from a slow machine, so the gate refuses rather than silently proceeding at factor 1 | names the failed measurement (`probe`/`loadavg`) and the cause |
| `suite_calibration_invalid` | a child (or helper) received a malformed `BATON_SUITE_CALIBRATION` | names the parse error |
| `baton suite calibration: <record>` | the stable observability line (D1.3), written once per run before the child spawns | the full calibration record (§1 D1.3) |

The load-aware markers are reviewable by grep: `// baton-suite: load-aware` (a helper or file opts
its poll defaults into derivation) and `// baton-suite: absolute-timing` (a row excluded from
derivation, D1.4). Absent both markers, the default is derivation (load-aware), because the flake
cluster is the default and the honest default is to scale.

**Acceptance pins:** RG-01, RG-10 (§5).

---

## 3. Closed literals (ACTUAL sorted order, `localeCompare` banned)

The calibration record's key set — `baselineProbeMs, cores, factor, load, measuredAt, probeMs,
schemaVersion` — is closed and written in ACTUAL sorted order (the `load` sub-object is `fifteen,
five, one` in ACTUAL order). The cause-class vocabulary (D2.2) is `drain_deadline, event_loop_gap,
margin_window, poll_floor, start_latency, timer_coalescing` in ACTUAL sorted order. The refusal
codes (D4) are `suite_calibration_invalid, suite_calibration_unavailable` in ACTUAL sorted order.
Each literal is its own `.sort()` result; `localeCompare` is banned.

## 4. Campaign-law constraints and non-goals

- **No clocks as workflow controls — unchanged.** This contract adds no clock to any workflow
  control surface. The suite's deadlines are TEST INFRASTRUCTURE (the law's explicit different
  surface); the calibration is a recorded measurement, never a control.
- **No new wall-clock gate in the product kernel.** `application.mjs`, `coordinator.mjs`,
  `coordination-store.mjs`, and the driver surfaces are untouched. The suite's elapsed-time bounds
  are the suite's own.
- **Absolute-timing rows stay raw** (D1.4): a product-timing assertion is never scaled into
  vacuity. The B4-margin class (G7) is fixed by widening or by the injected clock seam, not by
  scaling the product timer.
- **A recalibration never ships alone** (D2.3); a row that fails isolated is never recalibrated
  (D2.1).
- **No bigger global constant.** The derivation uses measured ratios and a recorded baseline
  (D1.2, D1.5) — never a raised cap literal.
- **Non-goals.** Per-file re-measurement mid-run (the start measurement + D3's shed is the v1
  bound; a mid-run re-measure is a documented follow-up); a whole-run product wall budget (the
  operator's SIGTERM is the backstop, D3.2); re-specifying #7, #10, or #67 (cross-referenced only).

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
| RG-04 | The factor is never derived today. | An injected calibration (`factor: 4`) yields `scaledTimeout(2000) === 8000`; a factor-1 record yields `scaledTimeout(2000) === 2000`. |
| RG-05 | The probe is never measured today. | `measureCalibration()` times K probe spawns, returns `{cores, load, probeMs, baselineProbeMs, factor}` with the baseline from the recorded receipt (D1.5). |
| RG-06 | A loaded host is indistinguishable from an idle one today. | A synthetic high probe/load yields `factor > 1`; a quiet host yields `factor === 1` (idle runs stay byte-identical). |
| RG-07 | A failing row's report carries no load context today. | The calibration line (stderr) + the failing row name (`node --test`) together form the load-context receipt; the record names `factor`, `load`, `probeMs`. |
| RG-08 | Load flakes have no cause-class vocabulary today. | A load-flake diagnosis names exactly one closed cause class (D2.2); an unknown class is refused. |
| RG-09 | File-level concurrency never adapts today. | A high factor derives `--test-concurrency = max(1, ceil(cores / factor))`; an idle run keeps today's concurrency. |
| RG-10 | A calibration failure silently proceeds today. | A forced probe failure refuses with `suite_calibration_unavailable` and names the failed measurement; a malformed env record refuses with `suite_calibration_invalid`. |
| RG-11 | A cap change can ship without a receipt today. | A recalibrated cap's commit carries (a) the calibration record, (b) the cause class, (c) both re-runs (D2.3) — asserted by the review discipline, pinned in the suite's header inventory. |
| RG-12 | An absolute-timing row scales today (if it derives at all). | A `// baton-suite: absolute-timing` row is excluded from derivation: `scaledTimeout` is never applied to its product-timer literals (D1.4). |

**The verification HEAD** is `5ac5e65f595e472710b576a16a699a6d6fc3dfbc`; every anchor above was
re-verified against it. The deployment verification command is the brief's execution contract
(executable `true`, no arguments, exit code 0) — the authored change is this contract document,
and the calibration line is a pinned future-gate property (RG-01), not a property the current gate
must yet emit.
