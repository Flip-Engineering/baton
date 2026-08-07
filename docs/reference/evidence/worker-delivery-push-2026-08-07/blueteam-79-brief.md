# #79 BLUE-TEAM BRIEF — attack the worker-delivery-push red-first suite

You are the **blue team** for the worker-delivery-push suite. Target: NOT the contract — the
SUITE's red-keeping power. Read fully, in order: (1) `worker-delivery-push-contract.md` (v1.1);
(2) `contract-fold.md`; (3) `impl/test/worker-delivery-push-red.test.mjs` (24 tests: 11 green
PINs, 13 red at named stages); (4) `suite-draft-notes.md`.

## Attack axes (per row)

- **Green-side blockers FIRST** — can every red row go green under a CORRECT v1.1
  implementation? Fixtures that can't mint the state (a judged worker with a sanitized verdict,
  a pending scratchpad_write_failed), or oracles contradicting the folded contract.
- **Shallow-greenability** — sharpened for this lane: could the render-seam rows pass with the
  section emitted on EVERY brief (empty or not — does a row catch that)? Could the addressing
  rows pass with run-level (not worker-level) scoping? Could the verdict-push row pass with an
  UNSANITIZED tail that happens to contain no secrets in the fixture (a fixture that never
  includes a home path/JWT would greenwash the sanitization law — does the fixture include
  adversarial content)? Could the dedup row pass with an in-memory Set (driver-restart unsafe)?
- **Missing-row gaps** — every v1.1 refusal code; the never-pushed kinds enumerated; the
  spill-reachability round trip (the worker RESOLVES the digest-cited spill); the
  delivered-then-read honesty.
- **Stage honesty + hermeticity** — named stages at HEAD; mkdtemp only; no order-dependence.

## Output + laws

`docs/reference/evidence/worker-delivery-push-2026-08-07/suite-blueteam.md`: BLUE-CLEAN or
NEEDS-FOLD with numbered findings (row/gap + attack + concrete fix). Edit ONLY that file. No
clocks; citations verified (`grep -an`/`sed -n` on the two NUL files); run the suite twice from
the repo root and record both splits.
