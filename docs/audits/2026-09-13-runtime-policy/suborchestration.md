# suborchestration.md — delegated completion and coupling in living swarms (2026-09-13)

Method: a scripted swarm through the real SDK, application, coordination store and mock harness
(`impl/test/swarm-organization-truth.test.mjs` is the durable form): root recruits a `lead` with
every permission; the lead recruits `builder-a` and `builder-b`, opens work `W1`/`W2`, assigns
them, forms group `impl`; the builders publish contributions against their work; the lead accepts
one and marks `W1` completed; then root stops `builder-a`, the lead leaves organizationally, root
guides the orphaned `builder-b`, and closes the swarm while it runs.

## What holds today

- Delegated recruitment works within grants (`parentId` is recorded; a child cannot grant what it
  does not hold; a child cannot recruit without `recruit`).
- Work, assignments, groups, group-scoped context, contributions with `workId`, and reviews are
  durable and visible to every member; a sub-participant sees its own assignment.
- Loose coupling holds: a peer's death or the lead's departure changes nothing for independent
  participants; root can still guide an orphaned child, and its next turn runs.
- Organizational close is separate from process shutdown (by design), and recruitment refuses on a
  closed swarm.

## Defects found and fixed here

| Observation | Truth defect | Fix |
| --- | --- | --- |
| After `swarm.stop('builder-a')` the participant read `status: active, runtime.state: dead, turn: paused` | A dead worker's leftover pause record was projected as a turn a guide could resume | `runtime.turn` is `paused` only while the worker is alive |
| Nothing in the view said a member was dead, an assignment had no living holder, a delegation had lost its parent, a departed member's session was still running, or a closed swarm still had live participants | The root had to assemble organization truth by hand from five sub-structures | `attention` rows: `participant_runtime_dead`, `assignment_holder_gone`, `delegation_orphaned`, `member_left_session_live`, `closed_with_live_participants` (existing rows carry `kind: operation_unconfirmed`) |
| `swarm.work_updated` refused a status-only update (`objective` required again) | Friction: to complete work an organizer had to resend the objective | The runtime fills the recorded objective for existing work; new work still needs one (`swarm_payload_invalid`) |
| `swarm.work_updated` accepted `dependsOn: ['W1']` and dropped it | An agent believed it had declared a dependency | Unknown payload fields refuse with `swarm_command_invalid` naming the field and the accepted fields |

## Gaps that remain (issue #263)

1. **No completion for a delegated subtree.** Work status is set by hand; nothing derives "W1 is
   complete because an accepted contribution references it", nothing states "the lead's delegation
   (its children, their work and assignments) is complete", and the root cannot ask the swarm for
   it. Completion is a fact the design says must come from evidence (docs/39 §Claims); today it is
   a label.
2. **Coupling primitives exist only as prose.** docs/39 names dependencies, group barriers,
   atomic admission, shared failure policy, exclusive writer and selected quorum as explicit
   choices; the runtime offers groups (membership lists), group-scoped context and shared
   checkouts, and nothing else. A tightly coupled subgroup cannot declare a synchronization point
   or a dependency on another unit of work; the probe's `dependsOn` is refused (correctly) because
   it does not exist.
3. **Leave versus session ownership.** A member that leaves keeps its process; the swarm names
   this now, but no rule says who owns that session afterwards or when it is reclaimed — the root
   must remember to stop it.
4. **Assignments and groups do not react to their participants.** A dead or departed holder keeps
   its active assignment and its group seat; the view names it, but no organizer action or policy
   releases it, and a group barrier (if it existed) could wait on a member who cannot answer.
5. **No subtree view.** `swarm.view` is flat; a lead cannot ask for "my delegation" and a root
   cannot ask for "what the lead was responsible for" without walking `parentId` by hand.

## Minimal-sufficiency judgement

For loosely coupled swarms Baton is sufficient today: independent participants, shared findings,
guidance, capture and check, honest attention. For suborchestration it is not: a delegated
coordinator can organize but cannot report completion as evidence, and the root has no view of the
delegation as a unit. For tightly coupled work it is not: only shared checkouts and group
membership exist; ordering and synchronization must be improvised in prose.
