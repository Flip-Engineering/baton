# #61 CONTRACT BRIEF — the worker-visible gate verdict + objectives generated from live truth

You are drafting the implementation contract for issue #61 (two AX clarity items). Read fully,
in order: (1) the issue — `gh issue view 61`; (2) the sibling lanes that must compose, not
duplicate: the #79 worker-delivery-push contract v1.1 (the sanitized {gate, detail} verdict push
— the DELIVERY half; #61 GLM P1-3 is the worker-facing VERDICT SURFACE — name who owns what) and
DG-1 (`run.debug` / `run.feedback` — the operator/revision-channel side); (3) the boilerplate
problem: the objective composition in `impl/src/adapter.mjs` (the HARD CONSTRAINT block —
wire_frame, no-commit, bound outputs) and where the receipts/state that can contradict it live
(the worker's own snapshot commits, the boundary-commit norm #141); the IMPLEMENT_CONSTRAINTS
precedent (`recipes.mjs:528-537`).

## The contract must decide

- **D: the worker-facing verdict surface (GLM P1-3).** The judged worker sees WHICH gate, what
  it checked, and why it failed — the sanitized {gate, detail} shape (digests+counts, never raw
  paths/tails — the verifier-diagnostics law), delivered through the #79 push lane. What #61
  owns beyond #79: the verdict's STRUCTURE (the fields the worker needs to correct: gate, what
  was checked, the failing evidence class, the corrective class) vs #79's delivery mechanics.
- **D: objectives generated from live truth (Opus P0-2).** The HARD CONSTRAINT block is
  generated from the deployment's ACTUAL laws at compose time: never "no commits" where the
  worker's own snapshot/boundary commits exist (the #141 norm made that boilerplate false);
  never a bound the deployment doesn't enforce; never a wire_frame constraint on a lane that
  doesn't carry it. Pin the generation rule (each constraint line derives from a live policy
  read — name the source per line) and the honesty rule (a constraint that can't be derived
  from live policy is not printed — boilerplate a worker learns to discount is worse than none).
- **Refusal/observability vocabulary + acceptance pins (red-first)** per decision.

## Laws + deliverable

Ring-2 form. No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files);
sorted-key literals ACTUAL order; `localeCompare` banned. Cross-reference (do not re-spec): #64
(TG4), DG-1, #79, #73 (the forge-hardening — verdicts hub-minted), #141. Deliverable: ONLY
`docs/reference/evidence/worker-verdict-surface-2026-08-12/worker-verdict-surface-contract.md`
(v1.0 DRAFT with the verification HEAD).
