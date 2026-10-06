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

# The current endpoint retains the revision. Every successful change advances it,
# including a change back to an earlier model. Overflow and corrupt IDs refuse.
# Upgraded receiver/connect/attach writers preserve this invariant. Unfenced old
# executables must be retired before deployment of configured routes.
def revision_expression() -> String:
  "CASE WHEN " ++ C.configured_route("endpoint")
  ++ " THEN CASE WHEN json_valid(endpoint) THEN CASE WHEN json_type(endpoint)='array' AND json_array_length(endpoint)=18 AND json_extract(endpoint,'$[10]')='receive-configured' AND json_type(endpoint,'$[12]')='text'"
  ++ " AND NOT EXISTS(SELECT 1 FROM json_each(endpoint) WHERE type<>'text' OR instr(value,char(0))>0)"
  ++ " AND json_extract(endpoint,'$[0]')='node' AND json_extract(endpoint,'$[1]')<>'' AND json_extract(endpoint,'$[2]')='launch' AND json_extract(endpoint,'$[3]')='--registry' AND json_extract(endpoint,'$[4]')<>'' AND json_extract(endpoint,'$[5]')='--model-key' AND json_extract(endpoint,'$[6]')=model AND json_extract(endpoint,'$[7]')='--' AND json_extract(endpoint,'$[8]')<>'' AND json_extract(endpoint,'$[9]')<>'' AND json_extract(endpoint,'$[11]')=id AND json_extract(endpoint,'$[13]')=harness AND json_extract(endpoint,'$[14]')=model AND json_extract(endpoint,'$[15]')=effort AND json_extract(endpoint,'$[16]')<>'' AND json_extract(endpoint,'$[17]')<>''"
  ++ " AND json_extract(endpoint,'$[12]')=CAST(CAST(json_extract(endpoint,'$[12]') AS INTEGER) AS TEXT)"
  ++ " AND CAST(json_extract(endpoint,'$[12]') AS INTEGER) BETWEEN 1 AND 9223372036854775806"
  ++ " THEN CAST(CAST(json_extract(endpoint,'$[12]') AS INTEGER)+1 AS TEXT) ELSE '' END ELSE '' END ELSE CASE WHEN endpoint='' THEN '1' WHEN json_valid(endpoint) THEN CASE WHEN json_type(endpoint)='array' AND NOT EXISTS(SELECT 1 FROM json_each(endpoint) WHERE type<>'text' OR instr(value,char(0))>0) AND ((json_array_length(endpoint)=17 AND json_extract(endpoint,'$[10]')='receive' AND json_extract(endpoint,'$[11]')=id) OR (json_array_length(endpoint)=9 AND json_extract(endpoint,'$[2]')='receive' AND json_extract(endpoint,'$[3]')=id)) THEN '1' ELSE '' END ELSE '' END END"

def revision_sql(session: String) -> String:
  "SELECT coalesce((SELECT " ++ revision_expression() ++ " FROM sessions WHERE id=" ++ C.q(session) ++ "),'');"

def assignment_object() -> String:
  "json_object('parent',parent,'harness',harness,'model',model,'effort',effort,'endpoint',endpoint,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'workspace',workspace,'branch',branch,'base',base)"

def inspection_sql(+session: String) -> String:
  "SELECT json_object('type','receiver-route-inspection','session'," ++ C.q(session) ++ ", 'configurationApplied',json('false'),'providerStarted',json('false'),"
  ++ "'expectedAssignment',(SELECT " ++ assignment_object() ++ " FROM sessions WHERE id=" ++ C.q(session) ++ "),"
  ++ "'next',json_array(json_array('session'," ++ C.q(session) ++ "),json_array('inbox'," ++ C.q(session) ++ ",'--index'),json_array('turns'," ++ C.q(session) ++ ")));"

def commit_sql(requester: String, +session: String, expected: String, +binding: Protocol.Binding, +origin: Protocol.Origin) -> String:
  match binding:
    case Protocol.Binding{+configuration,+harness,+model,+effort,+command,+log}:
      "BEGIN IMMEDIATE;UPDATE sessions SET harness=" ++ C.q(harness) ++ ",model=" ++ C.q(model) ++ ",effort=" ++ C.q(effort)
      ++ ",endpoint=" ++ C.q("[" ++ Control.strings(Protocol.route_args(origin,Protocol.Binding{configuration,harness,model,effort,command,log})) ++ "]")
      ++ " WHERE " ++ allowed(requester,session,expected,harness,model,effort)
      ++ " AND (" ++ revision_expression() ++ ")=" ++ C.q(configuration) ++ " AND " ++ C.q(configuration) ++ "<>'';"
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
