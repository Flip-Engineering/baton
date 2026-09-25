# Phase 67 — progressive, self-describing agent experience

Status: acceptance-red until every numbered contract below is implemented, adversarially tested,
canonically green, and recursively exercised through the ordinary Baton surface.

Phases 64–66 established the Run application, semantic review/integration, resumable follow,
Plan-authorized recovery contracts, and evidence-bound result delivery. They did not yet make the
ordinary control surface cohesive. An agent still has to discover separate status, wait, follow,
evidence, approval, answer, steering, stop, adoption, review, integration, recovery, and export
verbs; understand coordinates such as Plan and evidence digests; and receive a large RunView even
when it only needs an outline.

Phase 67 makes Baton an agent-oriented application rather than a collection of kernel-shaped
features. It introduces one Pythonic semantic model: start or open a Run, inspect it at the depth
needed now, and perform one self-described action offered by the current Run. Baton owns the
multi-command choreography beneath those logical operations. This is a composition layer over the
existing Goal/Plan, coordination, Coordinator, Git, verification, causal-knowledge, capability,
and lifecycle authorities. It is not another ledger and does not weaken any existing invariant.

The complete capability catalog in `docs/26-full-system-goal.md` remains in force. Low-level tools,
raw receipts, and exact emergency controls remain available through an explicitly advanced surface.
No homelab integration or runtime dependency is introduced; the project-manager work remains only
architectural inspiration for Baton's deployment-neutral causal knowledge design.

## AX1 — one semantic registry

Baton owns one immutable, versioned, content-digested semantic registry. It is the sole source for:

- ordinary operation names and closed request/result schemas;
- progressive inspection depths, sections, and stable item identity rules;
- action kinds, input schemas, effect and confirmation metadata, and server-derived fields;
- contextual help topics, examples, errors, and expansion links;
- application-card metadata;
- Direct, CLI, authenticated Web, MCP, and browser projections; and
- the boundary between ordinary and advanced compatibility/debug controls.

The registry describes these ordinary semantic operations:

```text
application.help(topic?, depth?, runId?)
run.start(intent)
run.inspect(runId, depth?, section?, item?, cursor?, waitMs?)
run.act(runId, actionId, inputs?)
run.stop(runId, reason)                  # pinned emergency alias
```

The direct embedding may project them as an ergonomic resource object:

```text
run = baton.runs.start(intent)
run.inspect(...)
run.actions()
run.act(actionId, ...)
run.stop(reason)
```

`run.stop` remains a pinned, immediately discoverable alias because emergency control must not
require an agent to traverse a disclosure cascade. It lowers through the same Run stop authority as
the `stop` action. Existing detailed Run commands remain compatibility aliases implemented from the
same semantic definitions during migration; they are not a second registry.

Registry definitions use closed schemas and declare read/write behavior, idempotency, destructive
and irreversible effects, confirmation, required authorization class, freshness binding,
reconciliation behavior, response depth, and help topic. Unknown fields and unknown action or
section kinds fail before durable admission or provider/filesystem effects.

## AX2 — progressive Run inspection

`run.inspect` replaces ordinary caller choreography across status, wait, follow, and evidence reads.
It supports a contextual cascade whose names describe semantic depth rather than literal document
storage:

1. **outline** — Run phase, short narrative, progress, attention summary, risk, requested/resolved/
   observed route truth, resource health, and recommended actions;
2. **index** — stable available sections with state, short summary, item count, truncation state,
   authorization state, and expansion coordinates;
3. **section** — one bounded domain view such as Plan, execution, attention, route, budget,
   verification, semantic review, result, delivery, cleanup, knowledge, or capability work;
4. **item** — one bounded Plan node, worker, question, finding, artifact, decision, representation,
   or other section-owned object; and
5. **evidence** — explicitly requested manifests, source anchors, receipts, and ledger-derived
   provenance for that section or item.

The default is `outline`. It does not include the full Plan, node list, worker IDs, artifact list,
raw receipts, raw events, evidence manifest, filesystem paths, Git refs, provider sessions, or
unbounded provider prose. It reports counts and expansion links instead.

Every response states its depth, Run, current durable cursor/view digest, registry digest, bounds,
truncation, and legal next expansions. Section and item identifiers are typed, stable within their
authoritative version, and never accepted as arbitrary object/property paths. An index or section
may expose a continuation cursor, but the cursor is bound to repository, Run, registry version,
principal scope, section/item selector, authority digest, and response policy. Reusing it for a
different query refuses.

Wait and follow are inspection modes, not separate conceptual products. A bounded `waitMs` asks for
the next eligible outline/section change. A continuation cursor resumes the same bounded query at
least once. The caller advances only after processing the response. Evidence expansion preserves
the existing fresh-manifest and provenance requirements and never treats display state as evidence.

## AX3 — self-describing contextual help

`application.help` uses the same registry and returns bounded progressive help for the root,
Run lifecycle, inspection depth, section, action, parameter, choice, effect, error, or advanced
boundary. Each ordinary response also carries relevant help links.

Help explains:

- what the current object means and why it matters;
- safe defaults and policy-constrained choices;
- required versus server-derived inputs;
- effects, confirmation, idempotency, freshness, and recovery behavior;
- a minimal example derived from the active deployment card; and
- how to expand or deliberately enter advanced/debug control.

Help is authorization-aware. It reauthorizes the live principal on every request and after any wait.
It may describe public concepts without disclosing whether an unauthorized repository, Run,
principal, route, capability, policy rule, session, credential, path, ref, or hidden advanced tool
exists. Unavailable-action explanations use closed safe reason categories and bounded remediation;
they are not a policy oracle.

CLI root, group, action, parameter, and error help lower to this authority. `baton help ...`,
`baton run --help`, and action-specific `--help` do not return one unrelated static usage block.
The browser renders contextual help from registry metadata. MCP exposes bounded help rather than
requiring the model to infer relationships among many tool descriptions.

## AX4 — Run-bound actions and server-owned cascades

The outline and applicable sections return self-describing action descriptors. Every descriptor
contains:

- a Run- and authority-bound `actionId` plus stable semantic `kind`;
- concise label, purpose, availability reason, priority, and help link;
- a closed input schema, allowed choices, policy-derived safe defaults, and example;
- explicit server-derived coordinates which the caller must not submit;
- read/write, effect class, destructive/irreversible, confirmation, and idempotency metadata;
- freshness and authorization requirements; and
- the expected result depth and durable/reconcilable behavior.

`run.act` accepts only `{runId, actionId, inputs}`. `inputs` is validated against the exact
descriptor's closed schema. The server derives Plan digest, Goal/Plan/node/task lineage, evidence
digest, accepted result, worker target and fence, route policy, profile/policy digest, recovery
target, export identity, and every other authoritative coordinate immediately before effects.
Callers cannot widen an action by supplying those values.

An `actionId` is not a capability token. Before each effect Baton re-resolves the Run, registry,
principal, authorization, stop fence, Plan/result/evidence state, policy, and action availability.
Cross-Run, cross-repository, cross-principal, expired, superseded, stale-view, or changed-policy
action use fails closed and returns or links a fresh outline. Exact retries reconcile through the
underlying durable idempotency authority; changed inputs conflict.

A logical action may lower to several internal operations. Examples include fresh evidence plus
adoption, fresh evidence plus integration, recovery admission plus exact attach, or export admission
plus exact-tree materialization and delivery. The application—not CLI, browser, MCP, or a caller—owns
that cascade. Consequential cascades have durable admission, stable idempotency, step projection,
restart reconciliation, and honest partial/unknown outcomes. They stop before later effects after
revocation or failed revalidation. No adapter may emulate a missing application cascade.

## AX5 — defaults without lost exact control

Deployment policy may choose a default profile, safe route policy, outline depth, and ordinary action
defaults. Every consequential default is visible in the proposed Plan and relevant action/help
metadata. A caller may narrow within policy but cannot widen scope, budget, effects, routes,
credentials, inspection bounds, or evidence access.

Harness, exact model, model effort, and supported service tier remain independent route axes.
An agent may accept policy defaults, select an exact tuple, or request allowed automatic routing.
Requested, resolved, and observed identities remain visible. Exact mismatch fails visibly; no AX
shortcut silently substitutes another model, harness, effort, or older default.

## AX6 — idiomatic thin projections

All ordinary projections share the registry digest and semantic outcomes:

- Direct uses discoverable resource methods and named option objects without treating a cached
  handle as authority.
- CLI defaults to a compact human outline, supports contextual `help`/`--help`, and provides
  ergonomic aliases such as `baton run show`, `baton run do`, and immediate `baton run stop`.
- Authenticated Web transports the same help/start/inspect/act/stop envelopes through existing
  idempotency, reconciliation, authorization, origin, CSRF, expiry, revocation, and audit controls.
- Default MCP exposes the compact Baton application vocabulary rather than one tool per lifecycle
  receipt. Schemas remain closed and discriminated; long operations later map to MCP Tasks without
  changing semantic authority.
- Browser renders outline, index, sections, forms, confirmations, actions, and help from descriptors.
  It contains no action-specific evidence/adoption/integration/recovery/export choreography.

Equivalent semantic calls produce the same registry/view/action/evidence digests across projections.
Presentation may be idiomatic to the transport. Transport identity, quotas, byte bounds, and
authorization remain deployment-owned and are never smuggled into logical inputs.

## AX7 — advanced compatibility without default burden

Coordinator spawn/send/wait/respond/interrupt/result/list/kill/drain, raw events, detailed Run
compatibility commands, and capability-specific tools remain available for emergency diagnosis,
migration, and exact kernel work. They require an explicitly advanced or combined deployment,
separate authorization where appropriate, and prominent provenance/effect labeling.

The default MCP inventory and ordinary browser Run desk exclude worker choreography, raw ledger
reads, fleet drain, deployment shutdown, arbitrary server paths, and advanced capability internals.
Application shutdown remains host-only. Fleet drain is not Run stop. Advanced controls cannot bypass
Goal/Plan, sandbox, budget, trust, evidence, integration/publication, or cleanup authority.

## AX8 — immediate emergency control

Every ordinary surface exposes Run-scoped stop/reap directly from the outline and as a pinned alias.
It remains available even when another section, action cascade, wait, or follow is in progress. The
server derives the exact target set and current fences; callers do not enumerate workers.

Stop authorization, durable admission, terminal monotonicity, two-phase process termination,
worktree/runtime/branch/capacity cleanup, response-loss reconciliation, and unrelated-Run isolation
remain the existing Run stop contract. Consolidation must not add interaction steps or latency to
the emergency path. Host-only application shutdown and advanced fleet drain remain distinct.

## AX9 — adversarial and recursive proof

Acceptance requires executable proof that:

1. one registry definition drives validation, help, cards, action descriptors, and all ordinary
   projection metadata without duplicated action switches;
2. default inspection is a compact outline and every retained fact remains reachable through a
   bounded index, section, item, and evidence cascade;
3. depth, section, item, continuation, and wait requests cannot widen policy or leak sibling Runs,
   raw events, paths, refs, sessions, credentials, or provider prose;
4. help is contextual and useful while refusing cross-principal/resource/policy enumeration;
5. action schemas reject unknown fields, hidden coordinates, parameter smuggling, and action-kind
   substitution before admission;
6. stale, cross-Run, cross-repository, changed-policy, changed-Plan, changed-result, changed-fence,
   stopped, expired, and revoked action use fails closed after live revalidation;
7. exact action retries reconcile and changed-input retries conflict without duplicate provider,
   filesystem, integration, publication, or cleanup effects;
8. adoption, integration, recovery, and export each prove at least one application-owned cascade
   with restart and response-loss coverage rather than adapter-local composition;
9. Direct, CLI, authenticated Web, default MCP, and browser expose the same registry digest and
   semantic outcome while retaining transport-native security and bounds;
10. Run stop is visible in the first outline/default inventory and kills/reaps the exact Run without
    traversing a section or revealing worker coordinates;
11. the default inventory excludes advanced worker/fleet/ledger tools while explicit advanced and
    combined deployments retain them; and
12. canonical validation and recursive Baton-on-Baton proof complete with zero owned process,
    worktree, runtime, branch, capacity, transport, writer, test-root, or export-temp residue.

Recursive proof uses only the ordinary progressive surface to implement a real Baton improvement,
approve its exact Plan, follow it, respond to attention, inspect semantic and lifecycle state,
review, adopt, integrate or export as policy requires, and stop/reap. Evidence expansion is used
only when exact verification or diagnosis earns the additional context. Exact Codex
`gpt-5.6-sol`, project-key GLM, concurrent Groks, literal Grok Build when provider identity permits,
and the other intended harness classes remain separate route-specific live gates; one route never
stands in for another.

No surface is accepted merely because its metadata looks progressive. The decisive product proof is
that an unfamiliar agent can complete the ordinary Run lifecycle without learning task IDs, worker
fences, receipt families, ledger coordinates, protected refs, or the compatibility command graph,
while an expert can still drill to every exact authoritative fact and emergency control.
