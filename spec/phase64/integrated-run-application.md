# Phase 64 — integrated Run application

Implementation status: the direct exact-route vertical now ships locally through concise/defaulted
intent, immutable deployment profiles, readable Plan preview, distinct approval, restart-safe
approved-node scheduling, bounded credential-filtered RunView, typed answer, server-fenced steering,
durable Run-scoped stop/reap, and separately authorized exact deployment shutdown. Direct,
authenticated Web/browser, and MCP call the same registry. Accepted commits are pinned before
cleanup; terminal evidence and non-merging result adoption are durable Run operations.
`application.shutdown` is fleet-wide; it is intentionally not called `run.close`. The authenticated
one-shot `baton` Web client and deployment-owning `baton serve` lifecycle now ship; recovery, structured
semantic review, multi-node scheduling, and cursor follow remain acceptance-red below.

Baton's shipped control, replay, Goal/Plan, routing, verification, settlement, process ownership,
and drain machinery is a fleet kernel. Phase 64 now places one durable Run facade over that kernel
for embedded agents, authenticated Web/browser clients, and MCP. The remaining product gap is not
another worker primitive: materialized result export, Run-level
recovery, semantic review, and multi-node composition must remove the remaining caller-side assembly.

The facade is a projection and workflow compiler, never a second source of truth. Goal, Plan,
task, worker, process, verification, knowledge, integration, and drain records remain authoritative
in their existing stores. No homelab or external project-manager integration is introduced.

## UA1 — one concise intent and deployment-owned profiles

The normal input is one bounded objective, one named repository/deployment profile, and either an
exact `harness/model@effort` tuple or `auto`. Callers do not author Briefs, plan gates, task IDs,
fences, idempotency coordinates, verification shell strings, capability/effect arrays, or evidence
runner code.

A closed deployment profile supplies:

- allowed repository-relative scope and an optional narrower caller-selectable scope;
- one argv-based verification contract and named additional gates;
- risk floor, Goal and node budgets, provider turns, capability/effect classes;
- allowed exact routes plus an optional auto-routing policy;
- independent semantic-review policy and route constraints;
- session/recovery policy, toolchain projection, credential references, and cleanup policy; and
- bounded narrative/evidence/status limits.

Profiles are immutable, content-digested, credential-value-free, and validated before driver or
provider effects. A caller may narrow authority or choose within an allowed set; it cannot widen
scope, budget, routes, effects, secrets, or verification.

## UA2 — deterministic intent compiler

`run.start(intent)` compiles the objective and profile into one immutable Goal and a deterministic
one-node Plan by default. A separately registered planner may propose a bounded multi-node Plan,
but the output passes through the same existing Goal/Plan normalizers. The compiled Plan binds the
profile digest and exact route policy. The application never fabricates a free-text Brief; dispatch
uses the Coordinator's authoritative Brief derivation.

Compilation is idempotent under one caller-supplied or application-derived Run ID. Exact retry
returns the same Goal/Plan. Changed intent, profile, scope, route, or authority conflicts. The Run
stops in `awaiting_plan_approval` before worktree, runtime, process, provider, tool, capability, or
repository effects.

## UA3 — approval is a visible product checkpoint

`run.start` returns a readable Plan preview, exact digest, risk/budget/route summary, and one
`approve_plan` next action. It does not auto-approve by inventing a principal. `run.approve` requires
an authenticated principal distinct from the Plan proposer, binds the displayed Plan digest, and
then causes the application dispatcher to admit each dependency-ready node exactly once.

Lost approval/dispatch responses reconcile to the existing durable Goal/Plan and task records.
The caller never supplies plan coordinates or duplicates authoritative Brief fields. Denial leaves
the Run terminal without provider effects. Amendment remains a separate later authority, never an
implicit recompile behind an approval.

## UA4 — one RunView is the operator truth

Every application operation returns one bounded, credential-free `RunView` containing:

- Run ID, objective, profile digest, current phase, cursor, and explicit next actions;
- Goal/Plan digest, approval state, dependency/node progress, and terminal outcomes;
- requested/resolved/observed harness, model, and effort plus auto-route rationale;
- allocated, reserved, consumed, released, held, and overrun budget state;
- worker/process state and pending question/approval/steering attention;
- machine verification, independent semantic-review, integration/publication state;
- process/worktree/runtime/branch/capacity/writer ownership and cleanup state;
- content-addressed evidence references; and
- a short provenance-linked narrative synthesized from Story and durable coordination facts.

The same view also carries one bounded progress board for intent, Plan, dispatch, provider turn,
fresh verification, semantic review, accepted-result selection, and owned-resource cleanup. It is
a projection of those authorities, not another event ledger. A long provider turn therefore reads
as an active provider stage with resolved/observed route truth, while an artifact that exists before
the provider terminal handshake cannot appear verified or adopted.

The view distinguishes `mechanically_verified`, `semantics_unverified`, `semantic_reviewed`,
`revision_required`, and `failed`; passing tests or Markdown shape never implies semantic review.
Raw events and receipts remain available as advanced evidence, not the normal UI.

## UA5 — one command bus, four thin adapters

`BatonApplication` owns the application command bus:

```text
run.start    run.status    run.approve   run.wait    run.answer    run.steer    run.stop
run.evidence run.adopt
```

`run.steer` resolves a current Run-owned worker and fence inside the application, accepts
`nudge|now|turn` plus an explicit reason, and is projected by authenticated Web/browser and MCP.
`run.stop` atomically fences later Goal/Plan/dispatch/task-claim effects in durable coordination,
snapshots exact task/worker targets, kills/reaps only that set, and attaches a bounded digest-bound
receipt to the RunView. Pending stops reconcile before approved-node scheduling after restart; one
stopped Run never closes the coordinator, writer, transports, or another Run. Accepted verification
pins the exact commit under Baton's protected result namespace before cleanup. `run.evidence`
returns a bounded content-addressed manifest; `run.adopt` binds its displayed digest and records a
two-phase, restart-reconcilable selection receipt without touching main, index, working tree, or a
remote. `run.recover` and materialized export remain acceptance-red.
Adoption leaves the Run at `work_completed` while semantic review is unverified; selection is not
completion. Only the later configured semantic/integration gates may advance a Run to `completed`.
`application.shutdown` is a deployment-host lifecycle
operation, not a Run command; authenticated Web and MCP do not expose it.

Direct embedding, `baton`, authenticated Web, and MCP validate transport identity and call this
same bus. They do not maintain separate schemas, authorization maps, dispatch switches, or result
folds. Existing low-level Coordinator/Web/MCP tools remain an explicitly advanced compatibility
surface while migrations proceed; documentation no longer presents them as the primary agent API.

The primary CLI vocabulary is:

```text
baton doctor
baton run start OBJECTIVE (--exact HARNESS/MODEL@EFFORT | --auto) --profile PROFILE
baton run status RUN_ID [--wait DURATION | --follow]
baton run approve RUN_ID --plan DIGEST
baton run answer RUN_ID REQUEST_ID (--allow | --deny | --text TEXT)
baton run steer RUN_ID TARGET (--nudge | --now | --turn) TEXT --reason REASON
baton run stop RUN_ID --reason REASON
baton run recover RUN_ID
baton run evidence RUN_ID [--json | --export DIR]
baton serve
```

Foreground CLI and daemon hosts finalize the deployment authority they own internally. A one-shot
CLI must not pretend it can close one Run by shutting down a shared fleet.

The shipped one-shot `baton` is deliberately a bearer-authenticated client of `/v1/commands` and
uses the same strict envelope, idempotency admission, reconciliation, authorization, and RunView as
the browser. It owns no provider process and therefore has no fleet-shutdown path. Provider or Web
credentials are environment-injected and forbidden from command arguments. `baton serve` loads a
deployment-policy factory, closes Web admission first, and then executes host-only exact application
shutdown on listener failure, `SIGINT`, or `SIGTERM`. Cursor `--follow` remains unavailable until
the resumable Run cursor is implemented.

## UA6 — durable orchestration, attention, and recovery

The application scheduler dispatches dependency-ready nodes, folds attention, and reconstructs the
Run across restart from durable authority. `run.status --wait` and equivalent Web/MCP operations
use one resumable cursor and return bounded narrative changes, not caller-side polling loops over
unrelated projections.

Questions and approvals become typed next actions and resolve exactly once. Steering discovers the
current fence server-side; stale client state returns a refreshed RunView rather than misdelivery.
Run stop is the ordinary exact-scope safety path; worker kill and fleet drain remain advanced
human-to-Coordinator emergency paths.

Recovery must be Plan-authorized. A profile/Plan may commit an attach-only exact-session policy and
bounded attempt count. `run.recover` uses Phase 60 identity/reap order. A Run without that authority
returns an actionable amendment requirement; ambiguous dispatch remains `operator_required` and is
never automatically redelivered.

## UA7 — structured semantic evidence

Independent semantic review returns structured findings rather than relying on prose headings.
Every P0/P1 claim binds severity, claim text, source SHA, repository-relative path, exact range,
range/content digest, supporting test or Representation references, and required correction.
Plain code checks source/range/digest existence, pinned test execution, and reviewer independence.
The configured semantic oracle then records support, contradiction, or unverifiable disposition.

Fabricated, stale, substituted, or source-contradicted anchors cannot yield `semantic_reviewed`.
Disagreement is preserved. Required findings hold the Run at `revision_required`; they are not
normalized into PASS.

## UA8 — final evidence and deployment close are product behavior

Every process-owning deployment host calls `application.shutdown` in its bounded `finally` and
signal paths. It drains the entire local-controller fleet, closes coordinator and writer authority,
and returns one immutable deployment close receipt proving zero owned processes/groups, worktrees,
runtimes, branches, capacity reservations, transports, coordinator authority, and writer authority.
Exact retry returns the same receipt. Remote Web and the default MCP Run surface cannot invoke it;
advanced `fleet_drain` reaps the coordinator fleet while deliberately retaining transport and
writer authority. `run.stop` independently proves its exact target set reached zero while retaining
coordinator, writer, transport, and unrelated-Run authority. A later terminal Run scorecard/seal is
separate from stop and remains part of evidence completion.

`run.evidence` builds one content-addressed bundle from authoritative RunView inputs, source and
verification anchors, route observations, settlements, review dispositions, adoption, and any
Run-scoped stop receipt. Deployment close is a later host receipt and is not fabricated into a
manifest obtained before shutdown.
It does not let a runner invent success booleans. Private filesystem paths, credentials, sessions,
and unbounded provider prose are absent.

## UA9 — run-centric browser and agent experience

The browser starts with objective/profile/route, shows the proposed Plan before approval, and then
shows RunView narrative, nodes, attention, budgets, route identity, accepted-result preservation,
evidence digest, adoption, and stop state. Raw
JSON is an inspectable detail. Exact route selectors come from deployment cards. Send mode supports
nudge, immediate steer, and new turn with an explicit reason. Approval, answer, evidence,
adoption, and stop/reap are first-class; recovery remains later scope.

MCP defaults to the Run command bus rather than requiring an agent to discover nineteen kernel
tools and reproduce their choreography. The Web user-to-orchestrator direction is a durable Run
instruction/attention seam; it does not bypass Coordinator gates.

## UA10 — required red tests and live proof

Acceptance requires:

1. one concise `run.start` creates exactly one Goal and proposed Plan with zero provider/filesystem
   effects before approval;
2. the proposer cannot approve; exact authenticated approval dispatches one task and retry cannot
   duplicate it;
3. exact and auto routes retain requested/resolved/observed tuple and rationale without fallback;
4. profile narrowing succeeds while scope/budget/verification/effect/route widening refuses;
5. one RunView covers plan, narrative, attention, route, budget, verification, semantic state,
   ownership, evidence, and cursor identically across direct/CLI/Web/MCP;
6. wait/follow removes bespoke polling and remains bounded/restart-resumable;
7. answer and steering resolve once using current server-side fence;
8. restart at every Goal/Plan/approval/dispatch/process boundary yields no duplicate task/process;
9. authorized exact attach recovery succeeds once; absent/ambiguous recovery stays operator-bound;
10. fabricated semantic anchors fail and grounded independent findings retain disagreement;
11. success requires accepted Plan nodes plus configured semantic/integration gates;
12. every failure and SIGINT path closes exactly with zero owned residue and idempotent receipt;
13. one declarative fixture proves the full application flow through direct, CLI, authenticated Web,
    and MCP; and
14. Baton's recursive Codex, project-key GLM, and concurrent-Grok proof uses the Run application
    rather than a phase-specific orchestration runner.

The decisive completion metric is deletion or reduction of the current 638-line dogfood runner to
declarative deployment/profile setup plus `BatonApplication.run()` and evidence export. Kernel
invariants may not be weakened to achieve ergonomic brevity.
