# #70 RED-TEAM BRIEF — adversarial attack on the cross-deployment-knowledge contract v1.0

You are the ADVERSARIAL RED TEAM for `cross-deployment-knowledge-contract.md` (v1.0, same dir —
issue #70, one project many deployment roots). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1 (the designated-primary + replication-as-projection)** — can two roots both claim
   primary (split-brain: which wins, and is the conflict honest)? Can a replica apply a
   promotion event whose dependencies never arrived (out-of-order/partial replication — is the
   projection's ordering/dedup law replay-safe)? Can a replica's local promotion COLLIDE with a
   replicated one (same content-address, different provenance)?
3. **D2 (the federation boundary)** — can a task-ephemeral or workflow-ephemeral node cross
   roots through a side channel (a promoted node CITING an ephemeral one — does the citation
   dangle or leak)? Can a candidacy queue item leak into a federated recall?
4. **D3 (never an authority input)** — is there ANY path where a federated (replicated) node
  feeds a gate, a verification, a settlement candidacy, or a routing decision (the
  orientation-only law)? Can a federated node be promoted AGAIN in the replica (double
  promotion laundering its provenance)?
5. **D4 (the descriptor seam)** — the `knowledge.primaryRoot` field: closed schema, containment
  (can it point OUTSIDE the repo / at a path that isn't a baton root — the mcp-descriptor
  lexical+realpath precedent)? Default-absent behavior byte-identical to today?
6. **D5 (the read shape)** — the source+epoch disclosure: can a federated answer pass as LOCAL
  (the source-root naming must be unforgeable by the payload)? Is the epoch lag event-seq
  anchored (never wall time)?
7. **Refusal vocabulary + acceptance pins + open questions** — each verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/cross-deployment-knowledge-2026-08-07/contract-redteam.md`. Laws: no
clocks; every citation re-verified at the current HEAD.
