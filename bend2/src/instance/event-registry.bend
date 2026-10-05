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

# The outcome of one resolution against the retained table decision: the
# matched destination gained a reference, the matched destination was at its
# recorded capacity and stays unchanged, or the correlation is new and the
# fresh destination must be stored beside the still-retained old one by the
# hosted table.
type Resolution is Data:
  Retained{lease: DestinationLease}
  AtCapacity{retained: DestinationLease}
  Created{retained: DestinationLease, fresh: DestinationLease}

# The outcome of one event adoption: the event moved to the destination's
# task count, or the adoption was refused with both records unchanged.
type Acceptance is Data:
  Adopted{registration: Registration, destination: Destination}
  Refused{registration: Registration, destination: Destination}

# The outcome of one failed-delivery requeue: the event returned to its
# registration and the destination's outstanding task count dropped, or no
# outstanding task event existed and both records stay unchanged.
type Requeue is Data:
  Requeued{registration: Registration, destination: Destination}
  Unowned{registration: Registration, destination: Destination}

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
          case True{}: Registration{reg_identity_of(registration),reg_generation_of(registration),reg_references_of(registration),True{},reg_event_retained_of(registration),reg_cancelled_of(registration)}
          case other: Registration{reg_identity_of(registration),reg_generation_of(registration),reg_references_of(registration),False{},True{},reg_cancelled_of(registration)}
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

def accept_decided(+registration: Registration, +destination: Destination, task_capacity: U32, event: Bool, below_task_capacity: Bool) -> Acceptance:
  match event:
    case True{}: Bool.pick(Acceptance,below_task_capacity,Adopted{Registration{reg_identity_of(registration),reg_generation_of(registration),reg_references_of(registration),False{},False{},reg_cancelled_of(registration)},Destination{dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),dest_references_of(destination),U32.add(dest_tasks_of(destination),1)}},Refused{registration,destination})
    case other: Refused{registration,destination}

# A readiness event transfers the responsibility to wake and retry
# read_ready to the owning task — it does not transfer an offered frame
# allocation. Frame adoption is a separate hosted operation after an actual
# OfferedFrame, preserving the original correlation, the exact reader
# incarnation and serial, the latched fault and task ownership before any
# take. Adoption here clears the registration's retained event and records
# the wake on the destination's task count, checked against the recorded
# task capacity. A registration without a retained event, or a destination
# at its task capacity, refuses adoption with both records unchanged — a
# duplicate acceptance cannot manufacture a second task event.
def accept_ready(+registration: Registration, +destination: Destination, task_capacity: U32) -> Acceptance:
  accept_decided(registration,destination,task_capacity,reg_event_retained_of(registration),U32.is_lt(dest_tasks_of(destination),task_capacity))

def requeue_decided(+registration: Registration, +destination: Destination, outstanding: Bool) -> Requeue:
  match outstanding:
    case True{}: Requeued{Registration{reg_identity_of(registration),reg_generation_of(registration),reg_references_of(registration),reg_armed_of(registration),True{},reg_cancelled_of(registration)},Destination{dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),dest_references_of(destination),U32.sub(dest_tasks_of(destination),1)}}
    case other: Unowned{registration,destination}

# A task whose delivery of the event failed returns the event to its
# registration for retry and releases the destination's outstanding task
# count, checked against zero; with no outstanding task event both records
# stay unchanged, so retries cannot manufacture or strand duties. A
# completed delivery releases its task count through the same keyed
# destination record in the hosted table; the module deliberately provides
# no unkeyed task-count debit.
def requeue_event(+registration: Registration, +destination: Destination) -> Requeue:
  requeue_decided(registration,destination,U32.is_lt(0,dest_tasks_of(destination)))

# One registration reference is released, checked against zero: original
# holders end only through this release on the records they hold, and a
# fresh zero-reference construction proves nothing about other holders.
def release_registration_reference(registration: Registration) -> Registration:
  Bool.pick(Registration,U32.is_lt(0,reg_references_of(registration)),Registration{reg_identity_of(registration),reg_generation_of(registration),U32.sub(reg_references_of(registration),1),reg_armed_of(registration),reg_event_retained_of(registration),reg_cancelled_of(registration)},registration)

# One destination reference is released, checked against zero; the lease
# stays live and its destination is reconstructed unchanged otherwise.
def release_destination_reference(+lease: DestinationLease) -> DestinationLease:
  match lease:
    case DestinationLease{+destination,+live}:
      Bool.pick(DestinationLease,U32.is_lt(0,dest_references_of(destination)),DestinationLease{Destination{dest_database_of(destination),dest_owner_of(destination),dest_request_of(destination),dest_session_of(destination),U32.sub(dest_references_of(destination),1),dest_tasks_of(destination)},live},DestinationLease{destination,live})

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
  {register_ready(Registration{identity,Generation{owner,capability,revision},references,False{},False{},False{}},Generation{owner,capability,other_revision}) == Bool.pick(Registration,U32.is_eq(revision,other_revision),Registration{identity,Generation{owner,capability,revision},references,True{},False{},False{}},Registration{identity,Generation{owner,capability,revision},references,False{},True{},False{}}) : Registration}

def registration_on_a_changed_revision_retains_the_event_unarmed(identity,owner,capability,revision,other_revision,references):
  {==}

# A registration under a different capability incarnation is refused
# outright: the foreign owner name is derived as the six-character prefix
# extension of the recorded owner, so the identities provably differ, and
# only the separately owned readiness revision changes under the same
# identity.
law a_foreign_capability_registration_is_refused:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +other_capability: String
  for +other_revision: U32
  for +references: U32
  for +armed: Bool
  for +event: Bool
  for +cancelled: Bool
  {register_ready(Registration{identity,Generation{owner,capability,revision},references,armed,event,cancelled},Generation{"other-"++owner,other_capability,other_revision}) == Registration{identity,Generation{owner,capability,revision},references,armed,event,cancelled} : Registration}

def a_foreign_capability_registration_is_refused(identity,owner,capability,revision,other_capability,other_revision,references,armed,event,cancelled):
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

# Adopting a retained event clears the registration's event and records it
# on the destination's task count; without a retained event the adoption is
# refused with both records unchanged.
law accepting_a_ready_event_transfers_it_to_the_task:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +references: U32
  for +lease_references: U32
  for +lease_tasks: U32
  for +task_capacity: U32
  for +database: String
  for +request: String
  for +session: String
  {accept_ready(Registration{identity,Generation{owner,capability,revision},references,True{},True{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks},task_capacity) == Bool.pick(Acceptance,U32.is_lt(lease_tasks,task_capacity),Adopted{Registration{identity,Generation{owner,capability,revision},references,False{},False{},False{}},Destination{database,owner,request,session,lease_references,U32.add(lease_tasks,1)}},Refused{Registration{identity,Generation{owner,capability,revision},references,True{},True{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks}}) : Acceptance}

def accepting_a_ready_event_transfers_it_to_the_task(identity,owner,capability,revision,references,lease_references,lease_tasks,task_capacity,database,request,session):
  {==}

# A registration without a retained event refuses adoption.
law adopting_without_a_retained_event_is_refused:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +references: U32
  for +lease_references: U32
  for +lease_tasks: U32
  for +task_capacity: U32
  for +database: String
  for +request: String
  for +session: String
  {accept_ready(Registration{identity,Generation{owner,capability,revision},references,False{},False{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks},task_capacity) == Refused{Registration{identity,Generation{owner,capability,revision},references,False{},False{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks}} : Acceptance}

def adopting_without_a_retained_event_is_refused(identity,owner,capability,revision,references,lease_references,lease_tasks,task_capacity,database,request,session):
  {==}

# A failed delivery requeues the event and releases the destination's
# outstanding task count; with no outstanding task event both records stay
# unchanged.
law a_failed_delivery_requeues_the_event:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +references: U32
  for +lease_references: U32
  for +lease_tasks: U32
  for +database: String
  for +request: String
  for +session: String
  {requeue_event(Registration{identity,Generation{owner,capability,revision},references,False{},True{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks}) == Bool.pick(Requeue,U32.is_lt(0,lease_tasks),Requeued{Registration{identity,Generation{owner,capability,revision},references,False{},True{},False{}},Destination{database,owner,request,session,lease_references,U32.sub(lease_tasks,1)}},Unowned{Registration{identity,Generation{owner,capability,revision},references,False{},True{},False{}},Destination{database,owner,request,session,lease_references,lease_tasks}}) : Requeue}

def a_failed_delivery_requeues_the_event(identity,owner,capability,revision,references,lease_references,lease_tasks,database,request,session):
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
