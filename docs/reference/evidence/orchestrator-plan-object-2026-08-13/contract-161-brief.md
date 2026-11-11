# #161 CONTRACT BRIEF — the orchestrator's plan object as a first-class baton citizen

You are drafting the implementation contract for issue #161: the orchestrator's own plan
state (the campaign todo, the wave map, blocked-by relationships) is not a baton citizen —
it lives in the orchestrator's harness, invisible to workers and unqueryable by the system.

## Read first (in order)

1. The issue: `gh issue view 161`. The consumers: `docs/reference/evidence/
   worker-orchestrated-swarm-2026-08-13/contract-fold.md` v1.2 (the #74 coordinator pattern —
   a sub-orchestrator decomposing a plan INTO row tasks) and the knowledge-horizons law
   (`docs/34-knowledge-horizons.md` + the landed elevation machinery).
2. The existing task-plane machinery this rides: the coordination task topology (refines
   relations, `taskTopologyPolicy`, the TT-row suites), the boards lane
   (`requestBoardClaim`/`submitBoardReport` — kernel-only today), the scratchpad tiers.
3. The surface pattern: how a new read/write family lands on the three surfaces without
   ghosts (the #157/#159 doctrine — the contract's surface section must satisfy it).
4. kimi's own TodoList as the reference behavior (the orchestrator's current out-of-band
   tracker: statuses, exactly-one-in-progress, immediate completion marking).

## The contract must answer

- **D1 — the object shape + durability.** The plan object's schema (tasks: id, title, status,
  blocked-by, owned-by-wave/run, evidence links), where it lives in the coordination store,
  the replay behavior, the idempotency/idempotency-key discipline per mutation.
- **D2 — the authority law.** Who reads/writes what: the orchestrator (full), a wave
  coordinator (its subtree), a row (its own task, read-only beyond), everyone else (nothing).
  The elevation discipline (a wave's task outputs elevate at wave close, reviewed — mirroring
  the KG horizons).
- **D3 — the surface + the wave integration.** The verbs (`plan.read`/`plan.write`? choose
  the naming consistent with the grammar), the three-surface admission, and the #74
  integration: a coordinator member's decomposition writes row tasks into the plan object;
  the interpreter can gate a member on a plan task's state.
- **D4 — the migration of the orchestrator's own practice** (how kimi drives it day-one:
  the campaign todo becomes the plan object's content; the write path from the orchestrator
  seat).
- **Refusal vocabulary + red-first acceptance pins + open questions**, per campaign form.

## Laws

Ring-2 contract form; every citation verified this session (NUL discipline); no clocks; cite
the landed laws (D1.2 read law, horizons) rather than re-litigating them. Deliverable:
`docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md`
ONLY.
