import Base
import ../host/process.bend as P

def arguments(cmd: String, model: String, effort: String) -> List<String>:
  [cmd,"exec","--json","--model",model,"--reasoning-effort",effort,"--yolo"]

def start_worker(cmd: String, model: String, effort: String, cwd: String, stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort)),cwd,stderr)

def resume_worker(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv([cmd,"resume",session,"--json","--model",model,"--reasoning-effort",effort,"--yolo"]),cwd,stderr)

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,text)
