# ROW EVIDENCE — row-stall-break: the wave-level stall window derives from observed cadence

[attempt: 65fd1578-0c44-4f81-a2e2-2701900a3ec8 row-stall-break]

Date: 2026-08-18. Worktree HEAD: fc9733ff. Authority: the row brief (this wave, wave-h) +
issue #163 (no-clocks law) + the landed quiescence derivation (commit 8ec52a6c,
`workflow-interpreter.mjs` `QUIESCENCE_MIN_SILENT_POLLS`).

## Contract (from the brief, closed)

1. The stall window becomes DERIVED: max(2x maxObservedGapMs, 8x pollIntervalMs) from the
   wave's own observed marker-advance cadence (the poll-to-poll gaps between lastMarkerAt
   moves). An explicit policy pin stays authoritative (back-compat); the derived value
   replaces only the fixed production DEFAULT.
2. Terminal semantics byte-stable: same bases (stall / claim-on-stall), same receipts, same
   L6 unproductivity budget. No new event kinds.
3. Red-first pin suite `impl/test/wave-driver-stall-derived-red.test.mjs`: a wave whose
   markers advance slower than 20 min must NOT break at the old fixed default — RED at
   pre-change head, GREEN after.

## Implementation (additive hunks, in scope impl/src/**, impl/test/**, wave-h evidence dir)

- `impl/src/wave-driver.mjs`
  - `DEFAULT_POLICY.stallTimeoutMs`: `20 * 60_000` → `null` (the derive sentinel). The
    retired 20-minute constant is gone from the production default; the closed policy field
    set (`POLICY_FIELDS`) is unchanged — no new surfaces.
  - `freezePolicy`: an absent/`undefined` `stallTimeoutMs` normalizes to `null`; only an
    explicitly pinned numeric value is validated (`assertInteger`) and honored.
  - `run()`: `let maxObservedGapMs = 0` beside `lastMarkerAt`; at each marker advance the gap
    since the prior advance feeds `maxObservedGapMs` (L5 wave-level marker unchanged — one
    live member resets the clock for all).
  - The break (`:774`): `const stallWindowMs = policy.stallTimeoutMs ?? Math.max(2 * maxObservedGapMs, 8 * policy.pollIntervalMs)` — the same shape as the quiescence quiet window.
- `impl/src/recipes.mjs` (judgment call 1, below): `DEFAULT_RECIPE_POLICY` and
  `IMPLEMENT_DEFAULT_POLICY` no longer carry the fixed 20-minute `stallTimeoutMs`, so the
  recipe lane (the production `baton.recipes` surface, including the `implementContract`
  preset) reaches the driver's derived default; `admitPolicy` validates `stallTimeoutMs`
  only when a recipe explicitly pins it. `POLICY_FIELDS` (the closed recipe allowlist) is
  unchanged.
- `impl/src/application-semantics.mjs`: stale comment ("stallTimeoutMs = 20 min") corrected
  to name the derived default (comment-only).

## Judgment calls (recorded per the dispatch rules)

1. **Recipes lane aligned.** The brief anchors only wave-driver.mjs, but the recipe defaults
   are documented as mirroring "createWaveDriver's documented production cadence" and feed
   every unpinned production recipe run. Leaving them at the fixed 20-minute pin would keep
   the fixed window on the primary production wave surface, defeating the row's goal. The
   recipe defaults now defer to the driver's derivation; explicit recipe pins are untouched
   (the recipe RED rows pin `stallTimeoutMs: 5_000` — verified green). The recipe digest is
   runtime-computed (RC-5 asserts stability between two runs of the same code), so it is
   unaffected.
2. **The red test cannot use a compressed clock; it uses the real clock + abort-based RED.**
   The derivation formula mixes the driver's wall clock (gap terms) with the policy constant
   `8 x pollIntervalMs`. Those share units only in real time. A decoupled/compressed clock
   (the quiescence suite's fixture idiom) is impossible here: with a scaled `Date.now()` the
   floor term becomes ~375x smaller than one poll of fake silence and fires spuriously on the
   first poll, preempting the cadence ramp (observed directly: the first fixture attempt
   stalled after 1 advance). The quiescence fixture works because its cadence comes from
   injected view timestamps in real-ms units; the wave driver's cadence is its own clock.
   Therefore: the pin drives the driver's REAL clock and scales the wave's cadence into test
   time via the poll override (a 5-poll marker cadence at a 20 ms poll); at pre-change head
   the fixed 20-minute default cannot fire the stall inside a test, so the run is bounded by
   an observation window + abort signal and R1 asserts the run resolved with a stall basis —
   RED at pre-change head (aborted basis), GREEN after (stall at 2x the observed cadence).
   All assertions are ratios/bounds on the same real clock the driver uses, so load stretches
   both sides together.
3. **P1 pin value.** The back-compat pin row pins `stallTimeoutMs: 140` (ms) — below the
   derived 2x-cadence window (~200 ms) so a derive-always impl is caught — and asserts the
   stall fired at the pin, not the derived window. The `max(pin, floor)` anti-pattern is not
   separately discriminated (pin 140 < floor 160; distinguishing would need a sub-poll margin
   that is jitter-fragile); the contract clause pinned is "pins stay authoritative".

## Verification (execution contract of the brief)

- RED at pre-change head (source stashed, test present): R1 fails — `stage[derived-window-missing]`:
  "the run did not resolve with a stall basis inside the observation window … (aborted basis
  'aborted')". P1 (pin) is green at both heads by design.
- GREEN after change: `node --test impl/test/wave-driver-stall-derived-red.test.mjs` → 2/2 pass
  (R1 672 ms, P1 590 ms). R1's stall fired at 2x the observed cadence; assertions:
  basis 'stall', 5/5 advances observed, silence >= 2x cadence, silence < 6x cadence,
  zero claims/nudges.
- Battery with the change (12 files: wave-driver-red, wave-driver-policy-red,
  wave-driver-stall-derived-red, quiescence-completion-red, quiescence-activity-red,
  recipes-red, claim-preflight-red, issue10-waiting-vocabulary-red, bidirectional-driver-red,
  briefing-pack-red, kg-settlement-red, frame-economics-red): 233 tests, 230 pass, 3 fail —
  the identical 3 fail at clean pre-change head (F1 briefing-pack static scan — passes in
  isolation, load-flaky; KS5 kg-settlement exactly-once re-drive; R5 quiescence survivor
  harvest). Pre-existing at this head, unrelated to this row; the wave-driver and quiescence
  suites are green UNCHANGED by this row.
- 10-file follow-up battery (workflow-as-data, waves-run-detach, wire-settle-detach,
  worker-orchestrated-swarm, workflow-dsl, workflow-dsl-package, readiness-credentials,
  readiness-honesty, stall-watchdog, launch-validation): every file passes in isolation except
  readiness-honesty (8/9) and launch-validation (3/9) — byte-identical at clean head
  (in-flight red rows from other waves, not this row).

## Environment note (dispatch rules — reported, not repaired)

A sibling wave is active in this worktree (death-certs, issue #225): `claude-session.mjs`,
`coordinator.mjs`, `omp-rpc.mjs` carry its in-flight edits (mtimes 23:29:06). Its
`coordinator.mjs` currently imports `./death-cert.mjs`, which does not exist in the worktree
yet, so every suite importing coordinator.mjs fails at module load in the CURRENT instant.
All verification above that depends on those suites ran BEFORE that edit landed, against the
same change set; the pin suite imports wave-driver.mjs directly and was re-verified green
after re-application. The sibling's work was reverted my source edits once (via a worktree
reset it performed); the edits were re-applied verbatim and re-verified. No files outside the
assigned scope were touched.
