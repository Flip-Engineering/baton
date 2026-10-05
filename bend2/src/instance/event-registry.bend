import Base

# Instance-owned retained event-destination registry: the pure lifecycle
# decisions for owner event destinations, retained task/event references,
# registration arming and safe disposal, per the shared-owner design in
# docs/bend2/shared-owner-task-custody-design.md. This module performs no IO
# and holds no host synchronization or storage: Controls owns the file
# effects, reader serialization and the shared event synchronization; the
# hosted owner loop calls these decisions while holding the appropriate
# short critical section, and it owns the retained destination table, its
# uniqueness and the actual event queue. A registration record is
# bookkeeping state, never an event implementation by itself; none of these
# decisions grants a host read, a start or owner replacement.
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
# The offered-reader dispose call inherits ignored close results and assumes
# registry quiescence, so it is not a qualified disposal receipt — qualified
# disposal is the registry's own decision plus the Controls lease release.

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

# One registration over a reader lease and a destination lease. `identity`
# is the registration and event identity; a ready event belongs to the task
# that owns this registration.
type Registration is Data:
  Registration{identity: String, generation: Generation, references: U32, armed: Bool, event_retained: Bool, cancelled: Bool}

type DestinationLease is Data:
  DestinationLease{destination: Destination, live: Bool}

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
    case Registration{identity,generation,references,armed,event_retained,cancelled}: identity

def reg_generation_of(registration: Registration) -> Generation:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}: generation

def reg_references_of(registration: Registration) -> U32:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}: references

def reg_armed_of(registration: Registration) -> Bool:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}: armed

def reg_event_retained_of(registration: Registration) -> Bool:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}: event_retained

def reg_cancelled_of(registration: Registration) -> Bool:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}: cancelled

def gen_owner_of(generation: Generation) -> String:
  match generation:
    case Generation{owner,capability,revision}: owner

def gen_capability_of(generation: Generation) -> String:
  match generation:
    case Generation{owner,capability,revision}: capability

def gen_revision_of(generation: Generation) -> U32:
  match generation:
    case Generation{owner,capability,revision}: revision

def same_correlation(a: Destination, b: Destination) -> Bool:
  correlation_is(a,dest_database_of(b),dest_owner_of(b),dest_request_of(b),dest_session_of(b))

def correlation_is(+destination: Destination, +database: String, +owner: String, +request: String, +session: String) -> Bool:
  Bool.and(String.eq(dest_database_of(destination),database),Bool.and(String.eq(dest_owner_of(destination),owner),Bool.and(String.eq(dest_request_of(destination),request),String.eq(dest_session_of(destination),session))))

def same_owner_and_capability(+a: Generation, +b: Generation) -> Bool:
  Bool.and(String.eq(gen_owner_of(a),gen_owner_of(b)),String.eq(gen_capability_of(a),gen_capability_of(b)))

def same_generation(+a: Generation, +b: Generation) -> Bool:
  Bool.and(same_owner_and_capability(a,b),U32.is_eq(gen_revision_of(a),gen_revision_of(b)))

# Resolving a destination for an incoming request retains one reference on
# the matching live lease, or creates exactly one new retained destination
# when no live lease matches. `at_capacity` is the host's checked-overflow
# refusal: a matching resolution at capacity returns the lease unchanged.
# This decision creates a per-call lease value; the hosted owner loop owns
# the retained destination table, its uniqueness and destination reuse.
def resolve_destination(+lease: DestinationLease, +database: String, +owner: String, +request: String, +session: String, +at_capacity: Bool) -> DestinationLease:
  resolve_live(lease,database,owner,request,session,at_capacity,dest_live_of(lease))

def resolve_live(+lease: DestinationLease, +database: String, +owner: String, +request: String, +session: String, +at_capacity: Bool, live: Bool) -> DestinationLease:
  match live:
    case True{}: resolve_matching(lease,database,owner,request,session,at_capacity,correlation_is(dest_of(lease),database,owner,request,session))
    case other: fresh_destination_lease(database,owner,request,session)

def resolve_matching(+lease: DestinationLease, +database: String, +owner: String, +request: String, +session: String, +at_capacity: Bool, matches: Bool) -> DestinationLease:
  match matches:
    case True{}: grown_destination_lease(lease,at_capacity)
    case other: fresh_destination_lease(database,owner,request,session)

def grown_destination_lease(+lease: DestinationLease, +at_capacity: Bool) -> DestinationLease:
  Bool.pick(DestinationLease,at_capacity,lease,DestinationLease{Destination{dest_database_of(dest_of(lease)),dest_owner_of(dest_of(lease)),dest_request_of(dest_of(lease)),dest_session_of(dest_of(lease)),U32.add(dest_references_of(dest_of(lease)),1),dest_tasks_of(dest_of(lease))},True{}})

def fresh_destination_lease(+database: String, +owner: String, +request: String, +session: String) -> DestinationLease:
  DestinationLease{Destination{database,owner,request,session,1,0},True{}}

# Registering under shared synchronization. A stale owner or capability
# identity is refused outright: it names a different capability incarnation,
# and only the separately owned readiness revision may change under the same
# identity. A cancelled registration refuses re-registration. An armed
# registration refuses repeated arming until its references resolve. On the
# current revision the registration arms; on a changed revision it stays
# unarmed and retains its ready event immediately, so state that changed
# before registration is never lost. The caller rechecks read readiness
# after arming.
def register_ready(registration: Registration, observed: Generation) -> Registration:
  register_decided(registration,observed,same_owner_and_capability(reg_generation_of(registration),observed),U32.is_eq(gen_revision_of(reg_generation_of(registration)),gen_revision_of(observed)),reg_cancelled_of(registration),reg_armed_of(registration))

def register_decided(+registration: Registration, +observed: Generation, identity: Bool, revision: Bool, is_cancelled: Bool, busy: Bool) -> Registration:
  match identity:
    case True{}: match is_cancelled:
      case True{}: registration
      case other: match busy:
        case True{}: registration
        case other: match revision:
          case True{}: Registration{reg_identity_of(registration),reg_generation_of(registration),reg_references_of(registration),True{},reg_event_retained_of(registration),reg_cancelled_of(registration)}
          case other: Registration{reg_identity_of(registration),reg_generation_of(registration),reg_references_of(registration),False{},True{},reg_cancelled_of(registration)}
    case other: registration

# A ready event transfers to the owning task before the queue reference
# drops: the returned pair clears the registration's retained event and
# records the event on the destination as an undelivered task event, which
# the destination counts until the task finishes delivering it.
def accept_ready(registration: Registration, +destination: Destination) -> Registration & Destination:
  match registration:
    case Registration{+identity,+generation,+references,+armed,+event_retained,+cancelled}:
      match destination:
        case Destination{+database,+owner,+request,+session,+lease_references,+lease_tasks}:
          (Registration{identity,generation,references,armed:False{},event_retained:False{},cancelled},Destination{database,owner,request,session,lease_references,U32.add(lease_tasks,1)})

# A task whose delivery of the event failed returns the event to its
# registration: the event stays owned and is retained for retry.
def requeue_event(registration: Registration) -> Registration:
  match registration:
    case Registration{+identity,+generation,+references,+armed,+event_retained,+cancelled}:
      Registration{identity,generation,references,armed:False{},event_retained:True{},cancelled}

# The task finished delivering its event: the destination's task count
# drops, checked against zero.
def release_task_event(+destination: Destination) -> Destination:
  Bool.pick(Destination,U32.is_lt(0,dest_tasks_of(destination)),Destination{dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),dest_references_of(destination),U32.sub(dest_tasks_of(destination),1)},destination)

# One destination reference is released, checked against zero.
def release_destination_reference(+lease: DestinationLease) -> DestinationLease:
  match lease:
    case DestinationLease{+destination,+live}:
      Bool.pick(DestinationLease,U32.is_lt(0,dest_references_of(destination)),DestinationLease{Destination{dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),U32.sub(dest_references_of(destination),1),dest_tasks_of(destination)},live},lease)

# Cancellation invalidates exactly this registration generation: later
# events on this identity are refused, arming stops, and its disposal stays
# unsafe while an event is retained, a reference remains or it is armed.
def cancel_registration(registration: Registration) -> Registration:
  match registration:
    case Registration{+identity,+generation,+references,+armed,+event_retained,+cancelled}:
      Registration{identity,generation,references,armed:False{},event_retained,cancelled:True{}}

# Disposal of a destination is safe only when nothing references it and no
# undelivered task event remains.
def destination_disposable(+destination: Destination) -> Bool:
  Bool.and(U32.is_eq(dest_references_of(destination),0),U32.is_eq(dest_tasks_of(destination),0))

def registration_disposable(registration: Registration) -> Bool:
  Bool.and(reg_cancelled_of(registration),Bool.and(Bool.not(reg_event_retained_of(registration)),Bool.and(Bool.not(reg_armed_of(registration)),U32.is_eq(reg_references_of(registration),0))))

# --- laws -------------------------------------------------------------------

law resolving_the_same_correlation_retains_the_same_destination:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  for +references: U32
  for +tasks: U32
  {same_correlation(dest_of(resolve_destination(DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},database,owner,request,session,False{})),Destination{database,owner,request,session,references,tasks}) == True{} : Bool}

def resolving_the_same_correlation_retains_the_same_destination(database,owner,request,session,references,tasks):
  {==}

law resolution_retains_a_reference_on_the_matching_destination:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  for +references: U32
  for +tasks: U32
  {resolve_destination(DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},database,owner,request,session,False{}) == DestinationLease{Destination{database,owner,request,session,U32.add(references,1),tasks},True{}} : DestinationLease}

def resolution_retains_a_reference_on_the_matching_destination(database,owner,request,session,references,tasks):
  {==}

law an_at_capacity_resolution_returns_the_lease_unchanged:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  for +references: U32
  for +tasks: U32
  {resolve_destination(DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},database,owner,request,session,True{}) == DestinationLease{Destination{database,owner,request,session,references,tasks},True{}} : DestinationLease}

def an_at_capacity_resolution_returns_the_lease_unchanged(database,owner,request,session,references,tasks):
  {==}

law a_new_correlation_creates_one_retained_destination:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  for +references: U32
  for +tasks: U32
  {resolve_destination(DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},"other-"++database,owner,request,session,False{}) == DestinationLease{Destination{"other-"++database,owner,request,session,1,0},True{}} : DestinationLease}

def a_new_correlation_creates_one_retained_destination(database,owner,request,session,references,tasks):
  {==}

law registration_on_the_current_revision_arms:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +references: U32
  {register_ready(Registration{identity,Generation{owner,capability,revision},references,False{},False{},False{}},Generation{owner,capability,revision}) == Registration{identity,Generation{owner,capability,revision},references,True{},False{},False{}} : Registration}

def registration_on_the_current_revision_arms(identity,owner,capability,revision,references):
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
  for +references: U32
  for +event: Bool
  for +cancelled: Bool
  {register_ready(Registration{identity,Generation{owner,capability,revision},references,False{},event,cancelled},Generation{owner,capability,other_revision}) == Bool.pick(Registration,U32.is_eq(revision,other_revision),Registration{identity,Generation{owner,capability,revision},references,True{},event,cancelled},Registration{identity,Generation{owner,capability,revision},references,False{},True{},cancelled}) : Registration}

def registration_on_a_changed_revision_retains_the_event_unarmed(identity,owner,capability,revision,other_revision,references,event,cancelled):
  {==}

# A registration under a different capability incarnation is refused
# outright: only the separately owned readiness revision changes under the
# same identity.
law a_foreign_capability_registration_is_refused:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +other_owner: String
  for +other_capability: String
  for +other_revision: U32
  for +references: U32
  for +armed: Bool
  for +event: Bool
  for +cancelled: Bool
  {register_ready(Registration{identity,Generation{owner,capability,revision},references,armed,event,cancelled},Generation{other_owner,other_capability,other_revision}) == Registration{identity,Generation{owner,capability,revision},references,armed,event,cancelled} : Registration}

def a_foreign_capability_registration_is_refused(identity,owner,capability,revision,other_owner,other_capability,other_revision,references,armed,event,cancelled):
  {==}

# A cancelled registration refuses re-registration in either revision state.
law a_cancelled_registration_refuses_registration:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +other_revision: U32
  for +references: U32
  for +armed: Bool
  for +event: Bool
  {register_ready(Registration{identity,Generation{owner,capability,revision},references,armed,event,True{}},Generation{owner,capability,other_revision}) == Registration{identity,Generation{owner,capability,revision},references,armed,event,True{}} : Registration}

def a_cancelled_registration_refuses_registration(identity,owner,capability,revision,other_revision,references,armed,event):
  {==}

# An armed registration refuses repeated arming until its references
# resolve.
law an_armed_registration_refuses_repeated_arming:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +references: U32
  for +event: Bool
  for +cancelled: Bool
  {register_ready(Registration{identity,Generation{owner,capability,revision},references,True{},event,cancelled},Generation{owner,capability,revision}) == Registration{identity,Generation{owner,capability,revision},references,True{},event,cancelled} : Registration}

def an_armed_registration_refuses_repeated_arming(identity,owner,capability,revision,references,event,cancelled):
  {==}

# Accepting a ready event clears the registration's retained event and arms
# state, and records the event on its destination as an undelivered task
# event.
law accepting_a_ready_event_transfers_it_to_the_task:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +references: U32
  for +lease_references: U32
  for +lease_tasks: U32
  for +database: String
  for +session: String
  {accept_ready(Registration{identity,Generation{owner,capability,revision},references,True{},True{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks}) == (Registration{identity,Generation{owner,capability,revision},references,False{},False{},False{}},Destination{database,owner,request,session,lease_references,U32.add(lease_tasks,1)}) : Registration & Destination}

def accepting_a_ready_event_transfers_it_to_the_task(identity,owner,capability,revision,references,lease_references,lease_tasks,database,session):
  {==}

# A failed task delivery returns the event to its registration for retry.
law a_failed_delivery_requeues_the_event:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +references: U32
  for +cancelled: Bool
  {requeue_event(Registration{identity,Generation{owner,capability,revision},references,False{},False{},cancelled}) == Registration{identity,Generation{owner,capability,revision},references,False{},True{},cancelled} : Registration}

def a_failed_delivery_requeues_the_event(identity,owner,capability,revision,references,cancelled):
  {==}

# Disposal requires cancellation, no retained event, no armed state and no
# remaining reference.
law disposal_requires_cancelled_unarmed_unreferenced_state:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +references: U32
  for +armed: Bool
  for +event: Bool
  {registration_disposable(Registration{identity,Generation{owner,capability,revision},references,armed,event,True{}}) == Bool.and(Bool.not(armed),Bool.and(Bool.not(event),U32.is_eq(references,0))) : Bool}

def disposal_requires_cancelled_unarmed_unreferenced_state(identity,owner,capability,revision,references,armed,event):
  {==}
