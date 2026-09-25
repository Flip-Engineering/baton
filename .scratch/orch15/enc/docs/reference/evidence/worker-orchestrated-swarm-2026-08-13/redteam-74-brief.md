# #74 RED-TEAM BRIEF — adversarial attack on the worker-orchestrated-swarm contract v1.0

You are the ADVERSARIAL RED TEAM for `worker-orchestrated-swarm-contract.md` (v1.0, same dir —
issue #74, the sub-orchestrator tier over flash swarms). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1 (the coordinator-member recipe)** — attack the decomposition artifact conventions: can a
   coordinator mint sub-specs that escape the member scopes (scope confusion across the swarm)?
   Can a row be double-claimed (two members, one row — the claim discipline)? Can a coordinator
   fabricate a result (the swarm execution receipts must bind to real member outcomes, never
   coordinator-authored)?
3. **D2 (the authority boundary)** — THE critical attack: can the sub-orchestrator drive baton
   (start/stop a wave, steer a member directly, mint an authority artifact)? Every escape is a
   blocker. Can it escalate something that ISN'T a genuine big question (escalation spam — the
   top orchestrator's attention is the scarce resource; is there a bound/discipline)?
4. **D3 (the seat discipline)** — can a swarm row land on a seat the deployment doesn't allow
   (route admission)? Is the coordinator's own capacity/waitingOn state honestly visible
   upward?
5. **D4 (the #114 composition)** — is the declared spec shape actually expressible in the
   shipped workflow-as-data schema (v1.2 — the closed steering vocabulary)? If the pattern needs
   a policy the schema doesn't carry, that's a hole — name it.
6. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/contract-redteam.md`. Laws: no
clocks; every citation re-verified at the current HEAD.
