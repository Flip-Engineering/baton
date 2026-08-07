# #67 SUITE BRIEF — red-first suite for the folded stall-watchdog contract v1.1

You are drafting the **red-first acceptance suite** for the folded stall-watchdog contract. Read
fully, in order: (1) `stall-watchdog-contract.md` (**v1.1** — source of truth); (2)
`contract-fold.md` (the 9 blocker resolutions — especially Blocker 5's in-flight-turn liveness
gate and the D2 REARM set/feed/actor re-specification); (3) `contract-redteam.md` (the attack
surface); (4) idioms: `impl/test/trust-gate-steering-red.test.mjs` (the steering cycle's own
suite) and `impl/test/phase56-drain-and-close.test.mjs` (drain/close machinery).

## Coverage (from the v1.1 acceptance pins)

- **D1 decoupling** — a stall budget >= the wall budget refuses at ADMISSION (named code); the
  disclosure reads what the budget measures.
- **D2 evidence re-arm** — the re-arming event classes by name; the chatty-idler class (note
  cycling, no-op diffs, same-digest re-sends, orchestrator self-dealing) NEVER re-arms; the
  in-flight-turn liveness gate (a live turn re-arms without declaring; a stalled turn with no
  in-flight evidence is watched).
- **The control-law line** — a slow-but-productive worker (a long in-flight turn with provider
  activity) is NEVER declared stalled; no bound fires on elapsed time without an evidence check
  (the row that kills the 25-minute-compile-reap class forever).
- **D3 blocked-status** — a worker parked on a blocking interaction reads honestly under the
  folded blockedInteraction surface; whose-stall is attributed (orchestrator vs worker); the
  null-deadline default composes with legitimate operator-await.
- **D4 kill ladder** — escalate → claim/nudge → reap in enforced order, every step receipted; a
  claim-answer without progress evidence does NOT reset the ladder (claim-then-idle dies);
  per-stall-lifetime dedup.
- **Refusals/observability** — every code the contract names, typed, surface-constant.

## Suite law

Red-first (every capability row fails at a NAMED stage at HEAD); namespace imports for invented
surfaces; hermetic (mock adapters, mkdtemp, test.after, no network); run TWICE from the repo
root, record the stable split; header carries the row inventory + stages + invented signatures +
verified split; sorted-key literals ACTUAL order; `localeCompare` banned; NUL discipline
(`grep -an`/`sed -n` on the two NUL files). **The suite itself must honor the control law in its
own machinery: fake timers are fine (they are test doubles, not workflow controls); no row may
assert a wall-clock behavior of the fleet.**

## Deliverables (edit ONLY these)

`impl/test/stall-watchdog-red.test.mjs` ·
`docs/reference/evidence/stall-watchdog-2026-08-07/suite-draft-notes.md`.
