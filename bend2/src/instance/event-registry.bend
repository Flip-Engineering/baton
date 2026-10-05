import Base

# Instance-owned retained event-destination registry: the pure lifecycle
# decisions and the retained keyed table operations for owner event
# destinations, registrations, task/event references and safe disposal, per
# the shared-owner design in docs/bend2/shared-owner-task-custody-design.md.
# This module performs no IO and holds no host synchronization: Controls
# owns the file effects, reader serialization and the shared event
# synchronization. The table value in `retained-table.bend` is the retained
# keyed state; the hosted owner loop threads it while holding the
# appropriate short critical section. A registration record is bookkeeping
# state, never an event implementation by itself; none of these decisions
# grants a host read, a start or owner replacement.
#
# Hosted-loop duties around these decisions: revision validation binds to
# the serialized read — the observation passed to register_ready must come
# from the same locked observation as the reader call, and slow IO or
# conversion stays outside the instance-wide event mutex. When a retained
# failure task adopts an offered allocation, the latched reader fault and
# the original task and correlation responsibility transfer with it, and
# exactly one allocation owner exists; pointer borrowing grants no
# reference. Reader-local serial exhaustion is a permanent refusal for that
# capability incarnation, retained with its responsible task, with no serial
# reset or reuse; ENOMEM stays retryable with the partial buffer preserved.
# Offer disposal refuses while an allocation is pending (EBUSY) and then
# forwards the source disposal result with its retained cleanup outcomes;
# qualified disposal is the registry's own decision plus the Controls lease
# release, and a successful ACK determines raw-byte availability only
# together with the cleanup outcome.
#
# Adoption tokens carry an immutable occurrence number drawn from the
# registration's monotonically increasing adoption count, its capability
# generation, and the full destination correlation. Validation against the
# current registration refuses any earlier occurrence, so a re-adoption
# cannot be consumed by a stale token copy. The count is a U32 and wraps
# only after 2^32 adoptions of one registration; the hosted table must
# retire or re-epoch a registration before that bound. The pure token is
# still not uniqueness by itself: the hosted table validates the token's
# live phase under synchronization.

# Capability identity is separate from the readiness state it observes: the
# generation names the capability incarnation, and the separately owned
# readiness revision changes on append, finality, error and
# registration-relevant state changes.
type Generation is Data:
  Generation{owner: String, capability: String, revision: U32}

# One retained event destination. The correlation is the full
# database/owner/request/session identity; the destination outlives the
# client connection that submitted the wake, and post-ACK notice and
# settlement duties keep it without any reader lease.
type Destination is Data:
  Destination{database: String, owner: String, request: String, session: String, references: U32, tasks: U32}

# One registration bound to its destination correlation. `adoptions` counts
# every issued task-event token and gives each one a distinct occurrence
# number.
type Registration is Data:
  Registration{identity: String, generation: Generation, database: String, owner: String, request: String, session: String, adoptions: U32, references: U32, armed: Bool, event_retained: Bool, cancelled: Bool}

type DestinationLease is Data:
  DestinationLease{destination: Destination, live: Bool}

type EventPhase is Data:
  AdoptedOutstanding{}
  ReturnedToRegistration{}
  CompletedToRegistration{}

# The adopted responsibility for one readiness event: the registration
# identity and occurrence, its capability generation, the full destination
# correlation it was adopted against, and the phase.
type TaskEvent is Data:
  TaskEvent{identity: String, occurrence: U32, generation: Generation, database: String, owner: String, request: String, session: String, phase: EventPhase}

type Resolution is Data:
  Retained{lease: DestinationLease}
  AtCapacity{retained: DestinationLease}
  Created{retained: DestinationLease, fresh: DestinationLease}

type Acceptance is Data:
  Adopted{registration: Registration, destination: Destination, outstanding: TaskEvent}
  Refused{registration: Registration, destination: Destination}

type Requeue is Data:
  Requeued{registration: Registration, destination: Destination, returned: TaskEvent}
  Unowned{registration: Registration, destination: Destination, outstanding: TaskEvent}

type Completion is Data:
  Completed{registration: Registration, destination: Destination, returned: TaskEvent}
  Unowned{registration: Registration, destination: Destination, outstanding: TaskEvent}

type RegistrationRelease is Data:
  Released{registration: Registration}
  AlreadyReleased{registration: Registration}

type LeaseRelease is Data:
  LeaseReleased{lease: DestinationLease}
  LeaseAlreadyReleased{lease: DestinationLease}

def dest_of(lease: DestinationLease) -> Destination:
  match lease:
    case DestinationLease{destination,live}: destination

def dest_live_of(lease: DestinationLease) -> Bool:
  match lease:
    case DestinationLease{destination,live}: live

def dest_database_of(destination: Destination) -> String:
  match destination:
    case Destination{database,owner,request,session,references,tasks}: database

def dest_owner_of(destination: Destination) -> String:
  match destination:
    case Destination{database,owner,request,session,references,tasks}: owner

def dest_request_of(destination: Destination) -> String:
  match destination:
    case Destination{database,owner,request,session,references,tasks}: request

def dest_session_of(destination: Destination) -> String:
  match destination:
    case Destination{database,owner,request,session,references,tasks}: session

def dest_references_of(destination: Destination) -> U32:
  match destination:
    case Destination{database,owner,request,session,references,tasks}: references

def dest_tasks_of(destination: Destination) -> U32:
  match destination:
    case Destination{database,owner,request,session,references,tasks}: tasks

def reg_identity_of(registration: Registration) -> String:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: identity

def reg_generation_of(registration: Registration) -> Generation:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: generation

def reg_database_of(registration: Registration) -> String:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: database

def reg_owner_of(registration: Registration) -> String:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: owner

def reg_request_of(registration: Registration) -> String:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: request

def reg_session_of(registration: Registration) -> String:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: session

def reg_adoptions_of(registration: Registration) -> U32:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: adoptions

def reg_references_of(registration: Registration) -> U32:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: references

def reg_armed_of(registration: Registration) -> Bool:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: armed

def reg_event_retained_of(registration: Registration) -> Bool:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: event_retained

def reg_cancelled_of(registration: Registration) -> Bool:
  match registration:
    case Registration{identity,generation,database,owner,request,session,adoptions,references,armed,event_retained,cancelled}: cancelled

def gen_owner_of(generation: Generation) -> String:
  match generation:
    case Generation{owner,capability,revision}: owner

def gen_capability_of(generation: Generation) -> String:
  match generation:
    case Generation{owner,capability,revision}: capability

def gen_revision_of(generation: Generation) -> U32:
  match generation:
    case Generation{owner,capability,revision}: revision

def token_identity_of(token: TaskEvent) -> String:
  match token:
    case TaskEvent{identity,occurrence,generation,database,owner,request,session,phase}: identity

def token_occurrence_of(token: TaskEvent) -> U32:
  match token:
    case TaskEvent{identity,occurrence,generation,database,owner,request,session,phase}: occurrence

def token_generation_of(token: TaskEvent) -> Generation:
  match token:
    case TaskEvent{identity,occurrence,generation,database,owner,request,session,phase}: generation

def token_database_of(token: TaskEvent) -> String:
  match token:
    case TaskEvent{identity,occurrence,generation,database,owner,request,session,phase}: database

def token_owner_of(token: TaskEvent) -> String:
  match token:
    case TaskEvent{identity,occurrence,generation,database,owner,request,session,phase}: owner

def token_request_of(token: TaskEvent) -> String:
  match token:
    case TaskEvent{identity,occurrence,generation,database,owner,request,session,phase}: request

def token_session_of(token: TaskEvent) -> String:
  match token:
    case TaskEvent{identity,occurrence,generation,database,owner,request,session,phase}: session

def token_is_adopted(token: TaskEvent) -> Bool:
  match token:
    case TaskEvent{identity,occurrence,generation,database,owner,request,session,phase}:
      match phase:
        case AdoptedOutstanding{}: True{}
        case other: False{}

def correlation_is(+destination: Destination, +database: String, +owner: String, +request: String, +session: String) -> Bool:
  Bool.and(String.eq(dest_database_of(destination),database),Bool.and(String.eq(dest_owner_of(destination),owner),Bool.and(String.eq(dest_request_of(destination),request),String.eq(dest_session_of(destination),session))))

def same_correlation(+a: Destination, +b: Destination) -> Bool:
  correlation_is(a,dest_database_of(b),dest_owner_of(b),dest_request_of(b),dest_session_of(b))

def fresh_destination_lease(+database: String, +owner: String, +request: String, +session: String) -> DestinationLease:
  DestinationLease{Destination{database,owner,request,session,1,0},True{}}

def grown_destination_lease(+lease: DestinationLease) -> DestinationLease:
  DestinationLease{Destination{dest_database_of(dest_of(lease)),dest_owner_of(dest_of(lease)),dest_request_of(dest_of(lease)),dest_session_of(dest_of(lease)),U32.add(dest_references_of(dest_of(lease)),1),dest_tasks_of(dest_of(lease))},True{}}

def resolve_matching(+lease: DestinationLease, +database: String, +owner: String, +request: String, +session: String, capacity: U32, matches: Bool) -> Resolution:
  match matches:
    case True{}: Bool.pick(Resolution,U32.is_lt(dest_references_of(dest_of(lease)),capacity),Retained{grown_destination_lease(lease)},AtCapacity{lease})
    case other: Created{lease,fresh_destination_lease(database,owner,request,session)}

def resolve_live(+lease: DestinationLease, +database: String, +owner: String, +request: String, +session: String, capacity: U32, live: Bool) -> Resolution:
  match live:
    case True{}: resolve_matching(lease,database,owner,request,session,capacity,correlation_is(dest_of(lease),database,owner,request,session))
    case other: Created{lease,fresh_destination_lease(database,owner,request,session)}

# Resolving a destination for an incoming request against the recorded
# capacity: a matching destination below capacity gains one reference; a
# matching destination at capacity is returned unchanged as an explicit
# refusal; a new correlation creates exactly one fresh destination and the
# decision carries the still-retained old lease beside it. The hosted owner
# loop owns the retained destination table, its uniqueness and storage of
# the created lease.
def resolve_destination(+lease: DestinationLease, +database: String, +owner: String, +request: String, +session: String, capacity: U32) -> Resolution:
  resolve_live(lease,database,owner,request,session,capacity,dest_live_of(lease))

def same_owner_and_capability(+a: Generation, +b: Generation) -> Bool:
  Bool.and(String.eq(gen_owner_of(a),gen_owner_of(b)),String.eq(gen_capability_of(a),gen_capability_of(b)))

def same_generation(+a: Generation, +b: Generation) -> Bool:
  Bool.and(same_owner_and_capability(a,b),U32.is_eq(gen_revision_of(a),gen_revision_of(b)))

def register_decided(+registration: Registration, +observed: Generation, identity: Bool, revision: Bool, is_cancelled: Bool, busy: Bool) -> Registration:
  match identity:
    case True{}: match is_cancelled:
      case True{}: registration
      case other: match busy:
        case True{}: registration
        case other: match revision:
          case True{}: Registration{reg_identity_of(registration),reg_generation_of(registration),reg_database_of(registration),reg_owner_of(registration),reg_request_of(registration),reg_session_of(registration),reg_adoptions_of(registration),reg_references_of(registration),True{},reg_event_retained_of(registration),reg_cancelled_of(registration)}
          case other: Registration{reg_identity_of(registration),reg_generation_of(registration),reg_database_of(registration),reg_owner_of(registration),reg_request_of(registration),reg_session_of(registration),reg_adoptions_of(registration),reg_references_of(registration),False{},True{},reg_cancelled_of(registration)}
    case other: registration

# Registering under shared synchronization. A stale owner or capability
# identity is refused outright: it names a different capability incarnation,
# and only the separately owned readiness revision may change under the same
# identity. A cancelled registration refuses re-registration. An armed
# registration refuses repeated arming until its references resolve. On the
# current revision the registration arms; on a changed revision it stays
# unarmed and retains its ready event immediately, so state that changed
# before registration is never lost. The caller rechecks read readiness
# after arming.
def register_ready(+registration: Registration, +observed: Generation) -> Registration:
  register_decided(registration,observed,same_owner_and_capability(reg_generation_of(registration),observed),U32.is_eq(gen_revision_of(reg_generation_of(registration)),gen_revision_of(observed)),reg_cancelled_of(registration),reg_armed_of(registration))

def registration_binds(+registration: Registration, +destination: Destination) -> Bool:
  Bool.and(String.eq(reg_database_of(registration),dest_database_of(destination)),Bool.and(String.eq(reg_owner_of(registration),dest_owner_of(destination)),Bool.and(String.eq(reg_request_of(registration),dest_request_of(destination)),String.eq(reg_session_of(registration),dest_session_of(destination)))))

def token_presents_for_transition(+registration: Registration, +destination: Destination, +outstanding: TaskEvent) -> Bool:
  Bool.and(Bool.and(Bool.and(Bool.and(String.eq(reg_identity_of(registration),token_identity_of(outstanding)),same_generation(reg_generation_of(registration),token_generation_of(outstanding))),correlation_is(destination,token_database_of(outstanding),token_owner_of(outstanding),token_request_of(outstanding),token_session_of(outstanding))),U32.is_eq(token_occurrence_of(outstanding),U32.sub(reg_adoptions_of(registration),1))),token_is_adopted(outstanding))

def accept_decided(+registration: Registration, +destination: Destination, task_capacity: U32, event: Bool, bound: Bool, is_cancelled: Bool, below_task_capacity: Bool) -> Acceptance:
  match event:
    case True{}: match is_cancelled:
      case True{}: Refused{registration,destination}
      case other: match bound:
        case True{}: Bool.pick(Acceptance,below_task_capacity,Adopted{Registration{reg_identity_of(registration),reg_generation_of(registration),reg_database_of(registration),reg_owner_of(registration),reg_request_of(registration),reg_session_of(registration),U32.add(reg_adoptions_of(registration),1),reg_references_of(registration),False{},False{},reg_cancelled_of(registration)},Destination{dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),dest_references_of(destination),U32.add(dest_tasks_of(destination),1)},TaskEvent{reg_identity_of(registration),reg_adoptions_of(registration),reg_generation_of(registration),dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),AdoptedOutstanding{}}},Refused{registration,destination})
        case other: Refused{registration,destination}
    case other: Refused{registration,destination}

# A readiness event transfers the responsibility to wake and retry
# read_ready to the owning task — it does not transfer an offered frame
# allocation. Frame adoption is a separate hosted operation after an actual
# OfferedFrame, preserving the original correlation, the exact reader
# incarnation and serial, the latched fault and task ownership before any
# take. Adoption requires the destination to match the registration's
# recorded binding and a retained event, clears that event, records the wake
# on the destination's task count against the recorded capacity, and issues
# the outstanding task-event token with a fresh occurrence number drawn from
# the registration's adoption count. A registration without a retained
# event, a foreign destination, a cancelled registration, or a destination
# at task capacity refuses adoption with both records unchanged — a
# duplicate acceptance cannot manufacture a second task event, and every
# token occurrence is distinct.
def accept_ready(+registration: Registration, +destination: Destination, task_capacity: U32) -> Acceptance:
  accept_decided(registration,destination,task_capacity,reg_event_retained_of(registration),registration_binds(registration,destination),reg_cancelled_of(registration),U32.is_lt(dest_tasks_of(destination),task_capacity))

# The token presentation an event transition requires: the token names this
# registration's identity and current capability generation, this
# destination's correlation, the registration's latest occurrence, and the
# adopted-outstanding phase.
def token_presents_for_transition(+registration: Registration, +destination: Destination, +outstanding: TaskEvent) -> Bool:
  Bool.and(Bool.and(Bool.and(Bool.and(String.eq(reg_identity_of(registration),token_identity_of(outstanding)),same_generation(reg_generation_of(registration),token_generation_of(outstanding))),correlation_is(destination,token_database_of(outstanding),token_owner_of(outstanding),token_request_of(outstanding),token_session_of(outstanding))),U32.is_eq(token_occurrence_of(outstanding),U32.sub(reg_adoptions_of(registration),1))),token_is_adopted(outstanding))

def requeue_decided(+registration: Registration, +destination: Destination, +outstanding: TaskEvent, presents: Bool, outstanding_tasks: Bool) -> Requeue:
  match presents:
    case True{}: match outstanding_tasks:
      case True{}: Requeued{Registration{reg_identity_of(registration),reg_generation_of(registration),reg_database_of(registration),reg_owner_of(registration),reg_request_of(registration),reg_session_of(registration),reg_adoptions_of(registration),reg_references_of(registration),reg_armed_of(registration),True{},reg_cancelled_of(registration)},Destination{dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),dest_references_of(destination),U32.sub(dest_tasks_of(destination),1)},TaskEvent{reg_identity_of(registration),token_occurrence_of(outstanding),reg_generation_of(registration),dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),ReturnedToRegistration{}}}
      case other: Unowned{registration,destination,outstanding}
    case other: Unowned{registration,destination,outstanding}

# A failed delivery returns the exact adopted event token to its
# registration for retry and releases the destination's outstanding task
# count, checked against zero. The token must name this registration
# identity and current generation, this destination correlation, the latest
# occurrence and the adopted-outstanding phase; an earlier occurrence, a
# mismatched, repeated or foreign token is refused with both records and the
# presented token preserved, so one event can never consume a second task
# responsibility.
def requeue_event(+registration: Registration, +destination: Destination, +outstanding: TaskEvent) -> Requeue:
  requeue_decided(registration,destination,outstanding,token_presents_for_transition(registration,destination,outstanding),U32.is_lt(0,dest_tasks_of(destination)))

def complete_decided(+registration: Registration, +destination: Destination, +outstanding: TaskEvent, presents: Bool, outstanding_tasks: Bool) -> Completion:
  match presents:
    case True{}: match outstanding_tasks:
      case True{}: Completed{Registration{reg_identity_of(registration),reg_generation_of(registration),reg_database_of(registration),reg_owner_of(registration),reg_request_of(registration),reg_session_of(registration),reg_adoptions_of(registration),reg_references_of(registration),reg_armed_of(registration),reg_event_retained_of(registration),reg_cancelled_of(registration)},Destination{dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),dest_references_of(destination),U32.sub(dest_tasks_of(destination),1)},TaskEvent{reg_identity_of(registration),token_occurrence_of(outstanding),reg_generation_of(registration),dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),CompletedToRegistration{}}}
      case other: Unowned{registration,destination,outstanding}
    case other: Unowned{registration,destination,outstanding}

# A completed delivery consumes the exact adopted event token: the event
# stays delivered, the destination's outstanding task count drops checked
# against zero, and a mismatched, repeated or stale-occurrence token is
# refused with both records preserved.
def complete_event(+registration: Registration, +destination: Destination, +outstanding: TaskEvent) -> Completion:
  complete_decided(registration,destination,outstanding,token_presents_for_transition(registration,destination,outstanding),U32.is_lt(0,dest_tasks_of(destination)))

# One registration reference is released, checked against zero, with an
# explicit disposition: an absent or already-released reference returns the
# record unchanged as AlreadyReleased. The hosted table additionally
# validates the original holder identity for this release; a copied record
# alone establishes no holder.
type RegistrationRelease is Data:
  Released{registration: Registration}
  AlreadyReleased{registration: Registration}

def release_registration_reference(+registration: Registration) -> RegistrationRelease:
  Bool.pick(RegistrationRelease,U32.is_lt(0,reg_references_of(registration)),Released{Registration{reg_identity_of(registration),reg_generation_of(registration),reg_database_of(registration),reg_owner_of(registration),reg_request_of(registration),reg_session_of(registration),reg_adoptions_of(registration),U32.sub(reg_references_of(registration),1),reg_armed_of(registration),reg_event_retained_of(registration),reg_cancelled_of(registration)}},AlreadyReleased{registration})

# One destination reference is released, checked against zero, with the
# same explicit disposition; the lease stays live, the task count is
# unchanged, and an already-released outcome returns the lease unchanged.
type LeaseRelease is Data:
  LeaseReleased{lease: DestinationLease}
  LeaseAlreadyReleased{lease: DestinationLease}

def release_destination_reference(+lease: DestinationLease) -> LeaseRelease:
  match lease:
    case DestinationLease{+destination,+live}:
      Bool.pick(LeaseRelease,U32.is_lt(0,dest_references_of(destination)),LeaseReleased{DestinationLease{Destination{dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),U32.sub(dest_references_of(destination),1),dest_tasks_of(destination)},live}},LeaseAlreadyReleased{DestinationLease{destination,live}})

# Cancellation invalidates exactly this registration generation: later
# events on this identity are refused, arming stops, and its disposal stays
# unsafe while an event is retained, a reference remains or it is armed. An
# already retained event keeps its responsible owner through cancellation.
def cancel_registration(registration: Registration) -> Registration:
  match registration:
    case Registration{+identity,+generation,+database,+owner,+request,+session,+adoptions,+references,+armed,+event_retained,+cancelled}:
      Registration{identity,generation,database,owner,request,session,adoptions,references,armed:False{},event_retained,cancelled:True{}}

# Disposal of a destination is safe only when nothing references it and no
# undelivered task event remains.
def destination_disposable(+destination: Destination) -> Bool:
  Bool.and(U32.is_eq(dest_references_of(destination),0),U32.is_eq(dest_tasks_of(destination),0))

# A cancelled registration's still-retained event settles through its
# cancellation/failure task: this transfer clears the retained
# responsibility so disposal can proceed after references resolve. It is
# the only settlement route for such an event — ordinary adoption stays
# refused on a cancelled registration.
def settle_cancelled_event(registration: Registration) -> Registration:
  match registration:
    case Registration{+identity,+generation,+database,+owner,+request,+session,+adoptions,+references,+armed,+event_retained,+cancelled}:
      Registration{identity,generation,database,owner,request,session,adoptions,references,armed:False{},event_retained:False{},cancelled}

def registration_disposable(+registration: Registration) -> Bool:
  Bool.and(reg_cancelled_of(registration),Bool.and(Bool.not(reg_event_retained_of(registration)),Bool.and(Bool.not(reg_armed_of(registration)),U32.is_eq(reg_references_of(registration),0))))

# --- laws -------------------------------------------------------------------

law resolving_the_same_correlation_retains_the_same_destination:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  for +references: U32
  for +tasks: U32
  for +capacity: U32
  {resolve_destination(DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},database,owner,request,session,capacity) == Bool.pick(Resolution,U32.is_lt(references,capacity),Retained{DestinationLease{Destination{database,owner,request,session,U32.add(references,1),tasks},True{}}},AtCapacity{DestinationLease{Destination{database,owner,request,session,references,tasks},True{}}}) : Resolution}

def resolving_the_same_correlation_retains_the_same_destination(database,owner,request,session,references,tasks,capacity):
  {==}

law resolution_at_capacity_returns_the_retained_lease_unchanged:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  for +references: U32
  for +tasks: U32
  {resolve_destination(DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},database,owner,request,session,references) == AtCapacity{DestinationLease{Destination{database,owner,request,session,references,tasks},True{}}} : Resolution}

def resolution_at_capacity_returns_the_retained_lease_unchanged(database,owner,request,session,references,tasks):
  {==}

law a_new_correlation_creates_one_fresh_retained_destination:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  for +references: U32
  for +tasks: U32
  {resolve_destination(DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},"other-"++database,owner,request,session,references) == Created{DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},DestinationLease{Destination{"other-"++database,owner,request,session,1,0},True{}}} : Resolution}

def a_new_correlation_creates_one_fresh_retained_destination(database,owner,request,session,references,tasks):
  {==}

law registration_on_the_current_revision_arms:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +database: String
  for +request: String
  for +session: String
  for +adoptions: U32
  for +lease_references: U32
  {register_ready(Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,False{},False{},False{}},Generation{owner,capability,revision}) == Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,True{},False{},False{}} : Registration}

def registration_on_the_current_revision_arms(identity,owner,capability,revision,database,request,session,adoptions,lease_references):
  {==}

# A registration on a changed readiness revision under the same capability
# identity stays unarmed and retains its ready event immediately; on the
# current revision it arms without retaining.
law registration_on_a_changed_revision_retains_the_event_unarmed:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +other_revision: U32
  for +database: String
  for +request: String
  for +session: String
  for +adoptions: U32
  for +lease_references: U32
  {register_ready(Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,False{},False{},False{}},Generation{owner,capability,other_revision}) == Bool.pick(Registration,U32.is_eq(revision,other_revision),Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,True{},False{},False{}},Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,False{},True{},False{}}) : Registration}

def registration_on_a_changed_revision_retains_the_event_unarmed(identity,owner,capability,revision,other_revision,database,request,session,adoptions,lease_references):
  {==}

# A registration under a different capability incarnation is refused
# outright: the foreign owner name is derived as the six-character prefix
# extension of the recorded owner, so the identities provably differ.
law a_foreign_capability_registration_is_refused:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +other_capability: String
  for +other_revision: U32
  for +database: String
  for +request: String
  for +session: String
  for +adoptions: U32
  for +lease_references: U32
  for +armed: Bool
  for +event: Bool
  for +cancelled: Bool
  {register_ready(Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,armed,event,cancelled},Generation{"other-"++owner,other_capability,other_revision}) == Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,armed,event,cancelled} : Registration}

def a_foreign_capability_registration_is_refused(identity,owner,capability,revision,other_capability,other_revision,database,request,session,adoptions,lease_references,armed,event,cancelled):
  {==}

# A cancelled registration refuses re-registration in either revision state.
law a_cancelled_registration_refuses_registration:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +other_revision: U32
  for +database: String
  for +request: String
  for +session: String
  for +adoptions: U32
  for +lease_references: U32
  for +armed: Bool
  for +event: Bool
  {register_ready(Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,armed,event,True{}},Generation{owner,capability,other_revision}) == Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,armed,event,True{}} : Registration}

def a_cancelled_registration_refuses_registration(identity,owner,capability,revision,other_revision,database,request,session,adoptions,lease_references,armed,event):
  {==}

# An armed registration refuses repeated arming until its references
# resolve.
law an_armed_registration_refuses_repeated_arming:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +database: String
  for +request: String
  for +session: String
  for +adoptions: U32
  for +lease_references: U32
  for +event: Bool
  for +cancelled: Bool
  {register_ready(Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,True{},event,cancelled},Generation{owner,capability,revision}) == Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,lease_references,True{},event,cancelled} : Registration}

def an_armed_registration_refuses_repeated_arming(identity,owner,capability,revision,database,request,session,adoptions,lease_references,event,cancelled):
  {==}

# Adopting a retained event against the bound destination issues the next
# occurrence token, advances the adoption count, clears the retained event
# and records the task; below task capacity it adopts, and at capacity it
# refuses with both records unchanged.
law accepting_a_ready_event_issues_the_next_occurrence:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +adoptions: U32
  for +reg_references: U32
  for +lease_references: U32
  for +lease_tasks: U32
  for +task_capacity: U32
  for +database: String
  for +request: String
  for +session: String
  {accept_ready(Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,reg_references,True{},True{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks},task_capacity) == Bool.pick(Acceptance,U32.is_lt(lease_tasks,task_capacity),Adopted{Registration{identity,Generation{owner,capability,revision},database,owner,request,session,U32.add(adoptions,1),reg_references,False{},False{},False{}},Destination{database,owner,request,session,lease_references,U32.add(lease_tasks,1)},TaskEvent{identity,adoptions,Generation{owner,capability,revision},database,owner,request,session,AdoptedOutstanding{}}},Refused{Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,reg_references,True{},True{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks}}) : Acceptance}

def accepting_a_ready_event_issues_the_next_occurrence(identity,owner,capability,revision,adoptions,reg_references,lease_references,lease_tasks,task_capacity,database,request,session):
  {==}

# The issued token presents exactly while its occurrence is the
# registration's latest and its phase is adopted-outstanding; after a
# requeue the returned token's earlier occurrence no longer presents.
law a_returned_tokens_earlier_occurrence_no_longer_presents:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +occurrence: U32
  for +database: String
  for +request: String
  for +session: String
  for +lease_references: U32
  {token_presents_for_transition(Registration{identity,Generation{owner,capability,revision},database,owner,request,session,U32.add(occurrence,1),lease_references,True{},False{},False{}},Destination{database,owner,request,session,lease_references,0},TaskEvent{identity,occurrence,Generation{owner,capability,revision},database,owner,request,session,ReturnedToRegistration{}}) == False{} : Bool}

def a_returned_tokens_earlier_occurrence_no_longer_presents(identity,owner,capability,revision,occurrence,database,request,session,lease_references):
  {==}

# Requeue with the presenting token moves the event back to the
# registration and drops exactly one outstanding task; the returned token
# records the returned phase.
law a_presenting_requeue_drops_one_outstanding_task:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +occurrence: U32
  for +adoptions: U32
  for +reg_references: U32
  for +lease_references: U32
  for +lease_tasks: U32
  for +database: String
  for +request: String
  for +session: String
  {requeue_event(Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,reg_references,True{},False{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks},TaskEvent{identity,occurrence,Generation{owner,capability,revision},database,owner,request,session,AdoptedOutstanding{}}) == Bool.pick(Requeue,Bool.and(U32.is_eq(occurrence,U32.sub(adoptions,1)),U32.is_lt(0,lease_tasks)),Requeued{Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,reg_references,True{},True{},False{}},Destination{database,owner,request,session,lease_references,U32.sub(lease_tasks,1)},TaskEvent{identity,occurrence,Generation{owner,capability,revision},database,owner,request,session,ReturnedToRegistration{}}},Unowned{Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,reg_references,True{},False{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks},TaskEvent{identity,occurrence,Generation{owner,capability,revision},database,owner,request,session,AdoptedOutstanding{}}}) : Requeue}

def a_presenting_requeue_drops_one_outstanding_task(identity,owner,capability,revision,occurrence,adoptions,reg_references,lease_references,lease_tasks,database,request,session):
  {==}

# Disposal requires cancellation, no retained event, no armed state and no
# remaining reference.
law disposal_requires_cancelled_unarmed_unreferenced_state:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +database: String
  for +request: String
  for +session: String
  for +adoptions: U32
  for +references: U32
  for +armed: Bool
  for +event: Bool
  {registration_disposable(Registration{identity,Generation{owner,capability,revision},database,owner,request,session,adoptions,references,armed,event,True{}}) == Bool.and(Bool.not(armed),Bool.and(Bool.not(event),U32.is_eq(references,0))) : Bool}

def disposal_requires_cancelled_unarmed_unreferenced_state(identity,owner,capability,revision,database,request,session,adoptions,references,armed,event):
  {==}