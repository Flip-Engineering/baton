import Base
import ./commands.bend as C
import ../host/sqlite.bend as DB

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

