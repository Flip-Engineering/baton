import Base

# Pure task, slot and duty decisions for the shared native owner design in
# docs/bend2/shared-owner-task-custody-design.md. This module performs no IO:
# durable enumeration and host recovery call these decisions, and stay
# explicit owner interfaces outside this file. Database binding identity and
# admission replay decisions are a separate module; `binding` arrives here as
# host-supplied text.

# The bound owner instance. `binding` is an opaque identity label the host
# supplies; the actual database binding is the host-side SQL connection/effect
# binding with a qualified supported-path policy, which this module does not
# model. `token` is a fresh value generated at owner start. A PID and a
# native conversation ID participate nowhere.
type OwnerInstance is Data:
  Owner{binding: String, token: String}

# One admission into a session's active slot. The generation changes on each
# replacement; historical validation never reads it.
type Slot is Data:
  Slot{session: String, generation: U32}

# One admitted native attempt. Immutable after admission; `generation`
# records the slot generation that admitted it.
type Attempt is Data:
  Attempt{id: String, directory: String, session: String, cutoff: String, generation: U32}

# One tracked invocation result. RefOpen has not returned. RefDone and RefFail
# are both settled; a settled Fail retains its error text in the duty.
type Ref is Data:
  RefOpen{}
  RefDone{note: String}
  RefFail{error: String}

# The five tracked results, in the current finish order: the native outcome
# recorded while owned (qualified child status plus model outcome plus
# observation, per the Receive owner's AttemptCompletion contract), then
# parent delivery (parentNotice), request settlement (nativeRequests), ACK
# (acknowledgment), and the queued continuation. Accepted responsibility for
# a wake is a separate fact from native process startup and from actual input
# receipt; no function here derives one from another.
type Results is Data:
  Results{native: Ref, delivery: Ref, settle: Ref, ack: Ref, continuation: Ref}

# Outstanding responsibilities, tracked separately from settled results. A
# parent wake clears only when a delivery result records the original report
# as actually delivered; a failed delivery settles and leaves the wake owed.
# The ACK responsibility clears only on acknowledged-marker evidence. The
# settlement responsibility clears only on a fulfilled settlement result: a
# failed settlement survives host acknowledgment until fulfillment or an
# explicit owned resolution.
type Duty is Data:
  Duty{owner: OwnerInstance, attempt: Attempt, results: Results, wake_owed: Bool, ack_owed: Bool, settle_owed: Bool, errors: String}

# Typed refusals. A refusal before admission creates no duty and owns no
# cleanup.
type Refusal is Data:
  StaleSlot{current: U32}
  StaleOwner{current: String}
  UnknownAttempt{}

def binding_of(owner: OwnerInstance) -> String:
  match owner:
    case Owner{binding,token}: binding

def token_of(owner: OwnerInstance) -> String:
  match owner:
    case Owner{binding,token}: token

def owner_eq(+a: OwnerInstance, +b: OwnerInstance) -> Bool:
  Bool.and(String.eq(binding_of(a),binding_of(b)),String.eq(token_of(a),token_of(b)))

def id_of(attempt: Attempt) -> String:
  match attempt:
    case Attempt{id,directory,session,cutoff,generation}: id

def directory_of(attempt: Attempt) -> String:
  match attempt:
    case Attempt{id,directory,session,cutoff,generation}: directory

def session_of(attempt: Attempt) -> String:
  match attempt:
    case Attempt{id,directory,session,cutoff,generation}: session

def cutoff_of(attempt: Attempt) -> String:
  match attempt:
    case Attempt{id,directory,session,cutoff,generation}: cutoff

def generation_of(attempt: Attempt) -> U32:
  match attempt:
    case Attempt{id,directory,session,cutoff,generation}: generation

def attempt_eq(+a: Attempt, +b: Attempt) -> Bool:
  Bool.and(String.eq(id_of(a),id_of(b)),Bool.and(String.eq(directory_of(a),directory_of(b)),Bool.and(String.eq(session_of(a),session_of(b)),Bool.and(String.eq(cutoff_of(a),cutoff_of(b)),U32.is_eq(generation_of(a),generation_of(b))))))

def owner_of(duty: Duty) -> OwnerInstance:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}: owner

def attempt_of(duty: Duty) -> Attempt:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}: attempt

def results_of(duty: Duty) -> Results:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}: results

def wake_owed_of(duty: Duty) -> Bool:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}: wake_owed

def ack_owed_of(duty: Duty) -> Bool:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}: ack_owed

def settle_owed_of(duty: Duty) -> Bool:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}: settle_owed

def errors_of(duty: Duty) -> String:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}: errors

def session_of_slot(slot: Slot) -> String:
  match slot:
    case Slot{session,generation}: session

def generation_of_slot(slot: Slot) -> U32:
  match slot:
    case Slot{session,generation}: generation

# A new duty tracks all five invocations as open. The ACK responsibility
# exists from admission; the acknowledged marker is its only clearing
# evidence. No wake is owed before the attempt completes.
def open_duty(owner: OwnerInstance, attempt: Attempt) -> Duty:
  Duty{owner,attempt,Results{RefOpen{},RefOpen{},RefOpen{},RefOpen{},RefOpen{}},False{},True{},True{},""}

# Active-slot validation. A session or generation mismatch is a stale-slot
# refusal naming the current generation.
def check_slot(+slot: Slot, session: String, generation: U32) -> Result<&1,&1,Refusal,Slot>:
  Bool.pick(Result<&1,&1,Refusal,Slot>,Bool.and(String.eq(session_of_slot(slot),session),U32.is_eq(generation_of_slot(slot),generation)),Done{slot},Fail{StaleSlot{generation_of_slot(slot)}})

# The host supplies the replacement generation; this constructor only names
# the new active slot.
def advance_slot(slot: Slot, session: String, next_generation: U32) -> Slot:
  Slot{session,next_generation}

# Historical validation reads the duty's own owner instance and attempt
# record and never the current slot generation: attempt A's delivery, settle
# and ACK duties stay valid after attempt B replaces the slot.
def check_attempt(+duty: Duty, +owner: OwnerInstance, +attempt: Attempt) -> Result<&1,&1,Refusal,Duty>:
  Bool.pick(Result<&1,&1,Refusal,Duty>,owner_eq(owner_of(duty),owner),Bool.pick(Result<&1,&1,Refusal,Duty>,attempt_eq(attempt_of(duty),attempt),Done{duty},Fail{UnknownAttempt{}}),Fail{StaleOwner{token_of(owner_of(duty))}})

def put_native(results: Results, ref: Ref) -> Results:
  match results:
    case Results{native,delivery,settle,ack,continuation}: Results{ref,delivery,settle,ack,continuation}

def put_delivery(results: Results, ref: Ref) -> Results:
  match results:
    case Results{native,delivery,settle,ack,continuation}: Results{native,ref,settle,ack,continuation}

def put_settle(results: Results, ref: Ref) -> Results:
  match results:
    case Results{native,delivery,settle,ack,continuation}: Results{native,delivery,ref,ack,continuation}

def put_ack(results: Results, ref: Ref) -> Results:
  match results:
    case Results{native,delivery,settle,ack,continuation}: Results{native,delivery,settle,ref,continuation}

def put_continuation(results: Results, ref: Ref) -> Results:
  match results:
    case Results{native,delivery,settle,ack,continuation}: Results{native,delivery,settle,ack,ref}

def keep_error(errors: String, ref: Ref) -> String:
  match ref:
    case RefOpen{}: errors
    case RefDone{note}: errors
    case RefFail{error}: errors ++ error ++ "\n"

# Fulfillment is a recorded Done outcome. An open or failed invocation is
# unfulfilled: a failed delivery settles and still owes the wake.
def fulfilled(ref: Ref) -> Bool:
  match ref:
    case RefDone{note}: True{}
    case other: False{}

# The enumerated coordinator duties are clear only when the native outcome is
# qualified, the parent notice is fulfilled, and settlement is fulfilled.
def duty_clear(+native: Ref, +delivery: Ref, +settle: Ref) -> Bool:
  Bool.and(fulfilled(native),Bool.and(fulfilled(delivery),fulfilled(settle)))

# The attempt completed while owned: its outcome is recorded and the parent
# wake becomes owed until a delivery result records it as actually delivered.
def seal_completion(duty: Duty, +outcome: Ref) -> Duty:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}:
      Duty{owner,attempt,put_native(results,outcome),True{},ack_owed,settle_owed,keep_error(errors,outcome)}

def record_native(duty: Duty, +ref: Ref) -> Duty:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}:
      Duty{owner,attempt,put_native(results,ref),wake_owed,ack_owed,settle_owed,keep_error(errors,ref)}

# A Done delivery result records the observed delivered outcome naming the
# original report; only it clears the wake. A Fail delivery settles the
# invocation, retains the error, and leaves the wake owed. The fulfillment
# test is an argument, so the result reference is never a match scrutinee
# that is used again.
def record_delivery(duty: Duty, +ref: Ref) -> Duty:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}:
      Bool.pick(Duty,fulfilled(ref),Duty{owner,attempt,put_delivery(results,ref),False{},ack_owed,settle_owed,keep_error(errors,ref)},Duty{owner,attempt,put_delivery(results,ref),wake_owed,ack_owed,settle_owed,keep_error(errors,ref)})

def record_settle(duty: Duty, +ref: Ref) -> Duty:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}:
      Duty{owner,attempt,put_settle(results,ref),wake_owed,ack_owed,Bool.and(settle_owed,Bool.not(fulfilled(ref))),keep_error(errors,ref)}

# The ACK result clears the responsibility only with marker evidence.
def record_ack(duty: Duty, marker: Bool, +ref: Ref) -> Duty:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}:
      Duty{owner,attempt,put_ack(results,ref),wake_owed,Bool.and(ack_owed,Bool.not(marker)),settle_owed,keep_error(errors,ref)}

# A failed continuation never closes another attempt's work and changes no
# responsibility.
def record_continuation(duty: Duty, +ref: Ref) -> Duty:
  match duty:
    case Duty{owner,attempt,results,wake_owed,ack_owed,settle_owed,errors}:
      Duty{owner,attempt,put_continuation(results,ref),wake_owed,ack_owed,settle_owed,keep_error(errors,ref)}

def ref_open(ref: Ref) -> Bool:
  match ref:
    case RefOpen{}: True{}
    case other: False{}

def results_open(results: Results) -> Bool:
  match results:
    case Results{native,delivery,settle,ack,continuation}:
      Bool.or(ref_open(native),Bool.or(ref_open(delivery),Bool.or(ref_open(settle),Bool.or(ref_open(ack),ref_open(continuation)))))

# A duty is open while any invocation is unsettled or any responsibility is
# outstanding. A duty whose invocations all settled with Fail still closes
# once nothing is owed, and its retained errors stay readable.
def duty_open(+duty: Duty) -> Bool:
  Bool.or(results_open(results_of(duty)),Bool.or(wake_owed_of(duty),Bool.or(ack_owed_of(duty),settle_owed_of(duty))))

# The reconstructed ACK result preserves completed host duties: an
# acknowledged attempt records its qualified acknowledgment instead of a
# synthetic open invocation, so a notice-only duty can retire after the
# notice succeeds without reattaching to a cleaned-up child.
def ack_ref(acknowledged: Bool) -> Ref:
  match acknowledged:
    case True{}: RefDone{"acknowledged"}
    case False{}: RefOpen{}

# The pure rebuild decision over enumerated durable evidence. `acknowledged`
# is the attempt directory's acknowledged marker: it is the only clearing
# evidence for the ACK responsibility, and it never clears coordinator
# notification or settlement duties by themselves. An open or failed delivery
# ref keeps the wake owed; an open or failed settlement keeps the settlement
# responsibility. Retirement requires the marker AND fulfilled coordinator
# duties, so an unacknowledged attempt with fulfilled duties stays a duty
# with its acknowledgment responsibility. `continuation` is enumerated
# evidence: RefOpen while retained continuation duties are pending, and
# RefDone{"recovered"} only when the enumeration shows the previous
# process-local operations ended and their continuation duties are
# re-enumerated and owned by this recovery; the constructor settles no live
# join and confers no owner-replacement authority, which the host guard and
# custody acquisition establish. `errors` carries the enumerated retained
# error record; when the decision is empty the durable error record remains
# authoritative and no duty copy is retained. The clear decision is computed
# as an argument and matched as a parameter, so no computed expression is a
# match scrutinee. The enumeration that supplies these arguments is an
# explicit host-side owner interface.
def rebuild_decided(+attempt: Attempt, +owner: OwnerInstance, +acknowledged: Bool, +native: Ref, +delivery: Ref, +settle: Ref, +continuation: Ref, errors: String, clear: Bool) -> Maybe<Duty>:
  match clear:
    case True{}: None{}
    case False{}: Some{Duty{owner,attempt,Results{native,delivery,settle,ack_ref(acknowledged),continuation},Bool.not(fulfilled(delivery)),Bool.not(acknowledged),Bool.not(fulfilled(settle)),errors}}

def rebuild(attempt: Attempt, owner: OwnerInstance, +acknowledged: Bool, +native: Ref, +delivery: Ref, +settle: Ref, +continuation: Ref, errors: String) -> Maybe<Duty>:
  rebuild_decided(attempt,owner,acknowledged,native,delivery,settle,continuation,errors,Bool.and(acknowledged,duty_clear(native,delivery,settle)))

# --- laws -------------------------------------------------------------------

law rebuild_makes_no_input_receipt_claim:
  for +owner: OwnerInstance
  for +attempt: Attempt
  for +settle: Ref
  for +continuation: Ref
  for +errors: String
  {rebuild(attempt,owner,False{},RefDone{"enumerated"},RefDone{"none-pending"},settle,continuation,errors) == Some{Duty{owner,attempt,Results{RefDone{"enumerated"},RefDone{"none-pending"},settle,RefOpen{},continuation},False{},True{},Bool.not(fulfilled(settle)),errors}} : Maybe<Duty>}

def rebuild_makes_no_input_receipt_claim(owner,attempt,settle,continuation,errors):
  {==}

# An acknowledged attempt with a failed or open parent notice still owes the
# wake: the acknowledged marker never discharges coordinator duties.
law acknowledged_attempt_with_owed_notice_stays_a_duty:
  for +owner: OwnerInstance
  for +attempt: Attempt
  for +error: String
  {rebuild(attempt,owner,True{},RefDone{"status"},RefFail{error},RefDone{"settled"},RefDone{"recovered"},error) == Some{Duty{owner,attempt,Results{RefDone{"status"},RefFail{error},RefDone{"settled"},RefDone{"acknowledged"},RefDone{"recovered"}},True{},False{},False{},error}} : Maybe<Duty>}

def acknowledged_attempt_with_owed_notice_stays_a_duty(owner,attempt,error):
  {==}

# An unacknowledged attempt whose delivery failed keeps the wake owed: the
# settled Fail records the error and remains distinct from fulfillment.
law unacknowledged_failed_delivery_keeps_the_wake_owed:
  for +owner: OwnerInstance
  for +attempt: Attempt
  for +error: String
  {rebuild(attempt,owner,False{},RefDone{"status"},RefFail{error},RefDone{"settled"},RefDone{"recovered"},error) == Some{Duty{owner,attempt,Results{RefDone{"status"},RefFail{error},RefDone{"settled"},RefOpen{},RefDone{"recovered"}},True{},True{},False{},error}} : Maybe<Duty>}

def unacknowledged_failed_delivery_keeps_the_wake_owed(owner,attempt,error):
  {==}

# A fully fulfilled, acknowledged attempt leaves no open duty.
law acknowledged_fulfilled_duties_rebuild_empty:
  for +owner: OwnerInstance
  for +attempt: Attempt
  {rebuild(attempt,owner,True{},RefDone{"status"},RefDone{"report delivered"},RefDone{"settled"},RefDone{"recovered"},"") == None{} : Maybe<Duty>}

def acknowledged_fulfilled_duties_rebuild_empty(owner,attempt):
  {==}

# A failed settlement after host acknowledgment keeps the duty open: the
# settled Fail records the error and the settlement responsibility survives.
# The continuation reference is settled, so the open state isolates the
# settlement responsibility.
law a_failed_settlement_survives_host_acknowledgment:
  for +owner: OwnerInstance
  for +attempt: Attempt
  {Bool.and(duty_open(record_continuation(record_ack(record_settle(record_delivery(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),RefDone{"delivered"}),RefFail{"settle failed"}),True{},RefDone{"acknowledged"}),RefDone{"continued"})),settle_owed_of(record_continuation(record_ack(record_settle(record_delivery(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),RefDone{"delivered"}),RefFail{"settle failed"}),True{},RefDone{"acknowledged"}),RefDone{"continued"}))) == True{} : Bool}

def a_failed_settlement_survives_host_acknowledgment(owner,attempt):
  {==}

# A fulfilled settlement closes the completed duty without any child
# reattachment; every invocation, including the continuation, is settled and
# no responsibility is outstanding.
law a_fulfilled_settlement_closes_the_completed_duty:
  for +owner: OwnerInstance
  for +attempt: Attempt
  {duty_open(record_settle(record_continuation(record_ack(record_settle(record_delivery(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),RefDone{"delivered"}),RefFail{"settle failed"}),True{},RefDone{"acknowledged"}),RefDone{"continued"}),RefDone{"settled"})) == False{} : Bool}

def a_fulfilled_settlement_closes_the_completed_duty(owner,attempt):
  {==}

# A failed parent notice after host acknowledgment keeps the wake owed; the
# continuation reference is settled, so the open state isolates the wake.
law a_notice_failure_keeps_the_acknowledged_wake_owed:
  for +owner: OwnerInstance
  for +attempt: Attempt
  {wake_owed_of(record_continuation(record_ack(record_settle(record_delivery(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),RefFail{"notice failed"}),RefDone{"settled"}),True{},RefDone{"acknowledged"}),RefDone{"continued"})) == True{} : Bool}

def a_notice_failure_keeps_the_acknowledged_wake_owed(owner,attempt):
  {==}

# A delivered notice retry retires the acknowledged duty; every invocation is
# settled and no responsibility is outstanding.
law a_notice_retry_retires_the_acknowledged_duty:
  for +owner: OwnerInstance
  for +attempt: Attempt
  {duty_open(record_delivery(record_continuation(record_ack(record_settle(record_delivery(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),RefFail{"notice failed"}),RefDone{"settled"}),True{},RefDone{"acknowledged"}),RefDone{"continued"}),RefDone{"retry delivered"})) == False{} : Bool}

def a_notice_retry_retires_the_acknowledged_duty(owner,attempt):
  {==}

law attempt_validation_reads_the_attempt_record_not_the_slot:
  for +owner: OwnerInstance
  for +attempt: Attempt
  for +slot: Slot
  for +next: Slot
  {check_attempt(open_duty(owner,attempt),owner,attempt) == Done{open_duty(owner,attempt)} : Result<&1,&1,Refusal,Duty>}

def attempt_validation_reads_the_attempt_record_not_the_slot(owner,attempt,slot,next):
  {==}

law owner_check_decides_on_binding_and_token:
  for +duty: Duty
  for +token: String
  {check_attempt(duty,Owner{binding_of(owner_of(duty)),token},attempt_of(duty)) == Bool.pick(Result<&1,&1,Refusal,Duty>,String.eq(token_of(owner_of(duty)),token),Done{duty},Fail{StaleOwner{token_of(owner_of(duty))}}) : Result<&1,&1,Refusal,Duty>}

def owner_check_decides_on_binding_and_token(duty,token):
  {==}

# A retained attempt different from the duty's own record is refused as
# unknown even under the duty's own owner. The queried attempt is derived
# from the duty's own attempt by prefixing its id, and a string differs from
# its own six-character prefix extension, so the identity is guaranteed to
# differ.
law a_differing_attempt_is_refused_as_unknown:
  for +duty: Duty
  {check_attempt(duty,owner_of(duty),Attempt{"other-"++id_of(attempt_of(duty)),directory_of(attempt_of(duty)),session_of(attempt_of(duty)),cutoff_of(attempt_of(duty)),generation_of(attempt_of(duty))}) == Fail{UnknownAttempt{}} : Result<&1,&1,Refusal,Duty>}

def a_differing_attempt_is_refused_as_unknown(duty):
  {==}

law slot_check_accepts_the_current_generation:
  for +slot: Slot
  {check_slot(slot,session_of_slot(slot),generation_of_slot(slot)) == Done{slot} : Result<&1,&1,Refusal,Slot>}

def slot_check_accepts_the_current_generation(slot):
  {==}

law slot_check_decides_on_generation_equality:
  for +slot: Slot
  for +generation: U32
  {check_slot(slot,session_of_slot(slot),generation) == Bool.pick(Result<&1,&1,Refusal,Slot>,U32.is_eq(generation_of_slot(slot),generation),Done{slot},Fail{StaleSlot{generation_of_slot(slot)}}) : Result<&1,&1,Refusal,Slot>}

def slot_check_decides_on_generation_equality(slot,generation):
  {==}

law a_replaced_slot_refuses_a_superseded_generation:
  for +session: String
  for +old: U32
  for +next: U32
  {check_slot(advance_slot(Slot{session,old},session,next),session,old) == Bool.pick(Result<&1,&1,Refusal,Slot>,U32.is_eq(next,old),Done{Slot{session,next}},Fail{StaleSlot{next}}) : Result<&1,&1,Refusal,Slot>}

def a_replaced_slot_refuses_a_superseded_generation(session,old,next):
  {==}

law a_failed_delivery_settles_and_leaves_the_wake_owed:
  for +owner: OwnerInstance
  for +attempt: Attempt
  for +error: String
  {wake_owed_of(record_delivery(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),RefFail{error})) == True{} : Bool}

def a_failed_delivery_settles_and_leaves_the_wake_owed(owner,attempt,error):
  {==}

# A successful retry retains the failure evidence of the attempt it retries.
law a_successful_notice_retry_retains_its_failure_evidence:
  for +owner: OwnerInstance
  for +attempt: Attempt
  {errors_of(record_delivery(record_delivery(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),RefFail{"notice failed"}),RefDone{"delivered"})) == "notice failed\n" : String}

def a_successful_notice_retry_retains_its_failure_evidence(owner,attempt):
  {==}

# A fulfilled settlement retry retains the failure evidence of the settlement
# it retries.
law a_successful_settlement_retry_retains_its_failure_evidence:
  for +owner: OwnerInstance
  for +attempt: Attempt
  {errors_of(record_settle(record_settle(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),RefFail{"settle failed"}),RefDone{"settled"})) == "settle failed\n" : String}

def a_successful_settlement_retry_retains_its_failure_evidence(owner,attempt):
  {==}

law a_delivered_outcome_clears_the_wake:
  for +owner: OwnerInstance
  for +attempt: Attempt
  for +note: String
  {wake_owed_of(record_delivery(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),RefDone{note})) == False{} : Bool}

def a_delivered_outcome_clears_the_wake(owner,attempt,note):
  {==}

law an_ack_without_marker_evidence_keeps_the_responsibility:
  for +owner: OwnerInstance
  for +attempt: Attempt
  for +note: String
  {ack_owed_of(record_ack(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),False{},RefDone{note})) == True{} : Bool}

def an_ack_without_marker_evidence_keeps_the_responsibility(owner,attempt,note):
  {==}

law an_ack_with_the_marker_clears_the_responsibility:
  for +owner: OwnerInstance
  for +attempt: Attempt
  for +note: String
  {ack_owed_of(record_ack(seal_completion(open_duty(owner,attempt),RefDone{"exit 0"}),True{},RefDone{note})) == False{} : Bool}

def an_ack_with_the_marker_clears_the_responsibility(owner,attempt,note):
  {==}

law a_failed_continuation_retains_its_error_and_the_owed_flags:
  for +owner: OwnerInstance
  for +attempt: Attempt
  for +error: String
  for +exit: String
  {Bool.and(Bool.and(wake_owed_of(record_continuation(seal_completion(open_duty(owner,attempt),RefDone{exit}),RefFail{error})),ack_owed_of(record_continuation(seal_completion(open_duty(owner,attempt),RefDone{exit}),RefFail{error}))),Bool.not(String.eq(errors_of(record_continuation(seal_completion(open_duty(owner,attempt),RefDone{exit}),RefFail{error})),""))) == True{} : Bool}

def a_failed_continuation_retains_its_error_and_the_owed_flags(owner,attempt,error,exit):
  {==}
