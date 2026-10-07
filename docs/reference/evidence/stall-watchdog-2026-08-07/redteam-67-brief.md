# #67 RED-TEAM BRIEF — adversarial attack on the stall-watchdog contract v1.0

You are the ADVERSARIAL RED TEAM for `stall-watchdog-contract.md` (v1.0, same dir — issue #67,
the evidence-armed stall watchdog). Read it FULLY first, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker. The #10
   composition cites the LANDED waitingOn vocabulary (`baecb18`) — verify against the tree.
2. **D1 (decoupled budget)** — can the decoupled stall budget exceed the wall budget by
   misconfiguration (a bound that can never fire is the original bug reborn — is there an
   admission-time check `stall < wall`)? Is the disclosure readable by an operator (what the
   budget MEASURES, not just its value)?
3. **D2 (progress-evidence re-arm)** — the attack is the chatty idler, evolved: can a worker
   re-arm by cycling a scratchpad note through write/delete? by a no-op diff (touch a file,
   revert)? by re-sending the same digest (the distinct-digest class — is it deduped per window
   or lifetime)? Can an ORCHESTRATOR action (nudge) re-arm the worker's own liveness (a
   self-dealing loop)? Is every non-rearming event class named, with the default silence
   honest?
4. **D3 (blocked-status escape)** — with #10 landed, does a waiting-on-interaction worker now
   read as watched or unwatched? Whose stall is a never-answered question (the contract says
   the orchestrator's — can a malicious/absent ORCHESTRATOR stall the worker forever and is
   that honest)? The null-deadline default: can it fire while a decision is legitimately
   awaiting the operator (the #105 escalation path must compose)?
5. **D4 (kill ladder)** — is every step receipted and is the order enforced (no reap before
   escalate)? Can the ladder be gamed by a worker that answers the claim but never progresses
   (claim-then-idle — does the claim reset the evidence window)?
6. **The control-law line** — the contract's claim is "no evidence of progress, never too
   slow." Try to break it: is there ANY bound in the contract that fires on elapsed time with
   zero evidence check? A slow-but-productive worker (long compile, a 20-minute verification)
   must never be declared stalled.
7. **Refusal/observability vocabulary + acceptance pins + open questions** — each: typed,
   named, surface-constant; each pin red-first-able; each OQ verdict'd (fold-blocking or
   deferred).

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(each: what + why + the concrete fix). Write ONLY
`docs/reference/evidence/stall-watchdog-2026-08-07/contract-redteam.md`. Laws: no clocks;
every citation re-verified at the current HEAD.
