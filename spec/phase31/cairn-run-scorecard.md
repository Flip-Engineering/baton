# Phase 31 — Cairn Rung 0 sealed run scorecard

## CR1 — durable run identity

An orchestrator may supply one bounded `runId` independently of task, worker, harness, model, and
effort. Coordinator, web spawn, MCP spawn, durable task state, replay, public handles, and every
operational event preserve it. A task belongs to at most one run; missing run identity remains
honestly `null` and is not guessed from names.

## CR2 — one-way run closure

`run.scorecard` seals a known run only when every member task is terminal. Sealing atomically pins
the coordination upper bound, each member worker's operational-log tail, sorted task membership,
and scorecard digest. Unknown/empty/nonterminal runs refuse. No task may be admitted to a sealed
run. Repeated closure is idempotent only for the identical sealed run.

## CR3 — authoritative deterministic row

The row is computed without a model from events at or below the sealed bounds. It contains task
outcomes, verified versus asserted completions, interventions grouped by kind and actor, unresolved
approvals, normalized token/USD use, and per-worker/route outcomes. Free-form
`definitionOfDone` yields an explicit unavailable coverage dimension; Baton never invents verified
DoD-item counts.

## CR4 — content-addressed ACI capability

The `cairn` capability advertises interactive deterministic `run.scorecard`. Invoke returns one
bounded row plus a content-addressed full artifact. Resume is unnecessary for Rung 0. Reverify
loads the sealed record and artifact, reconstructs from the exact bounds, and fails on missing,
tampered, drifted, or attribution-incomplete evidence.

## CR5 — atomic knowledge promotion

Successful closure atomically materializes exactly one verified `Run` knowledge node per `runId`,
one scorecard `Artifact` node, `Contains` edges to every member `Task`, and a `ProducedBy` edge from
the artifact to the run. Evidence names terminal/verification coordination events. Orphan bytes
written before a failed append grant no promoted scorecard authority.

## CR6 — generic authenticated reachability

Cairn uses Phase 29's coordinator-owned registry and existing authenticated web/MCP capability
commands. There is no Cairn-specific control plane. Run identity is accepted by MCP spawn as well
as web/direct spawn; capability closure retains existing scope, quota, idempotency, audit, bounds,
and explicit action selection.

## CR7 — replay and refusal truth

Restart reconstructs task run membership, sealed runs, scorecard nodes/edges, and identical output.
Missing operational evidence resolver, tail gaps, mixed-run attribution, digest drift, append loss,
or knowledge endpoint inconsistency fails closed. Worker self-report never counts as verification.

## CR8 — acceptance and exclusions

Reds cover run propagation, restart, duplicate/mixed membership, post-close admission, nonterminal
closure, verified/asserted spoofing, approvals/interventions, delta/cumulative usage, exact route
rows, deterministic artifact identity, tamper/reverify, atomic promotion, append failure, web/MCP
reachability, and recursive process/worktree reap. RouteStats feedback, recall ranking, export,
dashboarding, PM/homelab integration, and later Cairn graph rungs are excluded from this phase but
remain catalogued.
