# ROW BRIEF — row-pm-dag: pm's DAG engine vs baton's waves/plan structures

Read `foundry-brief.md` first (the shared laws bind you). Your lane: **execution planning,
dependency structure, and progress governance**.

Ground in the digest: `src_dag_mod.rs` (topological order, impact propagation —
`effective_impact = own + weighted downstream`, auto-transitions, stagnation detection after N
consecutive failures, mandatory review gates after K experiments or T hours, time-boxed
evaluation budgets), `TASKS.md` (the phase/task decomposition discipline), `DESIGN.md` layers
2+6 (multi-project priority classes, opportunity-cost tracking, portfolio stagnation).

Baton's side: the workflow interpreter's drive loop (`impl/src/workflow-interpreter.mjs`), the
wave registry, the steering lanes (approveOnAdvertisedPlan/nudge/claimOnStall/elevate/
signalOnMembersDone/answerDecisions), the folded #161 plan object
(`docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md`
v2.0 — per-wave-subtree WIP law, focusTaskIds), the #67 watchdog (evidence-derived stall),
#163 (quiescence-derived completion), #149 (gate digest). The campaign's own method
(spec-driven foundries with red/blue stages) is the de-facto governance layer — evaluate pm's
formal gates against it.

Candidates to evaluate (find your own too): dependency-typed task structure (phases blocked-by
phases — baton tasks are flat per wave); impact propagation for prioritization; auto-transition
on child completion; stagnation detection (N consecutive failures → forced review); REVIEW
GATES (K experiments without review blocks progress — vs the campaign's evidence-gate
methodology); opportunity-cost/portfolio view across parallel workstreams. For each:
ADOPT/ADAPT/REJECT/ALREADY-HAVE with the landing zone — and mark every time-based mechanism
(T hours, budgets in wall time) ADAPT-to-event-derived or REJECT per the standing veto.

Deliverable: `docs/reference/evidence/pm-comparison-2026-08-13/pm-dag.md`.
