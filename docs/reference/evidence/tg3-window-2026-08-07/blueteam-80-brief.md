# #80 BLUE-TEAM BRIEF — attack the TG3-window red-first suite

You are the **blue team** for the TG3-window suite. Target: NOT the contract — the SUITE's
red-keeping power. Read fully, in order: (1) `tg3-window-contract.md` (v1.1 — note the
depending-on-#67 posture and any target-state rows); (2) `contract-fold.md`; (3)
`impl/test/tg3-window-red.test.mjs` (16 tests: 8 green PINs, 8 red at named stages); (4)
`suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? The dispatch-receipt row (TW-02) and the provider-call answer rows (TW-01)
  against the real adapter evidence chain; the target-state rows (depending-on-#67) must fail at
  their named depending-on stages at HEAD and be greenable only when #67 lands.
- **Shallow-greenability** — sharpened: could TW-01 pass with ANY provider call (not
  seat-scoped)? Could TW-03 pass with a LONGER window (a clock answer wearing an evidence
  costume — the control-law violation this contract exists to kill)? Could the zombie-answer
  discrimination be dodged (a turn_started from a DEAD session)? Could the expiry receipt row
  pass with a receipt that lacks the steered fold (undeguggable)?
- **Missing-row gaps** — every v1.1 refusal/evidence code; the TG6 class (a content-free write
  must never answer); the per-route latency scaling IF the contract adopted any (attack it as a
  clock unless every firing is evidence-gated).
- **Stage honesty + hermeticity** — named stages at HEAD; fake timers as doubles are fine; no
  row may depend on real wall time (the #7 class).

## Output + laws

`docs/reference/evidence/tg3-window-2026-08-07/suite-blueteam.md`: BLUE-CLEAN or NEEDS-FOLD with
numbered findings (row/gap + attack + concrete fix). Edit ONLY that file. No clocks; citations
verified (`grep -an`/`sed -n` on the two NUL files); run the suite twice from the repo root and
record both splits.
