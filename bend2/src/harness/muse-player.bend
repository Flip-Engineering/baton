import Base
import ../host/process.bend as P
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock
import ../git/text.bend as Tx
import ../json/canonical.bend as J

def models_args(cmd: String, model: String) -> List<String>:
  [cmd,"model-profile","show",model]

def arguments(cmd: String, model: String, effort: String, task: String) -> List<String>:
  [cmd,"exec","--json","--prompt-file",task,"--model",model,"--reasoning-effort",effort,"--yolo"]

def resume_arguments(cmd: String, model: String, effort: String, task: String, +session: String) -> List<String>:
  List.append(&1,String,arguments(cmd,model,effort,task),Bool.pick(List<String>,String.is_empty(session),Nil{},["--session-id",session,"--allow-workspace-switch"]))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort,task)),cwd,stderr)

def resume_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(resume_arguments(cmd,model,effort,task,session)),cwd,stderr)

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def error_text(error: U32 & String) -> String:
  (code,detail)=error
  U32.show(code) ++ ": " ++ detail

def unavailable(+code: String, +detail: String) -> String:
  "{\"status\":\"unavailable\",\"diagnostic\":{\"code\":" ++ J.string_literal(code) ++ ",\"detail\":" ++ J.string_literal(detail) ++ "}}"

def drop_to_slash(s: String) -> Maybe<String>:
  match s:
    case SNil{}: None{}
    case SCon{+head,+tail}:
      Bool.pick(Maybe<String>,Char.is_eq(head,Char.from_u32(47)),Some{tail},drop_to_slash(tail))

def directory_of_rev(rev: Maybe<String>) -> Maybe<String>:
  match rev:
    case None{}: None{}
    case Some{+rest}: Some{Tx.str_rev(rest)}

def directory_of(path: String) -> Maybe<String>:
  directory_of_rev(drop_to_slash(Tx.str_rev(path)))

def installed_helper(dir: Maybe<String>) -> String:
  match dir:
    case None{}: ""
    case Some{+parent}: parent ++ "/../libexec/baton2/muse-final-response.mjs"

def source_helper(dir: Maybe<String>) -> String:
  match dir:
    case None{}: ""
    case Some{+parent}: parent ++ "/../../bend2/scripts/muse-final-response.mjs"

def helper_choice(installed: Result<&1,&1,U32 & String,String>, source: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,String>:
  match installed:
    case Done{path}: Done{path}
    case Fail{error}:
      match source:
        case Done{path}: Done{path}
        case Fail{source_error}: Fail{source_error}

def helper(+executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    installed : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(installed_helper(directory_of(executable)))
    source : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(source_helper(directory_of(executable)))
    IO.pure(Result<&1,&1,U32 & String,String>,helper_choice(installed,source))

def output_wait(+output: String, waited: Result<&1,&1,U32 & String,String>) -> IO(String):
  match waited:
    case Fail{error}: IO.pure(String,unavailable("helperWait",error_text(error)))
    case Done{+status}:
      IO.pure(String,Bool.pick(String,String.eq(status,"exit 0"),Tx.trim_nl(output),unavailable("helperExit",status)))

def output_read_failed(error: U32 & String, waited: Result<&1,&1,U32 & String,String>) -> IO(String):
  +detail : String = error_text(error)
  match waited:
    case Fail{wait_error}: IO.pure(String,unavailable("helperRead",detail ++ "; wait: " ++ error_text(wait_error)))
    case Done{status}: IO.pure(String,unavailable("helperRead",detail ++ "; " ++ status))

@unsafe
def output_read(+handle: U32, +output: String, result: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(String):
  match result:
    case Fail{error}: do IO<String>:
      waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
      output_read_failed(error,waited)
    case Done{None{}}: do IO<String>:
      waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
      output_wait(output,waited)
    case Done{Some{+line}}: do IO<String>:
      next : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
      output_read(handle,output ++ line ++ "\n",next)

def output_started(spawned: Result<&1,&1,U32 & String,U32>) -> IO(String):
  match spawned:
    case Fail{error}: IO.pure(String,unavailable("helperSpawn",error_text(error)))
    case Done{+handle}: do IO<String>:
      first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
      output_read(handle,"",first)

def resolved(+cmd: String, +session: String, +run_id: String, +export_path: String, +stderr: String, +cwd: String, node: Result<&1,&1,U32 & String,String>, helper_path: Result<&1,&1,U32 & String,String>) -> IO(String):
  match node:
    case Fail{error}: IO.pure(String,unavailable("nodeRuntime",error_text(error)))
    case Done{+node_path}:
      match helper_path:
        case Fail{error}: IO.pure(String,unavailable("helperPath",error_text(error)))
        case Done{+path}: do IO<String>:
          spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv([node_path,path,cmd,session,run_id,export_path]),cwd,stderr)
          output_started(spawned)

def helper_result(executable: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match executable:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+path}: helper(path)

def final_response(+cmd: String, +session: String, +run_id: String, +export_path: String, +stderr: String, +cwd: String) -> IO(String):
  do IO<String>:
    executable : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.executable()
    node : Result<&1,&1,U32 & String,String> <- Host.Control.command("node")
    helper_path : Result<&1,&1,U32 & String,String> <- helper_result(executable)
    resolved(cmd,session,run_id,export_path,stderr,cwd,node,helper_path)
