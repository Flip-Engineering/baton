# #157 RED-TEAM BRIEF — adversarial attack on the CLI wave-fidelity contract v1

You are the ADVERSARIAL RED TEAM for `cli-wave-fidelity-contract.md` (v1, same dir — issue
#157: (a) the CLI `waves.send`/`waves.stop` ghost rows, (b) the interpreter-wave registry
null-phase gap). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1 (the CLI wave verbs)** — do the parse branches use the EXISTING input schemas (the
   audit's claim — verify it)? Does the closed-set refusal stay byte-consistent? Does the
   generated-docs row regenerate rather than hand-edit (#142)?
3. **D2 (the registry fidelity law)** — is the hydration seam real and correctly placed
   (the interpreter's members register through the same store path as driver members?)? Can
   the projection still read null for a healthy interpreter wave after the fix (find the
   residual path)? Is the D3 seat-map recovery (#74, just landed) consistent with this law?
4. **D3 (the ghost-prevention pin)** — does the pin derive the verb set mechanically (never
   a hand list)? Would it have caught the ghosts at their introduction?
5. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/cli-wave-fidelity-2026-08-13/contract-redteam.md`. Laws: no clocks;
every citation re-verified at the current HEAD.
