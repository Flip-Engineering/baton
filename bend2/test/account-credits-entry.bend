import Base
import ../src/coordinator/accounts.bend as A

# Focused native account command entry. It imports the real account module and
# exposes the account, handoff, current-account and attempt operations without
# building the full coordinator:
#   account-credits-entry DB account ACTION ID PROVIDER HARNESS FUNDING SECRET REF ORGANIZATION DETAIL SESSION
#   account-credits-entry DB handoff SESSION ID EVENT
#   account-credits-entry DB current SESSION HARNESS
#   account-credits-entry DB attempt SESSION HARNESS ATTEMPT PREDECESSOR

def gate_head(head: Maybe<&1,String>) -> IO(Unit):
  match head:
    case None{}: IO.print("refused empty-binding")
    case Some{+value}: IO.print(value)

def authorize_decided(+db: String, +session: String, +attempt: String, account: Maybe<&2,A.AccountRecord>) -> IO(Bool):
  match account:
    case None{}: IO.pure(Bool,False{})
    case Some{+chosen}: A.credit_record_authorization(db,session,attempt,chosen)

def gate_decided(binding: Maybe<List<String>>, +refusal: String) -> IO(Unit):
  match binding:
    case None{}: IO.print("refused " ++ refusal)
    case Some{values}: gate_head(List.head(&1,String,values))

def current_decided(account: Maybe<&2,A.AccountRecord>) -> IO(Unit):
  match account:
    case None{}: IO.print("")
    case Some{+chosen}: IO.print(A.account_id(chosen))

def binding_text(values: List<String>) -> String:
  match values:
    case first <> second <> rest: first ++ "|" ++ second
    case first <> rest: first
    case Nil{}: ""

def admission_line(decision: A.CreditAdmission) -> String:
  match decision:
    case A.CAdmitted{organization,cycle,reserved_total,balance_after_reserve,cap_after_reserve}:
      "admitted|" ++ organization ++ "|" ++ cycle ++ "|" ++ reserved_total ++ "|" ++ balance_after_reserve ++ "|" ++ cap_after_reserve
    case A.CRefused{reason}: "refused|" ++ reason

def gate_line(pair: Maybe<List<String>> & String) -> String:
  (binding,refusal)=pair
  match binding:
    case Some{values}: "binding|" ++ binding_text(values) ++ "|" ++ refusal
    case None{}: "refused|" ++ refusal

def reserve_decided(+db: String, +session: String, +attempt: String, +cap: String, account: Maybe<&2,A.AccountRecord>) -> IO(Unit):
  match account:
    case None{}: IO.print("refused|accountAbsent")
    case Some{+chosen}: do IO<Unit>:
      decision : A.CreditAdmission <- A.credit_reserve_for(db,session,attempt,chosen,cap)
      IO.print(admission_line(decision))

def dispatch(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +db <> "account" <> +action <> +id <> +provider <> +harness <> +funding <> +secret <> +organization <> +detail <> +session <> Nil{}:
      A.run(db,action,id,provider,harness,funding,secret,organization,detail,session)
    case +db <> "handoff" <> +session <> +id <> +event <> Nil{}:
      do IO<Unit>:
        advanced : Bool <- A.handoff(db,session,id,event,"","","")
        IO.print(Bool.pick(String,advanced,"advanced","exhausted"))
    case +db <> "gate" <> +session <> +harness <> +attempt <> Nil{}:
      do IO<Unit>:
        +account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
        refusal : String <- A.credit_launch_refusal_for(db,account)
        binding : Maybe<List<String>> <- A.credit_launch_binding(db,session,attempt,harness,account,Some{"/fixture/api-key-exec"},"")
        gate_decided(binding,refusal)
    case +db <> "authorize" <> +session <> +harness <> +attempt <> Nil{}:
      do IO<Unit>:
        +account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
        recorded : Bool <- authorize_decided(db,session,attempt,account)
        IO.print(Bool.pick(String,recorded,"authorized","not-authorized"))
    case +db <> "complete" <> +attempt <> +outcome <> +detail <> Nil{}:
      do IO<Unit>:
        completed : Unit <- A.attempt_completed(db,attempt,outcome,detail)
        IO.print("attempt-completed")
    case +db <> "current" <> +session <> +harness <> Nil{}:
      do IO<Unit>:
        +account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
        current_decided(account)
    case +db <> "attempt" <> +session <> +harness <> +attempt <> +predecessor <> Nil{}:
      do IO<Unit>:
        +account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
        recorded : Unit <- A.record_current_attempt(db,session,attempt,predecessor,account)
        IO.print("attempt-recorded")
    case +db <> "reserve" <> +session <> +harness <> +attempt <> +cap <> Nil{}:
      do IO<Unit>:
        +account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
        reserve_decided(db,session,attempt,cap,account)
    case +db <> "settle" <> +request <> +outcome <> +cost <> Nil{}:
      do IO<Unit>:
        state : String <- A.credit_settle_for(db,request,outcome,cost,False{})
        IO.print(state)
    case +db <> "reconcile" <> +request <> +cost <> Nil{}:
      do IO<Unit>:
        state : String <- A.credit_settle_for(db,request,"reconciled",cost,True{})
        IO.print(state)
    case +db <> "gate-qualified" <> +session <> +harness <> +attempt <> Nil{}:
      do IO<Unit>:
        +account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
        pair : Maybe<List<String>> & String <- A.credit_launch_gate(db,session,attempt,harness,account,Some{"/fixture/api-key-exec"},"",True{})
        IO.print(gate_line(pair))
    case +db <> "gate-held" <> +session <> +harness <> +attempt <> Nil{}:
      do IO<Unit>:
        +account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
        pair : Maybe<List<String>> & String <- A.credit_launch_gate(db,session,attempt,harness,account,Some{"/fixture/api-key-exec"},"",False{})
        IO.print(gate_line(pair))
    case other: IO.die(Unit,2,"account-credits-entry: account|handoff|current|attempt|gate|complete|reserve|settle|reconcile|gate-qualified|gate-held")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    dispatch(arguments)
