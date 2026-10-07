# Phase 84 — Context successor Plan/Wave and durable map calls

## Decision

Baton's first provider-backed Context operator is a depth-one `map`. It does not call a provider
from the stateless Bench, mutate the currently executing Plan, manufacture a route, or introduce a
second orchestration engine. One authenticated `context_map` action compiles a normalized effect
program over one completed immutable Context cell into:

1. one durable Context call admission with exact input, partition, role, policy, and predecessor
   coordinates;
2. one ordinary append-only successor Plan whose nodes bind those partitions;
3. one distinct ordinary Plan approval before any provider process can start;
4. one existing all-or-clean parallel Wave with a separately owned Attempt per partition; and
5. one durable call settlement that attaches exact terminal child results and source-grounded
   evidence without promoting them to accepted knowledge.

The application remains the five-operation application (`help`, `start`, `inspect`, `act`, `stop`).
`map` is a self-described `run.act` action and a Pythonic `run.context().map(...)` method, not a new
command family. Ordinary callers provide the completed input cell, a logical role, and an
instruction. Baton derives the session, manifest, program, partitions, predecessor, Plan, Wave,
routes, worker policy, numeric resource policy, artifact storage, and lifecycle coordinates.

This is deliberately not a generic mutable multi-agent sandbox. A group may address the same
logical WorkItem and share immutable Context/CAS references, but sibling provider Attempts retain
separate process, session, result, cleanup, and writable-worktree identities. Concurrent shared
writes would make attribution, stop fencing, replay, and late-result rejection ambiguous. A later
explicit integration Attempt may consume immutable siblings and write a fresh sandbox.

## Agent experience

The concise application metaphor is:

```python
ctx = run.context()
parts = await ctx.chunk(branch="repository", by="path")
reviews = await ctx.map(
    parts,
    role="critic",
    instruction="Find authority, replay, or lifecycle gaps.",
)

# reviews is one addressed Context call. Its outline says awaiting_plan_approval,
# running, attention, completed, or stopped and advertises the next safe action.
await run.approve()             # distinct existing Plan approval
await reviews.complete()        # change-aware observation, not a hidden approval loop
evidence = await reviews.evidence()
value = await reviews.output()
help = await reviews.help()
```

The wire action accepts only `cellId`, `role`, and `instruction`. `role` is selected from the
current approved Workflow definition. It is not a harness alias and cannot contain a model, effort,
permission, credential, budget, concurrency, timeout, export, or storage override. The application
may omit `role` when exactly one definition role is eligible. Help and inspection follow the
existing outline -> index -> section -> item -> evidence cascade.

## Critique of the broader recursive-workflow proposal

Dynamic feedback and parallel dispatch are valuable only where they preserve explicit authority.
The useful primitive is not an agent-authored loop or a bag of prompts; it is an append-only
successor graph:

- pure Context computation selects immutable addressed inputs;
- an effect request becomes a proposed Plan;
- approval admits provider work;
- terminal child evidence attaches to the exact request generation;
- an optional later `reduce`, `review`, or `verify` becomes another separately visible successor.

The RLM pattern is appropriate for context selection and bounded decomposition. It is not an excuse
for hidden recursive provider calls, ambient Python, deep unbounded recursion, automatic consensus,
or model-selected routing. Baton should add a compact REPL/compiler only after this JSON authority
is replayable and differentially tested. That front end must compile to the same closed AST and
events; it receives no independent powers.

## CSW1 — closed map request and identity

The normalized effect program is the existing Context Program AST:

```json
{
  "schemaVersion": 1,
  "kind": "baton.context_program",
  "expression": {
    "op": "map",
    "input": { "op": "cell", "cellId": "cell:..." },
    "role": "critic",
    "instruction": "..."
  }
}
```

Phase 84 may encode the input as an application-owned call request rather than add `cell` to the
pure evaluator, but the durable normalized identity must bind the equivalent exact cell and output
references. An effect program is never admitted through `admitContextCell` and is never evaluated
by `StatelessContextBench`.

`callId` is content-addressed from the immutable request core: repository, Run, Context session and
generation, input cell/admission/settlement/output/evidence identities, normalized effect program,
logical role, manifest/tree/environment/policy identities, predecessor Goal/Plan/definition/node,
and canonical partition identities. It deliberately excludes the successor Plan digest so the Plan
may bind the call without a digest cycle. The call admission separately binds the exact normalized
successor Plan request and expected digest.

Changed instruction, role, input cell, output bytes, evidence, partition order/content, tree,
policy, predecessor head, profile, role route, or actor scope produces a different call or conflicts
before append. Reusing an idempotency key with changed bytes is refused.

## CSW2 — deterministic partitions

The input must be a completed current-session Context cell whose output and evidence reverify from
the private Context reference store. Each top-level ContextValue item becomes one partition in
canonical item order. A partition binds:

- zero-based index and item digest;
- input cell, output handle/digest, and evidence handle/digest;
- exact source-coordinate subset or its canonical digest;
- a bounded immutable value/ref suitable for the child Brief; and
- `partitionId = context-partition:<digest(partitionCore)>`.

The deployment owns partition count, byte, prompt, concurrency, and provider-turn ceilings. The
caller never supplies those routine limits. If the already materialized input cannot fit the
authorized successor Plan, Baton returns typed attention with an advertised pure chunk/slice action;
it does not truncate, silently regroup, partially admit, or ask the model to tune storage knobs.

`map` is specifically the parallel effect primitive. Empty or singleton input returns typed
`context_map_not_parallel` guidance before call/Plan/provider effect; the agent should inspect the
cell or use one ordinary Run/review rather than manufacture a one-member Wave. A future `reduce`
or single-item review action may own that case without weakening map's partition-set invariant.

## CSW3 — role and exact route authority

The logical role must resolve in the predecessor's durable Workflow definition. The definition,
not prose, supplies the exact harness/model/effort tuple and applicable worker policy. Every
partition node repeats that resolved tuple in ordinary Plan route authority. A node uses a unique
attempt role such as `critic:0001` while preserving `logicalRole: critic` in its Context-call
binding. The route is still requested, resolved, and provider-observed independently for each
Attempt.

No worker, input ContextValue, instruction, Context Program, recursive recipient, or northbound
caller can override route, reasoning effort, full-permissions policy, credentials, sandbox,
service tier, or provider command. Substitution fails before Plan proposal or provider effect.

## CSW4 — durable admission and Plan binding

`context.call_admitted` is appended before `plan.version_proposed`. It contains the full normalized
call, canonical partitions, expected normalized successor Plan request/digest, request digest,
admission digest, Context principal, and deterministic idempotency key. Its apply path projects a
call in `plan_pending` state. A crash here leaves no provider effect; retry proposes the exact Plan.

The successor Plan:

- references the current Goal version and exact predecessor Plan head;
- contains one root node per partition;
- carries a closed `contextCall` binding with call/admission/program/partition/logical-role/input
  identities;
- inherits profile definition-of-done, constraints, path/context scopes, verification,
  capabilities, effects, required effects, and worker policy;
- uses deployment-derived cumulative budget allocation within the existing Goal envelope; and
- has one durable `application.workflow_definition_bound` record whose attempt routes and Plan
  nodes are byte-consistent.

Plan proposal causes the call projection to become `awaiting_plan_approval`. A Plan with a Context
binding cannot be approved through the application unless the exact call admission exists, targets
that Plan digest, is current, and all node/partition/definition bindings validate. Approval and Wave
dispatch use the existing Goal/Plan APIs; there is no Context-specific spawn path.

## CSW5 — Wave, child results, and settlement

After distinct approval, the existing all-or-clean Wave admission creates one task and one Attempt
per node. Analysis-oriented children receive immutable selected partition content/refs and a
dedicated report target inside their private worktree. Coding children remain private-worktree
Attempts. Siblings never share a writable checkout.

The durable Brief retains only the closed Context-call binding. Immediately before provider
admission, Baton privately reverifies the source CAS, selects exactly the bound partition, checks
its digest and deployment byte ceiling, and materializes those bytes only into the physical
provider Brief. Neither raw partition bytes nor `contextInput` enter the coordination ledger.

The call projection derives `running`, `attention`, or `settlement_ready` from exact Plan/task/worker
state. `context.call_settled` may append only once every target Attempt is mechanically completed.
A failed or cancelled child makes the call `failed` and cannot be overclaimed by direct store
settlement. A successful settlement binds:

- expected call version and admission digest;
- exact Plan, approval, Wave, task, Attempt, route, result, verification, cleanup, and artifact
  coordinates for every partition;
- a content-addressed ContextValue containing ordered child result references and typed terminal
  dispositions;
- source-grounded Context evidence that retains the input coordinates and child derivations;
- provider-effect count; progress and termination classification; and
- settlement digest and deterministic idempotency key.

Mechanical acceptance proves the report artifact and repository result satisfy their Plan gate; it
does not make model findings true. The settled output is untrusted/derived, is not auto-selected,
integrated, pushed, published to Scratch, or promoted to Cairn, and advertises ordinary independent
`review`, deterministic `verify`, or model-backed `reduce` successors.

Late, duplicate, stale-generation, wrong-partition, cross-call, cross-Plan, or cross-tree child
results cannot attach. A repeated identical child set returns the same settlement. Changed terminal
evidence under the same settlement key conflicts.

Before settlement, every completed child is reaped through the restart-aware Run-target cleanup
primitive. Baton then appends a policy-authored `resource.worker_cleanup_attested` operational
event after exact process/session/worktree/runtime postchecks, maps that event into coordination
evidence, and records one idempotent `task.resources_released` event bound to the terminal task
version. Each child digest embeds its own release event, release digest, and mapped evidence; the
aggregate cleanup digest binds the complete partition/task/worker/release set. A current-process
`owned: false` observation is never accepted as durable absence proof.

## CSW6 — recovery, stop, and reap

Replay reconstructs calls and derives these monotonic states:

`plan_pending -> awaiting_plan_approval -> approved -> running -> settlement_ready -> completed`

with terminal side states `attention`, `failed`, and `stopped`. Restart reconciliation is bounded
and idempotent:

- admitted call without Plan: repropose the prebound Plan;
- proposed Plan without approval: wait visibly;
- approved Plan without/with partial Wave admission: use existing all-or-clean Wave recovery;
- partial terminal children: preserve them and wait/reconcile only missing descendants;
- settlement-ready call: materialize/reverify CAS and append the one settlement;
- cleanup completed but settlement absent: replay the per-task resource releases and settle
  without another provider effect;
- committed settlement with lost response: return exact replay.

Run stop snapshots Context sessions, pure cells, calls, successor Plans, Waves, tasks, Attempts,
provider processes, sessions, worktrees, runtimes, artifacts, and leases. It fences call/Plan/cell
admission before cancellation. Call-level stop, when added to the action surface, targets an exact
call generation and the same descendant union. Completion requires zero owned descendants and a
durable receipt. A late result remains forensic evidence for its old Attempt but cannot settle the
stopped call. Deployment close uses the same ownership union and remains idempotent.

## CSW7 — visibility and transport parity

The Context outline adds call counts and the most recent call state. Context index interleaves
session, cell, and call summaries with stable IDs. Call item depth shows the logical role, input
cell, partition/child counts, successor Plan/approval, state, typed attention, and advertised next
action. Evidence depth shows exact admission, partitions, Plan/Wave/Attempt routes, artifacts,
coverage, settlement, and cleanup receipts.

Direct client, generic CLI action, authenticated Web/browser, and MCP consume the same semantic
registry action and digest. No transport accepts hidden route, effort, permission, credential,
budget, batch, task, Plan, Wave, partition, or artifact coordinates from an ordinary caller.

## Acceptance criteria

1. `context_map` is advertised only for an active current Workflow Context with a completed input
   cell and eligible logical role; its schema has only `cellId`, `role`, and `instruction`.
2. Pure Bench/cell admission continues to reject effectful ASTs with zero provider effects.
3. One map action appends a durable call admission and one successor Plan proposal; provider spawn
   count remains zero until distinct Plan approval.
4. Every successor Plan node binds exactly one immutable partition and resolves the exact approved
   harness/model/effort and worker policy for the logical role.
5. Changed role, route, effort, instruction, input, output/evidence bytes, partition, predecessor,
   Plan, actor, tree, or policy conflicts before provider effect.
6. Approval dispatches one real overlapping Wave with distinct task, Attempt, provider process,
   result, evidence, cleanup, and route attestation per partition.
7. Restart at call admission, Plan proposal, approval, partial Wave, result, CAS write, and
   settlement converges to one identity with at most one physical provider effect per Attempt.
8. Completed children attach in canonical partition order to one durable Context call result;
   failed/cancelled, stale, or cross-call results are rejected, and each attached child carries a
   replay-verified process/session/worktree/runtime release coordinate.
9. Model output remains derived/untrusted and cannot auto-integrate, push, publish, or promote.
10. Run stop during any stage fences new descendants, reaps all owned processes/sessions/worktrees,
    settles every target, and records a verifiable zero-ownership receipt.
11. Direct client, generic CLI, authenticated Web/browser, and MCP expose the same action digest,
    result identity, help, and inspection depths.
12. Focused authority, replay, lifecycle, route-substitution, transport, and application tests plus
    the complete implementation suite are green.
13. Live Baton-on-Baton evidence runs at least two parallel partitions, requests and observes exact
    harness/model/effort, proves approval-before-spawn, interrupts one run, and proves full reap and
    caller-worktree non-contamination. Native Kimi evidence is attempted when its ordinary login is
    valid; expired external auth is reported honestly and is not bypassed with secrets.

## Red-team matrix

- Tamper every call, partition, Context ref, source coordinate, role, route, Plan, approval, Wave,
  task, Attempt, result, artifact, settlement, generation, actor, and idempotency field in the
  ledger; replay must fail with typed Context integrity rather than repair attacker bytes.
- Inject append failure before/after call admission, workflow prebinding, Plan proposal, approval,
  Wave admission, child terminal event, CAS materialization, and call settlement.
- Race identical map requests, approval with stop, Wave dispatch with stop, result with stop,
  settlement with stop, shutdown with admission, and duplicate result delivery.
- Attempt model/effort/permission/credential/budget/concurrency overrides in instruction text,
  action inputs, ContextValue content, recursive commands, Plan nodes, and transport payloads.
- Substitute a valid cell from another session, historical Plan, Run, repository, tree, profile,
  role, output artifact, or evidence artifact.
- Exhaust partition count/bytes, Goal budget headroom, Plan node/byte ceiling, capacity, provider
  readiness, and worktree availability; require pre-effect typed attention and no partial Wave.
- Prove shared immutable inputs do not imply shared mutable workspace or process ownership.

## Build order

1. Add normalized Context call/partition/node-binding authorities and red unit/store replay tests.
2. Add call admission/projection/snapshot/query, Run-stop targeting, and Coordinator poison/drain
   coverage.
3. Add `contextCall` Plan-node normalization and Brief binding; prove generic Goal/Plan rejection of
   substitutions.
4. Add application `context_map`, role resolution, deterministic partitioning, workflow prebinding,
   successor Plan proposal, approval validation, and client method.
5. Reuse existing Plan Wave dispatch; add durable child projection, CAS result/evidence
   materialization, settlement/reconciliation, and stop/restart tests.
6. Add outline/index/item/evidence and direct/CLI/Web/MCP parity.
7. Adversarial review, focused/full validation, then concise live Baton-on-Baton parallel and reap
   evidence. Record AX friction as product input rather than exposing internal ceilings as routine
   user/model controls.

## Explicitly deferred

`reduce`, independent `review`, deterministic `verify`, depth beyond one map plus one synthesis or
review, optional Starlark/isolated-Python syntax, persistent kernels, richer Atlas AST/CST/symbol/
SCIP/CPG branches, and shared-knowledge graph branches remain catalogued in Phase 81 and the full
system goal. They are not claimed by this slice and are not removed. Homelab integration is outside
this project and this phase.
