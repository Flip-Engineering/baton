# #114 BLUE-TEAM BRIEF — attack the folded red-first suite (shallow-greenability hunt)

You are the **blue team** for the folded workflow-as-data suite. Your target is NOT the contract —
it is the SUITE's ability to keep a dishonest or shallow implementation red. Read fully, in order:
(1) `workflow-as-data-contract.md` (v1.1 — the folded contract); (2) `contract-fold.md` (what
changed and why); (3) `impl/test/workflow-as-data-red.test.mjs` (25 tests: 4 green guards, 21 red
at named stages); (4) `suite-draft-notes.md` (the row map + invented surfaces).

## Attack every red row on these axes

- **Shallow-greenability** — could an implementation make the row pass WITHOUT the named
  capability? (e.g. W4 rows: could a harvest that ignores the authoritative sha and greps pins
  still pass? W3-bounds rows: could a retry bound implemented as a counter in the wrong layer —
  driver-side instead of interpreter-side — pass the row but violate the contract? W6-02: could
  the five codes be added to the allowlist yet still degrade elsewhere?)
- **Oracle weakness** — is the assertion actually discriminating? (a row that passes for both the
  right and the wrong behavior is a false red; name the row and the ambiguity)
- **Missing-row gaps** — what v1.1 promise has NO row? (check every refusal code in the contract's
  vocabulary, every D-numbered decision's observable consequence, the waves run / baton_waves_run
  verb naming from the open-question fold — is there a row pinning the plural name on CLI+MCP?)
- **Stage honesty** — does every row fail at its NAMED stage at HEAD, or do some fail earlier/later
  (a row failing for the wrong reason today will surprise the implementer tomorrow)?
- **Hermeticity + determinism** — any row that could flake (real timers, real git state, real
  network, order-dependence)? The campaign's flake cluster (#7) is the warning.

## Output

`docs/reference/evidence/wave-as-data-2026-08-06` DOES NOT exist — write
`docs/reference/evidence/workflow-as-data-2026-08-06/suite-blueteam.md`: verdict BLUE-CLEAN or
NEEDS-FOLD, with numbered findings (each: row or gap + the attack + the concrete suite fix).
Edit ONLY that file. Laws: no clocks; citations verified (`grep -an`/`sed -n` on the two NUL
files); run the suite twice from the repo root and record both splits before claiming stage
honesty.
