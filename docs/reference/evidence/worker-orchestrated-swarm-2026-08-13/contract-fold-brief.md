# #74 CONTRACT-FOLD BRIEF — fold the red-team into the worker-orchestrated-swarm contract

You are folding an adversarial red-team report into the #74 contract. Read fully, in order:
(1) `contract-redteam.md` (NOT FOLD-READY — two blockers, three citation drifts, three
amendments/notes, each with its concrete fix); (2) `worker-orchestrated-swarm-contract.md`
(v1.0 — your edit source); (3) `comm-topology-audit.md` (context; do not re-litigate);
(4) the cross-referenced laws the red-team cites: `reply-chains-contract.md:288-333` (D8,
same dir) and `../facade-projection-2026-08-03/facade-projection-contract.md:217,636` (the
scratchpad scope grammar + the "unknown ≡ foreign" policy seam).

## Deliverable

Write `contract-fold.md` (this dir) — the folded contract **v1.1**, self-contained, opening
with a fold-map table (finding → resolution → where in v1.1). v1.1 must:

1. **BLOCKER 1 — truthful steering trail.** Add a contract requirement (and amend the D6
   receipt law + A3's GREEN): when `answerDecisions` policy answering throws (denied option,
   raced terminal member), the interpreter MUST record `{trigger, role, requestId, outcome:
   'denied', refusal: <code>}`, MUST NOT mark the decision key handled, and MUST leave the ask
   pending for the human. `outcome: 'answered'` may only be recorded after `handle.answer`
   returns successfully. The GREEN pins: a denied auto-answer leaves the member parked at
   `input_required` with a truthful trail, and a later human answer settles it.
2. **BLOCKER 2 — the scratchpad read-authorization law.** State it as contract law: a member
   principal may read `worker:<ownId>` + `shared`; the top orchestrator (review authority,
   FP-18) may read any member scope of its own wave; a swarm row reads coordinator sub-specs
   ONLY via an explicit wave-scoped grant or via the coordinator publishing to `shared`. Pin
   the enforcement seam (the deployment `authorize` hook —
   `application-deployment.mjs:1998` default is permissive; v1.1 requires deployments running
   the coordinator-member recipe to install the restricting authorize). Amend A2's GREEN to
   assert a sibling `worker:<role>` read is REFUSED with the typed code.
3. **Citation drifts (all three):** `application-cli.mjs:126` (label `:257`);
   `coordinator.mjs:11234-11256`; `application.mjs:11610-11614` (route `:11612`). Re-verify
   each against HEAD with `grep -an`/`sed -n` before writing (NUL discipline:
   `application.mjs`/`coordination-store.mjs` via `grep -an`/`sed -n` only).
4. **A5 amendment:** the `waves.*` direct ports dispatch BEFORE the recursive gate
   (`application.mjs:12502-12512` vs gate `:12528-12535`); A5's GREEN must NOT claim the #12
   codes cover `waves.*`. State that the full shape requires `waves.start`/`waves.run`/
   `waves.stop` added to the recursive gate (or explicitly refused for lease holders) at the
   dispatch seam; carry the OQ1 code finding into the contract body (OQ1 → answered).
5. **D4 example fix:** the harvest example path must name a FILE (e.g.
   `docs/results/coordinator.md`), never a directory (`git show <sha>:<dir>` fails →
   `harvest_miss`).
6. **§3.3 note folded:** escalation is concurrency-bounded (one live ask/session, one pending
   decision/worker, stuck-on-handled self-termination) but sequentially uncapped after human
   answers — state the bound explicitly with the human-in-the-loop justification.

Keep everything the red-team verdict'd SOUND byte-stable in substance (D1 double-claim,
fabricated-results, D3 seat discipline, the two-level posture). Laws: no clocks; every
citation re-verified at current HEAD; sorted-key literals in ACTUAL order; `localeCompare`
banned. Write ONLY `contract-fold.md`.
