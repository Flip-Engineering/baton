# Baton's laws in Bend2 — issue #539, mandate part 3. DRAFT for the operator approval loop.
#
# STATUS OF THIS DRAFT: it carries NO runtime laws. No candidate has been approved yet; per the
# mandate's approval clause only approved rows enter this file, each carrying the operator's
# decision. The candidates themselves — kind, statement, plain explanation, trace — are in
# docs/bend2/laws-proposed.md (landed on bend2-rewrite). Part I below carries the seven
# development laws, marked `status: for approval`. Part II is the runtime section and is empty
# by design; rows are added there one at a time as decisions arrive, in the form:
#
#   RUNTIME LAW <id> <name> · status: approved (decision: <yes/amended>, relayed <seq>)
#
# Every law also names its PROOF METHOD, the way the Bend2 type system or checker discharges it:
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

# Shared vocabulary: the seven-value authority set a grant names. Defined here because DEV-6's
# grant uses it; the runtime law that freezes it enters Part II when approved.
type Permission is Data:
  Read{}
  Communicate{}
  Contribute{}
  Review{}
  Organize{}
  Recruit{}
  Stop{}

# ─────────────────────────────────────────────────────────────────────────────
# Part I — the development laws (all: status: for approval)
# ─────────────────────────────────────────────────────────────────────────────

# DEVELOPMENT LAW DEV-1 no-cutoff · status: for approval — no deadline, queue wait, size, count
# or buffer limit stops an agent control flow or an input; a bound derived from a physical
# resource carries its derivation.
# Encoding: the Admission type has no timeout variant, so a cutoff on the wait is
# unrepresentable in it; Shortfall names the dimension an operator can act on, with its observed
# and required numbers.
# Source: operator ruling on #541, commit bc2e4fcd; docs/bend2/MANDATE.md §3.
# Proof method: type-level plus the law-proof below.
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

# DEVELOPMENT LAW DEV-2 receipt-at-once · status: for approval — a verb records a durable intent
# and answers its receipt at once; never a synchronous wait.
# Encoding: the closed Receipt shape is all a verb answers; no constructor means "still waiting".
# Source: operator rulings on #529 (commits 30cdb282, 84357e4b) and #543 (commit 25856479);
#         docs/54-native-wake.md:1-27.
# Proof method: type-level.
type Receipt is Data:
  ReceiptRow{recorded: Nat}

# DEVELOPMENT LAW DEV-3 wake-native · status: for approval — wake is given to a seat at its
# boundary and is always on; it is not a verb a model invokes.
# Encoding: the Command enum is the whole command surface and carries no wake constructor — a
# wake verb is unrepresentable; WakeClass is the delivered vocabulary.
# Source: docs/54-native-wake.md:1-7; operator rulings on #529 and #543;
#         docs/bend2/MANDATE.md §3.
# Proof method: type-level (absence from the closed Command enum).
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

# DEVELOPMENT LAW DEV-4 typed-refusal · status: for approval — every refusal is typed and names
# its rule, its field and its remedy.
# Encoding: the Refusal record has three fields and no default; a refusal missing any of the
# three is unrepresentable.
# Source: docs/bend2/MANDATE.md §3.
# Proof method: type-level.
type Refusal is Data:
  Refused{rule: String, field: String, remedy: String}

# DEVELOPMENT LAW DEV-5 red-first-landing · status: for approval — a contribution lands
# red-first, through review and integrate, never by hand; the target moves only through the gate.
# Encoding: the Landing type reaches Integrated only through an Acceptance value, and the only
# def that builds an Acceptance pattern-matches an accept review row; the compare-and-swap
# fast-forward stays a runtime check the type cannot carry.
# Source: docs/bend2/MANDATE.md "Deliverable form"; CONTRIBUTING.md "The self-hosted development
#         loop" steps 4-5; docs/42-suite-legitimacy.md:112-115; operator rulings on #539
#         (commits 58d0814e, 13b104bc).
# Proof method: type-level over a runtime-residue CAS.
type Participant is Data:
  Seat{name: String}

type ReviewRow is Data:
  Acc{by: Participant}
  Rej{by: Participant}
  Cmt{by: Participant}

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

# DEVELOPMENT LAW DEV-6 whole-scope-seats · status: for approval — orchestration gives a seat
# whole scope and full authority, never a slice of a mandate.
# Encoding: a seat's grant carries its whole declared scope as one value; no type carries a
# slice of another seat's authority.
# Source: docs/bend2/MANDATE.md §3; docs/39-swarm-runtime.md:1175-1178.
# Proof method: claim-open.
type SafePath is Data:
  Path{value: String}

type Scope is Data:
  Whole{paths: +List<SafePath>}

type SeatGrant is Data:
  Grant{who: Participant, permissions: +List<Permission>, scope: Scope}

# DEVELOPMENT LAW DEV-7 plain-technical-english · status: for approval — every prose the project
# writes is plain technical English: no aphorism, no metaphor, no contrast-form description, no
# operational journaling in product-facing prose.
# Source: AGENTS.md at the repository root.
# Proof method: claim-open (a prose property; review-enforced).

# ─────────────────────────────────────────────────────────────────────────────
# Part II — the runtime laws (empty until the operator's decisions arrive)
# ─────────────────────────────────────────────────────────────────────────────

# No runtime law is stated in this draft: the 131 candidates with their kinds, statements,
# plain explanations and traces are docs/bend2/laws-proposed.md on the branch, and the operator
# answers each row. When a decision arrives, its row is added to this part as
#
#   RUNTIME LAW <family>-<n> <name> · status: approved (decision: ..., relayed at <seq>)
#   <statement>
#   Source: <enforcing site at base bc2e4fcd>. Test: <pinning test>.
#   Proof method: <type-level | total-function | law-proof | runtime-residue | claim-open>
#   <encoding>
#
# with the encoding prepared in the lane's staged draft. Rows the operator rejects or amends are
# recorded in docs/bend2/laws-trace.md, never silently dropped.
