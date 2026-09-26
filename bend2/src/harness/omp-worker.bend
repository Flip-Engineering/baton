import Base
import ../host/process.bend as P

def arguments(cmd: String, model: String, effort: String, sessions: String) -> List<String>:
  [cmd,"--print","--mode","json","--model",model,"--thinking",effort,"--approval-mode","yolo","--session-dir",sessions]

def start_worker(cmd: String, model: String, effort: String, cwd: String, +log: String, sessions: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort,sessions)),cwd,log ++ ".stderr")
    case False{}: P.ProcessChild.spawn(P.argv(List.append(&1,String,arguments(cmd,model,effort,sessions),["--resume",session])),cwd,log ++ ".stderr")

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,text)
