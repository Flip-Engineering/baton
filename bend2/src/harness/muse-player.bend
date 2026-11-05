import Base
import ../host/process.bend as P
import ../json/canonical.bend as J
import ../git/text.bend as Tx

def quote_tail(+text: String) -> String:
  match text:
    case SNil{}: SNil{}
    case SCon{+head, +tail}:
      Bool.pick(String, U32.is_eq(Char.to_u32(head), 39), "'\\''" ++ quote_tail(tail), SCon{head, SNil{}} ++ quote_tail(tail))

def shell_quote(text: String) -> String:
  "'" ++ quote_tail(text) ++ "'"

def hook_command(+db: String, session: String, attempt: String, executable: String) -> String:
  "/usr/bin/env BATON_DATABASE=" ++ shell_quote(db)
    ++ " BATON_SESSION=" ++ shell_quote(session)
    ++ " BATON_ATTEMPT_DIRECTORY=" ++ shell_quote(attempt)
    ++ " " ++ shell_quote(executable) ++ " --stop-hook"

def command_hook(+command: String) -> J.Json:
  J.Jobj{J.Jpair{"type", J.Jstr{"command"}, J.Jpair{"command", J.Jstr{command}, J.Jpair{"async", J.Jfalse{}, J.Jnil{}}}}}

def hook_group(+command: String) -> J.Json:
  J.Jobj{J.Jpair{"matcher", J.Jstr{"*"}, J.Jpair{"hooks", J.Jarr{command_hook(command), J.Jnil{}}, J.Jnil{}}}}

def hook_event(+command: String) -> J.Json:
  J.Jarr{hook_group(command), J.Jnil{}}

def hook_config(+command: String) -> String:
  "hooks=" ++ J.json_text(J.Jobj{J.Jpair{"PostToolUse", hook_event(command), J.Jpair{"Stop", hook_event(command), J.Jnil{}}}})

def models_args(cmd: String, model: String) -> List<String>:
  [cmd,"model-profile","show",model]

def arguments(cmd: String, +model: String, effort: String, task: String) -> List<String>:
  List.append(&1,String,[cmd,"exec","--json","--prompt-file",task,"--model",model,"--reasoning-effort",effort,"--yolo"],Bool.pick(List<String>,String.eq(model,"muse-spark-1.3-contributor"),["--contributor-mode","on"],Nil{}))

def resume_arguments(cmd: String, model: String, effort: String, task: String, +session: String) -> List<String>:
  List.append(&1,String,arguments(cmd,model,effort,task),Bool.pick(List<String>,String.is_empty(session),Nil{},["--session-id",session,"--allow-workspace-switch"]))

# The configured profile store precedes the command when it names one. An empty
# binding reproduces the ordinary argv exactly.
def bound_head(binding: List<String>, cmd: String, model: String, effort: String, task: String) -> List<String>:
  match binding:
    case Nil{}: arguments(cmd,model,effort,task)
    case other: List.append(&1,String,Con{"/usr/bin/env",other},arguments(cmd,model,effort,task))

def bound_arguments(binding: List<String>, cmd: String, model: String, effort: String, task: String, +session: String, fresh: Bool) -> List<String>:
  match fresh:
    case True{}: bound_head(binding,cmd,model,effort,task)
    case False{}: List.append(&1,String,bound_head(binding,cmd,model,effort,task),Bool.pick(List<String>,String.is_empty(session),Nil{},["--session-id",session,"--allow-workspace-switch"]))

def argv_profile(binding: List<String>, cmd: String, model: String, effort: String, task: String, session: String, fresh: Bool) -> String:
  P.argv(bound_arguments(binding,cmd,model,effort,task,session,fresh))

def with_runtime_hooks(arguments: String, db: String, session: String, attempt: String, executable: String) -> String:
  P.argv(List.append(&1,String,Tx.split_nul(arguments),["--config",hook_config(hook_command(db,session,attempt,executable))]))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort,task)),cwd,stderr)

def resume_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(resume_arguments(cmd,model,effort,task,session)),cwd,stderr)

def start_player_profile(binding: List<String>, cmd: String, model: String, effort: String, cwd: String, stderr: String, task: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(argv_profile(binding,cmd,model,effort,task,session,fresh),cwd,stderr)

# Muse reads its configuration at startup and extracts no addon below HOME, so
# this launch adds no preflight. An invalid XDG_CONFIG_HOME is reported by Muse.

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
