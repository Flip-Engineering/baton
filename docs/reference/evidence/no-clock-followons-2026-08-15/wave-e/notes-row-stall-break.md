# row-stall-break notes — [attempt: 5884e780-5ba4-493b-a7fd-8b6974b772cb row-stall-break]

Deliverable: implementation + red-first pin suite. The #163 law is the contract (issue and
the landed quiescence work, 8ec52a6c). Row brief: the sibling dispatch in this directory
(wave-d/row-stall-break-brief.md) — this attempt ran under the wave-e path scope.

## What landed

- `impl/src/wave-driver.mjs` (additive hunks only):
  - `DEFAULT_POLICY.stallTimeoutMs` is no longer the fixed `20 * 60_000` production default —
    it is `undefined`, meaning DERIVED (contract 1). An explicit policy-pinned `stallTimeoutMs`
    still wins (back-compat; the closed field set and every existing suite are untouched).
  - The driver now tracks the wave's OWN observed marker-advance cadence: each L5 marker move
    samples the poll-to-poll gap since the previous `lastMarkerAt`, keeping `maxObservedGapMs`.
  - The fatal stall check uses `stallWindowMs = policy.stallTimeoutMs ?? Math.max(2 * maxObservedGapMs, STALL_WINDOW_MIN_SILENT_POLLS * policy.pollIntervalMs)` —
    the exact quiescence quiet-window derivation shape, with `STALL_WINDOW_MIN_SILENT_POLLS = 8`
    mirroring `QUIESCENCE_MIN_SILENT_POLLS`.
- `impl/test/wave-driver-stall-derived-red.test.mjs` (new pin suite, 4 rows):
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
  - static (RED at pre-change head): the fixed production DEFAULT literal is gone;
    `maxObservedGapMs`, the named floor, and the pin-vs-derived precedence exist.
- Evidence: this notes file (the wavefile harvest requires the verbatim attempt line above).

## Terminal semantics (contract 2) — byte-stable

Same bases (`stall` / claim-on-stall recovery to `completed`), same receipts (no added or
changed receipt fields), same L6 unproductivity budget, same nudge/claim evidence shapes, no
new event kinds, no new commands, no new policy fields (the closed set is unchanged —
`stallTimeoutMs` was already a member). The only behavior change is the UNPINNED default
window: fixed 20 minutes → cadence-derived.

## Red-first verification (exact runs, this worktree)

| Check | Command | Result |
|---|---|---|
| GREEN at head | `node --test test/wave-driver-stall-derived-red.test.mjs` | 4/4 pass |
| RED at pre-change head (driver swapped to `HEAD:impl/src/wave-driver.mjs`) | same | 1/4 pass: S1 aborted≠stall, S3 aborted≠completed, static (fixed default present); S2 passes (guardrail) |
| wave-driver suites | `node --test test/wave-driver-red.test.mjs test/wave-driver-policy-red.test.mjs test/quiescence-completion-red.test.mjs` | wave-driver rows green; sole failure = quiescence R5 survivor-harvest race |
| quiescence standalone | `node --test test/quiescence-completion-red.test.mjs` | 15/15 pass |
| other createWaveDriver consumers | claim-preflight, issue10-waiting-vocabulary, bidirectional-driver, workflow-as-data | 114/114 pass |
| same six consumers (briefing-pack, kg-settlement, frame-economics, readiness-credentials, readiness-honesty, recipes-red) | both heads | 143/154 at BOTH heads — identical 11 failures pre-existing |
| fixture-clock-lint | `node scripts/fixture-clock-lint.mjs` | clean |
| surface conformance | collectSurfaceInventory + classifySurfaces/checkEnumStrings | 0 novel divergences |

## Judgment calls (recorded)

1. **The floor cold-start law** (the quiescence derivation's own shape): the window is
   `8 * pollIntervalMs` until the wave's first full marker gap is observed, so a cadence
   slower than 8 polls can never be learned (the floor fires first). The slow scenario is
   placed at G = 7 polls — inside (4P, 8P) — so the first gap completes inside the initial
   floor window AND the cadence term binds (2G > 8P). The test documents this; production
   waves whose markers move slower than 8 polls on FIRST contact would hit the floor (the
   same cold-start bound the quiescence quiet window has) — the derivation governs once a
   cadence is observed.
2. **The "25 min / 20 min" scale is arbitrary and relative**: the test defines 7 polls ≈
   "25 min" (scale ≈ 4.2 ms/min) and the old default's equivalent "20 min" ≈ 84 ms. What is
   pinned is the RELATIONSHIP: cadence slower than the old default's assumption ⇒ the wave
   must not break at that equivalent point; the derived window is ~2x the cadence; the
   cross-scenario ordering kills any fixed constant (including the pre-change 20-minute
   REAL default, which never fires inside the bound → the run aborts → RED).
3. **Pre-existing HEAD failures are not this row's**: readiness-credentials/readiness-honesty
   (A1a-A6, V-stale), briefing-pack F1, kg-settlement KS5 fail identically at pre-change
   head (11/154, diffed by test name — only KS5's timing parenthetical differs). The
   quiescence R5 batch failure (survivor result-sha race) reproduces 3/3 at pre-change head
   in the same 3-file batch; standalone the suite is 15/15. None touches the stall window
   (the quiescence lane pins its own driver and never reads `DEFAULT_POLICY`).
4. **recipes.mjs `DEFAULT_RECIPE_POLICY` still pins `stallTimeoutMs: 20 * 60_000`** — that is
   an EXPLICIT pin (the recipe lane's own closed data policy, out of this row's path scope),
   preserved by contract 1's back-compat clause; it is not the production DEFAULT.
5. **docs/37-wave-driver.md still lists the old surface** (`stallTimeoutMs | 20 * 60_000`,
   plus the retired `hardCapMs` row) — out of this row's path scope (wave-e/** +
   wave-driver.mjs); the doc lag is pre-existing drift (the hardCapMs retirement left the
   same table stale). Flagged for the coordinator's verify-notes.

## Contract mapping

1. DERIVED stall window — implemented (cadence tracking + `max(2x maxObservedGapMs, 8x
   pollIntervalMs)`; pinned policy wins; derived value replaces only the fixed production
   DEFAULT). ✅
2. Terminal semantics byte-stable — same bases/receipts/L6 budget, no new event kinds. ✅
3. Red-first pin at `impl/test/wave-driver-stall-derived-red.test.mjs` — slow-cadence wave
   not broken at the old fixed default; RED at pre-change head, GREEN after. ✅
Hard bounds: additive hunks only; no existing suite edited; wave-driver + quiescence suites
green unchanged (quiescence R5 batch race pre-existing, proven at pre-change head); no new
commands/surfaces (surface audit 0 novel; policy field set unchanged). ✅
