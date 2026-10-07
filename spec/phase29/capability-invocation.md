# Phase 29 — coordinator-owned capability invocation

## CI1 — one registry, no second control plane
`createDriver()` constructs exactly one `CapabilityRegistry` from deployment-injected capability registrations and gives its only driver-owned handle to Coordinator. It lists honest cards and dispatches capability operations; it owns no task, worker, integration, or publication authority.

## CI2 — bounded ACI calls
Invoke requires a registered capability, advertised operation, JSON-shaped arguments, positive deployment-bounded token budget, deployment-bounded ACI envelope, and optional cancellation. Results must carry `op/status/summary/payload/refs/cost/provenance`; status, cursor invariants, cost numbers, and bounded artifact identities are validated. Task-class operations are advertised but typed-refused until a durable task-DAG/cancel adapter owns them.

## CI3 — resume and reverify
Cards derive and advertise invoke/resume/reverify/cancel support from the implementation. Resume and reverify are public only when implemented and receive the same budget/cancellation policy and trusted deployment context. Reverify receives the registry-validated advertised operation explicitly; it cannot select a different operation from mutable claim data.

## CI4 — authority firewall
Capability output can never claim `mergeAuthority` or `verificationAuthority`; registry validation rejects either claim.

## CI5 — durable provenance
Started/completed/refused calls append bounded hub events containing identity, action, status,
normalized cost, bounded artifact identities/digests, and no raw arguments or payloads. Any
provenance-sink failure poisons the capability registry before another capability call or inventory
read; a post-effect sink failure is never downgraded to ordinary refusal or success.

## CI6 — authenticated northbounds
Web exposes `capabilities` and durable `capability_invoke`; MCP exposes `fleet_capabilities` and `fleet_capability_invoke`, reusing existing scope, quota, idempotency, and audit authority. Every mutation names an explicit `invoke|resume|reverify` action; MCP's JSON Schema expresses the three mutually exclusive field shapes.

## CI7 — explicit assembly
Deployments inject a closed registry, token ceiling, result-envelope ceiling, trusted repository root, and optional bounded per-capability context resolvers for multi-root or overlay operations. Resolvers may derive trusted context from logical request fields but cannot override actor, budget, cancellation, or the repository root. Baton invents neither artifact roots nor per-capability resource bounds. An empty registry is valid and visible.

## CI8 — acceptance
Reds cover registry/card validation, unknown/unadvertised ops, budgets, cancellation, malformed ACI, authority smuggling, resume/reverify, driver wiring, and web/MCP dispatch.
