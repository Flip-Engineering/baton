# Phase 29 — coordinator-owned capability invocation

## CI1 — one registry, no second control plane
`CapabilityRegistry` is injected into `createDriver()` and owned by Coordinator. It lists honest cards and dispatches capability operations; it owns no task, worker, integration, or publication authority.

## CI2 — bounded ACI calls
Invoke requires a registered capability, advertised operation, JSON-shaped arguments, positive deployment-bounded token budget, deployment-bounded ACI envelope, and optional cancellation. Results must carry `op/status/summary/payload/refs/cost/provenance`.

## CI3 — resume and reverify
Resume and reverify are public only when implemented and receive the same budget/cancellation policy. Reverify receives the registry-validated advertised operation explicitly; it cannot select a different operation from mutable claim data.

## CI4 — authority firewall
Capability output can never claim `mergeAuthority` or `verificationAuthority`; registry validation rejects either claim.

## CI5 — durable provenance
Started/completed/refused calls append bounded hub events containing identity, action, status, and artifact digests—never raw arguments or payloads.

## CI6 — authenticated northbounds
Web exposes `capabilities` and durable `capability_invoke`; MCP exposes `fleet_capabilities` and `fleet_capability_invoke`, reusing existing scope, quota, idempotency, and audit authority.

## CI7 — explicit assembly
Deployments inject a closed registry, token ceiling, result-envelope ceiling, trusted repository root, and optional bounded per-capability context resolvers for multi-root or overlay operations. Resolvers may derive trusted context from logical request fields but cannot override actor, budget, cancellation, or the repository root. Baton invents neither artifact roots nor per-capability resource bounds. An empty registry is valid and visible.

## CI8 — acceptance
Reds cover registry/card validation, unknown/unadvertised ops, budgets, cancellation, malformed ACI, authority smuggling, resume/reverify, driver wiring, and web/MCP dispatch.
