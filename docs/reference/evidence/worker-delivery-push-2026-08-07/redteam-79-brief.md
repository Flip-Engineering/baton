# #79 RED-TEAM BRIEF — adversarial attack on the worker-delivery-push contract v1.0

You are the ADVERSARIAL RED TEAM for `worker-delivery-push-contract.md` (v1.0, same dir — issue
#79, pushing attention + verdicts to the worker's own down-channel). Read it FULLY, then attack:

1. **Re-verify every citation** (`grep -an`/`sed -n`; NUL files: `application.mjs` +
   `coordination-store.mjs` only) — a wrong citation is an automatic blocker.
2. **D1 (the brief-section seam)** — the pending-attention block lands on the provider-facing
   brief. Attack: can the block push a worker into context pressure (the #89 frame-economics law:
   shape-only, item-count bound, digest-cited spill — is the spill actually reachable by the
   worker, or a dead citation)? Does the block land on EVERY turn or only turns with pending
   items (a permanent empty section is frame waste)? Can attention content crafted by ANOTHER
   worker (a board/claim item) inject instructions into this worker's brief (the UNTRUSTED
   framing — is it actually applied, and is the wrapProse discipline the shipped one)?
3. **D3 (addressing)** — worker-identity addressing: can an item leak across runs (a worker id
   reused across waves? a run boundary crossed)? Are the never-pushed kinds complete (what about
   budget_alarm — orchestrator-only or worker-relevant?)?
4. **D4/D5 (receipts + dedup)** — is the delivery receipt replay-derivable from durable records
   or a live-map? Can the same item double-push after a driver restart/attach (the dedup key's
   durability)? Does delivered-then-read overclaim (the wire can't prove a read — is the
   posture honest)?
5. **D6 (the verdict push)** — the sanitized {gate, detail} shape: can a path/secret slip the
   sanitization (the verifier-diagnostics digests-only law)? Does the push give the worker
   actionable correction evidence or just a bare code (the original complaint)?
6. **Refusal vocabulary + acceptance pins + open questions** — each: typed, named,
   surface-constant; pins red-first-able; OQs verdict'd.

Verdict per decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers
(what + why + concrete fix). Write ONLY
`docs/reference/evidence/worker-delivery-push-2026-08-07/contract-redteam.md`. Laws: no clocks;
every citation re-verified at the current HEAD.
