# coupling.md — declared coupling and session ownership in living swarms (2026-09-13)

Closes issue #263 items 2 and 3 (and completes the coupling half of gap 4 named in
[suborchestration.md](suborchestration.md) and anticipated by
[delegated-completion.md](delegated-completion.md)). Method: a scripted swarm through the real
SDK, application, coordination store, Git worktrees and mock harness
(`impl/test/swarm-coupling.test.mjs` is the durable form, with the fixture shape of
swarm-delegated-completion.test.mjs plus a shared-checkout variant carrying the custody
fixture's capacity options): root recruits a `lead` with every permission; the lead recruits
`alpha` and `beta`, opens `W-A`/`W-B`, assigns them, forms group `impl`; the tests then declare
each coupling, drive it through declaration, use, and release, stop and release members, walk a
left session's responsibility up the recruiter chain, and replay the coordination log
byte-identically.

## What was decided, and why

**One new durable kind, one new optional work field — no new verbs.** The brief asked for a
small agent-facing surface: a few update kinds with clear payloads over many verbs. The four
coupling choices docs/39 names therefore live in two places:

| Coupling (docs/39 §Loose and tight orchestration) | Where it is declared | Durable carrier |
| --- | --- | --- |
| A dependency between units of work | on the work itself, `swarm.work_updated` optional `dependsOn` | stored on the work row (`[{ workId }]` or `[{ artifact }]` entries, replaced whole, kept when omitted) |
| A synchronization point | `swarm.update` event `swarm.coupling_updated`, coupling `synchronization` | new `couplings` collection: declare / arrive / release, arrivals in log order, release names who and why |
| An exclusive writer over a shared checkout | `swarm.coupling_updated`, coupling `writer` | record names writer + the checkout the writer is recorded in; release ends the window |
| A group failure policy | `swarm.coupling_updated`, coupling `failure`, policy `independent` | one unreleased policy per group; release revokes |

Dependencies ride `swarm.work_updated` because the suborchestration probe already tried to
declare them there (`dependsOn: ['W']`) and the runtime honestly refused that the field did not
exist. Closing the gap at the exact declaration site is the smallest honest surface: an agent's
old attempt is now a valid, durable declaration, and a malformed one still refuses — now with
the deep shape rule (`exactly one of workId or artifact`) instead of `unknown field`.

**Declared, kept honest, never imposed.** The runtime never stops a worker because of a
coupling: waits are projected, not enforced. What the swarm refuses is a RECORD that would lie:
a dependency naming an unknown work, a self- or ring-dependency (`work_not_found`,
`work_dependency_self`, `work_dependency_cycle` naming the ring), an arrival by a non-member,
a second arrival by the same member, an arrival at a released point, a second exclusive writer
over the same checkout (`swarm_writer_conflict` naming the current writer), a second failure
policy for one group, and an unknown failure policy value. Each refusal names what is missing
or who holds the conflicting record.

**Informed, not fenced — the surfaces that carry the truth.**

- `swarm.view` work rows carry `waitsOn: [{ workId | artifact, settled, evidence }]` — each wait
  with the accepted contributions that settled it (the same evidence derivation the completion
  rule uses, plus accepted-contribution `refs` for artifact waits).
- Synchronization records project `arrivals` (log order), `awaiting` (current live members not
  yet arrived), `departed` (members of the declared roster that no longer count: left, runtime
  gone, or released from the group), and the derived `arrived` fact. `awaiting` counts only
  current live members, so a barrier built on this record can never wait on a departed seat —
  the exact trap the delegated-completion audit predicted; released seats are consumed by
  construction, with `swarm.holder_released` the remedy that unblocks them.
- Every declaration, arrival, and release is an ordinary durable swarm event, so `swarm.watch`
  (and `baton swarm watch --follow`) wakes on each of them with the refreshed view and attention
  rows; an orchestrator or a peer can act without polling.
- New attention rows, only where coupling was declared: `group_member_gone`
  (`{ couplingId, groupId, participantId, policy, dependentWork }` — the dependents are the
  works that declared a dependency on the gone member's work) and `coupling_writer_gone`
  (with `next: { event: 'swarm.coupling_updated', action: 'release' }`).
- The subtree view scopes couplings like groups: writer records follow the writer's subtree,
  synchronization and failure records require full group ownership, and a group the subtree does
  not own is omitted rather than shown with a pruned membership (the delegated-completion rule).

**Independence is the undeclared default.** Without a declared failure policy, a member's death
produces only the pre-existing organization truth (`participant_runtime_dead`,
`assignment_holder_gone`) — independent activities inherit nothing by sharing a swarm. The
`group_member_gone` row exists only where the policy was declared, and releasing the policy
clears it.

**Session ownership (item 3).** `member_left_session_live` now names
`responsibleParticipant` (the nearest LIVING ancestor by `parentId` — the recruiter, walking up
past departed recruiters) or `responsibleActor` (the swarm's creator when no participant
ancestor is alive), and `next: { command: 'swarm.stop', participantId }` — the operation that
reclaims the session. Responsibility re-points as the chain departs: beta's session belongs to
the active lead, then to the creator `direct:root` after the lead leaves. Reclaiming is the
explicit stop; after it the row is gone. Seat release (`swarm.holder_released`) and session
reclaim (`swarm.stop`) stay two separate operations — release moves seats, never processes.

**No existing payload shape changed meaning.** `swarm.work_updated` gained one optional stored
field (`dependsOn`); rows written before it existed carry no key, so pre-coupling logs replay
byte-identically. `swarm.coupling_updated` is a new durable kind recorded as itself (it is not
an operation kind: its events land in the log directly, so replay needs no expansion). The
swarm row gained the `couplings` collection — additive, replay-derived, and empty unless
someone declares.

## What a tight subgroup can now express

A lead declares W-B dependent on W-A and on a named artifact; the builders proceed while the
wait is honestly unsettled; the dependency settles when an accepted contribution lands, and the
wake feed announces it. The builders' group declares an interface-freeze point; alpha arrives
(itself, with read authority), the group sees who has not, the lead releases with a reason. One
builder holds the shared checkout at a time; a second claim refuses naming the holder; a dead
writer's checkout is freed by the release the attention row names. The group declares the
independent failure policy; when a member's runtime dies, the dependents are told by name and
the peers continue. And when a member leaves with its session running, everyone can see who is
responsible for that session and what operation reclaims it.

## Verification

`impl/test/swarm-coupling.test.mjs` (nine tests): dependency declaration, wake-on-declaration,
proceeding against an unsettled wait, settlement with evidence and wake-on-settlement; refusal
of dangling, self, ring (named), and ambiguous dependencies; synchronization declare / arrive
/ duplicate / outsider / release / after-release refusals and wake; released seats never
awaited and departed seats named; exclusive-writer claim, same-checkout conflict naming the
writer, writer-less claim refusal, release and re-claim, gone-writer attention and its release;
failure-policy declaration, conflict, unknown policy, the `group_member_gone` row with
`dependentWork`, peer independence, and policy release; the leave → recruiter → creator
responsibility walk with the named reclaim and its clearance; subtree scoping of couplings;
byte-identical log replay with couplings and dependencies. The full swarm verification set plus
swarm-state, swarm-event-schemas, swarm-surface, swarm-application, swarm-mcp-dispatch,
swarm-wake and workflow-swarm-lifecycle stay green; the surface gate regenerated artifacts with
no drift.

## What remains

- **Barriers that gate dispatch** are deliberately not here: the design keeps coupling
  informative. A future gating layer (for example, deferring a task's dispatch while its work
  waits, in the `task.dispatch_deferred` style) should consume exactly the projected
  `awaiting`/`settled` facts, never recount seats.
- **Quorum and atomic admission** (docs/39's remaining named choices) are not declared kinds
  yet; the coupling record shape (typed records with declare/arrive/release) is the pattern to
  extend.
- **Writer checkout identity for owning holders**: only adopted participants carry a recorded
  `workspaceId`, so a claim over a participant's own unrecorded checkout is honest but
  per-checkout exclusivity cannot be proven between two unrecorded checkouts. Recording the
  allocator's checkout on first recruit would close that.
- **Dependency semantics beyond accept-evidence** (for example "settles when the target work's
  status is completed") remain expressible today only through the accepted-contribution rule;
  the `dependsOn` entry shape has room for a `need` discriminator if a second rule earns its
  place.
- A delegation-scoped `swarm.watch` subscription (the delegated-completion audit's remaining
  half) is still open; coupling wakes ride the swarm-wide feed today.
