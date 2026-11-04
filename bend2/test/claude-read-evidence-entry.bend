import Base
import ../src/coordinator/claude-read-evidence.bend as Evidence

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    match args:
      case session <> event <> Nil{}: IO.print(Evidence.selection_sql(session,event))
      case other: IO.die(Unit,2,"usage: claude-read-evidence-entry SESSION EVENT_JSON")
