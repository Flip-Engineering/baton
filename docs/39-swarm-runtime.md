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
