# Phase 79 — dynamic workflow composition and recursive feedback

## Why this phase exists

Baton can start several independent Runs concurrently, and it can authorize bounded recursive child
Runs, but it does not yet model one durable team workflow. `startMany()` is useful admission and
cleanup sugar; it does not say that several attempts address one WorkItem, bind review feedback to
an immutable candidate, synthesize several results, revise after findings, or recover a partially
completed composition without replaying external effects.

The missing abstraction is a **Workflow** compiled into the ordinary Goal/Plan/Run application.
It provides named parallel, review, revision, synthesis, and gate operators while keeping the
orchestrator in charge of exact harness, model, and effort selection. Workers never manufacture
their own fleet authority, hidden peer chat, topology, routes, budgets, or shared Git ownership.

This phase deliberately rejects the naive interpretation of "shared sandbox." Multiple
full-permission same-UID processes writing one POSIX checkout would destroy authorship, preimage
truth, replay, verification, and exact cleanup. Baton instead shares logical context and immutable
snapshots, keeps private overlays for parallel writers, and permits a shared writable lineage only
through one generation-fenced writer lease at a time.

## Product model

- A **Workflow** is one durable orchestration under one root Run and approved Plan envelope.
- A **WorkItem** is a logical objective and definition of done. Several workers may produce
  independent **Attempts** for the same WorkItem without sharing task identity or mutable state.
- A **Wave** is a set of ready attempts admitted concurrently from one pinned workflow prefix.
- A **Candidate** is an immutable captured result that passed its configured mechanical gate.
- A **Feedback packet** is immutable, source-anchored review or critique evidence directed at a
  WorkItem, Attempt, or Candidate. It is not free worker-to-worker chat.
- A **Revision** is a new attempt derived from a Candidate plus one or more exact feedback packets.
- A **Synthesis** is an untrusted worker attempt that consumes selected immutable candidates and
  feedback and produces one new candidate. Its output receives the ordinary fresh trust gate.
- A **Gate** is hub-owned verification, review, approval, selection, or integration authority. A
  model vote or self-report is never a gate by itself.

## Composition operators

The ordinary surface exposes a small closed grammar rather than making callers hand-author a task
DAG:

1. `parallel` — create attributable attempts for one WorkItem or a shared set of independent
   WorkItems;
2. `partition` — derive non-overlapping scoped WorkItems from an approved decomposition;
3. `review` — inspect exact immutable candidate(s) and emit structured findings;
4. `revise` — create a refinement from exact candidate and feedback identities;
5. `synthesize` — combine selected candidates/evidence in a fresh private worktree;
6. `gate` — run deterministic verification, independent review, approval, or candidate selection;
7. `repeat` — compile an append-only successor Plan version for the next review/revision round only
   while its server-owned stop condition and topology authority permit it. The durable graph stays
   acyclic; feedback never creates a literal mutable cycle in an earlier Plan.

Named strategies such as `parallel_attempts`, `review_revise`, `debate_synthesize`, and
`partition_review_integrate` compile to that grammar. Strategies are application conveniences, not
new coordinator state machines. Advanced inspection can show the compiled graph, but ordinary
callers choose intent, team roles, routes, and semantic strategy rather than task IDs, dependency
coordinates, loop counts, byte ceilings, or storage roots.

The canonical compilations are closed and versioned:

- `parallel_attempts`: one shared WorkItem, one isolated Attempt per role in Wave 1, an
  `all_terminal` collection barrier, deterministic gates per Candidate, then `operator_selected`
  unless deployment policy declares an evidence-based selector;
- `review_revise`: builder Attempt, mechanical gate, independent critic Attempt over the immutable
  Candidate, `all_verified`, typed feedback, then either an approved Candidate or an append-only
  revision successor admitted by the feedback envelope;
- `debate_synthesize`: parallel isolated positions, `all_terminal`, cross-review packets, then one
  fresh synthesizer Attempt and mechanical/independent gates;
- `partition_review_integrate`: collision-checked partition Attempts, `all_verified`, independent
  reviews, then hub-owned composed-overlay synthesis and fresh gates.

Every Wave pins one join: `all_terminal`, `all_verified`, `first_verified`, or
`operator_selected`. A join records whether failures are collected, whether a failed member blocks
the successor, and whether non-selected live members continue or are stopped and reaped. Reaching a
join never silently treats failure as success or abandons a live loser.

Illustrative direct API:

```js
const workflow = await baton.workflow(
  'Implement and adversarially review the requested repository change.',
  {
    strategy: 'review_revise',
    team: [
      { role: 'builder', exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' } },
      { role: 'critic', exact: { harness: 'claude-code', model: 'claude-opus-4-6', effort: 'max' } },
    ],
  },
);

await workflow.approve();
const paused = await workflow.complete();
await workflow.apply();
```

The same handle progressively exposes `outline()`, `status()`, `changes()`, `members()`,
`feedback()`, `candidates()`, `stop()`, and advanced `inspect()` branches. Apply remains an explicit
caller-repository mutation boundary.

## Workspace modes

### 1. Isolated attempts — default

Every writer receives a private worktree from the same pinned base or selected predecessor
Candidate. Workers share only read-only repository history, toolchain projection, Atlas indexes,
artifacts, workflow state, Scratch facts, and causal knowledge. This is the default for parallel
attempts, partitioned work, debate, review, and synthesis inputs.

### 2. Shared immutable snapshot

Several workers may inspect one exact tree/result/representation identity concurrently. Baton's
control plane issues read-only coordinates or a private checkout of that snapshot and rejects
writer-role commands for the shared snapshot. Any authorized edit creates a new private Attempt.
Facts and Bench observations are scoped to the exact environment/tree
identity so evidence from one diverged overlay is never presented as truth about another.

### 3. Leased single-writer lineage

One logical workspace lineage can pass between workers, but Baton's control plane grants write
authority to at most one live provider generation. Handoff requires a captured checkpoint, terminal/confirmed stop,
process close, runtime/worktree release or fenced transfer, durable lease completion, and a new
generation. Parallel reviewer roles receive snapshot authority and never receive an active-lineage
write command. Stale generations cannot use Baton to prompt, edit, checkpoint, integrate, or release
the current lease. Same-UID full-permission processes can still violate these cooperative boundaries;
post-run mutation detection and WF14 remain mandatory until OS isolation exists.

### 4. Composed overlays

Parallel attempts remain private. A hub-owned composition lane serially stages selected deltas into
a fresh integration candidate using preimage identities, path-scope authority, structured conflict
classification, and fresh verification. Conflict resolution may invoke a synthesizer in another
private worktree, but no model writes the caller checkout or a peer's live worktree. The composed
candidate is still untrusted until the normal gates pass.

### Explicitly unsupported: concurrent direct multi-writer

Baton does not launch two live full-access workers with write authority to the same physical
checkout. Advisory Scratch claims do not make that safe. A future multi-writer mode requires an
enforced OS write boundary or hub-mediated patch protocol, per-edit attribution and preimages,
transactional conflict handling, replayable ordering, and exact writer fencing. CRDT convergence
alone is insufficient for code semantics or verification.

## Contracts

### WF1 — closed deployment workflow policy

Workflow authority is installed by one closed, versioned deployment policy that names supported
operators, strategies, workspace modes, role classes, topology and feedback ceilings, selection
rules, recovery behavior, and which effects require renewed approval. Safe ceilings are deployment
authority derived from existing task, Run-lineage, provider, capacity, and wall-time policy. They
are never routine model arguments.

Historical Workflows retain their exact normalized policy body and digest. Startup does not apply a
new strategy, route catalog, feedback rule, or workspace mode to an older Workflow.

### WF2 — Goal/Plan compilation precedes effects

`workflow.start` records a normalized intent and proposes one Plan containing the workflow graph or
an approved dynamic-expansion envelope before capacity, worktree, runtime, provider, or adapter
effects. The preview shows roles, operator stages, exact requested routes, scopes, effects,
verification, review independence, workspace mode, and stop/recovery posture.

Approval binds the exact Plan digest. Dynamic nodes may be derived without a new human round only
when their operator, role, relation, route policy, scope, effects, predecessor kinds, and stop
condition are already inside that envelope. Anything wider produces an amended Plan and explicit
attention.

A recipient orchestrator may propose a structured decomposition, route recommendation, feedback
edge, or next Wave. The proposal is untrusted data. The hub validates it against the approved
envelope, resolves exact routes, and is the only authority that appends or dispatches topology.
Workers never manufacture authoritative nodes merely by emitting prose or structured output.

### WF3 — exact role routing is orchestrator authority

Every executable role resolves one exact harness/model/effort tuple before dispatch. Effort is
chosen contextually for that role and never silently collapsed to `low`. Adaptive routing may
recommend a tuple, but the approved Plan records the exact selection and ordinary route truth keeps
requested, resolved, and provider-observed identity separate.

Workers cannot select their successor's harness, model, effort, permission policy, credential,
budget, or service tier through prose or feedback. Recursive orchestrator recipients retain only
their currently attenuated application capabilities.

### WF4 — one WorkItem, attributable Attempts

Parallel agents addressing the same logical task create distinct task, worker, process, worktree,
route, result, verification, and cleanup identities under one WorkItem. A WorkItem owns the shared
objective and DoD; no two Attempts claim the same physical task identity or generation.

Wave admission is prospective and all-or-clean: either every requested Attempt is durably admitted
under capacity/topology authority or every admitted sibling is stopped and reaped before the caller
receives failure. Path-scope collisions are visible and either refused, converted to independent
attempts, or routed through composed-overlay synthesis; they are never silently treated as
non-overlapping partition work.

### WF5 — feedback is typed, immutable, and source-bound

A feedback packet binds source kind (`attempt`, `authenticated_user`, `orchestrator`, or
`deterministic_gate`), source principal/action when applicable, source role/Attempt/Candidate,
target WorkItem or Candidate, target tree and
changed paths, structured findings, exact source anchors, artifact/representation evidence,
grounding, author route, and workflow prefix. The store appends it before delivery. Text may be a
bounded explanation inside the packet; there is no invisible peer mailbox or ambient chat channel.

Revision prompts receive only selected current packets plus server-derived target coordinates. A
stale packet, superseded candidate, wrong tree, cross-Workflow target, missing source evidence, or
changed review receipt cannot authorize a revision. Contradictory packets remain visible and route
to an explicit review/synthesis decision rather than last-writer-wins truth.

### WF6 — recursive feedback has bounded progress semantics

Review/revision repetition is a durable state machine, not an agent-authored while-loop. A round
records its input Candidate, packet set, revision Attempt, output Candidate, verification outcome,
and measured delta. It stops on approved review, terminal verification failure, explicit operator
attention, policy exhaustion, repeated identical findings/candidate, no verified progress, or
stop/cancel authority.

Each admitted round belongs to a new append-only successor Plan version derived from the exact
prior Plan and feedback decision. An earlier Plan is never edited in place. The application derives
the remaining rounds and provider headroom. Models do not manage numeric
loop, token, export, or file-size knobs. A stopped or exhausted loop preserves every accepted
Candidate and packet and advertises a typed next action; it never claims completion by reaching a
limit.

### WF7 — shared context is addressed and snapshot-relative

Workers receive a compact addressed context: WorkItem, role, predecessors, exact Candidate and
feedback identities, relevant current Scratch facts/claims, selected Atlas representations, and
DoD. They do not receive an unbounded shared-brain dump. Every shared fact or computation result
identifies the tree/environment on which it was observed; cross-tree evidence is labeled as such.

The append-only coordination ledger remains truth. Scratch and workflow boards are typed
materialized projections; claims/CAS are the only serialized cooperative cells. The causal graph is
a read/explanation projection and grants no dispatch, write, review, integration, or stop authority.

### WF8 — synthesis and selection remain untrusted

Every Candidate passes the pinned mechanical gate in a fresh sandbox. Independent review policy is
route-family aware. A synthesizer receives immutable candidate refs and feedback, writes only its
private worktree, and produces a new Candidate. Majority vote, model confidence, prose consensus,
or graph connectivity cannot accept or integrate a result.

Selection records the compared Candidates, deterministic gates, independent findings, policy, and
reason. When evidence cannot distinguish candidates, the result is `unresolved` and operator
attention is advertised. No arbitrary tie breaker becomes correctness authority.

### WF9 — lifecycle, selective stop, and exact reap

Workflow ownership is hierarchical: root Run, Workflow, WorkItems, Waves, Attempts, workers,
process generations, worktrees, runtimes, checkpoints, review/synthesis tasks, and export leases.
`workflow.stop()` snapshots the exact descendant union at one durable prefix, fences new expansion,
and returns stopped only after every snapped process is confirmed closed and every owned resource is
settled. `workflow.stop({ role })` or member-handle stop derives the exact selected subtree and does
not stop completed or unrelated siblings unless they are in that snapshot.

Partial admission, failed feedback delivery, synthesis failure, caller disconnect, application
restart, and deployment close all retain exact ownership. Close joins concurrent callers, reaps the
complete union, and reports zero remaining workers. Provider success is never inferred from
lifecycle success.

### WF10 — replay and recovery are workflow authority

Replay reconstructs the definition, Plan/envelope, operator graph, dynamic expansions, WorkItems,
Waves, Attempts, feedback rounds, Candidates, selections, workspace leases/generations, lineage,
and stop receipts. Idempotent retry returns the original identity. Changed meaning, actor, route,
target, prefix, candidate, feedback, or workspace generation conflicts before effects.

Recovery resumes only unfinished authorized nodes. It never repeats a completed provider effect,
delivers one packet twice, starts a second writer generation, or silently re-runs a synthesis that
may already have crossed its Git boundary. Ambiguous external or Git effects poison or require
explicit reconciliation.

### WF11 — one cascading agent experience

The ordinary `workflow.status()` response is the outline: objective, strategy, current stage,
aggregate progress, attention, selected Candidate, cleanup, and recommended next action. It returns compact
per-role/per-WorkItem counts and rows; `workflow.changes()` streams meaningful changes;
`workflow.complete()` drives only safe recommended actions and pauses on attention, feedback choice,
candidate choice, destructive apply, or unresolved evidence.

`workflow.inspect({ depth: 'index' })` expands to `plan`, `members`, `work`, `feedback`, `candidates`, `route`, `verification`,
`knowledge`, and `cleanup`; sections expand to items and exact evidence. High-level methods derive
task, worker, process, result SHA, evidence digest, packet, lease, generation, and stop coordinates
server-side. Every surface has contextual help. `workflow.help()` describes the current stage,
advertised actions, and valid next depth. Collection accessors such as `members()` and `feedback()`
return bound read handles; mutations use explicit verbs such as `sendFeedback()`. Raw
graph/task/receipt methods remain advanced compatibility and diagnostics, not routine choreography.

### WF12 — shared causal knowledge without shared mutable authority

The deterministic projection adds typed Workflow, WorkItem, Attempt, Feedback, Candidate, Review,
Revision, Synthesis, Selection, and Gate nodes/edges tied to exact durable events and artifacts.
Verified findings and decisions may enter Cairn only through its existing audit-gated promotion
policy. Model messages, unverified candidates, and transient Scratch facts do not auto-promote.

Atlas representations are referenced by content identity and tree/environment scope rather than
copied into prompts or graph rows. The graph explains why a candidate was selected or revised; it
does not authorize the selection or revision.

### WF13 — direct, Web, browser, CLI, and MCP parity

All northbound surfaces invoke the same application registry and workflow authority. Authenticated
Web/MCP contexts derive repository, principal, session, capabilities, and any recursive recipient
lease privately. Ordinary workflow command inputs contain no task/worker/process/worktree path,
result SHA, evidence digest, feedback ID, topology coordinate, lease/fence, budget, byte ceiling, or
credential. Advanced item/evidence projections expose exact safe identities and digests required for
audit, but never private host paths or credentials.

Remote disconnect never cancels a Workflow implicitly. Reconnect resumes from a bounded cursor.
Transport replay reauthorizes before every projection or effect and preserves typed refusals.

### WF14 — security boundary remains honest

Full-permission harnesses remain the default policy, but a private runtime and Git worktree are not
hard same-UID containment. Workflow isolation prevents cooperative edit collisions and preserves
trust-gate attribution; it does not stop a hostile full-access process from reaching another
same-UID path. True hostile multi-writer or credential secrecy requires a distinct UID,
container/VM, OS sandbox, isolated volume, or external broker.

No homelab or external project-manager runtime is added. The workflow, board, and causal graph are
deployment-neutral Baton systems.

## Acceptance criteria

1. One objective and named strategy compile to one previewable approved workflow Plan before any
   worker effect; a caller can complete the ordinary flow without task or evidence coordinates.
2. Two or more exact routes start concurrently as distinct Attempts for one WorkItem, preserve
   requested/resolved/observed harness/model/effort truth, and share no writable worktree.
3. A structured feedback packet is appended before a revision starts and binds the exact source
   Candidate, target tree, findings, anchors, and evidence. Stale/cross-Workflow substitution fails.
4. A review/revision loop stops on verified approval or one typed non-success condition and cannot
   exceed its deployment-owned topology/provider authority.
5. Synthesis consumes only selected immutable inputs, produces a new Candidate in a private
   worktree, and passes fresh verification plus configured independent review before selection.
6. `workflow.status()` distinguishes active, waiting, verified, failed, stopped, unresolved, and
   cleanup-incomplete members without ledger/receipt inspection. The group change stream emits
   useful progress while one sibling is complete and another remains active.
7. Selectively stopping one active member reaps only its exact process/resource ownership; siblings
   continue. Whole-workflow stop fences expansion and returns zero snapped processes/resources.
8. Partial parallel admission cleans every admitted sibling before rejecting. Restart reconstructs
   the same membership and never double-dispatches a completed or ambiguous node.
9. Leased-lineage handoff permits exactly one writer generation, requires confirmed prior stop and
   checkpoint identity, and refuses stale prompts/edits/releases before effect.
10. Composed overlays preserve input preimages and caller state, serialize selected deltas into a
    fresh candidate, classify conflicts, and poison any ambiguous post-Git effect.
11. No supported mode gives two live full-access workers direct write authority to one physical
    checkout. Tests attempting it fail before the second provider process starts.
12. Workflow/feedback/Candidate causal projections replay byte-identically, reference exact
    artifacts, and grant no command authority or automatic knowledge promotion.
13. Direct, CLI, authenticated Web, browser, and MCP produce equivalent workflow/action/status and
    receipt digests for equivalent calls.
14. Recursive Baton-on-Baton dogfood exercises parallel roles, at least one feedback/revision edge,
    exact route/effort selection, selective stop, restart/recovery, explicit apply or honest dirty
    refusal, and zero final ownership.

## Red-test plan

- Compile every named strategy and reject unknown operators, roles, edges, workspace modes, caller
  ceilings, caller coordinates, and effects outside the approved envelope before append/effect.
- Admit N parallel Attempts at the exact boundary; fail N+1; inject failure after each admission
  step and prove all-or-clean cleanup plus stable idempotent retry.
- Use the same model family for a required independent critic and require refusal before review
  spawn. Preserve exact role-specific effort; prove there is no implicit `low` fallback.
- Substitute every feedback field, source anchor, tree, Candidate, receipt, prefix, target, and
  principal; require a typed pre-effect refusal. Deliver/replay concurrently and prove once-only
  revision admission.
- Produce repeated identical findings, identical Candidate SHA, no verified delta, verification
  failure, unresolved contradiction, stop, and policy exhaustion; assert the exact loop terminal
  state and no false completion.
- Attempt same-path partition claims and overlapping globs. Require explicit collision handling;
  never silently launch them as clean partition work.
- Try to start a second leased-lineage writer before confirmed close, after kill request but before
  reap, with a stale generation, after checkpoint substitution, and after restart. Every attempt
  must fail before provider/worktree write authority.
- Inject conflict, dirty caller, main advance, index drift, write failure, and post-effect failure
  into composed-overlay integration. Prove clean refusal or truthful poisoned incomplete state,
  exact preservation, and no ordinary-success receipt.
- Stop one role while another is active and one is already verified; assert exact survivor and
  pinned-result behavior. Lose the stop response after admission and after reap; replay the same
  receipt without another unrelated kill.
- Restart at every workflow event boundary. Compare definitions, topology, rounds, candidates,
  packets, leases, actions, status summaries, and cleanup byte-for-byte; tampering fails integrity.
- Exercise the full outline → index → section → item → evidence cascade and every bound high-level
  method without caller-supplied IDs/digests/leases/budgets. Cached handles must fail stale rather
  than retargeting.

## Implementation sequence

1. **Phase 79A — group AX:** add compact concurrent `status()`/`complete()` and selective member
   operations to the existing bound Run group; retain its honest identity as a client-side group.
2. **Phase 79B — durable Workflow authority:** normalize policies/definitions, compile and approve
   workflow Plans, persist WorkItems/Attempts/Waves, and project replay-safe outline/status without
   provider effects.
3. **Phase 79C — parallel and feedback engine:** dispatch isolated attempts, structured review,
   revision, synthesis, deterministic gates, dynamic expansion, selective stop, and recovery.
4. **Phase 79D — workspace composition:** ship leased single-writer lineage and hub-owned composed
   overlays. Keep direct concurrent multi-writer unsupported.
5. **Phase 79E — knowledge and transport parity:** causal projection, progressive chapters, direct
   client, CLI, authenticated Web/browser, and MCP parity plus recursive live evidence.

Each slice follows current-state audit → numbered contract → red tests → implementation →
adversarial review → focused/full validation → recursive Baton dogfood. A later label never removes
any contract from the full-system goal.

## Implementation checkpoint — 2026-07-18

Phase 79A, 79B, and the bounded parallel/feedback portion of 79C are green: one approved Workflow
Plan atomically admits a role-attributed Wave over one WorkItem; exact-route isolated Attempts
produce freshly verified immutable Candidates; typed feedback, explicit selection, aggregate
evidence, compact progress, selective member stop, whole-Workflow stop, replay, and exact reap are
implemented. Batch preflight and partial-failure cleanup join every affected Run and report exact
cleanup-incomplete identities rather than hiding ownership.

Phase 80 supplies the first executable recursive primitive: selected Candidate plus anchored
feedback appends one separately approved successor Plan and dispatches one new Attempt from the
exact retained Candidate SHA. This remains a bounded Plan-v2 vertical. First-class review,
partition, synthesis, `debate_synthesize`, `partition_review_integrate`, leased single-writer
lineage, composed overlays, Workflow causal projection, policy-admitted Plan v3, and
acceptance-level direct/CLI/Web/browser/MCP recursive parity remain pending.
