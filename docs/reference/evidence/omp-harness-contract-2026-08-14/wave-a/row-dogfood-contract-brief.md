# ROW BRIEF — row-dogfood-contract: the cutover-by-measurement contract

Deliverable: contract-dogfood-cutover.md — normative (no implementation).

## Ground to read first

- The v19→v20 re-seat precedent (measured deaths → re-seat, commits 8f0c1121/093da603).
- The #221 rip-out pattern (measured limit → mechanism removal).
- docs/handoff/2026-08-14-v20-state.md (fleet operations context).
- Issue #228 (the direction).

## The contract must specify (closed, testable)

1. The dogfood wave shape: one real pack fired twice — omp seat vs claude-compat seat —
   same brief, disjoint worktrees (the #200 namespace law).
2. The measurement axes: member death rate, start latency, cause-cert coverage (#225's
   fields present per terminal), tool-call throughput, deliverable quality (suite green at
   row HEAD), wall time to settle.
3. The cutover rule: re-seat per measured axis with a stated threshold; compat retirement
   only when the measured rate says so (never fiat).
4. The rollback: any axis regressing past its threshold re-seats compat — named, reversible.
5. Honest control: same provider keys, same time-of-day window class, same pack content —
   the measurement isolates the HARNESS variable.

## Hard bounds
Contract only; thresholds are named numbers or derivation rules; no clocks; cite evidence.
