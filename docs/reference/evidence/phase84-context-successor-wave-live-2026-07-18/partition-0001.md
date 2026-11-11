# Phase 84 context successor wave review — partition 2/2

## Finding: exact dispatch-route authority is not established (high)

CM84-W4d represents the Plan's route authority as three independent collections:
`harnesses`, `models`, and `efforts`. It then dispatches the already-valid `routeB`
tuple and asserts that both live and settlement projections reproduce that tuple.
This proves projection fidelity, but it does not prove that dispatch admission preserves
the exact authorized tuple. A mixed dispatch composed of `routeA.harness`,
`routeB.model`, and either admitted effort would satisfy per-field membership while
matching neither exact team route.

Consequently, an implementation can pass the partition while admitting a recombined
route and then faithfully exposing that unauthorized route through
`contextCall()` and `contextCallSettlementChildren()`. Recomputing a Plan digest, as
CM84-W5 does, cannot restore tuple identity once the authority representation or its
validation treats route axes independently.

Required correction: bind Plan authority to canonical route tuples (or tuple digests)
and validate the selected dispatch against one complete tuple before any provider
effect. Add a regression case whose mixed route uses only individually listed values;
it must be rejected before dispatch and replay, while the complete `routeB` tuple must
remain accepted and project unchanged.

This finding is derived only from immutable context partition
`context-partition:2886f7e2b203fa464997ad784cda6b4f10245b215f217a05316cc7d6209760ef`
(`impl/test/phase84-context-map-wave-red.test.mjs`, CM84-W4d and CM84-W5).
