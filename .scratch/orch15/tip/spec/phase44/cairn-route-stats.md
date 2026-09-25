# Phase 44 — Cairn Rung 1 durable RouteStats and route advice

This contract makes verified fleet experience durable before Baton exposes broad causal recall.
The adaptive router remains a scheduling mechanism; Cairn turns its evidence into replayable local
knowledge and bounded advice. No worker result, provider prose, PM/project-manager service, homelab,
or caller-supplied outcome becomes routing authority.

## RS1 — atomic verified-outcome observation

The terminal trust transaction appends one `route.outcome_observed` event only for a hub-reverified
task outcome. It is atomic with the task terminal transition and accepted/unaccepted artifact
manifests. The event binds task ID and expected version, task class, run ID if present, exact route
key, harness/model/effort requested/resolved/observed tuple, model family, verified boolean outcome,
the mapped `verify.reverified` evidence, event time, schema version, and observation digest.

Worker claims, asserted completions, pre-verification cancellation, transport crashes, pending or
input states, and run-scorecard prose do not create observations. A failed hub check is a verified
loss; a passing hub check is a verified win.

## RS2 — exact identity and idempotency

One task contributes at most one observation. Exact terminal retry is zero-effect. A reused task,
idempotency key, verification evidence, route tuple, family, task class, or outcome with different
bytes refuses. Harness, installed version, exact model, effort, model family, and task class remain
distinct dimensions; legacy aliases are read-only migration inputs and never new observation keys.

## RS3 — durable projection and replay hydration

`CoordinationStore` projects immutable observations in coordination-sequence order and promotes one
verified `RouteStat` knowledge node per task, linked to the task and verification evidence. Startup
replay validates every observation before exposing the writer lease. `createDriver()` hydrates a
fresh `AdaptiveRouter` only from the durable ordered observations before any dispatch can occur.
Hydration is idempotent by task ID and reproduces bucket weights/counts/first-seen/last-used/seeding
byte-identically for the same policy and injected clock.

## RS4 — deployment-pinned learning policy

The durable route policy pins exactly `mode`, `halfLifeMs`, `explorationConstant`, `seedDiscount`,
`minSamplesForAdaptive`, and `defaultPriorSuccessRate`, with finite positive ranges and hard maxima.
The policy digest is recorded with each observation and checked on replay. A changed policy requires
an explicit later reconciliation contract; it cannot silently reinterpret historical observations.

Below the evidence floor, auto mode remains deterministic round-robin. Above it, decay,
same-family/task-class predecessor seeding, exploration, and concurrency-ceiling filtering retain
the existing router semantics. Seeding never crosses model families or task classes.

## RS5 — failure atomicity

Preparation validates the complete route observation before the terminal batch append. If the batch
write fails, no task terminal, artifact, RouteStat node, durable observation, or live-router update
is visible. The live router updates only after the durable batch returns. Replay/tamper failure
refuses readiness. Route-learning failure is never swallowed as a successful update.

## RS6 — bounded evidence-backed advice

Cairn optionally advertises read-only `route.advice` only when configured with the deployment
router and exact positive ceilings `maxCandidates`, `maxTaskTypeBytes`, `maxRows`, and `maxBytes`.
Input contains only one task class and a closed candidate list of exact route tuples plus current
in-flight/concurrency values. Callers cannot supply outcomes, weights, counts, timestamps, policy,
scores, selected route, or legacy aliases.

The result contains the policy digest, coordination high-water, effective mode, selected eligible
route or null, and a stable bounded row for each examined candidate: exact tuple, evidence version,
decayed verified wins/count, rate, exploration score when applicable, seeding source if any,
eligibility, and a closed selection reason. Advice is a snapshot, not a reservation or dispatch.

## RS7 — advice replay and provenance

Advice is deterministic for exact arguments, durable observation high-water, deployment policy,
and an injected `observedAt`. The ACI result is bounded JSON with no filesystem paths, prompts,
credentials, worker prose, verification output, raw event bodies, or provider quota state. Its
provenance declares deterministic read-only observation and denies worker, verification, merge,
approval, publication, and routing-mutation authority. Reverify recomputes the same advice and
detects observation/policy/argument substitution.

## RS8 — authenticated reachability

The existing generic authenticated web and MCP capability invoke/reverify surfaces reach
`cairn/route.advice` under `observe`/capability policy, repository scope, durable outer idempotency,
quota, and audit. No new web command, MCP tool, direct outcome write, or second router exists.

## RS9 — adversarial gates

Red tests cover verified win/loss versus forged success, asserted completion and cancellation;
terminal-batch failure; exact retry and same-task conflict; restart hydration changing an adaptive
pick; model/effort/family/task-class collision; decay and same-family seeding; below-threshold
round-robin; saturated candidates; policy mismatch; event/evidence/task/time/digest tamper; advice
candidate/row/byte/task-class max+1; caller outcome/stat injection; cross-repository northbound;
reverify drift; and knowledge RouteStat/task/evidence lineage.

## RS10 — live and recursive proof

A live Baton run completes verified tasks on at least two exact route tuples, restarts the driver,
and shows the same durable evidence affecting a later advice/pick without replay double-counting.
Recursive review uses an exact selected harness/model/effort, fresh verification, confirmed kill,
and full process/worktree/runtime/branch/writer reap. Current environment-red harnesses are recorded
as refusal evidence, not counted as provider-backed success.

Phase 45 remains supervised startup session recovery/auto-rejoin. Phase 46 remains the attested
representation review packet. Causal audit/temporal-contradiction hardening and bounded lexical/
graph recall follow RouteStats; none of those catalogued systems are deleted by this ordering.
