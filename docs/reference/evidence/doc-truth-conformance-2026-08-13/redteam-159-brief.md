# #159 RED-TEAM BRIEF — adversarial attack on the doc-truth↔admission conformance contract v1

You are the ADVERSARIAL RED TEAM for `doc-truth-conformance-contract.md` (v1, same dir —
issue #159: the three-way invariant documented ⇄ parsed ⇄ admitted, mechanically derived).
Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL discipline on `application.mjs` +
   `coordination-store.mjs`) — a wrong citation is an automatic blocker.
2. **D1 (the three-way invariant)** — is the mechanical derivation truly mechanical (no
   hand-maintained list smuggled back in)? Can the check be green while a documented verb
   still refuses (find a path)? Does it cover all three surfaces PLUS the facade?
3. **D2 (the direct-port accounting)** — does the `webBusNames()` fix actually count the
   direct-port verbs? Could a FUTURE direct port land without the check noticing (the
   regression posture)?
4. **D3 (the seven measured mismatches)** — verify each disposition (wire / retire /
   document-the-refusal) against the current code; any disposition that breaks a landed pin?
5. **D4 (example fidelity)** — can a generated-doc example still drift from executability
   under the contract's check? Is the check itself executable in the gate (no network, no
   host state)?
6. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/doc-truth-conformance-2026-08-13/contract-redteam.md`. Laws: no
clocks; every citation re-verified at the current HEAD.
