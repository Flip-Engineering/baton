# The root channel check (#1054, #1217). 'warn DB' runs the check that status,
# session and orchestra run. 'message DB ID' runs the check for one committed
# message. 'report DB ID' drives a committed report through the wake driver the
# way a report command does. 'deliver DB ID' runs the delivery route for one
# committed message and prints its result. The store starts its instance owner
# by running this binary with '--instance-owner DB'.
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/coordinator/root-channel.bend as RootChannel
import ../src/coordinator/wake.bend as Wake
import ../src/coordinator/delivery.bend as Delivery
import ../src/host/instance.bend as Custody

def driven(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.print("driven")
    case Fail{(code,text)}: IO.die(Unit,1,"failed " ++ U32.show(code) ++ ": " ++ text)

def report(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Unit> <- Wake.drive_command(db,C.Report{id,"lead",""},Done{""})
    driven(result)

def delivered(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{saved}: IO.print("delivered")
    case Fail{(code,text)}: IO.die(Unit,1,"failed " ++ U32.show(code) ++ ": " ++ text)

def deliver(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id,"1","")
    delivered(result)

def route(args: List<String>) -> IO(Unit):
  match args:
    case "install" <> db <> Nil{}: Store.ensure_before_begin(db)
    case "warn" <> db <> Nil{}: RootChannel.warn(db)
    case "message" <> db <> id <> Nil{}: RootChannel.warn_message(db,id)
    case "report" <> db <> id <> Nil{}: report(db,id)
    case "deliver" <> db <> id <> Nil{}: deliver(db,id)
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case other: IO.die(Unit,2,"usage: root-channel install|warn DB | message|report|deliver DB ID")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    route(args)
