# ROW BRIEF — row-stall-break: the wave-level stall window derives from observed cadence

Deliverable: implementation + red-first pin suite. The #163 law is the contract (issue and
the landed quiescence work, 8ec52a6c).

## Anchors (re-verify at YOUR head; line numbers drift)

- impl/src/wave-driver.mjs:42 — DEFAULT_POLICY.stallTimeoutMs = 20 * 60_000 (FIXED).
- impl/src/wave-driver.mjs:774 — the break: now - lastMarkerAt >= policy.stallTimeoutMs fires
  claim-on-stall fan-out / stall basis. D4 comment: stall checked BEFORE cap (cap is dead).
- The L5 law (:12-15): liveness marker = cursor-stripped status view, wave-level; ONE live
  member resets the stall clock for all.
- The landed quiescence precedent for derivation: quiet window max(2x maxObservedGapMs,
  8x pollIntervalMs) — mirror THAT shape.

## The contract (closed)

1. The stall window becomes DERIVED: track the wave's own observed marker-advance cadence
   (the poll-to-poll gaps between lastMarkerAt moves) and set the fatal window to
   max(2x maxObservedGapMs, 8x pollIntervalMs) — the same derivation the quiescence quiet
   window uses. A policy may still pin an explicit stallTimeoutMs (back-compat, tests rely on
   it); the DERIVED value replaces only the fixed production DEFAULT.
2. Terminal semantics byte-stable: same bases (stall / claim-on-stall), same receipts, same
   L6 unproductivity budget. No new event kinds.
3. Red-first pin impl/test/wave-driver-stall-derived-red.test.mjs: a wave whose marker
   advances on a cadence SLOWER than 20min (e.g. observed gaps of 25min scaled into test
   time via poll overrides) must NOT break at the old fixed default — RED at pre-change
   head, GREEN after.

## Hard bounds

Additive hunks; never edit an existing suite to pass; wave-driver + quiescence suites green
unchanged; no new commands/surfaces.
