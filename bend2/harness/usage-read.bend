import Base
import ../src/git/text.bend as Tx
import ../src/host/clock.bend as Clock
import ../src/host/http.bend as Http
import ../src/host/text.bend as Text
import ../src/host/sqlite.bend as DB
import ../src/json/canonical.bend as J
import ../src/coordinator/commands.bend as C
import ../src/coordinator/usage-reads.bend as UR
import ../src/coordinator/zai-quota.bend as Zai
import ../src/coordinator/kimi-usage.bend as Kimi

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
# empty; file:PATH is the first line of PATH.

def print_unreadable(+provider: String, +source: String, +observed: String, +reason: String) -> IO(Unit):
  IO.print(UR.unreadable_document(provider,source,observed,reason))

def time_value(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: "0"
    case Done{+value}: Tx.trim_nl(value)

def scheme_of(+reference: String) -> String:
  Bool.pick(String,Tx.starts_with(reference,"omp-models:"),"omp-models",
  Bool.pick(String,Tx.starts_with(reference,"file:"),"file",
  Bool.pick(String,Tx.starts_with(reference,"omp-auth:"),"omp-auth",
  Bool.pick(String,Tx.starts_with(reference,"claude-oauth:"),"claude-oauth",""))))

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
    case "expired" <> +instant <> Nil{}: Fail{"the access token of " ++ reference ++ " expired at " ++ instant ++ "; Baton does not refresh it"}
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

# --- Kimi Code ----------------------------------------------------------------------

def kimi_request(+key: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  Http.Http.request("GET","https://api.kimi.com/coding/v1/usages","Authorization: Bearer " ++ key ++ "\nAccept: application/json\nUser-Agent: baton2-usage-read/1.0\n","")

def read_kimi(+observed: String, +reference: String) -> IO(Unit):
  read_http("kimi-code",Kimi.kimi_source(),observed,reference,key => kimi_request(key),response => Kimi.kimi_windows_sql(response),response => Kimi.kimi_problem_sql(response))

# --- providers without a readable usage API ----------------------------------------

# Anthropic API credit (an api_key account): the Admin usage and cost API reports past
# usage and spend; no endpoint reports the remaining credit balance.
def claude_credit_reason() -> String:
  "Anthropic publishes no endpoint for the remaining API credit balance; the usage and cost API reports past usage and spend only"

# Claude Max (claude-oauth): the reader of GET https://api.anthropic.com/api/oauth/usage
# is a provider module that is not in this build yet.
def read_claude(+observed: String, +reference: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(scheme_of(reference),"claude-oauth"),
    print_unreadable("claude","GET https://api.anthropic.com/api/oauth/usage",observed,"no usage reader for Claude Max is in this build"),
    print_unreadable("claude","",observed,claude_credit_reason()))

def muse_reason() -> String:
  "the configured Muse credential is an API key, and no usage or quota endpoint for it is documented"

# --- dispatch ------------------------------------------------------------------------

def read_provider(+provider: String, +reference: String, +observed: String) -> IO(Unit):
  match provider:
    case "zai": read_zai(observed,reference)
    case "kimi-code": read_kimi(observed,reference)
    case "claude": read_claude(observed,reference)
    case "muse": print_unreadable("muse","",observed,muse_reason())
    case _: print_unreadable(provider,"",observed,"no usage reader for provider " ++ provider ++ " is in this build")

def main_arguments(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +provider <> +reference <> Nil{}: do IO<Unit>:
      now : Result<&1,&1,U32 & String,String> <- Clock.Clock.millis()
      read_provider(provider,reference,time_value(now))
    case other: IO.die(Unit,2,"usage: usage-read PROVIDER CREDENTIAL_REF")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    main_arguments(arguments)
