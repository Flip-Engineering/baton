import Base
import ./commands.bend as C
import ./control.bend as Control
import ../host/sqlite.bend as DB
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock

type Assignment is Data:
  Assignment{session: String, parent: String, harness: String, model: String, effort: String, workspace: String, branch: String, base: String, native: String, endpoint: String}

type Change is Data:
  Change{expected: Assignment, model: String, executable: String, database: String, command: String, log: String, identity: String & String}

# Prepared transaction text only. A future caller must hold the canonical
# session guard and the Receive owner's route-admission fence through commit.
# That fence must also cover old endpoint launches and post-release continuations.
# There is no IO entry for this transaction in this source contribution.
def assignment_predicate(expected: Assignment) -> String:
  match expected:
    case Assignment{session,parent,harness,model,effort,workspace,branch,base,native,endpoint}:
      "id=" ++ C.q(session) ++ " AND parent=" ++ C.q(parent) ++ " AND harness=" ++ C.q(harness)
      ++ " AND model=" ++ C.q(model) ++ " AND effort=" ++ C.q(effort) ++ " AND workspace=" ++ C.q(workspace)
      ++ " AND branch=" ++ C.q(branch) ++ " AND base=" ++ C.q(base) ++ " AND native=" ++ C.q(native) ++ " AND endpoint=" ++ C.q(endpoint)

def replacement_sql(expected: Assignment, +model: String, +endpoint: String) -> String:
  "BEGIN IMMEDIATE;UPDATE sessions SET model=" ++ C.q(model) ++ ",endpoint=" ++ C.q(endpoint)
  ++ " WHERE " ++ assignment_predicate(expected)
  ++ " AND parent IS NOT NULL AND harness='omp' AND " ++ C.q(model) ++ "<>'' AND instr(" ++ C.q(model) ++ ",char(0))=0"
  ++ " AND " ++ C.q(endpoint) ++ "<>'' AND " ++ C.endpoint_admitted(endpoint)
  ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=sessions.id)"
  ++ " AND NOT EXISTS(SELECT 1 FROM executions WHERE session=sessions.id AND phase<>'exited');"
  ++ "SELECT json_object('type','receiver-route-configuration','configurationApplied',json(CASE WHEN changes()=1 THEN 'true' ELSE 'false' END),"
  ++ "'status',CASE WHEN changes()=1 THEN 'configured' ELSE 'expected-assignment-or-admission-conflict' END,'providerStarted',json('false'));COMMIT;"

def assignment_session(expected: Assignment) -> String:
  match expected:
    case Assignment{session,parent,harness,model,effort,workspace,branch,base,native,endpoint}: session

# Change contains resolved executable/database/command/output paths and a checked
# registry/helper pair. The future transaction must run on that same database.
# The replacement endpoint is built here from the same requested model.
def change_sql(change: Change) -> String:
  match change:
    case Change{+expected,+model,executable,database,command,log,identity}:
      replacement_sql(expected,model,"[" ++ Control.strings(candidate_args(executable,database,assignment_session(expected),command,model,log,identity)) ++ "]")

# The configuration owner may compose this preparation with its admitted caller.
# It invokes the existing series mapping check and remains outside inspection.
def required_identity(registry: String, helper: String, missing: Bool) -> IO(String & String):
  match missing:
    case True{}: IO.die(String & String,2,"Route configuration requires the configured Git-series registry and canonical helper; retain the recorded route and inspect the installation.")
    case False{}: IO.pure(String & String,(registry,helper))

def route_identity(identity: String & String) -> IO(String & String):
  (registry,helper)=identity
  +configured=registry
  +executable=helper
  required_identity(configured,executable,Bool.or(String.is_empty(configured),String.is_empty(executable)))

def prepare(db: String, expected: Assignment, +model: String, +command: String, log: String) -> IO(Change):
  do IO<Change>:
    present : Unit <- Control.command_present(String.is_empty(command))
    native : String <- IO.try(String,Host.Control.command(command))
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    output : String <- IO.try(String,Host.Control.output(log))
    identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
    required : String & String <- route_identity(identity)
    checked : String & String <- Control.identity_checked(required,model)
    IO.pure(Change,Change{expected,model,executable,database,native,output,checked})

# This operation reports the missing admission boundary without changing a route.
# A recorded exited phase cannot exclude a delayed endpoint or continuation.
def inspect_sql(+session: String, +expected: String, +endpoint: String, +requested: String) -> String:
  "SELECT json_object('type','receiver-route-inspection','session'," ++ C.q(session) ++ ","
  ++ "'status','unavailable','configurationApplied',json('false'),'providerStarted',json('false'),"
  ++ "'expected',json_object('model'," ++ C.q(expected) ++ ",'endpoint'," ++ C.q(endpoint) ++ "),"
  ++ "'requested',json_object('model'," ++ C.q(requested) ++ "),"
  ++ "'recorded',(SELECT json_object('parent',parent,'harness',harness,'model',model,'effort',effort,'endpoint',endpoint,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'workspace',workspace,'branch',branch,'base',base) FROM sessions WHERE id=" ++ C.q(session) ++ "),"
  ++ "'reason',CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ") THEN 'session-missing' "
  ++ "WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ " AND parent IS NOT NULL AND harness='omp') THEN 'unsupported-assignment' "
  ++ "WHEN EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ " AND (model<>" ++ C.q(expected) ++ " OR endpoint<>" ++ C.q(endpoint) ++ ")) THEN 'expected-route-mismatch' "
  ++ "WHEN " ++ C.q(requested) ++ "='' OR instr(" ++ C.q(requested) ++ ",char(0))>0 THEN 'invalid-requested-model' "
  ++ "ELSE 'route-admission-unavailable' END,"
  ++ "'condition','Route changes require admission that binds each new attempt to its recorded route and matching Git series, including delayed delivery and continuation.',"
  ++ "'next',json_array(json_array('session'," ++ C.q(session) ++ "),json_array('inbox'," ++ C.q(session) ++ ",'--index'),json_array('turns'," ++ C.q(session) ++ ")));"

def snapshot(db: String, session: String, expected: String, endpoint: String, requested: String) -> IO(Result<&1,&1,U32 & String,String>):
  DB.Sql.read(db,inspect_sql(session,expected,endpoint,requested))

def inspect(db: String, session: String, expected: String, endpoint: String, requested: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,snapshot(db,session,expected,endpoint,requested))
    IO.die(Unit,2,saved)

# Prepared endpoint construction for the admission owner. Inputs must come from
# Control's canonical command/database/output and checked identity resolution.
# Explicit model and helper model-key agree. This does not fence old endpoints.
# The inspection entry neither invokes this helper nor publishes its result.
def candidate_args(executable: String, db: String, session: String, cmd: String, +model: String, log: String, identity: String & String) -> List<String>:
  Control.identity_args([executable,db,"receive",session,cmd,model,"","",log],model,identity)

law route_inspection_uses_the_readonly_connection:
  for db: String
  for session: String
  for expected: String
  for endpoint: String
  for requested: String
  {snapshot(db,session,expected,endpoint,requested) == DB.Sql.read(db,inspect_sql(session,expected,endpoint,requested)) : IO(Result<&1,&1,U32 & String,String>)}

def route_inspection_uses_the_readonly_connection(db,session,expected,endpoint,requested):
  {==}

law unavailable_route_configuration_returns_failure_after_inspection:
  for db: String
  for session: String
  for expected: String
  for endpoint: String
  for requested: String
  {inspect(db,session,expected,endpoint,requested) == (do IO<Unit>:
    saved : String <- IO.try(String,snapshot(db,session,expected,endpoint,requested))
    IO.die(Unit,2,saved)) : IO(Unit)}

def unavailable_route_configuration_returns_failure_after_inspection(db,session,expected,endpoint,requested):
  {==}

law proposed_endpoint_binds_the_explicit_model_and_series_key:
  {candidate_args("/bin/baton2","/db","player","/bin/omp","deepseek/deepseek-flash","/log",("/registry","/helper")) == ["node","/helper","launch","--registry","/registry","--model-key","deepseek/deepseek-flash","--","/bin/baton2","/db","receive","player","/bin/omp","deepseek/deepseek-flash","","","/log"] : List<String>}

def proposed_endpoint_binds_the_explicit_model_and_series_key():
  {==}
