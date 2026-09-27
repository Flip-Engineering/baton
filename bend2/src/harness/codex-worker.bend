import Base
import ../host/process.bend as P
import ../json/canonical.bend as J

def arguments(model: String, effort: String) -> List<String>:
  ["--json","--model",model,"-c","model_reasoning_effort=" ++ J.string_literal(effort),"--dangerously-bypass-approvals-and-sandbox","-"]

def start_worker(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: P.ProcessChild.spawn(P.argv(List.append(&1,String,[cmd,"exec"],arguments(model,effort))),cwd,stderr)
    case False{}: P.ProcessChild.spawn(P.argv(List.append(&1,String,[cmd,"exec","resume",session],arguments(model,effort))),cwd,stderr)

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,text)
