# #683 provider probes: the append-only observation rows the models read reports.
#
# The four adapters the turn path dispatches (turn.bend) are the probe adapters.
# Each adapter's non-interactive metadata read was confirmed against the installed
# harnesses on 2026-10-06:
#
#   codex        <cmd> debug models                JSON catalog, $.models[].slug
#   omp          <cmd> models --json               JSON catalog, $.models[].selector
#   muse         <cmd> model-profile show <model>  one model's resolved profile, text
#   claude-code  no read                           the adapter exposes no metadata read
#
# A catalog read that states no model is recorded as an error, never as an empty
# catalog. An adapter with no read at all is recorded refused. No model name is
# written here; identifiers arrive in the provider's own output.
import Base
import ./commands.bend as C
import ../host/sqlite.bend as DB
import ../host/control.bend as Host
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../git/types.bend as T
import ../json/canonical.bend as J
import ../harness/codex-player.bend as Codex
import ../harness/omp-player.bend as Omp
import ../harness/muse-player.bend as Muse

# The adapter set of the turn dispatch, and nothing else.
def harnesses() -> String:
  "'codex','omp','muse','claude-code'"

def adapter_set(+column: String) -> String:
  column ++ " IN (" ++ harnesses() ++ ")"

def supported(+harness: String) -> Bool:
  Bool.or(String.eq(harness,"codex"),Bool.or(String.eq(harness,"omp"),Bool.or(String.eq(harness,"muse"),String.eq(harness,"claude-code"))))

# Muse states a resolved profile for one named model, so its read is model-scoped.
def needs_model(harness: String) -> Bool:
  String.eq(harness,"muse")

# The adapter answers a catalog read.
def catalog_read(+harness: String) -> Bool:
  Bool.or(String.eq(harness,"codex"),String.eq(harness,"omp"))

def has_read(+harness: String) -> Bool:
  Bool.or(catalog_read(harness),needs_model(harness))

# The read is the adapter's own, so the invocation lives with the adapter.
def read_args(+harness: String, +executable: String, model: String) -> List<String>:
  Bool.pick(List<String>,String.eq(harness,"codex"),Codex.query_args(executable),
  Bool.pick(List<String>,String.eq(harness,"omp"),Omp.query_args(executable),
  Bool.pick(List<String>,String.eq(harness,"muse"),Muse.query_args(executable,model),Nil{})))

# Only the Codex adapter states an access report beside its catalog.
def has_access(+harness: String) -> Bool:
  String.eq(harness,"codex")

def access_args(+harness: String, executable: String) -> List<String>:
  Bool.pick(List<String>,String.eq(harness,"codex"),Codex.access_args(executable),Nil{})

# Only the OMP adapter states per-provider usage limits beside its catalog.
def has_usage(+harness: String) -> Bool:
  String.eq(harness,"omp")

def usage_args(+harness: String, executable: String) -> List<String>:
  Bool.pick(List<String>,String.eq(harness,"omp"),Omp.usage_args(executable),Nil{})

# The latest probe row per harness. The table is append-only, so rowid order is
# observation order and the read takes the newest.
def latest_cte() -> String:
  "latest AS (SELECT p.harness,p.id,p.at,p.outcome,p.cause,p.reported,p.metadata,p.capacity FROM provider_probes p JOIN (SELECT harness,max(rowid) AS r FROM provider_probes GROUP BY harness) m ON m.harness=p.harness AND m.r=p.rowid)"

def probe_join(+harness_column: String) -> String:
  " LEFT JOIN latest p ON p.harness=" ++ harness_column

def component(+p: String, +name: String) -> String:
  "json_extract(" ++ p ++ ".capacity,'$." ++ name ++ "')"

def stated(+p: String) -> String:
  "((" ++ component(p,"limit") ++ ") IS NOT NULL OR (" ++ component(p,"used") ++ ") IS NOT NULL OR (" ++ component(p,"remaining") ++ ") IS NOT NULL OR (" ++ component(p,"resetAt") ++ ") IS NOT NULL)"

def reset_instant(+p: String) -> String:
  "CASE WHEN json_type(" ++ p ++ ".capacity,'$.resetAt') IN ('integer','real') THEN datetime(json_extract(" ++ p ++ ".capacity,'$.resetAt'),'unixepoch') ELSE datetime(json_extract(" ++ p ++ ".capacity,'$.resetAt')) END"

# Capacity is known only when the provider stated a component. A successful read
# that stated none leaves capacity unknown beside a known metadata state.
def capacity_state(+p: String) -> String:
  "CASE WHEN " ++ p ++ ".harness IS NULL THEN 'unknown' WHEN " ++ p ++ ".outcome<>'ok' THEN 'error' WHEN " ++ stated(p) ++ " AND " ++ reset_instant(p) ++ " IS NOT NULL AND " ++ reset_instant(p) ++ "<=datetime('now') THEN 'expired' WHEN " ++ stated(p) ++ " THEN 'known' ELSE 'unknown' END"

def access_of(+p: String) -> String:
  "json(coalesce(json_extract(" ++ p ++ ".metadata,'$.access'),'null'))"

def usage_of(+p: String) -> String:
  "json(coalesce(json_extract(" ++ p ++ ".metadata,'$.usage'),'null'))"

def metadata_object(+p: String) -> String:
  "CASE WHEN " ++ p ++ ".harness IS NULL THEN json_object('state','unknown','models',NULL,'provenance',NULL,'providers',NULL,'requestedModel',NULL,'absent',json('[]'),'cause',NULL,'access',json('null'),'usage',json('null')) WHEN " ++ p ++ ".outcome='ok' THEN json_object('state','known','models',coalesce(json(json_extract(" ++ p ++ ".metadata,'$.models')),json('null')),'provenance',json_extract(" ++ p ++ ".metadata,'$.provenance'),'providers',json(coalesce(json_extract(" ++ p ++ ".metadata,'$.providers'),'null')),'requestedModel',json_extract(" ++ p ++ ".metadata,'$.requestedModel'),'absent',json(coalesce(json_extract(" ++ p ++ ".metadata,'$.absent'),'[]')),'cause',NULL,'access'," ++ access_of(p) ++ ",'usage'," ++ usage_of(p) ++ ") ELSE json_object('state','error','models',NULL,'provenance',NULL,'providers',NULL,'requestedModel',NULL,'absent',json('[]'),'cause',nullif(" ++ p ++ ".cause,''),'access'," ++ access_of(p) ++ ",'usage'," ++ usage_of(p) ++ ") END"

# The absent list names each component the provider did not state, following the
# observed-usage idiom; a component stated as zero stays zero.
def absent_columns(+limit: String, +used: String, +remaining: String, +reset: String, +head: String) -> String:
  head ++ ",'absent',json((SELECT json_group_array(n) FROM ("
  ++ "SELECT 'limit' AS n WHERE " ++ limit ++ " IS NULL"
  ++ " UNION ALL SELECT 'used' WHERE " ++ used ++ " IS NULL"
  ++ " UNION ALL SELECT 'remaining' WHERE " ++ remaining ++ " IS NULL"
  ++ " UNION ALL SELECT 'resetAt' WHERE " ++ reset ++ " IS NULL))))"

def capacity_object(+p: String, +scope: String) -> String:
  absent_columns(component(p,"limit"),component(p,"used"),component(p,"remaining"),component(p,"resetAt"),
    "json_object('scope'," ++ scope ++ ",'state'," ++ capacity_state(p)
    ++ ",'limit'," ++ component(p,"limit")
    ++ ",'used'," ++ component(p,"used")
    ++ ",'remaining'," ++ component(p,"remaining")
    ++ ",'resetAt'," ++ component(p,"resetAt")
    ++ ",'reported',NULL")

def probe_object(+p: String) -> String:
  "CASE WHEN " ++ p ++ ".harness IS NULL THEN NULL ELSE json_object('id'," ++ p ++ ".id,'at'," ++ p ++ ".at,'ageSeconds',CASE WHEN " ++ p ++ ".at IS NULL THEN NULL ELSE cast(strftime('%s','now') as integer)-cast(strftime('%s'," ++ p ++ ".at) as integer) END,'outcome'," ++ p ++ ".outcome,'cause',nullif(" ++ p ++ ".cause,''),'reportedBytes',length(" ++ p ++ ".reported)) END"

# --- the written row ---------------------------------------------------------

def no_metadata() -> String:
  "json_object('models',NULL,'provenance',NULL,'absent',json('[]'))"

# The catalog's own provider field groups the identifiers, so a harness that serves
# several providers states each provider scope separately and a reader can compare
# one provider's models with another's.
def catalog_providers(+reported: String) -> String:
  "(SELECT coalesce(json_group_array(json_object('provider',g.provider,'models',json(g.models))),json('[]')) FROM (SELECT coalesce(json_extract(v.value,'$.provider'),'') AS provider,json_group_array(coalesce(json_extract(v.value,'$.selector'),json_extract(v.value,'$.slug'),json_extract(v.value,'$.id'),json_quote(v.value))) AS models FROM json_each(json(" ++ C.q(reported) ++ "),'$.models') v GROUP BY coalesce(json_extract(v.value,'$.provider'),'') ORDER BY provider) g)"

def catalog_metadata(+reported: String) -> String:
  "json_object('models',(SELECT json_group_array(coalesce(json_extract(v.value,'$.selector'),json_extract(v.value,'$.slug'),json_extract(v.value,'$.id'),json_quote(v.value))) FROM json_each(json(" ++ C.q(reported) ++ "),'$.models') v),'provenance','provider-catalog','providers'," ++ catalog_providers(reported) ++ ",'absent',json('[]'))"

# The identifier a model-scoped read echoes in its own output. Muse states the
# resolved model as `model: <id>`; an output without that field carries no
# identifier the provider itself stated.
def echoed_identifier(+text: String) -> String:
  "CASE WHEN instr(" ++ text ++ ",'model:')>0 THEN nullif(trim(CASE WHEN instr(substr(" ++ text ++ ",instr(" ++ text ++ ",'model:')+6),char(10))>0 THEN substr(substr(" ++ text ++ ",instr(" ++ text ++ ",'model:')+6),1,instr(substr(" ++ text ++ ",instr(" ++ text ++ ",'model:')+6),char(10))-1) ELSE substr(" ++ text ++ ",instr(" ++ text ++ ",'model:')+6) END),'') END"

# A model-scoped read lists only the identifier its own output echoed. The caller's
# string is recorded beside it as the requested model, and an output with no echoed
# identifier states a caller-stated provenance with the identifier absent, so a
# caller's name is never presented as provider output.
def scoped_metadata(model: String, +reported: String) -> String:
  "json_object('models',CASE WHEN " ++ echoed_identifier(C.q(reported)) ++ " IS NULL THEN NULL ELSE json_array(" ++ echoed_identifier(C.q(reported)) ++ ") END,'requestedModel'," ++ C.q(model) ++ ",'provenance',CASE WHEN " ++ echoed_identifier(C.q(reported)) ++ " IS NULL THEN 'caller-stated' ELSE 'provider-echoed' END,'absent',json(CASE WHEN " ++ echoed_identifier(C.q(reported)) ++ " IS NULL THEN '[\"catalog\",\"model-identifier\"]' ELSE '[\"catalog\"]' END))"

def access_field(+text: String, +path: String) -> String:
  "CASE WHEN json_valid(" ++ text ++ ") THEN json_extract(json(" ++ text ++ ")," ++ path ++ ") END"

# The access report is the provider's own document: the stored credential mode and
# its status, and no quota window. A report that did not parse is an error; a report
# that parsed without the credential check is unknown with the component named; a
# harness with no access read states null rather than a claim.
def access_status(+text: String) -> String:
  access_field(text,"'$.checks.\"auth.credentials\".status'")

def access_mode(+text: String) -> String:
  access_field(text,"'$.checks.\"auth.credentials\".details.\"stored auth mode\"'")

def access_tokens(+text: String) -> String:
  access_field(text,"'$.checks.\"auth.credentials\".details.\"stored ChatGPT tokens\"'")

def access_key(+text: String) -> String:
  access_field(text,"'$.checks.\"auth.credentials\".details.\"stored API key\"'")

def access_state(+text: String) -> String:
  "CASE WHEN NOT json_valid(" ++ text ++ ") THEN 'error' WHEN json_extract(json(" ++ text ++ "),'$.checks.\"auth.credentials\"') IS NULL THEN 'unknown' ELSE 'known' END"

def access_absent(+text: String) -> String:
  "json((SELECT json_group_array(n) FROM ("
  ++ "SELECT 'status' AS n WHERE " ++ access_status(text) ++ " IS NULL"
  ++ " UNION ALL SELECT 'authMode' WHERE " ++ access_mode(text) ++ " IS NULL"
  ++ " UNION ALL SELECT 'chatgptTokens' WHERE " ++ access_tokens(text) ++ " IS NULL"
  ++ " UNION ALL SELECT 'apiKey' WHERE " ++ access_key(text) ++ " IS NULL)))"

def access_document(+text: String) -> String:
  "json_object('state'," ++ access_state(text)
  ++ ",'status'," ++ access_status(text)
  ++ ",'authMode'," ++ access_mode(text)
  ++ ",'chatgptTokens'," ++ access_tokens(text)
  ++ ",'apiKey'," ++ access_key(text)
  ++ ",'absent'," ++ access_absent(text)
  ++ ",'cause',CASE WHEN json_valid(" ++ text ++ ") THEN NULL ELSE 'the access report did not parse' END"
  ++ ",'reportedBytes',length(" ++ text ++ "))"

def access_object(+harness: String, +text: String) -> String:
  Bool.pick(String,has_access(harness),access_document(text),"json('null')")

# The usage report is the provider's own document: a limit window per provider with
# its reset instant and the allowance it holds. Account identifiers and endpoints are
# left out of the answer and named in absent; the verbatim report stays in the row.
def usage_providers(+text: String) -> String:
  "json(CASE WHEN json_valid(" ++ text ++ ") THEN (SELECT coalesce(json_group_array(json_object('provider',k.key,'windows',json(coalesce(k.value,'[]')))),json('[]')) FROM json_each(json(" ++ text ++ "),'$.capacity') k) ELSE '[]' END)"

def usage_limits(+text: String) -> String:
  "json(CASE WHEN json_valid(" ++ text ++ ") THEN (SELECT coalesce(json_group_array(json_object('provider',json_extract(r.value,'$.provider'),'fetchedAt',json_extract(r.value,'$.fetchedAt'),'limits',(SELECT coalesce(json_group_array(json_object('id',json_extract(l.value,'$.id'),'label',json_extract(l.value,'$.label'),'windowId',json_extract(l.value,'$.scope.windowId'),'windowLabel',json_extract(l.value,'$.window.label'),'durationMs',json_extract(l.value,'$.window.durationMs'),'resetsAt',json_extract(l.value,'$.window.resetsAt'),'used',json_extract(l.value,'$.amount.used'),'limit',json_extract(l.value,'$.amount.limit'),'remaining',json_extract(l.value,'$.amount.remaining'),'unit',json_extract(l.value,'$.amount.unit'),'usedFraction',json_extract(l.value,'$.amount.usedFraction'),'remainingFraction',json_extract(l.value,'$.amount.remainingFraction'),'status',json_extract(l.value,'$.status'))),json('[]')) FROM json_each(r.value,'$.limits') l))),json('[]')) FROM json_each(json(" ++ text ++ "),'$.reports') r) ELSE '[]' END)"

def usage_disabled(+text: String) -> String:
  "json(CASE WHEN json_valid(" ++ text ++ ") THEN (SELECT coalesce(json_group_array(json_object('provider',json_extract(x.value,'$.provider'),'type',json_extract(x.value,'$.type'),'cause',json_extract(x.value,'$.cause'),'disabledAtMs',json_extract(x.value,'$.disabledAtMs'))),json('[]')) FROM json_each(json(" ++ text ++ "),'$.disabledCredentials') x) ELSE '[]' END)"

# The provider's own window status decides availability: a limit the provider marks
# other than ok, or one whose used fraction has reached one, is exhausted; a provider
# with stated limits and none of those is available; a provider that stated no limit
# is unknown, so an unqueried limit is never reported as an allowance.
def usage_availability(+text: String) -> String:
  "json(CASE WHEN json_valid(" ++ text ++ ") THEN (SELECT coalesce(json_group_array(json_object('provider',json_extract(rp.value,'$.provider'),'state',CASE WHEN (SELECT count(*) FROM json_each(rp.value,'$.limits'))=0 THEN 'unknown' WHEN (SELECT count(*) FROM json_each(rp.value,'$.limits') l WHERE coalesce(json_extract(l.value,'$.status'),'ok')<>'ok' OR coalesce(json_extract(l.value,'$.amount.usedFraction'),0)>=1 OR (json_extract(l.value,'$.amount.remainingFraction') IS NOT NULL AND json_extract(l.value,'$.amount.remainingFraction')<=0))>0 THEN 'exhausted' ELSE 'available' END,'basis','provider-reported-window','windows',(SELECT json_group_array(json_object('window',json_extract(l.value,'$.windowId'),'status',json_extract(l.value,'$.status'),'remainingFraction',json_extract(l.value,'$.amount.remainingFraction'))) FROM json_each(rp.value,'$.limits') l))),json('[]')) FROM json_each(json(" ++ text ++ "),'$.reports') rp) ELSE '[]' END)"

def usage_object(+text: String, present: Bool) -> String:
  Bool.pick(String,present,
    "json_object('state',CASE WHEN NOT json_valid(" ++ text ++ ") THEN 'error' WHEN json_extract(json(" ++ text ++ "),'$.capacity') IS NULL AND json_extract(json(" ++ text ++ "),'$.reports') IS NULL THEN 'unknown' ELSE 'known' END,'generatedAt',CASE WHEN json_valid(" ++ text ++ ") THEN json_extract(json(" ++ text ++ "),'$.generatedAt') END,'reportedBytes',length(" ++ text ++ "),'providers'," ++ usage_providers(text) ++ ",'limits'," ++ usage_limits(text) ++ ",'accountsWithoutUsage',CASE WHEN json_valid(" ++ text ++ ") THEN json_array_length(json(" ++ text ++ "),'$.accountsWithoutUsage') END,'availability'," ++ usage_availability(text) ++ ",'disabledCredentials'," ++ usage_disabled(text) ++ ",'absent',json('[\"account-email\",\"account-id\",\"endpoint\"]'),'cause',CASE WHEN json_valid(" ++ text ++ ") THEN NULL ELSE 'the usage report did not parse' END)",
    "json('null')")

def base_metadata(+harness: String, model: String, +reported: String, +ok: Bool) -> String:
  Bool.pick(String,Bool.and(ok,catalog_read(harness)),catalog_metadata(reported),
  Bool.pick(String,Bool.and(ok,needs_model(harness)),scoped_metadata(model,reported),no_metadata()))

# Metadata is the provider's parsed catalog when a catalog read succeeded, the
# named model when a model-scoped read succeeded, and null otherwise.
def metadata_columns(+harness: String, model: String, reported: String, +ok: Bool, +access: String, +usage: String) -> String:
  "json_set(" ++ base_metadata(harness,model,reported,ok) ++ ",'$.access'," ++ access ++ ",'$.usage'," ++ usage ++ ")"

def capacity_columns(+limit: String, +used: String, +remaining: String, +reset: String) -> String:
  absent_columns(limit,used,remaining,reset,"json_object('limit'," ++ limit ++ ",'used'," ++ used ++ ",'remaining'," ++ remaining ++ ",'resetAt'," ++ reset ++ ",'reported',NULL")

def capacity_expr(+reported: String, parseable: Bool) -> String:
  Bool.pick(String,parseable,
    capacity_columns(
      "json_extract(json(" ++ C.q(reported) ++ "),'$.capacity.limit')",
      "json_extract(json(" ++ C.q(reported) ++ "),'$.capacity.used')",
      "json_extract(json(" ++ C.q(reported) ++ "),'$.capacity.remaining')",
      "json_extract(json(" ++ C.q(reported) ++ "),'$.capacity.resetAt')"),
    capacity_columns("NULL","NULL","NULL","NULL"))

# A catalog read that parsed must also have stated a model, so a failed read is
# never answered as an empty catalog.
def parse_check_sql(+reported: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ C.q(reported) ++ ") AND json_type(json(" ++ C.q(reported) ++ "),'$.models')='array' AND json_array_length(json(" ++ C.q(reported) ++ "),'$.models')>0 THEN 1 ELSE 0 END;"

def probe_insert(+harness: String, executable: String, outcome: String, cause: String, reported: String, metadata: String, capacity: String) -> String:
  "INSERT INTO provider_probes(id,harness,executable,outcome,cause,reported,metadata,capacity,at) SELECT 'probe-' || ((SELECT coalesce(max(rowid),0)+1 FROM provider_probes)) || '-' || " ++ C.q(harness) ++ "," ++ C.q(harness) ++ "," ++ C.q(executable) ++ "," ++ C.q(outcome) ++ "," ++ C.q(cause) ++ "," ++ C.q(reported) ++ "," ++ metadata ++ "," ++ capacity ++ ",datetime('now');"
  ++ "SELECT json_object('schema','baton2-provider-probe-v1','id',id,'harness',harness,'executable',executable,'outcome',outcome,'cause',nullif(cause,''),'reportedBytes',length(reported),'metadata',json(metadata),'capacity',json(capacity),'at',at) FROM provider_probes WHERE rowid=(SELECT max(rowid) FROM provider_probes);"

def record_sql(harness: String, executable: String, outcome: String, cause: String, reported: String, metadata: String, capacity: String) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema() ++ probe_insert(harness,executable,outcome,cause,reported,metadata,capacity) ++ "COMMIT;"

def recorded(+db: String, +harness: String, executable: String, outcome: String, cause: String, +reported: String, model: String, ok: Bool, parseable: Bool, +access: String, +usage: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,record_sql(harness,executable,outcome,cause,reported,metadata_columns(harness,model,reported,ok,access,usage),capacity_expr(reported,parseable))))
    IO.print(Tx.trim_nl(saved))
    IO.pure(Unit,Unit{})

# --- the command -------------------------------------------------------------

def next_probe() -> String:
  "[\"models\",\"provider-probe\"]"

def refusal(+code: String, harness: String, condition: String, next: String) -> String:
  "{\"error\":" ++ J.string_literal(code) ++ ",\"harness\":" ++ J.string_literal(harness) ++ ",\"condition\":" ++ J.string_literal(condition) ++ ",\"next\":" ++ next ++ "}"

def unsupported(harness: String) -> IO(Unit):
  IO.die(Unit,2,refusal("probe-harness-unsupported",harness,"The requested harness is not one of the four adapters the turn path dispatches.",next_probe()))

def resolved_text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: ""
    case Done{value}: value

# An unresolvable command is the read's own refusal, not the host's setup failure, so
# the caller sees the condition rather than a bare errno.
def resolved_control(+harness: String, cmd: String) -> IO(String):
  do IO<String>:
    resolution : Result<&1,&1,U32 & String,String> <- Host.Control.command(cmd)
    +path : String <- IO.pure(String,resolved_text(resolution))
    kept : String <- Bool.pick(IO(String),String.is_empty(path),IO.die(String,2,refusal("probe-command-unresolved",harness,"The harness command did not resolve to an executable.",next_probe())),IO.pure(String,path))
    IO.pure(String,kept)

def resolved_path(+harness: String, +cmd: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(cmd),IO.die(String,2,refusal("probe-command-unresolved",harness,"The harness command did not resolve to an executable.",next_probe())),resolved_control(harness,cmd))

def model_required(harness: String) -> IO(Unit):
  IO.die(Unit,2,refusal("probe-model-required",harness,"This adapter's metadata read is model-scoped and no model was supplied.",next_probe()))

def verify_parse(db: String, reported: String) -> IO(Bool):
  do IO<Bool>:
    valid : String <- IO.try(String,DB.Sql.query(db,parse_check_sql(reported)))
    IO.pure(Bool,String.eq(Tx.trim_nl(valid),"1"))

def exited_ok(+db: String, +harness: String, +executable: String, +reported: String, +access: String, +usage: String) -> IO(Unit):
  do IO<Unit>:
    listed : Bool <- verify_parse(db,reported)
    done : Unit <- Bool.pick(IO(Unit),listed,recorded(db,harness,executable,"ok","",reported,"",True{},True{},access,usage),recorded(db,harness,executable,"error","the provider output stated no model catalog",reported,"",False{},False{},access,usage))
    IO.pure(Unit,Unit{})

def exited(+db: String, +harness: String, +executable: String, +reported: String, +access: String, +usage: String, +code: U32) -> IO(Unit):
  Bool.pick(IO(Unit),U32.is_eq(code,0),exited_ok(db,harness,executable,reported,access,usage),recorded(db,harness,executable,"error","the provider exited with status " ++ U32.show(code),reported,"",False{},False{},access,usage))

def scoped_ok(+db: String, +harness: String, +executable: String, +model: String, +reported: String, +access: String, +usage: String) -> IO(Unit):
  recorded(db,harness,executable,"ok","",reported,model,True{},False{},access,usage)

def completed(+db: String, +harness: String, +executable: String, +model: String, +access: String, +usage: String, result: T.RunRes) -> IO(Unit):
  match result:
    case T.RSpawn{detail}: recorded(db,harness,executable,"error",detail,"",model,False{},False{},access,usage)
    case T.RRun{T.SExit{+code}, +out}: Bool.pick(IO(Unit),needs_model(harness),
      Bool.pick(IO(Unit),U32.is_eq(code,0),scoped_ok(db,harness,executable,model,out,access,usage),
        recorded(db,harness,executable,"error","the provider exited with status " ++ U32.show(code),out,model,False{},False{},access,usage)),
      exited(db,harness,executable,out,access,usage,code))
    case T.RRun{T.SSignal{num}, out}: recorded(db,harness,executable,"error","the provider was killed by signal " ++ U32.show(num),out,model,False{},False{},access,usage)

# An adapter that exposes no read is recorded refused, so its unavailability is an
# explicit observed state rather than an absent row.
def absent_read(+db: String, +harness: String, +executable: String) -> IO(Unit):
  recorded(db,harness,executable,"refused","this adapter exposes no non-interactive metadata read","","",False{},False{},"json('null')","json('null')")

def run_text(result: T.RunRes) -> String:
  match result:
    case T.RSpawn{detail}: ""
    case T.RRun{T.SExit{code}, out}: out
    case T.RRun{T.SSignal{num}, out}: out

# The access report is a second provider read in the same explicit action. It is
# recorded beside the catalog, and its own failure is stated in its own object.
def access_text(+harness: String, executable: String) -> IO(String):
  do IO<String>:
    run : Result<&1,&1,U32 & String,String> <- Process.Process.run(Tx.enc_argv(access_args(harness,executable)),".")
    IO.pure(String,run_text(Tx.run_res(run)))

def access_run(+harness: String, executable: String) -> IO(String):
  Bool.pick(IO(String),has_access(harness),access_text(harness,executable),IO.pure(String,""))

# The usage limits are a second provider read in the same explicit action, recorded
# beside the catalog with its own failure stated in its own object.
def usage_text(+harness: String, executable: String) -> IO(String):
  do IO<String>:
    run : Result<&1,&1,U32 & String,String> <- Process.Process.run(Tx.enc_argv(usage_args(harness,executable)),".")
    IO.pure(String,run_text(Tx.run_res(run)))

def usage_run(+harness: String, executable: String) -> IO(String):
  Bool.pick(IO(String),has_usage(harness),usage_text(harness,executable),IO.pure(String,""))

def invoked(+db: String, +harness: String, +executable: String, +model: String) -> IO(Unit):
  do IO<Unit>:
    report : String <- access_run(harness,executable)
    limits : String <- usage_run(harness,executable)
    run : Result<&1,&1,U32 & String,String> <- Process.Process.run(Tx.enc_argv(read_args(harness,executable,model)),".")
    completed(db,harness,executable,model,access_object(harness,C.q(report)),usage_object(C.q(limits),has_usage(harness)),Tx.run_res(run))

# The executable is resolved through the existing host binding before any read
# runs. The row records the resolved path, never the caller's text.
def probe(+db: String, +harness: String, +cmd: String, +model: String) -> IO(Unit):
  do IO<Unit>:
    admitted : Unit <- Bool.pick(IO(Unit),supported(harness),IO.pure(Unit,Unit{}),unsupported(harness))
    +readable : Bool <- IO.pure(Bool,has_read(harness))
    scoped : Unit <- Bool.pick(IO(Unit),Bool.and(readable,needs_model(harness)),Bool.pick(IO(Unit),String.is_empty(model),model_required(harness),IO.pure(Unit,Unit{})),IO.pure(Unit,Unit{}))
    +resolved : String <- Bool.pick(IO(String),readable,resolved_path(harness,cmd),IO.pure(String,""))
    wait : Unit <- Bool.pick(IO(Unit),readable,invoked(db,harness,resolved,model),absent_read(db,harness,resolved))
    IO.pure(Unit,Unit{})
