import Base
import ../host/process.bend as P

def arguments(cmd: String, model: String, effort: String, task: String) -> List<String>:
  [cmd,"exec","--json","--prompt-file",task,"--model",model,"--reasoning-effort",effort,"--yolo"]

# The retained receive path builds the same argv the direct turn path spawns. A
# recorded session continues that conversation and an empty one starts fresh.
def argv(cmd: String, model: String, effort: String, task: String, session: String, fresh: Bool) -> String:
  match fresh:
    case True{}: P.argv(arguments(cmd,model,effort,task))
    case False{}: P.argv(List.append(&1,String,arguments(cmd,model,effort,task),["--session-id",session]))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort,task)),cwd,stderr)

def resume_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(List.append(&1,String,arguments(cmd,model,effort,task),["--session-id",session])),cwd,stderr)

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
