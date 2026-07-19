# Generic reduce adversarial review

No concrete defect was found in the scoped public `context_reduce` and generic effect-call dispatch slice.

- Admission is the sole schema-v2 `context.call_admitted` write. Store validation rederives service and requester authority, the active Context session, current predecessor Plan, Workflow v3 role/template and singleton route, exact source lineage, unit coverage, and successor Plan digest before append. Admission and missing-Plan recovery do not invoke an adapter.
- Restart reconciliation proposes only a missing prebound Plan with the durable call digest/idempotency key. Existing Plan and dispatch projections suppress repeat proposal or provider spawn. Approval dispatches the admitted unit on the catalog-selected harness/model/effort.
- The physical reduce Brief rereads the immutable output and evidence, rechecks every output lineage, resolves each result ref to its content-addressed capsule, reprojects the capsule from the retained commit, and verifies the capsule's private source digest and item count before adding source content to the provider-only Brief.
- Historical schema-v1 map admission/replay and `context_map_child` Brief materialization remain discriminated from schema-v2 generic calls. Generic calls share stop targeting with historical calls, so Run stop fences and reaps the dispatched worker without adding generic settlement or retry behavior.

Focused verification on 2026-07-18: `node --test impl/test/phase84-context-map-wave-red.test.mjs impl/test/phase85-context-effect-admission-red.test.mjs` passed 16/16.
