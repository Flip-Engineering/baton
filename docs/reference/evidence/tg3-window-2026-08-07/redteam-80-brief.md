# #80 RED-TEAM BRIEF — adversarial attack on the TG3-window contract v1.0

You are the ADVERSARIAL RED TEAM for `tg3-window-contract.md` (v1.0, same dir — issue #80, the
TG3 steering window vs provider turn-start latency). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **The subsumption analysis** — the contract says how much of #80 the #67 v1.1 fold closes.
   ATTACK THE CLAIM ITSELF: #67 v1.1 is contract text (its own G7 admits `turnInFlight` does not
   exist at HEAD). Is the subsumption written against shipped behavior or against another
   contract's promise? If the latter, is the dependency explicit (a depending-on-#67 posture,
   the #114-B3/#97 precedent)? And G8's claim — the steering cycle is a separate one-shot timer
   the watchdog never governs — verify it against the code.
3. **The residual fix (the evidence-answer classes)** — can a queued-but-not-started turn be
   faked (a dispatch receipt minted without a real provider start — does the evidence class
   distinguish)? Can a started-but-immediately-dead provider turn answer the cycle forever (the
   turn_started with no subsequent activity — zombie-answer)? Is each answer class durable and
   replay-derived?
4. **The expiry disposition** — when the window expires with no evidence: is the outcome
   receipted so the #55-class incident is debuggable? Does the disposition ever kill/nudge a
   worker whose next turn is provider-queued (the healthy-slow case the issue is about)?
5. **The control-law line** — find any bound that fires on elapsed time with zero evidence
   check. Candidate (a)'s per-route latency scaling: if the contract adopts ANY latency-scaled
   window, attack it as a clock-by-another-name unless every firing is evidence-gated.
6. **TG6 compatibility** — does any answer class teach a write-to-survive behavior (a worker
   emitting a content-free note to manufacture evidence)? The distinct-digest class must hold.
7. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/tg3-window-2026-08-07/contract-redteam.md`. Laws: no clocks; every
citation re-verified at the current HEAD.
