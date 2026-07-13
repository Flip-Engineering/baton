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
live predecessor; it never edits or deletes an earlier version. A plan and every task already
dispatched from it remain pinned to the exact goal version they reviewed: replacement does not
silently rewrite, cancel, or migrate that admitted work. Replacement does make every still-
undispatched node of an older plan stale, so the old approval cannot authorize new work. A new plan
cannot weaken inherited definition-of-done or constraints. Cancellation/retirement and cross-
version migration remain later explicit operations.

## GP3 — bounded plan DAG and budget allocation

One plan version contains a finite DAG of stable node keys. Every node has a bounded objective,
definition-of-done subset, dependencies, repository-relative scope, risk, initial token/USD/wall/
provider-turn allocation, allowed route constraints, declared capability/effect classes, and a
closed executable verification contract. That contract includes the exact command/arguments,
working-directory scope, environment-name allowlist, expected exit/result, timeout, output bounds,
and any required predecessor evidence; it contains no shell interpolation, ambient credential, or
worker-selected executable. Verification is immutable plan-owned authority rather than caller
Brief prose or a worker suggestion. Dependencies must name nodes in the same version; self edges,
cycles, duplicates, dangling nodes, and ambiguous order refuse.

Plan allocations may not exceed the exact goal version's budgets, and each node allocation must fit
deployment policy. Shared or contingency budget must be represented explicitly rather than counted
twice. The plan digest covers canonical node and edge order, budgets, goal digest, policy digest,
all constraints, and every byte of each canonical verification contract. Caller order, whitespace,
or prose formatting cannot change graph semantics; any semantic field change, including a command,
argument, timeout, expected result, or evidence requirement, creates a new plan version requiring a
new approval.

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
older approval to dispatch new work. Those later changes do not retroactively rewrite an already-
dispatched task, whose immutable goal/plan/node linkage remains auditable. Credentials, raw session
material, and arbitrary rationale prose are never copied into goal/plan projections.

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

The coordinator does not trust a caller-supplied Brief for any approved field. It derives one
authoritative immutable server Brief from the approved goal and node: objective, inherited
constraints, definition of done, scope, exact verification contract, route, capability/effect
classes, budget, dependency evidence, and goal/plan/node identities. A caller may submit matching
convenience fields, but any omission that is required for comparison or any substitution,
weakening, widening, or conflict refuses before mutation; caller prose is never used to override
the authoritative Brief.

One replay-validated append/CAS transaction atomically records `plan.node_dispatched` and
`task.created`, reserves the node's budget, fixes the task/refinement and dependency linkage,
records the exact approved goal/plan digests and authoritative Brief, and advances the node from
`ready` to `dispatched`. Its batch identity, entry order, shared coordinates, cross-references, and
content digests are validated as one indivisible replay unit; a torn, reordered, duplicated, or
partially matching transaction fails closed. This durable transaction occurs before any scheduler
capacity reservation, worktree/runtime allocation, provider/process start, provider turn, tool
call, or capability effect. A concurrent winner makes every loser stale before effects. Append
loss admits no task, node/budget reservation, capacity reservation, worktree/runtime, process,
provider turn, tool call, or capability effect. Replay cannot swap the Brief, route, scope, budget,
approval, verification contract, or node while retaining an idempotency key.

If the command response is lost, or Baton crashes after this transaction but before or during
downstream admission, restart reconstructs the one dispatched node and one task identity from the
transaction. Reconciliation returns that original admission and may resume downstream admission
for that same task under its existing fences; it never emits another `task.created`, reserves the
node or budget again, allocates a second worker identity, or starts a second spawn. A task left
between durable dispatch and capacity admission remains visibly pending/reconcilable (or reaches a
durable terminal refusal under explicit lifecycle policy), not silently rolled back or cloned.

Worker messages, provider output, recalled knowledge, Scratch, and capability results have no
Goal/Plan mutation authority. Scratch, refinements, follow-ups, recovery, and restart paths may only
continue the already-linked task or enter the same Goal/Plan dispatch transaction; none may emit an
unchecked `task.created`, substitute a new Brief or verification command, reopen a dispatched node,
or create work against a stale undispatched node. Follow-ups and recovery remain bound to the same
goal/plan/node unless an explicit later amendment transaction authorizes migration.

## GP6 — durable status and event-stream truth

`goal_plan_status` (and MCP `fleet_goal_plan_status`) folds only replay-validated coordination
events through a requested authorized upper bound. It reports version/digest identities, approval
disposition, node dependency and dispatch states, initial/reserved/consumed/released budget totals,
linked task IDs and terminal outcomes, and closed refusal codes. It excludes credentials, prompts,
full worker prose, raw provider payloads, host paths, and hidden policy internals.

Authenticated SSE/WebSocket delivery carries the same append-only goal/plan/approval/dispatch
events and resumable cursors as other coordination state. Browser disconnect, reconnect, stale UI,
or lost command response never changes a goal, revokes approval, releases a node, or cancels work.
Durable command reconciliation returns the original admitted transaction and task identity without
replaying an effect or performing a second spawn.

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
reservation, authoritative Brief, verification contract, and task linkage from the append-only
log. It also distinguishes an already-dispatched task pinned to an older goal from an undispatched
older-plan node made stale by goal replacement. Exact retries coalesce to the original transaction
and task; same-key changed bytes, predecessor/version drift, plan-digest substitution, approval
replay, verification substitution, or task-link substitution conflicts. A truncated tail or
invalid dispatch/task transaction fails closed and no projection repairs it from browser, Scratch,
recovery prompt, or model prose.

Reds cover missing/forged auth, IDOR and cross-repository/run references, client actor/grounding/
event fields, overlong or secret-shaped content, unknown fields, goal weakening, stale predecessor
CAS, duplicate versions, malformed/cyclic/dangling DAGs, budget overflow/double allocation,
self-approval, stale/rejected/superseded approval, policy drift, dependency incompleteness, route/
scope/effect/verification mismatch, caller-Brief weakening, and concurrent plan-node spawn. Crash
injection covers every pre-effect append boundary, the committed-dispatch/pre-capacity boundary,
command-response loss, restart, and exact replay. Tests prove zero scheduler-capacity, process,
worktree/runtime, provider, tool, capability, or budget effects on every refusal, and prove exactly
one durable task and no second spawn when reconciliation follows a committed dispatch.

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
