# #158 RED-TEAM BRIEF — adversarial attack on the scratchpad-write contract v1

You are the ADVERSARIAL RED TEAM for `scratchpad-write-contract.md` (v1, same dir — issue
#158: the shared scratchpad write verb on the three agent-facing surfaces). Read it FULLY,
then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1 (the write law)** — attack the authority shape against the LANDED read law (#74
   D1.2, `restrictingReadAuthorize` in `application-deployment.mjs`): can a member write a
   sibling's partition? Can a member write `shared` AS another member (forged provenance)?
   Can a write escalate itself (write-then-elevate without the orchestrator gate)?
3. **D2 (the verb + surfaces)** — is the verb admitted on all three surfaces for REAL
   (parser AND admission AND generated docs — the #157 ghost trap)? Is the arg closure
   closed (no caller-supplied authority fields)?
4. **D3 (bounds + audit)** — which #89 row bounds the body (verify it exists)? Spam
   discipline (a member flooding `shared`)? Replay: a retried write lands exactly once; a
   torn write fails closed.
5. **D4 (the bare-subcommand trap)** — is the refusal real at the parser today?
6. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/scratchpad-write-2026-08-13/contract-redteam.md`. Laws: no clocks;
every citation re-verified at the current HEAD.
