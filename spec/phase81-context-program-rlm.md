# Phase 81 — common Context Program, stateless Bench, and context-recursive workflows

## Decision

Baton adds one compact, Pythonic context-computation experience backed by a closed, versioned,
content-addressed program rather than an ambient host shell. The public surface lets an agent
outline, search, select, partition, compare, map, and reduce addressed context. The durable surface
is a canonical Baton Context Program AST whose operations and effects are exhaustively known to the
hub.

The first production vertical is stateless and depth one:

1. a root agent receives a compact `ContextManifest` rather than an unbounded prompt;
2. pure Context Program cells inspect immutable repository, Atlas, Scratch, Cairn, Candidate,
   feedback, verification, artifact, document, or log references;
3. a `map` or model-backed `reduce` compiles to an ordinary Baton WorkItem and parallel Wave;
4. child results return to one addressed cell and an ordinary synthesis/review gate;
5. typed progress and stop policy terminates the strategy without inventing completion.

This is the appropriate Baton adaptation of the Recursive Language Model pattern: externalized
context is programmatically inspected and selected before bounded submodel calls. It is not a new
dispatch authority, a synonym for every recursive Workflow, a replacement for Atlas/Scratch/Cairn,
or permission for model-authored `llm_query(model=...)` calls.

## Terminology and ownership

- **Bench** is the execution substrate for a Context Program cell. The first rung evaluates only
  Baton's closed pure operations. A later isolated-code backend is optional and does not change the
  cell or authority contract.
- **ContextSession** is the agent-facing, self-descriptive API over one immutable
  `ContextManifest`, its cells, and their outputs.
- **Context Program** is the canonical AST/IR recorded in authority and evidence. It is data, never
  evaluated through JavaScript `eval`, Python `exec`, a host shell, or a provider-native tool loop.
- **`context_recursive`** is a Workflow strategy that may compile Context Program subcalls to
  Baton WorkItems, Waves, Attempts, Candidates, and gates.
- **Cell** is one content-addressed execution of a normalized Context Program against exact input
  references.

The coordination ledger remains truth. Bench caches, context views, Scratch, and Cairn are replayed
or derived projections and grant no approval, routing, verification, integration, publication, or
stop authority.

## AX — one surface, cascading depth

Ordinary creation remains compact:

```js
const workflow = await baton.workflow(objective, {
  strategy: 'context_recursive',
  team: [
    { role: 'explorer', exact: { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' } },
    { role: 'critic', exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' } },
    { role: 'synthesizer', exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' } },
  ],
});

await workflow.complete();
```

The orchestrator chooses effort for each role and task. Baton does not default every context to low
effort, and the in-session program cannot substitute harness, model, effort, credentials,
permission posture, service tier, budget, topology, or acceptance policy.

Inside an approved root Attempt, the conceptual experience is Pythonic and self-descriptive:

```python
ctx = baton.context.current()

hits = ctx.search("revision authority")
parts = ctx.chunk(hits, by="symbol")
reviews = ctx.map(parts, role="critic", instruction="Find replay or authority gaps")
answer = ctx.reduce(reviews, role="synthesizer")

baton.finish(answer, evidence=reviews.evidence)
```

This is an API metaphor and future optional syntax, not a promise of unrestricted Python. The first
wire representation is canonical JSON. A later Starlark-like or isolated-Python front end may
compile to exactly the same AST after differential evaluation demonstrates that it improves agent
performance without weakening recovery or containment.

Every surface follows the existing outline -> index -> section -> evidence cascade:

- `workflow.status()` adds only context stage, cell/call counts, coverage, termination, attention,
  and the recommended next action;
- `workflow.context()` returns the manifest outline and safe expansion methods;
- `workflow.context().cells()` and `.calls()` return bounded tables;
- `workflow.context().cell(id)` and `.call(id)` return one chapter;
- `.evidence()` returns exact manifests, source ranges, routes, receipts, and replay identity;
- contextual `help()` and schema/docstrings describe allowed operations and next actions at every
  depth.

No ordinary caller or model manages call counts, recursion depth, concurrency, token totals, dollar
totals, export bytes, file counts, storage reserve, provider turns, or wall-clock limits. Those are
deployment-owned policy and capacity concerns projected only when they cause attention.

## CP1 — immutable ContextManifest

One normalized manifest identifies the full context universe without embedding it in the root
prompt:

```json
{
  "schemaVersion": 1,
  "kind": "baton.context_manifest",
  "repoId": "repo-baton",
  "tree": { "sha": "...", "source": "deployment_snapshot" },
  "workflow": {
    "runId": "...",
    "definitionDigest": "...",
    "goal": { "goalId": "...", "version": 1, "digest": "..." },
    "plan": { "planId": "...", "version": 1, "digest": "..." },
    "node": { "key": "attempt:root", "digest": "..." },
    "task": { "taskId": "...", "version": 2, "createdEvent": 7, "claimedEvent": 8 }
  },
  "branches": [
    { "name": "repository", "ref": "ctx:...", "digest": "...", "mediaType": "application/json", "itemCount": 1, "summary": "..." },
    { "name": "atlas", "ref": "ctx:...", "digest": "...", "mediaType": "application/json", "itemCount": 1, "summary": "..." },
    { "name": "coordination", "ref": "ctx:...", "digest": "...", "mediaType": "application/json", "itemCount": 1, "summary": "..." },
    { "name": "evidence", "ref": "ctx:...", "digest": "...", "mediaType": "application/json", "itemCount": 1, "summary": "..." }
  ],
  "policyDigest": "...",
  "digest": "..."
}
```

Supported branches may reference the repository tree and files; Atlas lexical, AST/CST, symbol,
SCIP, CPG, IR, behavior, and representation artifacts; Scratch facts/claims; Cairn causal nodes;
WorkItems, Attempts, Candidates, feedback, verification, selection and cleanup receipts; or
explicit documents/logs. Each branch has immutable source coordinates and its own bounded outline.

The manifest binds one exact Goal version, Plan version, Workflow definition, Plan node, claimed
task generation, deployment policy, and tree—not merely stable Goal/Plan IDs whose head may later
move. `tree.source` is a validated authority enum (`deployment_snapshot` or `revision_parent`), not
an assertion that a Plan somehow contains tree bytes. Admission proves those
coordinates are mutually consistent, currently authorized, and belong to the same Run and
repository. A successor Plan creates another manifest; it never silently retargets an existing
session. The manifest binds one tree. Cross-tree facts or artifacts remain readable only with conspicuous
`observedOn` and `currentTree: false` labels. A mutable path, branch name, current HEAD, process cwd,
provider transcript pointer, or cache filename is never sufficient context identity.

## CP2 — closed Context Program AST

A program is a normalized expression tree. Unknown fields and operations fail before a cell or
provider effect. Initial pure operations are:

- `outline(ref)` — compact shape, types, summaries, and child handles;
- `index(ref, after?)` — bounded addressed children;
- `search(ref, query, mode)` — literal/lexical or delegated deterministic Atlas search;
- `slice(ref, selector)` — exact paths, symbols, spans, nodes, or receipt identities;
- `chunk(ref, by)` — deterministic file, symbol, representation-node, event, or size partition;
- `filter(ref, predicate)` — closed boolean predicates over typed metadata;
- `project(ref, fields)` — closed field projection;
- `sort(ref, keys)` and `unique(ref, keys)` — deterministic normalization;
- `join(left, right, on)` — bounded typed equality join;
- `coverage(ref)` — represented/inspected/unread source accounting;
- `collect(expressions)` — immutable product of pure results;
- `finish(value, evidence)` — proposes a terminal result; it does not assert correctness.

Provider-backed operators are separate typed effects:

- `map(input, role, instruction)` compiles one logical WorkItem plus an overlapping Wave of
  distinct Attempts;
- `reduce(input, role, instruction)` compiles a synthesis Attempt over immutable child result refs;
- `review(input, role, criteria)` compiles independent review with route-family policy;
- `verify(input, gate)` invokes an approved deterministic gate, never model self-attestation.

Expressions may bind names and compose closed functions, conditionals, and finite iteration over
materialized addressed values. They cannot import modules, inspect environment variables, open
arbitrary paths, access the network, spawn processes, mutate a checkout, call arbitrary Baton
methods, manufacture an authority coordinate, or choose a route.

Canonicalization sorts object keys, rejects duplicate names and cyclic references, normalizes text
and selectors, and digests the complete program, manifest, environment, policy, and dependency
cell refs. Semantically changed code creates a distinct cell; exact replay returns the original.

## CP3 — cell authority and artifact identity

Each admitted cell binds:

```json
{
  "schemaVersion": 1,
  "kind": "baton.context_cell",
  "cellId": "...",
  "manifestDigest": "...",
  "program": { "...": "canonical AST" },
  "programDigest": "...",
  "inputRefs": ["ctx:...", "cell:..."],
  "environmentDigest": "...",
  "policyDigest": "...",
  "state": "admitted|working|completed|failed|stopped|attention",
  "childCalls": [],
  "outputRef": null,
  "termination": null,
  "digest": "..."
}
```

Cell admission is append-only and idempotent. A completed output is a content-addressed artifact
registry entry, so memoization and durable evidence cannot disagree. Cache reuse requires identical
tree, manifest, normalized program, environment, and policy digests. Eviction removes a projection,
not the ledger identity; a missing artifact is typed `artifact_unavailable`, never silently
recomputed under the same receipt.

The first durable grammar is deliberately small and closed:

```text
context.session_admitted
context.cell_admitted
context.cell_settled
```

`session_admitted` validates and carries the full manifest plus the exact
Goal/Plan/definition/node/task/tree/policy prefix, then derives one deterministic session identity.
`cell_admitted` records the full canonical pure program, ordinal, predecessor, explicit input refs,
generation, and exact cell identity before computation. `cell_settled` is one closed terminal union
for completed/failed/attention/stopped and atomically binds path-free content-addressed output and
evidence refs plus source-coordinate, coverage, and result digests. Output bytes and exact
provenance live in immutable artifacts rather than expanding the event ledger; the event remains
sufficient to validate them through the deployment artifact resolver. Restart may recompute only a
still-admitted deterministic pure cell.
A completed cell is read from and checked against its original artifact and is never silently
recomputed. Same-key changed input conflicts; exact retry returns the original event and identity.

Bench output is evidence of an observation or derivation, not proof that the question was correct.
Derived/model/formal outputs preserve their encoding or prompt, remain quarantined from automatic
Cairn promotion, and need an independent gate before becoming load-bearing.

## CP4 — subcall compilation and exact routing

`map` never calls a provider directly and never mutates or adds hidden nodes to the currently
executing immutable Plan. The hub validates the role against the approved Workflow definition,
materializes exact addressed partitions, and proposes a new successor Plan whose predecessor is the
manifest's exact Plan and whose root nodes bind the manifest, program, partition, and role digests.
After a distinct ordinary approval, the existing all-or-clean Plan Wave path derives one WorkItem,
one Wave, and one child Attempt per addressed partition and resolves each exact
harness/model/effort tuple from the orchestrator-approved role map. Child
prompts bind only the selected partition plus the manifest outline, applicable constraints, and
definition of done.

Analysis-only child Attempts may use a provider completion runtime without a writable checkout.
Coding child Attempts receive distinct private worktrees. No two provider calls share an Attempt,
process generation, result, cleanup, or route identity. Parallel siblings may share immutable
manifest and memoized cell refs; they do not share a writable working tree or mutable interpreter
namespace.

`reduce` consumes only exact terminal child outputs and their source coordinates. It produces an
ordinary untrusted result/Candidate and cannot select or integrate itself. Late, duplicate, stale,
cross-cell, or cross-generation child output is retained as evidence but cannot attach to the
current cell.

## CP5 — state, recovery, and bounded recursion

The default Bench is stateless. Every pure cell can be reconstructed from ledger state and
content-addressed artifacts. A named persistent kernel is deferred until the stateless system has
usage evidence. If added, it is opt-in, single-writer leased, serialized, generation-fenced, and
many-reader; its checkpoint and process are descendants of the owning Workflow and cell.

Replay reconstructs manifests, cells, dependencies, call batches, WorkItems, Waves, Attempts,
results, coverage, termination, and cleanup. Restart after cell admission resumes the same cell.
Restart after batch admission reconciles each exact Attempt and never repeats a completed or
externally ambiguous provider effect. Restart after synthesis returns the same result identity.

The first `context_recursive` strategy permits one root decomposition Wave plus one synthesis or
review Wave. Further expansion proposes a normal successor Plan under the Phase 80 policy rather
than recursively executing hidden model-authored calls. Deeper recursion remains closed until
depth-one replay, cost/quality evaluation, termination, and stop/reap gates pass.

## CP6 — progress and typed termination

The hub—not a provider output marker—sets one terminal disposition:

- `completed_with_evidence` — the approved mechanical and semantic gates passed;
- `no_new_context` — expansion produced no previously unread relevant context;
- `no_verified_progress` — a new cell/result added no verified evidence or Candidate delta;
- `repeated_query_or_result` — normalized program/input or result repeated;
- `unresolved_contradiction` — applicable evidence remains contradictory;
- `verification_failed` — the required deterministic gate failed;
- `policy_exhausted` — deployment authority cannot admit another step;
- `artifact_unavailable` — a required immutable source is absent or corrupt;
- `manual_intervention_required` — an external effect cannot be reconciled safely;
- `operator_stopped` — stop authority fenced the subtree.

Policy exhaustion never forces a final answer. Every non-success disposition preserves accepted
cells, calls, results, evidence, and coverage and advertises a typed safe next action.

## CP7 — stop, reap, and contamination prevention

`workflow.stop()` snapshots the exact descendant union of context sessions, cells, call batches,
WorkItems, Waves, Attempts, workers, provider processes, worktrees, runtimes, artifact leases, and
future named kernels. It fences new cells and subcalls before cancellation. Completion requires
confirmed process death and settled ownership for the entire snapshot.

Cell-level stop targets the exact cell generation and descendant call batch. A completion arriving
after stop or timeout remains bound to its original cell/Attempt and can never contaminate a later
cell, synthesis, shared cache entry, or Cairn promotion. Deployment close performs the same union
reap and proves zero remaining ownership.

## CP8 — knowledge, coverage, and evidence

Context reads emit provenance and coverage receipts. A result binds the exact selected source refs,
ranges/nodes, tree, manifest, program, route, child Attempt, and gate receipts. Scratch publication
is explicit and first records an `observed` or `derived` claim. Cairn promotion remains
evidence-gated, contradiction-preserving, and tree-aware. Neither a model summary, a REPL variable,
a memoized result, repeated agreement, nor graph connectivity becomes truth automatically.

Coverage is not correctness, but it makes omission visible: manifest items are `unread`, `indexed`,
`selected`, `delegated`, `reviewed`, or `excluded_with_reason`. The outline reports meaningful
totals; evidence depth reports exact source coordinates and exclusions.

## CP9 — transport parity

Direct application, concise CLI, authenticated Web/browser, and MCP expose the same semantic
operations and digest. Context does not add another northbound command family: it remains a nested
Run facade compiled through the five default operations (`application.help`, `run.start`,
`run.inspect`, `run.act`, and `run.stop`). Pythonic `workflow.context()` methods are client
conveniences over advertised inspect depths and actions, not extra wire authority:

- create/inspect/stop one context-recursive Workflow;
- inspect context outline/index/cell/call/coverage/termination;
- invoke only advertised safe actions;
- receive the same route truth, attention, replay identity, and cleanup proof.

Transport schemas never accept private cell, task, worker, process, worktree, route, budget, or
receipt coordinates when they can be derived from the current authenticated handle. Browser and
CLI presentations may differ, but their semantic document digest must match.

## CP10 — evaluation and routing gate

The strategy must earn its use. A fixed evaluation compares:

1. direct root-model answer;
2. Atlas/context inspection without submodels;
3. stateless Context Program without submodels;
4. depth-one parallel `context_recursive` decomposition and synthesis.

Tasks include short contexts where recursion should be refused, long contexts beyond a root
window, dense cross-file authority/replay audits, and adversarial irrelevant context. Measures are
fresh-gate correctness, evidence coverage/precision, contradiction handling, provider calls,
latency, cost, duplicate work, replay equivalence, and cleanup. Baton recommends or automatically
routes to the strategy only for task classes where it improves verified utility. There is no
presumption that more recursion is better.

## Acceptance tests

1. A manifest larger than a root window is represented by a compact digest/outline and selectively
   inspected without embedding the corpus in one prompt.
2. Closed AST validation rejects unknown operations/fields, cycles, arbitrary code, route knobs,
   credentials, permissions, authority coordinates, mutable paths, and context substitutions before
   cell/provider effects.
3. Exact pure-cell replay returns one identity and artifact; changed tree, program, input,
   environment, or policy produces another identity.
4. Pure symbolic search and coverage can complete with zero provider calls.
5. `map` compiles one real overlapping Wave with distinct Attempt, route, result, evidence, and
   cleanup identities per partition.
6. Every child sees the same immutable context coordinate; coding children receive private writable
   worktrees and analysis children receive no ambient checkout write authority.
7. Exact harness/model/effort comes from the approved role map; a model-authored override fails
   before provider effect.
8. Restart after cell admission, partial batch completion, provider result, or synthesis converges to
   the same cell/child identities and at most one physical provider effect per Attempt.
9. A timed-out or stopped cell's late completion cannot attach to another cell or cache key.
10. Repeated program/result, no new context/progress, contradiction, verification failure, policy
    exhaustion, missing artifact, and ambiguous recovery project their exact typed attention states.
11. Stop during a parallel batch reaps every descendant process, session, runtime, worktree, lease,
    and kernel and returns zero remaining ownership.
12. Cross-tree Scratch, Atlas, or memoized evidence is visibly labeled and never presented as
    current-tree truth.
13. Bench-derived claims cannot auto-promote to Cairn or claim verification without an independent
    gate.
14. Direct, CLI, Web/browser, and MCP views share the same semantic digest and AX cascade.
15. Evaluation demonstrates when direct, pure-context, or context-recursive execution should be
    selected and keeps depth greater than one closed until it wins and remains recoverable.

## Explicit non-goals and pushback

- No ambient shared shell, unrestricted host-process Python, `eval`, or model-visible credentials.
- No caller-managed routine budget, depth, call-count, concurrency, provider-turn, export, file, or
  storage knobs.
- No model-selected harness/model/effort; role names resolve through orchestrator authority.
- No concurrent multi-writer checkout and no shared mutable kernel as the first vertical.
- No relabeling ordinary review/revision recursion as RLM.
- No replacement of Atlas, Scratch, Cairn, the artifact registry, Goal/Plan, or the ledger.
- No automatic correctness or knowledge promotion from memoization, consensus, or reproducibility.
- No deep recursion until depth-one quality, recovery, lifecycle, and cost gates pass.
- No homelab integration in this phase.

## Build sequence

1. Canonical `ContextManifest`, closed Context Program normalizer/digest, and stateless pure cells.
2. Pythonic `ContextSession` application facade with outline/index/section/evidence/help depth.
3. Durable manifest/session/pure-cell admission, exact provenance artifacts, replay, conflict, and
   stop fencing.
4. `map` compilation through one distinctly approved successor Plan into a bounded WorkItem/Wave
   and exact role-routed Attempts.
5. Durable child attachment, synthesis/review, coverage, progress, termination, replay, and stop.
6. Direct/CLI/Web/browser/MCP parity plus direct-vs-context-vs-RLM evaluation.
7. Only then consider an isolated code backend, deeper recursion, or opt-in persistent kernels.

## Research basis

The RLM paper describes treating a long prompt as an external environment that a root model can
programmatically inspect, decompose, and query through submodels. The official implementation uses
a REPL and now supports batched calls and several isolated environments, while warning that its
default local same-process execution is not production isolation. Baton adopts externalized context
and selective batched subcalls, but keeps its own Goal/Plan, route, evidence, recovery, and lifecycle
authority and begins with a closed deterministic AST.

Primary sources:

- https://arxiv.org/abs/2512.24601
- https://github.com/alexzhang13/rlm
- https://alexzhang13.github.io/rlm/api/

## Implementation checkpoint — 2026-07-18

Layer A and the durable pure-cell part of Layer B are locally implemented. The shipped vertical now
includes closed immutable tree-bound ContextManifests; strict JSON content identity; the canonical
pure Context Program AST; a compact Pythonic `workflow.context()` facade compiled through the five
application operations; content-addressed source/output/evidence CAS; append-only
`context.session_admitted`, `context.cell_admitted`, and `context.cell_settled` authority; exact
idempotent replay; historical-policy reads; source and artifact substitution refusal; and Context
targets in Run-stop admission/completion receipts. Raw Bench/runtime classes remain internal rather
than becoming a competing ordinary control surface.

Default repository Context is now a real effective-tree producer. Source receipt v2 binds the repo,
commit, root tree, Git object format, deployment source-policy digest, Plan Context scope, canonical
coverage, file mode, blob OID and byte length, chunk ordinal, ranges, and content identity. The
attester registry is private. Git uses a canonical absolute executable with a hashed file identity,
a minimal private environment/home, disabled ambient config/replacements/prompts, and no provider
credentials. Pure evaluation and source extraction run in owned detached process groups. A result
frame remains pending until process close; abort wins a result/exit race; TERM escalates to KILL;
the entire group must be absent before ownership is released. Deployment shutdown has an explicit
open -> closing -> closed admission gate. Deployment abort leaves a deterministic cell admitted for
recovery instead of permanently settling a lifecycle interruption as program failure.

Plan nodes may now carry an optional `contextScope` distinct from `pathScope`. The concise
application derives broad Context read authority from the deployment profile while preserving the
caller's narrow write scope. This was not speculative: live dogfood with a report-only task showed
all 1,055 repository entries outside the edit scope and returned zero Context matches. The split
keeps `reviews/...` as the only writable path while allowing immutable repository Context without
asking the model to manage another routine scope knob.

The focused Goal/Plan, dynamic Workflow/revision, and Context slice is 62/62 green. The complete
implementation suite is 2,054/2,054 green after the scope split. Phase 83 runtime tests additionally cover late shutdown
admission, non-poisoning abort, result-before-exit, result/abort races, provider-secret isolation in
the owned process and Git child, private attester capability, invented/path/blob/dirty-tree
substitution, real restart, Run stop, and distinct Context/write scope.

Layer C remains deliberately pending: provider-backed `map`, `reduce`, `review`, and `verify` do not
yet compile a cell into a separately approved successor Plan and real Wave; child attachment,
synthesis/review gates, CP6 termination, descendant call-batch recovery, richer Atlas/AST/CST/
symbol/SCIP/CPG and shared-knowledge branches, four-arm utility evaluation, and optional REPL syntax
are not claimed. The next executable slice is one depth-one `map` successor Plan with exact role
routing, immutable partitions, fresh approval, durable child attachment, synthesis/review,
generation fencing, typed no-progress/repetition termination, and whole-subtree stop/reap shipped
together.

Live Phase 83 Baton-on-Baton evidence selected two parallel exact Codex routes,
`gpt-5.6-sol`/high and `gpt-5.6-sol`/xhigh, and ran a pure Context cell concurrently. Both provider
routes were requested/resolved/observed exactly, but neither produced its single scoped report
within roughly ten minutes and both accumulated millions of mostly cached token-accounting units.
The operator intentionally interrupted the run rather than reward runaway inspection. Baton
durably stopped it, returned a stop receipt with zero workers, removed both worktrees and processes,
closed with zero ownership, and preserved caller status/index. This is honest stop/reap and
orchestration-friction evidence, not Candidate success. It establishes the need for a compact
finish-now/synthesis intervention and deployment-owned concision/no-progress policy. Native Kimi
and Grok were attempted first but their cached subscription sessions had expired; Baton refused
both before spawn. Earlier Phase 81 native Kimi success remains historical evidence, not current
authentication evidence.
