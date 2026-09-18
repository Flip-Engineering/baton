# Open coordination: joint couplings, claims, and peers-now (issues #422, #423, #374)

Design direction: 2026-09-18, design seat kimi-design. Stage: `design-not-landed` — this
document is pinned red-before by `impl/test/issue422-joint-couplings.test.mjs` and
`impl/test/issue423-claims-and-peers.test.mjs`; every row there asserts behaviour specified
here against the current runtime and fails until the implementation lands. This document changes
no shipped behaviour. The migration note (§11) is the contract that existing records keep their
meaning.

## Purpose

The coupling primitives are role-shaped: one writer, one barrier, a lead who declares them. Every
tight team the root composes becomes a scripted role assignment, and a group of equal peers
handed a task and one shared checkout has no runtime support for splitting the work. On
compare-389 (2026-09-18) three equal-grant seats self-organised through twelve `swarm.guide`
messages, three shared-context notes, three knowledge nodes and one writer coupling; the runtime
never enforced the writer coupling (#425), a test-file overwrite was resolved by hand, and a seat
twice mis-attributed a peer's work in progress because the swarm records nothing about who holds
which paths.

The owed capabilities, and the three frictions they answer:

1. **Joint couplings** (#422) — a writer coupling a group holds as a rotating lease any member
   may take and yield; a synchronization point any member may declare, released by quorum or by
   the last arrival; a coupling any member with `communicate` may PROPOSE, which becomes declared
   when the members it names arrive at it (arrival is consent).
2. **Claims, proposals, and peers-now** (#423) — a `claim` on a work item or a path set any
   `contribute` seat may take; a work-splitting proposal peers accept by arriving; a live "peers
   now" section in the brief; per-seat changed-path attribution on shared checkouts raising a
   `shared_checkout_overlap` attention row before commit.
3. **A derived loose/tight reading of a group** (#374) — never declared, never global: the view
   answers which declared rows make a group tight.

## 0. Rules that do not change

These rules from [docs/39](39-swarm-runtime.md) bind every mechanism below; the design extends
them, never exceptions them:

- **Coupling is declared and kept honest, never imposed.** Records INFORM rather than fence.
  Nothing here stops a worker's process; a seat that proceeds against a claim or an unsettled
  proposal does so visibly. Enforcement over commits is #425's seam (§4.4); this design changes
  no process behaviour.
- **Who acted is a fact of every record, never a caller-named seat.** `releasedBy`, holders and
  consenting arrivers carry the actor the runtime derived; a caller-named identity that is not
  the actor refuses.
- **One owner per closed set** (§10). No second tables.
- **Replay is byte-identical.** New fields are absent on old rows; new admission rules run under
  the fold's `admission` flag (the #304 pattern) and never refuse recorded history.
- **No clock decides a hold's fate** (#163). Claims and lease holds have no TTL and no expiry;
  a gone holder is settled by an explicit act the attention row names.
- **Self-reports are cheap; acting on others is not.** A seat's own arrival, consent, claim,
  take and yield ride its own authority; naming another seat stays an organizing act, with the
  one liveness exception §4.2 names.

## 1. The event vocabulary

Two kinds change, two kinds are added. The public caller-submittable set lives in
`SWARM_EVENT_KINDS` (`impl/src/swarm-contract.mjs`); the recorded fold set lives in
`impl/src/swarm-state.mjs`; the load-time assertions that keep the contract, the payload schemas
and the permission table in agreement are the existing ones, so a kind added in one place and
not the others fails at load, never silently.

| Kind | Status | Permission (self / other) | Folds into | Wake class |
|---|---|---|---|---|
| `swarm.coupling_updated` | **changed**: actions extend to `declare \| propose \| arrive \| take \| yield \| release`; writer declares over `participantId` (exclusive, as today) XOR `groupId` (rotating lease); synchronization accepts `quorum` | see §4 per action | `couplings` | `coupling_updated` (unchanged) |
| `swarm.claim_updated` | **new** | `contribute` (own) / `organize` (naming another) | `claims` | `assigned` |
| `swarm.proposal_updated` | **new** | `contribute` (propose) / `read` (own consent) / proposer-or-`organize` (release) | `proposals`; on acceptance the runtime expands the plan's `swarm.work_updated` + `swarm.claim_updated` rows | `work_updated` |

A claim reuses `SWARM_ASSIGNMENT_STATUSES` (`active | released`) — the lifecycle vocabulary is
one axis (docs/36 L4) and a claim is an assignment-shaped hold with self-authority — so no new
status set exists. Proposal actions are `propose | arrive | release`, owned as
`SWARM_PROPOSAL_ACTIONS` in `swarm-state.mjs`; the shared verb spellings with coupling actions
are deliberate (one name per concept, docs/36 L6).

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
intersection rule groups and couplings already use.

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

## 3. `swarm.proposal_updated` — a work split accepted by arriving (#423)

A proposal is how a group of equals splits work without a lead: one seat writes the split down,
the named seats accept by arriving at it, and arrival is consent.

**Payload** (closed): `proposalId` (required); `action: propose | arrive | release`; `members`
(required on `propose`: the consent set — distinct, active participants); `plan` (required on
`propose`): `{work: [{workId, objective}], claims: [{participantId, workId | paths}]}`;
`expectedVersion`; `reason` (on release).

**Fold** (new `proposals` collection): a proposal record carries
`{proposalId, members, plan, consents, proposed: true, actor, seq, ts}`. The proposer consents by
proposing — `consents` starts with the proposer's seat. `arrive` by a named member is consent
(own consent rides `read` authority, the same honest-self-report rule as a synchronization
arrival); consent by a seat the proposal did not name refuses `swarm_not_a_member`; a second
consent refuses `swarm_already_arrived`. Re-proposing the same `proposalId` replaces the plan and
CARRIES the consents forward, naming them in `carriedConsents` — the `carriedArrivals` rule, so
an amendment never wipes consent silently. `release` withdraws the proposal (the proposer, or an
organizer); a withdrawn proposal never expands.

**Acceptance is an expansion, never a side effect.** When the last outstanding member's consent
lands, the runtime writes the plan's rows itself — one `swarm.work_updated` per `plan.work`
entry, one `swarm.claim_updated` per `plan.claims` entry with `claimId` minted deterministically
as `${proposalId}-claim-${index}` — the way `swarm.holder_released` expands into the events it
names (`_holderRelease`, swarm-runtime.mjs), so replay folds exactly the rows a hand-written
sequence would have produced. The expansion trial-folds every row before writing any: a
`plan.work` entry naming existing work refuses the whole acceptance with `swarm_work_exists`
`{field: 'plan.work', workId}` and records nothing; a `plan.claims` entry that would conflict
under §2 refuses the whole acceptance with `swarm_claim_conflict`. Claims the acceptance mints
name consenting members as holders — lawful because arrival consented to THIS plan, which named
those claims. Assignments are never minted: binding a seat to work stays `organize`.

**View**: `proposals` is an array of rows `{proposalId, members, consents, outstanding, proposed,
plan, released}`. A scoped view follows the named members by roster intersection. A proposal
awaiting consent raises NO attention row — consent is ordinary work visible on the view, not a
page.

## 4. Joint couplings (#422): the changed `swarm.coupling_updated`

`SWARM_COUPLING_ACTIONS` extends to `declare | propose | arrive | take | yield | release`
(owner: `swarm-state.mjs`; `take` and `yield` are meaningless on records written before this
design and never appear in old logs).

### 4.1. The rotating writer lease

A writer coupling declared with `groupId` instead of `participantId` is a **lease**: the group
holds the write turn over its members' shared checkout, and any member may take it and yield it.
The record is `{couplingId, coupling: 'writer', groupId, members, holder, holds, released, ...}`:

- `members` snapshots the declared roster (the synchronization record's rule: seats that later
  leave stay named on the record); eligibility to take reads the group's CURRENT live roster.
- `holds` is the hold history: `{participantId, actor, seq, ts, yieldedBy, yieldReason}` per hold.
  `holder` is the live hold's seat, `null` when the lease is unheld.
- **Checkout coverage**: the lease covers the recorded checkouts of the group's current members.
  Declaring a lease over a group whose members hold no recorded checkout refuses
  `swarm_writer_workspace_unrecorded` (the existing code — a claim that names no resource can
  never enforce exclusivity, so it is refused rather than recorded inert). Declaring a lease, or
  an exclusive writer record, whose covered checkout an unreleased writer record already covers
  refuses `swarm_writer_conflict`, naming the existing record. Exclusivity is per checkout across
  BOTH record families — the one-writer guarantee cannot depend on which spelling declared it.
- `take` (a group member, `contribute`, self): the fold admits when `holder` is null or names a
  participant whose membership has ended; otherwise it refuses `swarm_writer_lease_held` naming
  the holder. Naming another seat stays `organize`.
- `yield` (the holder, `contribute`): names the hold it ends — the payload's `participantId` must
  BE the current holder. Yielding an unheld lease refuses `swarm_writer_lease_unheld`; yielding
  another seat's hold refuses `swarm_writer_lease_held` naming the holder — except at the runtime
  layer, where a group member may yield a hold whose holder's RUNTIME is dead (liveness is a
  runtime fact the pure fold never reads; §0's self-report rule keeps the live case honest).
- `release` ends the record, as today: `organize`, `releasedBy` derived from the actor.

A live handoff is the common case: holder yields, next member takes — no lead, no organizer. A
dead holder never auto-releases: the existing `coupling_writer_gone` attention row extends to
leases, naming the lease, the holder and the remedy — `swarm.holder_released` (which now also
yields the gone holder's holds, one more row family in its existing batch) or a member's
liveness-admitted `yield` followed by `take`.

### 4.2. Liveness and the fold

The fold reads membership, never runtime liveness (the fold replays history; liveness is now).
Every liveness-dependent admission — yielding a dead holder's hold — is checked by the runtime
against `swarmParticipantLiveness` BEFORE the write, and the recorded rows are ordinary
`swarm.coupling_updated` rows that replay without the check. This is the existing
admission-vs-replay split (the #304 flag), applied to a new rule.

### 4.3. Quorum synchronization points

A synchronization declare or proposal accepts `quorum`: a positive integer, or absent — absent
means today's rule exactly (every current live member). The view derives:

- `satisfied`: the number of distinct live members arrived is at least `min(quorum ?? ∞, live
  members)`, and at least one arrival exists — so a roster shrunk below quorum by departures is
  released by its LAST arrival, and a quorum of the full roster is released by the quorum-th
  arrival. "Released by quorum or by the last arrival" is one derivation, not two rules.
- The arrival that satisfies the point RELEASES it in the same fold: `released: true`,
  `releasedBy` = the arriving seat, `releaseReason` = `quorum reached`. A barrier the group
  declared for itself never waits on a lead to notice it completed.
- `awaiting`, `departed`, `arrived` keep today's meanings; a departed seat never holds a point
  open, with or without a quorum.

Re-declaring keeps the `carriedArrivals` rule (a barrier is never wiped silently).

### 4.4. What a non-holder's commit does (#425's seam)

This design changes no process behaviour. Today a writer record informs through the view and the
`coupling_writer_gone` row; #425 is the issue that owns enforcement. What this design owes #425
is ONE place to read: the checkout's write turn is the exclusive-writer record's `writer`, or the
lease record's current `holder`, full stop — both projected on the view's coupling rows with the
checkout they cover. When #425 lands enforcement, a commit or capture observed from a non-holder
on a covered checkout refuses or flags naming the record and the holder; until then the lease
informs exactly as today's writer record informs.


**Scope rule (#447, 2026-09-18).** The projected wrapper spools an observation only for a commit whose repository is the checkout recorded on the seat's lease (the coordinator records that identity when it confirms the checkout, and again at resume/attach); a commit in any other repository — a test fixture's temporary repository under the checkout, a nested clone, a worktree the seat made by hand — is spooled by nobody and refused by nobody: the wrapper stays transparent to git. A lease with no recorded checkout keeps the #425 attribution. Root-side, the commit-observation drain skips an observation naming a swarm the deployment does not hold. Before this rule a seat running the issue425/issue438 fixtures wrote ~120 bogus `worktree.commit_recorded` rows a minute under its own identity.

### 4.5. Coupling proposals (arrival is consent)

Any member with `communicate` may `propose` a coupling: the payload names the coupling
parameters and `members`, the consent set (distinct, active participants). The record carries
`proposed: true` and `consents`; the proposer consents by proposing. `arrive` by a named member
is consent (own, `read`). When the named members have all consented, the fold flips
`proposed: false` and the record is DECLARED — for a lease, `holder: null` and the consent set
becomes the member roster; for a synchronization point, arrivals start EMPTY (consent to the
point's existence is not arrival at the point; the `consents` and `arrivals` sets are distinct).
A failure policy is never proposed — it names what happens when OTHER members die, which is not
theirs to consent to; `propose` with `coupling: 'failure'` refuses `invalid_payload`, and failure
policies stay `organize`-declared as today.

Re-proposing the same `couplingId` replaces the parameters and carries the consents forward as
`carriedConsents`. The proposer (or an organizer) may `release` a proposal to withdraw it.
Proposals project on the view with `proposed: true`, `consents`, `outstanding`; the brief renders
them (§8) so a named seat learns that its arrival IS its consent.

### 4.6. Permission derivation

`_updatePermission` (swarm-runtime.mjs) — the ONE derivation the dispatch check and the view's
`updates` rows share — gains these rules; the table below is the whole delta:

| request | caller | permission |
|---|---|---|
| coupling `declare` of `synchronization` or a writer lease over a group the caller is ON | member | `communicate` |
| coupling `declare` of an exclusive writer, a failure policy, or anything over a group the caller is not on | member | `organize` (unchanged) |
| coupling `propose` | member | `communicate` |
| coupling `arrive` (arrival or consent), own | member | `read` (unchanged rule) |
| coupling `take` / `yield`, own | member of the lease group | `contribute` |
| coupling `yield` of a member whose runtime is dead | member of the lease group | `contribute` (runtime liveness check, §4.2) |
| coupling `take` / `yield` naming another live seat, `release` | member | `organize` (unchanged) |
| `swarm.claim_updated`, own claim | member | `contribute` |
| `swarm.claim_updated` naming another seat, or another's release/handoff | member | `organize` |
| `swarm.proposal_updated` `propose` | member | `contribute` |
| `swarm.proposal_updated` `arrive` (own consent) | member | `read` |
| `swarm.proposal_updated` `release` | proposer | `contribute`; any other seat: `organize` |

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

## 7. Loose and tight, derived per group (#374)

A group's tightness is DERIVED, never declared, and never global: one function
(`groupCoordination`, swarm-runtime.mjs) answers it per group per view, and the swarm row carries
no mode field. A group reads `coordination: 'tight'` when any of these holds, with
`tightBecause` naming the rows that make it so:

- an unreleased DECLARED coupling names the group — a synchronization point, a writer lease, a
  failure policy (a proposed-but-unconsented coupling does NOT tighten: consent is still
  outstanding, and a group must be able to see a proposal without inheriting its obligations);
- an exclusive-writer record names a member of the group;
- work actively held within the group (assignment or claim) declares a `dependsOn` edge to work
  held within the same group.

Otherwise the group reads `coordination: 'loose'`. The enum (`loose | tight`) is owned by that
one derivation; the view's group rows carry it; the brief's coupling lines (§8) state it. This
is the design's answer to #374: tightness follows the declared records the members actually made,
and a group with none is loose however many peers it has.

## 8. What the view and the brief render

| surface | new rendering |
|---|---|
| view `couplings` rows | lease rows carry `holder`, `holds`, `groupId`, `members`; synchronization rows carry `quorum`, `satisfied`; proposal rows carry `proposed`, `consents`, `outstanding`; exclusive-writer rows project `holder` = `writer` (one field name for "whose turn", however declared) |
| view `claims` / `proposals` | new array collections (§2, §3) |
| view group rows | `coordination`, `tightBecause` (§7) |
| view `attention` | `claim_holder_gone` (§2.1), `shared_checkout_overlap` (§5); `coupling_writer_gone` extends to leases (§4.1) |
| view `updates` | the new kinds and actions appear exactly when this caller's permissions admit them (the §4.6 derivation) |
| brief | "Peers now" (§6); a "Couplings" situation block naming each declared or proposed coupling that touches the seat's groups — its kind, name, holder or outstanding consents — so the group's current couplings and who holds what are read from the brief, not retyped |
| `swarm.watch` | `swarm.claim_updated` rides the `assigned` wake class, `swarm.proposal_updated` rides `work_updated` (WAKE_CLASS_TABLE, wake-stream.mjs) — no new wake vocabulary |

## 9. What stays OUT

- **No global mode.** Tightness is per-group and derived (§7); there is no swarm-wide flag and
  no declared mode field anywhere.
- **No lead requirement.** Every new verb is exercisable by the members it names; `organize` is
  required only to act on OTHERS, as today. A group of equal-grant peers can declare, take,
  yield, claim, propose and consent end to end.
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
| `SWARM_COUPLINGS`, `SWARM_COUPLING_ACTIONS`, `SWARM_FAILURE_POLICIES`, `SWARM_PROPOSAL_ACTIONS` | `impl/src/swarm-state.mjs` (the fold's tables) |
| public `SWARM_EVENT_KINDS` / store fold kind set | `impl/src/swarm-contract.mjs` / `impl/src/swarm-state.mjs` — the two existing sets, kept in agreement by the existing load-time assertions |
| payload shapes (`SWARM_EVENT_PAYLOAD_SCHEMAS`) | `impl/src/swarm-event-schemas.mjs` |
| per-kind and per-action permissions (`UPDATE_PERMISSIONS`, `_updatePermission`) | `impl/src/swarm-runtime.mjs` |
| claim statuses | `SWARM_ASSIGNMENT_STATUSES` (reused — no new set) |
| `coordination` enum (`loose \| tight`) | the `groupCoordination` derivation, `impl/src/swarm-runtime.mjs` — derived, never stored |
| attention kinds (`claim_holder_gone`, `shared_checkout_overlap`) | the runtime's row-minting sites; enumerated by the generated block (docs/36 §7.4) |
| wake classes | `WAKE_CLASS_TABLE`, `impl/src/wake-stream.mjs` |
| refusal codes (`swarm_claim_conflict`, `swarm_writer_lease_held`, `swarm_writer_lease_unheld`, `swarm_work_exists`) | the `refuse`/`integrity` sites in `swarm-state.mjs` and `swarm-runtime.mjs` named in §2–§4 |

## 11. Migration: every existing record keeps its meaning

- An exclusive writer record declared with `participantId` is unchanged: one writer per checkout,
  the same `swarm_writer_conflict` guard, the same `coupling_writer_gone` row. The view's new
  `holder` field on such a row projects `writer`; the stored row is untouched.
- A synchronization point declared without `quorum` releases exactly as today (explicit release;
  `arrived` derived over live members). `quorum` absent IS the old rule, not a default value
  written onto old rows.
- `declare` / `arrive` / `release` payloads written before this design fold byte-identically:
  `propose`/`take`/`yield` never appear in old logs, the new record fields are absent on old
  rows, and the new admission rules (claim conflict, lease coverage, quorum shape) run under the
  fold's `admission` flag only (#304), so a resident never refuses its own recorded history at
  startup.
- `swarm.claim_updated` and `swarm.proposal_updated` are new kinds; no existing log contains
  them. The load-time agreement assertions (contract ↔ schemas ↔ permissions) fail loudly on a
  partial landing, which is the intended tripwire, not a migration hazard.
- `docs/36` §7.4 is generated: the implementing lane regenerates it
  (`node impl/scripts/surface-gate.mjs --write`) in the same change, so the grammar's swarm
  family never disagrees with the contract.

## 12. Open questions

1. **compare-389's primary notes were not readable from this seat** — this deployment's bridge
   token is scoped to `swarm-wave6-20260918`, and cross-swarm evidence search returned nothing.
   This design pins the three frictions the issue transcription names (self-organization by
   message, unenforced writer coupling, mis-attributed WIP) to the three mechanisms above
   (proposals + claims, lease + §4.4 seam, attribution + peers-now). Before implementation, a
   reader with ledger access should confirm the mapping against open-glm / open-ds / open-muse's
   own contributions.
2. **Unclaimed-path authorship on a shared checkout needs a cadence decision this design
   deliberately does not make**: attributing the union changed-set's unclaimed remainder to the
   seat whose turn wrote it requires snapshotting the shared tree at each seat's turn boundary.
   v1 reports unclaimed paths as unclaimed (§5); whether the runtime should take that snapshot
   (and where the rows live) is open.
3. **Proposal acceptance mints claims but never assignments** (§3): whether an accepted proposal
   should also bind seats to the work it creates is an `organize`-authority question v1 leaves
   to the organizer — a peer group self-splits into claims, and binding stays the root's act.

## 13. Seam map

| seam | file · function | what extends |
|---|---|---|
| coupling action set, claim/proposal folds | `impl/src/swarm-state.mjs` · `SWARM_COUPLING_ACTIONS`, `validateSwarmEvent`, `foldSwarmEvent`, `emptySwarm` | new actions, `claims` and `proposals` collections, lease/quorum/consent fold arms, §2/§4 refusals |
| public kind set, changed-row addressing | `impl/src/swarm-contract.mjs` · `SWARM_EVENT_KINDS`, `swarmChangedRow` | two new kinds; `claims`/`proposals` addressing |
| payload shape descriptions | `impl/src/swarm-event-schemas.mjs` · `SWARM_EVENT_PAYLOAD_SCHEMAS` | the two new kinds; coupling's new fields |
| permissions, view, attention, brief | `impl/src/swarm-runtime.mjs` · `UPDATE_PERMISSIONS`, `_updatePermission`, the view's `couplingEntries`/group rows/attention derivation, `_composeRecruitBrief`, `_holderRelease` (the expansion pattern acceptance reuses), `worktreeChangedPaths` (the overlap seam) | §4.6 rules, §2/§3/§5 projections and rows, §6/§8 brief sections |
| wake classes | `impl/src/wake-stream.mjs` · `WAKE_CLASS_TABLE` | `assigned` gains `swarm.claim_updated`; `work_updated` gains `swarm.proposal_updated` |
| grammar surface | `docs/36-unified-control-grammar.md` §7.4 via `impl/scripts/render-surface-docs.mjs` + `surface-gate.mjs --write` | regenerated block: kinds, permissions, attention kinds |
| expected-red manifest | `impl/scripts/expected-red-tests.json` | the red pins' rows listed with reasons `#422` / `#423` — **outside the design lane's path scope**; listing them (or one `--write-expected-red --expected-red-reason` full-suite run) is the implementing lane's first act (docs/44 rule 5) |
