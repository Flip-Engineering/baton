import Base
import ../src/git/text.bend as Tx
import ../src/host/clock.bend as Clock
import ../src/host/files.bend as Files
import ../src/host/http.bend as Http
import ../src/host/text.bend as Text
import ../src/host/sqlite.bend as DB
import ../src/host/process.bend as P
import ../src/json/canonical.bend as J
import ../src/coordinator/commands.bend as C
import ../src/coordinator/usage-reads.bend as UR
import ../src/coordinator/zai-quota.bend as Zai
import ../src/coordinator/deepseek-usage.bend as Deepseek
import ../src/coordinator/kimi-usage.bend as Kimi
import ../src/coordinator/claude-usage.bend as Claude
import ../src/coordinator/codex-rate-limits.bend as Codex

# usage-read PROVIDER CREDENTIAL_REF (#1025). Performs one live read of the provider's
# usage API and prints one baton2-usage-read-v1 document: the normalized windows, or
# the exact reason the provider could not be read. The credential is read from the
# named reference inside this process, travels only in the request, and is absent
# from the printed document. The process exits 0 for a readable and an unreadable
# read, and 2 for a bad invocation.
#
# Credential references: omp-models:BLOCK is the apiKey field of provider block BLOCK
# in $HOME/.omp/agent/models.yml; omp-auth:PROVIDER is the key field of the provider's
# enabled row in $HOME/.omp/agent/agent.db auth_credentials; claude-oauth:PATH is the
# Claude Code OAuth access token in PATH, $HOME/.claude/.credentials.json when PATH is
# empty; file:PATH is the first line of PATH; codex-home:PATH runs codex app-server
# with CODEX_HOME=PATH, or with the inherited environment when PATH is empty.
#
# The optional third argument is the codex executable the coordinator recorded for the
# reading seat. The Codex read runs BATON_CODEX_BIN when it is set, else that recorded
# executable, else codex found on PATH.

def print_unreadable(+provider: String, +source: String, +observed: String, +reason: String) -> IO(Unit):
  IO.print(UR.unreadable_document(provider,source,observed,reason))

def scheme_of(+reference: String) -> String:
  Bool.pick(String,Tx.starts_with(reference,"omp-models:"),"omp-models",
  Bool.pick(String,Tx.starts_with(reference,"file:"),"file",
  Bool.pick(String,Tx.starts_with(reference,"codex-home:"),"codex-home",
  Bool.pick(String,Tx.starts_with(reference,"omp-auth:"),"omp-auth",
  Bool.pick(String,Tx.starts_with(reference,"claude-oauth:"),"claude-oauth","")))))

def after_colon(text: String) -> String:
  match text:
    case SNil{}: ""
    case SCon{head,+tail}: Bool.pick(Unit -> String,Char.is_eq(head,Char.from_u32(58)),u => tail,u => after_colon(tail))(Unit{})

# --- credentials ---------------------------------------------------------------

# The apiKey of one provider block: the line '    apiKey: VALUE' under the
# two-space header 'BLOCK:' of the providers map, without quotes.
def models_key_sql(+text: String, +block: String) -> String:
  "WITH RECURSIVE lines(n,line,rest) AS (SELECT 0,'',replace(" ++ C.q(text) ++ ",char(13),'')||char(10) UNION ALL SELECT n+1,substr(rest,1,instr(rest,char(10))-1),substr(rest,instr(rest,char(10))+1) FROM lines WHERE rest<>''),"
  ++ " headed(line,header) AS (SELECT l.line,(SELECT h.line FROM lines h WHERE h.n<=l.n AND (h.line GLOB '  [^ ]*' OR h.line GLOB '[^ #]*') ORDER BY h.n DESC LIMIT 1) FROM lines l)"
  ++ " SELECT coalesce((SELECT trim(trim(substr(line,12)),'\"''') FROM headed WHERE line GLOB '    apiKey:*' AND rtrim(header)=" ++ C.q("  " ++ block ++ ":") ++ " LIMIT 1),'');"

def secret_safe(+secret: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(secret)),
    Bool.and(Bool.not(String.contains(secret,SCon{Char.from_u32(0),SNil{}})),
      Bool.and(Bool.not(String.contains(secret,SCon{Char.from_u32(10),SNil{}})),
        Bool.not(String.contains(secret,SCon{Char.from_u32(13),SNil{}})))))

def secret_checked(+secret: String, +reference: String) -> Result<&1,&1,String,String>:
  Bool.pick(Result<&1,&1,String,String>,secret_safe(secret),Done{secret},Fail{"the credential at " ++ reference ++ " is empty or contains a control character"})

def models_key_found(+reference: String, found: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,String,String>:
  match found:
    case Fail{(code,detail)}: Fail{"the models.yml scan failed: " ++ U32.show(code)}
    case Done{+value}: secret_checked(Tx.trim_nl(value),reference)

def models_text(+reference: String, read: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,String,String>):
  match read:
    case Fail{(code,detail)}: IO.pure(Result<&1,&1,String,String>,Fail{"cannot read the models.yml of " ++ reference ++ ": " ++ U32.show(code) ++ " " ++ detail})
    case Done{+text}: do IO<Result<&1,&1,String,String>>:
      found : Result<&1,&1,U32 & String,String> <- DB.Sql.query(":memory:",models_key_sql(text,after_colon(reference)))
      IO.pure(Result<&1,&1,String,String>,models_key_found(reference,found))

def models_home(+reference: String, home: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,String,String>):
  match home:
    case Fail{error}: IO.pure(Result<&1,&1,String,String>,Fail{"HOME is not set, so " ++ reference ++ " cannot be resolved"})
    case Done{+path}: do IO<Result<&1,&1,String,String>>:
      read : Result<&1,&1,U32 & String,String> <- Text.Text.read(Tx.trim_nl(path) ++ "/.omp/agent/models.yml")
      models_text(reference,read)

def file_text(+reference: String, read: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,String,String>:
  match read:
    case Fail{(code,detail)}: Fail{"cannot read the credential file of " ++ reference ++ ": " ++ U32.show(code)}
    case Done{+text}: secret_checked(Tx.trim_nl(text),reference)

# omp-auth:PROVIDER: the key field of the newest enabled auth_credentials row for the
# provider in $HOME/.omp/agent/agent.db, opened read-only. A provider whose only rows
# are disabled answers the recorded disabled cause.
def omp_auth_sql(+provider: String) -> String:
  "SELECT coalesce((SELECT 'key'||char(31)||json_extract(data,'$.key') FROM auth_credentials WHERE provider=" ++ C.q(provider) ++ " AND disabled_cause IS NULL AND json_valid(data) AND json_extract(data,'$.key') IS NOT NULL ORDER BY updated_at DESC,id DESC LIMIT 1),(SELECT 'disabled'||char(31)||disabled_cause FROM auth_credentials WHERE provider=" ++ C.q(provider) ++ " AND disabled_cause IS NOT NULL ORDER BY updated_at DESC,id DESC LIMIT 1),'none'||char(31));"

def stored_key(+reference: String, fields: List<&2,String>) -> Result<&1,&1,String,String>:
  match fields:
    case "key" <> +value <> Nil{}: secret_checked(value,reference)
    case "disabled" <> +cause <> Nil{}: Fail{"the credential of " ++ reference ++ " is disabled: " ++ cause}
    case "expired" <> +instant <> Nil{}: Fail{"the access token of " ++ reference ++ " expired at " ++ instant ++ "; Baton does not refresh it; the account's own Claude Code login renews it"}
    case other: Fail{"no usable credential is recorded for " ++ reference}

def stored_found(+reference: String, found: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,String,String>:
  match found:
    case Fail{(code,detail)}: Fail{"cannot read the credential store of " ++ reference ++ ": " ++ U32.show(code) ++ " " ++ detail}
    case Done{+text}: stored_key(reference,String.split(Tx.trim_nl(text),Char.from_u32(31)))

def omp_auth_home(+reference: String, home: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,String,String>):
  match home:
    case Fail{error}: IO.pure(Result<&1,&1,String,String>,Fail{"HOME is not set, so " ++ reference ++ " cannot be resolved"})
    case Done{+path}: do IO<Result<&1,&1,String,String>>:
      found : Result<&1,&1,U32 & String,String> <- DB.Sql.read(Tx.trim_nl(path) ++ "/.omp/agent/agent.db",omp_auth_sql(after_colon(reference)))
      IO.pure(Result<&1,&1,String,String>,stored_found(reference,found))

# claude-oauth:PATH: claudeAiOauth.accessToken of a Claude Code credentials file,
# $HOME/.claude/.credentials.json when PATH is empty. An expired token is reported
# and never refreshed, because a refresh writes the account's credentials.
def claude_oauth_sql(+text: String) -> String:
  "SELECT CASE WHEN NOT json_valid(" ++ C.q(text) ++ ") OR json_extract(" ++ C.q(text) ++ ",'$.claudeAiOauth.accessToken') IS NULL THEN 'none'||char(31) WHEN coalesce(json_extract(" ++ C.q(text) ++ ",'$.claudeAiOauth.expiresAt'),0)<=CAST(strftime('%s','now') AS INTEGER)*1000 THEN 'expired'||char(31)||strftime('%Y-%m-%dT%H:%M:%SZ',coalesce(json_extract(" ++ C.q(text) ++ ",'$.claudeAiOauth.expiresAt'),0)/1000,'unixepoch') ELSE 'key'||char(31)||json_extract(" ++ C.q(text) ++ ",'$.claudeAiOauth.accessToken') END;"

def claude_oauth_text(+reference: String, read: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,String,String>):
  match read:
    case Fail{(code,detail)}: IO.pure(Result<&1,&1,String,String>,Fail{"cannot read the credentials file of " ++ reference ++ ": " ++ U32.show(code)})
    case Done{+text}: do IO<Result<&1,&1,String,String>>:
      found : Result<&1,&1,U32 & String,String> <- DB.Sql.query(":memory:",claude_oauth_sql(text))
      IO.pure(Result<&1,&1,String,String>,stored_found(reference,found))

def claude_oauth_path(+reference: String, +path: String) -> IO(Result<&1,&1,String,String>):
  do IO<Result<&1,&1,String,String>>:
    read : Result<&1,&1,U32 & String,String> <- Text.Text.read(path)
    claude_oauth_text(reference,read)

def claude_oauth_home(+reference: String, home: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,String,String>):
  match home:
    case Fail{error}: IO.pure(Result<&1,&1,String,String>,Fail{"HOME is not set, so " ++ reference ++ " cannot be resolved"})
    case Done{+path}: claude_oauth_path(reference,Tx.trim_nl(path) ++ "/.claude/.credentials.json")

def claude_oauth_default(+reference: String) -> IO(Result<&1,&1,String,String>):
  do IO<Result<&1,&1,String,String>>:
    home : Result<&1,&1,U32 & String,String> <- IO.get_env("HOME")
    claude_oauth_home(reference,home)

def claude_oauth(+reference: String) -> IO(Result<&1,&1,String,String>):
  Bool.pick(IO(Result<&1,&1,String,String>),String.is_empty(after_colon(reference)),claude_oauth_default(reference),claude_oauth_path(reference,after_colon(reference)))

def resolve_scheme(+scheme: String, +reference: String) -> IO(Result<&1,&1,String,String>):
  match scheme:
    case "omp-models": do IO<Result<&1,&1,String,String>>:
      home : Result<&1,&1,U32 & String,String> <- IO.get_env("HOME")
      models_home(reference,home)
    case "file": do IO<Result<&1,&1,String,String>>:
      read : Result<&1,&1,U32 & String,String> <- Text.Text.read(after_colon(reference))
      IO.pure(Result<&1,&1,String,String>,file_text(reference,read))
    case "omp-auth": do IO<Result<&1,&1,String,String>>:
      home : Result<&1,&1,U32 & String,String> <- IO.get_env("HOME")
      omp_auth_home(reference,home)
    case "claude-oauth": claude_oauth(reference)
    case _: IO.pure(Result<&1,&1,String,String>,Fail{"the credential reference " ++ reference ++ " is not omp-models:BLOCK, omp-auth:PROVIDER, claude-oauth:PATH or file:PATH"})

def resolve(+reference: String) -> IO(Result<&1,&1,String,String>):
  resolve_scheme(scheme_of(reference),reference)

# --- the parsed answer -----------------------------------------------------------

def sql_text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{(code,detail)}: "the response parser failed: " ++ U32.show(code) ++ " " ++ detail
    case Done{+value}: Tx.trim_nl(value)

def print_document(+provider: String, +source: String, +observed: String, built: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match built:
    case Fail{(code,detail)}: print_unreadable(provider,source,observed,"the response parser failed: " ++ U32.show(code) ++ " " ++ detail)
    case Done{+document}: IO.print(Tx.trim_nl(document))

def print_built(+provider: String, +source: String, +observed: String, +windows: String) -> IO(Unit):
  do IO<Unit>:
    built : Result<&1,&1,U32 & String,String> <- DB.Sql.query(":memory:",UR.read_document_sql(provider,source,observed,windows))
    print_document(provider,source,observed,built)

def print_parsed(+provider: String, +source: String, +observed: String, +windows: String, +problem: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(problem),print_built(provider,source,observed,windows),print_unreadable(provider,source,observed,problem))

# --- HTTP readers ------------------------------------------------------------------
#
# One HTTP reader is: source(), the method and URL the read names; request(key), one
# Http.request with the credential in its headers; windows(response), the parser's
# SELECT of the windows array, whose value is NULL for a response it cannot read; and
# problem(response), a SELECT answering the reason a response cannot be read or ''.
# read_http resolves the credential, makes the request and prints the document.

def status_ok(+status: String) -> Bool:
  Tx.starts_with(Tx.trim_nl(status),"2")

def windows_value_sql(+windows: String) -> String:
  "SELECT coalesce((" ++ windows ++ "),'');"

def http_windows(+provider: String, +source: String, +observed: String, +windows: String, +body: String, found: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match found:
    case Fail{(code,detail)}: print_unreadable(provider,source,observed,"the response parser failed: " ++ U32.show(code) ++ " " ++ detail)
    case Done{+value}: Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(value)),print_unreadable(provider,source,observed,"the " ++ provider ++ " response did not match its reader: " ++ String.take(body,300n)),print_built(provider,source,observed,windows))

def http_found(+provider: String, +source: String, +observed: String, +windows: String, +body: String) -> IO(Unit):
  do IO<Unit>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.query(":memory:",windows_value_sql(windows))
    http_windows(provider,source,observed,windows,body,found)

def http_checked(+provider: String, +source: String, +observed: String, +windows: String, +body: String, +problem: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(problem),http_found(provider,source,observed,windows,body),print_unreadable(provider,source,observed,problem))

def http_parsed(+provider: String, +source: String, +observed: String, +windows: String, +problem_sql: String, +body: String) -> IO(Unit):
  do IO<Unit>:
    problem : Result<&1,&1,U32 & String,String> <- DB.Sql.query(":memory:",problem_sql)
    http_checked(provider,source,observed,windows,body,sql_text(problem))

def http_status(+provider: String, +source: String, +observed: String, +windows: String, +problem_sql: String, +status: String, +body: String) -> IO(Unit):
  Bool.pick(IO(Unit),status_ok(status),http_parsed(provider,source,observed,windows,problem_sql,body),print_unreadable(provider,source,observed,provider ++ " answered HTTP " ++ Tx.trim_nl(status) ++ ": " ++ String.take(body,300n)))

def http_body(+provider: String, +source: String, +observed: String, windows: String -> String, problem: String -> String, +status: String, +body: String) -> IO(Unit):
  http_status(provider,source,observed,windows(body),problem(body),status,body)

def http_respond(+provider: String, +source: String, +observed: String, windows: String -> String, problem: String -> String, result: Result<&1,&1,U32 & String,String & String>) -> IO(Unit):
  match result:
    case Fail{(code,detail)}: print_unreadable(provider,source,observed,"the " ++ provider ++ " request failed: " ++ detail)
    case Done{(status,body)}: http_body(provider,source,observed,windows,problem,status,body)

def http_resolved(+provider: String, +source: String, +observed: String, request: String -> IO(Result<&1,&1,U32 & String,String & String>), windows: String -> String, problem: String -> String, resolved: Result<&1,&1,String,String>) -> IO(Unit):
  match resolved:
    case Fail{+reason}: print_unreadable(provider,source,observed,reason)
    case Done{+key}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,String & String> <- request(key)
      http_respond(provider,source,observed,windows,problem,result)

def read_http(+provider: String, +source: String, +observed: String, +reference: String, request: String -> IO(Result<&1,&1,U32 & String,String & String>), windows: String -> String, problem: String -> String) -> IO(Unit):
  do IO<Unit>:
    resolved : Result<&1,&1,String,String> <- resolve(reference)
    http_resolved(provider,source,observed,request,windows,problem,resolved)

# --- z.ai ------------------------------------------------------------------------

def zai_request(+key: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  Http.Http.request("GET","https://api.z.ai/api/monitor/usage/quota/limit","Authorization: Bearer " ++ key ++ "\nAccept: application/json\nUser-Agent: baton2-usage-read/1.0\n","")

def read_zai(+observed: String, +reference: String) -> IO(Unit):
  read_http("zai",Zai.zai_source(),observed,reference,key => zai_request(key),response => Zai.zai_windows_sql(response),response => Zai.zai_problem_sql(response))

# --- DeepSeek ---------------------------------------------------------------------

def deepseek_request(+key: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  Http.Http.request("GET","https://api.deepseek.com/user/balance","Authorization: Bearer " ++ key ++ "\nAccept: application/json\nUser-Agent: baton2-usage-read/1.0\n","")

def read_deepseek(+observed: String, +reference: String) -> IO(Unit):
  read_http("deepseek",Deepseek.deepseek_source(),observed,reference,key => deepseek_request(key),response => Deepseek.deepseek_windows_sql(response),response => Deepseek.deepseek_problem_sql(response))

# --- Kimi Code ----------------------------------------------------------------------

def kimi_request(+key: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  Http.Http.request("GET","https://api.kimi.com/coding/v1/usages","Authorization: Bearer " ++ key ++ "\nAccept: application/json\nUser-Agent: baton2-usage-read/1.0\n","")

def read_kimi(+observed: String, +reference: String) -> IO(Unit):
  read_http("kimi-code",Kimi.kimi_source(),observed,reference,key => kimi_request(key),response => Kimi.kimi_windows_sql(response),response => Kimi.kimi_problem_sql(response))

# --- providers without a readable usage API ----------------------------------------

# Anthropic API credit (an api_key account): the Admin usage and cost API reports past
# usage and spend; no documented endpoint for the remaining credit balance was found.
def claude_credit_reason() -> String:
  "no documented endpoint for the remaining API credit balance was found; the usage and cost API reports past usage and spend only"

# Claude Max (claude-oauth): GET https://api.anthropic.com/api/oauth/usage with the
# account's OAuth access token and the anthropic-beta header the endpoint requires.
def claude_request(+key: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  Http.Http.request("GET","https://api.anthropic.com/api/oauth/usage","Authorization: Bearer " ++ key ++ "\nanthropic-beta: oauth-2025-04-20\nAccept: application/json\nUser-Agent: baton2-usage-read/1.0\n","")

def read_claude_max(+observed: String, +reference: String) -> IO(Unit):
  read_http("claude",Claude.claude_source(),observed,reference,key => claude_request(key),response => Claude.claude_windows_sql(response),response => Claude.claude_problem_sql(response))

# An API-key reference is an Anthropic API-credit account, which has no usage read.
def read_claude(+observed: String, +reference: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(scheme_of(reference),"claude-oauth"),read_claude_max(observed,reference),print_unreadable("claude","",observed,claude_credit_reason()))

def muse_reason() -> String:
  "no authenticated usage endpoint was identified for the configured API key"

# --- Codex -------------------------------------------------------------------------

# The helper sends initialize, waits for its answer, and only then sends initialized and
# the read; codex app-server ended without answering when all three arrived at once.
def codex_initialize() -> String:
  "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"baton2-usage-read\",\"version\":\"1.0\"}}}\n"

def codex_read_request() -> String:
  "{\"jsonrpc\":\"2.0\",\"method\":\"initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"account/rateLimits/read\",\"params\":{}}\n"


# The response line's role: 'initialized' for the answer to initialize, 'result' with the
# read's result object, 'error' with an error message, or 'other' for any other line.
def codex_line_sql(+line: String) -> String:
  "SELECT CASE WHEN NOT json_valid(" ++ C.q(line) ++ ") THEN 'other' WHEN coalesce(json_extract(" ++ C.q(line) ++ ",'$.id'),0)=1 AND json_type(" ++ C.q(line) ++ ",'$.error') IS NULL THEN 'initialized' WHEN coalesce(json_extract(" ++ C.q(line) ++ ",'$.id'),0) NOT IN (1,2) THEN 'other' WHEN json_type(" ++ C.q(line) ++ ",'$.error') IS NOT NULL THEN 'error' || char(31) || coalesce(json_extract(" ++ C.q(line) ++ ",'$.error.message'),json_extract(" ++ C.q(line) ++ ",'$.error')) ELSE 'result' || char(31) || json_extract(" ++ C.q(line) ++ ",'$.result') END;"

@unsafe
def codex_drain_lines(+handle: U32, line: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(Unit):
  match line:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{value}:
      match value:
        case None{}: IO.pure(Unit,Unit{})
        case Some{text}: do IO<Unit>:
          next : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
          codex_drain_lines(handle,next)

# Closing stdin starts app-server shutdown. Consume its remaining notifications
# while it exits so its stdout writes can complete. A nonempty cleanup home is
# the temporary credential home of an API-key read: its key file is removed
# before the read is printed, and a home that cannot be cleaned reports so
# instead of the read, so no key file is left unreported.
def codex_cleanup_reason(+home: String) -> String:
  "the temporary credential home " ++ home ++ " could not be cleaned after the read; its API key file may remain"

def codex_cleanup_remove(removed: Result<&1,&1,U32 & String,Unit>, +home: String) -> IO(Bool):
  match removed:
    case Fail{(code,detail)}: IO.pure(Bool,False{})
    case Done{unit}: do IO<Bool>:
      logged : Result<&1,&1,U32 & String,Unit> <- Files.Files.remove(home ++ "/log/codex-login.log")
      logged_dir : Result<&1,&1,U32 & String,Unit> <- Files.Files.rmdir(home ++ "/log")
      home_dir : Result<&1,&1,U32 & String,Unit> <- Files.Files.rmdir(home)
      IO.pure(Bool,True{})

def codex_cleanup(+home: String) -> IO(Bool):
  Bool.pick(IO(Bool),String.is_empty(home),IO.pure(Bool,True{}),do IO<Bool>:
    removed : Result<&1,&1,U32 & String,Unit> <- Files.Files.remove(home ++ "/auth.json")
    codex_cleanup_remove(removed,home))

def codex_finish(+handle: U32, +cleanup: String) -> IO(Bool):
  do IO<Bool>:
    closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
    next : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
    drained : Unit <- codex_drain_lines(handle,next)
    waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    clean : Bool <- codex_cleanup(cleanup)
    IO.pure(Bool,clean)

def wait_text(waited: Result<&1,&1,U32 & String,String>) -> String:
  match waited:
    case Done{+status}: Tx.trim_nl(status)
    case Fail{(code,detail)}: "status unavailable: " ++ detail

# The child's own status names why it ended: a missing codex executable on PATH is
# env's exit 127.
def codex_ended(+handle: U32, +observed: String, +cleanup: String) -> IO(Unit):
  do IO<Unit>:
    closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
    waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    clean : Bool <- codex_cleanup(cleanup)
    +ended : String <- IO.pure(String,"codex app-server ended before it answered account/rateLimits/read (" ++ wait_text(waited) ++ ")")
    print_unreadable("codex",Codex.codex_source(),observed,Bool.pick(String,clean,ended,ended ++ "; " ++ codex_cleanup_reason(cleanup)))

def codex_result(+observed: String, +result: String) -> IO(Unit):
  do IO<Unit>:
    problem : Result<&1,&1,U32 & String,String> <- DB.Sql.query(":memory:",Codex.codex_problem_sql(result))
    print_parsed("codex",Codex.codex_source(),observed,Codex.codex_windows_sql(result),sql_text(problem))

def codex_classified(+handle: U32, +observed: String, fields: List<&2,String>, +cleanup: String) -> IO(Bool):
  match fields:
    case "result" <> +result <> Nil{}: do IO<Bool>:
      clean : Bool <- codex_finish(handle,cleanup)
      printed : Unit <- Bool.pick(IO(Unit),clean,codex_result(observed,result),print_unreadable("codex",Codex.codex_source(),observed,codex_cleanup_reason(cleanup)))
      IO.pure(Bool,True{})
    case "initialized" <> Nil{}: do IO<Bool>:
      wrote : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.write(handle,codex_read_request())
      IO.pure(Bool,False{})
    case "error" <> +message <> Nil{}: do IO<Bool>:
      clean : Bool <- codex_finish(handle,cleanup)
      +failed : String <- IO.pure(String,"codex app-server answered an error: " ++ message)
      printed : Unit <- print_unreadable("codex",Codex.codex_source(),observed,Bool.pick(String,clean,failed,failed ++ "; " ++ codex_cleanup_reason(cleanup)))
      IO.pure(Bool,True{})
    case other: IO.pure(Bool,False{})

@unsafe
def codex_lines(+handle: U32, +observed: String, line: Result<&1,&1,U32 & String,Maybe<String>>, +cleanup: String) -> IO(Unit):
  match line:
    case Fail{(code,detail)}: do IO<Unit>:
      clean : Bool <- codex_finish(handle,cleanup)
      +failed : String <- IO.pure(String,"reading codex app-server failed: " ++ detail)
      print_unreadable("codex",Codex.codex_source(),observed,Bool.pick(String,clean,failed,failed ++ "; " ++ codex_cleanup_reason(cleanup)))
    case Done{value}:
      match value:
        case None{}: codex_ended(handle,observed,cleanup)
        case Some{+text}: do IO<Unit>:
          +role : String <- IO.try(String,DB.Sql.query(":memory:",codex_line_sql(Tx.trim_nl(text))))
          +done : Bool <- codex_classified(handle,observed,String.split(Tx.trim_nl(role),Char.from_u32(31)),cleanup)
          next : Result<&1,&1,U32 & String,Maybe<String>> <- Bool.pick(IO(Result<&1,&1,U32 & String,Maybe<String>>),done,IO.pure(Result<&1,&1,U32 & String,Maybe<String>>,Done{None{}}),P.ProcessChild.read_line(handle))
          Bool.pick(IO(Unit),done,IO.pure(Unit,Unit{}),codex_lines(handle,observed,next,cleanup))

def codex_spawned(+observed: String, spawned: Result<&1,&1,U32 & String,U32>, +cleanup: String) -> IO(Unit):
  match spawned:
    case Fail{(code,detail)}: do IO<Unit>:
      clean : Bool <- codex_cleanup(cleanup)
      +failed : String <- IO.pure(String,"codex app-server did not start: " ++ detail)
      print_unreadable("codex",Codex.codex_source(),observed,Bool.pick(String,clean,failed,failed ++ "; " ++ codex_cleanup_reason(cleanup)))
    case Done{+handle}: do IO<Unit>:
      wrote : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.write(handle,codex_initialize())
      first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
      codex_lines(handle,observed,first,cleanup)

def env_value(found: Result<&1,&1,U32 & String,String>) -> String:
  match found:
    case Fail{error}: ""
    case Done{+value}: Tx.trim_nl(value)

def codex_executable_of(+recorded: String) -> IO(String):
  do IO<String>:
    configured : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON_CODEX_BIN")
    IO.pure(String,Codex.codex_executable(env_value(configured),recorded))

def codex_spawn_home(+observed: String, +home: String, +executable: String, +cleanup: String) -> IO(Unit):
  do IO<Unit>:
    spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv(Codex.codex_app_server_argv(home,executable)),".","/dev/null")
    codex_spawned(observed,spawned,cleanup)

def codex_spawn(+observed: String, +reference: String, +recorded: String) -> IO(Unit):
  do IO<Unit>:
    +executable : String <- codex_executable_of(recorded)
    codex_spawn_home(observed,after_colon(reference),executable,"")

# --- the Codex API-key read ------------------------------------------------------
#
# An API-key reference holds no home: the helper resolves the secret, logs a
# fresh owner-only temporary home in with it through `COMMAND login
# --with-api-key`, which reads the key from stdin, then reads the rate limits
# through that home. The home is removed before the read is printed; a home
# that cannot be cleaned reports so instead of the read. The key travels only
# through the login child's stdin; every refusal carries the reference and a
# condition, never the value. A keychain reference has no reader on this host,
# so it reports the resolver's own cause.

def codex_login_source() -> String:
  "codex login --with-api-key"

def codex_temp_time(now: Result<&1,&1,U32 & String,String>) -> String:
  match now:
    case Fail{error}: "0"
    case Done{+value}: Tx.trim_nl(value)

def codex_temp_random(random: Result<&1,&1,U32 & String,U32>) -> String:
  match random:
    case Fail{error}: "0"
    case Done{+value}: U32.show(value)

def codex_temp_home(now: Result<&1,&1,U32 & String,String>, random: Result<&1,&1,U32 & String,U32>) -> String:
  "/tmp/baton2-codex-read-" ++ codex_temp_time(now) ++ "-" ++ codex_temp_random(random)

def codex_key_login_failed(+observed: String, +home: String, +reason: String) -> IO(Unit):
  do IO<Unit>:
    clean : Bool <- codex_cleanup(home)
    +failed : String <- IO.pure(String,reason)
    print_unreadable("codex",codex_login_source(),observed,Bool.pick(String,clean,failed,failed ++ "; " ++ codex_cleanup_reason(home)))

def codex_key_waited(waited: Result<&1,&1,U32 & String,String>, +observed: String, +home: String, +executable: String) -> IO(Unit):
  match waited:
    case Done{+status}: Bool.pick(IO(Unit),String.eq(Tx.trim_nl(status),"exit 0"),codex_spawn_home(observed,home,executable,home),codex_key_login_failed(observed,home,"codex login --with-api-key did not log in: " ++ Tx.trim_nl(status)))
    case Fail{(code,detail)}: codex_key_login_failed(observed,home,"codex login --with-api-key did not finish: " ++ U32.show(code))

def codex_key_closed(closed: Result<&1,&1,U32 & String,Unit>, +observed: String, +home: String, +executable: String, +handle: U32) -> IO(Unit):
  match closed:
    case Fail{(code,detail)}: codex_key_login_failed(observed,home,"the API key could not be passed to codex login: " ++ U32.show(code))
    case Done{unit}: do IO<Unit>:
      waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
      codex_key_waited(waited,observed,home,executable)

def codex_key_written(written: Result<&1,&1,U32 & String,Unit>, +observed: String, +home: String, +executable: String, +handle: U32, +secret: String) -> IO(Unit):
  match written:
    case Fail{(code,detail)}: codex_key_login_failed(observed,home,"the API key could not be passed to codex login: " ++ U32.show(code))
    case Done{unit}: do IO<Unit>:
      closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
      codex_key_closed(closed,observed,home,executable,handle)

def codex_key_spawned(spawned: Result<&1,&1,U32 & String,U32>, +observed: String, +home: String, +executable: String, +secret: String) -> IO(Unit):
  match spawned:
    case Fail{(code,detail)}: codex_key_login_failed(observed,home,"codex login --with-api-key could not be started: " ++ detail)
    case Done{+handle}: do IO<Unit>:
      written : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.write(handle,secret ++ "\n")
      codex_key_written(written,observed,home,executable,handle,secret)

def codex_key_login(+observed: String, +home: String, +executable: String, +secret: String) -> IO(Unit):
  do IO<Unit>:
    spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv(["/usr/bin/env","CODEX_HOME=" ++ home,executable,"login","--with-api-key"]),".","/dev/null")
    codex_key_spawned(spawned,observed,home,executable,secret)

def codex_key_made(made: Result<&1,&1,U32 & String,Unit>, +observed: String, +home: String, +executable: String, +secret: String) -> IO(Unit):
  match made:
    case Fail{(code,detail)}: print_unreadable("codex",codex_login_source(),observed,"the temporary credential home could not be created: " ++ detail)
    case Done{unit}: codex_key_login(observed,home,executable,secret)

def read_codex_key(+observed: String, +executable: String, +secret: String) -> IO(Unit):
  do IO<Unit>:
    now : Result<&1,&1,U32 & String,String> <- Clock.Clock.millis()
    random : Result<&1,&1,U32 & String,U32> <- IO.random_u32()
    +home : String <- IO.pure(String,codex_temp_home(now,random))
    made : Result<&1,&1,U32 & String,Unit> <- Files.Files.mkdir_mode(home,448)
    codex_key_made(made,observed,home,executable,secret)

def read_codex_resolved(+observed: String, +executable: String, resolved: Result<&1,&1,String,String>) -> IO(Unit):
  match resolved:
    case Fail{+reason}: print_unreadable("codex",Codex.codex_source(),observed,reason)
    case Done{+secret}: read_codex_key(observed,executable,secret)

def read_codex_reference(+observed: String, +reference: String, +recorded: String) -> IO(Unit):
  do IO<Unit>:
    +executable : String <- codex_executable_of(recorded)
    resolved : Result<&1,&1,String,String> <- resolve(reference)
    read_codex_resolved(observed,executable,resolved)

def read_codex(+observed: String, +reference: String, +recorded: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(scheme_of(reference),"codex-home"),codex_spawn(observed,reference,recorded),read_codex_reference(observed,reference,recorded))

# --- dispatch ------------------------------------------------------------------------

# recorded is the codex executable the coordinator recorded for the reading seat, or ''.
def read_provider(+provider: String, +reference: String, +observed: String, +recorded: String) -> IO(Unit):
  match provider:
    case "zai": read_zai(observed,reference)
    case "deepseek": read_deepseek(observed,reference)
    case "kimi-code": read_kimi(observed,reference)
    case "codex": read_codex(observed,reference,recorded)
    case "claude": read_claude(observed,reference)
    case "muse": print_unreadable("muse","",observed,muse_reason())
    case _: print_unreadable(provider,"",observed,"no usage reader for provider " ++ provider ++ " is in this build")

# A read without its observation clock cannot be ordered against the account's other
# reads, so a failed wall-clock read prints an unreadable document and makes no
# provider request. observedAt is null; the coordinator records its own clock.
def clock_failed(+provider: String, code: U32, detail: String) -> IO(Unit):
  print_unreadable(provider,"","null","the wall clock read failed: " ++ U32.show(code) ++ " " ++ detail)

def read_at(+provider: String, +reference: String, now: Result<&1,&1,U32 & String,String>, +recorded: String) -> IO(Unit):
  match now:
    case Fail{(code,detail)}: clock_failed(provider,code,detail)
    case Done{+value}: read_provider(provider,reference,Tx.trim_nl(value),recorded)

def main_arguments(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +provider <> +reference <> Nil{}: do IO<Unit>:
      now : Result<&1,&1,U32 & String,String> <- Clock.Clock.millis()
      read_at(provider,reference,now,"")
    case +provider <> +reference <> +recorded <> Nil{}: do IO<Unit>:
      now : Result<&1,&1,U32 & String,String> <- Clock.Clock.millis()
      read_at(provider,reference,now,recorded)
    case other: IO.die(Unit,2,"usage: usage-read PROVIDER CREDENTIAL_REF [CODEX_EXECUTABLE]")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    main_arguments(arguments)
