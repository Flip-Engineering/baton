# Baton's laws in Bend2 — issue #539, mandate part 3.
#
# Every law below carries ONE of two kinds, named in its header comment:
#
#   RUNTIME LAW       an invariant the current JavaScript implementation enforces.
#                     Each names the source that enforces it and the test that pins it,
#                     at base bc2e4fcd (impl/src is frozen for this issue).
#   DEVELOPMENT LAW   a rule Baton is built under, extracted from AGENTS.md, CONTRIBUTING.md,
#                     docs/, and the operator rulings on issues #529, #541, #543 and #539.
#                     Each names the document or ruling it comes from.
#
# Each law also names its PROOF METHOD, the way the Bend2 type system or checker discharges it:
#
#   type-level        the law's violation is unrepresentable: no term of the type can carry it.
#   total-function    the law is a total def over a closed enum; a new case breaks the check.
#   law-proof         stated as a Bend `law` and proven by a def of the same name.
#   runtime-residue   the check needs the world outside the type (git, processes, the ledger);
#                     the type carries the refusal shape, the runtime performs the check.
#   claim-open        stated as an open claim the pin's type system cannot yet prove.
#
# Reference pin: docs/bend2/reference/README.md (bendlang/bend@a4952426, bend 2.0.25).
# Check with: node_modules/.bend/bin/bend docs/bend2/laws.bend --check-only

import Base

# ─────────────────────────────────────────────────────────────────────────────
# Part I — the closed vocabularies (RUNTIME LAW, type-level)
# ─────────────────────────────────────────────────────────────────────────────

# RUNTIME LAW CS-01 event-vocabulary-closed — the public swarm.update event set is frozen at
# thirteen kinds; an unknown kind refuses. A Bend2 port carries the set as this enum, so a kind
# outside it is unrepresentable.
# Source: impl/src/swarm-contract.mjs:10-29 SWARM_EVENT_KINDS; impl/src/swarm-state.mjs:414-417.
# Test: impl/test/swarm-state.test.mjs:92 "unknown kind throws SwarmRefusal";
#       impl/test/issue372-closed-sets-taught.test.mjs:33 "372-a".
# Proof method: type-level.
type SwarmEvent is Data:
  GroupUpdated{}
  WorkUpdated{}
  AssignmentUpdated{}
  CouplingUpdated{}
  ClaimUpdated{}
  ProposalUpdated{}
  HolderReleased{}
  ContextUpdated{}
  ContributionRecorded{}
  ContributionReviewed{}
  PolicyUpdated{}
  ParticipantLeft{}
  Closed{}

# RUNTIME LAW PM-01 permission-set-closed — grants are members of the frozen seven-value set.
# Source: impl/src/swarm-runtime.mjs:1032 SWARM_PERMISSIONS; recruit check :7927-7929.
# Test: impl/test/issue314-mcp-core-surface-red.test.mjs:144 (the refusal arm is unpinned).
# Proof method: type-level.
type Permission is Data:
  Read{}
  Communicate{}
  Contribute{}
  Review{}
  Organize{}
  Recruit{}
  Stop{}

# RUNTIME LAW CS-10 recruit-mode-closed — mode admits exactly {change, read_only}, declared once.
# Source: impl/src/swarm-contract.mjs:123 SWARM_RECRUIT_MODES, :639-642 the field rule.
# Test: impl/test/issue373-read-only-recruit.test.mjs:151 "#373 (c)".
# Proof method: type-level.
type RecruitMode is Data:
  Change{}
  ReadOnly{}

# RUNTIME LAW CS-11 guidance-priority-closed — priority admits exactly {next_boundary, now}.
# Source: impl/src/swarm-contract.mjs:132 SWARM_GUIDANCE_PRIORITIES, :645-648.
# Test: impl/test/issue273-guidance-runtime.test.mjs:168 "273-b".
# Proof method: type-level.
type GuidancePriority is Data:
  NextBoundary{}
  Now{}

# RUNTIME LAW CS-12 fold-lifecycle-enums — work status, assignment status and review decision
# validate against frozen module sets.
# Source: impl/src/swarm-state.mjs:92-94 SWARM_WORK_STATUSES / SWARM_ASSIGNMENT_STATUSES /
#        SWARM_REVIEW_DECISIONS; checks at :510-512, :894-896.
# Test: impl/test/swarm-state.test.mjs:165, :172, :179.
# Proof method: type-level.
type WorkStatus is Data:
  Open{}
  Completed{}
  Cancelled{}

type AssignmentStatus is Data:
  Active{}
  Released{}

type ReviewDecision is Data:
  Accept{}
  Reject{}
  Comment{}

# RUNTIME LAW CS-18 item-status-enum — items[].status admits exactly the frozen triple, reused
# by schema, validator and brief.
# Source: impl/src/contribution-contract.mjs:29 CONTRIBUTION_ITEM_STATUSES, :200-202.
# Test: impl/test/issue310-contribution-contract.test.mjs:164 "(e)".
# Proof method: type-level.
type ItemStatus is Data:
  Delivered{}
  Partial{}
  NotDelivered{}

# A seat identity. Development law DEV-6 (whole scope) rides on this record.
type Participant is Data:
  Seat{name: String}


# RUNTIME LAW WAKE-1 wake-classes-closed — every wake row derives from exactly one entry of one
# closed class table; a second mapping of the same ledger key is a construction error.
# Source: impl/src/wake-stream.mjs:120 WAKE_CLASS_TABLE, :374-397 CLASS_BY_LEDGER_ROW.
# Test: impl/test/wake-stream.test.mjs:100 "the wake-class table derives every class from its own
#       ledger row, and admits nothing else"; :291 "#272".
# Proof method: type-level (the class vocabulary; the one-row-one-class check is runtime-residue).
type WakeClass is Data:
  WakeRecruited{}
  WakeLeft{}
  WakeAssigned{}
  WakeWorkUpdated{}
  WakeCouplingUpdated{}
  WakeContextUpdated{}
  WakeContributionRecorded{}
  WakeContributionIntegrated{}
  WakeReviewed{}
  WakeNote{}
  WakeKnowledge{}
  WakeClosed{}
  WakeRefused{}
  WakeQueued{}
  WakeDead{}
  WakeRerouteProposed{}
  WakeResumeDecisionRequired{}
  WakeIncarnationChanged{}
  WakePaused{}
  WakeAttention{}
  WakeGuidanceDelivered{}
  WakeIntegrated{}
  WakeCheckpoint{}
  WakeCapacityPressure{}
  WakeResidentLifecycle{}

# ─────────────────────────────────────────────────────────────────────────────
# Part II — the derivations (RUNTIME LAW, total-function and law-proof)
# ─────────────────────────────────────────────────────────────────────────────

# RUNTIME LAW PM-03 event-permission-total — every event kind maps to exactly one required
# permission; a kind missing from or extra to the table is a load-time error today and a failed
# check here: adding a SwarmEvent constructor without a case breaks this check.
# Source: impl/src/swarm-runtime.mjs:1034-1056 UPDATE_PERMISSIONS and its load assert.
# Test: none (load-time assert) — extracted-untested; the check here is the pin.
# Proof method: total-function (exhaustive match over the closed enum).

type ReviewState is Data:
  Accepted{}
  Rejected{}
  Unreviewed{}

def event_permission(e: SwarmEvent) -> Permission:
  match e:
    case GroupUpdated{}: Organize{}
    case WorkUpdated{}: Organize{}
    case AssignmentUpdated{}: Organize{}
    case CouplingUpdated{}: Organize{}
    case ClaimUpdated{}: Organize{}
    case ProposalUpdated{}: Organize{}
    case HolderReleased{}: Organize{}
    case ContextUpdated{}: Communicate{}
    case ContributionRecorded{}: Contribute{}
    case ContributionReviewed{}: Review{}
    case PolicyUpdated{}: Organize{}
    case ParticipantLeft{}: Organize{}
    case Closed{}: Organize{}

# RUNTIME LAW PM-04 command-permission-table — each command names its one permission.
# Source: impl/src/swarm-runtime.mjs:1057-1067 COMMAND_PERMISSIONS.
# Test: impl/test/swarm-native-bridge.test.mjs:312 "an implementer cannot make organizer
#       changes; a delegated organizer can".
# Proof method: total-function.
# DEVELOPMENT LAW DEV-3 wake-native (encoding) — this enum is the whole command surface, and no
# constructor delivers wake: a wake is not a verb a model invokes.
type Command is Data:
  ViewCmd{}
  WatchCmd{}
  RecruitCmd{}
  GuideCmd{}
  CaptureCmd{}
  CheckCmd{}
  StopCmd{}
  NotifyCmd{}
  NotificationsCmd{}
  IntegrateCmd{}

def command_permission(c: Command) -> Permission:
  match c:
    case ViewCmd{}: Read{}
    case WatchCmd{}: Read{}
    case RecruitCmd{}: Recruit{}
    case GuideCmd{}: Communicate{}
    case CaptureCmd{}: Contribute{}
    case CheckCmd{}: Review{}
    case StopCmd{}: Stop{}
    case NotifyCmd{}: Communicate{}
    case NotificationsCmd{}: Read{}
    case IntegrateCmd{}: Organize{}

# RUNTIME LAW CL-06 review-state-machine — review state derives once from the append-only review
# list: accepted when the last accept is later than the last reject, rejected when a reject is
# last, unreviewed otherwise; comments settle nothing.
# Source: impl/src/swarm-runtime.mjs:1359-1364 swarmContributionReviewState.
# Test: impl/test/issue433-contributions-projection.test.mjs:92 "433-a".
# Proof method: law-proof (three laws below) over a total-function model.
type ReviewRow is Data:
  Acc{by: Participant}
  Rej{by: Participant}
  Cmt{by: Participant}

def is_accept(+r: ReviewRow) -> Bool:
  match r:
    case Acc{by}: True{}
    case Rej{by}: False{}
    case Cmt{by}: False{}

def is_reject(+r: ReviewRow) -> Bool:
  match r:
    case Acc{by}: False{}
    case Rej{by}: True{}
    case Cmt{by}: False{}

def bump_a_on(i: Nat, a: Nat, +c: Bool) -> Nat:
  match c:
    case True{}: i
    case False{}: a

def bump_r_on(i: Nat, r: Nat, +c: Bool) -> Nat:
  match c:
    case True{}: i
    case False{}: r

def decide_rej(a: Nat, r: Nat, +c: Bool) -> ReviewState:
  match c:
    case True{}: Rejected{}
    case False{}: Unreviewed{}

def decide_gt(a: Nat, +r: Nat, +g: Bool) -> ReviewState:
  match g:
    case True{}: Accepted{}
    case False{}:
      c = (r > 0n : Nat)
      decide_rej(a, r, c)

def decide(+a: Nat, +r: Nat) -> ReviewState:
  g = (a > r : Nat)
  decide_gt(a, r, g)

def walk(xs: List<ReviewRow>, i: Nat, a: Nat, r: Nat) -> ReviewState:
  match xs:
    case Nil{}:
      decide(a, r)
    case Con{+h, t}:
      +i2 = (i + 1n : Nat)
      walk(t, i2, bump_a_on(i2, a, is_accept(h)), bump_r_on(i2, r, is_reject(h)))

def review_state_of(xs: List<ReviewRow>) -> ReviewState:
  walk(xs, 0n, 0n, 0n)

law review_empty_is_unreviewed:
  {review_state_of(Nil{}) == Unreviewed{} : ReviewState}

def review_empty_is_unreviewed():
  {==}

law one_accept_is_accepted:
  {review_state_of([Acc{Seat{"rev"}}]) == Accepted{} : ReviewState}

def one_accept_is_accepted():
  {==}

law later_reject_revokes_accept:
  {review_state_of([Acc{Seat{"a"}}, Rej{Seat{"b"}}]) == Rejected{} : ReviewState}

def later_reject_revokes_accept():
  {==}

law comment_settles_nothing:
  {review_state_of([Cmt{Seat{"c"}}]) == Unreviewed{} : ReviewState}

def comment_settles_nothing():
  {==}

# RUNTIME LAW CAP-2/CAP-3/CAP-5 admission-never-refused — a worker lease holds no slot and is
# admitted at any load; a verify waits in order as a visible queue entry; a memory-tight host
# answers degraded at once. The Admission type carries NO timeout variant: a deadline, a queue
# bound or any other cutoff on the wait is unrepresentable in it.
# Source: impl/src/host-capacity.mjs:249-277 leaseWeight/roomFor, :704-768 acquire;
#        operator ruling issue #541, commit bc2e4fcd.
# Test: impl/test/issue297-issue307-host-capacity.test.mjs:77 "HC-2";
#       impl/test/issue512-suite-admission-refusal.test.mjs:150 "S512-3";
#       impl/test/issue333-suite-verify-lease.test.mjs:77 "S333-1b".
# Proof method: type-level (the Admission shape) and law-proof (worker_admitted_at_any_load).
type LeaseKind is Data:
  Worker{}
  Verify{}

type LeaseToken is Data:
  Token{nonce: Nat, resident: Nat}

type Shortfall is Data:
  ShortfallRow{dimension: String, observed: Nat, required: Nat}

type Admission is Data:
  Admitted{token: LeaseToken}
  Queued{position: Nat, ahead: Nat}
  Degraded{shortfall: Shortfall}

def verify_room_mt(mt: Bool, bf: Bool, +c: Bool) -> Bool:
  match c:
    case True{}: False{}
    case False{}: bf

def verify_room(+mt: Bool, bf: Bool) -> Bool:
  verify_room_mt(mt, bf, mt)

def room_for(k: LeaseKind, mt: Bool, bf: Bool) -> Bool:
  match k:
    case Worker{}: True{}
    case Verify{}: verify_room(mt, bf)

law worker_admitted_at_any_load:
  for mt: Bool
  for bf: Bool
  {room_for(Worker{}, mt, bf) == True{} : Bool}

def worker_admitted_at_any_load(mt, bf):
  {==}

# RUNTIME LAW CAP-13 capacity-floor-derived — the worktree capacity floor is the ledger's estimate
# high-water plus the measured runtime footprint; nothing is chosen.
# Source: impl/src/worktree-capacity.mjs:158-170 deriveWorktreeCapacityFloor.
# Test: impl/test/issue297-issue307-host-capacity.test.mjs:257 "HC-7".
# Proof method: law-proof.
def floor_bytes(estimate: Nat, footprint: Nat) -> Nat:
  (estimate + footprint : Nat)

law floor_is_highwater_plus_footprint:
  for estimate: Nat
  for footprint: Nat
  {floor_bytes(estimate, footprint) == (estimate + footprint : Nat) : Nat}

def floor_is_highwater_plus_footprint(estimate, footprint):
  {==}

# RUNTIME LAW CAP-7/CAP-14 release-identity-exact — a release is identity-exact on the lease
# token (nonce, resident); a token from an earlier reservation releases nothing it does not own,
# and the answer is the typed verdict below.
# Source: impl/src/host-capacity.mjs:773-786 release; impl/src/worktree-capacity.mjs:854-871.
# Test: impl/test/issue297-issue307-host-capacity.test.mjs:129 "HC-3";
#       impl/test/phase59-worktree-capacity-authority.test.mjs:695 "WC12".
# Proof method: type-level (the verdict union) over a runtime-residue comparison.
type ReleaseVerdict is Data:
  ReleaseOk{}
  ReleaseNotOurs{}

def release_mine(t: LeaseToken, h: LeaseToken, +eq: Bool) -> ReleaseVerdict:
  match eq:
    case True{}: ReleaseOk{}
    case False{}: ReleaseNotOurs{}

# RUNTIME LAW LEDG-3 idempotency-key-is-identity — a repeat append under one key returns the
# original event; the answer is one of the two constructors below.
# Source: impl/src/coordination-ledger.mjs:1192-1193 the key replay; :1199 the row.
# Test: impl/test/phase11-coordination-store.test.mjs:36 (the duplicate-key row); :204.
# Proof method: type-level.
type Recorded is Data:
  Appended{event: SwarmEvent}
  Replayed{prior: SwarmEvent}

def append_once(prior: Maybe<SwarmEvent>, e: SwarmEvent) -> Recorded:
  match prior:
    case Some{x}: Replayed{x}
    case None{}: Appended{e}

# RUNTIME LAW WAKE-3/WAKE-5/WAKE-12 wake-page-bounded-and-typed — the cursor is the ledger seq, a
# pull page is bounded and names its remainder through a typed continuation, and a consumer
# further behind than the replay bound receives the typed lagged marker naming how much it lost.
# Source: impl/src/wake-stream.mjs:619 cursorOf, :759-787 pull, :617 DEFAULT_REPLAY_LIMIT,
#        :766-773 the lagged frame.
# Test: impl/test/wake-stream.test.mjs:207 "the cursor resumes from the last seq a consumer saw";
#       impl/test/wake-mcp-consumers.test.mjs:198 "a lagging stream tells the subscriber how much
#       it lost"; impl/test/wake-mcp-consumers.test.mjs:232 "the pull page is bounded".
# Proof method: type-level (the page union carries continuation and lag as constructors).
type WakeFrame is Data:
  Frame{seq: Nat, wake: WakeClass}

type WakePage is Data:
  Page{rows: +List<WakeFrame>, next: Nat}
  Lagged{dropped: Nat, fromSeq: Nat, toSeq: Nat, cursor: Nat}

# RUNTIME LAW CUST-1/CUST-2 custody-holds-and-closing — a handle holds a checkout until its hold
# is released, and a closing checkout takes no new holder: of the five holder statuses, exactly
# four are attachable and stopping is not.
# Source: impl/src/shared-workspace-custody.mjs:19-25 the status tables, :38 holdsWorkspace.
# Test: impl/test/shared-workspace-custody.test.mjs:318 "T3", :489 "T7".
# Proof method: total-function over the closed status enum.
type HolderStatus is Data:
  Pending{}
  Working{}
  Blocked{}
  Stopping{}
  Idle{}

type Attach is Data:
  Attachable{}
  NotAttachable{}

def attachable(s: HolderStatus) -> Attach:
  match s:
    case Pending{}: Attachable{}
    case Working{}: Attachable{}
    case Blocked{}: Attachable{}
    case Stopping{}: NotAttachable{}
    case Idle{}: Attachable{}

law a_closing_checkout_takes_no_new_holder:
  {attachable(Stopping{}) == NotAttachable{} : Attach}

def a_closing_checkout_takes_no_new_holder():
  {==}

# RUNTIME LAW AB-01 scope-dialect — one glob matcher compiles scope patterns over a closed
# operator set: * spans one segment, **/ spans zero or more whole segments, ? spans one
# character, everything else is literal.
# Source: impl/src/path-scope.mjs:5-31 pathScopeRegex.
# Test: impl/test/phase83-context-runtime-red.test.mjs:24 "CR83-0".
# Proof method: type-level (the operator vocabulary; the compilation is runtime-residue).
type GlobPart is Data:
  Literal{text: String}
  OneSegment{}
  AnySegments{}
  OneChar{}

type Glob is Data:
  Glob{parts: +List<GlobPart>}

# RUNTIME LAW CS-14 claim-one-target — a claim names exactly one of workId or paths. The union
# below has no constructor carrying both and none carrying neither: the exactly-one-of rule is
# unrepresentable to violate.
# Source: impl/src/swarm-state.mjs:659-666; validClaimPaths :210-220.
# Test: impl/test/issue423-claims-proposals-state.test.mjs:128.
# Proof method: type-level.
type WorkId is Data:
  Work{key: String}

type SafePath is Data:
  Path{value: String}

type Claim is Data:
  OnWork{work: WorkId}
  OnPaths{paths: +List<SafePath>}

# RUNTIME LAW CL-08 accept-gate (encoding) — a landing integrates a contribution whose last
# settling review is an accept: the Integrated constructor requires an Acceptance value, and the
# only def that builds one pattern-matches an accept row. A landing without an unrevoked accept
# is unrepresentable; the append-only ordering that revokes stays runtime-residue.
# Source: impl/src/swarm-runtime.mjs:7360-7370; swarmContributionReviewState :1359-1364.
# Test: impl/test/issue296-swarm-integrate.test.mjs:295 "296f ... refuses pre-effect", :308.
# Proof method: type-level over a runtime-residue ordering.
type Acceptance is Data:
  AcceptedBy{by: Participant}

type Landing is Data:
  Proposed{}
  InReview{}
  ReviewRejected{}
  Integrated{accept: Acceptance}

def accept_of(+r: ReviewRow) -> Maybe<Acceptance>:
  match r:
    case Acc{+by}: Some{AcceptedBy{by}}
    case Rej{by}: None{}
    case Cmt{by}: None{}

# ─────────────────────────────────────────────────────────────────────────────
# Part III — the development laws (DEVELOPMENT LAW)
# ─────────────────────────────────────────────────────────────────────────────

# DEVELOPMENT LAW DEV-1 no-cutoff — no deadline, queue wait, size, count or buffer limit stops an
# agent control flow or an input; a bound derived from a physical resource carries its derivation.
# Encoding: the Admission type above has no timeout variant, and Shortfall names the dimension an
# operator can act on with its observed and required numbers.
# Source: operator ruling on issue #541, commit bc2e4fcd "host admission never refuses for load
#         or for waiting"; docs/bend2/MANDATE.md §3; impl/src/host-capacity.mjs:269-277.
# Proof method: type-level (unrepresentable) plus the law-proof worker_admitted_at_any_load.

# DEVELOPMENT LAW DEV-2 receipt-at-once — a verb records a durable intent and answers its receipt
# at once; the wait, when one exists, is the runtime's own park on the durable row, never a
# synchronous hold of the caller.
# Encoding: the closed Receipt shape below is all a verb answers; no constructor means "still
# waiting".
# Source: operator rulings on issues #529 (commits 30cdb282, 84357e4b) and #543 (commit 25856479,
#         the ask delivered through the park); docs/54-native-wake.md:1-27; WAKE-10.
# Proof method: type-level.
type Receipt is Data:
  ReceiptRow{recorded: Nat}

# DEVELOPMENT LAW DEV-3 wake-native — wake is given to a seat at its boundary and is always on;
# it is not a verb a model invokes.
# Encoding: the Command enum above is the whole command surface and carries no wake constructor;
# WakeClass and WakePage are the delivered vocabulary.
# Source: docs/54-native-wake.md:1-7 "A wake is not a verb"; operator rulings on issues #529
#         (commits 30cdb282, 84357e4b) and #543 (commit 25856479); docs/bend2/MANDATE.md §3.
# Proof method: type-level (absence from the closed Command enum).

# DEVELOPMENT LAW DEV-4 typed-refusal — every refusal is typed and names its rule, its field and
# its remedy.
# Encoding: the Refusal record below has three fields and no default; a refusal missing any of
# the three is unrepresentable. CS-05 and CS-16 are its runtime-law halves.
# Source: docs/bend2/MANDATE.md §3; impl/src/swarm-refusals.mjs:35-186 SWARM_REFUSAL_CODES (one
#         row per code with {status, raisedBy, rule}); impl/src/contribution-contract.mjs:132-136
#         contractRefusal.
# Test: impl/test/issue372-closed-sets-taught.test.mjs:33; impl/test/issue430-swarm-refusal-set.test.mjs:215.
# Proof method: type-level.
type Refusal is Data:
  Refused{rule: String, field: String, remedy: String}

# DEVELOPMENT LAW DEV-5 red-first-landing — a contribution lands red-first, through review and
# integrate, never by hand; the target moves only through the gate.
# Encoding: the Landing type above reaches Integrated only through an Acceptance value, and the
# runtime CAS (integrate_target_moved) is the gate the type cannot carry.
# Source: docs/bend2/MANDATE.md "Deliverable form" (a commit-null body delivers nothing);
#         CONTRIBUTING.md "The self-hosted development loop" steps 4-5; docs/42-suite-legitimacy.md:112
#         (a -red file is a contract pinned before its implementation); operator rulings on #539
#         (commits 58d0814e, 13b104bc).
# Proof method: type-level over a runtime-residue CAS.

# DEVELOPMENT LAW DEV-6 whole-scope-seats — orchestration gives a seat whole scope and full
# authority, never a slice of a mandate.
# Encoding: a seat's grant carries its whole declared scope as one value; no type below carries a
# slice of another seat's authority.
# Source: docs/bend2/MANDATE.md §3; docs/39-swarm-runtime.md:1175-1178 (the situation names every
#         sibling with its whole scope).
# Proof method: claim-open.
type Scope is Data:
  Whole{paths: +List<SafePath>}

type SeatGrant is Data:
  Grant{who: Participant, permissions: +List<Permission>, scope: Scope}

# DEVELOPMENT LAW DEV-7 plain-technical-english — every prose the project writes is plain
# technical English: no aphorism, no metaphor, no contrast-form description, no operational
# journaling in product-facing prose.
# Source: AGENTS.md at the repository root.
# Proof method: claim-open (a prose property; review-enforced).

# RUNTIME LAW CS-16 refusal-vocabulary-one-table (companion to DEV-4) — every code the fold or
# the runtime raises has exactly one row in one frozen table carrying {status, raisedBy, rule};
# an untabled code is a construction-time error, and the web status map derives from the table.
# Source: impl/src/swarm-refusals.mjs:35-186, :203-207.
# Test: impl/test/issue430-swarm-refusal-set.test.mjs:215 "#430 (a)", :258 "#430 (b)".
# Proof method: runtime-residue (a static-scan pin today); the Refusal type is the target shape.

# RUNTIME LAW AB-04 claim-conflict-typed (runtime-residue laws stay runtime laws) — a path claim
# overlapping an active claim on the same recorded checkout refuses swarm_claim_conflict before
# any write, naming holder, claim, paths and workspace; the disjointness scan is a runtime
# invariant over mutable state, so Bend2 keeps it a runtime check with the typed conflict record.
# Source: impl/src/swarm-state.mjs:1072-1083 claimConflictFor, :1889-1899 the fold raise.
# Test: impl/test/issue423-claims-proposals-state.test.mjs:74;
#       impl/test/issue441d-claims-instead-of-handovers.test.mjs:117.
# Proof method: runtime-residue.
type Conflict is Data:
  ConflictRow{holder: Participant, claim: WorkId, paths: +List<SafePath>}

# RUNTIME LAW CUST-5 preservation-by-retention — no caller option, force included, authorizes
# destroying un-captured content; retention is the preservation mechanism; the only content a
# removal boundary destroys without a capture is infrastructure the owner metadata attests as
# runtime-materialized.
# Source: impl/src/worktree.mjs:1170-1199 the boundary comment and attestedInfrastructureRoots.
# Test: impl/test/workspace-preservation.test.mjs:234 "no caller option is an authorization to
#       destroy un-captured content"; :311 "attested runtime infrastructure is generated".
# Proof method: claim-open (an absence claim about every caller option).
