# #132 BLUE-TEAM BRIEF — attack the wave-observability red-first suite

You are the **blue team** for the wave-observability suite. Target: NOT the contract — the
SUITE's ability to keep a dishonest or shallow implementation red. Read fully, in order:
(1) `wave-observability-contract.md` (v1.1); (2) `contract-fold.md` (B1-B3 + F1-F8 + §4 drift);
(3) `impl/test/wave-observability-red.test.mjs` (26 tests: 4 green PINs, 22 red at named
stages); (4) `suite-draft-notes.md`.

## Attack axes (per row)

- **Shallow-greenability** — could an implementation pass WITHOUT the capability? Sharpened for
  this lane: A1 rows — could the verbs be admitted by adding definition entries (breaking the
  byte-stable law in a way A1-7 doesn't catch — does A1-7 pin the FULL key set or a subset)?
  A2 rows — could the registry be an in-memory map that a replay can't rebuild (the B2 legacy
  gate must be exercised by a REAL legacy record, not a synthetic object)? A1-6 — could the card
  list be special-cased rather than derived? D5 — does the typed refusal fire on all three
  surfaces with the SAME {code,message} payload, or could a surface degrade silently?
- **Oracle weakness** — assertions that pass for right AND wrong behavior; name the row.
- **Missing-row gaps** — every v1.1 refusal code; the exactly-once-on-attach leg; the
  bare-`waves attach` discovery list; the `wave_not_found` allowlist row (F8); the
  per-member `runId` envelope validation.
- **Stage honesty** — every red row fails at its NAMED stage at HEAD, not earlier/later.
- **Hermeticity** — the A2 registry rows touch a real coordination store: tmp dirs only,
  test.after cleanup, no cross-test bleed; the #7 flake class is the warning.

## Output + laws

`docs/reference/evidence/wave-observability-2026-08-06/suite-blueteam.md`: BLUE-CLEAN or
NEEDS-FOLD with numbered findings (row/gap + attack + concrete fix). Edit ONLY that file. No
clocks; citations verified (`grep -an`/`sed -n` on the two NUL files); run the suite twice from
the repo root and record both splits before claiming stage honesty.
