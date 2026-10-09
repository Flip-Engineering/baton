import Base
import ../host/process.bend as P

def models_args(cmd: String, model: String) -> List<String>:
  [cmd,"model-profile","show",model]

def arguments(cmd: String, model: String, effort: String, task: String) -> List<String>:
  [cmd,"exec","--json","--prompt-file",task,"--model",model,"--reasoning-effort",effort,"--yolo"]

def resume_arguments(cmd: String, model: String, effort: String, task: String, +session: String) -> List<String>:
  List.append(&1,String,arguments(cmd,model,effort,task),Bool.pick(List<String>,String.is_empty(session),Nil{},["--session-id",session,"--allow-workspace-switch"]))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort,task)),cwd,stderr)

def resume_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(resume_arguments(cmd,model,effort,task,session)),cwd,stderr)

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
