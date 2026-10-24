# Records one terminal native frame for attempt receive:worker:9:beef the way
# the observer does (#1054, instance B2). 'install DB' creates the schema;
# 'observe DB' applies the frame and prints the store's answer. The store
# starts its instance owner by running this binary with '--instance-owner DB'.
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/host/instance.bend as Custody

def answered(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{saved}: IO.print("observed")
    case Fail{(code,text)}: IO.die(Unit,1,"failed " ++ U32.show(code) ++ ": " ++ text)

def observe(+db: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- Store.apply_through_busy(db,C.Observe{"receive:worker:9:beef","worker","{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"Turn finished.\",\"session_id\":\"native-1\"}",False{}})
    answered(result)

def route(args: List<String>) -> IO(Unit):
  match args:
    case "install" <> db <> Nil{}: Store.ensure_before_begin(db)
    case "observe" <> db <> Nil{}: observe(db)
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case other: IO.die(Unit,2,"usage: observe-busy install|observe DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    route(args)
