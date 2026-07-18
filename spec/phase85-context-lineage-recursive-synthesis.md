# Phase 85 — Addressed Context lineage and recursive synthesis

## Decision

Phase 85 turns the depth-one Phase 84 map into one honest recursive Context workflow:

`pure selection -> map Wave -> reduce Attempt -> optional selective retry`

It does not create a second orchestration engine, an ambient Python runtime, a mutable shared
sandbox, or an unbounded agent-authored loop. Every provider effect remains an ordinary successor
Goal/Plan generation with distinct approval, exact route authority, isolated writable state,
durable terminal evidence, and restart-safe resource release.

The dependency order is load-bearing:

1. persist exact lineage for every Context output item;
2. preserve the root Workflow role catalog across successor definitions;
3. generalize the durable map call envelope to `map | reduce`;
4. settle failed calls and release every terminal descendant before retry;
5. add one immutable expression builder and one `context_eval` application action; and
6. live-prove `map -> reduce`, selective retry, replay, stop, and reap.

Executable `review` and `verify`, a custom syntax, persistent kernels, and recursion beyond one
map plus one reduce remain catalogued but are not advertised in this phase. Review first needs a
durable independence policy and typed review artifact. Verify first needs a deployment-owned gate
registry. A checksum re-read is not semantic verification.

## Agent experience

The outer surface is one Context object with immutable expressions and addressed results:

```python
ctx = run.context()
expr = ctx.source("repository").search(
    "authority",
    mode="case_insensitive",
).chunk(by="path")

parts = await ctx.evaluate(expr)
reviews = await ctx.map(
    parts,
    role="critic",
    instruction="Review only your grounded partition.",
)
await run.approve()
await reviews.complete()

synthesis = await reviews.reduce(
    role="synthesizer",
    instruction="Synthesize only the attached grounded findings.",
)
await run.approve()
await synthesis.complete()

if synthesis.failed:
    retry = await synthesis.retry()
```

`source()`, `search()`, `slice()`, `chunk()`, `sort()`, `join()`, `collect()`, and `finish()` build
frozen `BatonContextExpression` values. `evaluate()` sends one closed pure Context Program through
the existing application. The current `search()`, `chunk()`, and `coverage()` helpers remain as
compatibility sugars over the same action. There are no ambient variables, filesystem handles,
credentials, callbacks, arbitrary code strings, or persistent interpreter state.

Help and inspection retain Baton's cascade: outline -> index -> section -> item -> evidence. A
call handle owns `outline()`, `output()`, `evidence()`, `reduce()`, `retry()`, `complete()`, and
`help()`. Ordinary callers still do not manage Plan IDs, Wave IDs, task IDs, worker IDs, budgets,
timeouts, concurrency, CAS sizes, export ceilings, cleanup coordinates, or provider commands.

## CLR1 — exact per-output lineage

The pure evaluator already derives lineage per result item. New settlements must retain it instead
of collapsing it to one union. `baton.context_cell_evidence` schema version 2 adds:

```json
{
  "schemaVersion": 2,
  "kind": "baton.context_cell_evidence",
  "sourceCoordinates": [],
  "coordinateDigest": "sha256",
  "outputLineages": [
    {
      "index": 0,
      "itemDigest": "sha256",
      "sourceCoordinates": [],
      "coordinateDigest": "sha256",
      "lineageDigest": "sha256"
    }
  ],
  "outputLineageDigest": "sha256"
}
```

The validator requires:

- output lineage count equals output item count;
- indices are canonical, contiguous, and unique;
- each item digest binds that exact output item;
- every coordinate reverifies against the admitted manifest source;
- every coordinate and lineage digest recomputes exactly;
- the canonical union of output coordinates equals the existing aggregate coordinates; and
- the aggregate output-lineage digest binds the complete ordered list.

Historical v1 evidence remains replay-readable. A new provider-backed call refuses v1 evidence
with `context_output_lineage_required`; it never guesses item lineage from the aggregate union.

Call output evidence uses the same grammar and adds provider derivations:

```json
{
  "index": 0,
  "itemDigest": "sha256",
  "sourceCoordinates": [],
  "coordinateDigest": "sha256",
  "derivations": [
    {
      "kind": "provider_attempt",
      "callId": "context-call:...",
      "unitId": "context-unit:...",
      "planDigest": "sha256",
      "nodeDigest": "sha256",
      "taskId": "...",
      "taskVersion": 4,
      "routeDigest": "sha256",
      "artifactDigest": "sha256",
      "cleanupDigest": "sha256",
      "childDigest": "sha256"
    }
  ],
  "derivationDigest": "sha256",
  "lineageDigest": "sha256"
}
```

The physical Brief contains only the selected unit value and its verified source coordinates.
Raw values and coordinate arrays remain in the private CAS/Brief boundary and never enter the
coordination ledger.

## CLR2 — durable root role catalog

Phase 84 successor definitions contain only synthetic members such as `critic:0001`. That is
insufficient for recursion because a later `synthesizer` role disappears from the current
definition. Workflow definition schema version 3 separates semantic role authority from the
Attempt set:

```json
{
  "schemaVersion": 3,
  "roleCatalog": {
    "roles": [
      {
        "role": "synthesizer",
        "route": {
          "harness": "codex",
          "model": "gpt-5.6-sol",
          "effort": "high"
        },
        "nodeTemplate": {},
        "nodeTemplateDigest": "sha256"
      }
    ],
    "digest": "sha256"
  },
  "lineage": {
    "rootDefinitionDigest": "sha256",
    "parentDefinitionDigest": "sha256"
  },
  "attempts": []
}
```

Each node template retains the semantic role's constraints, path/context scopes, verification,
capabilities, effects, required effects, worker policy, and exact harness/model/effort route. It
excludes successor-specific key, objective, dependencies, and newly allocated numeric budget.

Every successor definition inherits the same content-addressed catalog and names its parent/root
definition. Synthetic Attempts bind one catalog role but never replace the catalog. Catalog,
template, route, lineage, or ancestry substitution fails before Plan proposal or provider effect.
Schema-v2 definitions remain replay-readable but cannot admit a recursive successor whose role is
not directly present.

## CLR3 — generic effect-call authority

Phase 84 compatibility helpers may remain, but durable calls normalize to one internal envelope:

```json
{
  "schemaVersion": 1,
  "kind": "baton.context_effect_call",
  "operator": "map",
  "generation": 1,
  "predecessorCall": null,
  "authority": {
    "repoId": "...",
    "runId": "...",
    "sessionId": "...",
    "manifestDigest": "sha256",
    "treeSha": "git-sha1",
    "environmentDigest": "sha256",
    "policyDigest": "sha256",
    "definitionDigest": "sha256",
    "roleCatalogDigest": "sha256",
    "profileDigest": "sha256",
    "predecessorPlan": {}
  },
  "source": {
    "kind": "cell",
    "id": "cell:...",
    "admissionDigest": "sha256",
    "settlementDigest": "sha256",
    "outputRef": {},
    "evidenceRef": {},
    "coordinateDigest": "sha256",
    "outputLineageDigest": "sha256"
  },
  "role": "critic",
  "instruction": "...",
  "units": [
    {
      "index": 0,
      "inputIndices": [0],
      "inputSetDigest": "sha256",
      "coordinateDigest": "sha256",
      "lineageDigest": "sha256",
      "unitId": "context-unit:...",
      "unitDigest": "sha256"
    }
  ]
}
```

`map` requires at least two units and each unit selects exactly one source output index. `reduce`
requires a completed call source and exactly one unit selecting every source output index in
canonical order. Its role must resolve through the preserved catalog. Its successor Plan has one
node and still requires distinct approval before the one provider effect.

Call identity binds operator, generation, predecessor, complete authority, source refs/evidence,
role, instruction, and units. Changed source bytes, output lineage, unit grouping, role, route,
effort, definition ancestry, Plan head, tree, profile, policy, actor, or generation conflicts before
append. Phase 85 closes further ordinary composition after a reduce result except an eligible
retry; deeper recursion requires a later explicit policy revision.

## CLR4 — settlement, failure, cleanup, and retry generation

Successful map and reduce settlements carry ordered output lineage and provider derivations plus
the Phase 84 per-task resource-release proof. A failed or cancelled child must also drive one
durable terminal call settlement after every terminal descendant is reaped:

```json
{
  "state": "failed",
  "providerEffects": 2,
  "children": [],
  "childDigest": "sha256",
  "cleanup": {},
  "termination": {
    "code": "context_child_failed",
    "retryable": true,
    "summary": "Bounded non-secret summary"
  },
  "outputRef": null,
  "evidenceRef": {}
}
```

Failure evidence retains every unit disposition and exact task/Attempt/route/terminal/release
coordinate without inventing accepted output. Retry cannot admit until that terminal cleanup is
complete.

A retry is the next generation of the same logical request, not a mutable retry ledger:

```json
{
  "generation": 2,
  "predecessorCall": {
    "callId": "context-call:...",
    "callDigest": "sha256",
    "generation": 1,
    "settlementDigest": "sha256",
    "inheritedChildren": [
      { "unitId": "context-unit:...", "childDigest": "sha256" }
    ],
    "retryUnitIds": ["context-unit:..."],
    "retryDigest": "sha256"
  }
}
```

Only failed units receive new Plan nodes. Successful units are inherited by exact digest and never
rerun. Admission requires terminal cleanup, unchanged source/role/instruction, current unchanged
Plan head, contiguous generation, deployment recursion/budget authority, and no existing successor
generation. Duplicate identical retry is idempotent. Gaps, forks, stale heads, successful-call
retry, changed inputs, or changed route authority fail before provider effect.

## CLR5 — unified pure evaluation surface

The semantic registry adds:

```text
context_eval   { program, role? }
context_reduce { callId, instruction, role? }
context_retry  { callId }
```

`context_eval` accepts only the normalized closed pure Context Program schema. Nested `map`,
`reduce`, `review`, `verify`, route tuples, credentials, provider commands, filesystem paths,
callbacks, and arbitrary code fail before cell or provider effect. Role remains optional only when
one current target session/role is unambiguous.

Direct client, generic CLI, authenticated Web, and MCP use the same action registry entry, input
schema digest, authorization, and application method. The expression builder is a client compiler
only; it cannot grant powers absent from the JSON action. Existing convenience methods compile to
`context_eval` so the wire surface consolidates instead of expanding into one command per pure
operator.

## CLR6 — recovery, stop, and visibility

Replay derives each generation and its successor relationship from immutable events. Recovery may
re-propose an admitted exact Plan, dispatch only a missing approved Wave, finish cleanup, or attach
an already materialized CAS settlement. It never re-executes a successfully inherited unit or
redelivers a provider effect whose process/result state is ambiguous.

Run stop v3 snapshots every Context call generation and the complete transitive union of Plans,
tasks, Attempts, provider processes/sessions, worktrees, runtimes, interactions, and pure Context
execution. It fences new retry/reduce admission before cancellation. Completion requires every
call terminal or stopped, every mapped worker release replay-verifiable, and every remaining count
zero. Late results remain forensic Attempt evidence and cannot attach to an older or newer call.

Context outline reports pure cells, calls, generations, provider effects, current operator, and
the next approval/observation/retry action. Item depth shows source, units, role, Plan, route,
generation ancestry, termination, and cleanup. Evidence depth reveals per-output source lineage
and provider derivations without revealing private raw partition bytes or secrets.

## Acceptance criteria

1. Every newly settled pure Context cell carries closed v2 per-output lineage whose union equals
   the existing aggregate evidence; byte/index/coordinate substitution fails replay.
2. Map partitions receive exact distinct item lineage and physical Briefs contain only the selected
   value/coordinates.
3. One durable role catalog survives map/reduce successor Plans and preserves exact
   harness/model/effort plus node policy for every semantic role.
4. A completed map call can propose one reduce Plan with zero provider effects before distinct
   approval; approval launches exactly one isolated routed Attempt.
5. Reduce output recursively composes source lineage and provider derivations and remains
   untrusted/unselected/unintegrated/unpromoted.
6. Failed calls settle durably only after every terminal descendant has one exact resource release.
7. Retry admits exactly one contiguous generation, creates nodes only for failed units, and
   inherits successful child digests without another provider effect.
8. Restart after call admission, Plan proposal, approval, partial Wave, terminal child, cleanup,
   CAS write, settlement, or retry admission converges without duplicate provider effects.
9. Immutable expression objects cover every existing pure Context operator and compile through
   one `context_eval` action; effects and arbitrary code fail pre-effect.
10. Direct client, CLI, authenticated Web, and MCP expose identical action schemas/digests,
    call identities, cascade inspection, and help.
11. Run stop during map, reduce, or retry fences descendants and proves zero remaining calls,
    workers, processes, sessions, worktrees, runtimes, and interactions.
12. Focused lineage/authority/replay/lifecycle/transport tests and the complete suite pass.
13. Live Baton-on-Baton evidence proves an exact routed parallel map, a separately approved reduce,
    at least one induced selective-retry path, restart replay, and full stop/reap without caller
    worktree contamination.

## Red-team matrix

- Tamper output item order/digest, coordinate subset/order, lineage/derivation digest, role catalog,
  template, ancestry, call operator/generation/source/unit, predecessor, inherited child, retry set,
  Plan, route, task, cleanup, or settlement; replay must fail typed.
- Race identical reduce/retry requests, retry with stop, approval with stop, failure settlement with
  retry, retry admission with Plan advancement, result with cleanup, and close with reconciliation.
- Attempt route/model/effort/permission/credential/budget/concurrency/provider-command injection
  through ContextValue bytes, instruction, expression AST, action payload, transports, or retry.
- Use v1 union-only evidence for a new provider effect, a cell/call from another Run/tree/repository,
  a stale role catalog, a successful call as retry source, a generation gap, or two successor forks.
- Exhaust item/coordinate/definition/Plan/task/capacity ceilings and require typed pre-effect
  attention without caller-managed byte or budget knobs.
- Prove immutable shared inputs do not imply shared mutable workspace or combined process identity.

## Build order and red suites

1. `phase85-context-lineage-red.test.mjs`: item lineage through search, slice, chunk, sort, join,
   collect, and finish; distinct map coordinates; private Brief; substitution replay failures.
2. `phase85-context-role-catalog-red.test.mjs`: root role survival, template/route tamper refusal,
   definition ancestry, and restart replay.
3. `phase85-context-eval-application-red.test.mjs`: immutable builder, one action/schema digest,
   pure-operator coverage, effect/code/route/credential refusal.
4. `phase85-context-reduce-red.test.mjs`: preapproval zero effect, one approved Attempt, recursive
   lineage/derivation, no implicit selection/integration/promotion.
5. `phase85-context-call-generation-red.test.mjs`: failed settlement/reap, selective retry,
   idempotency, generation/fork/head/source/role refusal, and crash convergence.
6. `phase85-context-composition-transport-red.test.mjs`: direct/CLI/Web/MCP parity and call-handle
   reduce/retry/output/evidence/help cascade.
7. Adversarial review, focused/full validation, then concise live evidence.

New implementation modules should be `context-lineage.mjs` and `context-call.mjs`.
`context-map.mjs` remains a compatibility adapter. Expected edits include `context-program.mjs`,
`context-runtime.mjs`, `goal-plan.mjs`, `coordination-store.mjs`, `coordinator.mjs`,
`application.mjs`, `application-semantics.mjs`, `application-client.mjs`, `index.mjs`, transport
adapters, and checkpoint/evidence documentation.

## Explicitly deferred

- independent provider-backed `review` until route/role independence is durable;
- deterministic `verify` until a deployment-owned Context gate registry exists;
- recursion deeper than one map plus one reduce;
- ambient/custom Python, Starlark, shell, callbacks, or arbitrary code evaluation;
- persistent REPL kernels or hidden session variables;
- shared writable multi-agent worktrees;
- automatic consensus, selection, integration, push, publication, or Cairn promotion;
- richer Atlas AST/CST/symbol/SCIP/CPG branches and the typed shared knowledge graph, which remain
  preserved in the full goal and later dependency-ordered phases; and
- homelab integration, which is outside Baton.
