# row-stall-break notes — [attempt: 61ae1180-6c7a-48e9-b097-7fc212ec5f3e row-stall-break]

Deliverable: implementation + red-first pin suite. The #163 law is the contract (issue and
the landed quiescence work, 8ec52a6c). Row brief: the sibling dispatch in this directory
(wave-g/row-stall-break-brief.md, byte-identical to the wave-f canonical).

## What landed

- `impl/src/wave-driver.mjs` (additive hunks only):
  - `DEFAULT_POLICY.stallTimeoutMs` is no longer the fixed `20 * 60_000` production default —
    it is `null`, the DERIVED sentinel (contract 1). An explicit policy-pinned `stallTimeoutMs`
    still wins (back-compat; the closed field set and every existing suite are untouched).
  - `freezePolicy` validates a PINNED `stallTimeoutMs` as a positive safe integer exactly as
    before; `null`/omitted opts into the derived window (the sentinel's value domain extends by
    "no fixed window", coherent with the `??` fallback at the break).
  - The driver now tracks the wave's OWN observed marker-advance cadence: each L5 marker move
    samples the poll-to-poll gap since the previous `lastMarkerAt`, keeping `maxObservedGapMs`
    (one live member's digest change moves the wave-level marker, so the gap is the wave's
    own cadence — L5 unchanged).
  - The fatal stall check uses
    `stallWindowMs = policy.stallTimeoutMs ?? Math.max(2 * maxObservedGapMs, STALL_WINDOW_MIN_SILENT_POLLS * policy.pollIntervalMs)` —
    the exact quiescence quiet-window derivation shape, with the named
    `STALL_WINDOW_MIN_SILENT_POLLS = 8` mirroring `QUIESCENCE_MIN_SILENT_POLLS`.
- `impl/test/wave-driver-stall-derived-red.test.mjs` (new pin suite, 6 rows):
  - S1 (RED at pre-change head): a wave whose marker advances on a cadence SLOWER than the old
    fixed default's equivalent ("25 min" = 7-poll gaps ≈ 105 ms vs the old default's "20 min"
    ≈ 84 ms, scaled into test time via the poll override) is NOT broken at the old-default-
    equivalent point — it stalls only at ≈ 2x its own cadence (~210 ms) after its marker
    freezes. Cross-scenario ordering with a floor-bound fast control (2-poll gaps) kills any
    fixed-constant window.
  - S2 (green at BOTH heads — preservation guardrail): an explicit pinned `stallTimeoutMs`
    still wins over the derivation (150 ms pinned vs the derived 210 ms).
  - S3 (RED at pre-change head): the claim-on-stall fan-out fires at the DERIVED window with
    the same terminal semantics — every paused member claimed exactly once, basis 'completed'
    (D9 shape, byte-stable).
  - S4 (green at BOTH heads — preservation guardrail): stall-timeout validation stays closed —
    a pinned value must be a positive safe integer.
  - S5 (RED at pre-change head): an explicit `stallTimeoutMs: null` opts into the derived
    window (pre-change the closed-set validation refused it).
  - static (RED at pre-change head): the fixed production DEFAULT literal is gone;
    `maxObservedGapMs`, the named floor, and the pin-vs-derived precedence exist.
- Evidence: this notes file (the wavefile harvest requires the verbatim attempt line above)
  plus the restored canonical wave-g pack (coordinator-brief, impl-no-clock-followons.wavefile,
  row-cadence-brief, row-stall-break-brief — restored from the wave-g docs commit 24f4a0b5,
  absent from this worktree's HEAD, the wave-f precedent).

## Terminal semantics (contract 2) — byte-stable

Same bases (`stall` / claim-on-stall recovery to `completed`), same receipts (no added or
changed receipt fields — the receipt construction is untouched), same L6 unproductivity
budget, same nudge/claim evidence shapes, no new event kinds, no new commands, no new policy
fields (the closed set is unchanged — `stallTimeoutMs` was already a member). The only
behavior change is the UNPINNED default window: fixed 20 minutes → cadence-derived.

## Red-first verification (exact runs, this worktree)

| Check | Command | Result |
|---|---|---|
| GREEN at head | `node --test test/wave-driver-stall-derived-red.test.mjs` | 6/6 pass |
| RED at pre-change head (driver swapped to `HEAD:impl/src/wave-driver.mjs` via patch round-trip) | same | 2/6 pass: S1 aborted≠stall, S3 aborted≠completed, S5 validation refused null, static (fixed default present); S2/S4 pass (PIN guardrails) |
| wave-driver suites | `node --test test/wave-driver-red.test.mjs test/wave-driver-policy-red.test.mjs` | 21/21 pass |
| quiescence standalone | `node --test test/quiescence-completion-red.test.mjs` | 15/15 pass |
| quiescence activity | `node --test test/quiescence-activity-red.test.mjs` | 1/1 pass |
| other createWaveDriver consumers | `node --test test/claim-preflight-red.test.mjs test/issue10-waiting-vocabulary-red.test.mjs test/bidirectional-driver-red.test.mjs test/workflow-as-data-red.test.mjs` | 114/114 pass |
| fixture-clock-lint | `node scripts/fixture-clock-lint.mjs` | clean |

## Judgment calls (recorded)

1. **Authority class — the pin file path.** The Path scope header lists only
   `impl/src/wave-driver.mjs` and `docs/.../wave-g/**`, but contract item 3 (closed) names the
   pin file explicitly at `impl/test/wave-driver-stall-derived-red.test.mjs` and the deliverable
   line requires the "red-first pin suite". The contract's named test location was treated as the
   required deliverable path (the closed contract binds over the abridged scope list) — the same
   call the wave-e/wave-f attempts recorded.
2. **The floor cold-start law** (the quiescence derivation's own shape): the window is
   `8 * pollIntervalMs` until the wave's first full marker gap is observed, so a cadence slower
   than 8 polls can never be learned (the floor fires first). The slow scenario is placed at
   G = 7 polls — inside (4P, 8P) — so the first gap completes inside the initial floor window
   AND the cadence term binds (2G > 8P). The test documents this; production waves whose markers
   move slower than 8 polls on FIRST contact would hit the floor (the same cold-start bound the
   quiescence quiet window has) — the derivation governs once a cadence is observed.
3. **The "25 min / 20 min" scale is arbitrary and relative** (the brief's "scaled into test
   time via poll overrides"): the test defines 7 polls ≈ "25 min" (scale ≈ 4.2 ms/min) and the
   old default's equivalent "20 min" ≈ 84 ms. What is pinned is the RELATIONSHIP: cadence slower
   than the old default's assumption ⇒ the wave must not break at that equivalent point; the
   derived window is ~2x the cadence; the cross-scenario ordering kills any fixed constant
   (including the pre-change 20-minute REAL default, which never fires inside the bound → the
   run aborts → RED).
4. **`stallTimeoutMs: null` is the derived sentinel.** The DEFAULT carries it and an explicit
   `null` from a caller means the same thing (R7-style pin S5). `??` at the break already treated
   null as absent, so the validation accepting it is the coherent reading; a pinned positive
   integer is still validated exactly as before (S4). Omission was valid at both heads; S1/S3/S5
   use the unpinned default path.
5. **Pre-existing HEAD failure is not this row's**: the quiescence-completion R5 batch failure
   (hard-break survivor-harvest race) reproduces 1/1 in the 2-file batch at PRE-CHANGE head and
   passes 15/15 standalone — the same load-sensitive flake the wave-e/wave-f attempts recorded.
   It drives workflow-interpreter.mjs (untouched by this row; the quiescence lane pins its own
   driver and never reads `DEFAULT_POLICY`).
6. **Out-of-scope doc drift observed, NOT edited** (outside Path scope): docs/37-wave-driver.md:72
   still documents `stallTimeoutMs | 20 * 60_000` as the default (the hardCapMs retirement left
   the same table stale). Flagged for the coordinator's verify-notes; no conformance suite pins
   the line. `recipes.mjs DEFAULT_RECIPE_POLICY` pins its own `stallTimeoutMs: 20 * 60_000` — an
   EXPLICIT pin (the recipe lane's own closed data policy, out of this row's path scope),
   preserved by contract 1's back-compat clause; it is not the production DEFAULT.

## Contract mapping

1. DERIVED stall window — implemented (cadence tracking + `max(2x maxObservedGapMs, 8x
   pollIntervalMs)`; pinned policy wins; derived value replaces only the fixed production
   DEFAULT). ✅
2. Terminal semantics byte-stable — same bases/receipts/L6 budget, no new event kinds. ✅
3. Red-first pin at `impl/test/wave-driver-stall-derived-red.test.mjs` — slow-cadence wave
   not broken at the old fixed default; RED at pre-change head, GREEN after. ✅
Hard bounds: additive hunks only; no existing suite edited; wave-driver + quiescence suites
green unchanged (quiescence R5 batch race pre-existing, proven at pre-change head); no new
commands/surfaces (policy field set unchanged). ✅
