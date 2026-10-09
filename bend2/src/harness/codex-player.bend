import Base
import ../host/process.bend as P
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

# The public Unix daemon queues input for the recorded Codex thread.
def queue_admission(thread: String, pointer: String) -> List<String>:
  ["codex","queue","--remote","unix://","--thread",thread,"--message",pointer]

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
