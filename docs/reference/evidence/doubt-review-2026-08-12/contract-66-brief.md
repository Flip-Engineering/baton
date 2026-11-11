# #66 CONTRACT BRIEF — the doubt review path: elevated doubts need a queryable surface

You are drafting the implementation contract for issue #66 (doubts die with the task partition —
the KG settlement v1 deliberately doesn't elevate them). Read fully, in order: (1) the issue —
`gh issue view 66`; (2) the red-team lifecycle receipt it cites
(`docs/reference/evidence/kg-settlement-2026-08-01/redteam-lifecycle.md` A6 — the silent-sink
problem: elevation today mints a factless shared entry that settle deletes and nothing queries);
(3) the three candidate shapes: (a) a doubts board (queryable, orchestrator-reviewed at settle),
(b) a `knowledge.promote_doubt` command distinct from Finding admission, (c) a non-admission
scratch-fact with grounding `open_question`; (4) the settlement ritual (#63 — the review seam a
doubt-review rides), the scratchpad machinery (#33), the KG taxonomy + contradiction workspace
(phases 49/53), and the #79 delivery lane (a doubt the orchestrator ANSWERS should push back to
the worker — the closed loop).

## The contract must decide

- **The shape (a/b/c or a composition).** Pick and justify. The honesty test: doubts must be
  QUERYABLE (orchestrator: "what doubts are open across this wave/project?"), REVIEWED (the
  settle ritual sees them — not silently deleted), and ANSWERABLE (a resolution path that pushes
  back to the worker's brief — compose #79's push lane). Never a silent sink, never an
  auto-candidacy into the Finding graph (doubts are open questions, not facts — the taxonomy
  boundary matters).
- **The lifecycle.** A doubt's states (open → reviewed → answered/dismissed), each receipted and
  replay-derived; the doubt carries its provenance (worker, task, wave, the question verbatim,
  the worker's own framing — UNTRUSTED-framed everywhere it renders).
- **The settle composition.** At settle, the review surfaces open doubts with their frames; an
  unanswered doubt either carries into the project's doubt surface (project-persistent, honest)
  or is dismissed with a named disposition — never silently dropped.
- **Refusal vocabulary + acceptance pins (red-first)** per decision.

## Laws + deliverable

Ring-2 form. No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files);
sorted-key literals ACTUAL order; `localeCompare` banned. Cross-reference (do not re-spec): #33,
#63, #79, the KG taxonomy, A6's silent-sink ruling. Deliverable: ONLY
`docs/reference/evidence/doubt-review-2026-08-12/doubt-review-contract.md` (v1.0 DRAFT with the
verification HEAD).
