# Phase 62 — first-class Goal/Plan web authority

Phase 62 makes the goal and approved execution plan durable orchestration inputs rather than prose
that a worker can weaken. It follows Phase 60's recovery safety transaction and Phase 61's first
graph-backed Representation producers. It reuses Baton's coordination store, coordinator, web
authentication, MCP principal binding, task DAG, budgets, and event stream; it creates no parallel
planner or browser-owned state machine.

## GP1 — closed authority and operation vocabulary

The first vertical has four direct coordinator operations and matching authenticated web commands:

- `goal_define` creates a bounded immutable goal version;
- `plan_propose` creates a bounded plan version against one exact goal version;
- `plan_approve` records a distinct-authority decision over one exact plan digest; and
- `goal_plan_status` returns the bounded goal, plan, approval, DAG, budget, and dispatch projection
  at an exact coordination boundary.

MCP exposes the same operations as `fleet_goal_define`, `fleet_plan_propose`,
`fleet_plan_approve`, and exactly `fleet_goal_plan_status`; all call the same coordinator methods.

Clients cannot call generic coordination mutation, choose event kinds, or write folded state. The
web tier and MCP are adapters over these operations. Unsupported amendment, deletion, publication,
integration, deployment, rollback, or live budget commands fail typed rather than being emulated.

## GP2 — append-only versioned goal truth

A goal version contains closed, byte-bounded fields for repository/run scope, objective,
definition-of-done items, constraints, risk class, total initial token/USD/wall/provider-turn
budgets, and optional predecessor. The server derives `goalId`, version, canonical content digest,
actor, observation time, and validity coordinates. A caller supplies no grounding, worker prompt,
event identity, validity version, or audit actor.

Goals are append-only. An amendment creates a new version using compare-and-swap against the exact
live predecessor; it never edits or deletes an earlier version. Approved plans remain pinned to the
goal version they reviewed. Tightening a goal does not silently rewrite an executing plan, and a
new plan cannot weaken inherited definition-of-done or constraints. Cancellation/retirement and
cross-version migration remain later explicit operations.

## GP3 — bounded plan DAG and budget allocation

One plan version contains a finite DAG of stable node keys. Every node has a bounded objective,
definition-of-done subset, dependencies, repository-relative scope, risk, initial token/USD/wall/
provider-turn allocation, allowed route constraints, and declared capability/effect classes.
Dependencies must name nodes in the same version; self edges, cycles, duplicates, dangling nodes,
and ambiguous order refuse.

Plan allocations may not exceed the exact goal version's budgets, and each node allocation must fit
deployment policy. Shared or contingency budget must be represented explicitly rather than counted
twice. The plan digest covers canonical node and edge order, budgets, goal digest, policy digest,
and all constraints. Caller order, whitespace, or prose formatting cannot change graph semantics;
any semantic field change creates a new plan version requiring a new approval.

## GP4 — proposer and approver are distinct authorities

Authentication derives stable user, session, credential, and actor identity. Authorization has
separate `goal:define`, `plan:propose`, `plan:approve`, `goal:observe`, and `plan:dispatch` powers.
An approval requires `plan:approve`, repository/run scope, exact goal version, exact plan version
and digest, expected approval state, and a fresh session. The proposer of a plan cannot approve that
same version, even when the account also holds both roles; deployment may require a still stronger
two-person or risk-tier policy.

Approval is an append-only decision with server-derived actor and fixed `approved|rejected`
disposition. Compare-and-swap admits at most one live disposition for the exact version. Rejection,
supersession, expiry, policy drift, or goal-version replacement cannot be bypassed by replaying an
older approval. Credentials, raw session material, and arbitrary rationale prose are never copied
into goal/plan projections.

## GP5 — plan-gated spawn is one CAS transaction

Deployment policy names the repositories/runs for which an approved plan is mandatory; callers
cannot opt out inside that scope, and Phase 62 acceptance runs with Baton itself in the mandatory
scope. Every ordinary spawn there must name exact `goalId`, goal version, `planId`, plan version,
approved plan digest, and plan node key. Before any worktree, process, provider, capability, or tool
effect, the coordinator verifies:

1. the goal and plan versions are live and repository/run scoped;
2. approval is current under the deployed risk policy;
3. every dependency node has the required durable accepted outcome;
4. node scope, effect class, independent harness/exact-model/effort route constraints, and initial
   budget cover the requested spawn; and
5. the node remains `ready` at its expected dispatch version.

One append/CAS atomically creates the task/refinement linkage, reserves the node's budget, records
the exact approved goal/plan digests in the immutable Brief, and advances the node from `ready` to
`dispatched`. A concurrent winner makes every loser stale before effects. Append loss admits no
task, budget, worktree, process, provider turn, or tool call. Replay cannot swap the brief, route,
scope, budget, approval, or node while retaining an idempotency key.

Worker messages, provider output, recalled knowledge, Scratch, and capability results have no
Goal/Plan mutation authority. Follow-ups and recovery remain bound to the same goal/plan/node unless
an explicit later amendment transaction authorizes migration.

## GP6 — durable status and event-stream truth

`goal_plan_status` (and MCP `fleet_goal_plan_status`) folds only replay-validated coordination
events through a requested authorized upper bound. It reports version/digest identities, approval
disposition, node dependency and dispatch states, initial/reserved/consumed/released budget totals,
linked task IDs and terminal outcomes, and closed refusal codes. It excludes credentials, prompts,
full worker prose, raw provider payloads, host paths, and hidden policy internals.

Authenticated SSE/WebSocket delivery carries the same append-only goal/plan/approval/dispatch
events and resumable cursors as other coordination state. Browser disconnect, reconnect, stale UI,
or lost command response never changes a goal, revokes approval, releases a node, or cancels work.
Durable command reconciliation returns the original admitted outcome without replaying an effect.

## GP7 — authenticated web and MCP parity

HTTPS and MCP schemas expose the four closed operations with no client actor field and no unknown
privileged fields. Web preserves TLS, OIDC/session, exact Origin/CSRF, repository/run authorization,
idempotency, expected-version fences, request/cost quotas, audit order, and status reconciliation.
MCP binds one deployment principal and the same repository/run scopes, schemas, quotas,
idempotency, CAS values, and coordinator methods. Direct, web, and MCP calls produce the same
digests, events, statuses, and typed refusals for equivalent authenticated authority.

Observation does not imply proposal, proposal does not imply approval, approval does not imply
dispatch, and emergency stop remains independent. No northbound may bypass sandbox, credentials,
provider governance, trust gate, integration, or publication policy through Goal/Plan authority.

## GP8 — replay, restart, and threat gates

Restart reconstructs every goal/plan version, disposition, node state, dependency edge, budget
reservation, and task linkage from the append-only log. Exact retries coalesce; same-key changed
bytes, predecessor/version drift, plan-digest substitution, approval replay, or task-link
substitution conflicts. A truncated tail fails closed and no projection repairs it from browser or
model prose.

Reds cover missing/forged auth, IDOR and cross-repository/run references, client actor/grounding/
event fields, overlong or secret-shaped content, unknown fields, goal weakening, stale predecessor
CAS, duplicate versions, malformed/cyclic/dangling DAGs, budget overflow/double allocation,
self-approval, stale/rejected/superseded approval, policy drift, dependency incompleteness, route/
scope/effect mismatch, and concurrent plan-node spawn. Crash injection covers every pre-effect
append boundary, command-response loss, restart, and exact replay. Tests prove zero process,
worktree, provider, tool, capability, or budget effects on every refusal.

Direct/authenticated-web/MCP parity, resumable stream/status reconciliation, canonical max+1 byte
and count ceilings, audit-sink poison, kill/reap, and recursive Baton-on-Baton plan-gated work are
acceptance requirements.

## GP9 — retained later authority

This phase defines initial immutable budgets but does not authorize live budget increases,
reallocation, quota borrowing, or provider-seat scheduling changes. Those require explicit
amendment policy, distinct authorization, affected-task fencing, and append-only audit contracts.

Distinct `integration_approve`, `publication_approve`, `deploy_approve`, and `rollback_approve`
commands—and their fixed-principal `fleet_*` MCP counterparts—remain explicit later authority.
They require their own effect-specific policy, evidence, CAS, separation-of-duty, and audit
contracts; plan approval cannot substitute for any of them. Health-gated rollout, credential
administration, goal cancellation, plan migration, multi-goal portfolio scheduling, richer visual
planning, Streamable HTTP MCP Tasks, and daemon supervision likewise remain separate later
capabilities.

Goal/Plan state is self-contained Baton coordination state. This phase introduces no homelab,
project-manager runtime, external knowledge service, credential, query, mutation, or integration
dependency.
