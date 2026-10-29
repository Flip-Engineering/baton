# Focused command entry for conductor succession and live-parent report
# routing (#1257). It runs the coordinator's command parser and store for the
# commands a succession fixture needs, and the stop request admission that
# announces a stopped session's children, without a full Main build.
#
# usage: succession-focused --instance-owner DB | --instance-shutdown DB
#        succession-focused DB stop-request SESSION STOP_ID REASON
#        succession-focused DB COMMAND ARGS   (any command the parser accepts)
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/coordinator/stop.bend as Stop
import ../src/host/instance.bend as Custody

def output(value: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.")
    case False{}: IO.write(value)

def print_result(+result: String) -> IO(Unit):
  output(result, String.is_empty(result))

def apply_args(+db: String, args: List<String>) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,Store.apply(db,C.parse(args)))
    print_result(result)

def dispatch(+db: String, args: List<String>) -> IO(Unit):
  match args:
    case "stop-request" <> session <> id <> reason <> Nil{}: do IO<Unit>:
      error : String <- IO.try(String,Stop.request(db,session,id,reason,False{}))
      Stop.validate(error)
    case other: apply_args(db,other)

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case path <> rest: dispatch(path,rest)
    case Nil{}: IO.die(Unit,2,"usage: succession-focused DB COMMAND ARGS")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
