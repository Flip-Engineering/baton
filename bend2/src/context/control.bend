# CLAIM: query-control admission. One bound transaction validates replay and
# conflict, the original ownership, the controlled query kind and its runtime
# attachment, commits the release or recovery intent, then reads the controlled
# query's resulting progress and recorded observations and inserts its own control
# row as complete with that closed observation.
#
# The transaction performs no keeper preparation, socket round trip or signal. An
# identical canonical replay returns the stored control row without a second
# intent; an uncontrollable subject leaves no cleanup intent, and a recorded SIGKILL
# intent is never downgraded to SIGTERM.
import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../json/canonical.bend as J
import ./store.bend as ContextStore
import ./admission.bend as ContextAdmission

# The committed intents. The stored text and the pure builder are the same
# expression, so the SQL insert cannot drift from the recorded document.
def cleanup_intent_text(controlQuery: String, signal: String) -> String:
  J.json_text(J.Jobj{J.Jpair{"controlQuery", J.Jstr{controlQuery}, J.Jpair{"signal", J.Jstr{signal}, J.Jnil{}}}})

def role_release_intent_text(controlQuery: String, signal: String, delivery: String, evidence: ContextAdmission.Evidence) -> String:
  J.json_text(J.Jobj{J.Jpair{"controlQuery", J.Jstr{controlQuery},
    J.Jpair{"delivery", J.Jstr{delivery},
    J.Jpair{"evidence", ContextAdmission.evidence_json(evidence),
    J.Jpair{"signal", J.Jstr{signal}, J.Jnil{}}}}}})

def recovery_intent_text(controlQuery: String) -> String:
  J.json_text(J.Jobj{J.Jpair{"controlQuery", J.Jstr{controlQuery}, J.Jnil{}}})

def pending_release_text(controlQuery: String, +signal: String) -> String:
  role_release_intent_text(controlQuery, signal, "pending", ContextAdmission.NoEvidence{})

# The released signal ordering: an explicit SIGKILL is never replaced by SIGTERM.
def signal_ordering(+recorded: String, requested: String) -> String:
  Bool.pick(String, String.eq(recorded, "SIGKILL"), recorded, requested)

# The controller's own row is withheld unless the subject is an existing managed
# query of this owner with no runtime attachment and is not itself a control query.
def controllable(owner: String, controlledQuery: String) -> String:
  "EXISTS(SELECT 1 FROM semantic_queries c WHERE c.id=" ++ C.q(controlledQuery) ++ " AND c.owner=" ++ C.q(owner) ++ " AND c.runtime_id IS NULL AND NOT (c.result_json IS NOT NULL AND json_extract(c.result_json,'$.kind')='queryControl'))"

# Release records the query-wide cleanup intent first, so a role prepared after this
# commit still reconciles the recorded intent. An existing SIGKILL intent is kept.
def release_intent_sql(+owner: String, +controlledQuery: String, +controlQuery: String, +signal: String) -> String:
  "UPDATE semantic_queries SET cleanup_intent_json=CASE WHEN json_extract(cleanup_intent_json,'$.signal')='SIGKILL' THEN cleanup_intent_json ELSE " ++ C.q(cleanup_intent_text(controlQuery, signal)) ++ " END WHERE id=" ++ C.q(controlledQuery) ++ " AND " ++ controllable(owner, controlledQuery) ++ ";"

# An existing role keeps an attempted, acknowledged or unknown delivery; a pending
# intent is replaced unless it already records SIGKILL.
def role_intent_sql(+owner: String, +controlledQuery: String, +controlQuery: String, +signal: String) -> String:
  "UPDATE semantic_roles SET release_intent_json=CASE WHEN release_intent_json IS NULL THEN " ++ C.q(pending_release_text(controlQuery, signal)) ++ " WHEN json_extract(release_intent_json,'$.delivery')='pending' THEN CASE WHEN json_extract(release_intent_json,'$.signal')='SIGKILL' THEN release_intent_json ELSE " ++ C.q(pending_release_text(controlQuery, signal)) ++ " END ELSE release_intent_json END WHERE query_id=" ++ C.q(controlledQuery) ++ " AND " ++ controllable(owner, controlledQuery) ++ ";"

def recovery_intent_sql(+owner: String, +controlledQuery: String, +controlQuery: String) -> String:
  "UPDATE semantic_queries SET recovery_intent_json=CASE WHEN recovery_intent_json IS NULL THEN " ++ C.q(recovery_intent_text(controlQuery)) ++ " ELSE recovery_intent_json END WHERE id=" ++ C.q(controlledQuery) ++ " AND " ++ controllable(owner, controlledQuery) ++ ";"

# The closed control observation. Its state, progress, admission decision and
# observations describe the controlled query at this commit; its engine is read from
# a retained result when one exists, and an observation reference identifies a
# historical record rather than a live author.
def control_result_sql(+controlledQuery: String) -> String:
  "json_object('kind','queryControl','controlledQuery'," ++ C.q(controlledQuery) ++ ",'admissionDecision',(SELECT admission_decision FROM semantic_queries WHERE id=" ++ C.q(controlledQuery) ++ "),'state',(SELECT state FROM semantic_queries WHERE id=" ++ C.q(controlledQuery) ++ "),'progress',(SELECT CASE WHEN progress_json IS NULL THEN NULL ELSE json(progress_json) END FROM semantic_queries WHERE id=" ++ C.q(controlledQuery) ++ "),'engine',(SELECT CASE WHEN result_json IS NULL THEN NULL ELSE json_extract(result_json,'$.engine') END FROM semantic_queries WHERE id=" ++ C.q(controlledQuery) ++ "),'observations',(SELECT json_group_array(json_object('role',role,'incarnation',incarnation,'observerEvidence',CASE WHEN observer_identity_json IS NULL THEN NULL ELSE json(observer_identity_json) END,'cursor',observer_cursor,'capture',CASE WHEN capture_json IS NULL THEN NULL ELSE json(capture_json) END,'exitEvidence',CASE WHEN exit_evidence_json IS NULL THEN NULL ELSE json(exit_evidence_json) END)) FROM (SELECT role,incarnation,observer_identity_json,observer_cursor,capture_json,exit_evidence_json FROM semantic_roles WHERE query_id=" ++ C.q(controlledQuery) ++ " ORDER BY role,incarnation)))"

def control_row_sql(controlQuery: String, +owner: String, requestJson: String, +cwd: String, artifactPath: String, +controlledQuery: String) -> String:
  "INSERT INTO semantic_queries(id,owner,request_json,admission_decision,cwd,origin_attempt,state,result_json,artifact_path) SELECT "
  ++ C.q(controlQuery) ++ "," ++ C.q(owner) ++ "," ++ C.q(requestJson) ++ ",'accepted'," ++ C.q(cwd) ++ ",'0','complete'," ++ control_result_sql(controlledQuery) ++ "," ++ C.q(artifactPath) ++ " WHERE " ++ controllable(owner, controlledQuery)
  ++ ContextStore.replay_guard()

def intent_statement(+owner: String, +controlledQuery: String, +controlQuery: String, +intent: String, +signal: String) -> String:
  Bool.pick(String, String.eq(intent, "release"),
    release_intent_sql(owner, controlledQuery, controlQuery, signal) ++ role_intent_sql(owner, controlledQuery, controlQuery, signal),
    Bool.pick(String, String.eq(intent, "recover"), recovery_intent_sql(owner, controlledQuery, controlQuery), ""))

# The whole admission transaction: intents first, then the control row, then the
# marker row for a subject that is not controllable. The marker is an internal
# classification signal; the public refusal document stays the contract module's.
def control_admit_sql(+controlQuery: String, +owner: String, +requestJson: String, +controlledQuery: String, +intent: String, +signal: String, +cwd: String, +artifactPath: String) -> String:
  "BEGIN IMMEDIATE;" ++ ContextStore.schema()
  ++ intent_statement(owner, controlledQuery, controlQuery, intent, signal)
  ++ control_row_sql(controlQuery, owner, requestJson, cwd, artifactPath, controlledQuery)
  ++ "SELECT json_object('error','control-subject-unavailable') WHERE NOT " ++ controllable(owner, controlledQuery) ++ ";"
  ++ ContextStore.envelope_sql(controlQuery) ++ "COMMIT;"

# The control operation itself. Grants and the closed request profile are validated
# by the caller before this call; the controlled query's own admission decision is
# never rewritten and no second keeper is prepared here.
def control_admit(+db: String, +binding: String, +controlQuery: String, +owner: String, +requestJson: String, +controlledQuery: String, +intent: String, +signal: String, +cwd: String, +artifactPath: String) -> IO(Result<&1,&1,U32 & String,String>):
  DB.Sql.query_bound(db, binding, control_admit_sql(controlQuery, owner, requestJson, controlledQuery, intent, signal, cwd, artifactPath))
