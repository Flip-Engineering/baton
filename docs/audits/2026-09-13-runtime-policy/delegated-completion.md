# delegated-completion.md — derived completion, holder release, and the subtree view (2026-09-13)

Closes the first and last gaps and the release half of gap 4 in
[suborchestration.md](suborchestration.md) (issue #263). Method: a scripted swarm through the real
SDK, application, coordination store and mock harness
(`impl/test/swarm-delegated-completion.test.mjs` is the durable form), with the same shape as the
organization-truth probe: root recruits a `lead` with every permission; the lead recruits
`alpha` and `beta`, opens `W-A`/`W-B`, assigns them, forms group `impl`; the builders publish
contributions; the lead accepts; work completes; a builder is stopped and released; the lead
leaves; and the coordination log replays to the identical swarm.

## What was added

| #263 gap | Added |
| --- | --- |
| 1. No completion for a delegated subtree | Derived completion evidence per work item, an evidence-gated completion transition rule, and the per-participant `delegation` projection in every `swarm.view` |
| 4. Assignments and groups do not react to their participants | The organizer release operation `swarm.update` event `swarm.holder_released` ({ participantId, reason }) |
| 5. No subtree view | `swarm.view` accepts an optional `participantId` and returns the swarm scoped to that participant's delegation |

No existing event kind changed its durable payload shape: `swarm.work_updated` gained one
optional field (`basis`, ignored by the fold, so pre-existing logs replay identically), and the
holder release expands into the existing `swarm.assignment_updated` / `swarm.group_updated`
kinds — the log after a release is byte-identical to the hand-written sequence, and the request
itself (reason included) rides the durable `swarm.operation_requested` record.

## The derivation rules

**Work evidence.** `evidence: { contributions, accepted, derivedComplete }` on every work row.
`contributions` are the contribution ids that reference the work via `workId` (sorted). A
contribution is *accepted* when some review accepts it and no LATER review on that same
contribution rejects it — reviews append in log order, so append order is review order, and an
accept after a reject revives the evidence. `derivedComplete` is true iff `accepted` is
non-empty.

**The completion rule.** An organizer may set `status: completed` only when (a) the derivation
already holds for that work item, or (b) the update cites `basis: { contributionIds: [...] }`
where every cited contribution exists, is accepted (same no-later-reject rule), and references
the work — by `workId` or by `refs`. Anything else refuses with `swarm_completion_unproven`
naming what is missing: no accepted contribution references the work, or exactly which cited
contributions fail and why (unknown / does not reference this work / no unrevoked accept
review). A completed status remains a claim about organization, not a check verdict — checks
stay separate observations; the evidence links make the claim auditable, not trusted.

**Delegation truth.** Every participant row carries
`delegation: { children, work, complete }`: the direct children, the work actively assigned
within the participant's subtree (transitively by `parentId`), and `complete` iff every such
work item has status `completed` AND every still-active child is either done (it holds no active
assignment anywhere) or departed (its membership ended). A finished child may keep its active
assignment — the release is bookkeeping, not completion — but a child still holding a seat keeps
the parent's delegation open. `swarm.holder_released` is what closes a delegation whose worker
cannot release its own seat.

**The holder release.** Eligible holders: runtime dead/exited (or unbound), or membership left.
A live active participant refuses with `swarm_holder_live` — stopping it remains the explicit
separate act. The effect is one batch, proven to fold before the first write: every active
assignment of the holder becomes `swarm.assignment_updated { status: released }`, and the holder
leaves every group via `swarm.group_updated` with the pruned member list. The attention rows
`assignment_holder_gone` and `delegation_orphaned` now carry
`next: { event: 'swarm.holder_released', participantId }` — the departed parent is the
recoverable holder an orphaned child's row points at.

**The subtree view.** `view({ participantId })` (contract-optional argument, CLI
`--participant-id`, MCP `participantId`) returns the same view shape scoped to that
participant's subtree: participants, work with evidence, assignments touching the scoped work or
holders, the scoped work's contributions and their reviews, groups owned entirely by the
subtree, and attention filtered to rows the subtree can act on. Authority stays the caller's
(`caller`, `availableActions`, `updates` are not scoped); shared context stays swarm-wide; a
group the subtree does not fully own is omitted rather than shown with a pruned membership, which
would lie about the durable record.

## Verification

`impl/test/swarm-delegated-completion.test.mjs`: completion derives from an accepted
contribution; a hand-set completed status without basis refuses; a basis citing a foreign work's
contribution refuses; a refs-linked accepted contribution completes only through the cited
basis; the root's and the lead's subtree views for the lead are identical in every organization
field; a leaf scope excludes unrelated participants; `swarm_holder_live` refuses a live holder;
the dead holder's release lands as exactly the two individual durable events with no marker
kind; the departed lead is releasable; and the coordination log replays to the byte-identical
swarm. The full nine-file verification set (organization-truth, runtime, application, state,
surface, mcp-dispatch, both red suites, and this file) is green; the surface gate
(`surface-gate.mjs --write`) regenerated artifacts with no drift.

## What #263 items 2 and 3 still need

**Release (gap 4) — the operation exists, policy does not.** Release is organizer-invoked:
nothing releases a holder automatically on death detection — attention names the next step and
an authorized caller acts. A live-but-idle participant holds its seats indefinitely by design.
When group barriers, quorums or dependencies land (gap 2), they must consume released seats — a
barrier that counts a departed member's seat would wait forever precisely where this operation
is the remedy. Session ownership for a member that left (gap 3) is untouched: the release moves
seats, never processes.

**Subtree view (gap 5) — the read exists, the subscription does not.** `swarm.watch` is
swarm-wide; a delegation-scoped subscription (wake only on the subtree's events, cursor held per
scope) does not exist, so a lead polls the flat view or filters by hand. `operation_unconfirmed`
rows stay swarm-wide in a scoped view. There is no roll-up projection ("all delegations and
their completion in one read") — the flat view carries each participant's `delegation`, but a
root overseeing many delegated coordinators still assembles the fleet picture by hand.
