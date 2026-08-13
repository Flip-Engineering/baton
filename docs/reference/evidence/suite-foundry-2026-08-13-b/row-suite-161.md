# ROW BRIEF — row-suite-161: the red-first suite for the folded #161 contract (v2.0)

Read `foundry-brief.md` first (the suite law binds you — red-first, named stages, hermetic,
split-twice, the attempt-echo law in the first five lines). Your source of truth:
`docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md`
(v2.0 FOLDED — the orchestrator plan object: version-bearing idempotency keys with
`plan_stale_version`, the P1 update-pin (upsert v1 → upsert v2 with `expectedTaskVersion=2`
green; `=1` refuses), `plan.read`/`plan.write` on the `plan:*` capability per DR-2(a), the
per-wave-subtree exactly-one law with bounded `focusTaskIds` per DR-3, the auto-demote batch +
`plan_parallel_progress`). Also read `redteam-161.md` (the attack surface — the
deterministic-key reachability hole your rows must discriminate against) and `fold-161.md`.

Idioms to mirror: `impl/test/wave-observability-red.test.mjs` (registry/facade style) and any
store-level suite the contract names — plan-object rows are store + facade projection rows.

Deliverables (edit ONLY these): `impl/test/orchestrator-plan-object-red.test.mjs` ·
`docs/reference/evidence/orchestrator-plan-object-2026-08-13/suite-draft-notes.md` (row
inventory + stage table + both measured splits + judgment calls).
