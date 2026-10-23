import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/coordinator/recruit.bend as Recruit
import ../src/coordinator/agent-command.bend as Agent
import ../src/coordinator/agent-actions.bend as A
import ../src/coordinator/agent-native.bend as Native
import ../src/coordinator/agent-route.bend as Route
import ../src/host/instance.bend as Custody

# Exercise command preparation and stored admission with delivery left pending.
def execute(+db: String, command: C.Command) -> IO(Unit):
  match command:
    case C.Recruit{id,parent,harness,model,effort,repo,branch,path,base}:
      Recruit.recruit(db,id,parent,harness,model,effort,repo,branch,path,base)
    case C.Join{id,parent,harness,model,effort,path}:
      Recruit.join(db,id,parent,harness,model,effort,path)
    case other: do IO<Unit>:
      saved : String <- IO.try(String,Store.apply(db,other))
      IO.write(saved)

def prepared(request: Agent.PreparedRequest) -> IO(Unit):
  match request:
    case Agent.Prepared{db,session,action}:
      match action:
        case A.Native{items}: do IO<Unit>:
          saved : String <- Native.operations(db,session,items)
          IO.write(saved)
        case A.Invalid{cause}: IO.die(Unit,2,cause)
        case other: IO.die(Unit,2,"unsupported focused messaging action")

def legacy(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case +db <> "agent-native-input" <> Nil{}: do IO<Unit>:
      args : List<String> <- Native.input(db)
      execute(db,C.parse(args))
    case db <> args: execute(db,C.parse(args))
    case other: IO.die(Unit,2,"expected database and messaging command")

def route(request: Route.Route) -> IO(Unit):
  match request:
    case Route.Action{context}: do IO<Unit>:
      request : Agent.PreparedRequest <- Agent.prepare_request(context)
      prepared(request)
    case Route.Legacy{args}: legacy(args)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    route(Route.parse(args))
