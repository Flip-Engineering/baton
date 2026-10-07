import Base
import ../host/process.bend as P
import ../json/canonical.bend as J

def arguments(+: String, +: String) -> List<String>:
  ["--json","--model",model,"-c","model_reasoning_effort=" ++ J.string_literal(effort),"--dangerously-bypass-approvals-and-sandbox","-"]

def argv(+: String, +: String, effort: String, session: String, fresh: Bool) -> String:
  match fresh:
    case True{}: P.argv(List.append(&1,String,["/usr/bin/env","-u","OPENAI_API_KEY","-u","CODEX_API_KEY",cmd,"-c","forced_login_method=\"chatgpt\"","exec"],arguments(model,effort)))
    case False{}: P.argv(List.append(&1,String,["/usr/bin/env","-u","OPENAI_API_KEY","-u","CODEX_API_KEY",cmd,"-c","forced_login_method=\"chatgpt\"","exec","resume",session],arguments(model,effort)))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(argv(cmd,model,effort,session,fresh),cwd,stderr)

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,text)
