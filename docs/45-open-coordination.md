# Open coordination: claims and peers-now (issue #423)

Design direction: 2026-09-18, design seat kimi-design. Superseded in part by #598: the group,
work-proposal and declared-coupling families this document also designed (its §§3, 4 and 7) left
the runtime, because the operator's coordination ledger held no row for any of them. What remains
here — the claim family (§2), changed-path attribution (§5) and the peers-now brief section (§6) —
is shipped behaviour.

## Purpose

The hold primitives are role-shaped: an assignment is the organizer's act, and a peer group handed
a task and one shared checkout has no way to record what it is working on beside its peers. On
compare-389 (2026-09-18) three equal-grant seats self-organised through twelve `swarm.guide`
messages, three shared-context notes and three knowledge nodes, and a seat twice mis-attributed a
peer's work in progress because the swarm recorded nothing about who held which paths.

The owed capability, and the frictions it answers:

1. **Claims, and peers-now** (#423) — a `claim` on a work item or a path set any `contribute` seat
   may take; a live "peers now" section in the brief; per-seat changed-path attribution on shared
   checkouts raising a `shared_checkout_overlap` attention row before commit.

The design also proposed joint couplings (#422) and a derived loose/tight reading of a group
(#374). Both left with the families they described (#598), so this document keeps only what shipped.

## 0. Rules that do not change

These rules from [docs/39](39-swarm-runtime.md) bind every mechanism below; the design extends
them, never exceptions them:

- **A record INFORM rather than fence.** Nothing here stops a worker's process; a seat that
  proceeds against a claim does so visibly, and no process behaviour changes.
- **Who acted is a fact of every record, never a caller-named seat.** Holders and reviewers carry
  the actor the runtime derived; a caller-named identity that is not the actor refuses.
- **One owner per closed set** (§10). No second tables.
- **Replay is byte-identical.** New fields are absent on old rows; new admission rules run under
  the fold's `admission` flag (the #304 pattern) and never refuse recorded history.
- **No clock decides a hold's fate** (#163). Claims have no TTL and no expiry; a gone holder is
  settled by an explicit act the attention row names.
- **Self-reports are cheap; acting on others is not.** A seat's own claim rides its own authority;
  naming another seat stays an organizing act.

## 1. The event vocabulary

One kind is added. The public caller-submittable set lives in `SWARM_EVENT_KINDS`
(`impl/src/swarm-contract.mjs`); the recorded fold set lives in `impl/src/swarm-state.mjs`; the
load-time assertions that keep the contract, the payload schemas and the permission table in
agreement are the existing ones, so a kind added in one place and not the others fails at load,
never silently.

| Kind | Status | Permission (self / other) | Folds into | Wake class |
|---|---|---|---|---|
| `swarm.claim_updated` | **new** | `contribute` (own) / `organize` (naming another) | `claims` | `assigned` |

A claim reuses `SWARM_ASSIGNMENT_STATUSES` (`active | released`) — the lifecycle vocabulary is one
axis (docs/36 L4) and a claim is an assignment-shaped hold with self-authority — so no new status
set exists.

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
carries the claims of the subtree's seats and the claims naming in-scope work, by the same
intersection rule the other scoped slices use.

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
(§12, open question 2).

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

## 8. What the view and the brief render

| surface | new rendering |
|---|---|
| view `claims` rows | the new array collection (§2) |
| view `attention` | `claim_holder_gone` (§2.1), `shared_checkout_overlap` (§5) |
| view `updates` | the new kind and actions appear exactly when this caller's permissions admit them (the §2.2 derivation) |
| brief | "Peers now" (§6) |
| `swarm.watch` | `swarm.claim_updated` rides the `assigned` wake class (WAKE_CLASS_TABLE, wake-stream.mjs) — no new wake vocabulary |

## 9. What stays OUT

- **No lead requirement.** Every new verb is exercisable by the members it names; `organize` is
  required only to act on OTHERS, as today. A seat can claim, hand off and release end to end.
- **No role names in the runtime.** `role` stays the free text a join carries; nothing in these
  records reads it.
- **No new failure policies.** `SWARM_FAILURE_POLICIES` stays `independent` only; a joint
  failure policy is a separate design.
- **No enforcement fencing.** #425 owns enforcement; these records inform (§4.4).
- **No TTLs, no timers, no expiry on holds or claims** (#163). A gone holder is settled by the
  explicit act the attention row names.
- **No authorship guessing.** Unclaimed changed paths on a shared checkout are reported as
  unclaimed (§5).

## 10. Closed-set owners

| closed set | ONE owner |
|---|---|
| public `SWARM_EVENT_KINDS` / store fold kind set | `impl/src/swarm-contract.mjs` / `impl/src/swarm-state.mjs` — the two existing sets, kept in agreement by the existing load-time assertions |
| payload shapes (`SWARM_EVENT_PAYLOAD_SCHEMAS`) | `impl/src/swarm-event-schemas.mjs` |
| per-kind and per-action permissions (`UPDATE_PERMISSIONS`, `_updatePermission`) | `impl/src/swarm-runtime.mjs` |
| claim statuses | `SWARM_ASSIGNMENT_STATUSES` (reused — no new set) |
| attention kinds (`claim_holder_gone`, `shared_checkout_overlap`) | the runtime's row-minting sites; enumerated by the generated block (docs/36 §7.4) |
| wake classes | `WAKE_CLASS_TABLE`, `impl/src/wake-stream.mjs` |
| refusal codes (`swarm_claim_conflict`, `swarm_claim_not_found`) | the `refuse`/`integrity` sites in `swarm-state.mjs` named in §2 |

## 11. Migration: every existing record keeps its meaning

- `swarm.claim_updated` is a new kind; no existing log contains a row of it.
- `workspaceId` on a claim comes from the claimant's own recorded checkout; a claim row written
  before this design carries no such field and folds as it was recorded.

- `docs/36` §7.4 is generated: the implementing lane regenerates it
  (`node impl/scripts/render-surface-docs.mjs`) in the same change, so the grammar's swarm family
  never disagrees with the contract.

## 12. Open questions

1. **compare-389's primary notes were not readable from this seat** — this deployment's bridge
   token is scoped to `swarm-wave6-20260918`, and cross-swarm evidence search returned nothing.
   This design pins the frictions the issue transcription names (self-organization by message,
   mis-attributed WIP) to the mechanisms above (claims, and the attribution behind peers-now).
2. **Unclaimed-path authorship on a shared checkout needs a cadence decision this design
   deliberately does not make**: attributing the union changed-set's unclaimed remainder to the
   seat whose turn wrote it requires snapshotting the shared tree at each seat's turn boundary.
   v1 reports unclaimed paths as unclaimed (§5); whether the runtime should take that snapshot
   (and where the rows live) is open.


## 13. Seam map

| seam | file · function | what extends |
| claim fold | `impl/src/swarm-state.mjs` · `validateSwarmEvent`, `foldSwarmEvent`, `emptySwarm` | the `claims` collection, the conflict rule, §2 refusals |
| public kind set, changed-row addressing | `impl/src/swarm-contract.mjs` · `SWARM_EVENT_KINDS`, `swarmChangedRow` | the new kind; `claims` addressing |
| payload shape descriptions | `impl/src/swarm-event-schemas.mjs` · `SWARM_EVENT_PAYLOAD_SCHEMAS` | the new kind |
| permissions, view, attention, brief | `impl/src/swarm-runtime.mjs` · `UPDATE_PERMISSIONS`, `_updatePermission`, the view's claim rows and attention derivation, `_composeRecruitBrief`, `worktreeChangedPaths` (the overlap seam) | §2.2 rules, §2/§5 projections and rows, §6 brief section |
| wake classes | `impl/src/wake-stream.mjs` · `WAKE_CLASS_TABLE` | `assigned` gains `swarm.claim_updated` |
