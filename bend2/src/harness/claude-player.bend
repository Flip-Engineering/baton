import Base
import ../host/process.bend as P
import ../json/canonical.bend as J

def arguments(cmd: String, model: String, effort: String) -> List<String>:
  [cmd,"--print","--input-format","stream-json","--output-format","stream-json","--verbose","--permission-mode","bypassPermissions","--model",model,"--effort",effort]

# The retained receive path builds the same argv the direct turn path spawns. A
# recorded session continues that conversation and an empty one starts fresh.
def argv(cmd: String, model: String, effort: String, session: String, fresh: Bool) -> String:
  match fresh:
    case True{}: P.argv(arguments(cmd,model,effort))
    case False{}: P.argv(List.append(&1,String,arguments(cmd,model,effort),["--resume",session]))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort)),cwd,stderr)

def resume_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(List.append(&1,String,arguments(cmd,model,effort),["--resume",session])),cwd,stderr)

def user_frame(text: String) -> String:
  "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":" ++ J.string_literal(text) ++ "}}\n"

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,user_frame(text))

# The profile route removes inherited authentication overrides and binds the selected
# credential store. An empty binding uses the harness's ordinary arguments.
def bound_head(binding: List<String>, cmd: String, model: String, effort: String) -> List<String>:
  match binding:
    case Nil{}: arguments(cmd,model,effort)
    case other: List.append(&1,String,List.append(&1,String,["/usr/bin/env","-u","ANTHROPIC_API_KEY","-u","ANTHROPIC_AUTH_TOKEN","-u","CLAUDE_CODE_OAUTH_TOKEN"],other),arguments(cmd,model,effort))

def bound_arguments(binding: List<String>, cmd: String, model: String, effort: String, session: String, fresh: Bool) -> List<String>:
  match fresh:
    case True{}: bound_head(binding,cmd,model,effort)
    case False{}: List.append(&1,String,bound_head(binding,cmd,model,effort),["--resume",session])

def argv_profile(binding: List<String>, cmd: String, model: String, effort: String, session: String, fresh: Bool) -> String:
  P.argv(bound_arguments(binding,cmd,model,effort,session,fresh))

def start_player_profile(binding: List<String>, cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(argv_profile(binding,cmd,model,effort,session,fresh),cwd,stderr)
