# #73 RED-TEAM BRIEF — adversarial attack on the forge-hardening contract v1.0

You are the ADVERSARIAL RED TEAM for `feedback-forge-hardening-contract.md` (v1.0, same dir —
issue #73, run.feedback must be hub-minted). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1 (refuse vs validate-or-replace)** — the ledger-referent check: can a caller point at a
   REAL gate event that belongs to a DIFFERENT run/worker (cross-run verdict laundering — a true
   verdict, wrong target)? Can a real but STALE/superseded gate event be re-used? Is the
   derivation replay-safe? Is refuse-vs-replace the right call per case, and is the boundary
   decidable?
3. **D2 (the discriminator)** — the top-level `gate` string discriminates verdict-shaped from
   coaching: can a forged verdict hide in a NON-gate field (a coaching text with an embedded
   structured verdict — does the consumer parse it)? Is the closed shape actually closed
   (unknown fields refuse)?
4. **D3 (derived:true provenance)** — can a caller forge `derived: true`? Is the field
   server-set (never caller-admitted)? Replay-derivable from what durable record?
5. **D4 (surface constancy)** — facade/MCP/web: same refusal, same {code,message} payload (the
   pinned-accessor discipline); the GP7/GP8 law (message rides only if lane-crafted — it is, so
   prove it).
6. **The consumer paths** — the judged worker's push (#79) and the planner's revision loop:
   does either consume caller-authored verdicts through ANOTHER lane that bypasses the new
   admission check (a back door that keeps the forge alive)?
7. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/feedback-forge-hardening-2026-08-07/contract-redteam.md`. Laws: no
clocks; every citation re-verified at the current HEAD.
