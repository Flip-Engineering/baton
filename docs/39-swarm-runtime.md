# Swarm runtime: evolving collaboration

Design direction: 2026-09-12. This document supersedes earlier universal requirements for fixed
worker inputs/outputs, isolated attempts, orchestrator-originated conversations, same-seat cells,
and whole-wave barriers. It changes the intended model; implementation status is recorded below.
Historical contracts remain evidence of their versions, not proof of this design being shipped.

## Purpose

Baton lets agents in different full harnesses work together continuously. Agents and people can
direct, observe, join, reorganize, interrupt, and redirect that work. A swarm may contain loosely
coordinated investigators, closely collaborating implementation groups, persistent reviewers, and
delegated coordinators at the same time. Useful work can be accepted while the swarm continues.

The agent makes judgments. The coordinator reliably carries out authorized actions, delivers
communication, preserves work and history, accounts for resources, and reports what actually
happened. Verification supports those judgments without prescribing the organization of work.

## Independent concepts

- **Agent/session:** a continuing participant in a native harness. A session can contribute to
  several activities and remain available after an assignment or a turn ends.
- **Work:** an evolving intention, investigation, problem, change, or responsibility. Several
  agents may contribute concurrently. Its organization and relevant evidence can change.
- **Group:** participants collaborating for a purpose, possibly across harnesses. Membership,
  delegated coordination, subscriptions, and shared working context can change while work runs.
- **Workspace:** a resource used by participants. Private worktrees, a group-owned workspace,
  scoped shared editing, and mediated patches are different strategies with different guarantees.
- **Observation/contribution:** a message, tentative finding, edit, question, reference, check,
  proposed change, or other useful intermediate information. A contribution need not be final.

Existing Runs, waves, boards, and workflow recipes should express these concepts without forcing
them into one-to-one relationships. A wave is useful as a cohort, launch request, or observation
boundary. It is not the mandatory lifetime or completion boundary of every collaboration.

## Loose and tight orchestration

Tightness belongs to particular relationships and operations. It is not a global binary mode.
Examples include independent scouts exchanging discoveries, a reviewer discussing live edits
with a builder, a group coordinating a shared interface, and competing implementations developed
on separate branches. Participants can move between these arrangements during execution.

Add ordering only for real prerequisites or conflicts. A dependency can mean that a selected
artifact or event is needed; it need not mean that another agent has finished. Informational
relationships deliver updates without blocking execution. A group barrier, atomic admission,
shared failure policy, exclusive writer, or selected quorum is an explicit coordination choice.
Independent activities do not inherit these requirements merely because they share a wave.

Worker/session failure affects its owned activity and actual dependents. Independent peers
continue. A temporary inability to observe a worker is uncertainty, not proof of death. Elapsed
silence may trigger inspection or escalation; it does not authorize stopping active work or
establish that work is successful, complete, or unrecoverable. An explicit stop still closes the
selected authority and accounts for all resources it owns.

## Communication and shared context

Authorized participants can initiate peer conversations, reply independently to group messages,
share partial work, and subscribe to relevant changes. Recipient and group authority comes from
the coordinator's current membership records, not untrusted message payloads. Each message and
delivery has an attributable identity; transport retries must not be confused with new work.

Conversation payloads can be ordinary text. Schemas are useful for machine-executed actions and
structured data, not a prerequisite for every finding or discussion. Shared notes and references
can evolve with attributed versions. A subgroup may receive authority to maintain its shared
context without asking the root orchestrator to relay every update.

Native harness tools, context management, skills, and delegation are part of the participant's
capabilities. Baton must state which it preserves or replaces and observe delegated work to the
extent its lifecycle/accounting claims require. Harness, provider, account, model, effort, and
permissions are separate facts; supported combinations come from the actual selected runtime.

## Delegated organization

Within granted authority, agents may recruit help, create or claim work, change assignments,
delegate coordination, propose new relationships, and revise plans. Several coordinators may own
different concerns. Baton validates consequential actions against that authority without requiring
the future work graph, every role, or every output to be enumerated before exploration begins.

Workflow DSL and Program IR remain useful for repeatable recipes. They are optional ways of
expressing orchestration over the runtime, rather than mandatory representations of every agent
interaction. Existing authorization, revocation, and process ownership remain meaningful when
organization changes.

A seat evolves the work it holds (issue #345). A recruited seat with `contribute` authority may
`swarm.work_updated` the work item an ACTIVE assignment binds it to — status, basis and
objective-as-progress-notes — without `organize`; naming `dependsOn`, or work it does not hold,
refuses `swarm_permission_required {field: 'workId', rule: 'work-holder-or-organize'}` so the
seat learns what to change. `swarm.recruit` takes an optional `workId`: it must name existing work
(`work_not_found` refuses pre-effect and joins nobody), the runtime writes the
`swarm.assignment_updated` row itself once the run admitted the seat, and the brief names the held
item from that assignment ("Your work item is work-N") rather than from prose the recruiter typed.
A holder completing its item with accepted evidence releases dependents' `waitsOn` through the one
existing evidence derivation.

## Claims, preservation, and acceptance

Live collaboration does not require frozen inputs. A participant can use current working state,
tentative observations, selected snapshots, or a combination. When a claim needs reproducibility,
record the relevant observation or revision. A live review can start before implementation ends;
an acceptance review can identify the exact change on which its conclusion depends.

Checks are observations about identified work under identified conditions. "Requested gate" and
"gate passed" are different facts. Execution ending, recoverable work being captured, a change
being accepted, integration succeeding, and resources being closed are also distinct facts. They
must not be collapsed into a success flag inferred from process terminality or report existence.

A turn ending, a session pausing, and a work claim being adjudicated are three different facts.
When a harness declares that its turns are pausable, the coordinator parks the checkpoint and
stops there: it does not prompt the participant on its own behalf, does not arm a timer whose
expiry would stand in for adjudication, and does not treat a resumed turn, an elapsed window,
repeated assertions of completion, or any other count of events as evidence about the work. The
draft claim stays on the checkpoint as its attributed origin, visible to the orchestrator, and an
authorized caller decides it explicitly — running the existing verification, or asking for a real
continuation. Whether a run has a registered driver or not changes nothing about that ownership:
completion authority is never transferred to a timer or to the coordinator's own prompt.

Acceptance conditions may evolve as the task becomes understood; changes retain their authority
and history. An accepted result need not close the whole group or terminate its participants.
Publication serializes only the actual shared revision mutation. Other work remains concurrent.

Preserve the user's branch, index, and unrelated edits. Capture group/worker work under its actual
ownership and retain useful partial results before cleanup. Workspace separation is not proof of
OS containment. The selected strategy determines what is enforced, observed, and replayable.

## Runtime engineering

Durable admission and ordered changes to a contested object may need serialization. Thinking,
reads, unrelated admissions, independent edits, discussion, and review do not require a global
barrier. Resource pressure should be derived from actual provider and host constraints and be
visible to the orchestrator. A worker-concurrency ceiling is either a value the deployment
caller configured or absent — absence is never a number, no built-in default exists, and a
configured ceiling is enforced as a ledgered wait (`task.dispatch_deferred`, surfaced as
`waitingOn.capacity_ceiling`) that resumes when a slot is released rather than silently
skipping the task. A slow provider or expensive projection must not block unrelated
control, observation, or emergency operations.

Recovery should consume lifecycle events and reconstruct current authority without depending on
an operator repeatedly reading status. Member identity, contribution identity, causal links, and
resource ownership must survive reattachment and coordinator changes. Unknown outcomes remain
unknown until observed or resolved; retries must not silently duplicate accepted effects.

## Validation examples

These are behavioral examples, not a required sequence for user work:

- A scout fails while independent builders continue and its findings remain available.
- A reviewer responds to partial implementation and the builder changes direction mid-turn.
- Several agents claim newly discovered work from a shared board and exchange peer messages.
- Multiple recipients reply to a broadcast without overwriting each other's contributions.
- A tightly coordinated subgroup uses an explicit synchronization point while outsiders proceed.
- One useful change is accepted while other agents continue exploring and monitoring.
- A resident restart preserves communication, work identity, and recoverable contributions.
- The same collaboration works across supported native harnesses with their differences visible.

## Implementation status

The September 13 implementation adds a durable living-swarm domain on the existing coordination
log and existing execution authorities. The ordinary SDK, CLI, MCP, and Web command registry now
expose create, list, inspect, watch, update, recruit, guide, capture, check, and participant stop.
Swarms start empty; participants can recruit within delegated grants, join overlapping changing
groups, publish ordinary findings, and evolve work, assignments, and attributed shared context.

Membership is recorded before the first native turn. A swarm participant ending a turn remains
available even on an adapter whose ordinary task protocol claims completion. Guidance selects the
current active/paused delivery behavior inside the worker's serialized delivery slot. Capture pins
an immutable contribution without finishing its author; independent verification can run while
the author continues or after its session closes. A check result and an acceptance review are
separate observations. Organizational close and participant shutdown are separate operations.
Live capture uses a separate Git index and leaves the author's HEAD, branch and staging area
unchanged. A contribution can carry both its original finding and an attached immutable revision.
Routine tool and usage events do not wake swarm watchers into a self-generated feedback loop.
Watch receipts distinguish a matching event from a timeout, even when unrelated traffic advanced
the deployment cursor. Native Codex, Claude and OMP collaboration observations appear under their
parent participant; invocation completion is separate from observed child state and custody.

The application test exercises delegated recruitment through the actual SDK, application,
coordination store, Git worktrees, and mock native adapter. Separate tests exercise contribution
capture, checking, concurrent guidance, permission boundaries, durable replay, and transport
exposure. These prove the implementation seams; they are not a claim of complete native swarm
acceptance. Native worker access is integrated and tested through real child-process clients,
including implementer self-capture during an active turn. An actual GLM 5.3 Flash coordinator
recruited DeepSeek Flash, changed groups/context, received findings, and captured and checked the
builder's revision while preserving its session. Observed harness subagents remain a separate
integration.

Still required for the full design: multi-holder group workspace custody; ongoing native swarm
acceptance across harnesses; richer selected-event subscriptions and delivery; revisable grants;
and removal of remaining mandatory Run goal/plan and budget assumptions. Current group/context
records do not grant shared filesystem custody. Existing wave/recipe workflows remain available.

See [the integration audit](audits/2026-09-13-runtime-policy/integration.md) for defects corrected,
validation, and boundaries still under development.

## Delegated completion and holder release (issue #263, 2026-09-13)

Completion is derived from evidence, never asserted from process state. Every work item in a
`swarm.view` carries `evidence: { contributions, accepted, derivedComplete }` — the contributions
that reference the work via `workId`, the subset carrying an accept review that no later review on
the same contribution revokes, and whether completion derives from them. An organizer may set
`status: completed` only when the derivation already holds, or when the update names its basis
(`basis: { contributionIds: [...] }` citing accepted contributions that reference the work by
`workId` or `refs`); anything else refuses with `swarm_completion_unproven`, naming what is
missing. Every participant also carries its delegation as a unit:
`delegation: { children, work, complete }` — the direct children, the work actively assigned
within the participant's subtree, and whether that delegation is complete: every assigned work
item completed, and every still-active child either done (it holds no active assignment) or
departed (its membership ended). `swarm.view` accepts an optional `participantId` and returns the
same shape scoped to that participant's delegation — its descendants transitively by `parentId`,
the work assigned within, their contributions and reviews, and the attention rows its subtree can
act on; the root sees the same subtree when it names the lead.

A participant whose runtime is dead or exited, or whose membership has ended, otherwise keeps its
active assignments and its group seats indefinitely. The organizer operation `swarm.update` event
`swarm.holder_released` (`{ participantId, reason }`) releases them in one durable batch: the
individual `swarm.assignment_updated` (status released) and `swarm.group_updated` events are what
the coordination log records, so replay stays byte-identical to the hand-written sequence, and
the request itself — reason included — rides the durable operation record. A live active
participant refuses with `swarm_holder_live`: stopping it remains the explicit separate act. The
`assignment_holder_gone` and `delegation_orphaned` attention rows name this release as their next
step.

## Declared coupling and session ownership (issue #263 items 2 and 3, 2026-09-13)

Coupling is something participants and organizers DECLARE and the swarm keeps honest — never
something the runtime imposes. The declared choices are exactly the ones this design names:

- **A dependency between units of work** — declared on the work itself
  (`swarm.update` event `swarm.work_updated`, optional `dependsOn` field):
  `[{ workId: "W1" }]` waits for W1 to hold an accepted contribution; `[{ artifact: "name" }]`
  waits for an accepted contribution that references the artifact. The declared set is replaced
  whole and kept by updates that omit it. The fold refuses unknown target works, a work waiting
  on itself, and rings of waits, naming what is missing.
- **A synchronization point** — declared on a group (`swarm.update` event
  `swarm.coupling_updated`, coupling `synchronization`): members ARRIVE as their own honest
  report (read authority suffices for one's own arrival) and the point is RELEASED explicitly,
  with who released and why recorded. Each arrival is a row — `{participantId, actor, seq, ts}` —
  so "who arrived, and when" is answered by the artifact rather than by a watch log. The view
  shows `arrivals`, `awaiting` (current live members only — a released or dead seat never holds a
  point open), `departed` (the seats from the declared roster that no longer count), and the
  derived `arrived` fact. Re-declaring the point replaces its parameters and CARRIES the arrivals
  forward, naming them in `carriedArrivals`: a barrier is never wiped silently.
- **An exclusive writer over a shared checkout** — declared with coupling `writer`: the record
  names the writer and the checkout that writer is recorded in. A participant's checkout is
  recorded when it is recruited into one (the deliberate `shareWorkspaceWith` adoption at
  membership, and the live attachment observed at binding — the first recruit into a checkout is
  armed by the latter). One writer per checkout: a second claim over the same checkout refuses
  naming the current writer, and a claim over a participant with NO recorded checkout refuses with
  `swarm_writer_workspace_unrecorded` — a claim that names no resource can never enforce
  exclusivity, so it is refused rather than recorded inert. A writer whose runtime dies raises a
  `coupling_writer_gone` attention row naming the release that frees the checkout.
- **A group failure policy** — declared with coupling `failure`, policy `independent`: when a
  member dies or leaves, a `group_member_gone` attention row names the member and the DEPENDENT
  work (works that declared a dependency on the gone member's work); independent peers continue.
  Without a declared policy no such row exists — independent activities inherit nothing by
  sharing a swarm.

These records INFORM rather than fence. Nothing here stops a worker's process: a participant
that proceeds against an unsettled dependency does so visibly (`waitsOn` shows the wait as
unsettled, with the evidence that has not arrived), and that is allowed. Every declaration,
arrival, and release is a durable swarm event, so `swarm.watch` wakes on each of them and a
scoped (`participantId`) view shows the couplings its subtree can act on — writer records follow
the writer's subtree, and a synchronization point or group failure policy is shown to every member
whose group roster intersects the subtree, so a seat listed in `awaiting` can always read the
point it is expected to arrive at.

**Who acted** is a fact of every record, never a caller-named seat. `releasedBy` and `reviewerId`
carry the ACTOR: the participant's own name when a member acts, or the acting principal's label
when an external orchestrator (which has no participant row) acts — so an organizer's release is
never attributed to the seat it released, and an orchestrator's review or release never lands as
null. A caller-named identity that is not the actor refuses.

**Session ownership after a member leaves** is an explicit, visible fact. The
`member_left_session_live` attention row names the responsible party — the recruiter (the
nearest LIVING ancestor by `parentId`), otherwise the swarm's creator — and the operation that
reclaims the session (`swarm.stop`). When the responsible party itself leaves, the row re-points
at the next living ancestor, and finally at the creator. Releasing a departed holder's seats
(`swarm.holder_released`) moves seats, never processes; reclaiming the still-running session is
the explicit stop the row names.

## Budgets are evidence, not stops (issue #258, 2026-09-13)

A budget threshold (`resource.budget_threshold`) is evidence for the orchestrator and the participant: the
deployment's default envelope (`DEFAULT_BUDGET`) only paces notifications at 50 %, 80 % and 100 %, and the
worker keeps running. A hard stop exists only when the deployment owner names one:

```js
openBaton({ repo, advanced: { budgetPolicy: { hardStopAt: 1 } } })   // kill at 100 % of the named budget
```

The same rule governs the stall and loop watchdogs: their default action is `escalate` (a `stall_declared`
attention reason for the orchestrator); `interrupt`/`kill` are explicit `watchdog.stallAction` /
`watchdog.loopAction` choices. No built-in number may stop a productive worker.

## Waking the orchestrator (2026-09-13)

The orchestrator does not watch the swarm; the swarm wakes the orchestrator. `swarm.watch` is the
runtime's own wake: it blocks until an event that concerns the swarm (a participant's turn ends or
pauses, a contribution or review lands, a member dies, the organization changes) and returns the
refreshed view with `watch.event` naming what woke it. `baton swarm watch <id> --follow` turns
that into a feed: one JSON line per wake (`baton.swarm_wake`: the event, the `attention` rows, every
participant's status/state/turn, contribution and work counts) for as long as the swarm is open or
anything in it is alive. A harness session, a person's terminal, or a script reads that feed as its
inbox and answers with `swarm guide`, `swarm capture`, `swarm check` or `swarm stop`; it never
reads state files and never polls. Both directions ride the resident: the swarm must live in the
published resident (`baton serve`), not in a private in-process deployment.

### A stop that cannot converge names its wait (issue #265, 2026-09-14)

`swarm stop`, a Run stop and the deployment drain poll the same convergence predicates until a
deadline. When the deadline wins, the refusal is never bare: the error's `detail.waitingOn` lists,
per target worker, exactly which predicates were still unmet — `disposition` (no stop outcome was
earned), `local_resources:<hold>` for each hold the worker still carries (its process, runtime
scope, checkout, a pending cleanup or spawn, a stop waiter), `process:<state>` for an unclosed
process, `interaction:<id>` for an unanswered approval or question — and the same list is appended
to the worker's durable log as `control.stop_waiting_on`, so the non-convergence is visible in the
evidence, not only to the caller. A drain that fails before it reaches its workers names its reason
instead (`startup_cleanup_pending`, `authority_operations_in_flight`, `pending_interaction_authority`,
`historical_reconciliation_pending`). The CLI prints the detail under the refusal line. The holds
are one derivation shared with the predicate itself, so the list can never disagree with the loop
that produced the refusal.


### A death is typed, resumed and settled (issue #295, 2026-09-14)

A worker's death is never anonymous. Three classes are named at the boundary that received the
provider's answer — the adapter — and everything downstream reads the typed code instead of the
provider's prose:

* `provider_quota_exhausted` — the provider refused for a quota reason. The answer's own reset
  instant is parsed from it when it carries one (`detail.resetAt`, canonical ISO-8601 UTC) and
  never invented. This class is not transient: the same route will refuse again until that instant.
* `provider_socket_closed` — the provider connection dropped mid-turn. Transient by construction:
  the same route may answer again.
* `provider_turn_failed` — the named generic, for a failed turn whose class the boundary could not
  name. A bare `omp_<stopReason>` is never published, and an aborted turn keeps its control code
  (a control act is not a provider fault).

The typed fault rides `lifecycle.turn_completed.failure` and, when the process dies after it, the
death cert (`lifecycle.crashed`). Both are read back downstream by SHAPE only (code + bounded
detail) — the coordinator, the readiness derivation and the run projections never re-read provider
prose (#267) — so a rate-limited member's cert names the class, the exact route and the reset
instant instead of the anonymous dead runtime that `429 Usage limit reached … will reset at …`
used to produce.

**A transient fault re-drives the turn before any kill.** The dropped connection is not the
member's death: the turn is re-driven once, in place, as a NEW turn on the same session and
worktree (`provider.transient_retry {action: 'new_turn_on_same_session', attempt, of}`). The
re-driven turn passes the SAME admission gate as any other new provider turn
(`resource.provider_turn_admitted {phase: 'transient_retry'}` against the member's declared budget
and terminal reserve), so a retry rides the existing turn budget instead of bypassing it — a member
with no headroom left is settled by the ordinary provider-failure path, with the refusal named
(`resource.provider_turn_refused {phase: 'transient_retry', code}`) rather than retried. Only a
fault the retry ALSO hits (or one that is not transient at all) settles the member, and the
`provider.transient_retry` row is written only once the adapter ACCEPTED the re-driven turn — a
prompt the adapter refused releases its admission by name
(`resource.provider_turn_released {code: 'transient_retry_refused'}`) and settles the member
instead of claiming a turn that never started. A quota fault is NEVER re-driven on the same route.

**Every policy kill names the rule it applied.** `kill.requested` carries
`{rule, actor}` — `stop_requested`, `run_stop`, `deployment_drain`, `startup_reconciliation`,
`stall_reap`, `watchdog_action`, `provider_budget_hard_limit`,
`provider_governance_violation`, `provider_fault`, `provider_crash`, `preservation_unproven`,
`stop_deadline`, `interrupt_escalated_to_kill`, `preserved_reattachment_failed`, `worker_policy_mismatch`,
`worktree_authority_lost`, `spawn_refused`, `protocol_violation`, `process_observation_refused`,
`terminal_observation` — and an empty payload is gone: the observed `kill.requested` with an empty
object could not be told from a routine operator stop.

**The death lands as a run-level row.** One `provider_fault_death` attention reason per death
(`run.attention.watch`) names the exact route, the fault class, `resetAt` when the provider named
one, the pinned progress checkpoint (or the retained checkout when preservation failed, with the
reason the checkpoint could not be written), and `next`: `wait_until_reset` (with `notBefore` and,
when one was pinned, `resume_from_checkpoint`), `recover_retained_worktree`, or
`resume_from_checkpoint` on another route. The worker's terminal cause is never null for a typed
death: `run.view` carries `{kind: 'provider_failure', code, detail: {route, resetAt}}`.

**A quota refusal is a fact about the ROUTE.** The one exhausted-route authority the deployment
owns is written by the coordinator — on the failed-turn path and on the crash path alike, so a
quota death blocks its route however the transport died — and read by route readiness: the doctor
row reads `blocked`, `code: provider_quota_exhausted`, `resetAt`, `quotaBlockedSince` (the instant
the block was observed), and a recruit on that route is refused BEFORE any effect (no worktree, no
credential projection, no process) with the reset time in the message. Readiness returns when the
recorded instant passes — derived from the recorded time, with no poll, no timer and no re-probe.

**Killing a parent settles its observed children (issue #265 item 2).** The kill reaps the OMP
process group, and every native child the parent had been observed to run is settled durably
(`native.children_settled {gap: 'parent_stopped_before_child_terminal', processGroupReaped: true}`)
and folded to `unknown` beside that named gap, so no projection counts a child as live after the
session that would have carried its terminal frame is gone — the Run stop converges instead of
waiting on an observation that cannot arrive.

**A deadline ends patience, never the cleanup (issue #265 item 3).** When a stop's deadline wins
and nothing indicates a live process, the ordinary preserve-then-reap path runs
(`control.stop_deadline_cleanup {action: 'reap_after_deadline'}`): the work is checkpointed first,
then the checkout is released, so a forced stop cannot leave a dead member holding
`localAuthority`, its worktree and `cleanupPending` forever. When a process may still be live the
resources are RETAINED — uncertainty is never permission to destroy — and the holds are named
durably (`control.stop_waiting_on`) instead of being abandoned in silence.

## Reading the swarm as slices, and what a refusal owes the caller (issue #283, 2026-09-14)

One swarm record, many readers. `swarm.view` and `swarm.watch` take an optional `projection`, so a
caller reads the slice it needs instead of the whole record; naming none answers with everything,
exactly as before. The vocabulary is closed and declared beside the command that carries it
(`SWARM_VIEW_PROJECTIONS` in `swarm-contract.mjs`), and ONE slicer (`projectSwarmView`) defines what
each name keeps — the CLI, the MCP tool table, the runtime and the bridge all derive from it, so
they cannot disagree about what `participants` means.

| projection | what it answers |
|---|---|
| `full` | the whole record — the default, and what every caller saw before |
| `outline` | the frame alone: what this swarm is and what THIS caller may do, with no rows |
| `participants` | the participant rows: membership, bindings, delegation, runtime, workspace custody |
| `contributions` | the contributions and their reviews |
| `attention` | the attention rows |
| `guidance` | each seat and the guidance rows addressed to it |
| `workspace` | each seat and the live checkout custody it holds |

The **frame** — `swarmId`, purpose, status, `caller`, `availableActions`, `updates`, `actionTargets`,
`cursor`, the `watch` block — rides every projection: knowing what you may do never costs a second
call. The one field that does NOT is `updatePayloads`: the payload SHAPES are discovery data that
never change, and embedding them in every answer was a fixed tax on every view, every wake and every
mutation echo (2026-09-14 audit S-F2). They ride `full`; the `updates` rows ride the frame, and the
bridge's own `swarm.update --help` renders the shapes locally for a call that has no view to read.

**`updates` sits beside `availableActions` as rows** — `[{ event, permission }]` — naming each update
kind this caller may send NOW and the permission that admits it. Both the rows and the dispatch check
derive from the same function over the same table (`_updatePermission`), so a view can no more
overstate an authority than dispatch can overlook one. `swarm.update` is offered exactly when at
least one kind is: a read-only participant sees `[{ event: 'swarm.participant_left', permission:
'read' }]` — the one update it may send, with the permission that admits it — and nothing else.

**A participant-scoped view (`participantId`) is the swarm as that participant sees it.** Its own
brief text (`role`) is carried by its own row and by no other: another seat's row says
`role: null, briefWithheld: true`, because a brief is what a recruiter told ONE seat. Records with
ROSTERS follow the intersection rule (the #292 rule): a group or a declared coupling is in scope
when any member of the roster is in the subtree, and a group with an empty roster is in scope for
nobody. Shared context is swarm-wide by construction and is the participant's own reading; an entry
written for one group follows that group's roster. Attention rows are the ones the subtree can act
on, and an in-flight operation names the COMMAND, the seat and the operation key — never the request
body (2026-09-14 audit S-E6): the text of somebody's private guide is not attention.

**Liveness is one derivation.** `swarmParticipantLiveness` (`swarm-runtime.mjs`) is the only place a
worker status becomes a participant classification: it returns `{ state, live, turn }`, `live` is
membership in the one declared list of live runtime states, and "gone" is its COMPLEMENT rather than
a second list. The participant row carries it (`runtime.state`, `runtime.turn`, `runtime.live`), the
wake feed carries that row, and the bridge carries it verbatim — three surfaces that cannot disagree,
pinned by a test that feeds one runtime record through all three. A seat with no worker at all reads
`unbound` and is absent, not dead: it raises no `participant_runtime_dead` row.

**A finished seat reads `completed`, not dead (#332).** A seat whose worker exited after its
recorded final contribution with a terminal turn — a clean exit, meaning no crash row on the
seat's own ledger and no recorded failure cause — settles to `runtime.state: 'completed'` with
membership still `active`, instead of staying `active` with a dead runtime and raising
`participant_runtime_dead`. A boundary pause with no pending guidance counts as the terminal
turn; a pause with unanswered guidance, a crash, or a failure cause reads as a mid-turn death
and still pages. `participant_runtime_dead` is raised only for a runtime that died without a
terminal row or mid-turn. A completed seat still accepts `swarm.stop` and a `resumeFrom`
recruit, and the wake feed's `dead` class — which matches crash rows only — never wakes on a
completion.

**A participant row carries the route and scope the seat was recruited under** (`route: { harness,
model, effort }`, `scope: [...]`), recorded ONCE with the membership write — the deployment's own
resolution when `prepareRun` makes one, otherwise the selection the caller named. It is projected
from the durable join, so a worker that is rebound, stopped or restarted never moves it, and the
wake that IS a recruitment names the route the seat was started under.

**Refusals are the swarm's record, not the caller's private business.** A refused mutation already
landed durably as `swarm.operation_refused` (#271); the same lane now carries the refusals the
NATIVE BRIDGE raises before dispatch — an over-cap frame, a request the closed argument vocabulary
refuses — reported through the bridge's one channel (`dispatch`, under a verb that
`swarm-contract.mjs` asserts is never a public command, so no caller can fabricate a refusal about a
participant). Every such row names `participant, command, field` and the RULE that refused it, wakes
a parked `swarm.watch`, and shows on the participant's own row:

```json
{ "kind": "swarm.operation_refused", "swarmId": "swarm-…", "command": "swarm.update",
  "event": "swarm.work_updated", "code": "swarm_command_invalid", "field": "payload.bogus",
  "rule": "payload-unknown-field", "participantId": "builder-a" }
```

`lastRefusal: { seq, command, code, field }` stands on the participant's row until **a later
operation of the same command succeeds**, which the operation lane records: a mutation writes its
terminal `swarm.operation_completed` row where the mutation applies, and a READ — which leaves no
trace of its own — writes one only when it actually retires the caller's own refusal. The caller
block answers with that refusal under every projection, so a caller that asks for `outline` still
learns what it must fix. A refusal the RUNTIME raised is recorded once and relayed verbatim; a
refusal the bridge raised says on its FIRST LINE that nothing was recorded and what to change:

```
Nothing was recorded: remove runId
swarm.view request is invalid: unknown field runId
```

**Tool rows carry what was sent and what was said back (issue #299).** Every `content.tool_call`
row a participant's adapter writes now carries its argument and result evidence — the command line
or tool input, and the exit status, byte counts and first lines of the result — as `argsDigest` /
`resultDigest`: bounded, redacted digests derived by the ONE derivation the verification path
already applies to captured output (`verifier-diagnostics.mjs`: the `SECRET_PATTERNS` set and its
byte bound — never a second redaction vocabulary, never a new constant). An adapter whose provider
frame names no arguments, or no result, writes the typed marker instead (`argsUnobserved` /
`resultUnobserved`) — recorded absence, never silence. The raw provider input never reaches the
durable ledger at all: a token-shaped value in a tool argument has no row to hide in.

The rows are visible where the work is. A participant's bridge calls are tool rows like any other —
a `swarm.update` publish that the bridge refused shows up in its own ledger with the redacted
command line and the failed exit — and two projections read the ledger (never a second store):
`run.member.view`'s per-worker activity rows and the swarm participant row carry `lastToolRows`,
the last `view.attention_push.items` tool rows the coordinator's one derivation projects from that
worker's log.

**The bridge's frame bound is negotiated, declared, and never truncated.** One JSON frame per
direction is buffered under the `wire.frame` substrate row from `limits.mjs` (overridable per bridge
with `maxFrameBytes`); `issue()` publishes the bound to the participant's environment and the client
buffers under THAT, so a deployment that raises the ceiling does not get answers its own client
rejects. An answer over the bound is refused typed (`swarm_bridge_frame_exceeded`, 413) with the
narrower projection that MEASURABLY fits: the bridge re-projects the answer it already holds through
the same slicer the runtime builds views with and names the widest one under the ceiling — never a
declared table of sizes, never a truncation, and never a second hardcoded number. Asking again with
the named projection is the fix, and the test does exactly that.

## The brief carries the Baton surface (issue #309, 2026-09-14)

The September 14 incident: seven of seven recruited lanes finished their work and left it
unpublished, because their briefs said "No tools are advertised for this Brief" — the participant
bridge sat in their environment the whole time, and each lane had to be woken by a guide that
named the environment variables and the request shape by hand. The repair is that the brief
itself now carries the surface, so a freshly recruited participant knows how to publish from its
very first turn.

Every swarm recruit's provider-facing brief now renders a `## Swarm` section and a non-empty
`## Tools` section. The section text is derived ONCE — `SWARM_BRIEF_SECTION` in
`swarm-native-access.mjs` joins the extended `SWARM_NATIVE_GUIDANCE` with the bridge's own
`SWARM_BRIDGE_GUIDANCE` (exported from `swarm-native-bridge.mjs`, derived from the same
constants the bridge enforces) — and `renderBrief` (adapter.mjs), the one brief renderer, owns
only the heading, so every dialect reads the same surface. `brief.tools` lists the bridge as one
tool with its verbs, so the Tools section is never the empty advertisement for a recruit. A
non-swarm run's brief is unchanged: no Swarm section, and the empty-tools sentence stays.

The section tells the participant: the verbs it may call (`swarm.view`, `swarm.update` with the
event kinds its permission admits, `swarm.guide` where allowed, `swarm.watch`; capture and check
belong to the root), the environment variable NAMES that locate the bridge (never their values —
the token variable carries a private credential), the request shape with the report's whole body
inside the payload's closed `body` field and the contributionId convention, what the bridge
answers (the refreshed view carrying the recorded event's seq — confirm it before calling the
work published), what a refusal looks like (`Nothing was recorded:` plus what to change), and the
consequence that closes the loop: the root cannot capture or check a participant's work until a
contribution is recorded, so ending a turn without publishing leaves the work unreachable.

Mechanically, the surface rides the participant runtime extension that `SwarmNativeAccess`
registers at credential issue; the coordinator merges it onto the provider-facing brief value at
the serving seam (`_providerBrief`) — the same seam as attention and orientation, so `task.brief`
and its digest stay byte-stable. The guidance is no longer also spliced into the recruit's goal
text: one surface, one derivation, no drift.

## Every mutation answers with a receipt (issues #302, #301, #308, 2026-09-14)

**A mutation is an operation you can account for.** `swarm.create`, `swarm.update` (every kind,
close included), `swarm.recruit`, `swarm.guide`, `swarm.stop`, `swarm.capture` and `swarm.check`
answer with a RECEIPT — `receipt {command, event: {kind, seq, ts, actor}, changed:
[{collection, id, seq, ts}]}` — the recorded event that proves the mutation happened and the rows
it changed, plus `next: {command, args}`, the projection or action that follows (the same `next`
#272 asks for on terminal attention rows). The whole refreshed view rides the answer only when the
caller asks: `view: true` on the command, `--view true` on the CLI. A replayed `_once` command
returns the FIRST attempt's receipt — idempotency holds for the answer, not only the effect.
Because a receipt names what was recorded, an operation that records nothing durable (a stop whose
effect lives on the run lane) answers with the receipt of the operation terminal row that proves it.

**One collection shape on the view.** `participants`, `contributions`, `couplings`, `groups` and
`attention` are ARRAYS of rows — the collections a caller iterates — while the identity-addressed
families (`work`, `assignments`, `reviews`, `context`) stay keyed objects. Every read path (view,
watch frames, the native bridge, the MCP tools) carries those rows through unchanged, and a test
feeds one runtime through all four and asserts the shape.

**Scope overlap is advice, not a fence (#301).** `swarm.recruit` compares the requested scope with
every ACTIVE participant's scope across the repository's swarms and returns `scopeOverlap` rows —
`{participantId, swarmId, paths}` — naming the other seat, where it sits, and the paths both
scopes name. The rows inform the recruiter; nothing refuses.

**Drift is visible before capture (#301).** Every participant row carries
`base {observedHead, target, behind}` derived from the repository at read time: the commit its
checkout shows, the deployment's default branch, and how many target commits the checkout lacks. A
seat with no checkout to observe reads `base: null` — absence, never a guess. `swarm.capture`
records the merge-base of the captured revision with the target on the capture row, and refuses
TYPED (`swarm_capture_base_unreachable`) when the checkpoint's base cannot reach the target — a
revision that shares no ancestor with the target could never integrate, so it is never pinned.

**A stale resident says so on the recruit (#306 part 3).** Beside its `admission` row, the recruit
answer carries `baseBehind {served, branch, target: {ref, commit}, behind}` whenever the resident
serves a commit its target branch has moved past — read from the deployment summary's own
`served` row (docs/43) — and `null` when the resident is current, the target is unknown (a
detached checkout with no remote), or no summary is wired. Advisory, never a refusal: the seat
is admitted regardless; the root chooses whether to reincarnate first instead of discovering a
stale base on the lane's capture.

**A refused recruit leaves no phantom, and a retry resumes (#308).** A recruit whose run admission
refuses rolls its join back with a durable `swarm.participant_left {reason: 'recruit_refused',
code}` — the typed admission code rides the leave. A repeated recruit of the same id RESUMES the
rolled-back join (the join re-activates that one row); any other existing row refuses with
`swarm_participant_exists`, which crosses the CLI as itself with `retryable: false` — the identity
is taken, and retrying cannot change that. A refused operation SETTLES its attention row: the
operation lane's unavailable outcome turns the row into `operation_refused {state: 'refused',
code}` instead of leaving `operation_unconfirmed` forever. And in-flight rows never carry the
request body: `swarm.operation_requested` names the command, the seat and the request DIGEST only,
so the text of somebody's private guide is not ledger content. The WHY of a holder release is
durable on the released assignment rows themselves (`releaseReason`), not on the operation lane.

## A fold rule can never refuse recorded history again (issue #304, 2026-09-14)

The #292 regression class: an admissibility rule that tightens what may be admitted landed
inside `foldSwarmEvent` — which also replays the ledger at startup — and a resident could not
start over its own deployment because its history held a row admitted before the rule existed.
The suite never saw it, because every fixture was written under the new rule. c6253838
reclassified that one rule by hand; #304 makes the class impossible three ways.

**The replay corpus.** Real coordination ledgers — reduced by
`node impl/scripts/ledger-extract.mjs <events.jsonl> <out.jsonl>` to exactly the rows the fold
consumes (`SWARM_EVENT_KINDS` plus the `driver.recorded` swarm-operation records), kept verbatim,
asserted free of token-shaped values, and bounded whole-swarms against the repository's existing
fixture ceiling — are committed under `impl/test/fixtures/ledgers/` with a sidecar digest of the
folded projection. The suite replays every fixture through `foldSwarmEvent` from an empty state
and fails if the projection no longer matches its recorded digest: a rule that refuses or
reshapes recorded history fails on the author's machine, named, before it can land. The extract
folds with replay semantics (no `admission` flag) — a resident must never refuse its own
recorded history.

**The fold-admission gate.** `surface-gate.mjs` audits every `integrity(...)` site inside
`foldSwarmEvent`: each must be a **shape** refusal (the same code is raised by
`validateSwarmEvent`, the lane both admission and replay run, so every ledger row passed it
where it was written), an **admission**-guarded refusal (fires only on the prospective fold
before an append, never on rows read back), or a **pinned** replay invariant — a stateful
referential/CAS check that the admission fold re-derives from the same projection replay
reconstructs, so it can only fire on a ledger no same-vintage store wrote (corruption; the #290
quarantine is that repair). The pins are closed, named, and refused as stale when a code
disappears; a new rule must land its own code and face the decision. Payload-only rules belong
to the shape lane: `work_dependency_self` is raised by `validateSwarmEvent`, not by a fold-only
integrity site.

**The typed startup refusal.** When replay refuses a recorded swarm row, the resident's startup
refusal is a `SwarmReplayRefusal` naming the offending row's **seq, kind, code and message**
(keeping the fold's code so a quarantine entry records the true cause) plus the remedy: quarantine
the seq with the #290 coordination quarantine verb if the row is bad history, or reclassify the
rule admission-only and pin the ledger in the corpus. `baton doctor` runs the same read-only
probe the startup runs and shows that row — and the repair — while the deployment is in the
refused state, instead of a bare `stale` that loops back to a `baton serve` that cannot start.

## The knowledge verbs reach the loop (issue #318, 2026-09-14)

Twenty lanes in one day moved every piece of knowledge through three channels — the objective at
recruit, the contribution body at the end, a guide in between. The knowledge features underneath
were never touched by a lane, never named in a brief, and undispatchable over the participant
bridge. They are now part of the loop a real orchestrator runs.

**The surviving verbs, each with the ONE situation it is for.** The table lives once
(`SWARM_KNOWLEDGE_COMMANDS` in `swarm-contract.mjs`); the swarm view's `updates` rows name every
verb with the permission that admits it, the bridge's `--help` renders the same rows with their
situations, the recruit brief teaches them, and the runtime's dispatch enforces exactly the
permissions the view names — one table, four surfaces that cannot disagree:

| verb | permission | the one situation it is for |
|---|---|---|
| `run.knowledge.seed` | contribute | pin a durable fact — typed, grounded, evidence-linked — that peers must be able to find |
| `run.board.post` / `run.board.read` | contribute / read | keep runnable state on, and read back, the board bound to the participant's OWN run |
| `run.scratchpad.append` / `run.scratchpad.read` | contribute / read | note working state (the shared scope is visible to peers) and read it or the shared scope back |
| `run.scratchpad.elevate` | contribute | elevate one's own scratchpad entries to candidate Findings |
| `evidence.search` | read | find a fact or a contribution by text, participant, kind or path across the deployment |

**Retired from the participant surface, with the reason.** A verb without a participant situation
is not kept alive by an advertisement the loop cannot use:

- `knowledge.promote` and `knowledge.settlement_lease` — the wave settlement pair. The store's
  admission gate (`admitWorkflowFinding`) accepts only `orchestrator`/`operator:<id>` actors and a
  wave-scoped lease, by design (KS3, single-orchestrator settlement posture). A swarm participant
  has no wave and cannot hold the lease; the swarm's durable-knowledge settlement is
  `run.knowledge.seed` plus the review lane. They remain embedded/MCP tools for the orchestrator.
- `scratchpad.settle` — the scratchpad settles when the run's tasks are terminal, which is the
  workflow terminal sweep, never a live participant's act mid-loop.
- `scratchpad.elevate` (the embedded wrapper) — superseded for participants by
  `run.scratchpad.elevate`, whose task identity the runtime binds server-side.
- Context packs (`context.pack_granted`, orientation ratings) — run/attempt grant receipts of the
  wave lane. The swarm's pack is the recruit-time shared context (`basis`) plus
  `swarm.context_updated`, both of which already reach the participant.

**The exchange (deliverable 2).** The chosen mechanism is the knowledge ledger:
participant A calls `run.knowledge.seed` through its bridge; the runtime binds the run (and for the
elevate lane the task) from the seat's own token — a caller-supplied `runId` is refused as
identity-shaped. The fact lands as an attributed `knowledge.node_added` coordination row. Participant
B finds it in its next turn with `evidence.search` — the root copies nothing. The exchange is
visible on `swarm.view` as derived `knowledge` rows attributed to the seeding seat, on the wake
stream as the typed `knowledge` class (derived from the same ledger row like every other class),
and `swarm.watch` wakes on it.

**A successor inherits (deliverable 3).** `swarm.recruit` takes `resumeFrom: <participantId>`.
The runtime refuses an unknown or departed predecessor before any membership is written, and composes
the successor's brief with the predecessor's last checkpoint reference (the newest pinned worktree
checkpoint, else the newest captured revision), its published contracts and its carried-forward
items. The minimal contribution-body fields are `contract` (what a successor keeps true) and
`carriedForward` (the items handed on) — #310's fields, read here until #310 lands its own shape.

**The situation projection (deliverable 4).** Every recruit's brief is composed and written onto
the join as `brief`: the recruiter's objective verbatim, then the swarm situation — the active
peers and their scopes, the contracts published so far, and the commits landed on the target since
the base. The base is the commit recorded at `swarm.create` from the deployment's git authority; the
commits are derived from git at compose time through the same authority — a stored reference, never
a stored count, and an unavailable git says so instead of inventing a line.

**Retrieval (deliverable 5, #312).** `evidence search` is one canonical operation
(`evidence.search`, implemented once in `impl/src/evidence-search.mjs`) every surface derives
from: the `baton evidence search [SWARM_ID] [--query TEXT] [--participant ID] [--kind KIND]
[--path PATH] [--after-seq SEQ]` CLI command, the `baton_evidence_search` MCP tool (and its
`evidence.search` dot-name alias), and the bridge verb. It retrieves across the deployment —
seeded knowledge facts AND recorded contributions — filtered by swarm (absent names the whole
deployment), participant, kind (a knowledge node type, or a `type`/`kind` a contribution body
names), path (case-sensitive, over refs, work and path-like body text) and free text
(case-insensitive, over body text and row identities). The operation rebuilds a per-deployment
index from the coordination ledger on every call, so every row carries its seq/ts and the
cursor IS the ledger seq; the page boundary derives from the same `wire.frame` row the bridge
answers under — never a numeric page cap.

The extended wire shape is wired through the deployment dispatch (issue #338): the canonical
registry row carries all six optional filters with nothing required, the application's own
validator IS the operation's validator (`validateEvidenceSearchArgs` — an unset filter is simply
absent, on every surface), and `BatonApplication#evidenceSearch` serves the operation straight from
the coordination ledger, so the CLI's default deployment-wide form and the MCP tool's optional
`swarmId` are reachable instead of refused by the single-swarm knowledge lane. The MCP tool also
carries its capability classification (`observe`); without it a fully-capable principal was refused
with `forbidden` before dispatch. The participant bridge keeps its membership-bound, single-swarm
lane: a bridge token IS swarm-scoped.

## Parked guidance reaches a one-shot seat on its next exec (issue #337)

A one-shot harness (a `codex exec` / `claude -p` seat) takes no mid-turn delivery: its adapter
card names `prompt` and `steer` unsupported, and every nudge answers with the harness's
unsupported refusal. `swarm.guide` to such a seat used to wrap that `ok:false` in a success
envelope with `guide` null and `changed` [] — the message was silently dropped and nothing ever
reached the seat.

The message now parks durably instead. The guide writes a `swarm.guidance_parked` row naming the
seat, the minted messageId and the `harness_one_shot` reason, and answers `guide {seq, ts,
messageId, delivery: 'parked'}` — a parked receipt, never a success envelope around the refusal.
Whether a seat is one-shot is read from its adapter card's steer/prompt verbs, never from the
harness name; a harness whose card CAN deliver mid-turn keeps the live path whatever the delivery
itself answers.

Parked guidance composes into the seat's next exec / `--resume-from` successor brief, in the
Swarm situation section, attributed to its sender with the parked row's seq, ts and messageId.
The composition marks each composed message delivered (`swarm.guidance_delivered`, plus the
`message.delivered` lane row that wakes `guidance_delivered`), so a later successor never
receives it twice — and the park itself wakes no delivery. Both rows show on the participant
row's `guidance` beside the live nudges, as `{seq, ts, from, messageId, delivery}` with delivery
`parked` or `delivered`.
## A stop settles membership (issue #350, 2026-09-17)

Forty stops on one swarm had written no membership row: every stopped seat still read
`status: active`, so each new brief listed thirty dead peers as "working beside you", the recruit
overlap advisory named twelve stopped seats, and the roster-intersection rules counted them.

`swarm.stop` now writes `swarm.participant_left {reason: 'stopped' | 'completed'}` through the
same fold the recruit-refused rollback (#308) uses — one representation, `leftReason` on the row —
so a stopped seat reads `status: left` on every projection; `completed` is chosen by the ONE
completion derivation (`_seatCompleted`, #332) the view and the stop share. Every predicate that
means "a seat that can still act" — peers in the brief, scope overlap, synchronization arrivals,
`closed_with_live_participants`, holder checks and the completion derivation — reads one helper,
`_canAct` (membership active and runtime not known-dead; `gone` keeps its meaning). The brief's
Swarm situation lists only seats that can act and adds one line counting the seats that completed
or stopped since the base, so a successor knows the history without being told the dead are
working. The stop receipt's event is the `participant_left` row and its `changed` names the
participant; a stopped checkout source refuses `source_left` before its liveness is consulted.
