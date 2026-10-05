import Base

# Pure transition values. Host ownership validates evidence and serializes updates.
type Binding is Data:
  Bound{owner: String, database: String, session: String, attempt: String, directory: String, generation: String}

type Access is Data:
  Open{}
  Closing{}
  Retired{}

type Capability is Data:
  Cap{binding: Binding, access: Access, operations: List<&2,String>, acknowledged: Bool}

type Refusal is Data:
  Stale{}
  Closed{}
  DuplicateOperation{}
  UnknownOperation{}
  AcknowledgmentOwed{}
  ReferencesPending{}

type Change is Data:
  Changed{capability: Capability}
  Refused{reason: Refusal, capability: Capability}

def binding_equal(a: Binding, b: Binding) -> Bool:
  match a:
    case Bound{ao,ad,as,aa,ap,ag}: match b:
      case Bound{bo,bd,bs,ba,bp,bg}:
        Bool.and(String.eq(ao,bo),Bool.and(String.eq(ad,bd),Bool.and(String.eq(as,bs),Bool.and(String.eq(aa,ba),Bool.and(String.eq(ap,bp),String.eq(ag,bg))))))

def contains(operations: List<&2,String>, +operation: String) -> Bool:
  match operations:
    case Nil{}: False{}
    case Con{head,tail}: Bool.or(String.eq(head,operation),contains(tail,operation))

def remove(operations: List<&2,String>, +operation: String) -> List<&2,String>:
  match operations:
    case Nil{}: Nil{}
    case Con{+head,+tail}: Bool.pick(List<&2,String>,String.eq(head,operation),tail,Con{head,remove(tail,operation)})

def acquire_unique(binding: Binding, +operations: List<&2,String>, acknowledged: Bool, operation: String, duplicate: Bool) -> Change:
  match duplicate:
    case True{}: Refused{DuplicateOperation{},Cap{binding,Open{},operations,acknowledged}}
    case False{}: Changed{Cap{binding,Open{},Con{operation,operations},acknowledged}}

def acquire_open(binding: Binding, access: Access, +operations: List<&2,String>, acknowledged: Bool, +operation: String) -> Change:
  match access:
    case Open{}: acquire_unique(binding,operations,acknowledged,operation,contains(operations,operation))
    case other: Refused{Closed{},Cap{binding,other,operations,acknowledged}}

def acquire_bound(binding: Binding, access: Access, operations: List<&2,String>, acknowledged: Bool, operation: String, valid: Bool) -> Change:
  match valid:
    case False{}: Refused{Stale{},Cap{binding,access,operations,acknowledged}}
    case True{}: acquire_open(binding,access,operations,acknowledged,operation)

def acquire(capability: Capability, requested: Binding, operation: String) -> Change:
  match capability:
    case Cap{+binding,access,operations,acknowledged}:
      acquire_bound(binding,access,operations,acknowledged,operation,binding_equal(binding,requested))

def complete_known(binding: Binding, access: Access, operations: List<&2,String>, acknowledged: Bool, operation: String, known: Bool) -> Change:
  match known:
    case False{}: Refused{UnknownOperation{},Cap{binding,access,operations,acknowledged}}
    case True{}: Changed{Cap{binding,access,remove(operations,operation),acknowledged}}

def complete_bound(binding: Binding, access: Access, +operations: List<&2,String>, acknowledged: Bool, +operation: String, valid: Bool) -> Change:
  match valid:
    case False{}: Refused{Stale{},Cap{binding,access,operations,acknowledged}}
    case True{}: complete_known(binding,access,operations,acknowledged,operation,contains(operations,operation))

def complete(capability: Capability, requested: Binding, operation: String) -> Change:
  match capability:
    case Cap{+binding,access,operations,acknowledged}:
      complete_bound(binding,access,operations,acknowledged,operation,binding_equal(binding,requested))

def ack_result(binding: Binding, access: Access, operations: List<&2,String>, acknowledged: Bool, result: Result<&1,&1,U32 & String,Unit>) -> Capability:
  match result:
    case Fail{error}: Cap{binding,access,operations,acknowledged}
    case Done{unit}: Cap{binding,access,operations,True{}}

def note_ack(capability: Capability, result: Result<&1,&1,U32 & String,Unit>) -> Capability:
  match capability:
    case Cap{binding,access,operations,acknowledged}: ack_result(binding,access,operations,acknowledged,result)

def retire_access(binding: Binding, access: Access, operations: List<&2,String>) -> Change:
  match access:
    case Retired{}: Refused{Closed{},Cap{binding,Retired{},operations,True{}}}
    case other: Changed{Cap{binding,Closing{},operations,True{}}}

def begin_retire(capability: Capability) -> Change:
  match capability:
    case Cap{binding,access,operations,False{}}: Refused{AcknowledgmentOwed{},Cap{binding,access,operations,False{}}}
    case Cap{binding,access,operations,True{}}: retire_access(binding,access,operations)

def reclaim_references(binding: Binding, operations: List<&2,String>) -> Change:
  match operations:
    case Nil{}: Changed{Cap{binding,Retired{},Nil{},True{}}}
    case other: Refused{ReferencesPending{},Cap{binding,Closing{},other,True{}}}

def reclaim(capability: Capability) -> Change:
  match capability:
    case Cap{binding,Closing{},operations,True{}}: reclaim_references(binding,operations)
    case other: Refused{Closed{},other}

type NoticeState is Data:
  Owed{}
  Delivered{witness: String}

type Notice is Data:
  Notification{recipient: String, report: String, state: NoticeState, error: Maybe<&2,String>}

type DeliveryEvidence is Data:
  EndpointAccepted{request: String}
  EndpointFailed{error: String}
  ParentObserved{recipient: String, report: String, witness: String}

def delivered_if(recipient: String, report: String, state: NoticeState, error: Maybe<&2,String>, witness: String, valid: Bool) -> Notice:
  match valid:
    case False{}: Notification{recipient,report,state,error}
    case True{}: Notification{recipient,report,Delivered{witness},error}

def observe_fields(+expected_recipient: String, +expected_report: String, state: NoticeState, error: Maybe<&2,String>, evidence: DeliveryEvidence) -> Notice:
  match evidence:
    case EndpointAccepted{request}: Notification{expected_recipient,expected_report,state,error}
    case EndpointFailed{failure}: Notification{expected_recipient,expected_report,state,Some{failure}}
    case ParentObserved{recipient,report,+witness}:
      delivered_if(expected_recipient,expected_report,state,error,witness,Bool.and(String.eq(recipient,expected_recipient),Bool.and(String.eq(report,expected_report),Bool.not(String.is_empty(witness)))))

def observe_notice(notice: Notice, evidence: DeliveryEvidence) -> Notice:
  match notice:
    case Notification{recipient,report,state,error}: observe_fields(recipient,report,state,error,evidence)

type Invocation is Data:
  Running{}
  Succeeded{}
  Failed{error: String}

type Duty is Data:
  Ongoing{capability: Capability, notice: Notice, invocation: Invocation}

type TaskResult is Data:
  RefusedBeforeAdmission{request: String, error: String}
  Admitted{duty: Duty}

type HostedContext is Data:
  Context{owner: String, database: String, session: String, request: String, sink: String}

type AttemptContext is Data:
  Original{binding: Binding, cutoff: String, native: String, local_handle: Maybe<&2,U32>, observer_guard: Maybe<&2,U32>}

type OperationLease is Data:
  Lease{binding: Binding, operation: String, local_handle: U32}

type StageOutcome is Data:
  Pending{}
  StageSucceeded{}
  StageFailed{code: U32, error: String}

type HostedResult is Data:
  BeforeAdmission{context: HostedContext, error: String}
  HeldAdmissionFailure{context: HostedContext, observer_guard: U32, cleanup_owner: String, error: String}
  AfterAdmission{context: HostedContext, attempt: AttemptContext, duty: Duty, model: StageOutcome, process: StageOutcome, observer: StageOutcome, notification: StageOutcome, settlement: StageOutcome, acknowledgment: StageOutcome, continuation: StageOutcome, client_output: StageOutcome}

# Environment snapshots are in-memory host inputs and have no durable encoding.
type EnvironmentEntry is Data:
  Variable{key: String, value: String}

type EnvironmentRole is Data:
  NativeLaunch{}
  CoordinatorRecovery{}

type EnvironmentSource is Data:
  Source{role: EnvironmentRole, configuration: String, revision: String, route: String}

def fail_admitted(duty: Duty, error: String) -> TaskResult:
  match duty:
    case Ongoing{capability,notice,invocation}: Admitted{Ongoing{capability,notice,Failed{error}}}

def invocation_settled(invocation: Invocation) -> Bool:
  match invocation:
    case Running{}: False{}
    case other: True{}

def notice_owed(notice: Notice) -> Bool:
  match notice:
    case Notification{recipient,report,Owed{},error}: True{}
    case other: False{}

# Laws exercise the functions above; host integration remains a separate boundary.
law failure_retains_admitted_custody_and_notice:
  for capability: Capability
  for notice: Notice
  for invocation: Invocation
  for error: String
  {fail_admitted(Ongoing{capability,notice,invocation},error) == Admitted{Ongoing{capability,notice,Failed{error}}} : TaskResult}
def failure_retains_admitted_custody_and_notice(capability,notice,invocation,error):
  {==}

law failed_invocation_is_settled:
  for error: String
  {invocation_settled(Failed{error}) == True{} : Bool}
def failed_invocation_is_settled(error):
  {==}

law endpoint_acceptance_preserves_notice:
  for recipient: String
  for report: String
  for state: NoticeState
  for error: Maybe<&2,String>
  for request: String
  {observe_notice(Notification{recipient,report,state,error},EndpointAccepted{request}) == Notification{recipient,report,state,error} : Notice}
def endpoint_acceptance_preserves_notice(recipient,report,state,error,request):
  {==}

law failed_delivery_keeps_wake_owed:
  for recipient: String
  for report: String
  for error: Maybe<&2,String>
  for failure: String
  {notice_owed(observe_notice(Notification{recipient,report,Owed{},error},EndpointFailed{failure})) == True{} : Bool}
def failed_delivery_keeps_wake_owed(recipient,report,error,failure):
  {==}

law failed_ack_preserves_capability:
  for binding: Binding
  for access: Access
  for operations: List<&2,String>
  for acknowledged: Bool
  for -error: U32 & String
  {note_ack(Cap{binding,access,operations,acknowledged},Fail{error}) == Cap{binding,access,operations,acknowledged} : Capability}
def failed_ack_preserves_capability(binding,access,operations,acknowledged,error):
  {==}

law ack_keeps_outstanding_operations:
  for binding: Binding
  for access: Access
  for operations: List<&2,String>
  for acknowledged: Bool
  {note_ack(Cap{binding,access,operations,acknowledged},Done{Unit{}}) == Cap{binding,access,operations,True{}} : Capability}
def ack_keeps_outstanding_operations(binding,access,operations,acknowledged):
  {==}

law retirement_closes_lookup_before_references_drain:
  for binding: Binding
  for operations: List<&2,String>
  {begin_retire(Cap{binding,Open{},operations,True{}}) == Changed{Cap{binding,Closing{},operations,True{}}} : Change}
def retirement_closes_lookup_before_references_drain(binding,operations):
  {==}

law outstanding_operation_prevents_reclamation:
  for binding: Binding
  for operation: String
  for operations: List<&2,String>
  {reclaim(Cap{binding,Closing{},Con{operation,operations},True{}}) == Refused{ReferencesPending{},Cap{binding,Closing{},Con{operation,operations},True{}}} : Change}
def outstanding_operation_prevents_reclamation(binding,operation,operations):
  {==}

law drained_acknowledged_capability_retires:
  for binding: Binding
  {reclaim(Cap{binding,Closing{},Nil{},True{}}) == Changed{Cap{binding,Retired{},Nil{},True{}}} : Change}
def drained_acknowledged_capability_retires(binding):
  {==}

law ack_is_required_before_retirement:
  for binding: Binding
  for access: Access
  for operations: List<&2,String>
  {begin_retire(Cap{binding,access,operations,False{}}) == Refused{AcknowledgmentOwed{},Cap{binding,access,operations,False{}}} : Change}
def ack_is_required_before_retirement(binding,access,operations):
  {==}

law original_attempt_reference_drains_after_lookup_closes:
  {complete(Cap{Bound{"owner","db","session","A","directory-A","generation-A"},Closing{},["ack"],True{}},Bound{"owner","db","session","A","directory-A","generation-A"},"ack")
   == Changed{Cap{Bound{"owner","db","session","A","directory-A","generation-A"},Closing{},[],True{}}} : Change}
def original_attempt_reference_drains_after_lookup_closes():
  {==}

law stale_generation_cannot_acquire_reference:
  {acquire(Cap{Bound{"owner","db","session","A","directory-A","new"},Open{},[],False{}},Bound{"owner","db","session","A","directory-A","old"},"write")
   == Refused{Stale{},Cap{Bound{"owner","db","session","A","directory-A","new"},Open{},[],False{}}} : Change}
def stale_generation_cannot_acquire_reference():
  {==}

law different_attempt_cannot_finish_reference:
  {complete(Cap{Bound{"owner","db","session","B","directory-B","generation"},Open{},["ack"],True{}},Bound{"owner","db","session","A","directory-A","generation"},"ack")
   == Refused{Stale{},Cap{Bound{"owner","db","session","B","directory-B","generation"},Open{},["ack"],True{}}} : Change}
def different_attempt_cannot_finish_reference():
  {==}

law closing_rejects_new_reference:
  {acquire(Cap{Bound{"owner","db","session","A","directory-A","generation"},Closing{},[],True{}},Bound{"owner","db","session","A","directory-A","generation"},"write")
   == Refused{Closed{},Cap{Bound{"owner","db","session","A","directory-A","generation"},Closing{},[],True{}}} : Change}
def closing_rejects_new_reference():
  {==}

law duplicate_completion_preserves_reference_state:
  {complete(Cap{Bound{"owner","db","session","A","directory-A","generation"},Closing{},[],True{}},Bound{"owner","db","session","A","directory-A","generation"},"ack")
   == Refused{UnknownOperation{},Cap{Bound{"owner","db","session","A","directory-A","generation"},Closing{},[],True{}}} : Change}
def duplicate_completion_preserves_reference_state():
  {==}

law wrong_report_witness_keeps_notice_owed:
  {notice_owed(observe_notice(Notification{"parent","report-A",Owed{},None{}},ParentObserved{"parent","report-B","witness"})) == True{} : Bool}
def wrong_report_witness_keeps_notice_owed():
  {==}

law matching_parent_witness_discharges_notice:
  {observe_notice(Notification{"parent","report-A",Owed{},None{}},ParentObserved{"parent","report-A","witness"}) == Notification{"parent","report-A",Delivered{"witness"},None{}} : Notice}
def matching_parent_witness_discharges_notice():
  {==}
