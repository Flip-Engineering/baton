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
refreshed view with `watch.event` naming what woke it. The bounded form
(`--timeout-ms`, with or without `--wake-class`) answers the wake FRAME first —
`watch {reason: event|timeout, matchedSeq, event, events, pendingSince}` (#433: `events` carries EVERY admitted wake row since `afterSeq` up to the frame bound, `pendingSince` the first uncarried seq, `matchedSeq` the last carried one) — over the `outline` projection by default;
rows ride the answer only when the caller names a wider `--projection` (#356), and a stream that
ends says why (`baton.wake_stream_ended.reason`, a closed set). `baton swarm watch <id> --follow` turns
that into a feed: one JSON line per wake (`baton.swarm_wake`: the event, the `attention` rows, every
participant's status/state/turn, contribution and work counts) for as long as the swarm is open or
anything in it is alive. A harness session, a person's terminal, or a script reads that feed as its
inbox and answers with `swarm guide`, `swarm capture`, `swarm check` or `swarm stop`; it never
reads state files and never polls. Both directions ride the resident: the swarm must live in the
published resident (`baton serve`), not in a private in-process deployment.

**The deployment-scope pull is a CLI verb (#507, 2026-09-19).** `baton deployment
wakes-since [--since SEQ] [--wake-class CLASS,...] [--swarm SWARM_ID,...]
[--participant PARTICIPANT_ID,...]` answers ONE bounded page of the deployment wake stream as
JSON, without holding an attachment; it is the pull form the MCP `baton_wakes_since` tool reads,
reached from the operator's shell. The page is `baton.wake_page` — the same `cursor`, `swarms`,
`frames` and typed `lagged` marker an attachment delivers — and its `cursor` rides again as
`continuationCursor`: a caller resumes by passing that value back as `--since`, with no gap and
no duplicate. The page is bounded by the stream's replay limit (`view.wake_replay.items` rows),
and a page that outran it carries the typed `lagged` marker. `--after SEQ` is a working spelling
of the `--since` axis, `--kinds`/`--swarms`/`--participants` are working spellings of the other
three. `baton deployment watch` without `--follow` refuses `cli_command_unavailable` and names
this verb.

**Incarnation changes wake too (#306, 2026-09-18).** `incarnation_changed` is a deployment-scope wake class keyed on `host.reincarnated {from: {incarnation, commit}, to: {incarnation, commit}, predecessorExited}`; it is not terminal — the watcher's act is to re-read the view, because the rows and the attachment it held came from the predecessor incarnation. The handoff's own rows (`host.reincarnation_requested`, `host.successor_started`, `host.successor_published`, `host.publication_withdrawn`, `host.reincarnation_failed`) are durable and readable on the deployment ledger like the #351 stop rows.

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
brief text is carried by its own row and by no other: another seat's row says
`briefWithheld: true` and carries the brief's REACH — `brief: {bytes, seq, exposure}`, the
composed text's length, the ledger row that holds it and the docs/46 §4 relationship class that
decided what this caller may see (#464 third half: every ROSTER row, paged or whole, carries the
reach; only the participantId-scoped read carries the text) — because a brief is what a
recruiter told ONE seat. Records with
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
wake that IS a recruitment names the route the seat was started under. The row is BUDGETED (#464):
`role` is the objective's first line bounded by the `view.role.head` registry row, with
`roleBytes` (the full length) and `roleRef {kind: 'swarm.participant_joined', seq}` (the ledger
row that holds the whole text); `workspace.commits` is the NEWEST-bound tail under
`view.workspace.commits` with `commitsTotal` beside it, and a participantId-scoped read carries the
list whole while a bridge PAGE drops the array and keeps the count. A 36-seat roster answers its
participants projection in one `wire.frame`. The row also carries `activity {lastEventKind,
lastEventAt, turnsCompleted, contributions}` and `usage {tokens, providerCalls}` (#268, docs/46
§1.2), folded ONCE per view by `_seatActivity` over the ledger the view already holds — a row is
attributed to a seat when it names the seat, its run, a binding worker or one of their tasks, the
same rule the wake stream's attribution uses; `usage` answers the string `'unavailable'` per
field when the adapter reported nothing, never a zero pretending to be a measurement; and
`run.peers.read` and the recruit brief's peers-now rows carry the same frozen objects.

**A recruit's own preconditions refuse typed — never as "application precondition failed" (#474).**
`swarm.recruit` takes a whole Run selection, and the deployment's own preflight (`prepareRun` →
`prepareRunStart`) refuses a bad scope, route or option with a bare coded `application_client_invalid`
error carrying no `detail`; the web layer's generic `application_*` branch crosses exactly that shape
as the fixed text `application precondition failed` (HTTP 400), so a caller could not tell an empty
`scope` from a bad `resultIntent` and learned no field, no rule and no remedy. The runtime therefore
judges the selection it owns BEFORE the deployment sees it, in the swarm family's vocabulary:
`swarm_command_invalid` with `{field, rule, expectation|admitted, correction}`, the message carrying
the remedy beside the rule (the #431 shape), recorded on the usual `swarm.operation_refused` lane with
its field and rule. The preconditions are: an unknown `options` key; a blank `profile`, `model`,
`harness`, `effort`, `driverKind`, `waveId` or `waveRole`; a malformed `waveStart`; an `exact` object
outside the three route axes; an `exact` route named beside a loose harness/model/effort selector (two
disagreeing spellings of one choice); a manual route missing `model` or `effort`; a `resultIntent`
outside the closed set; and the scope rule below. The deployment keeps the facts only it holds (its
profile's path scope, its served route table, its defaults): a refusal it mints without teaching gets
the teaching record attached at the boundary (`withRecruitPreflightTeaching`, the mint's own code and
message preserved verbatim), so **no recruit refusal reaches a caller as the generic text** — a
taught refusal (the #335 route table) crosses untouched.

**The comparison's resolution is handed on as ONE exact selection.** When `_routeSelection` resolves
a prefix (`{harness: 'codex'}`, `{model: 'gpt-5.6'}`) it replaces the selector axes it consumed with
the `exact` route it chose — a deployment's option set is closed, and `exact` beside the loose
selector is precisely the pair it refuses, which is how a prefix or manual-route recruit used to
cross as a bare "application precondition failed". The caller's own scope, profile, result intent and
remaining fields ride through unchanged.

**A read-only seat claims nothing, so an empty scope is admitted for `mode: read_only` (#474, #373).**
`scope: []` on a contributing seat is refused typed — `field: 'options.scope'`, `rule: 'non_empty'`,
`admitted: 'one or more repository paths'`, with the read-only spelling named as the alternative that
makes the same request admissible — while the SAME request under `--mode read_only` is admitted and
carried as no scope at all: no `scope` on the join, no `scope:<seat>` claim row, no scope on the
seat's run options, and `scopeOverlap: []`. The decision belongs to the runtime because the mode is
the runtime's fact: the deployment's preflight never sees `mode`, and its Run-start grammar would
refuse the empty array either way. A `read_only` seat that names a real scope is admitted as before —
the declaration is visibility (docs/47 §5), never a hold.

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
seat, the minted messageId and the `harness_one_shot` reason, and answers with that row: a parked
receipt, never a success envelope around the refusal. Whether a seat is one-shot is read from its
adapter card's steer/prompt verbs, never from the harness name; a harness whose card CAN deliver
mid-turn keeps the live path whatever the delivery itself answers.

Parked guidance composes into the seat's next exec / `--resume-from` successor brief, in the
Swarm situation section, attributed to its sender with the parked row's seq, ts and messageId.
The composition marks each composed message delivered (`swarm.guidance_delivered`, plus the
`message.delivered` lane row that wakes `guidance_delivered`), so a later successor never
receives it twice — and the park itself wakes no delivery.

## Guidance delivery semantics (issue #273, runtime side)

A guide is a durable, addressable act with a delivery contract, not a best-effort interjection. The
runtime side (`swarm.guide`, `impl/src/swarm-runtime.mjs`) states four rules; the coordinator half
(`f2ea904c`) already frames the message the seat reads as `[baton swarm guidance from <sender> ·
<sentAt>]` and rides that provenance on the durable `control.nudge` record.

**One. A guide always answers with its own durable row.** The receipt carries
`guide: {seq, kind, participantId, from, sentAt, priority, inReplyTo, messageId, delivery}` — never
`guide: null`, whatever the lane answered. The row kind says which half of the contract it is:
`swarm.guidance_sent` for the delivered (or refused) half, `swarm.guidance_parked` for a park. The
old shape answered `null` for the most common case — a guide to a paused seat rides `nudgeTurn`,
which writes no `message.sent` lane row — so the sender could not tell a delivered guide from a
dropped one. `sentAt` IS the row's own instant (the row is the send). The receipt's `next` NAMES
THE OBSERVATION: the seat's next turn boundary (`wake class paused`), or, for a park, the
`guidance_delivered` row that clears it. The line an operator reads from the CLI renders the seat,
the priority and where it landed (`impl/src/application-cli.mjs`, `swarmGuideRendering`).

**Two. Priority is a closed set, `next_boundary | now`, defaulting to `next_boundary`.** `now`
rides the coordinator's immediate steer lane and pre-empts an in-flight tool call the way the
run-send idiom's `now` already does; `next_boundary` is delivered at the seat's next turn boundary
— which for a harness that takes no mid-turn delivery is the #337 park. Both are durable on the row
and visible on the participant row's `guidance` field. The set is declared once
(`SWARM_GUIDANCE_PRIORITIES`, `impl/src/swarm-contract.mjs`) and an unknown value refuses typed with
the #431 shape: `detail {field, rule: 'closed-set', admitted, expectation, correction}`.

**Three. `inReplyTo` threads guidance to what it answers.** A guide may name a prior guidance row, a
seat's message, or a contribution by ledger seq; the runtime refuses a seq the swarm does not hold
(`swarm_guidance_reply_target_not_found`, naming the target and the admitted kinds) before anything
is sent. The guidance fold links every row to its thread as `thread: {root, parent}` — `parent` is
the seq the guide answered, `root` is the row that started the thread (for a message or
contribution target, that row itself) — and the `guidance` projection renders threads in order: a
thread's rows together, threads in the order their roots were written.

**Four. `from` is relationship-named.** The sender identity is read from the actor namespace by the
ONE shared derivation the coordinator half owns (`guidanceSender`, `impl/src/coordinator.mjs`): the
web/MCP owner sessions and the bare orchestrator actor are `root`; the bridge's
`swarm-native:<swarm>:<seat>` names a seat. The runtime adds the seat's standing in the swarm —
a seat some other seat names as its parent LEADS that delegation (`{kind: 'lead', participantId}`),
any other seat is `{kind: 'peer', participantId}`, and a sender that is not a seat of the swarm is
`{kind: 'root', participantId: null}`. The brief's parked-guidance line reads the same derivation
for its attribution, so the label a seat reads and the relationship the swarm records cannot drift.

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
A stop of a seat with no live runtime (worker dead, exited, orphaned, or never bound) skips the
run drain entirely and settles the membership row at once (issue #353); a stop that does wait on a
live worker answers a pending receipt whose observation names the seat's own row (`baton swarm view
<swarm> --participant-id <seat>`), never `doctor --check`.

## Provider faults, carried workspaces, context packages and landings (issues #442, #385, #441, #296, 2026-09-18)

Four rows landed on 2026-09-18 that the loop now depends on; each is a fold, a wake, and a refusal
family, never a side channel.

**A provider fault is one fold (#442).** When a seat's worker ends with the provider-fault pair
the coordinator already emits (`lifecycle.turn_completed status: failed` + `kill.requested rule:
provider_fault`), the runtime records `swarm.participant_faulted {swarmId, participantId, workerId,
code, route: {harness, model, effort}, resetAt | null, resetAtText, snapshotSha | null}` and
settles the seat (`swarm.participant_left {reason: 'provider_fault'}`, #350). The `dead` wake class
fires on the faulted row, so a bounded watch `--wake-class contribution_recorded,dead` returns on
it. The deployment's route row for that (harness, model) reads `degraded` with the reset, and
`swarm.recruit` onto it refuses pre-effect `route_degraded {route, code, resetAt}` (#324's
readiness consult). `resetAt` is a zone-qualified instant or `null`; a provider string with no
zone (zai reports Beijing wall time) keeps `resetAtText`. A fault-settled seat stays a resumable
predecessor for `swarm.recruit --resume-from` — its work is on disk and the death was the
provider's. A seat the root settled (left/stopped, left/completed) is resumable while its
workspace is carriable — the retained checkout or the stop's snapshot commit (#452); a settled
seat with nothing to carry refuses `swarm_recruit_predecessor_unavailable` naming its status,
left reason, workspace state (`retained | snapshot | none`) and the closed resumable set
`SWARM_RESUMABLE_PREDECESSOR_STATES`. Observed live 09:50Z: fold, wake and refusal within one
second of the provider's 429.

**A successor carries its predecessor's workspace (#385).** `--resume-from <seat>` whose worker
is dead binds the predecessor's retained checkout (#428 custody) when no other live worker holds
it, else carries the change set of the predecessor's last snapshot into a fresh checkout, and
records `workspace.carried_from {participantId, workspaceId, predecessor, how, paths, snapshotSha |
null, reason}`; the brief's `## Inheritance from <seat>` names the carried paths and the `how`.
`how` is a closed set (#453): `bound` (the retained checkout itself), `applied` (the snapshot's
change set applied into a fresh checkout), `skipped` (nothing carried, `reason` names why — a
snapshot with no changed path, or paths missing from the snapshot). A carry is a fact or a
refusal, never a silent no-op: a snapshot that cannot apply refuses pre-effect
`swarm_workspace_carry_failed` and the successor is not admitted. A predecessor that is
still working keeps its checkout — the successor starts fresh and inherits guidance only (#318);
a checkout held by a foreign live worker refuses `swarm_workspace_unavailable`.

**A seat reads its issue through a context package (#441 lanes A and B; docs/47).** `swarm recruit
… --issue N [--doc PATH …]` reads the issue through the root's own `gh` credential and admits ONE
ContextPackage (`package.admitted`, branches `issue:N` and `doc:<path with "/" → ".">:<sha>` for every
repository doc the issue cites — a doc longer than one source string rides ordered chunks named
`doc:<path>:<sha>:<chunk>-<of>`, docs/47 §1.1/§9.7), attaches it to the seat's run (`package.attached`), and the brief renders
`## Context package` — digests and a bounded head per branch, the full text one `run.package.read`
away. A recruit without `--issue` composes byte-identically to before. Seat-side reads
(`run.package.read`, `run.contributions.read`, `run.peers.read`) refuse typed
(`package_not_attached_to_run`, `swarm_context_package_not_found`,
`swarm_context_package_branch_not_found`).

**Landing is a verb (#296).** `swarm integrate <swarm> <contributionId> --onto <branch> [--dry-run]`
squashes the range merge-base..commit.sha of an ACCEPTED contribution onto the target in a scratch
checkout the deployment owns, runs the regenerators and the derived gate set there
(`landing-table.mjs`: the seam inventory plus the declared region table), and records
`swarm.contribution_integrated` — the receipt of the git it actually ran, never
caller-submittable. Refusals are typed and pre-effect where possible:
`integrate_contribution_not_accepted`, `integrate_commit_unreachable`, `integrate_conflict`,
`integrate_gates_red`, `integrate_target_moved`, `integrate_change_invalid`. The gate run and
the regenerators are asynchronous children of the resident's supervised pool, never on its loop
(#459: `swarm.integration_started` / `swarm.integration_failed` rows, the host verify lease taken
through the suite runner's own seam, `integrate_gates_busy` when it is spent, `--follow` observing
the outcome row). The scratch checkout links the dependency install(s) the repository actually
holds (#451: `impl/node_modules`), and the gate set reaches the runner at the runner's own
layout — `test/<file>` relative to the suite root the runner runs in, both derived from the
runner path's directory (#463). An EMPTY derivation (a change that touches no tested path) runs
no gate and the receipt says `gates.skipped: 'no_affected_tests'`; a red gate's refusal and the
durable failure row carry the selection `{files, reason, provenance}`, the runner's bounded
stderr tail with the step that spoke it, and `regenerated`. Live: the verb ran against a live
resident without stalling it (2026-09-18); the first landing through it is the live check that
retires the hand chain in README.md.

**A provider fault proposes a re-route (#443).** Beside the #442 fault fold the runtime records
`swarm.reroute_proposed {participantId, workerId, from, code, resetAt, resetAtText, candidates,
excluded, carry, policy}` — candidates are the served routes that are ready and not faulted,
ranked by the #429 profile comparison with `billing` read from each route's measured profile; a
subscription route whose window is closed is listed under `excluded` with
`excluded_window_closed`, never proposed. The swarm-level policy is one caller-submittable row,
`swarm.policy_updated {rerouteOnProviderFault: 'manual' | 'auto', reroutePreferApi}` (`organize`,
through `swarm.update`, or at the open: `baton swarm create <purpose> --policy
'{"rerouteOnProviderFault":"auto"}'` writes the same row in the create's own mutation, validated
against the fold's closed sets before `swarm.created` lands, so a refused policy leaves no swarm
behind and the row is on the ledger before any recruit — #443 hand-back). Under `manual` the
proposal is the whole act: the `reroute_proposed` wake class and the `reroute_proposed` /
`reroute_no_candidate` attention rows page the root or sub-orchestrator with the resume spelling.
Under `auto` the runtime performs the resume itself onto the first candidate (successor
`<seat>-reroute-<deathSeq>`, operation key `swarm-reroute:<swarm>:<seat>:<seq>`, both stable so a
retry is safe), recording `swarm.rerouted {from, to, successor, carriedFrom, proposalSeq}`; the
successor's brief carries `## Re-routed` (the fault, its reset, the route it came from, the route
it went to, what was carried). Both runtime-recorded kinds refuse caller submission. Until #453
lands, "what was carried" can be an empty list for a predecessor whose snapshot held files.

## The stop names what it released, the open names its checkpoint, the resident reincarnates (issues #450, #449, #306, 2026-09-18)

**Every stop wait is a row (#450, #437).** A kill-confirmed worker's capacity reservation is released at the seam that observes the confirmation (`drain.resource_released {workerId, resource, how: 'worker_gone'}`); a stop whose fleet drain has no targets still releases and names every reservation whose worker is gone, and `host.stopped` carries them verbatim as `released: [{workerId, resource, how}]` beside `stages`. A wait past the first second — the run-stop leg included — is a `host.stop_waiting` row naming `{resource, reaper, since}`; a participant count the ledger refuses (#437) rides the stop rows as a named refusal, never a silent deadline. Observed cause of the 222-second silence on 2026-09-18: a reservation left by a worker killed two minutes earlier.
**A stop that abandons a worker still ends with its outcome (#472).** The two bounded deadlines a stop spends per worker (#467) end with the worker named abandoned — and the stop converges anyway: the drain dispositions an abandoned target `alreadyTerminal` (nothing is left for it to do), the fence (`closeAuthority`) and the deployment's capacity quiescence read past the reservation such a worker still holds (`coordinator.abandonedCapacityReservations`, named on the drain receipt as `abandonedReservations`), and the writer-lease release therefore runs and mints `host.stopped` where the ledger used to go silent. The row carries those workers as their OWN list — `abandoned: [{workerId, attempt, alive}]`, the bounded attempt each reached and the liveness the stop observed — beside `released` and never inside it (an abandonment is not a release), empty and never absent for a stop that abandoned nobody; the stop line says it too (`baton serve: host.stopped stopped_after_deadline at <at> … (abandoned 1: <worker> attempt 2, alive null)`). The resident's exit state is `closed` when the named abandonment is the only remainder left and `closed_degraded` only when something ELSE stayed unreleased (a transport that did not close). A drain whose fleet holds nothing but abandoned workers still runs its historical reconciliation, and a refusal that names that step rides the stop as `on: 'reconciliation'` — the deployment answers it with the same bounded convergence retry the worker wait uses, never with a kill.

**A stopping resident says so on every read an operator makes (#467, #476).** The served transport's close is two acts: new WORK closes when the stop begins (`batonCloseWorkAdmission`), while the reads the resident's own profile publishes — the card, `runs.list`/`swarm.list`/`swarm.view`, `/v1/session`, the event stream, wakes — keep answering over the still-listening server until the drain ends, and the card carries `application.stopping {state, at, waits: [{on, ids, at, attempt, alive}], attempts, abandoned}` for the whole drain. `baton doctor`'s `stopping` outline state is that same row read over that same transport: `/readyz` answers its 503 WITH the stopping row as its body (a bare `curl /readyz` says why instead of a bare status), and `doctor --check` — which reads readiness first — reads the card when readiness is not-ready and renders `state: 'stopping'` with the waits (the seat being drained, the bounded attempt the stop reached, since when) and a `next` naming the wait, where the readiness status used to cross as the bare `cli_command_failed: … (GET /readyz, HTTP 503)`. A resident that has already exited is unchanged: it withdraws its publication on the way out, so the CLI answers the ordinary `needs_setup` outline (`connection: 'missing'`).

**The checkpoint is bounded by its own cost (#449).** The release and the deferred housewriting write judge a projection checkpoint by its serialized bytes against `checkpoint.projection_bytes` (a replay frame's own byte budget), never by the ledger's row count; a resident whose projection exceeds that ceiling skips the stop-time write by design and relies on the open's rewrite. The open distinguishes `stale_shape` (the envelope's projection-shape digest or served commit differs from this build: full replay, then a fresh checkpoint written so the next open is bounded) from `corrupt` (an envelope invariant failed, #397); leftover `.projection.checkpoint.<uuid>` temp files are swept and named on the open row.

**A resident reincarnates in place (#306, part 1).** `deployment.reincarnate {target}` (`baton deployment reincarnate <commit-ish>`, `baton serve --reincarnate <commit-ish>`) is a drain-restart: the old incarnation records `host.reincarnation_requested`, closes new-turn admission, waits for in-flight one-shot turns with the #351 stop rows, starts the successor over the same deployment (`host.successor_started {pid, incarnation, argv, log}` — the successor adopts the incarnation the old minted, `argv` is the spawn spelling a reader greps for, and `log` is the path of the successor's OWN serve log, `resident/serve.<incarnation>.log` (#468; the old's tee of the successor's stderr covers the handoff window only). Every resident stream is guarded (#468): a socket, SSE or stdio failure records `host.stream_error {stream, code, at}` and a worker pipe failure the seat's `lifecycle.pipe_error`, never a throw to `process`; the last-resort trigger row carries `code` and `stackHead`), records the publication wait as a durable `host.stop_waiting {wait: {on: 'successor_publication', entries: [{resource, reaper: 'successor', since}]}}` row before releasing the writer lease last so the successor's open can take it, and withdraws its own publication only after observing the successor's (`host.successor_published`, `host.publication_withdrawn`, then the successor's `host.reincarnated {from, to, predecessorExited}`). After the withdrawal the old incarnation releases the successor's process handle and exits by itself — the last tail stage `incarnation_exit` (#461); a signal to an already-withdrawn incarnation drains nothing (it answers 0 participants); a successor that dies before publishing leaves `host.reincarnation_failed {step, cause}` and the old incarnation keeps serving. Participants' rows, checkouts, contracts, parked guidance and claims survive; their next turn runs under the successor. Refusals: `reincarnation_target_unreachable`, `reincarnation_in_flight`, `reincarnation_checkout_held`, `reincarnation_same_commit`; the one bound is `host.reincarnation.wait_ms`. The doctor's `served` block names `target {ref, sha}`, `behind {count, commits}` and `upToDate`; a recruit on a behind resident is admitted with the typed `advisory {kind: 'base_behind', …}` and its brief's `## Base` line; the `incarnation_changed` wake class keys on `host.reincarnated`. The web-lane admission and the canonical operation row for the verb are the last wiring (lane ds-306w).

**A resident under a declared parent is never an orphan (#471).** `baton serve` reads
`BATON_SERVE_PARENT_PID` — set by the fixture helper
(`impl/test/fixtures/fixture-resident.mjs`) and by nothing else — and watches that pid with the
same liveness primitive the successor uses for its predecessor (`reincarnationProcessAlive`) at the
same 100 ms poll `#watchPredecessorExit` uses. When the pid is gone the resident takes the ordinary
stop path — the durable request row first, then the same `deployment.close()` a signal runs — and
the ledger says why: `host.stop_requested {trigger: 'parent_exited', parentPid}` then
`host.stopped`. Nothing else changes: a resident started without the variable behaves exactly as
before, a reincarnation successor inherits the declaration (and the predecessor's process group),
so a fixture successor ends with the runner too, and the fixture helper spawns each resident in its
own group and ends the group on `t.after`, on the process `exit` event and on
SIGTERM/SIGINT/SIGHUP.

**The situation section reads one derivation (#441 lane C).** The brief's `## Swarm situation` renders peers-now and `N contributions recorded on this swarm` from the participants fold and the ONE exported contributions derivation the `contributions` projection and `run.contributions.read` share; `run.peers.read` and the brief's peer rows share `renderPeerNowLine`. The projection's contribution rows carry the derivation's `files`, `decision` and `reviewState` beside the fold's body.

**A situation section bounded by its budget, never by the swarm's age (issue #489).** The brief's `## Swarm situation` draws ONE registry row, `brief.situation.bytes` (derived from `context_package.brief_bytes`, itself `view.knowledge_slice.bytes` × 4), for each list that grew with the swarm's history: the published contracts (newest first) and the commits landed since the base keep whole rows — a hand-off is cited verbatim (#310) — and COUNT the remainder with the read that answers it (`run.contributions.read`; `git log <base>..HEAD` in the seat's own checkout). Everything else the section renders is bounded per row: the seats that can act ride #464's `view.role.head` row, and the settled seats are ONE line counting them per reason (`SWARM_SETTLED_REASONS`, #350's law) and naming `swarm view <swarm> --projection participants`. Measured before the fix on the primary: 132 587 B of published contracts and 24 715 B of commits inside a 158 233 B section whose seats-that-can-act rows were two. The Run view carries the same objective ONCE (`objective` + `objectiveBytes`), the plan preview / node rows / `plan` section items carry only its reach (the bounded first line + `{ref: 'goal.objective', bytes}`), and the ceiling is judged AFTER narrowing — `run show --depth outline|index|section|item` composes the SAME view SHED (each shed section recorded in the view's `narrowed` record with its bytes and the read that serves it), the participant's own start and `approve` take the same narrowing, and a full view over the ceiling refuses naming the section that dominates it, its bytes and `baton run show <run> --depth outline`.

## The probe's own turn closes the degrade (issue #475, 2026-09-18)

**The answering turn is the clearing (#475).** #456 admitted ONE probe at a degrade's `clearsAt` and
then asked a LATER route read whether the deployment still reported the episode — a reading that
never sees the probe's turn, because a probe seat's rows are not attributed to the route's
model/effort coordinates (`application-deployment.mjs` `deriveRouteRefusals`). Observed live
15:10–15:15Z: the probe answered (`route.observed` 15:11–15:12Z naming the model the provider really
served, a contribution at 15:12:40Z, `participant_left {reason: 'completed'}` at 15:14:47Z) and the
route still read `degraded`, so the next recruit was refused against a probe that had already
answered. The runtime now reads the two facts the PROVIDER produced — the durable admission
(`route.probe_admitted`) and the seat's own `route.observed` on the route its Run was admitted on,
recorded after that admission — where route truth is read (`_settleRouteProbes`, called by
`_routeUsageRows` and by the deployment facts `inspect` publishes; #486 moved it off the command
entry, where it made every command scan the ledger and broke `run.contributions.read`'s zero-scan
promise), and mints `route.recovered {route, at, episodeAt, probeKey, probeAt, clearsAt,
probeAdmissionSeq}` at the instant the turn was OBSERVED, keyed `route.recovered:<probeKey>` so the
clearing lands once however often it is read. `route.observed` is the earlier of the two durable
facts a successful turn leaves (it lands while the turn runs; the seat's contribution only at the
end of it) and the one that speaks about the ROUTE rather than about the seat's output, which is the
whole question a probe asks. The SAME derivation settles for a route the deployment's OWN
derivation already retired — the reading aid #456 needed — writing the same row under the same key,
and it reads the ledger by DELTA from one cursor per incarnation (rebuilt once on open), so a
command that reads no route reads no ledger row at all.

**Every runtime-side reader sees the closed episode (#475).** `_routeUsageRows` reconciles the
deployment's route table with the recovery the ledger holds: a route whose CURRENT episode is
closed reads `ready` with `quota.state: 'ok'` for the recruit comparison, the eligibility every
admission reads, the refusal text and the brief — even while the deployment's own row still reports
the episode. Exactly the episode is matched (the clearing names the admission, the admission names
the episode identity: `clearsAt`, else `since`), so a route the provider faulted AGAIN reads
degraded until ITS probe answers; a row the deployment derives as `blocked` keeps its own verdict,
because a refusal of its own is not a probe's to clear.

**A probe that is out is named, and a probe that stopped answering is released (#475).** A refusal
minted while an episode's probe stands names the SEAT the admission row recorded and the instant
that row carries (`probeSeat`, `probeAdmittedAt` — never "an unrecorded instant", which the old
in-memory map produced the moment `route.probe_deadline_ms` passed), and its remedy is the caller's
own: wait for that seat's turn, or stop it. No probe flag is offered, because a second probe cannot
be admitted while the episode's ONE probe is out. A probe whose seat has settled without answering
— or whose worker is gone once the probe deadline has passed — releases the episode, and the next
recruit admits the next ATTEMPT: the admission key is the episode's identity for attempt 1 (the
#456 key, byte-identical) and `<key>:<n>` after that. A probe whose turn the provider faulted clears
nothing: the coordinator's fold re-arms the episode with the new window and reset, and the refusal
names the probe seat and the typed fault it died of beside the new `resetAt`.

**The operator's probe has ONE spelling (#475).** `options.routeProbe: true`, carried by the
recruit's own `--options` flag (`baton swarm recruit … --options '{"routeProbe": true}'`), is the
only spelling: #456 consumed an undeclared `--route-probe` token before the closed-argv check —
never taught by any usage line, and refused #431-style by the verb's own admitted vocabulary — while
the refusal offered that token as its remedy. The token is gone; the closed argv refuses it like any
other invented flag and the remedy names the flag the verb really admits.

## A contribution body that is its own JSON document refuses (issue #481, 2026-09-18)

**One rule, one derivation, at the admission (#481).** A contribution body is the report OBJECT the
contract owns (`impl/src/contribution-contract.mjs`), and the note the runtime lands a plain-text
publish as (`swarm.note_recorded`, #310 — not itself submittable) carries the same field. The
contract's argument admission (`impl/src/swarm-contract.mjs`) refuses a body that is its OWN JSON
document — the report a seat serialized one time more than the contract expects — for BOTH halves,
from one table (`SWARM_REPORT_BODY_VERBS`) and one predicate (`swarmEncodedReportBody`), before the
note translation and before any fold:

`swarm_command_invalid {field: 'payload.body', rule: 'object', admitted: 'the contribution report
object (subject, commit, items, verification, needsFromOthers)', correction: 'the report was
JSON-encoded twice; pass the object'}` — and the same refusal, field `payload`, when the whole
payload is the encoded report. The remedy rides the message as well as the detail, so the lane that
prints only `{code, message}` still teaches the fix. Observed at fed18071: seat ds-465b's three rows
(seq 186528/186538/186548) carried `payload.body` as a JSON string, the projection rendered them
without `items`/`commit`, and the root's landing loop — which reads `body.items` and
`body.commit.sha` — had nothing to land. The whiteboard's `swarm.context_updated` body is
deliberately NOT in the table: its schema declares the entry arbitrary JSON and a note there is text
by design (#427). A body that holds no JSON is the plain-text finding/note the runtime has always
accepted, and stays admissible.

**The CLI refuses the same body at the parse (#481).** `baton swarm update … --payload` parses the
payload once (`swarmPayload`) and pre-checks the document member with the SAME predicate and the
SAME message constants, refusing `{field: '--payload', rule: 'object', admitted, correction}` where
the operator can still fix the argv. The SDK needs no second check: `Swarm._send` runs the shared
validator client-side, so `contribute()` refuses before the wire with the contract's own detail.
The served web transport's pre-dispatch argument arm composes `{code, message, field}` and
re-derives `field` from the request shape — so a web caller reads the code and the remedy on the
message, while the contract's own `field`/`detail` is what the direct port, the MCP path and the
native bridge (the seat's lane, `swarm-native-bridge.mjs`) cross.

**A stored string body projects as the defect, never as text (#481).** A row recorded before the
rule existed is never refused — a view never refuses recorded history (#304) — but it is projected:
`storedBodyDefect` (`impl/src/swarm-runtime.mjs`) marks a fold body that is its own JSON document as
`{invalid: 'string_body', bytes}` on the view's contribution rows and on the `contributions`
projection `run.contributions.read` answers, where the row's `summary` is then absent rather than
670 characters of JSON. A reader that folds a string body gets one key per character (the
incident's rows read as `{"0": "{", "1": "\"", …}`), which is exactly the shape the marker replaces;
the marker is a few bytes, so the frame budget docs/47 §3 guards is not spent on a second copy, and
the paged read's own body bound (`bodyBytes`/`bodyTruncated`, #343) is untouched.

## A refused recruit leaves its seat id re-joinable (issue #490, 2026-09-18)

**Every leg past the mint is inside the ONE withdrawal (#490).** `swarm.recruit` writes the seat's
join, starts the Run (which mints the Run's Goal and Plan), then binds the worker, claims the seat's
scope, attaches the recruiter's Context Package and carries the predecessor workspace. A refusal at
ANY of those legs — the live case was the package attach — runs the same #308 rollback the run start
does: ONE `swarm.participant_left {reason: 'recruit_refused', code, runId}` row, folded by #350's
settle fold, which (a) withdraws the seat's membership, keeping the identity re-joinable, and (b)
settles the Run the row names, so the seat's projection carries `settledRun {runId, terminalCause
{code, at}}` and the deployment stops that Run with the same refusal as its cause. There is no
second cleanup path: a refusal after the mint never leaves an active phantom seat beside a running
Run, and never leaves rows no reader can attribute to an attempt.

**A Run belongs to one recruit attempt (#490).** `swarm.recruit` names its Run by the attempt's own
operation identity — `run-<hash([swarmId, participantId, swarm-operation:<hash([command, swarmId,
principalId, idempotencyKey])>])>` — so a replay of one operation (the same recruit under the same
`idempotencyKey` by the same caller, which the family admits for a lost response, #302/#344) names
the SAME Run and re-admits it, while a new attempt names its own. Run creation mints the Run's Goal
under the fixed idempotency key `application:<runId>:goal:v1` (`application.mjs` `start`), and the
request digest that key is bound to covers the Goal's OBJECTIVE — for a recruit, the seat's composed
brief, a text that moves with the swarm. An attempt that refused after the mint therefore left a
Goal bound to one request under a key the seat id could never change: the next recruit of that seat
spelled the same Run and the same key with a different digest, and the store refused it
(`goal_conflict`, "goal idempotency key is bound differently") with no objective that could ever be
admitted again. Each attempt naming its own Run keeps the withdrawn Run's Goal as that attempt's
history — one version, the objective it was minted for, under its own key — and the seat's next
generation mints its own Goal, Plan and task rows.

**A re-join's receipt names what it superseded, and a conflict names the Run (#490).** A recruit that
resumes a rolled-back join carries `supersedes {runId, refusedAt, code}` — the withdrawn Run, the
instant its refusal was recorded, and the typed code it was withdrawn with — so the recruiter reads
the history it continued. When the Run the seat's id names STILL holds a Goal bound to another
request, the conflict crosses as the swarm family's own `swarm_recruit_run_conflict` (409, raised at
the recruit seam) rather than as the store's bare code: it names the Run, the Goal it holds, the
ledger row that holds them (`{seq, kind, idempotencyKey}`, read back by the deployment's own key for
that Run — a keyed read, never a scan) and the remedy in `detail.next` — `swarm stop` the seat, or
recruit the work under a fresh participant id.

**The rest of the identity rules are unchanged.** A seat that left through an ordinary stop is still
refused with `swarm_participant_exists {participantId, status: 'left'}` when recruited again, and a
re-attempt of the SAME operation under the SAME `idempotencyKey` is the same attempt: it names the
same Run, so the family's rule stands that a new attempt needs a new key.

**A probe admission names the Run it admitted (#490).** `route.probe_admitted` carries `runId`
beside `swarmId`/`participantId`, so a probe's answering turn is read on the Run that ran it
(`route.observed` is keyed by the Run). The lane reads that field where the row carries it, and a
row recorded before the field existed reads as the seat spelling — the Run every such row was
admitted on, since the first incarnation is the only spelling those rows ever had.

## The situation projection is deployment-level and the view serves it (issue #311, 2026-09-18)

Issue #311 asked for three things; two were already landed when it was audited (#318's knowledge
verb table and successor inheritance, #273/#337's guidance provenance and receipts — a
participant-to-participant message IS `swarm.guide` between seats, with `from {kind:
root|lead|peer, participantId}` and the guide's own durable row as its receipt). What was missing
was the situation itself: the recruit brief rendered a per-swarm situation (#318 deliverable 4)
and `swarm.view` served the raw collections, but no projection served the composed situation, and
nothing named the seats at work in the repository's OTHER swarms. This change closes that half.

**One derivation, two surfaces.** `_situation` (`impl/src/swarm-runtime.mjs`) assembles the block
the `situation` projection serves and the recruit brief's new blocks render: this swarm's can-act
peers with their scopes (the viewing seat excluded), the can-act seats of every other swarm of the
deployment with their swarm id and their whole declared scope, the contributions and contracts
those sibling swarms published, the commits landed on the target since the swarm's base, and the
viewing seat's predecessor when it joined with `resumeFrom`. The brief gains two blocks — "Sibling
seats at work in this repository's other swarms" and "Published in this repository's other swarms"
— rendered only when non-empty, so a one-swarm deployment's brief composes byte-identically.

**The sibling row is the #301 overlap row widened.** #301's recruit receipt names the seats whose
scopes overlap the requested one; the situation names every can-act sibling with its whole scope,
because the gap the issue measured was not only collision warning but "what siblings own". A
published row is subject plus a reference — `{swarmId, contributionId, participantId, seq,
subject, contract}` — never the body, the items, or the contract text; the swarm's own
publications are not repeated (they already ride the view's `contributions` family and the
brief's contracts block).

**The predecessor block reads the fold, never the recruit-time admission.** `_inheritancePredecessor`
refuses an unresumable predecessor, which is correct at recruit and wrong at read time (a view
never refuses recorded history, #304). The situation's predecessor block derives for the viewing
seat only: the predecessor's participant row, its last checkpoint from the ONE per-seat checkpoint
derivation `run.peers.read` renders (`seatCheckpointRows`, extracted from `_peersRead` for this),
and its published contracts from `contributionContractRows`. A caller with no seat, and a seat
that resumed from nobody, read `predecessor: null`.

**Commits are measured against the swarm's base, as #318 recorded.** The issue's phrasing ("since
this participant's base") predates #318's design decision: the base is the commit `swarm.create`
recorded from the deployment's git authority, a stored reference the commits are derived from at
read time. A seat's own drift against the target already rides its participant row as
`base {observedHead, target, behind}` (#301), so the situation keeps one commit list and the seat
reads its own distance beside it.

**Bounds and scoping follow the existing rows.** Every list the block carries is capped at the
`view.seat_read.items` ceiling with the remainder counted in a `…Omitted` field; a seat's bridge
is bound to its own swarm, so a brief's count line names the bound rather than a read the seat
cannot make. The block is built for the whole record and the `situation` slice only (#438's
read-path policy: the cross-swarm scan and the commits read are paid by the two projections that
promise them), and a participant-scoped view withholds out-of-subtree role lines in
`situation.peers` exactly as it does in `participants` (2026-09-14 audit S-F3). The projection
name joins the ONE table (`SWARM_VIEW_PROJECTIONS`), so the validator, the MCP schema, the CLI
and bridge help, the brief's grammar section, and the bridge's measured frame-fit advice all
derive it. Red-first: `impl/test/issue311-situation-projection.test.mjs` pins the projection's
declaration, every block's shape and honesty rules, the brief rendering, and the slicer parity
(`view(projection)` is byte-identical to `projectSwarmView(full, projection)`).

**Item 3 — every knowledge verb is taught or refused, and the classification is pinned
(2026-09-19).** The audit found the classification itself already landed (#318's verb table and
the #503 brief block) but pinned only for three retired verbs. `swarm-knowledge.test.mjs` now
derives the whole knowledge/scratchpad/board/context/package family from the canonical registry
and asserts the participant bridge refuses every member the brief does not teach — 22 rows at
this writing: the wave-settlement lane (`knowledge.promote`, `knowledge.settlement_lease`,
`scratchpad.settle`, the kernel `scratchpad.elevate`), the S-2 orchestrator board and package
tools, the worker `board.claim`/`board.report` wire frames, the orchestrator knowledge reads
(`knowledge.recall`, `knowledge.horizon`), and the context engine (`context.eval`/`map`/`reduce`/
`retry`). A new family verb lands red until it is taught to participants or classified off their
surface. The issue's "context packs" are not these `context.*` verbs: the packs are the store's
briefing and orientation machinery (`mintContextPack`, `context.pack_granted`), which no command
surface exposes, and the #318 section above records their retirement from the participant
surface.

## A brief's objective is read against the contribution contract at recruit (issue #502, 2026-09-19)

The #492 audit swarm's operator-written objective told every auditor lane to report its results in
a `findings` array beside the contract's own keys. The contract carries no `findings` field, so 40
of that swarm's 46 `swarm.operation_refused` rows were the identical
`body.findings: unknown-field` refusal: 17 of the 18 finished seats met it at least once, one seat
thirteen times, and each seat learned the real shape from its own refusal. The worked example
every brief renders (#310, #371) sits in the brief's `## Contribution contract` section; the
objective itself met no schema check.

**The recruit path reads the objective.** `contributionContractConflict`
(`impl/src/contribution-contract.mjs`) scans the recruit's `objective` text before any effect. A
JSON-ish object that names at least two of the contract's own top-level fields is read as an
example OF the contribution body, and the first field name in it — or in an object nested inside
it — that the contract does not admit refuses the recruit
`swarm_command_invalid {field: 'objective', rule: 'contract-field', offending, admitted,
correction}`, before the join, before the host admission, and before the deployment's
`prepareRun`. The message and the `correction` both name where the content belongs: per-item
detail goes in `items[].evidence`. The refusal lands on the durable `swarm.operation_refused` lane
like every other recruit refusal, so the recruiter reads it and fixes one brief.

**The vocabulary is the schema's.** `CONTRACT_FIELD_NAMES` walks
`CONTRIBUTION_CONTRACT_SCHEMA.fields` — the top-level fields, the sub-schema keys and the item
row's keys — so the lint and `validateContributionContract` judge one vocabulary.
`CONTRACT_BODY_CLAIM_KEYS` (two top-level names) is the threshold at which an object reads as a
body example; an object carrying one shared name stays out of the judgment. Quoted string regions
are read whole, so a field name inside a value stays a value. The runtime's contract validator
keeps its closed shape: an unknown body field refuses with its `rule` and its admitted vocabulary,
and this read is what keeps a brief from producing one.

**The recruit's objective is what is read.** The brief's own sections are composed by the runtime
from the schema and the durable record. The check runs on every recruit of the seat, including a
re-recruit of a withdrawn one, and applies to every mode.

Red-first: `impl/test/issue502-brief-contract-guard.test.mjs` pins the recorded failing objective,
the schema-derived vocabulary, the texts the lint leaves alone (the publish envelope line, another
payload's example, prose, a key name inside a value, the pre-#310 hand-off), the refusal before
any effect (no membership row, no worker, no `prepareRun` call, the durable refusal row), the
fixed objective's recruit followed by an admitted publish, and the refusal answer on the native
bridge.
