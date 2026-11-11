# EVAL-R0 PRE-REGISTRATION — committed before the run (issue #107)

*Date: 2026-08-07. Author: kimi (orchestrator). Status: PRE-REGISTERED — the pivot criterion below
is committed before any arm runs. Editing it after the run starts invalidates the eval.*
*Companion: `eval-scoping.md` (the scoping memo); issue #107; docs/14:47's replay-harness demand
is #125 (a precondition note, §6).*

## 1. The question

Does the baton hub (waves + steering + settlement + trust gate) beat a for-loop **for the
red-first implementation task class** at current maturity? Falsifiable either way — the first
honest number the project has produced (design-corpus delta 4; M0/M1/E2 pending at docs/28:560-561).

## 2. The five rungs (bases verified 2026-08-07 against git history)

| Rung | Impl commit | Base (pre-impl) | Suite at base? | Grading suite |
|---|---|---|---|---|
| #64 trust-gate steering | `ac5bd80` (deepseek, 47min one-shot) | `2f2d23b` (suite v1.2 + blue-team re-verify) | **PRESENT** (`trust-gate-steering-red.test.mjs`) | the same suite, zero weakening |
| #63 KG settlement | `e0f9d57` (opus, harvested after a capacity kill) | `2e22197` (suite blue-team re-verify GATE-READY) | **PRESENT** (`kg-settlement-red.test.mjs`) | same |
| S-1 v2 wave grammar | `480154a` (grok, RC-A dogfood) | `3733096` | **ABSENT — born in the impl commit**; the final suite is PLANTED from `480154a` onto the base | `wave-grammar-red.test.mjs` @ `480154a`, zero weakening |
| DG-1 diagnostics v2 | `6d0ca11` (grok) | `47993f7` | **ABSENT — born in the impl commit**; planted from `6d0ca11` | `diagnostics-red.test.mjs` @ `6d0ca11`, zero weakening |
| M5 alias sunset | `bb85e35` (deepseek, re-seated) | `bbf6791` | **ABSENT — born in the impl commit**; planted from `bb85e35` | `grammar-m5-red.test.mjs` @ `bb85e35`, zero weakening |

**The two suite modes (honest):** rungs whose red-first suite predates the impl in git (#64,
#63) re-drive from the raw base; rungs whose suite was committed WITH the impl (S-1, DG-1, M5 —
the earlier, pre-strict-methodology era) use base + planted-final-suite. Both modes are red at
the base by construction (verify: each base+plant must show the suite RED before any arm runs —
record the red split per rung as the eval's t0 evidence).

**Base-tree hygiene:** each arm runs from a worktree at the base commit; the era-appropriate
route availability is reconstructed (deepseek-v4-flash@high on the Claude-Code-harness
integration per the deepseek quick-start — the same route class the landed impls used).

## 3. The two arms

- **SOLO (the for-loop arm):** one member, one task, the rung's final suite as the pinned
  verification; steering/finalization/settlement all `'none'`; no nudges, no claims, no
  settlement ritual. The worker gets the same brief-content the landed impl's worker got (from
  the era's brief/manifest where recoverable; otherwise the contract's own task statement).
- **DRIVEN (the campaign cadence):** the current `implementContract` wave-driver cadence —
  approve-on-advertised-plan, nudge-on-checkpoint, claim-on-stall, settlement ritual, trust-gate
  verification. Same brief content, same grading suite, same route.

## 4. Measurement (the sealed CairnRunScorecard per arm per rung)

verified-rate (suite green at the pinned split) · wall ms · tokens/USD (routed) · interventions
byKind/byActor (nudges, claims, approvals, re-seats) · exact route · the pin sha. The scorecard
is content-addressed and reverifiable; R0a's retrospective (`d9f839a`) is the format precedent.

## 5. THE PRE-REGISTERED PIVOT CRITERION (M1's halt rule)

> **If fleet ≤ solo on verified pass-rate AND fleet > 1.5× solo on wall-clock — across the five
> rungs' aggregate — the hub loses at current maturity and we say so, in the report, with the
> numbers.** A split decision (better pass-rate at worse cost, or vice versa) is reported as a
> split with the per-rung table, not rounded to a win.

## 6. Preconditions (checked before the first arm)

- **Replay-harness note (#125):** arms are not byte-replayable (no tool-result snapshots yet);
  the honesty posture is that both arms face the same live-environment noise, and any arm that
  dies from infrastructure (401s, capacity) is re-seated once and recorded — never counted a
  failure of the arm. (The full replay harness remains the R1 precondition.)
- **Scorecard verification:** the scoreboard projection must be verified against one known-good
  landed rung (recompute the #64 landing from its pin and match the recorded fields) BEFORE the
  first arm.
- **Red-at-base evidence:** §2's t0 splits recorded per rung.

## 7. Cost + seat plan

10 waves × ~45–60 min ≈ one calendar day at 3-wide on deepseek-v4-flash@high (low-two-figures
USD). Sequenced AFTER the current impl serialization (#114 → #99 → #12 → #102 → #103 → #132 →
#105) drains, or interleaved in seat gaps only if the operator directs.
