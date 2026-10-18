import Base
import ../src/coordinator/recruit.bend as Recruit

# A focused driver that exercises the coordinator's production join implementation.
# It validates player registration in an existing workspace.
def run(args: List<String>) -> IO(Unit):
  match args:
    case db <> id <> parent <> harness <> model <> effort <> path <> Nil{}:
      Recruit.join(db,id,parent,harness,model,effort,path)
    case other: IO.die(Unit,2,"repl-join-entry DATABASE SESSION PARENT HARNESS MODEL EFFORT PATH")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
