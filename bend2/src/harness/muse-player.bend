import Base
import ../host/process.bend as P

def arguments(cmd: String, model: String, effort: String, task: String) -> List<String>:
  [cmd,"exec","--json","--prompt-file",task,"--model",model,"--reasoning-effort",effort,"--yolo"]

# A retained prompt is stored as a private file in the admitted attempt. The
# native session id remains an argv value on resumed retained turns.
def retained_arguments(cmd: String, model: String, effort: String, prompt_file: String, session: String) -> List<String>:
  Bool.pick(List<String>,String.is_empty(session),arguments(cmd,model,effort,prompt_file),List.append(&1,String,arguments(cmd,model,effort,prompt_file),["--session-id",session]))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort,task)),cwd,stderr)

def resume_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(List.append(&1,String,arguments(cmd,model,effort,task),["--session-id",session])),cwd,stderr)

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
