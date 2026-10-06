import Base
import ./commands.bend as C
import ./control.bend as Control
import ./receiver-route-protocol.bend as Protocol

# The caller supplies canonical, checked origin values. Compare every literal
# endpoint field, including helper/registry, executable, command and output path.
def binding_predicate(origin: Protocol.Origin, +binding: Protocol.Binding) -> String:
  match origin:
    case Protocol.Origin{+executable,+database,+session,+registry,+helper}:
      match binding:
        case Protocol.Binding{+configuration,+harness,+model,+effort,+command,+log}:
          "(id=" ++ C.q(session) ++ " AND harness=" ++ C.q(harness) ++ " AND model=" ++ C.q(model) ++ " AND effort=" ++ C.q(effort)
          ++ " AND " ++ C.q(configuration) ++ "<>'' AND " ++ C.q(registry) ++ "<>'' AND " ++ C.q(helper) ++ "<>''"
          ++ " AND CASE WHEN json_valid(endpoint) THEN json(endpoint)=json("
          ++ C.q("[" ++ Control.strings(Protocol.route_args(Protocol.Origin{executable,database,session,registry,helper},Protocol.Binding{configuration,harness,model,effort,command,log})) ++ "]")
          ++ ") ELSE 0 END)"

# Original-attempt recovery precedes this next-admission check. This query does
# not check stops, native custody, provider success or actual spawn environment.
def admission_sql(origin: Protocol.Origin, binding: Protocol.Binding) -> String:
  "SELECT EXISTS(SELECT 1 FROM sessions WHERE " ++ binding_predicate(origin,binding) ++ ");"

# The inspection object is a literal expected assignment. Every field is text;
# duplicate, missing and additional members refuse before JSON extraction.
def expected_shape(+expected: String) -> String:
  "(CASE WHEN json_valid(" ++ C.q(expected) ++ ") THEN json_type(" ++ C.q(expected) ++ ")='object'"
  ++ " AND (SELECT count(*)=12 AND count(DISTINCT key)=12 FROM json_each(" ++ C.q(expected) ++ "))"
  ++ " AND NOT EXISTS(SELECT 1 FROM json_each(" ++ C.q(expected) ++ ") WHERE type<>'text' OR instr(value,char(0))>0 OR key NOT IN ('parent','harness','model','effort','workspace','branch','base','native','endpoint','observedHarness','observedModel','observedEffort')) ELSE 0 END)"

def expected_field(+expected: String, key: String, column: String) -> String:
  " AND " ++ column ++ "=json_extract(" ++ C.q(expected) ++ "," ++ C.q("$." ++ key) ++ ")"

def expected_predicate(+expected: String) -> String:
  "(CASE WHEN " ++ expected_shape(expected) ++ " THEN 1"
  ++ expected_field(expected,"parent","parent") ++ expected_field(expected,"harness","harness")
  ++ expected_field(expected,"model","model") ++ expected_field(expected,"effort","effort")
  ++ expected_field(expected,"workspace","workspace") ++ expected_field(expected,"branch","branch")
  ++ expected_field(expected,"base","base") ++ expected_field(expected,"native","native")
  ++ expected_field(expected,"endpoint","endpoint") ++ expected_field(expected,"observedHarness","observed_harness")
  ++ expected_field(expected,"observedModel","observed_model") ++ expected_field(expected,"observedEffort","observed_effort")
  ++ " ELSE 0 END)"

def hierarchy(+requester: String, +session: String) -> String:
  "(EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(requester) ++ ") AND "
  ++ C.assigned_role(C.q(requester)) ++ "='conductor' AND " ++ C.q(requester) ++ "<>" ++ C.q(session)
  ++ " AND " ++ C.descendant(C.q(requester),C.q(session)) ++ " AND NOT " ++ C.stopped_session_sql(C.q(requester)) ++ ")"

def allowed(requester: String, +session: String, expected: String, +harness: String, +model: String, effort: String) -> String:
  "id=" ++ C.q(session) ++ " AND " ++ expected_predicate(expected) ++ " AND " ++ hierarchy(requester,session)
  ++ " AND parent IS NOT NULL AND harness IN ('omp','codex') AND " ++ C.q(harness) ++ " IN ('omp','codex')"
  ++ " AND (harness=" ++ C.q(harness) ++ " OR native='') AND " ++ C.q(model) ++ "<>''"
  ++ " AND instr(" ++ C.q(model) ++ ",char(0))=0 AND instr(" ++ C.q(effort) ++ ",char(0))=0"
  ++ " AND NOT " ++ C.stopped_session_sql("sessions.id")
  ++ " AND NOT EXISTS(SELECT 1 FROM executions WHERE session=sessions.id AND phase<>'exited')"

def check_sql(requester: String, session: String, expected: String, harness: String, model: String, effort: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM sessions WHERE " ++ allowed(requester,session,expected,harness,model,effort) ++ ");"

# Recognize the historical Control.receiver_args payload and identity_args prefix.
# These predicates check saved text and route consistency. Old installation paths
# can differ from the newly resolved origin; their existence is not asserted here.
def endpoint_field(index: U32) -> String:
  "json_extract(endpoint,'$[" ++ U32.show(index) ++ "]')"

def legacy_absolute(+index: U32) -> String:
  "substr(" ++ endpoint_field(index) ++ ",1,1)='/' AND length(" ++ endpoint_field(index) ++ ")>1"

def legacy_override(+index: U32, column: String) -> String:
  "(" ++ endpoint_field(index) ++ "='' OR " ++ endpoint_field(index) ++ "=" ++ column ++ ")"

def legacy_payload(database: String, +offset: U32) -> String:
  "(" ++ legacy_absolute(offset) ++ " AND " ++ endpoint_field(offset+1) ++ "=" ++ C.q(database)
  ++ " AND " ++ endpoint_field(offset+2) ++ "='receive' AND " ++ endpoint_field(offset+3) ++ "=id"
  ++ " AND " ++ legacy_absolute(offset+4) ++ " AND " ++ legacy_override(offset+5,"model")
  ++ " AND " ++ legacy_override(offset+6,"effort") ++ " AND " ++ legacy_override(offset+7,"workspace")
  ++ " AND " ++ legacy_absolute(offset+8) ++ ")"

def legacy_prefix() -> String:
  "(json_extract(endpoint,'$[0]')='node' AND " ++ legacy_absolute(1)
  ++ " AND json_extract(endpoint,'$[2]')='launch' AND json_extract(endpoint,'$[3]')='--registry' AND " ++ legacy_absolute(4)
  ++ " AND json_extract(endpoint,'$[5]')='--model-key' AND json_extract(endpoint,'$[6]')=model AND model<>'' AND json_extract(endpoint,'$[7]')='--')"

# The caller guards json_each/extract with json_valid before this expression.
def legacy_endpoint(+database: String) -> String:
  "(json_type(endpoint)='array' AND NOT EXISTS(SELECT 1 FROM json_each(endpoint) WHERE type<>'text' OR instr(value,char(0))>0) AND ((json_array_length(endpoint)=9 AND "
  ++ legacy_payload(database,0) ++ ") OR (json_array_length(endpoint)=17 AND " ++ legacy_prefix() ++ " AND " ++ legacy_payload(database,8) ++ ")))"

# The current endpoint retains the revision. Every successful change advances it,
# including a change back to an earlier model. Overflow and corrupt IDs refuse.
# Upgraded receiver/connect/attach writers preserve this invariant. Unfenced old
# executables must be retired before deployment of configured routes.
def revision_expression(database: String) -> String:
  "CASE WHEN " ++ C.configured_route("endpoint")
  ++ " THEN CASE WHEN json_valid(endpoint) THEN CASE WHEN json_type(endpoint)='array' AND json_array_length(endpoint)=18 AND json_extract(endpoint,'$[10]')='receive-configured' AND json_type(endpoint,'$[12]')='text'"
  ++ " AND NOT EXISTS(SELECT 1 FROM json_each(endpoint) WHERE type<>'text' OR instr(value,char(0))>0)"
  ++ " AND json_extract(endpoint,'$[0]')='node' AND json_extract(endpoint,'$[1]')<>'' AND json_extract(endpoint,'$[2]')='launch' AND json_extract(endpoint,'$[3]')='--registry' AND json_extract(endpoint,'$[4]')<>'' AND json_extract(endpoint,'$[5]')='--model-key' AND json_extract(endpoint,'$[6]')=model AND json_extract(endpoint,'$[7]')='--' AND json_extract(endpoint,'$[8]')<>'' AND json_extract(endpoint,'$[9]')<>'' AND json_extract(endpoint,'$[11]')=id AND json_extract(endpoint,'$[13]')=harness AND json_extract(endpoint,'$[14]')=model AND json_extract(endpoint,'$[15]')=effort AND json_extract(endpoint,'$[16]')<>'' AND json_extract(endpoint,'$[17]')<>''"
  ++ " AND json_extract(endpoint,'$[12]')=CAST(CAST(json_extract(endpoint,'$[12]') AS INTEGER) AS TEXT)"
  ++ " AND CAST(json_extract(endpoint,'$[12]') AS INTEGER) BETWEEN 1 AND 9223372036854775806"
  ++ " THEN CAST(CAST(json_extract(endpoint,'$[12]') AS INTEGER)+1 AS TEXT) ELSE '' END ELSE '' END ELSE CASE WHEN endpoint='' THEN '1' WHEN json_valid(endpoint) THEN CASE WHEN " ++ legacy_endpoint(database) ++ " THEN '1' ELSE '' END ELSE '' END END"

def revision_sql(database: String, session: String) -> String:
  "SELECT coalesce((SELECT " ++ revision_expression(database) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ "),'');"

def assignment_object() -> String:
  "json_object('parent',parent,'harness',harness,'model',model,'effort',effort,'endpoint',endpoint,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'workspace',workspace,'branch',branch,'base',base)"

def inspection_sql(+session: String) -> String:
  "SELECT json_object('type','receiver-route-inspection','session'," ++ C.q(session) ++ ", 'configurationApplied',json('false'),'providerStarted',json('false'),"
  ++ "'expectedAssignment',(SELECT " ++ assignment_object() ++ " FROM sessions WHERE id=" ++ C.q(session) ++ "),"
  ++ "'next',json_array(json_array('session'," ++ C.q(session) ++ "),json_array('inbox'," ++ C.q(session) ++ ",'--index'),json_array('turns'," ++ C.q(session) ++ ")));"

def origin_revision(origin: Protocol.Origin) -> String:
  match origin:
    case Protocol.Origin{executable,database,session,registry,helper}: revision_expression(database)

def commit_sql(requester: String, +session: String, expected: String, +binding: Protocol.Binding, +origin: Protocol.Origin) -> String:
  match binding:
    case Protocol.Binding{+configuration,+harness,+model,+effort,+command,+log}:
      "BEGIN IMMEDIATE;UPDATE sessions SET harness=" ++ C.q(harness) ++ ",model=" ++ C.q(model) ++ ",effort=" ++ C.q(effort)
      ++ ",endpoint=" ++ C.q("[" ++ Control.strings(Protocol.route_args(origin,Protocol.Binding{configuration,harness,model,effort,command,log})) ++ "]")
      ++ " WHERE " ++ allowed(requester,session,expected,harness,model,effort)
      ++ " AND (" ++ origin_revision(origin) ++ ")=" ++ C.q(configuration) ++ " AND " ++ C.q(configuration) ++ "<>'';"
      ++ "SELECT json_object('status',CASE WHEN changes()=1 THEN 'configured' ELSE 'expected-assignment-or-admission-conflict' END,'type','receiver-route-configuration','session'," ++ C.q(session) ++ ", 'configuration'," ++ C.q(configuration)
      ++ ", 'configurationApplied',json(CASE WHEN changes()=1 THEN 'true' ELSE 'false' END),"
      ++ "'providerStarted',json('false'),"
      ++ "'next',json_array(json_array('receiver-route'," ++ C.q(session) ++ ",'--inspect'),json_array('inbox'," ++ C.q(session) ++ ",'--index')));COMMIT;"

# Reconciliation reads under the still-held guard after a failed transaction
# response. It reports observed state and retains the original error separately.
def reconciliation_sql(+session: String, +expected: String, origin: Protocol.Origin, binding: Protocol.Binding) -> String:
  "SELECT json_object('observed',CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE " ++ binding_predicate(origin,binding)
  ++ " AND CASE WHEN " ++ expected_shape(expected) ++ " THEN 1"
  ++ expected_field(expected,"parent","parent") ++ expected_field(expected,"workspace","workspace")
  ++ expected_field(expected,"branch","branch") ++ expected_field(expected,"base","base")
  ++ expected_field(expected,"native","native") ++ expected_field(expected,"observedHarness","observed_harness")
  ++ expected_field(expected,"observedModel","observed_model") ++ expected_field(expected,"observedEffort","observed_effort")
  ++ " ELSE 0 END) THEN 'submitted-configuration' WHEN EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session)
  ++ " AND " ++ expected_predicate(expected) ++ ") THEN 'prior-assignment' ELSE 'different-or-missing-assignment' END,"
  ++ "'assignment',(SELECT " ++ assignment_object() ++ " FROM sessions WHERE id=" ++ C.q(session) ++ "));"

law legacy_executable_requires_an_absolute_nonempty_path:
  {legacy_absolute(0) == "substr(json_extract(endpoint,'$[0]'),1,1)='/' AND length(json_extract(endpoint,'$[0]'))>1" : String}

def legacy_executable_requires_an_absolute_nonempty_path():
  {==}

law legacy_model_override_preserves_the_recorded_route:
  {legacy_override(5,"model") == "(json_extract(endpoint,'$[5]')='' OR json_extract(endpoint,'$[5]')=model)" : String}

def legacy_model_override_preserves_the_recorded_route():
  {==}

law revision_read_binds_the_canonical_database:
  for database: String
  for session: String
  {revision_sql(database,session) == "SELECT coalesce((SELECT " ++ revision_expression(database) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ "),'');" : String}

def revision_read_binds_the_canonical_database(database,session):
  {==}

law legacy_wrapped_route_requires_the_actual_helper_prefix:
  {legacy_prefix() == "(json_extract(endpoint,'$[0]')='node' AND substr(json_extract(endpoint,'$[1]'),1,1)='/' AND length(json_extract(endpoint,'$[1]'))>1 AND json_extract(endpoint,'$[2]')='launch' AND json_extract(endpoint,'$[3]')='--registry' AND substr(json_extract(endpoint,'$[4]'),1,1)='/' AND length(json_extract(endpoint,'$[4]'))>1 AND json_extract(endpoint,'$[5]')='--model-key' AND json_extract(endpoint,'$[6]')=model AND model<>'' AND json_extract(endpoint,'$[7]')='--')" : String}

def legacy_wrapped_route_requires_the_actual_helper_prefix():
  {==}
