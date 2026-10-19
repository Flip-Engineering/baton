# Focused entry for the credit intermediary. It exposes the per-request
# admission and settlement policy without building the coordinator:
#   credit-intermediary DB admit REQUEST ATTEMPT ACCOUNT SESSION
#   credit-intermediary DB settle REQUEST AMOUNT SOURCE CONDITION
import Base
import ../src/coordinator/accounts.bend as A

def dispatch(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +db <> "admit" <> +request <> +attempt <> +account <> +session <> Nil{}:
      do IO<Unit>:
        answer : String <- A.credit_admit_http_request(db,attempt,account,session,request)
        IO.print(answer)
    case +db <> "settle" <> +request <> +amount <> +source <> +condition <> Nil{}:
      do IO<Unit>:
        answer : String <- A.credit_settle_http_request(db,request,amount,source,condition)
        IO.print(answer)
    case other: IO.die(Unit,2,"usage: credit-intermediary DB admit REQUEST ATTEMPT ACCOUNT SESSION | settle REQUEST AMOUNT SOURCE CONDITION")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    dispatch(arguments)
