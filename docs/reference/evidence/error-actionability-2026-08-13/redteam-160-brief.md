# #160 RED-TEAM BRIEF — adversarial attack on the error-actionability contract v1

You are the ADVERSARIAL RED TEAM for `error-actionability-contract.md` (v1, same dir — issue
#160: every refusal on every surface carries the typed code + the offending field/class + a
next action, enforced at the conformance gate). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1 (the actionability triple)** — attack the closure: can a refusal class escape the
   inventory (a throw site that isn't one of the named families — did the contract FIND all
   the catch/swallow sites? `grep -rn "catch" impl/src/web-northbound.mjs | wc` vs its map)?
   Is the honest-absence case (no field exists) gameable into always-absent?
3. **D2 (the family inventory)** — is every mapped destruction point real and current? Any
   family whose "compliant target shape" leaks (a value, a secret-shaped detail, a path)?
4. **D3 (the enforcement)** — can the gate check be shallow-passed (a compliant-looking
   refusal that never fires at runtime)? Is the static scanner side shape-only per the
   scanners law, or does it smuggle semantics? Does the check cover all three transports?
5. **D4 (the repair inventory)** — is the sequence landable (each family's flip independent)?
   Any repair that breaks a landed pin (the byte-stable refusal pins in the older suites)?
6. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/error-actionability-2026-08-13/contract-redteam.md`. Laws: no
clocks; every citation re-verified at the current HEAD.
