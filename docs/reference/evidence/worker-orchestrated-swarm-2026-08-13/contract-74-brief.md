# #74 CONTRACT BRIEF — the worker-orchestrated swarm pattern (sub-orchestrator tier over flash swarms)

You are drafting the implementation contract for issue #74 (the worker-orchestrated swarm
pattern). Read fully, in order: (1) the issue — `gh issue view 74`; (2) the demo evidence
`docs/reference/evidence/nested-orchestrator-2026-08-02/` (the two-level shape proven: coordinator
thinks, orchestrator drives); (3) the landed machinery to compose with: the wave driver +
recipes (`impl/src/recipes.mjs` implementContract cadence), the message lane + DECISION_REQUEST
escalation (the demo v2b live gate), the #10 waitingOn vocabulary, the #114 workflow-as-data
interpreter (`baton.recipes.runWorkflow` — a workflow spec could declare the pattern!), the #132
wave observability lane (the sub-orchestrator's waves are VISIBLE to the top orchestrator), #12
nested orchestration (Ring 4 impl-queued — the full shape's dependency; this contract owns the
TWO-LEVEL shape that works today and names the #12 composition for the full shape); (4) the
operator's seat direction (2026-08-12): deepseek-v4-pro[1m] as the sub-orchestrator tier (an
extremely cheap Fable-tier model), sub-orchestrating swarms of deepseek-v4-flash workers —
the heterogeneous swarm can also carry grok/glm rows.

## The contract must decide

- **The pattern as a first-class workflow shape.** A coordinator-member recipe: the coordinator
  worker takes a big spec+suite, decomposes into granular sub-specs/test-suite areas as
  ARTIFACTS (scratchpad/boards/context-packages — the landed shared-layer machinery), a
  heterogeneous swarm executes rows, the coordinator triages and escalates genuinely big
  questions via DECISION_REQUEST to the top orchestrator. Pin the artifact conventions (where
  sub-specs live, how rows are claimed, how results land), the escalation contract (what
  rises vs what the coordinator answers), and the swarm execution receipts (per-row outcomes
  the top orchestrator can audit).
- **The sub-orchestrator's authority boundary.** The coordinator worker NEVER drives baton
  itself (that's the #12 full shape) — it decomposes, sequences, triages, and escalates through
  the collaboration lanes (boards, scratchpad, messages, decisions). The top orchestrator keeps
  the wave/steering authority. Pin the boundary and the refusal for a coordinator attempting an
  authority action.
- **The seat discipline.** The coordinator seat is the heavyweight tier (deepseek-v4-pro[1m] /
  glm-5.2+); the swarm seats are cheap (deepseek-v4-flash, grok opportunistic). Pin the
  routing law (the recipe's route map) and the capacity honesty (the coordinator's own
  waitingOn/capacity states surface to the top orchestrator).
- **The #114 composition.** Can the whole pattern be DECLARED as a workflow-as-data spec (a
  coordinator member + swarm members + the escalation policies)? Name the spec shape — this is
  the "scripted-dynamic workflow through the surface" the operator keeps asking for.
- **Refusal vocabulary + acceptance pins (red-first)** per decision.

## Laws + deliverable

Ring-2 form. No clocks as controls; every citation verified (`grep -an`/`sed -n` on the two NUL
files); sorted-key literals ACTUAL order; `localeCompare` banned. Cross-reference (do not
re-spec): #12, #68, #71, #94 (the demo), #105, #114, #132. Deliverable: ONLY
`docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/worker-orchestrated-swarm-contract.md`
(v1.0 DRAFT with the verification HEAD).
