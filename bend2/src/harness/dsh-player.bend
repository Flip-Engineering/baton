# The official DeepSeek Harness (DSH) adapter for the headless profile.
#
# `@deepseek-ai/dsh` 0.2.1-rc.2 runs one task and exits:
#   dsh --profile headless --patch TOOLS --patch MODEL --json [--session-id ID]
# The task is read from stdin when no positional task is supplied, so the task
# never enters argv. Launcher flags precede app flags; `--json` starts the app
# arguments. The child inherits DEEPSEEK_API_KEY from the launch environment.
# This module never places a credential in argv and never prints one.
#
# Two independent patch overlays carry the operator settings:
#   - the minimal tool roster (tool patch);
#   - the provider-direct model route and its reasoningEffort (model patch).
import Base
import ../host/process.bend as P
import ../host/files.bend as F
import ../host/text.bend as T
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

type Prepared is Data:
  Prepared{tools: String, model: String}

# --- SQL quoting -------------------------------------------------------------

def sql_escape_char(+head: Char, tail: String, quote: Bool) -> String:
  match quote:
    case True{}: SCon{head,SCon{head,tail}}
    case False{}: SCon{head,tail}

def sql_escaped(s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{+h, tail}: sql_escape_char(h,sql_escaped(tail),Char.is_eq(h,Char.from_u32(39)))

def sql_quote(s: String) -> String:
  "'" ++ sql_escaped(s) ++ "'"

# --- the route ---------------------------------------------------------------

# The provider catalog names this model `deepseek-flash`. Baton seats may record
# the qualified OMP alias `deepseek/deepseek-flash`; the last path segment is the
# DSH catalog id. An empty model keeps the shipped route.
def last_segment(s: String, current: String) -> String:
  match s:
    case SNil{}: current
    case SCon{+c, +rest}:
      next = Bool.pick(String,Char.is_eq(c,Char.from_u32(47)),"",current ++ SCon{c,SNil{}})
      last_segment(rest,next)

def model_value(value: String) -> String:
  match value:
    case "": "deepseek-flash"
    case other: other

def model_id(model: String) -> String:
  value = last_segment(model,"")
  model_value(value)

# YAML single-quoted scalar. The only escape is a doubled single quote.
def yaml_scalar(s: String) -> String:
  "'" ++ sql_escaped(s) ++ "'"

# --- tool patch --------------------------------------------------------------

# The minimal tool roster for headless mode. This follows the shipped minimal
# preset on 0.2.1-rc.2: disable every other model-facing tool plugin, keep only
# read_image from `dsh-tool-fs`, and insert one persistent shell group. The
# composed request carries `bash`, `read_image` and `working_directory`.
def tool_patch() -> String:
  Tx.join("\n",[
    "# Baton DSH minimal tool roster (bend2/src/harness/dsh-player.bend).",
    "# Pinned to @deepseek-ai/dsh 0.2.1-rc.2.",
    "- id: tool-bash",
    "  disabled: true",
    "- id: tool-pwsh",
    "  disabled: true",
    "- id: tool-jobs",
    "  disabled: true",
    "- id: tool-fs-search",
    "  disabled: true",
    "- id: tool-skill",
    "  disabled: true",
    "- id: skill-filesystem",
    "  disabled: true",
    "- id: tool-goal",
    "  disabled: true",
    "- id: command-goal",
    "  disabled: true",
    "- id: plan-mode",
    "  disabled: true",
    "- id: tool-todo",
    "  disabled: true",
    "- id: tool-web",
    "  disabled: true",
    "- id: user-questions",
    "  disabled: true",
    "- id: tool-subagent",
    "  disabled: true",
    "- id: tool-subagent-fork",
    "  disabled: true",
    "- id: tool-subagent-control",
    "  disabled: true",
    "- id: tool-subagent-list-agents",
    "  disabled: true",
    "- id: tool-workflow",
    "  disabled: true",
    "- id: tool-fs",
    "  config:",
    "    read: false",
    "    readImage: true",
    "    write: false",
    "    edit: false",
    "- insert:",
    "    - id: pty",
    "      name: '@deepseek-ai/dsh-terminal'",
    "    - id: terminal-bash",
    "      name: '@deepseek-ai/dsh-terminal-bash'",
    "      disabled: !!js process.platform === 'win32'",
    "      config:",
    "        timeoutMs: 300000",
    "    - id: persistent-bash",
    "      name: '@deepseek-ai/dsh-tool-bash-persistent'",
    "      disabled: !!js process.platform === 'win32'",
    "      config:",
    "        timeoutMs: 300000",
    "    - id: terminal-pwsh",
    "      name: '@deepseek-ai/dsh-terminal-bash'",
    "      disabled: !!js process.platform !== 'win32'",
    "      config:",
    "        shellDialect: pwsh",
    "        timeoutMs: 300000",
    "    - id: persistent-pwsh",
    "      name: '@deepseek-ai/dsh-tool-pwsh-persistent'",
    "      disabled: !!js process.platform !== 'win32'",
    "      config:",
    "        timeoutMs: 300000",
    ""])

# --- model and effort patch --------------------------------------------------

# A patch entry replaces the targeted row's whole `config` object, so the model
# row restates provider and model when it adds reasoningEffort. An empty effort
# omits the field and follows the provider default.
def model_lines(model: String) -> List<String>:
  ["# Baton DSH provider-direct route (bend2/src/harness/dsh-player.bend).",
   "- id: agent-default-model",
   "  config:",
   "    provider: deepseek-official",
   "    model: " ++ yaml_scalar(model_id(model))]

def append_effort(lines: List<String>, effort: String) -> List<String>:
  match effort:
    case "": lines
    case other: List.append(&1,String,lines,["    reasoningEffort: " ++ yaml_scalar(other)])

def model_patch(model: String, effort: String) -> String:
  lines = model_lines(model)
  Tx.join("\n",List.append(&1,String,append_effort(lines,effort),[""]))

# --- argv --------------------------------------------------------------------

def arguments(home: String, cmd: String, tools_patch: String, model_patch_path: String) -> List<String>:
  ["/usr/bin/env","DSH_HOME=" ++ home,cmd,"--profile","headless","--patch",tools_patch,"--patch",model_patch_path,"--json"]

def argv(home: String, cmd: String, model: String, effort: String, tools_patch: String, model_patch_path: String, session: String, fresh: Bool) -> String:
  match fresh:
    case True{}: P.argv(arguments(home,cmd,tools_patch,model_patch_path))
    case False{}: P.argv(List.append(&1,String,arguments(home,cmd,tools_patch,model_patch_path),["--session-id",session]))

# The patch files live in the attempt directory, which is unique per turn, so a
# stale overlay cannot survive into another turn. DSH_HOME is stable per seat.
def patch_result(tools_path: String, model_path: String, first: Result<&1,&1,U32 & String,Unit>, second: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Prepared>:
  match first:
    case Fail{error}: Fail{error}
    case Done{unit}:
      match second:
        case Fail{error}: Fail{error}
        case Done{unit}: Done{Prepared{tools_path, model_path}}

def prepared_result(+directory: String, first: Result<&1,&1,U32 & String,Unit>, second: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Prepared>):
  do IO<Result<&1,&1,U32 & String,Prepared>>:
    tools_path : String <- IO.pure(String,directory ++ "/dsh-tools.patch.yml")
    model_path : String <- IO.pure(String,directory ++ "/dsh-model.patch.yml")
    IO.pure(Result<&1,&1,U32 & String,Prepared>,patch_result(tools_path,model_path,first,second))

def write_patch(path: String, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  T.Text.append(path,text)

def prepare(+directory: String, model: String, effort: String) -> IO(Result<&1,&1,U32 & String,Prepared>):
  do IO<Result<&1,&1,U32 & String,Prepared>>:
    made : Result<&1,&1,U32 & String,Unit> <- F.Files.mkdir(directory)
    wrote_tools : Result<&1,&1,U32 & String,Unit> <- write_patch(directory ++ "/dsh-tools.patch.yml",tool_patch())
    wrote_model : Result<&1,&1,U32 & String,Unit> <- write_patch(directory ++ "/dsh-model.patch.yml",model_patch(model,effort))
    prepared_result(directory,wrote_tools,wrote_model)

def start_player(home: String, cmd: String, model: String, effort: String, cwd: String, stderr: String, tools_patch: String, model_patch_path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(argv(home,cmd,model,effort,tools_patch,model_patch_path,"",True{}),cwd,stderr)

def resume_player(home: String, cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, tools_patch: String, model_patch_path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(argv(home,cmd,model,effort,tools_patch,model_patch_path,session,False{}),cwd,stderr)

# Headless mode reads the task from stdin; the caller closes it after the write.
def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,text)

# --- event stream ------------------------------------------------------------

# The headless `--json` projection writes one compact object per line, with
# `type` first: session, status, thinking, text, tool_call, tool_result, final.
# A fatal usage or boot error is a separate `error` line.
def kind(+line: String) -> String:
  Bool.pick(String,Tx.starts_with(line,"{\"type\":\"session\""),"session",
  Bool.pick(String,Tx.starts_with(line,"{\"type\":\"status\""),"status",
  Bool.pick(String,Tx.starts_with(line,"{\"type\":\"thinking\""),"thinking",
  Bool.pick(String,Tx.starts_with(line,"{\"type\":\"text\""),"text",
  Bool.pick(String,Tx.starts_with(line,"{\"type\":\"tool_call\""),"tool_call",
  Bool.pick(String,Tx.starts_with(line,"{\"type\":\"tool_result\""),"tool_result",
  Bool.pick(String,Tx.starts_with(line,"{\"type\":\"final\""),"final",
  Bool.pick(String,Tx.starts_with(line,"{\"type\":\"error\""),"error",""))))))))

# TODO(DSH-OBSERVE-1): the session frame carries no model; Baton records the
# requested route and leaves observedModel/observedEffort empty.
#
# Baton reads identity and terminal state from a frame. Ordinary text, thinking
# and tool frames stay as received; Baton keeps the raw line in the public log.
def event_sql(line: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ sql_quote(line) ++ ")) SELECT CASE WHEN NOT json_valid(value) THEN '' ELSE CASE json_extract(value,'$.type') "
  ++ "WHEN 'session' THEN json_object('type','session','id',json_extract(value,'$.sessionId'),'cwd',json_extract(value,'$.cwd')) "
  ++ "WHEN 'status' THEN CASE WHEN json_extract(value,'$.phase')='turn_end' AND json_extract(value,'$.reason.kind')='error' THEN json_object('type','result','is_error',1,'result',coalesce(json_extract(value,'$.reason.error.message'),'DSH provider error')) ELSE value END "
  ++ "WHEN 'error' THEN json_object('type','result','is_error',1,'result',coalesce(json_extract(value,'$.message'),'DSH error')) "
  ++ "WHEN 'final' THEN json_object('type','result','result',coalesce(json_extract(value,'$.text'),'')) "
  ++ "ELSE value END END FROM frame;"

def event_trimmed(line: String, value: String) -> String:
  match value:
    case "": line
    case other: other

def event_value(line: String, found: Result<&1,&1,U32 & String,String>) -> String:
  match found:
    case Fail{error}: line
    case Done{value}: event_trimmed(line,Tx.trim_nl(value))

def event(+db: String, +line: String) -> IO(String):
  do IO<String>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,event_sql(line))
    IO.pure(String,event_value(line,found))

# Session identity and terminal state are the only frames Baton parses for its
# own state. The remaining kinds still classify and pass through unchanged.
def admitted(+kind: String) -> Bool:
  Bool.or(String.eq(kind,"session"),Bool.or(String.eq(kind,"status"),Bool.or(String.eq(kind,"final"),String.eq(kind,"error"))))

# TODO(DSH-USAGE-1): observed-usage does not yet read this sample.
# A provider usage sample rides the `status` frame whose phase is `step_end`.
def usage_sql(line: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ sql_quote(line) ++ ")) SELECT CASE WHEN json_valid(value) THEN coalesce(json_extract(value,'$.usage'),'') ELSE '' END FROM frame;"

def usage_value(found: Result<&1,&1,U32 & String,String>) -> String:
  match found:
    case Fail{error}: ""
    case Done{value}: Tx.trim_nl(value)

def usage(db: String, line: String) -> IO(String):
  do IO<String>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,usage_sql(line))
    IO.pure(String,usage_value(found))
