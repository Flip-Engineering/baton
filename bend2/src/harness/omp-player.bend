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

def models_args(cmd: String) -> List<String>:
  [cmd,"models","--json"]

def arguments(cmd: String, model: String, effort: String, sessions: String) -> List<String>:
  [cmd,"--mode","rpc","--model",model,"--thinking",effort,"--approval-mode","yolo","--session-dir",sessions]

def argv(cmd: String, model: String, effort: String, sessions: String, session: String, fresh: Bool) -> String:
  match fresh:
    case True{}: P.argv(arguments(cmd,model,effort,sessions))
    case False{}: P.argv(List.append(&1,String,arguments(cmd,model,effort,sessions),["--resume",session]))

def start_player(cmd: String, model: String, effort: String, cwd: String, sessions: String, session: String, fresh: Bool, stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(argv(cmd,model,effort,sessions,session,fresh),cwd,stderr)

# The setup asks the server for the event selection matching the session log
# level (issue #686). Diagnostic asks for every event category with full
# message updates. Other levels ask for the SessionEvent categories in the
# pinned schema except tool_execution_update, with delta message updates. The
# request can omit the measured repeated progress category when the provider
# applies it. At default an interrupted tool may lose its latest partial
# update; diagnostic requests full updates. The server's echoed response
# identifies the accepted mode. The marker records
# the correlated response outcome; it does not describe unobserved frames.
# Categories added to the schema later are not requested by the default array.
def filter_events(+level: String) -> String:
  Bool.pick(String,String.eq(level,"diagnostic"),"null","[\"agent_start\",\"agent_end\",\"turn_start\",\"turn_end\",\"message_start\",\"message_update\",\"message_end\",\"tool_execution_start\",\"tool_stream_update\",\"tool_execution_end\",\"auto_compaction_start\",\"auto_compaction_end\",\"auto_retry_start\",\"auto_retry_end\",\"cache_warming_start\",\"cache_warming_end\",\"retry_fallback_applied\",\"retry_fallback_succeeded\",\"model_changed\",\"config_warnings_changed\",\"advisor_cost_changed\",\"advisor_yielded\",\"ttsr_triggered\",\"todo_reminder\",\"todo_auto_clear\",\"irc_message\",\"notice\",\"thinking_level_changed\",\"goal_updated\",\"queue_update\"]")

def filter_updates(+level: String) -> String:
  Bool.pick(String,String.eq(level,"diagnostic"),"full","delta")

def filter_request(+level: String) -> String:
  "{\"type\":\"set_event_filter\",\"id\":\"baton:filter\",\"events\":" ++ filter_events(level) ++ ",\"messageUpdates\":\"" ++ filter_updates(level) ++ "\"}"

# The requested selection has one name per outcome: the array with delta
# updates, or null with full updates. Only these two selections are sent.
def filter_name(+events: String) -> String:
  Bool.pick(String,String.eq(events,"unknown"),"unknown",Bool.pick(String,String.eq(events,"null"),"null+full","array+delta"))

# A reattached observer knows the provider-confirmed mode from its checkpoint.
# Refusal and unconfirmed outcomes do not retain the original request, so the
# next marker reports that selection as unknown.
def filter_requested(+mode: String) -> String:
  Bool.pick(String,String.eq(mode,"array+delta"),filter_events("default"),Bool.pick(String,String.eq(mode,"null+full"),"null","unknown"))

def prompt(text: String, +level: String) -> String:
  filter_request(level) ++ "\n" ++ "{\"type\":\"get_state\",\"id\":\"baton:session\"}\n{\"type\":\"prompt\",\"id\":\"baton:prompt\",\"message\":" ++ J.string_literal(text) ++ "}\n"

# The turn folds the server's classified answer into one mode: the exact
# successful requested selection activates it, a failed answer is refused, a
# successful answer without that selection is unconfirmed, and a missing
# answer keeps the state the turn already holds.
def filter_next(+state: String, +mode: String) -> String:
  Bool.pick(String,String.is_empty(mode),state,mode)

# The completed turn records the correlated server response. An active marker
# names the accepted selection; an inactive marker records the known request
# and response outcome.
def filter_note(+state: String, +requested: String) -> String:
  Bool.pick(String,String.eq(state,"array+delta"),
    "{\"type\":\"baton_event_filter\",\"selection\":\"array+delta\",\"active\":true}",
    Bool.pick(String,String.eq(state,"null+full"),
      "{\"type\":\"baton_event_filter\",\"selection\":\"null+full\",\"active\":true}",
      Bool.pick(String,String.eq(state,"refused"),
        "{\"type\":\"baton_event_filter\",\"requested\":\"" ++ filter_name(requested) ++ "\",\"active\":false,\"outcome\":\"refused\"}",
        Bool.pick(String,String.eq(state,"unconfirmed"),
          "{\"type\":\"baton_event_filter\",\"requested\":\"" ++ filter_name(requested) ++ "\",\"active\":false,\"outcome\":\"unconfirmed\"}",
          "{\"type\":\"baton_event_filter\",\"requested\":\"" ++ filter_name(requested) ++ "\",\"active\":false,\"outcome\":\"unacknowledged\"}"))))

def input(handle: U32, text: String, +level: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,prompt(text,level))
