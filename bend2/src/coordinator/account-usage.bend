# Provider account observations use the configured harness and workspace. OMP may
# return cached reports after a failed refresh; fetchedAt belongs to each report.
import Base
import ./commands.bend as C
import ./receiver-route-sql.bend as Route
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../git/types.bend as T
import ../json/canonical.bend as J
import ../harness/omp-player.bend as Omp

type Selection is Data:
  OmpUsage{command: String, workspace: String, provider: String}
  UsageUnknown{condition: String}

# Both recognized endpoint writers retain an absolute harness command. The
# configuration predicate checks the saved model, session and argv structure.
def selection_sql(+database: String, +session: String) -> String:
  "WITH saved AS (SELECT *,CASE WHEN json_valid(endpoint) THEN "
  ++ Route.revision_expression(database) ++ " ELSE '' END AS revision FROM sessions WHERE id=" ++ C.q(session)
  ++ "), selected AS (SELECT *,CASE WHEN revision<>'' AND endpoint<>'' THEN CASE WHEN " ++ C.configured_route("endpoint")
  ++ " THEN CASE WHEN json_extract(endpoint,'$[9]')=" ++ C.q(database)
  ++ " THEN json_extract(endpoint,'$[16]') ELSE '' END"
  ++ " ELSE CASE json_array_length(endpoint) WHEN 9 THEN json_extract(endpoint,'$[4]') WHEN 17 THEN json_extract(endpoint,'$[12]') ELSE '' END END ELSE '' END AS command FROM saved)"
  ++ " SELECT coalesce((SELECT json_object('kind',CASE WHEN harness='omp' AND substr(command,1,1)='/' AND substr(workspace,1,1)='/' AND instr(model,'/')>1 AND length(substr(model,instr(model,'/')+1))>0 AND instr(workspace,char(0))=0 THEN 'omp' ELSE 'unknown' END,"
  ++ "'condition',CASE WHEN harness<>'omp' THEN 'unsupportedHarness' WHEN command='' OR substr(command,1,1)<>'/' THEN 'unavailableConfiguredCommand' WHEN substr(workspace,1,1)<>'/' OR instr(workspace,char(0))>0 THEN 'unavailableWorkspace' ELSE 'unavailableProviderIdentity' END,"
  ++ "'command',command,'workspace',workspace,'provider',substr(model,1,instr(model,'/')-1)) FROM selected),json_object('kind','unknown','condition','missingSession'));"

# Sql.read appends one LF. Remove that delimiter alone; paths can end in LF.
def remove_sql_lf(reversed: String) -> String:
  match reversed:
    case SCon{'\n', rest}: Tx.str_rev(rest)
    case other: Tx.str_rev(other)

def field_sql(document: String, field: String) -> String:
  "SELECT coalesce(json_extract(" ++ C.q(document) ++ "," ++ C.q("$." ++ field) ++ "),'');"

def read_field(+db: String, document: String, field: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.read(db,field_sql(document,field)))
    IO.pure(String,remove_sql_lf(Tx.str_rev(value)))

def selected(+db: String, +document: String, kind: String) -> IO(Selection):
  match kind:
    case "omp": do IO<Selection>:
      command : String <- read_field(db,document,"command")
      workspace : String <- read_field(db,document,"workspace")
      provider : String <- read_field(db,document,"provider")
      IO.pure(Selection,OmpUsage{command,workspace,provider})
    case other: do IO<Selection>:
      condition : String <- read_field(db,document,"condition")
      IO.pure(Selection,UsageUnknown{condition})

def usage_args(command: String, provider: String) -> List<String>:
  Omp.usage_arguments(command,provider)

def unknown(condition: String) -> String:
  "{\"availability\":\"unknown\",\"observationState\":\"unknown\",\"condition\":" ++ J.string_literal(condition) ++ "}"

def host_failure(stage: String, code: U32, detail: String) -> String:
  "{\"availability\":\"unknown\",\"observationState\":\"unknown\",\"condition\":\"hostFailure\",\"stage\":" ++ J.string_literal(stage)
  ++ ",\"code\":" ++ U32.show(code) ++ ",\"detail\":" ++ J.string_literal(detail) ++ "}"

# Keep child status and both streams, including their trailing newlines.
def process_document(condition: String, status: String, code: U32, stdout: String, stderr: String) -> String:
  "{\"availability\":\"unknown\",\"observationState\":\"unknown\",\"condition\":" ++ J.string_literal(condition)
  ++ ",\"process\":{\"status\":" ++ J.string_literal(status) ++ ",\"code\":" ++ U32.show(code)
  ++ ",\"stdout\":" ++ J.string_literal(stdout) ++ ",\"stderr\":" ++ J.string_literal(stderr) ++ "}}"

def child_read_failure(stage: String, code: U32, detail: String, stdout: String, stderr: String) -> String:
  "{\"availability\":\"unknown\",\"observationState\":\"unknown\",\"failure\":" ++ host_failure(stage,code,detail)
  ++ ",\"process\":{\"status\":\"exit\",\"code\":0,\"stdout\":" ++ J.string_literal(stdout) ++ ",\"stderr\":" ++ J.string_literal(stderr) ++ "}}"

def split_status(text: String, reversed: String) -> String & String:
  match text:
    case SNil{}: (Tx.str_rev(reversed),"")
    case SCon{'\n',rest}: (Tx.str_rev(reversed),rest)
    case SCon{c,rest}: split_status(rest,SCon{c,reversed})

# Only the validity observation admits subsequent JSON traversal.
def validity_sql(stdout: String) -> String:
  "SELECT json_valid(" ++ C.q(stdout) ++ ");"

def shape_sql(stdout: String) -> String:
  "WITH document(t) AS (SELECT " ++ C.q(stdout) ++ ") SELECT CASE WHEN json_type(t)='object' AND json_type(t,'$.reports')='array' AND json_type(t,'$.accountsWithoutUsage')='array' AND json_type(t,'$.disabledCredentials')='array' THEN 1 ELSE 0 END FROM document;"

# Preserve reported limits and timestamps as observations. The CLI supplies no
# per-report cache expiry or refresh failure marker, so current availability and
# freshness remain unknown. A passed reset explicitly expires that window.
def reports_sql(+stdout: String, +provider: String, +command: String, +workspace: String, +stderr: String) -> String:
  "WITH document(t) AS (SELECT " ++ C.q(stdout) ++ "), clock(ms) AS (SELECT CAST(strftime('%s','now') AS INTEGER)*1000),"
  ++ " reports AS (SELECT CASE WHEN type='object' THEN value ELSE '{}' END AS r,type FROM document,json_each(t,'$.reports')),"
  ++ " accounts AS (SELECT json_object('provider',json_extract(r,'$.provider'),'fetchedAt',json_extract(r,'$.fetchedAt'),"
  ++ "'source',json_extract(r,'$.metadata.endpoint'),'availability','unknown','freshness','unknown',"
  ++ "'observationState',CASE WHEN json_type(r,'$.fetchedAt') IN ('integer','real') AND json_extract(r,'$.fetchedAt')>0 AND json_extract(r,'$.fetchedAt')<=(SELECT ms FROM clock) AND json_type(r,'$.limits')='array' THEN 'reported' ELSE 'unknown' END,"
  ++ "'report',json(r),'windows',json((SELECT coalesce(json_group_array(json_object('reported',json(CASE WHEN type='object' THEN value ELSE '{}' END),'availability','unknown',"
  ++ "'observationState',CASE WHEN type='object' THEN CASE WHEN json_type(value,'$.window.resetsAt') IN ('integer','real') AND json_extract(value,'$.window.resetsAt')>0 THEN CASE WHEN json_extract(value,'$.window.resetsAt')<=(SELECT ms FROM clock) THEN 'expired' ELSE 'reported' END ELSE 'unknown' END ELSE 'unknown' END)),json('[]'))"
  ++ " FROM json_each(CASE WHEN json_type(r,'$.limits')='array' THEN json_extract(r,'$.limits') ELSE '[]' END) WHERE type='object'))) AS a"
  ++ " FROM reports WHERE type='object' AND json_extract(r,'$.provider')=" ++ C.q(provider) ++ ")"
  ++ " SELECT json_object('availability','unknown','observationState',CASE WHEN EXISTS(SELECT 1 FROM accounts WHERE json_extract(a,'$.observationState')='reported') THEN 'reported' ELSE 'unknown' END,"
  ++ "'condition',CASE WHEN EXISTS(SELECT 1 FROM accounts) THEN 'cacheFreshnessUnspecified' ELSE 'noProviderReport' END,"
  ++ "'provider'," ++ C.q(provider) ++ ",'source',json_object('harness','omp','command'," ++ C.q(command) ++ ",'workspace'," ++ C.q(workspace) ++ ",'providerFilter','outputOnly','accountSelection','configuredHarnessPool'),"
  ++ "'observedAt',(SELECT ms FROM clock),'generatedAt',json_extract(t,'$.generatedAt'),"
  ++ "'accounts',json((SELECT coalesce(json_group_array(json(a)),json('[]')) FROM accounts)),"
  ++ "'accountsWithoutUsage',json_extract(t,'$.accountsWithoutUsage'),'disabledCredentials',json_extract(t,'$.disabledCredentials'),"
  ++ "'process',json_object('status','exit','code',0,'stdout'," ++ C.q(stdout) ++ ",'stderr'," ++ C.q(stderr) ++ ")) FROM document;"

def report_after(stdout: String, stderr: String, result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{error}:
      match error:
        case (code,detail): IO.pure(String,child_read_failure("reportProjection",code,detail,stdout,stderr))
    case Done{document}: IO.pure(String,document)

def shape_observed(+db: String, +command: String, +workspace: String, +provider: String, +stdout: String, +stderr: String, observed: String) -> IO(String):
  match observed:
    case "1\n": do IO<String>:
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,reports_sql(stdout,provider,command,workspace,stderr))
      report_after(stdout,stderr,result)
    case other: IO.pure(String,process_document("unsupportedUsageShape","exit",0,stdout,stderr))

def shape_after(+db: String, +command: String, +workspace: String, +provider: String, +stdout: String, +stderr: String, result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{error}:
      match error:
        case (code,detail): IO.pure(String,child_read_failure("reportShape",code,detail,stdout,stderr))
    case Done{observed}: shape_observed(db,command,workspace,provider,stdout,stderr,observed)

def validity_observed(+db: String, +command: String, +workspace: String, +provider: String, +stdout: String, +stderr: String, observed: String) -> IO(String):
  match observed:
    case "1\n": do IO<String>:
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,shape_sql(stdout))
      shape_after(db,command,workspace,provider,stdout,stderr,result)
    case other: IO.pure(String,process_document("malformedUsageJson","exit",0,stdout,stderr))

def validity_after(+db: String, +command: String, +workspace: String, +provider: String, +stdout: String, +stderr: String, result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{error}:
      match error:
        case (code,detail): IO.pure(String,child_read_failure("reportValidity",code,detail,stdout,stderr))
    case Done{observed}: validity_observed(db,command,workspace,provider,stdout,stderr,observed)

def child_status(+db: String, +command: String, +workspace: String, +provider: String, +stderr: String, capture: String, result: T.RunRes) -> IO(String):
  match result:
    case T.RRun{T.SExit{0}, +stdout}: do IO<String>:
      valid : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,validity_sql(stdout))
      validity_after(db,command,workspace,provider,stdout,stderr,valid)
    case T.RRun{T.SExit{code},stdout}: IO.pure(String,process_document("usageCommandFailed","exit",code,stdout,stderr))
    case T.RRun{T.SSignal{code},stdout}: IO.pure(String,process_document("usageCommandSignaled","signal",code,stdout,stderr))
    case T.RSpawn{detail}: IO.pure(String,"{\"availability\":\"unknown\",\"observationState\":\"unknown\",\"condition\":\"malformedCapture\",\"detail\":" ++ J.string_literal(detail) ++ ",\"capture\":" ++ J.string_literal(capture) ++ ",\"stderr\":" ++ J.string_literal(stderr) ++ "}")

def captured(+db: String, +command: String, +workspace: String, +provider: String, result: Result<&1,&1,U32 & String,String & String>) -> IO(String):
  match result:
    case Fail{error}:
      match error:
        case (code,detail): IO.pure(String,host_failure("usageCapture",code,detail))
    case Done{pair}:
      match pair:
        case (stdout,stderr):
          +capture=stdout
          (head,body)=split_status(capture,"")
          child_status(db,command,workspace,provider,stderr,capture,Tx.run_res_line(head,body))

def observe_selected(+db: String, selection: Selection) -> IO(String):
  match selection:
    case UsageUnknown{condition}: IO.pure(String,unknown(condition))
    case OmpUsage{+command,+workspace,+provider}: do IO<String>:
      result : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture(Tx.enc_argv(usage_args(command,provider)),workspace)
      captured(db,command,workspace,provider,result)

def selection_after(+db: String, result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{error}:
      match error:
        case (code,detail): IO.pure(String,host_failure("usageSelection",code,detail))
    case Done{+document}: do IO<String>:
      kind : String <- read_field(db,document,"kind")
      selection : Selection <- selected(db,document,kind)
      observe_selected(db,selection)

def observe_canonical(+db: String, session: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,selection_sql(db,session))
    selection_after(db,result)

def observe(db: String, session: String) -> IO(String):
  do IO<String>:
    database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    observe_canonical(database,session)

law usage_invokes_the_recorded_command_with_literal_provider:
  {usage_args("/configured/omp","kimi-code") == ["/configured/omp","usage","--json","--provider","kimi-code"] : List<String>}

def usage_invokes_the_recorded_command_with_literal_provider():
  {==}

law usage_selection_runs_the_existing_capture_in_the_recorded_workspace:
  for +db: String
  {observe_selected(db,OmpUsage{"/configured/omp","/recorded/workspace","kimi-code"}) == (do IO<String>:
    result : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture(Tx.enc_argv(["/configured/omp","usage","--json","--provider","kimi-code"]),"/recorded/workspace")
    captured(db,"/configured/omp","/recorded/workspace","kimi-code",result)) : IO(String)}

def usage_selection_runs_the_existing_capture_in_the_recorded_workspace(db):
  {==}

law unsupported_usage_does_not_run_a_child:
  for db: String
  {observe_selected(db,UsageUnknown{"unsupportedHarness"}) == IO.pure(String,unknown("unsupportedHarness")) : IO(String)}

def unsupported_usage_does_not_run_a_child(db):
  {==}

law usage_host_failure_keeps_code_and_detail:
  {captured("db","/omp","/workspace","kimi-code",Fail{(13,"denied\n")}) == IO.pure(String,host_failure("usageCapture",13,"denied\n")) : IO(String)}

def usage_host_failure_keeps_code_and_detail():
  {==}

law failed_usage_child_keeps_both_streams:
  {captured("db","/omp","/workspace","kimi-code",Done{("exit 7\nquota\n\n","diagnostic\n")}) == IO.pure(String,process_document("usageCommandFailed","exit",7,"quota\n\n","diagnostic\n")) : IO(String)}

def failed_usage_child_keeps_both_streams():
  {==}

law sql_field_removes_only_its_transport_newline:
  {remove_sql_lf(Tx.str_rev("/workspace\n\n")) == "/workspace\n" : String}

def sql_field_removes_only_its_transport_newline():
  {==}


law invalid_usage_json_never_traverses_the_report:
  for db: String
  {validity_observed(db,"/omp","/work","kimi-code","{broken","notice\n","0\n") == IO.pure(String,process_document("malformedUsageJson","exit",0,"{broken","notice\n")) : IO(String)}

def invalid_usage_json_never_traverses_the_report(db):
  {==}

law valid_usage_observation_checks_shape_before_projection:
  for +db: String
  {validity_observed(db,"/omp","/work","kimi-code","{}","notice\n","1\n") == (do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,shape_sql("{}"))
    shape_after(db,"/omp","/work","kimi-code","{}","notice\n",result)) : IO(String)}

def valid_usage_observation_checks_shape_before_projection(db):
  {==}

law account_selection_uses_the_canonical_database_and_saved_route:
  for +db: String
  {observe_canonical(db,"reader") == (do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,selection_sql(db,"reader"))
    selection_after(db,result)) : IO(String)}

def account_selection_uses_the_canonical_database_and_saved_route(db):
  {==}

law signaled_usage_keeps_partial_output:
  {captured("db","/omp","/work","kimi-code",Done{("signal 15\npartial\n","diagnostic\n")}) == IO.pure(String,process_document("usageCommandSignaled","signal",15,"partial\n","diagnostic\n")) : IO(String)}

def signaled_usage_keeps_partial_output():
  {==}
