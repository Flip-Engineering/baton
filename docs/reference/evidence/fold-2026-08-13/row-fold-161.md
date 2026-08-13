# ROW BRIEF — row-fold161: fold the #161 contract per its red-team + QA + top-orchestrator decisions

Read `docs/reference/evidence/fold-2026-08-13/foundry-brief.md` first — it binds you. Your material:

- Contract: `docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md` (FULL read)
- Red-team: `docs/reference/evidence/orchestrator-plan-object-2026-08-13/redteam-161.md` (blockers led by the idempotency-template reachability hole)
- QA: `docs/reference/evidence/review-foundry-2026-08-13/review-qa.md` §3 (esp. §3.4; verdict NEEDS-WORK — two real idempotency-scheme defects, the rest sound)

The QA's §3.4 fold instruction set:
1. Correct the idempotency scheme (H1, H2) before fold — contract-text change, because pins P1/P4
   would otherwise assert an unrepresentable state. (The deterministic-key templates
   `plan.task_upserted:${planId}:${taskId}` / `plan.task_transitioned:...:${toStatus}` make
   update and re-transition unreachable under the `_byKey` replay discipline — introduce the
   version-bearing keys the red-team's fix names.)
2. Pin P1 to assert *update* explicitly (upsert v1 then upsert v2 with `expectedTaskVersion=2`
   goes green; v2 with `expectedTaskVersion=1` refuses `plan_stale_version`).
3. Keep the shape/authority/surface decisions as written; they are sound.

**TOP-ORCHESTRATOR DECISIONS (law, apply both):**
- **DR-2 (OQ1, surface prefix):** option (a) — `plan.read`/`plan.write` ride the existing
  `plan:*` capability; the goal-plan overload is documented as a store-internal non-collision.
  No new prefix, no new capability class.
- **DR-3 (OQ2, exactly-one-in-progress scope):** the uniqueness law binds **per wave subtree**,
  not per plan. The plan level carries an explicit bounded `focusTaskIds` set (bounded by
  `planPolicy`, default 4) instead of a singleton; auto-demote + `plan_parallel_progress` apply
  within a wave subtree. Rationale to record in the contract: observed campaign orchestration
  runs multiple waves concurrently; a per-plan singleton is false to practice. Fix the semantic
  law accordingly (it is a law, not a tunable — the QA flagged exactly this).

Deliverables per the shared frame: the folded contract in place +
`docs/reference/evidence/orchestrator-plan-object-2026-08-13/fold-161.md` (the
blocker→resolution map, attempt line verbatim in its header).
