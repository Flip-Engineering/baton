# #71 RED-TEAM BRIEF — adversarial attack on the orchestrator-wake contract v1.0

You are the ADVERSARIAL RED TEAM for `orchestrator-wake-contract.md` (v1.0, same dir — issue
#71, wake-with-decisions instead of poll). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker. The `waitAfter`
  anchor (`coordination-store.mjs:8808` area) and the #103 D9 record (LANDED, 4ecf3ee) claims
  deserve special attention — verify against the tree.
2. **D1 (the wake primitive)** — can a wake be missed (an event lands between the caller's seq
  read and the wait registration — the classic long-poll race; is the cursor discipline
  race-free)? Can the wake set grow unbounded (a busy deployment's wake payload — the bound +
  spill)? Can a waiter hold a slot forever (resource honesty on the server side)?
3. **D2 (decision-first)** — can a wake payload carry stale actions (a decision answered between
  the event and the delivery — is the payload revalidated at delivery)? Is answer-from-wake
  idempotent (two waiters answering the same decision — the already_resolved posture)?
4. **D3 (who may be woken)** — can a WORKER principal call the orchestrator wake (authority
  inversion — the wake is orchestrator-scoped; is that enforced)? Multi-orchestrator: can one
  waiter's answer starve the other (claim-on-read semantics leaking in)?
5. **D4 (surface mapping)** — the MCP long-poll discipline: a blocking tools/call holds the
  MCP client — is the maxWaitMs bound honest and the cancellation path real? The web transport
  timeout vs the long-poll — which bounds first, and is it receipted?
6. **D5 (#105 composition)** — is the reply-hop-vs-decision distinction spoofable (a reply
  crafted to look like a decision wake)?
7. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/orchestrator-wake-2026-08-07/contract-redteam.md`. Laws: no clocks;
every citation re-verified at the current HEAD.
