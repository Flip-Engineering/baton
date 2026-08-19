# NOTES — row-stall-break (wave-f)

[attempt: a57dcd9d-39c8-4590-8499-1345e2d08b43 row-stall-break]

Row deliverable: the wave-level stall window is DERIVED from the wave's own observed
marker-advance cadence — max(2x maxObservedGapMs, 8x pollIntervalMs), the same derivation the
quiescence quiet window uses — plus the red-first pin suite. #163 law is the contract
(issue #163; landed quiescence 8ec52a6c / workflow-interpreter.mjs QUIESCENCE_MIN_SILENT_POLLS).

## Changes (all in-scope)

- impl/src/wave-driver.mjs — additive hunks only:
  - DEFAULT_POLICY.stallTimeoutMs: `20 * 60_000` (FIXED) → `null` = DERIVE. The fatal window at
    the D4 break is now `policy.stallTimeoutMs ?? max(2x maxObservedGapMs, 8x pollIntervalMs)`.
  - freezePolicy: a PINNED stallTimeoutMs is still validated as a positive integer (back-compat);
    `null`/omitted opts into the derived default.
  - Cadence tracking: every wave-level marker ADVANCE (lastMarkerAt move) closes the previous
    poll-to-poll gap; the max gap across the drive feeds the derivation. One live member's digest
    change moves the marker (L5), so the gap is the wave's own cadence.
  - Terminal semantics byte-stable: same bases (stall / claim-on-stall), same receipt shape, same
    L6 unproductivity budget, no new event kinds, no new commands/surfaces.
- impl/test/wave-driver-stall-derived-red.test.mjs — the red-first pin suite (7 rows).
- docs/reference/evidence/no-clock-followons-2026-08-15/wave-f/** — canonical wave-f wavefile +
  briefs restored (they exist on the sibling branch 5c3662b7 but not on this worktree's HEAD),
  plus this notes report.

## Red-first evidence (measured)

Pre-change head (wave-driver.mjs reverted to HEAD via checkout/apply round-trip — no stash):

    ✖ R1 slow-cadence-wave-breaks-at-old-default   (25-min gaps; fixed 20-min default fires)
    ✖ R2 frozen-wave-never-derives                 (fixed default never fires in test time)
    ✖ R3 cadence-window-never-derives              (same)
    ✖ R5 claim-fan-out-never-derives               (same)
    ✖ R7 null-sentinel-refused                     (explicit null refused by old validation)
    ✔ R4 pinned-stallTimeoutMs-honored             (PIN row — green both heads)
    ✔ R6 invalid-pinned-values-refuse              (PIN row — green both heads)

Post-change head (this worktree): 7/7 pass.

    ✔ R1/R2/R3/R5/R7 GREEN; R4/R6 PIN rows stay green.

Suite evidence (post-change): wave-driver-red + wave-driver-policy-red + quiescence-activity-red
all green; quiescence-completion-red 15/15 on repeated runs.

## Judgment calls (recorded)

1. Authority class: the Path scope header lists only `impl/src/wave-driver.mjs` and
   `docs/.../wave-f/**`, but contract item 3 (closed) names the pin file explicitly at
   `impl/test/wave-driver-stall-derived-red.test.mjs` and the deliverable line requires the
   "red-first pin suite". The contract's named test location was treated as the required
   deliverable path (the closed contract binds over the abridged scope list). If the harness
   intended the pin elsewhere, this is the single ambiguity — flagged rather than guessed around.
2. Time scaling for the slow-cadence pin: the 20-min old-default boundary cannot be reached with
   real wall time. R1 mocks ONLY Date (`t.mock.timers { apis: ['Date'] }`) while real timers keep
   the poll cadence — the driver's marker gaps read the mocked clock, so the observed 25-min
   cadence and the 20-min boundary are exact fake-time distances ("scaled into test time via poll
   overrides" as the brief permits). The fake clock never asserts wall-time behavior of the fleet.
3. The cursor-stripped fixture views carry `cursor: null` so waitForWake takes the plain
   real-sleep path — the follow/followOnce wake laws are the sibling suites' domain; the row
   under test is the stall-window derivation. (A cursor-carrying view spins the follow loop
   against a static mocked Date; that is why the fixture omits the cursor.)
4. Explicit `stallTimeoutMs: null` is accepted as the derived sentinel (R7, RED at pre-change
   head because the old closed-set validation refused it). Omission was already valid at both
   heads; R1-R3/R5 use omission so the default path is what they pin.
5. Out-of-scope doc drift observed, NOT edited (outside Path scope): docs/37-wave-driver.md:72
   still documents `stallTimeoutMs | 20 * 60_000` as the default, and
   impl/src/application-semantics.mjs:45-46 cites "wave-driver.mjs stallTimeoutMs = 20 min".
   Both describe the retired fixed default; the derived default is ≥ 8x pollIntervalMs and grows
   with observed cadence. Flagged for a follow-on docs row; no conformance suite pins either line.

## Operational note

A pre-existing stash (`stash@{0} row-cadence-wip`) was accidentally popped while preparing the
red-first revert (a failed pathspec left the pop unconditional). Recovered with `git reset --hard
HEAD` (the stash entry was kept, untouched) and the wave-driver hunks were re-applied; the final
diff was re-verified byte-for-byte against the pre-incident diff before re-running the suites.

## Pre-existing flake observed (not caused by this row)

quiescence-completion-red.test.mjs R5 (hard-break survivor harvest) failed once at clean HEAD and
once with this change under parallel load, and passed 3/3 standalone both ways. It drives
workflow-interpreter.mjs (untouched by this row — its own pinned driver); the row's own comment
documents earlier load-sensitive amendments. No wave-driver code path reaches it.
