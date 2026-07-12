# Phase 29 coordinator-owned capability invocation evidence — 2026-07-12

## Outcome

CI1–CI8 ship. `createDriver()` constructs one capability registry from a deployment-supplied closed
set; Coordinator owns the only driver handle; authenticated web and MCP reuse its card, invoke,
resume, and reverify methods. The registry owns no worker, verification, integration, publication,
or task authority. No homelab integration or dependency was added.

## Executable boundary

- Registration freezes honest, bounded JSON cards and advertised operations.
- Invoke accepts bounded JSON arguments, a positive deployment-ceiling token budget, optional
  cancellation, and a deployment-ceiling result envelope.
- Deployment context objects/resolvers can add trusted multi-root or overlay fields, but cannot
  replace actor, budget, repository root, or signal.
- Reverify receives the exact registry-validated operation explicitly; mutable claim data cannot
  switch operations. All existing Atlas modules now implement that common signature.
- ACI results must carry `op/status/summary/payload/refs/cost/provenance`. Any non-false
  `mergeAuthority` or `verificationAuthority` claim is refused, including string smuggling.
- Started/completed/refused hub events retain bounded identity/status/digests only. A non-empty
  registry requires that sink; sink failure becomes sticky `capability_record_unavailable` before
  another effect or inventory read.
- `createDriver()` neither accepts nor returns a raw registry handle, so process-local callers do
  not get a coordinator-bypassing control path.

## Northbound and real Atlas proof

Web adds observe-only `capabilities` and durable control `capability_invoke`; MCP adds
`fleet_capabilities` and stateful `fleet_capability_invoke`, bringing the deterministic inventory
to ten tools. Invoke/resume/reverify reuse existing authentication, repo scope, CSRF/origin where
applicable, quota, audit, and idempotent admission. Permanent capability-policy refusals are stable
non-success outcomes and do not disclose module errors.

The Phase 29 red suite injects a real `AtlasStructuralDelta`, supplies deployment-owned
`beforeRoot`/`afterRoot`, invokes ast-grep structural comparison through `createDriver()` and
Coordinator, then reverifies the exact operation successfully. This replaces the prior fixture-only
proof and closes Phase 28's library-only invocation gap for any explicitly registered module.

## Validation

- 92/92 Coordinator, Phase 29, web, and MCP surrounding focused tests passed.
- 74/74 Atlas/reverify compatibility and Phase 29 tests passed after normalizing the common
  reverify signature.
- Canonical `npm test` passed 793/793 and reaped its owned fixture root.
- `git diff --check` passed; the operator-owned `.gitignore` change was never staged.

## Recursive Baton evidence

The first default-repository attempt failed before native spawn because the main checkout was dirty.
Baton still terminalized and reaped both tasks. The reusable profile now preflights this condition
and directs callers to a clean clone/worktree instead of surfacing the adapter's secondary
"worktree required" error. That friction is retained under
`docs/reference/evidence/phase29-capability-invocation-initial-grok-review-2026-07-12/`.

Final closure at `cdeb84f` ran exact `grok-4.5` and `grok-composer-2.5-fast` concurrently through
Baton in a clean isolated clone. Both models were requested, resolved, and provider-observed on
distinct overlapping PIDs; both reports were captured from fresh sparse verification with accept
true; both normal kills were confirmed; and every PID, worktree, runtime scope, metadata file, and
task branch was gone. Both reviewers reported no actionable CI1–CI8 defect. Raw evidence is under
`docs/reference/evidence/phase29-capability-invocation-final-clean-grok-review-2026-07-12/`.

## Honest remaining boundary

Phase 29 ships the capability invocation substrate, not automatic module discovery and not the
remaining capability products. Deployments must still instantiate desired Atlas modules and choose
artifact roots/bounds/contexts. Web/MCP do not yet expose mid-invocation cancellation. Vantage,
Evidence Ladder, Skill Forge/computer use, Cartographer/Quartermaster, and Cairn remain pending in
the Phase 28 dependency order.

## 2026-07-12 contract-closure erratum

The post-Phase-29 audit found and closed specification drift before another capability was added.
ACI status/cursor/cost/ref invariants are now executable; completed events carry bounded normalized
cost and artifact identities; cards derive action support and distinguish inline operations from
task-class operations requiring the future task plane; task-class operations typed-refuse rather
than running synchronously without control-plane cancellation; and MCP/Web require an explicit
invoke/resume/reverify action, with MCP JSON Schema expressing the mutually exclusive shapes.
Formal ACI, Phase-16 MCP, `createDriver()` JSDoc, and current-status prose now match that behavior.
