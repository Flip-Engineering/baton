# #103 BLUE-TEAM BRIEF — attack the briefing-pack red-first suite (shallow-greenability hunt)

You are the **blue team** for the briefing-pack suite. Your target is NOT the contract — it is
the SUITE's ability to keep a dishonest or shallow implementation red. Read fully, in order:
(1) `briefing-pack-contract.md` (v1.1); (2) `contract-fold.md` (B1-B5 + N1-N5 resolutions);
(3) `impl/test/briefing-pack-red.test.mjs` (19 tests: 3 green PIN rows, 16 red at named stages);
(4) `suite-draft-notes.md` (row map + measured split).

## Attack every red row on these axes

- **Shallow-greenability** — could an implementation pass a row WITHOUT the named capability?
  (R-D9a: could a wave.closed record minted at the wrong site — not the guaranteed post-close
  window — still pass? R-A5a/A5b: could epochLag be computed from wall-clock instead of ledger
  event seq and pass the rows while violating the no-clocks law? R-A6: could the authority check
  key on the wrong principal field? R-N2a/N2b: could the short-circuit key on a hash of the body
  alone and pass while breaking the validity leg?)
- **Oracle weakness** — assertions that pass for both right and wrong behavior; name the row and
  the ambiguity.
- **Missing-row gaps** — v1.1 promises with NO row: check every refusal code the contract names
  (wave_already_closed, context_pack_forbidden, briefing_pack_unavailable, briefing_pack_overflow,
  …), the D9 honesty rules (replay-derived, non-gating), the D6(b) doctor-JSON additive-field
  render vs any text render, the D1 field→store-source table's completeness.
- **Stage honesty** — does every red row fail at its NAMED stage at HEAD, or do some fail
  earlier/later (wrong-reason reds surprise the implementer)?
- **Hermeticity + determinism** — real timers, real git state, order dependence, the #7 flake
  class. The suite runs in the canonical gate beside 3,400+ other tests; a flake here poisons the
  whole gate.

## Output

`docs/reference/evidence/briefing-pack-2026-08-06/suite-blueteam.md`: verdict BLUE-CLEAN or
NEEDS-FOLD, numbered findings (each: row or gap + the attack + the concrete suite fix). Edit ONLY
that file. Laws: no clocks; citations verified (`grep -an`/`sed -n` on the two NUL files); run the
suite twice from the repo root and record both splits before claiming stage honesty.
