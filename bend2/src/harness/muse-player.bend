import Base
import ../host/process.bend as P

def models_args(cmd: String, model: String) -> List<String>:
  [cmd,"model-profile","show",model]

def arguments(cmd: String, +model: String, effort: String, task: String) -> List<String>:
  List.append(&1,String,[cmd,"exec","--json","--prompt-file",task,"--model",model,"--reasoning-effort",effort,"--yolo"],Bool.pick(List<String>,String.eq(model,"muse-spark-1.3-contributor"),["--contributor-mode","on"],Nil{}))

def resume_arguments(cmd: String, model: String, effort: String, task: String, +session: String) -> List<String>:
  List.append(&1,String,arguments(cmd,model,effort,task),Bool.pick(List<String>,String.is_empty(session),Nil{},["--session-id",session,"--allow-workspace-switch"]))

# The configured profile store precedes the command when it names one. An empty
# binding reproduces the ordinary argv exactly.
def bound_head(binding: List<String>, cmd: String, model: String, effort: String, task: String) -> List<String>:
  match binding:
    case Nil{}: arguments(cmd,model,effort,task)
    case other: List.append(&1,String,Con{"/usr/bin/env",other},arguments(cmd,model,effort,task))

def bound_arguments(binding: List<String>, cmd: String, model: String, effort: String, task: String, +session: String, fresh: Bool) -> List<String>:
  match fresh:
    case True{}: bound_head(binding,cmd,model,effort,task)
    case False{}: List.append(&1,String,bound_head(binding,cmd,model,effort,task),Bool.pick(List<String>,String.is_empty(session),Nil{},["--session-id",session,"--allow-workspace-switch"]))

def argv_profile(binding: List<String>, cmd: String, model: String, effort: String, task: String, session: String, fresh: Bool) -> String:
  P.argv(bound_arguments(binding,cmd,model,effort,task,session,fresh))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort,task)),cwd,stderr)

def resume_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(resume_arguments(cmd,model,effort,task,session)),cwd,stderr)

def start_player_profile(binding: List<String>, cmd: String, model: String, effort: String, cwd: String, stderr: String, task: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(argv_profile(binding,cmd,model,effort,task,session,fresh),cwd,stderr)

# Muse reads its configuration at startup and extracts no addon below HOME, so
# this launch adds no preflight. An invalid XDG_CONFIG_HOME is reported by Muse.

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
