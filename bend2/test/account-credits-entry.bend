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
    case other: IO.die(Unit,2,"account-credits-entry: account|handoff|current|attempt|gate|complete")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    dispatch(arguments)
