# #156 RED-TEAM BRIEF — adversarial attack on the MCP profile-parity contract v1

You are the ADVERSARIAL RED TEAM for `mcp-profile-parity-contract.md` (v1, same dir — issue
#156: the MCP default profile made a superset of the bus). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL discipline on `application.mjs` +
   `coordination-store.mjs`) — a wrong citation is an automatic blocker.
2. **D1 (the parity law + mechanism)** — did the contract choose `baton_*` siblings vs a
   `combined` default, and is the reasoning sound? Can the mechanism regress silently (a new
   bus verb landing without its MCP sibling — does the parity pin catch it mechanically)?
3. **D2 (the two missing tools)** — are `fleet_run_resume_work` / `fleet_run_retry_verification`
   closed schemas exact mirrors of the bus verbs (arg-for-arg, refusal-for-refusal)? Any
   capability-class mismatch?
4. **D3 (the parity pin)** — is the derivation mechanical (from the admission maps, never a
   hand list)? Does it cover the CLI too, or is there a three-surface hole?
5. **D4 (the doc half)** — is the MCP.md change generated (#142), and does the contract
   avoid hand-editing the generated blocks?
6. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/mcp-profile-parity-2026-08-13/contract-redteam.md`. Laws: no clocks;
every citation re-verified at the current HEAD.
