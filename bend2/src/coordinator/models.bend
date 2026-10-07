# #683 models: the provider, alias, observation and capacity read.
#
# One read answers four separated facts and never asserts one from another: the
# registry's configured aliases (recorded configuration), the provider models a
# probe observed, each harness's metadata and capacity state with the probe that
# established it, and the continuation candidates of a named seat. The read starts
# no process; it selects stored rows and reads the registry file the way the usage
# read reads a recorded conversation. Capacity stays unknown wherever a provider
# stated no component, and a harness with no probe answers unknown rather than an
# empty catalog.
import Base
import ./commands.bend as C
import ./probes.bend as Probes
import ./continuation.bend as Continuation
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock
import ../git/text.bend as Tx
import ../json/canonical.bend as J

def limits() -> String:
  "'capacity-is-only-as-current-as-the-last-explicit-probe','observed_harness-and-observed_effort-are-declared-at-bind-not-provider-observed','provider-metadata-is-reported-as-the-provider-stated-it','a-registry-key-proves-a-configured-identity-and-not-capacity','a-listed-candidate-matches-the-identifier-its-own-harness-reported-exactly','a-registry-that-maps-no-key-for-a-model-does-not-refuse-that-model'"

def seen_cte() -> String:
  "seen AS (SELECT DISTINCT harness FROM sessions WHERE " ++ Probes.adapter_set("harness") ++ " UNION SELECT DISTINCT harness FROM provider_probes WHERE " ++ Probes.adapter_set("harness") ++ ")"

def observed_cte() -> String:
  "observed AS (SELECT harness,observed_model AS model,observed_effort AS effort,json_group_array(id) AS seats,json_group_array(DISTINCT observed_harness) AS declared_harness,json_group_array(DISTINCT observed_effort) AS declared_effort FROM sessions WHERE observed_model<>'' GROUP BY harness,observed_model,observed_effort)"

# The declared-at-bind columns are named as declared, not as provider observations.
def observed_item() -> String:
  "json_object('harness',harness,'model',model,'effort',effort,'seats',json(seats),'modelProvenance','observed-provider','routeProvenance','recorded-configuration','declaredHarnessAtBind',json(declared_harness),'declaredEffortAtBind',json(declared_effort))"

def observed_array() -> String:
  "json((SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ observed_item() ++ " AS item FROM observed ORDER BY harness,model,effort)))"

def executable_expr(+h: String) -> String:
  "coalesce((SELECT json_extract(s.endpoint,'$[0]') FROM sessions s WHERE s.harness=" ++ h ++ " AND s.endpoint<>'' AND json_valid(s.endpoint) AND json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 ORDER BY s.rowid DESC LIMIT 1),'')"

def provider_item() -> String:
  "json_object('harness',h.harness,'executable'," ++ executable_expr("h.harness") ++ ",'seats',(SELECT count(*) FROM sessions s WHERE s.harness=h.harness),'metadata'," ++ Probes.metadata_object("p") ++ ",'capacity'," ++ Probes.capacity_object("p","h.harness") ++ ",'probe'," ++ Probes.probe_object("p") ++ ")"

def providers_array() -> String:
  "json((SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ provider_item() ++ " AS item FROM seen h LEFT JOIN latest p ON p.harness=h.harness ORDER BY h.harness)))"

def registry_object(registry: String, +present: Bool, displays: String) -> String:
  "json_object('path'," ++ C.q(registry) ++ ",'state'," ++ Bool.pick(String,present,"'known'","'absent'") ++ ",'displays',json(" ++ C.q(displays) ++ "),'cause'," ++ Bool.pick(String,present,"NULL","'the series registry was not read; aliases are unknown, not empty'") ++ ")"

# The registry's model keys are recorded configuration. A display name comes from
# the series identity file the registry names; an unreadable one stays null. The
# `registry` field keeps the path the operator configured.
def aliases_expr(+text: String, present: Bool, displays: String, path: String) -> String:
  Bool.pick(String,present,
  "json((SELECT CASE WHEN json_valid(json(" ++ C.q(text) ++ ")) AND json_type(json(" ++ C.q(text) ++ "),'$.models')='object' THEN json_group_array(json_object('model',m.key,'series',m.value,'display',json_extract(json(" ++ C.q(displays) ++ "),('$.' || json_quote(m.value))),'registry'," ++ C.q(path) ++ ",'provenance','recorded-configuration')) ELSE NULL END FROM json_each(json(" ++ C.q(text) ++ "),'$.models') m))",
  "NULL")

def continuation_expr(session: String, registry: String, present: Bool, has_session: Bool) -> String:
  Bool.pick(String,has_session,Continuation.continuation_object(session,registry,present),"NULL")

def answer_sql(+session: String, +path: String, +text: String, +present: Bool, +displays: String, +has_session: Bool) -> String:
  "WITH " ++ Probes.latest_cte() ++ "," ++ Continuation.seat_cte(session) ++ "," ++ Continuation.routes_cte() ++ "," ++ Continuation.candidates_sql(text,present) ++ "," ++ seen_cte() ++ "," ++ observed_cte()
  ++ " SELECT json_object("
  ++ "'schema','baton2-models-v1',"
  ++ "'readAt',datetime('now'),"
  ++ "'registry'," ++ registry_object(path,present,displays) ++ ","
  ++ "'aliases'," ++ aliases_expr(text,present,displays,path) ++ ","
  ++ "'observed'," ++ observed_array() ++ ","
  ++ "'providers'," ++ providers_array() ++ ","
  ++ "'continuation'," ++ continuation_expr(session,text,present,has_session) ++ ","
  ++ "'limits',json_array(" ++ limits() ++ "));"

# --- the registry file read --------------------------------------------------

def read_text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: ""
    case Done{value}: value

def registry_content(registry: String) -> IO(String):
  do IO<String>:
    content : Result<&1,&1,U32 & String,String> <- Text.Text.read(registry)
    IO.pure(String,read_text(content))

def registry_text(+registry: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(registry),IO.pure(String,""),registry_content(registry))

# The registry names one directory per series; the identity file in that directory
# states the display name the operator provisioned.
def series_rows(db: String, +registry: String) -> IO(List<String>):
  do IO<List<String>>:
    listed : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(json(" ++ C.q(registry) ++ ")) AND json_type(json(" ++ C.q(registry) ++ "),'$.series')='object' THEN (SELECT group_concat(m.key || char(9) || m.value,char(10)) FROM json_each(json(" ++ C.q(registry) ++ "),'$.series') m) END;"))
    IO.pure(List<String>,Tx.split_lines(Tx.trim_nl(listed)))

def series_display(db: String, directory: String) -> IO(String):
  do IO<String>:
    content : Result<&1,&1,U32 & String,String> <- Text.Text.read(directory ++ "/identity-series.json")
    +text : String <- IO.pure(String,read_text(content))
    value : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(text) ++ ") THEN json_extract(json(" ++ C.q(text) ++ "),'$.displaySeries') END;"))
    +found : String <- IO.pure(String,Tx.trim_nl(value))
    IO.pure(String,Bool.pick(String,String.is_empty(found),"null",J.string_literal(found)))

def display_row(db: String, fields: List<String>) -> IO(String):
  match fields:
    case first <> second <> Nil{}: do IO<String>:
      +shown : String <- series_display(db,second)
      IO.pure(String,J.string_literal(first) ++ ":" ++ shown)
    case other: IO.pure(String,"")

def display_pairs(+db: String, rows: List<String>, +acc: String) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,acc)
    case row <> rest: do IO<String>:
      +pair : String <- display_row(db,Tx.split_tabs(row))
      separator : String <- IO.pure(String,Bool.pick(String,Bool.or(String.is_empty(acc),String.is_empty(pair)),"",","))
      display_pairs(db,rest,acc ++ separator ++ pair)

def display_entries(+db: String, registry: String) -> IO(String):
  do IO<String>:
    rows : List<String> <- series_rows(db,registry)
    pairs : String <- display_pairs(db,rows,"")
    IO.pure(String,"{" ++ pairs ++ "}")

def display_map(db: String, +registry: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(registry),IO.pure(String,"{}"),display_entries(db,registry))

# --- the command -------------------------------------------------------------

def identity_registry(identity: String & String) -> String:
  (registry,helper) = identity
  registry

def checked_session(+db: String, +session: String, has_session: Bool) -> IO(Unit):
  match has_session:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      present : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
      found : Bool <- IO.pure(Bool,String.eq(Tx.trim_nl(present),"1"))
      next : Unit <- Bool.pick(IO(Unit),found,IO.pure(Unit,Unit{}),IO.die(Unit,2,"{\"error\":\"session-not-registered\",\"session\":" ++ J.string_literal(session) ++ ",\"condition\":\"The requested session is not registered.\",\"next\":\"Inspect status and the requested ID, or run the read without SESSION for the whole answer.\"}"))
      IO.pure(Unit,Unit{})

def document(+db: String, +session: String, +has_session: Bool) -> IO(String):
  do IO<String>:
    checked : Unit <- checked_session(db,session,has_session)
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
    +registry : String <- IO.pure(String,identity_registry(identity))
    +text : String <- registry_text(registry)
    displays : String <- display_map(db,text)
    present : Bool <- IO.pure(Bool,Bool.and(Bool.not(String.is_empty(registry)),Bool.not(String.is_empty(text))))
    answer : String <- IO.try(String,DB.Sql.query(db,answer_sql(session,registry,text,present,displays,has_session)))
    IO.pure(String,Tx.trim_nl(answer))

def read(db: String, session: String, has_session: Bool) -> IO(Unit):
  do IO<Unit>:
    answer : String <- document(db,session,has_session)
    IO.print(answer)
    IO.pure(Unit,Unit{})
