import Base
import ../host/process.bend as P
import ../json/canonical.bend as J
import ../host/files.bend as F

def select_file(directory: String, +session: String, +first: String, found: Bool) -> IO(String):
  match found:
    case True{}: IO.pure(String,first)
    case False{}: do IO<String>:
      +second : String <- IO.try(String,F.Files.find_suffix(directory,"_" ++ session ++ ".jsonl"))
      IO.pure(String,Bool.pick(String,String.is_empty(second),session,second))

# OMP accepts a session file path when continuing across worker and lead stores.
def resume_file(primary: String, alternate: String, +session: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,session)
    case True{}: do IO<String>:
      +first : String <- IO.try(String,F.Files.find_suffix(primary,"_" ++ session ++ ".jsonl"))
      select_file(alternate,session,first,Bool.not(String.is_empty(first)))

def arguments(cmd: String, model: String, effort: String, sessions: String) -> List<String>:
  [cmd,"--mode","rpc","--model",model,"--thinking",effort,"--approval-mode","yolo","--session-dir",sessions]

def start_worker(cmd: String, model: String, effort: String, cwd: String, +log: String, sessions: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort,sessions)),cwd,log ++ ".stderr")
    case False{}: P.ProcessChild.spawn(P.argv(List.append(&1,String,arguments(cmd,model,effort,sessions),["--resume",session])),cwd,log ++ ".stderr")

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,"{\"type\":\"get_state\",\"id\":\"baton:session\"}\n{\"type\":\"prompt\",\"id\":\"baton:prompt\",\"message\":" ++ J.string_literal(text) ++ "}\n")
