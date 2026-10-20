import Base
import ../host/process.bend as P

def models_args(cmd: String, model: String) -> List<String>:
  [cmd,"model-profile","show",model]

def arguments(cmd: String, +model: String, effort: String, task: String) -> List<String>:
  List.append(&1,String,[cmd,"exec","--json","--prompt-file",task,"--model",model,"--reasoning-effort",effort,"--yolo"],Bool.pick(List<String>,String.eq(model,"muse-spark-1.3-contributor"),["--contributor-mode","on"],Nil{}))

def resume_arguments(cmd: String, model: String, effort: String, task: String, +session: String) -> List<String>:
  List.append(&1,String,arguments(cmd,model,effort,task),Bool.pick(List<String>,String.is_empty(session),Nil{},["--session-id",session,"--allow-workspace-switch"]))

def argv_profile(binding: List<String>, cmd: String, model: String, effort: String, task: String, session: String) -> String:
  match binding:
    case Nil{}: P.argv(resume_arguments(cmd,model,effort,task,session))
    case other: P.argv(List.append(&1,String,["/usr/bin/env"],List.append(&1,String,binding,resume_arguments(cmd,model,effort,task,session))))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort,task)),cwd,stderr)

def resume_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(resume_arguments(cmd,model,effort,task,session)),cwd,stderr)

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
