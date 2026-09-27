# Open coordination: claims and peer work

Participants record work and path claims with `swarm.claim_updated`. The runtime attributes
changed paths and commits to seats and reports their current work in the recruit brief.

## 2. `swarm.claim_updated` — a hold a seat takes for itself (#423)

**Payload** (closed): `claimId` (required); `participantId` (autoFilled: the caller's own seat;
naming another is `organize`); exactly one of `workId` | `paths` (neither or both refuses
`invalid_payload`, the shape-lane family); `status` (`active | released`, default `active` on
create); `handoffTo` (an active participant; holder-only, §2.2); `reason`; `expectedVersion`
(the existing CAS guard). `workspaceId` is never caller-supplied: a path claim binds the
claimant's RECORDED checkout (`participant.workspaceId`, the join/binding record), and the fold
stores that binding on the claim row. A claimant with no recorded checkout claims with
`workspaceId: null` — absence, not a guess.

**Fold** (new `claims` collection on the swarm row, beside `assignments`): create-or-replace
with CAS, as every collection. A work claim names existing work (`work_not_found` reuses the
existing code). A path claim's entries are repo-relative, `/`-separated, and name no `..` or
leading `./` (shape refusal). Admission-only (#304 pattern), never replayed: a path claim
**conflicts** — refuses `swarm_claim_conflict` — when another seat's ACTIVE claim has the same
non-null `workspaceId` and an overlapping path, where overlap is string-equal or a prefix at a
`/` boundary. The refusal names the holder, the holding `claimId`, and the overlapping paths.
Claims on different checkouts never conflict (the lane model is per-worktree by construction);
a null workspace conflicts with nothing. Work claims never conflict: several agents may
contribute to one work item (docs/39), and the claim is the visibility, not a fence.

**View**: `claims` is an ARRAY of rows (the one collection shape, #302), each
`{claimId, participantId, workId | paths, workspaceId, status, actor, seq, ts}`. A scoped view
carries the claims of the subtree's seats and the claims naming in-scope work.

**Refusals**:

| code | field | rule | remedy |
|---|---|---|---|
| `swarm_claim_conflict` | `paths` | `claimed-paths` — same recorded checkout, overlapping paths, another holder | name your own disjoint paths, or ask the holder to release or hand off; the refusal names both |
| `invalid_payload` | `workId`/`paths` | exactly one target; paths are repo-relative | drop one target; fix the path shape |
| `work_not_found` | `workId` | the claim names existing work | create the work first (`swarm.work_updated`), or claim paths |
| `swarm_permission_required` | `participantId` / `status` / `handoffTo` | `claim-holder-or-organize` — a seat moves only its own claims | release or hand off your own claim; an organizer moves any |
| `participant_not_active` | `handoffTo` | a handoff lands on a live seat | pick an active participant |

### 2.1. Holder gone

An active claim whose holder's membership ended, or whose runtime is gone (the ONE liveness
derivation, `swarmParticipantLiveness`), raises attention `claim_holder_gone`
`{claimId, participantId, workId | paths, next: {event: 'swarm.claim_updated', claimId, status: 'released'}}`
— the mirror of `assignment_holder_gone`. Death never auto-releases; the row names the act.

### 2.2. Handoff

`handoffTo` moves the hold in ONE row: the fold rewrites `participantId` and keeps
`status: active`, so there is no free window a third seat could take. The caller must be the
current holder (`contribute`) or an organizer; a non-holder's handoff refuses
`swarm_permission_required {rule: 'claim-holder-or-organize'}`. The receiver's consent is not
required — the handoff is visible on the view and in the receiver's next brief, and the receiver
may release. The receiver must be an active participant (`participant_not_active`).


## 5. Changed-path attribution and `shared_checkout_overlap` (#423)

On a shared checkout, `git status` shows the UNION of every seat's changes, so porcelain alone
cannot say whose work a path is. The attribution record is the CLAIM (§2): declared, durable,
conflict-checked. The derivation — one place, beside the existing `worktree_foreign_changes`
derivation in the runtime's view builder — reads each physical checkout's current changed paths
ONCE (`worktreeChangedPaths`, the existing read-only git seam) and, for a checkout with two or
more active seats, raises:

```
{ kind: 'shared_checkout_overlap', workspaceId, paths: [...], omittedPaths,
  holders: [{participantId, claimId}], seats: [active seat ids],
  next: { command: 'swarm.view', swarmId, participantId } }
```

when the changed set intersects an ACTIVE claim's paths. The row names the holder, the claimed
paths observed changed, and every active seat on the checkout — so a peer about to touch a held
file sees the hold BEFORE its commit, derived from the working tree at view/watch time rather
than discovered at integration. Paths changed but unclaimed are named under no seat
(`attribution: none` is the honest answer; a union observation never guesses an author). The row
is attention (steer, don't gate — docs/36 L9): it pages nobody and stops nothing; it is the
record that replaces compare-389's mis-attributed WIP. Per-seat authorship of UNCLAIMED changes
would require turn-delta snapshots of the shared tree; v1 deliberately does not derive it
in this projection.


## 6. The "peers now" brief section (#423)

`_composeRecruitBrief` (swarm-runtime.mjs) gains one derivation, consumed by every recruit and
`resumeFrom` brief — the brief of a resumed or multi-turn seat is the recruit-brief seam, so one
renderer serves both. The section renders after the existing peers block:

```
Peers now:
- beta — holds work-3 (assigned); claims impl/test/x.test.mjs on ws-…; last checkpoint contribution-c7 (seq 91, 2026-09-18T…)
- gamma — holds nothing; last checkpoint: none recorded
```

Each line derives from the durable rows, never from prose: held work from ACTIVE assignments and
ACTIVE work claims; claimed paths from ACTIVE path claims (naming the checkout); the last
checkpoint from the peer's latest contribution carrying a revision (sha + ref), else its latest
contribution (`seq`/`ts`), else recorded absence. A seat with no rows says so — absence, never a
guess. The same rows are what the scoped view projects, so a seat that wants the live reading
mid-turn reads `swarm.view` and gets byte-identical facts; the runtime pushes nothing mid-turn
(the guidance channels are unchanged).
