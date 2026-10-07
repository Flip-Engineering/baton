# Phase 80 — recursive Candidate revision authority

## Decision

Baton composes feedback recursively by appending one successor Plan version per revision round in
the same Workflow Run. A round consumes one mechanically verified immutable Candidate and one or
more exact feedback packets, requires distinct approval of the new Plan, and launches one fresh
Attempt whose private worktree is based on the Candidate's still-resolving retained Git ref.

This is deliberately not an agent-authored loop, a review worker allowed to edit, a resumed
terminal session, a mutation of the prior Plan, or a shared writable checkout. Every round is an
acyclic append-only authority transition. The first production vertical admits one revision node per
Plan version; later review and synthesis operators compile to the same primitive.

## R80.1 — closed revision envelope

An optional Plan-node `revision` envelope binds the Workflow definition, exact predecessor Plan,
monotonic round, source Candidate and artifacts, retained result ref/tree identity, selected
feedback packets and event sequence, and the authenticated semantic decision. Unknown, missing,
oversized, stale, or secret-shaped fields fail before Plan append.

The envelope is normalized and digested by one shared implementation. The authoritative Brief
receives it as immutable `revisionContext`; worker text cannot choose its Candidate, feedback, base,
route, effort, budget, permission policy, or topology.

## R80.2 — successor Plan and approval

`revise_candidate` is an ordinary advertised `run.act` action. Its public input is bounded reason
text; all execution coordinates are server-derived. The action proposes Plan `vN+1` under the same
Goal and exact Plan `vN` predecessor, then pauses at `awaiting_plan_approval`. No capacity,
worktree, runtime, provider, or adapter effect occurs before the existing distinct approver accepts
that exact Plan digest.

The application reserves deployment-owned Goal headroom for revision rounds. Cross-version budget
admission is conservative: an unavailable or unsettled prior dimension charges the prior authorized
ceiling. Models and ordinary callers never manage numeric round, token, dollar, file, export, or
storage ceilings.

## R80.3 — exact Candidate-base dispatch

Only `Coordinator.spawnPlanRevision()` and
`CoordinationStore.createPlanRevisionTask()` may combine approved Plan authority with
`refines`, relation `revision`, and `worktreeBaseSha`. Generic spawn, review, recovery, follow-up,
and preserved-resume paths remain closed.

Immediately before durable task admission, Baton resolves the exact
`refs/baton/results/<sha>` locator and requires it to equal the full Candidate SHA. The atomic
dispatch/task pair binds the revision envelope digest. The physical worktree manager creates a new
task-owned branch and directory from exactly that SHA and postchecks its base before provider
launch. A missing or substituted ref fails without provider effect and is never replaced by HEAD,
a role branch, an integrated result, or the source worker's checkout.

## R80.4 — replay, recovery, and cleanup

Application projection follows the exact Plan predecessor chain while preserving the initial
Attempts, Candidates, feedback, selections, and stop receipts. The current Plan controls only the
current action/dispatch; historical evidence never disappears when the current Plan has one node.

Restart before proposal has no admitted revision. Restart after proposal waits for approval.
Restart after approval reconciles the exact missing dispatch. Restart after the atomic task pair
re-seeds the same durable worker/task and never creates another provider generation. Ambiguous Git
or external effects poison or require reconciliation.

Member stop binds Plan version, round, node, task, and exact worker before stopping only that
Attempt. Whole-Run stop snapshots every revision descendant and fences new rounds. Completion
requires process, runtime, worktree, interaction, capacity, and authority release; retained
Candidates and feedback survive cleanup.

## R80.5 — recursive progress semantics

A verified revision becomes a new immutable Candidate rather than overwriting its parent. Feedback
against it may propose another successor Plan only while topology, Plan-version, route, provider,
wall-time, and conservative budget authority permit. Repeated identical Candidate/feedback,
verification failure, stale base, no headroom, stop, contradiction, or exhausted policy produces a
typed non-success attention state, never false completion.

## R80.6 — cascading AX and transport parity

`workflow.status()` remains the compact outline. `outline()`, `index()`, `members()`,
`feedback()`, `candidates()`, and contextual `help()` expose increasing depth. A revision action
does not require caller-supplied SHA, ref, Plan, task, worker, worktree, route, effort, budget, or
receipt coordinates.

Direct, CLI, authenticated Web/browser, and MCP surfaces discover and invoke the same semantic
action through `run.act`. Recipient orchestrators receive it only when their attenuated lease grants
the ordinary required application capability.

## R80.7 — deployment-owned multi-round eligibility

The maximum Workflow round is the minimum of a closed deployment-owned Workflow policy, the
approved Goal/Plan policy's structural Plan-version ceiling, and Baton's bounded history
projection—never a model or ordinary caller argument. The complete normalized Workflow policy and
digest are committed into the initial definition and copied transitively into every successor, so
historical Workflows never inherit a changed deployment default. New Workflow Plans divide their
Goal envelope across that bound round authority; every
successor conservatively sums the exact authorized totals of all predecessor Plans before
proposal. A historical Workflow that already consumed its envelope remains valid and observable
but cannot borrow current-policy headroom.

Eligibility is a first-class projection with `state`, typed `reason`, `nextRound`, `maxRounds`, and
cumulative budget disposition. A selected Candidate with exact feedback may append Plan `vN+1`
only when the predecessor chain is complete, its immediate round is `N+1`, its route and role still
match, and every cumulative dimension fits. Exhaustion pauses without Plan/provider effects.

## R80.8 — deterministic loop-stopping evidence

Baton refuses another revision when the newly verified Candidate SHA repeats a selected ancestor,
when the normalized feedback body set repeats an already-consumed revision set, or when a packet
contains an explicit unresolved `contradiction` finding. These are semantic attention states:
`no_verified_progress`, `repeated_feedback`, and `unresolved_contradiction`. The original
Candidates, packets, selections, Plans, and retained refs remain visible. A model cannot override
the stop by changing prose, action IDs, or task coordinates.

## R80.9 — restart and stop across arbitrary admitted rounds

Every successor uses the same proposal → distinct approval → atomic dispatch/task → exact-base
worktree → provider → fresh verification sequence. Restart walks the complete predecessor chain
and reconciles only the current approved undispatched Plan. Selective stop targets the current
round's exact node/task/worker; whole-Run stop fences all later proposals and snapshots every live
descendant while leaving prior immutable Candidate evidence auditable.

## Acceptance tests

1. Exact feedback produces Plan `vN+1` with the same Goal, exact predecessor, immutable revision
   envelope, and zero provider effects before approval.
2. Changed Candidate, feedback, actor scope, predecessor, reason, route, effort, base, retained ref,
   artifact, or envelope digest conflicts before effect; exact replay is idempotent.
3. Generic Plan spawn, review, recovery, follow-up, and preserved-resume APIs cannot manufacture a
   revision task.
4. Approved revision dispatch creates one atomic task, a distinct worker/branch/worktree at the exact
   retained Candidate SHA, and launches the exact Plan harness/model/effort tuple.
5. Missing/moved result refs, stale Plan heads, insufficient cumulative headroom, stop races, and
   partial admission create no unowned provider or writable checkout.
6. A fresh verifier gates the revision, retains a new Candidate, and preserves its complete ancestry
   in Workflow evidence.
7. Restart at every proposal/approval/dispatch/worktree/provider/result boundary converges to at most
   one revision Attempt and one physical writer.
8. Selective stop reaps only the exact active revision; whole-Run stop returns zero ownership while
   all retained Candidate refs and packets remain auditable.
9. A second feedback/revision round appends Plan `vN+2`, increments round and ancestry exactly, or
   pauses with one typed ceiling/contradiction/no-progress reason.
10. Direct, CLI, Web/browser, and MCP action schemas and resulting durable digests are equivalent and
    expose no private execution coordinates.

## Security boundary

Full-permission workers remain the default, and isolated worktrees preserve cooperative ownership
and evidence. They are not hard containment from a hostile same-UID process. Baton still does not
offer concurrent direct multi-writer access to one checkout; that requires an enforced OS boundary
or hub-mediated patch protocol. This phase adds no homelab integration.

## Implementation checkpoint — 2026-07-18

The direct application vertical now appends and restart-replays Plan v3 from an exact selected
revision Candidate. Every Plan has one durable semantic definition binding; the normalized
deployment Workflow policy is captured by value and digest; eligibility derives the next round,
selected Candidate, feedback, and cumulative budget server-side; the store independently rejects
cumulative Plan overspend. Repeated feedback and explicit contradiction pause with typed attention
and no Plan/provider effect. A lost approval response reconciles one exact dispatch, while a
working revision whose physical provider ownership is lost across restart remains explicitly
`manual_intervention_required` with redelivery forbidden rather than being falsified as failed.

The focused Phase 79/80 plus Coordinator slice is green. Remaining hardening is the rest of the
effect-boundary/selective-stop matrix and explicit CLI/Web/browser/MCP recursive parity; the common
Scratch/Bench recursive-context REPL and RLM-style strategy are specified separately rather than
being smuggled into this Candidate-revision state machine.
