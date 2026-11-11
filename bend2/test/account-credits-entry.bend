import Base
import ../src/coordinator/accounts.bend as A

# Focused native account command entry. It imports the real account module and
# exposes the account, handoff, current-account and attempt operations without
# building the full coordinator:
#   account-credits-entry DB account ACTION ID PROVIDER HARNESS FUNDING SECRET REF ORGANIZATION DETAIL SESSION
#   account-credits-entry DB handoff SESSION ID EVENT
#   account-credits-entry DB current SESSION HARNESS
#   account-credits-entry DB attempt SESSION HARNESS ATTEMPT PREDECESSOR

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
    case +db <> "current" <> +session <> +harness <> Nil{}:
      do IO<Unit>:
        account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
        current_decided(account)
    case +db <> "attempt" <> +session <> +harness <> +attempt <> +predecessor <> Nil{}:
      do IO<Unit>:
        account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
        recorded : Unit <- A.record_current_attempt(db,session,attempt,predecessor,account)
        IO.print("attempt-recorded")
    case other: IO.die(Unit,2,"account-credits-entry: account|handoff|current|attempt")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    dispatch(arguments)
