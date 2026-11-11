# #144 RED-TEAM BRIEF — adversarial attack on the LSP-support contract v1.0

You are the ADVERSARIAL RED TEAM for `lsp-support-contract.md` (v1.0, same dir — issue #144, LSP
support for diagnostic scoping + environmental understanding). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1 (the server pool)** — attack the lifecycle: a crashed/hung LSP server (does the pool
   supervise + bound it — the PL-class discipline — or leak processes)? A server that starts
   indexing a huge repo (resource bound honest)? Two languages racing on first start (cold-start
   single-flight)? A server running hostile project config (typescript-language-server loads
   tsconfig — what's the trust posture, is it stated honestly)?
3. **D2 (diagnostic scoping)** — can LSP-derived evidence leak content past the digests-only law
   (a hover text containing a secret-shaped string — sanitization at the boundary)? Is
   compiler-class evidence ever a GATE input (it must feed evidence, never verdicts — find any
   path where it becomes one)?
4. **D3 (the environmental tier)** — does the LSP tier compose with the epoch+overlay staleness
   law (an LSP answer over a stale index must read stale)? The absence cache interplay? Does a
   worker-scoped read ever see another worker's overlay (isolation)?
5. **D4 (honesty + containment)** — the opt-in-per-language posture: can a deployment get LSP
   answers for a language it never opted into (refusal honesty)? Is honest-empty reachable in
   every no-server path (never a fabricated symbol)?
6. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/lsp-support-2026-08-13/contract-redteam.md`. Laws: no clocks; every
citation re-verified at the current HEAD.
