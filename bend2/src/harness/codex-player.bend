import Base
import ../host/process.bend as P
import ../host/session-lock.bend as Lock
import ../json/canonical.bend as J

def models_args(cmd: String) -> List<String>:
  [cmd,"debug","models"]

def arguments(model: String, effort: String) -> List<String>:
  ["--json","--model",model,"-c","model_reasoning_effort=" ++ J.string_literal(effort),"--dangerously-bypass-approvals-and-sandbox","-"]

def argv(cmd: String, model: String, effort: String, session: String, fresh: Bool) -> String:
  match fresh:
    case True{}: P.argv(List.append(&1,String,["/usr/bin/env","-u","OPENAI_API_KEY","-u","CODEX_API_KEY",cmd,"-c","forced_login_method=\"chatgpt\"","exec"],arguments(model,effort)))
    case False{}: P.argv(List.append(&1,String,["/usr/bin/env","-u","OPENAI_API_KEY","-u","CODEX_API_KEY",cmd,"-c","forced_login_method=\"chatgpt\"","exec","resume",session],arguments(model,effort)))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(argv(cmd,model,effort,session,fresh),cwd,stderr)

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,text)

def wake_directory_step(+rest: String, +current: String, +last: String) -> String:
  match rest:
    case SNil{}: last
    case SCon{+head,+tail}:
      +next = current ++ SCon{head,SNil{}}
      wake_directory_step(tail,next,Bool.pick(String,Char.is_eq(head,Char.from_u32(47)),next,last))

def wake_directory(executable: String) -> String:
  wake_directory_step(executable,"","")

def wake_source_result(code: U32, detail: String, source: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,String>:
  match source:
    case Done{path}: Done{path}
    case Fail{(source_code,source_detail)}:
      Fail{(source_code,"Installed Codex inbox helper: " ++ U32.show(code) ++ ": " ++ detail ++ "\nSource Codex inbox helper: " ++ U32.show(source_code) ++ ": " ++ source_detail)}

def wake_source_path(installed: Result<&1,&1,U32 & String,String>, source: String) -> IO(Result<&1,&1,U32 & String,String>):
  match installed:
    case Done{path}: IO.pure(Result<&1,&1,U32 & String,String>,Done{path})
    case Fail{(code,detail)}: do IO<Result<&1,&1,U32 & String,String>>:
      resolved : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(source)
      IO.pure(Result<&1,&1,U32 & String,String>,wake_source_result(code,detail,resolved))

def wake_path(+executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +directory : String = wake_directory(executable)
    installed : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(directory ++ "../libexec/baton2/codex-inbox-wake.mjs")
    wake_source_path(installed,directory ++ "../../bend2/scripts/codex-inbox-wake.mjs")

def wake_start(path: Result<&1,&1,U32 & String,String>, thread: String, pointer: String, stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
  match path:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,U32>,Fail{error})
    case Done{script}: P.ProcessChild.spawn(P.argv(["node",script,thread,pointer]),".",stderr)

def inbox_admission(executable: Result<&1,&1,U32 & String,String>, thread: String, pointer: String, stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
  match executable:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,U32>,Fail{error})
    case Done{path}: do IO<Result<&1,&1,U32 & String,U32>>:
      script : Result<&1,&1,U32 & String,String> <- wake_path(path)
      wake_start(script,thread,pointer,stderr)

# The profile variant keeps the existing key unbinds first, then the profile's store
# assignment, then the command: env parses its options before its operands, so a
# leading assignment would otherwise make "-u" the executed command. An empty binding
# reproduces today's argv exactly. The override list is the provider's own preserved
# history home, an ordinary config argument placed with the command's other config
# arguments and before the exec verb; an empty override adds nothing.
def bound_head(binding: List<String>, override: List<String>, cmd: String, resume: Bool, session: String) -> List<String>:
  List.append(&1,String,List.append(&1,String,List.append(&1,String,["/usr/bin/env","-u","OPENAI_API_KEY","-u","CODEX_API_KEY"],binding),Con{cmd,List.append(&1,String,override,["-c","forced_login_method=\"chatgpt\"","exec"])}),Bool.pick(List<String>,resume,["resume",session],Nil{}))

def bound_arguments(binding: List<String>, override: List<String>, cmd: String, model: String, effort: String, session: String, fresh: Bool) -> List<String>:
  match fresh:
    case True{}: List.append(&1,String,bound_head(binding,override,cmd,False{},session),arguments(model,effort))
    case False{}: List.append(&1,String,bound_head(binding,override,cmd,True{},session),arguments(model,effort))

def argv_profile(binding: List<String>, override: List<String>, cmd: String, model: String, effort: String, session: String, fresh: Bool) -> String:
  P.argv(bound_arguments(binding,override,cmd,model,effort,session,fresh))

def start_player_profile(binding: List<String>, override: List<String>, cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(argv_profile(binding,override,cmd,model,effort,session,fresh),cwd,stderr)
