# #77 FOLD MAP — blocker → change map (suite-resource-governance v1.0 → v1.1)

**Fold source:** `contract-redteam.md` — verdict **NOT FOLD-READY**, six numbered blockers in §D.
**Fold target:** `suite-resource-governance-contract.md` (v1.1, this directory).
**Verification HEAD for this fold:** `8bd27e9bd67a65b7f295e36d7500f8d0c7522d1b` (current worktree
HEAD). The v1.0 contract's verification HEAD (`5ac5e65…`) was stale — that snapshot predates this
directory; every cited target is byte-identical across the compared snapshots (`git diff
5ac5e65..HEAD -- <file>` empty for all cited files), so the anchors resolve identically at the fold
HEAD. The fold changes no citation anchor; it adds the `#80 F2` anchor
(`tg3-window-2026-08-07/suite-blueteam.md:130-142`) that v1.0's `poll_floor` row referenced by name
only.

## Blockers (all 6 folded)

| Blocker | Verdict | Change in v1.1 | Where |
|---|---|---|---|
| **B1** — D2.1 lets a load-exposed real race be recalibrated as a flake | HOLE | The **outcome-correctness gate** runs between D2.1 bucket 2 and D2.2: a load-flake candidate is re-run with the deadline extended past the derived bound, and the awaited condition (drain completed / event arrived / ack resolved) must be **observed to land**. If the outcome never lands even past the extended bound → REAL BUG (correctness ticket, cap untouched). The confirmation becomes a receipt field (D2.3(d)) and a new red-first pin (RG-13). | D2.1, D2.2, D2.3, §4, RG-13 |
| **B2** — G4 ↔ D1.4 contradiction on the SIGKILL window | HOLE | A **closed G4 membership table** (scale / absolute-timing / floor-raw), keyed to a decidable rule: a timer owned by the harness/wrapper is machine-speed and scales its upper bound; a timer owned by the product kernel is absolute-timing and stays raw; a floor assertion is floor-raw. `phase56:645` is marked explicitly: **upper bound scale** (the harness's own signal-escalation path), **lower bound floor-raw**. The blanket "a SIGKILL grace window never scales" exclusion is corrected. | G4, D1.4, §4 |
| **B3** — D1.5 contradicts §3's closed key set | HOLE | The baseline measurement context `{host, date, method, sampleN}` moves to a **separate baseline receipt** the calibration record references. The record's closed key set gains `baselineBasis` (`"recorded"\|"unrecorded"`, ACTUAL order). Unrecorded baseline is pinned: `baselineProbeMs: null` + `baselineBasis: "unrecorded"`. | D1.5, §3 |
| **B4** — RG-09's oracle is false against D3.1's formula | HOLE | D3.1 derives `--test-concurrency = max(1, ceil((cores - 1) / factor))`, preserving node's idle default (`os.availableParallelism() - 1`) at factor 1. RG-09's oracle is fixed to match. | D3.1, RG-09 |
| **B5** — D1's factor under-reads the #7 class it governs | HOLE | (i) `probeMs` becomes an in-process **event-loop-gap** measurement (how late a bounded 10 ms interval cadence fires on average) instead of spawn cost alone; (ii) the probe samples run **sequentially** (a parallel probe self-inflated +58 % measured); (iii) the derivation drops the saturation `ceil`: `factor = max(1, load.one / cores, probeMs / BASELINE_PROBE_MS)`. The 2 s probe cap is refusal semantics, never truncation. The one-shot drift-detection consequence is acknowledged. | D1.1, D1.2, D1.3, D1 |
| **B6** — "The evidence check" over-delivers the #67 law | HOLE | The control-law line is scoped: the calibration is **receipted start-of-run scaling**, not a per-fire evidence check; a post-start load spike can still false-fire and the receipt makes it explainable, not prevented. The honest per-fire evidence check is added as the poll helpers' **re-arm-on-progress** deadline ("no new event since the last tick"). §4 stops claiming measurement alone satisfies the law. | preamble, D1.4, §4 |

## Open questions (all verdict'd, all folded)

| # | Question | Verdict | Change in v1.1 |
|---|---|---|---|
| 1 | Probe spawns sequential or parallel? | HOLE — decisive (self-inflation) | **Sequential** by default; the probe's own concurrency is excluded. D1.1. |
| 2 | Probe >2 s cap: refusal or truncated 2000 ms? | HOLE | **Refusal** — a sample over 2 s refuses with `suite_calibration_unavailable`; truncation would under-read the factor. D1.1, D4. |
| 3 | Who reads `BATON_SUITE_CALIBRATION` and enforces `suite_calibration_invalid`? | HOLE | `readCalibration()` is the enforcing surface: absent env → `null` (factor 1); malformed env → typed throw surfaced as `suite_calibration_invalid` naming the parse error. D4. |
| 4 | `--test-concurrency` precedence vs a user-supplied flag | HOLE (minor) | The gate appends the derived flag after the user argv (node takes the last) → the derived flag is authoritative; `BATON_SUITE_TEST_CONCURRENCY` is the explicit override. D3.1. |
| 5 | D2 bucket 1 "no action" recurrence | SOUND with a documentation duty | A non-reproducible under-load fire recurs by **accumulating receipts** across gates, not by a single classification. D2.1. |
| 6 | Where does the baseline's measurement context live? | HOLE → blocker B3 | Separate baseline receipt referenced by the record; `baselineBasis` key added to the closed set. D1.5, §3. |

## Non-blocking folds (carried into v1.1)

| Red-team note | Change in v1.1 |
|---|---|
| Probe timeout semantics (open question 2) | Refusal semantics in D1.1/D4. |
| `suite_calibration_invalid` child-side surface + `readCalibration()` absent-vs-malformed | D4. |
| The one-shot sample's drift-detection softening | Acknowledged in D1 ("a calibrated deadline still measures a hang; it stops measuring a drift"). |
| D2 bucket 1's "no action" recurrence (open question 5) | Accumulating-receipts posture in D2.1. |
| The stop-path load-softened backstop and missing double-signal escape | A second SIGTERM/SIGINT during the scaled stop forces immediate SIGKILL; the `groupAlive()` poll is named as the stop-path's liveness evidence. D3.2. |
| `--test-concurrency` precedence (open question 4) | Specified in D3.1. |
| The `event_loop_gap`/`timer_coalescing` vocabulary redundancy | **Merged** — `timer_coalescing` folds into `event_loop_gap` (same physical mechanism, identical recalibration); the closed cause-class set is now 5. D2.2, §3. |
| The un-anchored #80 F2 precedent and stale verification HEAD | `poll_floor` cites `tg3-window-2026-08-07/suite-blueteam.md:130-142`; verification HEAD updated to the fold HEAD. D2.2, header, §5. |
| The marker-default silent scaling of all 285 files' rows | The G4 membership table (D1.4) is named as the closed mechanism that carves product-timer/floor rows out of the default-derivation. D4, D1.4. |
| The RG-04/RG-06 injection-seam gap | `measureCalibration({ load, probeMs, baselineProbeMs } = {})` accepts explicit overrides. D1.4, RG-04, RG-06. |
| RG-11 mislabeled as a red-suite oracle | Reclassified as a **process pin** (enforced by review, not assertable by a red test). RG-11. |

## Fold integrity

- Every citation in v1.1 was re-verified at the fold HEAD with `grep -an` / `sed -n`; the two
  NUL-bearing source files (`impl/src/application.mjs`, `impl/src/coordination-store.mjs`) are
  referenced only as untouchable product-kernel names (§4), never by line anchor.
- Sorted-key literals are ACTUAL order (`localeCompare` banned): the record key set is now
  `baselineBasis, baselineProbeMs, cores, factor, load, measuredAt, probeMs, schemaVersion`; the
  `load` sub-object is `fifteen, five, one`; `baselineBasis` is `recorded, unrecorded`; the
  cause-class set is `drain_deadline, event_loop_gap, margin_window, poll_floor, start_latency`;
  the refusal codes are `suite_calibration_invalid, suite_calibration_unavailable`.
- No clocks were added to any workflow control surface; the product kernel is untouched.
