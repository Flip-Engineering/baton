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
2. project each accepted provider result into one exact private content-addressed capsule so a
   later provider can consume actual grounded output rather than task metadata;
3. preserve the root Workflow role catalog across successor definitions;
4. generalize the durable map call envelope to `map | reduce` while separating one logical
   request from its retry generations;
5. settle failed calls and release every terminal descendant before retry;
6. add one immutable expression builder and one `context_eval` application action; and
7. live-prove `map -> reduce`, selective retry, replay, stop, and reap.

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

`source()`, `outline()`, `index()`, `search()`, `slice()`, `chunk()`, `filter()`, `project()`,
`sort()`, `unique()`, `join()`, `collect()`, `coverage()`, and `finish()` build frozen
`BatonContextExpression` values. `evaluate()` sends one closed pure Context Program through the
existing application. The current `search()`, `chunk()`, and `coverage()` helpers remain as
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
      "parents": [],
      "parentDigest": "sha256",
      "derivations": [],
      "derivationDigest": "sha256",
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

Let `H(value)` mean SHA-256 over Baton's canonical JSON. The identity grammar is exact:

```text
coordinateDigest = H(canonical sorted unique sourceCoordinates)
parentDigest = H(parents)
derivationDigest = H(derivations)
lineageDigest = H({
  schemaVersion: 1,
  itemDigest,
  coordinateDigest,
  parentDigest,
  derivationDigest
})
outputLineageDigest = H(
  outputLineages.map(({ index, itemDigest, lineageDigest }) =>
    ({ index, itemDigest, lineageDigest }))
)
```

`index` is excluded from `lineageDigest` so a deterministic sort may move one unchanged item while
preserving that item's semantic lineage. `outputLineageDigest` still binds exact item order. Pure
outputs have empty `parents` and `derivations`. Grouping operators use the canonical union of their
input coordinates; projection preserves input lineage; sorting moves lineage with its item;
`unique` retains the first selected item's lineage; `collect` gives each collected output the union
of its corresponding input; and `finish` unions its value and evidence inputs.

Historical v1 evidence remains replay-readable. A new provider-backed call refuses v1 evidence
with `context_output_lineage_required`; it never guesses item lineage from the aggregate union.

Call output evidence uses the same grammar and adds exact parent-output references and one direct
provider derivation:

```json
{
  "index": 0,
  "itemDigest": "sha256",
  "sourceCoordinates": [],
  "coordinateDigest": "sha256",
  "parents": [
    {
      "sourceKind": "cell_output",
      "sourceId": "cell:...",
      "sourceSettlementDigest": "sha256",
      "outputIndex": 0,
      "itemDigest": "sha256",
      "lineageDigest": "sha256",
      "evidenceRef": {}
    }
  ],
  "parentDigest": "sha256",
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

A map output has exactly one parent cell output. A reduce output has every selected map output as a
parent in canonical source order. Earlier provider ancestry remains replayable through those exact
parent evidence refs instead of being duplicated without bound. Parent source settlement, item,
lineage, evidence, or order substitution fails replay.

The physical Brief contains only the selected unit value and its verified source coordinates.
Raw values and coordinate arrays remain in the private CAS/Brief boundary and never enter the
coordination ledger.

### Provider-result capsules

Phase 84 call outputs contain task, route, artifact, and commit metadata. That is not sufficient
input for synthesis: a reduce Attempt must consume the actual grounded child report or repository
delta, not merely learn that a commit exists. Before a successful child can settle, the Context
runtime therefore projects its exact accepted retained result into one private capsule:

```json
{
  "schemaVersion": 1,
  "kind": "baton.context_provider_result",
  "callId": "context-call:...",
  "unitId": "context-unit:...",
  "taskId": "...",
  "taskVersion": 4,
  "terminalEvent": 901,
  "routeDigest": "sha256",
  "baseSha": "git-sha1",
  "resultSha": "git-sha1",
  "retainedResultRef": "refs/baton/results/...",
  "changedPaths": ["reviews/context/critic-0001.md"],
  "sourceRef": {
    "kind": "context_source",
    "ref": "ctx:sha256:...",
    "digest": "sha256",
    "mediaType": "application/json",
    "itemCount": 1
  },
  "projectionDigest": "sha256"
}
```

The projection reuses the repository Context producer against the exact accepted retained commit,
never the reaped worktree. It is limited to verified changed paths inside the role template's path
scope, admits only supported text, and applies the existing sensitive-path and secret-shaped-content
exclusions. Deployment policy owns file, item, and byte ceilings; callers never supply them. Raw
projected content remains in private Context CAS. The coordination ledger stores only the capsule,
source refs, and digests.

Each successful map output item is a safe provider-result ref bound to this capsule. A reduce Brief
privately reverifies and dereferences every selected capsule and materializes the actual content.
Changed retained ref, commit, base, blob, path set, source bytes, sensitivity classification,
projection digest, task, route, or release fails before reduce provider admission. An unavailable,
sensitive, binary-only, or oversized projection yields typed pre-effect attention; Baton never
falls back to task metadata and calls that synthesis.

## CLR2 — durable root role catalog

Phase 84 successor definitions contain only synthetic members such as `critic:0001`. That is
insufficient for recursion because a later `synthesizer` role disappears from the current
definition. Workflow definition schema version 3 separates semantic role authority from the
Attempt set:

```json
{
  "schemaVersion": 3,
  "roleCatalog": {
    "schemaVersion": 1,
    "kind": "baton.workflow_role_catalog",
    "roles": [
      {
        "role": "synthesizer",
        "route": {
          "harness": "codex",
          "model": "gpt-5.6-sol",
          "effort": "high"
        },
        "nodeTemplate": {
          "definitionOfDone": [],
          "pathScope": [],
          "contextScope": [],
          "risk": "medium",
          "verification": {},
          "capabilities": [],
          "effects": [],
          "requiredEffects": [],
          "workerPolicy": {}
        },
        "nodeTemplateDigest": "sha256"
      }
    ],
    "catalogDigest": "sha256"
  },
  "lineage": {
    "generation": 2,
    "rootDefinitionDigest": "sha256",
    "parentDefinitionDigest": "sha256"
  },
  "attempts": [
    {
      "role": "critic:0001",
      "logicalRole": "critic",
      "nodeKey": "attempt:critic:0001",
      "nodeTemplateDigest": "sha256",
      "route": {
        "harness": "codex",
        "model": "gpt-5.6-sol",
        "effort": "high"
      }
    }
  ]
}
```

Each node template retains the Plan fields Baton actually has for the semantic role: definition of
done, path/context scopes, risk, verification, capabilities, effects, required effects, and worker
policy. Exact harness/model/effort remains a separate catalog route. It excludes successor-specific
key, objective, dependencies, numeric budget, revision, and Context-call binding. A successor node
must equal exact template instantiation plus only those excluded successor fields; it cannot weaken
or add template authority.

Definition ancestry is non-cyclic. A root v3 definition uses:

```json
{
  "generation": 1,
  "rootDefinitionDigest": null,
  "parentDefinitionDigest": null
}
```

For every successor:

```text
generation = parent.lineage.generation + 1
parentDefinitionDigest = parent.definitionDigest
rootDefinitionDigest = parent.lineage.rootDefinitionDigest ?? parent.definitionDigest
```

The root does not claim its own not-yet-computable digest. A synthetic Attempt's `role` is its
unique execution role; `logicalRole` selects exactly one catalog entry. At the root they are equal.
Every successor Attempt repeats and matches the catalog template digest and route while remaining
bound to exactly one Plan node and, for Context calls, exactly one unit.

Every successor definition inherits the same content-addressed catalog and names its parent/root
definition. Synthetic Attempts bind one catalog role but never replace the catalog. Catalog,
template, route, lineage, or ancestry substitution fails before Plan proposal or provider effect.
Schema-v2 definitions remain replay-readable. A v2 definition may upgrade only roles directly and
exactly present in its bound Plan. In particular, a Phase 84 synthetic successor may not reconstruct
a disappeared root role by inference. A new recursive successor whose semantic role is not directly
present in v2 authority fails pre-effect instead of guessing ancestry.

## CLR3 — generic effect-call authority

Phase 84 compatibility helpers may remain, but durable calls normalize to one internal envelope:

```json
{
  "schemaVersion": 1,
  "kind": "baton.context_effect_call",
  "operator": "map",
  "requestId": "context-request:...",
  "requestDigest": "sha256",
  "generation": 1,
  "predecessorCall": null,
  "executionUnitIds": ["context-unit:..."],
  "inheritedChildren": [],
  "authority": {
    "contextPrincipal": {
      "actor": "deployment:context",
      "principalId": "service-context",
      "repoId": "...",
      "runId": "..."
    },
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
    "itemCount": 2,
    "coordinateDigest": "sha256",
    "outputLineageDigest": "sha256"
  },
  "role": "critic",
  "instruction": "...",
  "units": [
    {
      "index": 0,
      "inputs": [
        {
          "index": 0,
          "itemDigest": "sha256",
          "lineageDigest": "sha256"
        }
      ],
      "inputSetDigest": "sha256",
      "coordinateDigest": "sha256",
      "lineageDigest": "sha256",
      "unitId": "context-unit:...",
      "unitDigest": "sha256"
    }
  ],
  "callId": "context-call:...",
  "callDigest": "sha256"
}
```

The source is a closed discriminated union. Map uses the completed v2 cell source shown above.
Reduce uses:

```json
{
  "kind": "call",
  "id": "context-call:...",
  "callDigest": "sha256",
  "generation": 1,
  "settlementDigest": "sha256",
  "outputRef": {},
  "evidenceRef": {},
  "itemCount": 2,
  "coordinateDigest": "sha256",
  "outputLineageDigest": "sha256"
}
```

Each unit binds its selected source indexes, exact item digests, and exact lineage digests. Its
`inputSetDigest` binds that ordered list. `coordinateDigest` binds the canonical union of its
selected output coordinates. `lineageDigest` binds the selected output-lineage identities.
`unitDigest` binds operator, immutable source identity, logical role, instruction digest, inputs,
and both aggregate digests; `unitId = context-unit:<unitDigest>`. Two calls cannot reuse a unit ID
while changing its instruction, role, source, grouping, or lineage.

`map` requires at least two units and each unit selects exactly one source output index. `reduce`
requires a completed call source and exactly one unit selecting every source output index in
canonical order. Its role must resolve through the preserved catalog. Its successor Plan has one
node and still requires distinct approval before the one provider effect.

Logical request identity and execution generation identity are deliberately separate:

```text
requestDigest = H({ operator, source, role, instruction, units })
requestId = context-request:<requestDigest>
callDigest = H({
  requestId,
  generation,
  predecessorCall,
  authority,
  executionUnitIds,
  inheritedChildren
})
callId = context-call:<callDigest>
```

The request remains the same across a retry while the generation, current predecessor Plan,
predecessor call, executed units, and inherited children change honestly. Call authority includes
the exact Context principal so actor-scope substitution changes call identity. Changed source
bytes, output lineage, unit grouping, role, route, effort, definition ancestry, Plan head, tree,
profile, policy, actor, or generation conflicts before append. Phase 85 closes further ordinary
composition after a reduce result except an eligible retry; deeper recursion requires a later
explicit policy revision.

## CLR4 — settlement, failure, cleanup, and retry generation

Successful map and reduce settlements carry ordered output lineage and provider derivations plus
the Phase 84 per-task resource-release proof. A failed or cancelled child must also drive one
durable terminal call settlement after every terminal descendant is reaped:

```json
{
  "state": "failed",
  "providerEffects": 2,
  "children": [
    {
      "unitId": "context-unit:...",
      "unitDigest": "sha256",
      "index": 0,
      "origin": "executed",
      "state": "accepted",
      "nodeKey": "attempt:critic:0001",
      "nodeDigest": "sha256",
      "taskId": "...",
      "taskVersion": 4,
      "terminalEvent": 901,
      "workerId": "...",
      "routeDigest": "sha256",
      "resultRef": {},
      "resourceRelease": {},
      "childDigest": "sha256"
    },
    {
      "unitId": "context-unit:...",
      "unitDigest": "sha256",
      "index": 1,
      "origin": "executed",
      "state": "failed",
      "nodeKey": "attempt:critic:0002",
      "nodeDigest": "sha256",
      "taskId": "...",
      "taskVersion": 3,
      "terminalEvent": 917,
      "workerId": "...",
      "routeDigest": "sha256",
      "termination": {
        "code": "provider_turn_failed",
        "retryable": true,
        "summary": "Bounded non-secret summary"
      },
      "resourceRelease": {},
      "childDigest": "sha256"
    }
  ],
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

Failure evidence retains the complete canonical unit set: accepted, failed, and cancelled
dispositions plus exact task/Attempt/route/terminal/release coordinates. It does not invent one
aggregate accepted output. This complete set is required for selective retry; an empty child list
cannot prove which units succeeded. Retry cannot admit until the terminal failure settlement and
all cleanup are complete.

Phase 84 resource release currently applies only to completed tasks. Phase 85 generalizes the same
event and operational proof to every terminal task status. A failed or cancelled task still binds
its exact terminal event, worker, process generation, session, worktree, runtime, interactions, and
zero-ownership postchecks. A task that never acquired a worker cannot invent worker cleanup; it
remains visible pre-terminal attention until existing all-or-clean Wave reconciliation either
dispatches it or proves the Wave never admitted. Failure settlement never substitutes an
`owned: false` observation for durable release proof.

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
      {
        "unitId": "context-unit:...",
        "originCallId": "context-call:...",
        "childDigest": "sha256"
      }
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
retry, nonretryable failure, changed inputs, or changed route authority fail before provider effect.

Every retry settlement again contains the complete canonical logical unit set. Inherited rows use
`origin: inherited` and bind origin call and child digests; newly attempted rows use
`origin: executed`. `providerEffects` counts only newly executed units in that generation. A
projected cumulative count may sum generations but is never caller supplied. Deployment-owned
`maxRetryGenerations`, `maxContextCallDepth`, and `maxContextCallsPerRun` bound recursion without
becoming routine user/model controls.

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

`BatonContextExpression` is an immutable client compiler. It implements every existing pure
operator: `source`, `outline`, `index`, `search`, `slice`, `chunk`, `filter`, `project`, `sort`,
`unique`, `join`, `collect`, `coverage`, and `finish`. Each method returns a new frozen expression;
serialization returns one finite JSON value and cannot retain callbacks, handles, prototypes, or
ambient state. The semantic registry publishes the closed recursive Context Program JSON schema so
help is self-describing; a generic object schema is insufficient AX even though server-side
normalization remains authoritative.

Direct client, generic CLI, authenticated Web, and MCP use the same action registry entry, input
schema digest, authorization, and application method. The expression builder is a client compiler
only; it cannot grant powers absent from the JSON action. Existing convenience methods compile to
`context_eval` so the wire surface consolidates instead of expanding into one command per pure
operator. Legacy `context_search`, `context_chunk`, and `context_coverage` handlers may remain
replay-compatible aliases but are no longer advertised as competing ordinary actions.

## CLR6 — recovery, stop, and visibility

Replay derives each generation and its successor relationship from immutable events. Recovery may
re-propose an admitted exact Plan, dispatch only a missing approved Wave, finish cleanup, or attach
an already materialized lineage/result-capsule CAS settlement. It never reprojects changed result
bytes, re-executes a successfully inherited unit, or redelivers a provider effect whose
process/result state is ambiguous.

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
3. Every accepted provider child projects one exact private retained-commit result capsule; a
   reduce Brief consumes its actual reverified content after the child worktree is reaped, while raw
   bytes never enter coordination events.
4. One non-cyclic durable role catalog survives map/reduce successor Plans and preserves exact
   harness/model/effort plus node policy for every semantic role.
5. One logical request ID survives retry while every call generation binds its current authority,
   source union, exact selected item/lineage set, inherited children, and executed units.
6. A completed map call can propose one reduce Plan with zero provider effects before distinct
   approval; approval launches exactly one isolated routed Attempt.
7. Reduce output recursively composes source lineage, parent outputs, provider-result content, and
   provider derivations and remains untrusted/unselected/unintegrated/unpromoted.
8. Failed calls settle durably with every accepted/failed/cancelled unit disposition only after
   every terminal descendant has one exact all-terminal resource release.
9. Retry admits exactly one contiguous generation, creates nodes only for failed retryable units,
   inherits successful child digests without another provider effect, and settles the complete
   canonical logical unit set again.
10. Restart after call admission, Plan proposal, approval, partial Wave, terminal child, cleanup,
   result-capsule CAS write, settlement, or retry admission converges without duplicate provider
   effects.
11. Immutable expression objects cover every existing pure Context operator and compile through
   one `context_eval` action; effects and arbitrary code fail pre-effect.
12. Direct client, CLI, authenticated Web, and MCP expose identical action schemas/digests,
    call identities, cascade inspection, and help.
13. Run stop during map, reduce, or retry fences descendants and proves zero remaining calls,
    workers, processes, sessions, worktrees, runtimes, and interactions.
14. Focused lineage/authority/replay/lifecycle/transport tests and the complete suite pass.
15. Live Baton-on-Baton evidence proves an exact routed parallel map whose real child reports are
    consumed by a separately approved reduce, at least one induced selective-retry path, restart
    replay, and full stop/reap without caller worktree contamination.

## Red-team matrix

- Tamper output item order/digest, coordinate subset/order, lineage/derivation digest, role catalog,
  parent output, provider-result retained ref/commit/blob/path/source/projection, template, ancestry,
  request/call identity, operator/generation/source/unit, predecessor, inherited child, retry set,
  Plan, route, task, cleanup, or settlement; replay must fail typed.
- Race identical reduce/retry requests, retry with stop, approval with stop, failure settlement with
  retry, retry admission with Plan advancement, result with cleanup, and close with reconciliation.
- Attempt route/model/effort/permission/credential/budget/concurrency/provider-command injection
  through ContextValue bytes, instruction, expression AST, action payload, transports, or retry.
- Use v1 union-only evidence for a new provider effect, a cell/call from another Run/tree/repository,
  a stale or cyclic role catalog, a synthetic v2 definition missing the requested logical role, a
  successful or nonretryable call as retry source, a generation gap, or two successor forks.
- Exhaust item/coordinate/definition/Plan/task/capacity ceilings and require typed pre-effect
  attention without caller-managed byte or budget knobs.
- Attempt to synthesize task metadata without a reverified provider-result capsule, release a
  failed/cancelled descendant using a completed-task-only proof, or settle failure without the full
  canonical unit set; all fail typed.
- Prove immutable shared inputs do not imply shared mutable workspace or combined process identity.

## Build order and red suites

1. `phase85-context-lineage-red.test.mjs`: item lineage through source, outline, index, search,
   slice, chunk, filter, project, sort, unique, join, collect, coverage, and finish; grouping unions,
   projection preservation, sorted movement, output-order digest, v1 read/v2 effect refusal,
   distinct map coordinates, private Briefs, and byte/index/coordinate/parent substitution replay
   failures.
2. `phase85-context-result-capsule-red.test.mjs`: actual report/delta projection from exact accepted
   retained commits after worktree reap; private CAS materialization into a later Brief; changed ref,
   base, commit, blob, path set, source bytes, sensitivity, projection, route, task, and release
   refusal; no raw capsule content in coordination events.
3. `phase85-context-role-catalog-red.test.mjs`: root role survival; non-cyclic root/parent/generation
   ancestry; exact template instantiation; template/route/model/effort/catalog tamper refusal; v2
   direct-role upgrade; synthetic-v2 missing-role refusal; and restart replay.
4. `phase85-context-eval-application-red.test.mjs`: immutable builder and normalized programs for
   every pure operator; one advertised action/schema digest; compatibility helpers emit
   `context_eval`; effect/code/path/route/provider-command/credential refusal.
5. `phase85-context-reduce-red.test.mjs`: preapproval zero effect; one approved Attempt; actual child
   capsule content in the reduce Brief; complete parent/source lineage and direct derivation;
   nonterminal/v1/stale/cross-Run/already-composed refusal; no implicit truth, selection,
   integration, adoption, publication, or promotion.
6. `phase85-context-call-generation-red.test.mjs`: durable failed settlement with the complete unit
   set; completed/failed/cancelled task release; selective retry of only failed retryable units;
   inherited-success provider-effect suppression; request identity continuity; idempotency;
   generation/fork/head/source/role/route/nonretryable/stop refusal; and crash convergence after
   admission, definition prebinding, Plan proposal, approval, partial Wave, terminal task, release,
   capsule CAS, settlement, and retry admission.
7. `phase85-context-composition-transport-red.test.mjs`: direct/CLI/authenticated-Web/MCP registry,
   schema, result, and help parity; call-handle reduce/retry/output/evidence/complete/help cascade;
   all-generation stop targeting and zero remaining descendants.
8. Adversarial review, focused/full validation, then concise live evidence whose reduce report quotes
   or otherwise verifiably incorporates content unique to each mapped child capsule.

Implementation follows the same dependency order: add v2 lineage validation; add retained-result
capsule projection/materialization; bind Workflow definition v3 and exact role templates; introduce
generic request/call/unit authority while keeping the Phase 84 adapter; add terminal failure and
all-terminal release; add retry generations; consolidate pure evaluation through the immutable
builder; then add reduce, transport parity, recovery/stop reconciliation, and live proof.

New implementation modules should be `context-lineage.mjs`, `context-result.mjs`, and
`context-call.mjs`.
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
