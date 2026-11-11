# Phase 54 — Atlas bounded lexical-binding-aware CPG

Phase 54 deepens the shipped single-file JavaScript/TypeScript R3 slice. The current graph computes
CFG may-reaching definitions by identifier spelling. That can join two distinct lexical bindings and
fabricate a taint path, for example from a block-local `let value = readInput()` to a later use of an
outer `value`. This phase gives the existing CPG, delta, and taint operations one shared, bounded
binding model before any interprocedural, alias, heap, or semantic-merge work is attempted.

This is a precision increment, not a new representation rung. It adds no operation and changes no
authority. `cpg.build`, `cpg.delta`, and `cpg.taint` remain deterministic advisory ACI operations
that write content-addressed artifacts only.

## LB1 — closed supported syntax and honest capability cards

The binding model applies only to the JavaScript/TypeScript-family grammars already accepted by
`AtlasCpgSlice`: `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`.

Within one function-like body, the closed supported binding syntax is:

- a simple identifier in formal parameters;
- a simple identifier declarator in `var`, `let`, or `const` declarations;
- a simple identifier on the left of an assignment expression; and
- a bare value-position identifier reference which is not a property name, label, import/export
  specifier, type-only name, declaration name, or other syntax-only identifier.

Supported function-like bodies remain the existing `function_declaration`,
`generator_function_declaration`, `method_definition`, `function_expression`, and `arrow_function`
kinds. The model recognizes their function scope and every nested `statement_block` as a lexical
scope even when the shipped CFG treats the surrounding control construct atomically.

The `AtlasCpgSlice`, `AtlasCpgDelta`, and `AtlasCpgTaint` cards name the binding-model version,
publish the deployment ceilings which govern it, and replace the old “no shadowing-aware bindings”
limitation with the exact remaining limits from LB11. They must not advertise closure capture,
interprocedural flow, SSA, full PDG, or semantic proof.

## LB2 — deterministic scope identity

Each function-like body owns exactly one function scope. Each nested `statement_block`, excluding
the function body already represented by the function scope, owns one block scope beneath its
nearest enclosing scope in the same function.

Every scope node records:

- `type: "scope"`;
- `scopeKind: "function" | "block"`;
- the owning function node id;
- its parent scope id, or `null` for the function scope;
- a source-local `scopeId`; and
- a formatting-insensitive `scopeKey` used by CPG delta.

`scopeId` is deterministically derived from the exact source digest, owning function identity,
scope kind, and syntax range. `scopeKey` is derived from the function's existing semantic key and a
named-AST preorder path of nested supported scopes; it contains no absolute path, host identity, raw
source, or source digest. Whitespace and comments alone cannot change a scope key. Adding, removing,
or nesting a lexical block may change the affected scope path and is a real structural change, not
formatting noise.

Scope construction stops at a nested function boundary. A nested function gets its own function
scope; its resolver never walks into the enclosing function's scopes.

## LB3 — deterministic binding identity

Each supported declaration creates or joins one binding node in its owning scope:

- simple parameters and simple `var` declarators use the containing function scope and binding kind
  `function_value`;
- simple `let` and `const` declarators use the nearest enclosing block or function scope and binding
  kind `block_lexical`; and
- a simple assignment-left identifier never creates a binding. It is a definition occurrence of the
  nearest visible existing binding, or remains unresolved.

A parameter and `var` declaration with the same name in one function refer to the same
`function_value` binding. Multiple declarations which map to the same supported scope/name/kind
retain one binding node and multiple definition occurrences. Baton does not claim to validate
JavaScript early errors, temporal-dead-zone behavior, or declaration legality.

Every binding node records:

- `type: "binding"`;
- `name`;
- `bindingKind: "function_value" | "block_lexical"`;
- owning function and scope ids;
- a source-local `bindingId`; and
- a formatting-insensitive `bindingKey` used by CPG delta.

`bindingId` is deterministically derived from the source digest, scope id, binding kind, and name.
`bindingKey` is derived from the scope key, binding kind, and name. The graph emits one `DECLARES`
edge from the scope node to each binding node and one `BINDS` edge from the binding node to every
resolved definition or reference occurrence. These edges are structural lineage only; they are not
taint-flow edges.

## LB4 — nearest-visible resolution and explicit unresolved state

Every supported identifier occurrence records `scopeId`, `scopeKey`, `bindingId`, `bindingKey`, and
`bindingResolution`. `bindingResolution` is one of:

- `resolved` — the nearest visible supported binding in the same function;
- `unresolved` — no supported same-function binding exists; or
- `unsupported` — the identifier occurs in syntax outside LB1's closed value-binding subset.

For an ordinary reference or assignment-left occurrence, resolution starts at its innermost scope
and walks parent scopes within the same function. A block-local binding shadows a same-name outer
binding only inside that block. A `var` declaration inside a block resolves to the function binding.
Resolution never falls back to spelling-only matching and never crosses a function boundary.

Declaration visibility is lexical, while value reachability remains CFG-based. Resolving a
reference to a binding does not assert that a declaration value reaches it, does not erase temporal
dead zones, and does not create a `REACHING_DEF` edge by itself. Unresolved or unsupported
occurrences remain in the syntax/containment graph but cannot acquire fabricated binding or
reaching-definition edges.

## LB5 — binding-aware CFG may-reaching definitions

The Phase 22 dataflow state is keyed by `bindingId`, never by identifier text. Definitions generate
values only for their resolved binding. References consume incoming definitions only for their
resolved binding. The existing CFG fixed point, branch joins, literal-dead-branch pruning, atomic
unsupported-control behavior, and `maxReachDefPairs` ceiling otherwise remain unchanged.

`REACHING_DEF` continues to mean that a definition of the same binding may reach a reference through
the shipped intraprocedural CFG without another definition of that binding on that path. It is not
SSA, must-def, definite assignment, a temporal-dead-zone analysis, or a proof that an execution path
is feasible.

The defining regression is closed: in

```js
function run(flag) {
  let value = safe()
  if (flag) {
    let value = readInput()
    consume(value)
  }
  send(value)
}
```

the inner source definition may reach `consume(value)` but cannot reach the outer `send(value)`.

## LB6 — taint inherits binding truth without new policy

`cpg.taint` keeps its existing operator-supplied source, sink, and sanitizer vocabulary. It traverses
only `ASSIGNED_FROM`, binding-aware `REACHING_DEF`, and `ARGUMENT_TO`. It never traverses `DECLARES`
or `BINDS` as value flow.

Identifier records embedded in a taint witness include their `bindingKey` and
`bindingResolution`. The result artifact pins the CPG graph schema and binding-model version.
Provenance uses the meaning
`cfg_binding_aware_may_reach_value_graph_not_safety_proof`.

The LB5 example returns no `readInput` → `send` witness, while an inner sink using the inner binding
still returns a witness and an outer source using the outer binding remains visible across an
unrelated inner shadow. An absent witness still proves nothing about aliases, heap flow, closures,
exceptions, implicit flow, dynamic dispatch, or interprocedural returns.

## LB7 — delta and impact inherit stable binding identity

`cpg.delta` consumes only graphs with the Phase 54 graph schema and binding-model version. Its
semantic projection includes explicit scope and binding records keyed by `scopeKey` and
`bindingKey`; identifier projections carry their resolved binding key. It does not compare
source-local ids or byte ranges as semantic binding identity.

Whitespace/comment-only movement remains an empty delta. Adding, removing, or relocating a lexical
declaration, changing `let` to function-scoped `var`, or changing which binding an assignment or
reference resolves to produces explicit scope/binding/`BINDS`/`REACHING_DEF` changes. Impact may
follow `DECLARES` and `BINDS` for structural lineage in addition to the already shipped `CONTAINS`,
`CALLS`, and `REACHING_DEF` relations. This is bounded graph reachability, not behavioral impact or
semantic equivalence.

Delta provenance pins both child graph digests, graph schema, binding-model version, counts, and
`binding_aware_seed_graph_reachability_not_behavioral_proof` as its impact meaning.

## LB8 — deployment-derived bounds and typed refusal

The CPG constructor requires positive deployment-derived safe integers for:

- `maxScopes`;
- `maxScopeDepth`;
- `maxBindings`;
- `maxBindingOccurrences`; and
- the existing source, graph-artifact, and reaching-definition-pair ceilings.

The same exact binding ceilings are passed through `AtlasCpgDelta` and `AtlasCpgTaint` to their
nested graph builders. No component substitutes an internal default or silently truncates the
graph.

Crossing a ceiling refuses before publishing the graph or any derived delta/taint artifact:

- scopes: `scope_too_large`;
- scope nesting: `scope_depth_exceeded`;
- bindings: `binding_too_large`;
- bound occurrences/`BINDS` edges: `binding_occurrences_too_large`; and
- reaching-definition pairs: the existing `reachdef_too_large`.

Source bytes and final artifact bytes remain independent outer ceilings. Cancellation is checked
during scope construction, resolution, the CFG fixed point, delta projection/impact, and taint
traversal.

## LB9 — schema, artifact, and provenance integrity

Phase 54 bumps the CPG artifact to schema version 3, the CPG-delta artifact to schema version 2, and
the CPG-taint artifact to schema version 2. All three carry
`bindingModel: "atlas-js-lexical-bindings-v1"`.

CPG provenance additionally records `scopeCount`, `maxScopeDepthObserved`, `bindingCount`,
`bindingOccurrenceCount`, `resolvedBindingOccurrences`, `unresolvedBindingOccurrences`,
`unsupportedBindingOccurrences`, `reachDefPairs`, and scope
`single_file_intraprocedural_cfg_binding_aware_may_reach_seed`. Counts are computed from the complete
artifact, not the token-bounded inline projection.

Resume validates the new schema and binding-model version before returning any row. Old-schema,
mixed-model, substituted-child, malformed-key, duplicate-node/edge, digest-mismatched, or wrong-path
artifacts refuse typed `artifact_integrity`; the runtime never reinterprets an old spelling-based
graph as binding-aware. Reverify rebuilds the full claim from source and compares its content digest.

Parse errors continue to yield `partial`, never a complete binding claim. Token budgets may produce
`needs_resume` without changing the complete artifact or its counts.

## LB10 — no authority or transport expansion

Phase 54 adds no operation and no public command. Existing deployment registration controls whether
`cpg.build`, `cpg.delta`, and `cpg.taint` are reachable through direct, authenticated web, or MCP ACI.
The operations gain no worktree-write, structural-apply, worker-control, verification, review,
approval, integration, merge, publication, routing, proof, or policy-authoring authority.

Binding, delta, and taint artifacts are advisory evidence. They cannot mark a task verified, skip a
pinned check, authorize a merge, classify a change safe, or mutate a worktree. Generic northbound
invocation retains the existing repository, actor, idempotency, budget, cancellation, artifact, and
reverify gates.

## LB11 — explicit non-goals

Phase 54 does not claim or implement:

- destructuring patterns, rest/default parameter binding semantics, imports/exports, class/private
  fields, labels, type-namespace resolution, catch parameters, or dynamic property identity;
- closure capture or any resolution across a function boundary;
- module resolution, repository-wide bindings, live LSP, SCIP-backed type identity, overloads, or
  dynamic dispatch;
- temporal-dead-zone, hoisting-legality, definite-assignment, JavaScript early-error, or type-flow
  analysis;
- aliases, object properties, heap flow, prototype flow, implicit/control taint, exceptions, async
  scheduling, generators, or interprocedural argument/parameter/return flow;
- SSA, phi nodes, must-def, full PDG, SAT/SMT path solving, or path-feasibility proof;
- behavior equivalence, effect signatures, semantic merge, rewrite apply, verification, or a safety
  verdict.

Unsupported binding syntax remains visible as syntax with `bindingResolution: "unsupported"` where
an identifier occurrence is emitted. It must not be approximated as a same-name supported binding.
A later phase may add one closed syntax or flow class only with its own bounds, counterexamples, and
honest provenance.

## LB12 — red tests and acceptance gates

The Phase 54 focused suite uses the following exact acceptance ids:

- **LB1:** cards advertise the exact supported syntax, binding-model version, schemas, ceilings,
  advisory meaning, and retained non-goals; no new operation or authority appears.
- **LB2:** function/block scope nodes, parent links, ids, and keys are deterministic; whitespace and
  comments preserve semantic scope keys; nested functions start a fresh scope tree.
- **LB3:** parameters plus `var` share one function binding by name; nested `let`/`const` declarations
  have distinct block bindings; `DECLARES` and `BINDS` are deterministic and duplicate-free.
- **LB4:** references and assignment-left definitions choose the nearest visible same-function
  binding; unresolved, outer-capture, property/type/syntax-only, and unsupported-pattern identifiers
  fabricate no binding edge.
- **LB5:** the named shadowing regression emits no inner-definition → outer-reference
  `REACHING_DEF`; inner-to-inner and outer-to-outer flow remain; branch/literal pruning behavior is
  unchanged.
- **LB6:** taint reports no false inner-source → outer-sink path, still reports the inner-source →
  inner-sink and genuine outer-source → outer-sink paths, and exposes binding keys in witnesses.
- **LB7:** a scope-changing edit produces stable binding/value-edge delta and affected rows;
  formatting-only movement remains empty; delta never claims behavioral impact.
- **LB8:** exact max and max+1 fixtures cover scopes, depth, bindings, bound occurrences, and
  reaching-definition pairs; refusal leaves no parent or derived artifact.
- **LB9:** graph/delta/taint determinism, parse-partial status, cancellation, bounded inline result,
  resume, schema/model mismatch, child substitution, path escape, tamper, and reverify all fail or
  succeed exactly as specified.
- **LB10:** direct and configured generic web/MCP invocation expose identical advisory claims and no
  write, verification, merge, approval, publication, routing, proof, or policy authority.
- **LB11:** closure capture, destructuring, object-property flow, and interprocedural return fixtures
  remain negative and are named as unsupported rather than safety-clean.
- **LB12:** the adjacent Phase 18/19/20/22 representation suites, the Phase 46 retained-ladder suite,
  and the canonical Baton suite remain green. A Baton-on-Baton proof analyzes a real `.mjs` file,
  observes at least one resolved binding and binding-aware reaching-definition edge, runs delta and
  taint through the public ACI path, reverifies every claim, and leaves no worker, worktree, runtime,
  process, branch, writer, or artifact-publication residue beyond the intended content-addressed
  artifacts.
