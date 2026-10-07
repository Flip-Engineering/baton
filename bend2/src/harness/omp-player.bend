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

# OMP accepts a session file path when continuing across Player and Conductor stores.
def resume_file(primary: String, alternate: String, +session: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,session)
    case True{}: do IO<String>:
      +first : String <- IO.try(String,F.Files.find_suffix(primary,"_" ++ session ++ ".jsonl"))
      select_file(alternate,session,first,Bool.not(String.is_empty(first)))

def arguments(cmd: String, model: String, effort: String, sessions: String) -> List<String>:
  [cmd,"--mode","rpc","--model",model,"--thinking",effort,"--approval-mode","yolo","--session-dir",sessions]

def argv(cmd: String, model: String, effort: String, sessions: String, session: String, fresh: Bool) -> String:
  match fresh:
    case True{}: P.argv(arguments(cmd,model,effort,sessions))
    case False{}: P.argv(List.append(&1,String,arguments(cmd,model,effort,sessions),["--resume",session]))

def start_player(cmd: String, model: String, effort: String, cwd: String, +log: String, sessions: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(argv(cmd,model,effort,sessions,session,fresh),cwd,log ++ ".stderr")

# The setup asks the server for the documented delta projection (issue #662):
# events:null forwards every event category and messageUpdates:"delta" replaces
# repeated accumulated message snapshots with per-delta frames while
# message_start, message_end and every other frame stay complete. The server's
# echoed response names the active mode; a server without the command refuses
# or ignores the request and the turn keeps full snapshots.
def filter_request() -> String:
  "{\"type\":\"set_event_filter\",\"id\":\"baton:filter\",\"events\":null,\"messageUpdates\":\"delta\"}"

def prompt(text: String) -> String:
  filter_request() ++ "\n" ++ "{\"type\":\"get_state\",\"id\":\"baton:session\"}\n{\"type\":\"prompt\",\"id\":\"baton:prompt\",\"message\":" ++ J.string_literal(text) ++ "}\n"

# The turn folds the server's classified answer into one mode: the exact
# successful full-category delta selection activates the projection, a failed
# answer is refused, a successful answer without that selection is
# unconfirmed, and a missing answer keeps the state the turn already holds.
def filter_next(+state: String, +mode: String) -> String:
  Bool.pick(String,String.is_empty(mode),state,mode)

# The completed turn records what the server's answer actually established, so
# retained output names neither a reduction nor a refusal the stream did not
# make.
def filter_note(+state: String) -> String:
  Bool.pick(String,String.eq(state,"delta"),
    "{\"type\":\"baton_event_filter\",\"requested\":\"delta\",\"active\":true}",
    Bool.pick(String,String.eq(state,"refused"),
      "{\"type\":\"baton_event_filter\",\"requested\":\"delta\",\"active\":false,\"outcome\":\"refused\"}",
      Bool.pick(String,String.eq(state,"unconfirmed"),
        "{\"type\":\"baton_event_filter\",\"requested\":\"delta\",\"active\":false,\"outcome\":\"unconfirmed\"}",
        "{\"type\":\"baton_event_filter\",\"requested\":\"delta\",\"active\":false,\"outcome\":\"unacknowledged\"}")))

def start_player_bounded(cmd: String, model: String, effort: String, cwd: String, +log: String, sessions: String, session: String, fresh: Bool, limit: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn_with_file_bounded(argv(cmd,model,effort,sessions,session,fresh),cwd,log ++ ".stderr",limit,log ++ ".stderr.full",log ++ ".stderr.meta")

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,prompt(text))
