import Base

# Instance-owned retained event-destination registry: the pure lifecycle
# decisions for owner event destinations, retained task/event references,
# registration arming and safe disposal, per the shared-owner design in
# docs/bend2/shared-owner-task-custody-design.md. This module performs no IO
# and holds no host synchronization: Controls owns the file effects, reader
# serialization and the shared event synchronization; the hosted owner loop
# calls these decisions while holding the appropriate short critical
# section. A registration record is bookkeeping state, never an event
# implementation by itself.

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

# One registration over a reader lease and a destination lease.
type Registration is Data:
  Registration{identity: String, generation: Generation, references: U32, armed: Bool, event_retained: Bool, cancelled: Bool}

type DestinationLease is Data:
  DestinationLease{destination: Destination, live: Bool}

def dest_of(lease: DestinationLease) -> Destination:
  match lease:
    case DestinationLease{destination,live}: destination

def reg_armed_of(registration: Registration) -> Bool:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}: armed

def reg_event_retained_of(registration: Registration) -> Bool:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}: event_retained

def reg_cancelled_of(registration: Registration) -> Bool:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}: cancelled

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

def correlation_is(+destination: Destination, +database: String, +owner: String, +request: String, +session: String) -> Bool:
  Bool.and(String.eq(dest_database_of(destination),database),Bool.and(String.eq(dest_owner_of(destination),owner),Bool.and(String.eq(dest_request_of(destination),request),String.eq(dest_session_of(destination),session))))

# Resolving a destination for an incoming request retains one reference on
# the matching retained destination, or creates exactly one new retained
# destination when no live lease matches the correlation. The caller
# supplies the lease; this function owns the reference accounting.
def resolve_destination(+lease: DestinationLease, +database: String, +owner: String, +request: String, +session: String) -> DestinationLease:
  match dest_live_of(lease):
    case True{}:
      match correlation_is(dest_of(lease),database,owner,request,session):
        case True{}: DestinationLease{Destination{dest_database_of(dest_of(lease)),dest_owner_of(dest_of(lease)),dest_request_of(dest_of(lease)),dest_session_of(dest_of(lease)),U32.add(dest_references_of(dest_of(lease)),1),dest_tasks_of(dest_of(lease))},True{}}
        case other: DestinationLease{Destination{database,owner,request,session,1,0},True{}}
    case other: DestinationLease{Destination{database,owner,request,session,1,0},True{}}

def same_generation(a: Generation, b: Generation) -> Bool:
  Bool.and(String.eq(a.owner,b.owner),Bool.and(String.eq(a.capability,b.capability),U32.is_eq(a.revision,b.revision)))

# Registering under shared synchronization: the host validates both leases
# and compares the observed revision while holding the event-state lock. A
# registration on the current revision arms; a registration that arrives on
# a changed revision retains its ready event immediately and stays unarmed,
# so state that changed before registration is never lost. The caller
# rechecks read readiness after arming.
def register_ready(registration: Registration, observed: Generation) -> Registration:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}:
      match same_generation(generation,observed):
        case True{}: Registration{identity,generation,references,armed:True{},event_retained,cancelled}
        case other: Registration{identity,generation,references,armed,event_retained:True{},cancelled}

# A ready event transfers to the owning task before the queue reference
# drops: the event becomes the original task's responsibility and the
# registration stops retaining it.
def accept_ready(registration: Registration) -> Registration:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}:
      Registration{identity,generation,references,armed:False{},event_retained:False{},cancelled}

# Cancellation invalidates exactly this registration generation: later
# events on this identity are refused, and its disposal stays unsafe while
# an event is still retained or a reference remains.
def cancel_registration(registration: Registration) -> Registration:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}:
      Registration{identity,generation,references,armed:False{},event_retained,cancelled:True{}}

# Disposal of a destination is safe only when nothing references it and no
# undelivered task event remains.
def destination_disposable(+destination: Destination) -> Bool:
  Bool.and(U32.is_eq(dest_references_of(destination),0),U32.is_eq(dest_tasks_of(destination),0))

def registration_disposable(registration: Registration) -> Bool:
  match registration:
    case Registration{identity,generation,references,armed,event_retained,cancelled}:
      Bool.and(cancelled,Bool.and(Bool.not(event_retained),U32.is_eq(references,0)))

# --- laws -------------------------------------------------------------------

law resolving_the_same_correlation_retains_the_same_destination:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  for +references: U32
  for +tasks: U32
  {same_correlation(dest_of(resolve_destination(DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},database,owner,request,session)),Destination{database,owner,request,session,references,tasks}) == True{} : Bool}

def resolving_the_same_correlation_retains_the_same_destination(database,owner,request,session,references,tasks):
  {==}

law resolution_retains_a_reference_on_the_matching_destination:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  for +references: U32
  for +tasks: U32
  {resolve_destination(DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},database,owner,request,session) == DestinationLease{Destination{database,owner,request,session,U32.add(references,1),tasks},True{}} : DestinationLease}

def resolution_retains_a_reference_on_the_matching_destination(database,owner,request,session,references,tasks):
  {==}

law a_new_correlation_creates_one_retained_destination:
  for +database: String
  for +owner: String
  for +request: String
  for +session: String
  for +references: U32
  for +tasks: U32
  {resolve_destination(DestinationLease{Destination{database,owner,request,session,references,tasks},True{}},"other-"++database,owner,request,session) == DestinationLease{Destination{"other-"++database,owner,request,session,1,0},True{}} : DestinationLease}

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

law registration_on_a_changed_revision_retains_the_event:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +other_revision: U32
  for +references: U32
  for +event: Bool
  for +cancelled: Bool
  {register_ready(Registration{identity,Generation{owner,capability,revision},references,False{},event,cancelled},Generation{owner,capability,other_revision}) == Bool.pick(Registration,U32.is_eq(revision,other_revision),Registration{identity,Generation{owner,capability,revision},references,True{},event,cancelled},Registration{identity,Generation{owner,capability,revision},references,False{},True{},cancelled}) : Registration}

def registration_on_a_changed_revision_retains_the_event(identity,owner,capability,revision,other_revision,references,event,cancelled):
  {==}

law accept_transfers_the_event_before_the_queue_reference_drops:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +references: U32
  for +cancelled: Bool
  {accept_ready(Registration{identity,Generation{owner,capability,revision},references,True{},True{},cancelled}) == Registration{identity,Generation{owner,capability,revision},references,False{},False{},cancelled} : Registration}

def accept_transfers_the_event_before_the_queue_reference_drops(identity,owner,capability,revision,references,cancelled):
  {==}

law cancellation_refuses_disposal_while_an_event_is_retained:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  for +references: U32
  for +event: Bool
  for +cancelled: Bool
  {registration_disposable(cancel_registration(Registration{identity,Generation{owner,capability,revision},references,False{},event,cancelled})) == Bool.and(Bool.not(event),U32.is_eq(references,0)) : Bool}

def cancellation_refuses_disposal_while_an_event_is_retained(identity,owner,capability,revision,references,event,cancelled):
  {==}

law a_clean_cancelled_registration_is_disposable:
  for +identity: String
  for +owner: String
  for +capability: String
  for +revision: U32
  {registration_disposable(cancel_registration(Registration{identity,Generation{owner,capability,revision},0,False{},False{},False{}})) == True{} : Bool}

def a_clean_cancelled_registration_is_disposable(identity,owner,capability,revision):
  {==}
