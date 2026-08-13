# #61 RED-TEAM BRIEF — adversarial attack on the worker-verdict-surface contract v1.0

You are the ADVERSARIAL RED TEAM for `worker-verdict-surface-contract.md` (v1.0, same dir —
issue #61: the worker-facing gate verdict surface + objectives generated from live truth).
Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1 (the four-field corrective verdict surface, hub-projected once)** — attack the
   projection: can the corrective structure leak gate-internal detail the worker shouldn't
   read (sanitizer-boundary honesty)? Can two verdicts race (the "projected once" law — a
   re-verdict after feedback, a terminalized-then-late verdict)? Does the worker surface the
   verdict at the RIGHT turn boundary (too early = steering the judged turn; too late =
   useless)? What does a RED-row implementer get wrong shallowly (a projection that exists
   but carries boilerplate instead of the live corrective)?
3. **D2 (objectives generated from live truth)** — attack the derivation: a constraint line
   whose live truth CHANGES mid-run (the per-line derivation re-derived? stale?); the honesty
   rule when live truth is unavailable (honest absence vs boilerplate fallback — find any
   path where boilerplate can still ship); the interaction with attempt markers (an
   [attempt:] prefix re-derived per attempt must not fight the derivation).
4. **Composition with the landed surface** — does either decision contradict the #10
   waitingOn vocabulary, the #61-adjacent #61/#62 split (check the issue body:
   `gh issue view 61`), or the trust-gate steering cycle's own laws
   (`impl/test/trust-gate-steering-red.test.mjs`)?
5. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/worker-verdict-surface-2026-08-12/contract-redteam.md`. Laws: no
clocks; every citation re-verified at the current HEAD.
