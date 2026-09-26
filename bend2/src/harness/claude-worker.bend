import Base
import ../host/process.bend as P
import ../json/canonical.bend as J

def arguments(cmd: String, model: String, effort: String) -> List<String>:
  [cmd,"--print","--input-format","stream-json","--output-format","stream-json","--verbose","--permission-mode","bypassPermissions","--model",model,"--effort",effort]

def start_worker(cmd: String, model: String, effort: String, cwd: String, stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort)),cwd,stderr)

def resume_worker(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(List.append(&1,String,arguments(cmd,model,effort),["--resume",session])),cwd,stderr)

def user_frame(text: String) -> String:
  "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":" ++ J.string_literal(text) ++ "}}\n"

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,user_frame(text))
