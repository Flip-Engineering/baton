# #77 FOLD MAP — contract v1.0 → v1.1, all 6 red-team blockers resolved

**Contract:** `suite-resource-governance-contract.md` (v1.1, this directory)
**Red-team:** `contract-redteam.md` (this directory — NOT FOLD-READY, §D)
**Fold HEAD:** `ebb40625ba5401ec3902e74c1ac6f01744537f28` (current worktree HEAD)
**Date:** 2026-08-12

Every blocker below carries its red-team fix verbatim into the contract; each entry names the
contract decision/section that changed. Sorted-key literals remain ACTUAL order; `localeCompare`
remains banned; every anchor retained or added was re-verified at the fold HEAD.

---

## Fold summary

| Blocker | Contract change |
|---|---|
| B1 — load-exposed real race recalibrated as a flake | D2.1 outcome-confirmation gate + D2.3 receipt field (d) + RG-11 |
| B2 — G4 ↔ D1.4 SIGKILL-window contradiction | D1.4 closed G4 membership table; `phase56:645` marked scale-upper / floor-raw; G4 wording |
| B3 — D1.5 baseline context vs §3 closed set | D1.3/D1.5 + §3 closed key set extended; `baselineBasis` literal pinned |
| B4 — RG-09 false against D3.1's formula | D3.1 `(cores - 1) / factor`; G11 (node default concurrency); RG-09 oracle |
| B5 — factor under-reads the #7 sub-saturation habitat | D1.1 gap probe + sequential spawns; D1.2 continuous factor |
| B6 — "calibration is the evidence check" over-delivers #67 | control-law line + D1.4 evidence-checked (re-arm-on-progress) form + scoped residual |

---

## B1 — D2.1 lets a load-exposed real race be recalibrated as a flake

**Red-team:** a row that passes isolated and fails under load is classified "load-flake candidate"
purely on the isolated/load pattern; a genuine race that only manifests under load lands in that
bucket and receives a cause class + cap recalibration, violating the contract's headline law. D2.2's
classes are all measurement-centric and prescribe recalibration; none checks the *outcome* was
correct when given the deadline.

**Fix applied.** D2.1's middle bucket now passes through the **outcome-confirmation gate** before
any cause class or recalibration: the load re-run repeats with the deadline extended (per D1) and
the awaited condition must be observed to land (the drain completed, the event arrived, the ack
resolved). If the outcome does not land even past the extended bound, the row is a REAL BUG —
correctness ticket, cap untouched. D2.3's receipt now carries (d) the outcome-confirmation as a
receipt field; RG-11's oracle lists it. D2.1's isolated and load legs each record their own
calibration receipt, so an isolated leg on a loaded host (or a quiet load leg) is interpretable.

## B2 — G4 ↔ D1.4 contradiction on the SIGKILL window

**Red-team:** `phase56-drain-and-close.test.mjs:645` (`>= 4_500 && < 8_000`) is simultaneously a
G4 load-firing cap (D1.4 scales the `X <= elapsed < Y` upper bound) and the canonical absolute-
timing example ("a SIGKILL grace window" never scales). An implementer cannot classify it.

**Fix applied.** D1.4 gains a **closed G4 membership table** keyed to a decidable ownership rule: a
timer owned by the harness/wrapper (run-evidence.mjs `TERM_GRACE_MS`/`KILL_GRACE_MS`, run-suite.mjs
stop-path) is machine-speed and scales its upper bound; a timer owned by the product kernel is
absolute-timing and stays raw; a floor assertion never scales. `phase56:645` is marked explicitly
as a **scale-upper / floor-raw** row — it measures the wrapper's own escalation (`TERM_GRACE_MS` +
`KILL_GRACE_MS`), not a product timer — resolving the contradiction. D1.4's absolute-timing
exclusion now names a PRODUCT-kernel-owned SIGKILL grace, not the wrapper's own. All six G4 rows are
classified (3 scale, 1 scale-upper/floor-raw, 1 scale, 1 floor-raw); rows outside the table default
to derivation (D4) unless they carry the `// baton-suite: absolute-timing` marker. G4's wording
clarifies the rows are wall-time machine-speed assertions classified in the table.

## B3 — D1.5 contradicts §3's closed key set

**Red-team:** D1.5 ships `BASELINE_PROBE_MS` "with its measurement context `{host, date, method,
sampleN}`", but §3's closed set omits those keys; and the degraded-basis path ("if the baseline is
unrecorded, the record says so") has no closed-set representation.

**Fix applied.** The closed key set is extended to
`baselineBasis, baselineGapMs, baselineProbeMs, cores, date, factor, gapMs, host, load, measuredAt,
method, probeMs, sampleN, schemaVersion` (ACTUAL order, re-sorted; `baselineBasis` < `baselineGapMs`
< `baselineProbeMs`; `measuredAt` < `method`; `sampleN` < `schemaVersion`). The unrecorded-baseline
representation is pinned: `baselineBasis` ∈ {`recorded`, `unrecorded`} (ACTUAL order), `"recorded"`
only when both baselines are recorded, else `baselineProbeMs: null` + `baselineGapMs: null` with
the factor degrading to `max(1, load.one / cores)` and the receipt noting the degraded basis. The
`baselineBasis` literal is added to §3. This is the open-question 6 verdict: the context lives in
the record itself.

## B4 — RG-09's oracle is false against D3.1's formula

**Red-team:** node's default test-file concurrency is `os.availableParallelism() - 1` (verified);
D3.1's `max(1, ceil(cores / factor))` at factor 1 derives `cores` — one MORE than today — while
RG-09/D1 promise "an idle run keeps today's concurrency" and "a quiet host is byte-identical."

**Fix applied.** D3.1 derives `--test-concurrency = max(1, ceil((cores - 1) / factor))` — at factor
1, `cores - 1`, node's current idle default — so RG-09's "idle run keeps today's concurrency" is
now true against the formula. G11 records the measured default (20×2 s files → 6.89 s default ≈
9-wide on a 10-parallelism host) as the ground truth the formula preserves. RG-09's oracle names the
`(cores - 1)` shape.

## B5 — D1's factor under-reads the #7 class it governs

**Red-team:** three compounded defects — (a) the load term is a saturation step
(`ceil(load.one / cores)` → 1 below saturation, where the #7 class lives); (b) the probe measures
spawn latency while the factor scales event-loop-gap/margin rows it does not observe; (c) an
unspecified parallel probe self-inflates +58 % (measured: sequential median 71 ms vs parallel
112 ms).

**Fix applied.** D1.1 adds the **in-process event-loop-gap probe** (`gapMs` — how late a 10 ms
interval fires on average, bounded), the physical phenomenon the #7 class names (G7's B4), and pins
the K spawns **sequential** (or the probe's own concurrency excluded). D1.2's factor is now
continuous — `max(1, load.one / cores, probeMs / BASELINE_PROBE_MS, gapMs / BASELINE_GAP_MS)` —
with no saturation `ceil`: a 60 %-busy host with the gap probe elevated reads factor ≈ 1.6, not 1.
The gap term ships in the record (`gapMs`, `baselineGapMs`). A probe tick that exceeds its cap is
refused (`suite_calibration_unavailable`), never truncated.

## B6 — "The evidence check is the measured host-load calibration" over-delivers #67

**Red-team:** the calibration is a one-shot, pre-spawn scaling applied uniformly to every deadline;
it is not a per-fire evidence check. A host that loads after the start reading false-fires a
calibrated deadline with no in-run evidence; "never declare a slow-but-healthy machine broken" is
stronger than the mechanism delivers.

**Fix applied.** The control-law line now states the two-fold evidence surface: (1) the honest
in-flight-turn analog — a poll helper that re-arms on predicate progress ("no new event since the
last tick", the `waitFor(events, predicate)` helpers at `kimi-acp.test.mjs:18` / `grok-acp.test.mjs:73`
already see the event stream) is evidence-checked liveness; (2) the receipted calibration — a
start-of-run measured-load record that extends deadlines as receipted scaling. D1.4 gains the
evidence-checked form (preferred for #7-class helpers) and explicitly scopes the residual:
calibrated deadlines are receipted scaling, not per-fire evidence checks; a post-start load spike
can still false-fire, and the receipt makes it explainable, not prevented. The contract no longer
claims the #67 law is met by measurement alone. §4 adds the acknowledged drift-detection consequence
of the one-shot sample (the B.1 fold: the calibration measures a hang, not a drift).

---

## Open-question verdicts (all applied)

| # | Question | Red-team verdict | Applied as |
|---|---|---|---|
| 1 | Probe spawns: sequential or parallel? | HOLE — decisive; default sequential (or exclude the probe's own load) | D1.1: K spawns run sequentially; a parallel probe self-inflates +58 % (measured) |
| 2 | Probe > 2 s cap: refusal or truncated 2000 ms? | HOLE — truncation under-reads factor; specify refusal | D1.1/D4: a cap-exceeded probe tick is refused with `suite_calibration_unavailable`, never truncated |
| 3 | Who reads `BATON_SUITE_CALIBRATION` / enforces `suite_calibration_invalid`? | HOLE — child-side surface undefined | D4: refusal surfaces split by side — `unavailable` at the gate, `invalid` child-side via a typed `SuiteCalibrationError`; `readCalibration()` absent→`null`, malformed→refuse |
| 4 | `--test-concurrency` precedence vs a user-supplied flag | HOLE (minor) | D3.1: the derived flag is appended after the user argv, so it takes precedence (node takes the last); the calibration line names the concurrency that ran |
| 5 | D2 bucket 1: non-reproducible fire recurs indefinitely? | SOUND with a documentation duty | D2.1: the row keeps a receipt trail; the cluster ends by accumulating receipts, not a single classification |
| 6 | Where does the baseline context `{host, date, method, sampleN}` live? | HOLE — blocker B3 | D1.3/D1.5/§3: context keys ship in the closed record set |

---

## Non-blocking folds (worth landing with the blockers)

- **Probe timeout semantics** → open question 2 (refusal), D1.1/D4.
- **`suite_calibration_invalid` child-side surface + `readCalibration()` absent-vs-malformed** →
  open question 3, D4.
- **One-shot sample's drift-detection softening** → §4 acknowledged consequence + the D1.4
  evidence-checked (re-arm) form as the remedy.
- **D2 bucket 1's "no action" recurrence** → open question 5, D2.1 receipt accumulation.
- **Stop-path load-softened backstop + missing double-signal escape** → D3.2: a second
  SIGTERM/SIGINT during the grace window escalates immediately to SIGKILL (the operator's budget is
  never silently exceeded by the scaling).
- **`--test-concurrency` precedence** → open question 4, D3.1.
- **`event_loop_gap`/`timer_coalescing` vocabulary redundancy** → D2.2/§3: `timer_coalescing`
  merged into `event_loop_gap`; a single fire is now unambiguously one closed class (RG-08).
- **Un-anchored #80 F2** → D2.2 `poll_floor` row now anchors
  `tg3-window-2026-08-07/suite-blueteam.md:130-142`.
- **Stale verification HEAD** → header + §5 name the current worktree HEAD
  `ebb40625ba5401ec3902e74c1ac6f01744537f28`.
- **Marker-default silent scaling of all 285 files' rows** → D4: the default-derivation sweep is
  bounded by the closed D1.4 membership table and the closed cause-class vocabulary; the
  implementer pins the G4 classification at implementation time.
- **RG-04/RG-06 injection-seam gap** → D1.4: `measureCalibration()`/`readCalibration()` accept
  injection overrides (a synthetic `{cores, load, probeMs, gapMs, baselineProbeMs,
  baselineGapMs}`) so the red suite can produce the synthetic high-probe/load cases.

---

## Verification

All anchors retained or added were re-verified at the fold HEAD with `grep -an` / `sed -n`:
the G4 rows (`phase56:268, 645`, `grok-acp:648`, `codex-appserver:527`,
`bidirectional-driver-red:1176`, `claude-session:633`); the wrapper timers
(`run-evidence.mjs:13-15, 122-127, 137`; `run-suite.mjs:217, 225, 232, 241`); the poll helpers
(`kimi-acp:18`, `grok-acp:73`, `phase56:45`, `phase8:75`); the control-law lines
(`stall-watchdog-contract.md:422-428`, `suite-67-brief.md:18-20`); the #80 F2 anchor
(`tg3-window-2026-08-07/suite-blueteam.md:130-142`); and the gate/env seams
(`run-suite.mjs:19-25, 108-116`; `impl/package.json:27`). No NUL-bearing `impl/src/*.mjs` file was
opened whole; this contract owns the suite surface only.
