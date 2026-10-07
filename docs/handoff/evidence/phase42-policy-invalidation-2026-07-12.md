# Phase 42 policy-epoch reconciliation handoff — 2026-07-12

## Outcome

Phase 42 ships deployment-card-derived reuse policy epochs. `createDriver()` now validates the
complete normalized Quartermaster vet-policy commitment, acquires exclusive durable writer
authority, and synchronously reconciles the local coordination graph before exposing Coordinator
authority. A policy change cannot leave an old-policy Decision, dossier/risk Finding, exact reader,
or adverse guard silently current.

This is a local deployment-neutral causal projection. Project-manager remains design inspiration
only, and no homelab or project-manager runtime is imported, queried, mutated, or required.

## Implemented contract

- The registered Quartermaster card exposes a fixed schema/policy ID, complete normalized
  secret-free projection, and SHA-256 commitment. The runtime configuration is cross-checked
  against that pinned card; callers, web/MCP inputs, old dossiers, and environment values cannot
  nominate the active policy or reconciliation targets.
- First baseline, same-policy restart, and `A → B → A` cycling are synchronous and replay-bound.
  Matching pre-head legacy Decisions gain an `Informed` edge to the baseline Constraint; unknown or
  mismatching legacy Decisions, Findings, and guards are closed or migrated rather than
  grandfathered.
- One append derives and binds the complete sorted Decision, binding, Finding, guard, reader,
  prior-Constraint, and observed-policy-hash projection. It advances bitemporal validity,
  contaminates exact readers, retains immutable artifacts, and projects observed `Constraint`,
  `Supersedes`, `Affects`, and `Informed` lineage atomically.
- Old adverse guards become explicitly policy-stale but remain blocking. Green current-policy
  review can migrate inherited adverse state through `DerivedFrom` but cannot clear it or authorize
  borrow. Fresh current-policy adverse evidence records guard and risk-Finding `Supersedes`
  lineage.
- Exact replay validates the policy card and projection, normalized sorted/unique allow/deny lists,
  actor/key/time, target derivation, authoritative Finding creation lineage, graph identities,
  transition digest, and six deployment ceilings: Decisions, guards, affected reads, examined
  state rows, observed policy hashes, and exact persisted event bytes.
- A unique fail-closed claim protocol closes the pre-lease creation race. The exact-token writer
  lease covers the exposed driver lifetime and raw store mutation, stale store projections reload
  under lease, dead well-formed claims/leases recover, malformed/live ownership refuses, and lost
  tokens fence every authority write. Close rejects locally owned live/idle transports and in-flight
  authority operations until kill/reap completes; replay-only handles do not impersonate native
  ownership.
- Authenticated web and MCP expose the same sanitized commitment, accept no reconciliation command,
  and refresh exact outer idempotency retries as current or historical after a policy transition.
  The internal snapshot honestly retains complete append-only transition history; only cards and
  individual transition/northbound observations are claimed bounded.

## Validation

- Phase 42 focused policy contracts: **16/16**.
- Canonical suite: **911/911**.
- Isolated live policy proof: **13/13** checks. It exercised two real normalized Quartermaster
  policies over one durable store, zero oracle calls during reconciliation, complete Decision/
  Finding/guard closure, non-clearing green migration, local causal lineage, exact bounded replay,
  writer handoff, and empty worktree/runtime/branch ownership. The oracle was an injected
  deterministic mock and no native worker was created, which the evidence records explicitly.
- Live artifact: `docs/reference/evidence/phase42-policy-invalidation-live-2026-07-12/`.
- Exact harness/model/effort routing remains tracked and completed in GitHub issue **#2**, including
  `gpt-5.6-sol`/low and Grok route examples; Phase 42 does not regress that contract.

## Recursive Baton evidence and frictions

- Phase 42 was checkpointed at commit `345f680`, then Baton itself concurrently admitted exact
  `grok-4.5`/low and `grok-composer-2.5-fast`/low review tasks through isolated temporary checkout/
  worktrees pinned to that commit. Both were independently refused before provider spawn with the
  fixed error `Authentication required`; the recorded `grok models` probe likewise says `You are
  not authenticated`. Neither task produced a provider-observed model or native PID. Baton removed
  both task worktrees, metadata, runtime scopes, and branches and released its writer lease/claims.
  The run is preserved as red evidence rather than called a live provider-concurrency or kill pass.
- This separates two claims honestly: Phase 42 policy reconciliation is live-proven without native
  workers, while the attempted recursive two-Grok control pass currently proves clean refusal
  cleanup, but cannot prove concurrent native PIDs or provider-active kills until Grok
  authentication is restored. Earlier lifecycle evidence remains historical and is not substituted
  for this run.
- The recursive attempt exposed a practical operator friction: projecting a present auth file is
  insufficient when the Grok CLI itself considers that credential unauthenticated. Baton did not
  parse, expose, or log credential values and did not fall back to another model or harness.

## Explicit later boundary

Adverse-only provider feed/webhook/poll ingestion is next. Independently verified Sigstore/SLSA,
the exact `internal` decision, trusted release/advisory identity, true vulnerable-function
reachability, proposed-plan approval, positive clearance/non-resurrection, additional ecosystems,
Socket/full-SCA enrichment, composite `fleet_reuse`/`fleet_provenance` surfaces, and deeper Cairn
recall/promotion remain separate catalogued contracts. Semantic cross-policy Decision
`Supersedes`/resurrection is also still pending; Phase 42 preserves adverse guard/Finding
supersession without fabricating a new-policy Decision. There is no external project-manager or
homelab runtime integration.
