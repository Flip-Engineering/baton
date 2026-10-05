import Base
import ../src/host/sqlite.bend as DB
import ../src/coordinator/commands.bend as C
import ../src/coordinator/direct-request.bend as D

def run(args: List<String>) -> IO(Unit):
  match args:
    case "readback" <> db <> id <> Nil{}:
      do IO<Unit>:
        saved : String <- IO.try(String,DB.Sql.query(db,D.readback_sql(id)))
        IO.write(saved)
    case db <> id <> directory <> task <> Nil{}:
      do IO<Unit>:
        saved : String <- IO.try(String,D.decide(db,id,D.Request{D.Assignment{"child","muse",Some{"owner"},Some{"owner"},"model","high","/workspace"},D.Invocation{"/endpoint","model","high","/workspace","/output","/task",task,None{},"","argv","initial",0}},D.Preparation{directory,"{\"pid\":42,\"birth\":\"fixture\"}",1},True{}))
        IO.write(saved)
    case db <> original <> requested <> Nil{}:
      do IO<Unit>:
        saved : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ D.mismatch(C.q(original),C.q(requested)) ++ ";"))
        IO.write(saved)
    case _: IO.die(Unit,2,"request fixture expects id directory task")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
