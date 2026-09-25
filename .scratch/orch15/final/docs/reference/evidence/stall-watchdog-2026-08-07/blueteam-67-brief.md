# #67 BLUE-TEAM BRIEF — attack the stall-watchdog red-first suite

You are the **blue team** for the stall-watchdog suite. Target: NOT the contract — the SUITE's
red-keeping power. Read fully, in order: (1) `stall-watchdog-contract.md` (v1.1); (2)
`contract-fold.md` (the 9 blocker resolutions); (3) `impl/test/stall-watchdog-red.test.mjs` (23
tests: 6 green PINs, 17 red at named stages); (4) `suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? Fixtures that can't mint the needed state (a paused task mid-steering-cycle,
  an in-flight turn, a blocked worker) or rows contradicting the folded contract.
- **Shallow-greenability** — sharpened for this lane: could an implementation pass the re-arm
  rows with an any-event re-arm wearing an evidence costume (the ORIGINAL bug re-dressed)? Could
  the in-flight-turn gate pass via a flag that never clears (a zombie turn holding liveness
  forever — the mirror image of the stall bug)? Could the kill-ladder rows pass with steps
  receipted but out of order? Could the claim-then-idle row pass with per-cycle (not
  per-stall-lifetime) dedup?
- **The control-law rows** — is C3 (slow-but-productive) actually discriminating (would a
  naive timer-only implementation fail it)? Is there a row where a bound fires on pure elapsed
  time and the suite FAILS to catch it?
- **Missing-row gaps** — every v1.1 refusal code (watchdog_stall_exceeds_wall and the rest);
  the whose-stall attribution both directions; the #105 escalation composition; the
  per-stall-lifetime dedup durability across a driver restart.
- **Stage honesty + hermeticity** — every red row fails at its NAMED stage at HEAD; fake timers
  are test doubles (fine) but no row may depend on REAL wall time (the #7 flake class).

## Output + laws

`docs/reference/evidence/stall-watchdog-2026-08-07/suite-blueteam.md`: BLUE-CLEAN or NEEDS-FOLD
with numbered findings (row/gap + attack + concrete fix). Edit ONLY that file. No clocks;
citations verified (`grep -an`/`sed -n` on the two NUL files); run the suite twice from the repo
root and record both splits before claiming stage honesty.
