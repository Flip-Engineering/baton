import Base
import ./log-schema.bend as LogSchema

type Command is Data:
  Join{id: String, parent: String, harness: String, model: String, effort: String, path: String}
  Recruit{id: String, parent: String, harness: String, model: String, effort: String, repo: String, branch: String, path: String, base: String}
  Worktree{id: String}
  Receive{session: String, cmd: String, model: String, effort: String, cwd: String, log: String, message: String}
  RecoverObserver{session: String, observer: String}
  Start{session: String, harness: String, cmd: String, model: String, effort: String, cwd: String, log: String, id: String, task: String}
  Receiver{session: String, cmd: String, log: String, cwd: String}
  Configure{id: String, harness: String, model: String, effort: String, cmd: String, log: String, expected_harness: String, expected_model: String, expected_effort: String}
  DispatchFile{id: String, sender: String, recipient: String, kind: String, path: String}
  DispatchTurn{player: String, id: String, cmd: String, log: String, task: String}
  StatusPretty{}
  Pretty{read: Command}
  Stop{session: String, id: String, reason: String}
  ForceStop{session: String, id: String}
  RunTurn{player: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String}
  Attach{id: String, harness: String, native: String, endpoint: String}
  Player{id: String, parent: String, harness: String, model: String, effort: String, workspace: String, branch: String, base: String}
  Connect{id: String, native: String, endpoint: String}
  Bind{id: String, native: String, harness: String, model: String, effort: String}
  Role{session: String, role: String}
  RoleRead{session: String}
  Ensemble{id: String, owner: String, coupling: String}
  EnsembleEnsure{id: String, owner: String}
  EnsembleRead{id: String}
  EnsembleMember{id: String, owner: String, session: String, action: String}
  Message{id: String, sender: String, recipient: String, kind: String, body: String}
  MessageFile{id: String, sender: String, recipient: String, kind: String, path: String}
  Observe{id: String, player: String, event: String, sealed: Bool}
  ObserveFile{id: String, player: String, path: String}
  Report{id: String, sender: String, body: String}
  ReportFile{id: String, sender: String, path: String}
  Ask{id: String, player: String, body: String}
  AskFile{id: String, player: String, path: String}
  NativeReply{parent: String, id: String, response: String}
  NativeReplyFile{parent: String, id: String, path: String}
  Ack{id: String, recipient: String, receipt: String}
  Session{id: String}
  Delivery{id: String}
  Pending{}
  PendingIndex{}
  Inbox{id: String}
  InboxIndex{id: String}
  Land{player: String, repo: String, target: String}
  LandAt{player: String, repo: String, target: String, commit: String}
  LandCheckedAt{player: String, repo: String, target: String, check: String, files: String, commit: String}
  LandChecked{player: String, repo: String, target: String, check: String, files: String}
  Push{repo: String, branch: String, remote: String}
  RemoteTip{repo: String, branch: String, remote: String}
  ObservedUsage{session: String}
  Models{session: String}
  Logs{session: String, level: String}
  LogsStorage{}
  LogsClean{session: String}
  Status{}
  Players{}
  LegacySubordinates{}
  PlayerRead{id: String}
  Section{ensemble: String, id: String, owner: String, capability: String}
  SectionRead{ensemble: String, id: String}
  SectionMember{ensemble: String, id: String, owner: String, player: String, action: String}
  Orchestra{}
  Turns{id: String}
  Project{path: String}
  ProjectSessions{path: String}
  Resume{session: String, lift_stop: Bool}
  KnowledgeRecord{id: String, author: String, claim: String, evidence: String, limits: String}
  KnowledgeRecordTyped{id: String, author: String, kind: String, claim: String, evidence: String, limits: String}
  KnowledgeRelate{id: String, author: String, source: String, relation: String, target: String}
  KnowledgeRead{reader: String}
  KnowledgeReadScope{reader: String, scope: String, subject: String}
  KnowledgeIndex{reader: String}
  KnowledgeDetail{reader: String, id: String}
  KnowledgeScopeIndex{reader: String, scope: String, subject: String}
  KnowledgeScopeDetail{reader: String, scope: String, subject: String, id: String}
  KnowledgePromote{id: String, promoter: String, source: String, destination: String, finding: String}
  View{subject: String, reader: String, port: String}
  UiSubscribe{after_cursor: String, generation: String}
  ContextEngines{session: String}
  ContextInstall{module_id: String, source: String}
  ContextQueryFile{owner: String, query: String, path: String}
  ContextResult{query: String}
  Serve{}
  OwnerStatus{}
  Help{}
  Invalid{}

def escape_char(+head: Char, tail: String, quote: Bool) -> String:
  match quote:
    case True{}: SCon{head,SCon{head,tail}}
    case False{}: SCon{head,tail}

def escaped(s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{+h, tail}:
      escape_char(h,escaped(tail),Char.is_eq(h,Char.from_u32(39)))

def q(s: String) -> String:
  "'" ++ escaped(s) ++ "'"

def section_schema() -> String:
  "CREATE TABLE IF NOT EXISTS sections (ensemble TEXT NOT NULL REFERENCES ensembles(id),id TEXT NOT NULL,capability TEXT NOT NULL CHECK(length(capability)>0),PRIMARY KEY(ensemble,id));"
  ++ "CREATE TABLE IF NOT EXISTS section_members (ensemble TEXT NOT NULL,section TEXT NOT NULL,session TEXT NOT NULL,PRIMARY KEY(ensemble,section,session),FOREIGN KEY(ensemble,section) REFERENCES sections(ensemble,id),FOREIGN KEY(ensemble,session) REFERENCES ensemble_members(ensemble,session) ON DELETE CASCADE);"

def messaging_schema() -> String:
  "CREATE TABLE IF NOT EXISTS session_roles (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id),role TEXT NOT NULL CHECK(role IN ('player','conductor','operator')));"
  ++ "CREATE TABLE IF NOT EXISTS ensembles (id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL REFERENCES sessions(id),coupling TEXT NOT NULL DEFAULT 'loose' CHECK(coupling IN ('loose','tight')));"
  ++ "CREATE TABLE IF NOT EXISTS ensemble_members (ensemble TEXT NOT NULL REFERENCES ensembles(id),session TEXT NOT NULL REFERENCES sessions(id),PRIMARY KEY(ensemble,session));"
  ++ section_schema()

def log_schema() -> String:
  LogSchema.tables()

# Stored role families and turn columns retain their existing names. Section
# membership references the existing Ensemble membership of each Player.

# Wake-claim table for issue #685. The claim records which driver holds a
# session while it evaluates the pending obligation, so two drivers cannot
# satisfy one obligation at once and an exit during evaluation does not lose
# it. States are claimed and unclaimed; the row is deleted when
# acknowledgement clears the obligation. A separate table keeps existing
# databases upgrade-safe: every commit runs schema(), so the table
# self-creates on first commit after upgrade, and readers tolerate absence.
def wake_claim_schema() -> String:
  "CREATE TABLE IF NOT EXISTS wake_claims (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), state TEXT NOT NULL DEFAULT 'claimed', owner TEXT NOT NULL DEFAULT '', generation INTEGER NOT NULL DEFAULT 0);"

def schema() -> String:
  wake_claim_schema()
  ++ "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT REFERENCES sessions(id), harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL REFERENCES sessions(id), recipient TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);"
  ++ "CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY NOT NULL REFERENCES messages(id), worker TEXT NOT NULL REFERENCES sessions(id), event TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS executions (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), id TEXT NOT NULL, mode TEXT NOT NULL, directory TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS session_stops (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, attempt TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '', signal INTEGER NOT NULL DEFAULT 15, applied_signal INTEGER NOT NULL DEFAULT 0, control_error TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, native_status TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '');"
  ++ messaging_schema()
  ++ log_schema()

def stopped_session_sql(session: String) -> String:
  "EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ session ++ ")"

def execution_input_sql(kind: String) -> String:
  kind ++ " IN ('task','guidance','recovery')"

def input_state_sql(+row: String) -> String:
  "CASE WHEN " ++ stopped_session_sql(row ++ ".recipient") ++ " THEN json_object('stopId',(SELECT id FROM session_stops WHERE session=" ++ row ++ ".recipient),'executionDisposition',CASE WHEN " ++ row ++ ".receipt IS NOT NULL THEN 'accepted' WHEN " ++ execution_input_sql(row ++ ".kind") ++ " THEN 'stopped' ELSE 'retained-for-stopped-session' END) ELSE json('{}') END"

# Session-state cause for a terminal stop, unsupported route, absent receiver,
# or failed provider attempt.
def blocked_endpoint_absent_sql(+session: String) -> String:
  "(" ++ "(SELECT route.endpoint FROM sessions AS route WHERE route.id=" ++ session ++ ")=''"
  ++ " OR NOT (json_valid((SELECT route.endpoint FROM sessions AS route WHERE route.id=" ++ session ++ "))"
  ++ " AND json_type((SELECT route.endpoint FROM sessions AS route WHERE route.id=" ++ session ++ "))='array'"
  ++ " AND json_array_length((SELECT route.endpoint FROM sessions AS route WHERE route.id=" ++ session ++ "))>0"
  ++ " AND NOT EXISTS(SELECT 1 FROM json_each((SELECT route.endpoint FROM sessions AS route WHERE route.id=" ++ session ++ ")) WHERE type<>'text' OR instr(value,char(0))>0)"
  ++ " AND coalesce(json_extract((SELECT route.endpoint FROM sessions AS route WHERE route.id=" ++ session ++ "),'$[0]'),'')<>''))"

# A Codex thread with a native identity can receive committed input through the
# public App queue even when it has no command-line receiver configuration.
def direct_app_route_sql(+session: String) -> String:
  "EXISTS(SELECT 1 FROM sessions AS route WHERE route.id=" ++ session ++ " AND route.harness='codex' AND route.native<>'' AND route.endpoint='')"

# OMP terminal arrays can contain scalar markers and metadata objects.
def last_assistant_sql_expr(+event: String) -> String:
  "(SELECT m.value FROM json_each(CASE WHEN json_type(" ++ event ++ ",'$.messages')='array' THEN json_extract(" ++ event ++ ",'$.messages') ELSE '[]' END) m WHERE CASE WHEN m.type='object' THEN json_extract(m.value,'$.role') END='assistant' ORDER BY m.key DESC LIMIT 1)"

# OMP records provider failure on the terminal's latest assistant message.
def omp_terminal_error_sql_expr(+event: String) -> String:
  "CASE WHEN json_extract(" ++ event ++ ",'$.type')='agent_end' THEN coalesce(json_extract(" ++ last_assistant_sql_expr(event) ++ ",'$.stopReason')='error',0) ELSE 0 END"

def blocked_cause_sql(+session: String) -> String:
  "CASE WHEN " ++ stopped_session_sql(session) ++ " THEN 'terminal-stop'"
  ++ " WHEN (SELECT route.harness FROM sessions AS route WHERE route.id=" ++ session ++ ") NOT IN ('codex','omp','muse','claude-code') THEN 'harness-unsupported'"
  ++ " WHEN " ++ blocked_endpoint_absent_sql(session) ++ " AND NOT " ++ direct_app_route_sql(session) ++ " THEN 'endpoint-absent'"
  ++ " WHEN EXISTS(SELECT 1 FROM executions e WHERE e.session=" ++ session ++ " AND e.phase='exited' AND (e.status<>'exit 0' OR EXISTS(SELECT 1 FROM turns t WHERE t.id=e.id AND t.worker=e.session AND (coalesce(json_extract(t.event,'$.is_error'),0)=1 OR " ++ omp_terminal_error_sql_expr("t.event") ++ " OR (json_extract(t.event,'$.payload.kind')='run_terminal' AND json_extract(t.event,'$.payload.terminal')<>'completed'))))) THEN 'provider-failure'"
  ++ " ELSE '' END"

# Wake and ownership projection shared by every session surface. Pending input
# uses the continuation count: unacknowledged input on an unstopped session.
# The claim reads the wake_claims table, which every commit creates through
# schema() before any surface query runs in the same transaction.
def wake_state_sql(+session: String) -> String:
  "json_object('pending',(SELECT count(*) FROM messages WHERE recipient=" ++ session ++ " AND receipt IS NULL AND NOT " ++ stopped_session_sql(session) ++ "),'claim',coalesce((SELECT state FROM wake_claims WHERE session=" ++ session ++ "),'') )"

# The accountable owner for blocked input: the recorded parent, else the
# registered operator. This mirrors report_recipient without naming it, which
# is defined below; the SQL shape is the same parent-first fallback.
def blocked_owner_sql(+session: String) -> String:
  "(SELECT CASE WHEN report_sender.parent IS NOT NULL THEN report_sender.parent WHEN coalesce((SELECT role FROM session_roles WHERE session=report_sender.id),'player')='conductor' THEN (SELECT report_owner.id FROM sessions report_owner WHERE report_owner.id='operator' AND report_owner.parent IS NULL AND coalesce((SELECT role FROM session_roles WHERE session=report_owner.id),'player')='operator') END FROM sessions report_sender WHERE report_sender.id=" ++ session ++ ")"

def session_state_sql(+session: String) -> String:
  "json_patch(coalesce((SELECT json_object('stop',json_object('id',id,'reason',reason,'status',outcome,'attempt',nullif(attempt,''),'requestedSignal',CASE WHEN attempt='' THEN NULL ELSE signal END,'submittedSignal',nullif(applied_signal,0),'controlError',nullif(control_error,''),'nativeStatus',nullif(native_status,''),'reportId',nullif(report_id,''))) FROM session_stops WHERE session=" ++ session ++ "),json('{}'))"
  ++ ",json_object('blockedCause'," ++ blocked_cause_sql(session) ++ ",'blockedOwner'," ++ blocked_owner_sql(session) ++ ",'wake'," ++ wake_state_sql(session) ++ "))"

def assigned_role(session: String) -> String:
  "coalesce((SELECT role FROM session_roles WHERE session=" ++ session ++ "),'player')"

def public_role(+session: String) -> String:
  "CASE " ++ assigned_role(session) ++ " WHEN 'conductor' THEN CASE WHEN (SELECT parent FROM sessions hierarchy WHERE hierarchy.id=" ++ session ++ ") IS NULL THEN 'principal-conductor' ELSE 'associate-conductor' END ELSE " ++ assigned_role(session) ++ " END"

def session_kind(session: String) -> String:
  "CASE WHEN " ++ assigned_role(session) ++ "='operator' THEN 'operator' ELSE 'player' END"

def role_family(+role: String) -> String:
  Bool.pick(String,Bool.or(String.eq(role,"principal-conductor"),String.eq(role,"associate-conductor")),"conductor",role)

def role_admitted(+session: String, +role: String) -> String:
  "EXISTS(SELECT 1 FROM sessions WHERE id=" ++ q(session) ++ " AND (" ++ q(role) ++ " IN ('player','conductor') OR (" ++ q(role) ++ " IN ('principal-conductor','operator') AND parent IS NULL) OR (" ++ q(role) ++ "='associate-conductor' AND parent IS NOT NULL)))"

def role_result(session: String) -> String:
  "SELECT json_object('session',id,'kind'," ++ session_kind("sessions.id") ++ ",'role'," ++ public_role("sessions.id") ++ ") FROM sessions WHERE id=" ++ q(session) ++ ";"

# An admitted endpoint is native argv JSON. `endpoint` keeps the stored text for
# existing readers; `endpointArgv` presents the same argv as a real JSON array,
# or null when the session has registered no argv.
def endpoint_argv(+column: String) -> String:
  "CASE WHEN json_valid(" ++ column ++ ") THEN CASE WHEN json_type(" ++ column ++ ")='array' THEN json(" ++ column ++ ") ELSE NULL END ELSE NULL END"

def session_result_where(condition: String) -> String:
  "SELECT json_patch(json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'endpointArgv'," ++ endpoint_argv("endpoint") ++ ",'workspace',workspace,'branch',branch,'base',base,'kind'," ++ session_kind("sessions.id") ++ ",'role'," ++ public_role("sessions.id") ++ ")," ++ session_state_sql("sessions.id") ++ ") FROM sessions WHERE " ++ condition ++ ";"

def session_result(id: String) -> String:
  session_result_where("id=" ++ q(id))

def player_matches(parent: String, harness: String, model: String, effort: String, workspace: String, branch: String, base: String) -> String:
  "(parent IS " ++ q(parent) ++ " AND harness=" ++ q(harness) ++ " AND model=" ++ q(model) ++ " AND effort=" ++ q(effort) ++ " AND workspace=" ++ q(workspace) ++ " AND branch=" ++ q(branch) ++ " AND base=" ++ q(base) ++ ")"

def player_sql(+id: String, +parent: String, +harness: String, +model: String, +effort: String, +workspace: String, +branch: String, +base: String) -> String:
  "INSERT INTO sessions(id,parent,harness,model,effort,workspace,branch,base) VALUES(" ++ q(id) ++ "," ++ q(parent) ++ "," ++ q(harness) ++ "," ++ q(model) ++ "," ++ q(effort) ++ "," ++ q(workspace) ++ "," ++ q(branch) ++ "," ++ q(base) ++ ") ON CONFLICT(id) DO NOTHING;"
  ++ "SELECT json_object('error','player-assignment-conflict','session',id,'existing',json_object('parent',parent,'harness',harness,'model',model,'effort',effort,'workspace',workspace,'branch',branch,'base',base),'requested',json_object('parent'," ++ q(parent) ++ ",'harness'," ++ q(harness) ++ ",'model'," ++ q(model) ++ ",'effort'," ++ q(effort) ++ ",'workspace'," ++ q(workspace) ++ ",'branch'," ++ q(branch) ++ ",'base'," ++ q(base) ++ "),'condition','The session ID is already registered with a different assignment.','next','Read session ID and worktree ID and retain the original work. Retry with the recorded assignment. Move a finished Player with receiver ID HARNESS_CMD OUTPUT_LOG CWD. Use join for an additional Player in an existing checkout, or recruit when a separate worktree is needed.') FROM sessions WHERE id=" ++ q(id) ++ " AND NOT " ++ player_matches(parent,harness,model,effort,workspace,branch,base) ++ ";"
  ++ session_result_where("id=" ++ q(id) ++ " AND " ++ player_matches(parent,harness,model,effort,workspace,branch,base))

# Empty endpoints disconnect. Other endpoints are native argv JSON, with one
# executable and text arguments representable by the host's process interface.
def endpoint_admitted(+endpoint: String) -> String:
  "(" ++ q(endpoint) ++ "='' OR CASE WHEN json_valid(" ++ q(endpoint) ++ ") THEN json_type(" ++ q(endpoint) ++ ")='array' AND json_array_length(" ++ q(endpoint) ++ ")>0 AND NOT EXISTS(SELECT 1 FROM json_each(" ++ q(endpoint) ++ ") WHERE type<>'text' OR instr(value,char(0))>0) AND coalesce(json_extract(" ++ q(endpoint) ++ ",'$[0]'),'')<>'' ELSE 0 END)"

def connect_sql(+id: String, native: String, +endpoint: String) -> String:
  "UPDATE sessions SET native=" ++ q(native) ++ ",endpoint=" ++ q(endpoint) ++ " WHERE id=" ++ q(id) ++ " AND " ++ endpoint_admitted(endpoint) ++ ";"
  ++ "SELECT json_object('error','invalid-endpoint','session'," ++ q(id) ++ ",'condition','Use an empty endpoint to disconnect, or a nonempty JSON array of text arguments with a nonempty executable and no NUL characters.','next','Pass the JSON argv array itself as one ENDPOINT argument; inspect session and inbox, then retry retained input after connecting.') WHERE NOT " ++ endpoint_admitted(endpoint) ++ ";"
  ++ session_result_where("id=" ++ q(id) ++ " AND " ++ endpoint_admitted(endpoint))

# Configuration records the harness, model and effort for future turns.
# Saving effort on the same harness and model keeps the existing endpoint.
# The expected route identifies the session configuration being changed.
# The predicate is a subquery so it also stands in a SELECT with no FROM clause,
# which is where the refusal answer is built.
def configure_matches(session: String, harness: String, model: String, effort: String) -> String:
  "EXISTS(SELECT 1 FROM sessions WHERE id=" ++ q(session) ++ " AND harness=" ++ q(harness) ++ " AND model=" ++ q(model) ++ " AND effort=" ++ q(effort) ++ ")"

def configure_admitted(+session: String, +harness: String, +model: String, +endpoint: String, +expected_harness: String, +expected_model: String, expected_effort: String) -> String:
  "(" ++ q(harness) ++ " IN ('codex','omp','muse','claude-code') AND " ++ q(model) ++ "<>'' AND " ++ configure_matches(session,expected_harness,expected_model,expected_effort)
  ++ " AND ((" ++ q(harness) ++ "=" ++ q(expected_harness) ++ " AND " ++ q(model) ++ "=" ++ q(expected_model) ++ ") OR (NOT " ++ stopped_session_sql(q(session))
  ++ " AND NOT EXISTS(SELECT 1 FROM executions WHERE session=" ++ q(session) ++ " AND phase<>'exited')"
  ++ " AND " ++ endpoint_admitted(endpoint) ++ ")))"

def configure_update_sql(+session: String, +harness: String, +model: String, +effort: String, +endpoint: String, +expected_harness: String, +expected_model: String, expected_effort: String, +admitted: String) -> String:
  "UPDATE sessions SET harness=" ++ q(harness) ++ ",model=" ++ q(model) ++ ",effort=" ++ q(effort) ++ ",endpoint=CASE WHEN " ++ q(harness) ++ "=" ++ q(expected_harness) ++ " AND " ++ q(model) ++ "=" ++ q(expected_model) ++ " THEN endpoint ELSE " ++ q(endpoint) ++ " END WHERE id=" ++ q(session) ++ " AND " ++ admitted ++ ";"
  ++ "SELECT json_object('error','configure-refused','session'," ++ q(session) ++ ",'expected',json_object('harness'," ++ q(expected_harness) ++ ",'model'," ++ q(expected_model) ++ ",'effort'," ++ q(expected_effort) ++ "),'requested',json_object('harness'," ++ q(harness) ++ ",'model'," ++ q(model) ++ ",'effort'," ++ q(effort) ++ "),'condition','Configuration requires the recorded harness, model and effort to match the expected route. Saving effort on the same harness and model preserves the receiver, current attempt and stop. Changing harness or model requires a launchable receiver, no owned attempt and no stop.','next','Read session ID and pass its recorded harness, model and effort as the expected route. Change provider after the current attempt exits. Resume SESSION --lift-stop explicitly lifts a stop.') WHERE changes()=0;"
  ++ session_result_where("id=" ++ q(session) ++ " AND changes()=1")

def configure_sql(+session: String, +harness: String, +model: String, +effort: String, +endpoint: String, +expected_harness: String, +expected_model: String, +expected_effort: String) -> String:
  configure_update_sql(session,harness,model,effort,endpoint,expected_harness,expected_model,expected_effort,configure_admitted(session,harness,model,endpoint,expected_harness,expected_model,expected_effort))

# A repeated ID preserves the original message fields. Same-body replay is
# ordinary; different input keeps the stored row and is answered with a refusal
# naming that ID, whose full body stays available through delivery.
def message_upsert() -> String:
  " ON CONFLICT(id) DO NOTHING;"

# Conflicts return the ID and stored message coordinates.
# The applicability expression follows the accompanying insert.
def message_conflict_sql(+id: String, +sender: String, +recipient: String, +kind: String, +body: String, +guards: String) -> String:
  "SELECT json_object('error','message-id-conflict','id'," ++ id ++ ",'stored',json_object('sender',sender,'recipient',recipient,'kind',kind),'condition','The message ID is already stored with different content.','next','Read delivery ID for the stored message and retain it; retry the new input under a different ID.') FROM messages WHERE id=" ++ id ++ " AND " ++ guards ++ " AND NOT (sender=" ++ sender ++ " AND recipient=" ++ recipient ++ " AND kind=" ++ kind ++ " AND body=" ++ body ++ ");"

def delivery_row() -> String:
  "json_patch(json_object('id',m.id,'sender',m.sender,'recipient',m.recipient,'kind',m.kind,'body',m.body,'receipt',m.receipt,'harness',s.harness,'native',s.native,'endpoint',s.endpoint,'endpointArgv'," ++ endpoint_argv("s.endpoint") ++ ")," ++ input_state_sql("m") ++ ")"

def message_index_sql(source: String, condition: String) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('seq',m.seq,'id',m.id,'sender',m.sender,'recipient',m.recipient,'kind',m.kind,'receipt',m.receipt)," ++ input_state_sql("m") ++ ") AS item FROM " ++ source ++ " WHERE m.receipt IS NULL AND " ++ condition ++ " ORDER BY m.seq);"

def terminal_expr(+event: String) -> String:
  "(json_extract(" ++ event ++ ",'$.payload.kind')='run_terminal' OR json_extract(" ++ event ++ ",'$.type')='result' OR (json_extract(" ++ event ++ ",'$.type')='agent_end' AND coalesce(json_extract(" ++ event ++ ",'$.isTerminal'),1)=1))"

def terminal(+event: String) -> String:
  "(SELECT " ++ terminal_expr("native_frame.value") ++ " FROM (SELECT " ++ q(event) ++ " AS value) native_frame)"

# A child reports to its recorded parent. A parentless Conductor reports to the
# registered operator when that session has the explicit operator responsibility.
def report_recipient(+session: String) -> String:
  "(SELECT CASE WHEN report_sender.parent IS NOT NULL THEN report_sender.parent WHEN " ++ assigned_role("report_sender.id") ++ "='conductor' THEN (SELECT report_operator.id FROM sessions report_operator WHERE report_operator.id='operator' AND report_operator.parent IS NULL AND " ++ assigned_role("report_operator.id") ++ "='operator') END FROM sessions report_sender WHERE report_sender.id=" ++ session ++ ")"

def last_assistant_sql(+event: String) -> String:
  "(SELECT " ++ last_assistant_sql_expr("native_frame.value") ++ " FROM (SELECT " ++ q(event) ++ " AS value) native_frame)"

def omp_terminal_error_sql(+event: String) -> String:
  "(SELECT " ++ omp_terminal_error_sql_expr("native_frame.value") ++ " FROM (SELECT " ++ q(event) ++ " AS value) native_frame)"

# The report carries the observed provider status and diagnostic. The native
# log retains the complete terminal frame.
def omp_terminal_error_text_sql_expr(+event: String) -> String:
  "CASE WHEN json_extract(" ++ event ++ ",'$.type')='agent_end' THEN (SELECT 'OMP provider failure: stopReason=error, errorStatus=' || coalesce(CAST(json_extract(m.value,'$.errorStatus') AS TEXT),'unknown') || '; ' || coalesce(json_extract(m.value,'$.errorMessage'),'the retained frame carries no provider diagnostic') FROM (SELECT " ++ last_assistant_sql_expr(event) ++ " AS value) m WHERE json_extract(m.value,'$.stopReason')='error') END"

def omp_terminal_error_text_sql(+event: String) -> String:
  "(SELECT " ++ omp_terminal_error_text_sql_expr("native_frame.value") ++ " FROM (SELECT " ++ q(event) ++ " AS value) native_frame)"

def assistant_text_sql_expr(+event: String) -> String:
  "(SELECT group_concat(CASE WHEN c.type='object' THEN json_extract(c.value,'$.text') END,char(10)) FROM json_each(CASE WHEN json_type(" ++ last_assistant_sql_expr(event) ++ ",'$.content')='array' THEN json_extract(" ++ last_assistant_sql_expr(event) ++ ",'$.content') ELSE '[]' END) c WHERE CASE WHEN c.type='object' THEN json_extract(c.value,'$.type') END='text')"

def terminal_body_expr(+event: String) -> String:
  "coalesce(" ++ omp_terminal_error_text_sql_expr(event) ++ ",CASE WHEN json_extract(" ++ event ++ ",'$.is_error')=1 OR (json_extract(" ++ event ++ ",'$.payload.kind')='run_terminal' AND json_extract(" ++ event ++ ",'$.payload.terminal')<>'completed') THEN " ++ event ++ " ELSE coalesce(json_extract(" ++ event ++ ",'$.result'),CASE WHEN json_extract(" ++ event ++ ",'$.payload.kind')='run_terminal' THEN json_extract(" ++ event ++ ",'$.payload.text') END," ++ assistant_text_sql_expr(event) ++ "," ++ event ++ ") END)"

def observe_identity_sql_expr(+player: String, +event: String) -> String:
  "UPDATE sessions SET native=coalesce(CASE WHEN json_extract(" ++ event ++ ",'$.type')='response' AND json_extract(" ++ event ++ ",'$.command')='get_state' AND json_extract(" ++ event ++ ",'$.success')=1 THEN json_extract(" ++ event ++ ",'$.data.sessionId') END,CASE WHEN json_extract(" ++ event ++ ",'$.type')='thread.started' THEN json_extract(" ++ event ++ ",'$.thread_id') END,json_extract(" ++ event ++ ",'$.session_id'),CASE WHEN json_extract(" ++ event ++ ",'$.type')='session' THEN json_extract(" ++ event ++ ",'$.id') END,CASE WHEN json_extract(" ++ event ++ ",'$.stream.kind')='session' THEN json_extract(" ++ event ++ ",'$.stream.id') END,native),observed_model=coalesce(CASE WHEN json_extract(" ++ event ++ ",'$.type')='response' AND json_extract(" ++ event ++ ",'$.command')='get_state' AND json_extract(" ++ event ++ ",'$.success')=1 THEN json_extract(" ++ event ++ ",'$.data.model.provider') || '/' || json_extract(" ++ event ++ ",'$.data.model.id') END,CASE WHEN json_extract(" ++ event ++ ",'$.payload_type')='run.model.configured' THEN json_extract(" ++ event ++ ",'$.payload.model_id') END,CASE WHEN json_extract(" ++ event ++ ",'$.message.provider') IS NOT NULL AND json_extract(" ++ event ++ ",'$.message.model') IS NOT NULL THEN json_extract(" ++ event ++ ",'$.message.provider') || '/' || json_extract(" ++ event ++ ",'$.message.model') END,json_extract(" ++ event ++ ",'$.message.model'),json_extract(" ++ event ++ ",'$.model'),observed_model) WHERE id=" ++ q(player) ++ ";"

# Completion record for issue #685. Every terminal observation records its
# completion report and turn row. The answer carries the pending-input
# reconciliation state, counted over unacknowledged input on unstopped
# sessions.
def completion_pending_sql(+player: String) -> String:
  "(SELECT count(*) FROM messages WHERE recipient=" ++ q(player) ++ " AND receipt IS NULL AND NOT " ++ stopped_session_sql(q(player)) ++ ")"

def completion_oldest_sql(+player: String) -> String:
  "(SELECT id FROM messages WHERE recipient=" ++ q(player) ++ " AND receipt IS NULL AND NOT " ++ stopped_session_sql(q(player)) ++ " ORDER BY seq LIMIT 1)"

def completion_sql_expr(+id: String, +player: String, +event: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id) ++ ",id," ++ report_recipient("sessions.id") ++ ",'report'," ++ terminal_body_expr(event) ++ " FROM sessions WHERE id=" ++ q(player) ++ " AND " ++ report_recipient("sessions.id") ++ " IS NOT NULL AND " ++ terminal_expr(event) ++ message_upsert() ++ message_conflict_sql(q(id),q(player),report_recipient(q(player)),"'report'",terminal_body_expr(event),report_recipient(q(player)) ++ " IS NOT NULL AND " ++ terminal_expr(event))
  ++ "INSERT INTO turns(id,worker,event) SELECT " ++ q(id) ++ "," ++ q(player) ++ "," ++ event ++ " WHERE " ++ report_recipient(q(player)) ++ " IS NOT NULL AND " ++ terminal_expr(event) ++ " AND EXISTS(SELECT 1 FROM messages WHERE id=" ++ q(id) ++ " AND sender=" ++ q(player) ++ " AND recipient=" ++ report_recipient(q(player)) ++ " AND kind='report' AND body=" ++ terminal_body_expr(event) ++ ") ON CONFLICT(id) DO NOTHING;"
  ++ "SELECT json_object('player',id,'native',native,'eventType',coalesce(json_extract(" ++ event ++ ",'$.type'),json_extract(" ++ event ++ ",'$.payload_type')),'reportId',CASE WHEN " ++ report_recipient("sessions.id") ++ " IS NOT NULL AND " ++ terminal_expr(event) ++ " THEN " ++ q(id) ++ " ELSE NULL END,'reconciliation',CASE WHEN " ++ completion_pending_sql(player) ++ ">0 THEN json_object('pendingCount'," ++ completion_pending_sql(player) ++ ",'oldestPendingId'," ++ completion_oldest_sql(player) ++ ",'next','Reconcile the pending input before completion; wake the session or record the blocked cause.') ELSE NULL END) FROM sessions WHERE id=" ++ q(player) ++ ";"

# The SQL query owns this temporary frame relation for its complete transaction.
# Identity, report and turn statements read the same complete valid JSON frame.
def observation_frame_sql(+event: String) -> String:
  "CREATE TEMP TABLE baton_observation_frame(value TEXT NOT NULL);INSERT INTO temp.baton_observation_frame(value) SELECT value FROM (SELECT " ++ q(event) ++ " AS value) WHERE json_valid(value);"

def observation_frame() -> String:
  "(SELECT value FROM temp.baton_observation_frame)"

def completion_sql(+id: String, +player: String, +event: String) -> String:
  observation_frame_sql(event) ++ completion_sql_expr(id,player,observation_frame()) ++ "DROP TABLE temp.baton_observation_frame;"

def observe_completion_sql(+id: String, +player: String, +event: String, sealed: Bool) -> String:
  Bool.pick(String,sealed,"",completion_sql(id,player,event))

def observe_sql(+id: String, +player: String, +event: String, sealed: Bool) -> String:
  observation_frame_sql(event)
  ++ observe_identity_sql_expr(player,observation_frame())
  ++ Bool.pick(String,sealed,"",completion_sql_expr(id,player,observation_frame()))
  ++ "DROP TABLE temp.baton_observation_frame;"

# UNION makes ancestry finite even if a database has malformed cyclic parentage.
def ancestors(+session: String) -> String:
  "WITH RECURSIVE ancestors(id) AS (SELECT parent FROM sessions WHERE id=" ++ session ++ " AND parent IS NOT NULL UNION SELECT s.parent FROM sessions s JOIN ancestors a ON s.id=a.id WHERE s.parent IS NOT NULL) SELECT id FROM ancestors"

def descendant(+ancestor: String, session: String) -> String:
  "EXISTS(SELECT 1 FROM (" ++ ancestors(session) ++ ") WHERE id=" ++ ancestor ++ ")"

def peers(+left: String, +right: String) -> String:
  "(" ++ left ++ "<>" ++ right ++ " AND NOT " ++ descendant(left,right) ++ " AND NOT " ++ descendant(right,left) ++ ")"

def tight_peers(+sender: String, +recipient: String) -> String:
  "(" ++ peers(sender,recipient) ++ " AND " ++ assigned_role(sender) ++ "<>'operator' AND " ++ assigned_role(recipient) ++ "<>'operator' AND EXISTS(SELECT 1 FROM ensemble_members a JOIN ensemble_members b ON b.ensemble=a.ensemble JOIN ensembles e ON e.id=a.ensemble WHERE a.session=" ++ sender ++ " AND b.session=" ++ recipient ++ " AND e.coupling='tight'))"

def operator_route(+sender: String, +recipient: String) -> String:
  "((" ++ assigned_role(sender) ++ "='operator' AND " ++ assigned_role(recipient) ++ "='conductor' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ recipient ++ " AND parent IS NULL)) OR (" ++ assigned_role(recipient) ++ "='operator' AND " ++ assigned_role(sender) ++ "='conductor' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ sender ++ " AND parent IS NULL)))"

def message_route(+sender: String, +recipient: String) -> String:
  "(EXISTS(SELECT 1 FROM sessions WHERE id=" ++ sender ++ ") AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ recipient ++ ") AND " ++ sender ++ "<>" ++ recipient ++ " AND ((" ++ assigned_role(sender) ++ "<>'operator' AND " ++ assigned_role(recipient) ++ "<>'operator' AND (coalesce((SELECT parent FROM sessions WHERE id=" ++ sender ++ ")=" ++ recipient ++ ",0) OR (" ++ assigned_role(sender) ++ "='conductor' AND " ++ descendant(sender,recipient) ++ ") OR " ++ tight_peers(sender,recipient) ++ ")) OR " ++ operator_route(sender,recipient) ++ "))"

def exact_message(+id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> String:
  "EXISTS(SELECT 1 FROM messages WHERE id=" ++ q(id) ++ " AND sender=" ++ q(sender) ++ " AND recipient=" ++ q(recipient) ++ " AND kind=" ++ q(kind) ++ " AND body=" ++ q(body) ++ ")"

def matching_message_result(+id: String, sender: String, recipient: String, kind: String, body: String) -> String:
  "SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt)," ++ input_state_sql("messages") ++ ") FROM messages WHERE id=" ++ q(id) ++ " AND " ++ exact_message(id,sender,recipient,kind,body) ++ ";"

# The stored row answers only an exact replay; a derived recipient arrives as an
# SQL expression rather than a value.
def matching_message_result_expr(+id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> String:
  "SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt)," ++ input_state_sql("messages") ++ ") FROM messages WHERE id=" ++ id ++ " AND EXISTS(SELECT 1 FROM messages WHERE id=" ++ id ++ " AND sender=" ++ sender ++ " AND recipient=" ++ recipient ++ " AND kind=" ++ kind ++ " AND body=" ++ body ++ ");"

def message_sql(+id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id) ++ "," ++ q(sender) ++ "," ++ q(recipient) ++ "," ++ q(kind) ++ "," ++ q(body) ++ " WHERE (" ++ message_route(q(sender),q(recipient)) ++ " AND NOT (" ++ stopped_session_sql(q(recipient)) ++ " AND " ++ execution_input_sql(q(kind)) ++ ")) OR " ++ exact_message(id,sender,recipient,kind,body) ++ message_upsert() ++ message_conflict_sql(q(id),q(sender),q(recipient),q(kind),q(body),"1")
  ++ "SELECT json_object('error','message-route-denied','sender'," ++ q(sender) ++ ",'recipient'," ++ q(recipient) ++ ",'condition','Use an immediate parent, a conductor descendant route, an explicitly tight Ensemble peer, or the operator and top-level conductor route.','next','Inspect session roles and Ensemble membership; send through your immediate conductor when a direct route is unavailable.') WHERE NOT " ++ message_route(q(sender),q(recipient)) ++ " AND NOT " ++ exact_message(id,sender,recipient,kind,body) ++ ";"
  ++ "SELECT json_object('error','session-stopped','session'," ++ q(recipient) ++ ") WHERE NOT " ++ exact_message(id,sender,recipient,kind,body) ++ " AND " ++ message_route(q(sender),q(recipient)) ++ " AND " ++ stopped_session_sql(q(recipient)) ++ " AND " ++ execution_input_sql(q(kind)) ++ ";" ++ matching_message_result(id,sender,recipient,kind,body)

def role_sql(+session: String, +role: String) -> String:
  "INSERT INTO session_roles(session,role) SELECT " ++ q(session) ++ "," ++ q(role_family(role)) ++ " WHERE " ++ role_admitted(session,role) ++ " ON CONFLICT(session) DO UPDATE SET role=excluded.role;"
  ++ "SELECT json_object('error','invalid-role','session'," ++ q(session) ++ ",'requested'," ++ q(role) ++ ",'condition','Principal Conductors and operators require no parent; Associate Conductors require a parent.','next','Read session ID. Assign player, principal-conductor, associate-conductor or operator to match its recorded parentage; conductor remains a compatible family declaration.') WHERE NOT " ++ role_admitted(session,role) ++ ";"
  ++ "SELECT json_object('session',id,'kind'," ++ session_kind("sessions.id") ++ ",'role'," ++ public_role("sessions.id") ++ ") FROM sessions WHERE id=" ++ q(session) ++ " AND " ++ role_admitted(session,role) ++ ";"

def member_present(+session: String) -> String:
  "EXISTS(SELECT 1 FROM sessions WHERE sessions.id=" ++ session ++ ")"

def section_row(+row: String) -> String:
  "json_object('ensemble'," ++ row ++ ".ensemble,'id'," ++ row ++ ".id,'capability'," ++ row ++ ".capability,'members',(SELECT json_group_array(session) FROM (SELECT session FROM section_members WHERE ensemble=" ++ row ++ ".ensemble AND section=" ++ row ++ ".id AND " ++ member_present("section_members.session") ++ " ORDER BY session)))"

def ensemble_row(+row: String) -> String:
  "json_object('id'," ++ row ++ ".id,'owner'," ++ row ++ ".owner,'coupling'," ++ row ++ ".coupling,'members',(SELECT json_group_array(session) FROM (SELECT session FROM ensemble_members WHERE ensemble=" ++ row ++ ".id AND " ++ member_present("ensemble_members.session") ++ " ORDER BY session)),'sections',(SELECT json_group_array(json(item)) FROM (SELECT " ++ section_row("sc") ++ " AS item FROM sections sc WHERE sc.ensemble=" ++ row ++ ".id ORDER BY sc.id)))"

def ensemble_owner_refusal(+id: String, +owner: String) -> String:
  "SELECT json_object('error','ensemble-owner-conflict','ensemble',id,'existingOwner',owner,'requestedOwner'," ++ q(owner) ++ ",'condition','The Ensemble ID is already registered to another owner.','next','Read ensemble ID and retain its recorded owner. Use another Ensemble ID for the requested owner.') FROM ensembles WHERE id=" ++ q(id) ++ " AND owner<>" ++ q(owner) ++ ";"

def ensemble_sql(+id: String, +owner: String, +coupling: String) -> String:
  "INSERT INTO ensembles(id,owner,coupling) SELECT " ++ q(id) ++ "," ++ q(owner) ++ "," ++ q(coupling) ++ " WHERE " ++ q(coupling) ++ " IN ('loose','tight') ON CONFLICT(id) DO UPDATE SET coupling=excluded.coupling WHERE ensembles.owner=excluded.owner;"
  ++ ensemble_owner_refusal(id,owner)
  ++ "SELECT " ++ ensemble_row("ensembles") ++ " FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ " AND coupling=" ++ q(coupling) ++ ";"

def ensemble_ensure_sql(+id: String, +owner: String) -> String:
  "INSERT INTO ensembles(id,owner,coupling) VALUES (" ++ q(id) ++ "," ++ q(owner) ++ ",'loose') ON CONFLICT(id) DO NOTHING;"
  ++ ensemble_owner_refusal(id,owner)
  ++ "SELECT " ++ ensemble_row("ensembles") ++ " FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ ";"

def ensemble_member_sql(+id: String, +owner: String, +session: String, +action: String) -> String:
  "DELETE FROM ensemble_members WHERE ensemble=" ++ q(id) ++ " AND session=" ++ q(session) ++ " AND " ++ q(action) ++ "='remove' AND EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ ");"
  ++ "INSERT OR IGNORE INTO ensemble_members(ensemble,session) SELECT " ++ q(id) ++ "," ++ q(session) ++ " WHERE " ++ q(action) ++ "='add' AND EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ ") AND " ++ assigned_role(q(session)) ++ "<>'operator' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ q(session) ++ ");"
  ++ "SELECT json_object('ensemble'," ++ q(id) ++ ",'owner'," ++ q(owner) ++ ",'session'," ++ q(session) ++ ",'membership'," ++ q(action) ++ ") WHERE EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ ") AND ((" ++ q(action) ++ "='add' AND EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ q(id) ++ " AND session=" ++ q(session) ++ ")) OR (" ++ q(action) ++ "='remove' AND NOT EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ q(id) ++ " AND session=" ++ q(session) ++ ")));"

def section_owner(+ensemble: String, +owner: String) -> String:
  "EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(ensemble) ++ " AND owner=" ++ q(owner) ++ ")"

def section_admitted(ensemble: String, owner: String, capability: String) -> String:
  "(" ++ section_owner(ensemble,owner) ++ " AND " ++ q(capability) ++ "<>'')"

def section_refusal(ensemble: String, id: String, owner: String, admitted: String) -> String:
  "SELECT json_object('error','section-refused','ensemble'," ++ q(ensemble) ++ ",'section'," ++ q(id) ++ ",'owner'," ++ q(owner) ++ ",'condition','Use the named Ensemble owner, a nonempty capability, and an existing Ensemble Player for membership.','next','Read ensemble ID and section ENSEMBLE SECTION. Add the Player to that Ensemble before assigning its Section; use add or remove for membership.') WHERE NOT " ++ admitted ++ ";"

def section_sql(+ensemble: String, +id: String, +owner: String, +capability: String) -> String:
  "INSERT INTO sections(ensemble,id,capability) SELECT " ++ q(ensemble) ++ "," ++ q(id) ++ "," ++ q(capability) ++ " WHERE " ++ section_admitted(ensemble,owner,capability) ++ " ON CONFLICT(ensemble,id) DO UPDATE SET capability=excluded.capability;"
  ++ section_refusal(ensemble,id,owner,section_admitted(ensemble,owner,capability))
  ++ "SELECT " ++ section_row("sections") ++ " FROM sections WHERE ensemble=" ++ q(ensemble) ++ " AND id=" ++ q(id) ++ " AND " ++ section_admitted(ensemble,owner,capability) ++ ";"

def section_member_admitted(+ensemble: String, +id: String, owner: String, +player: String, +action: String) -> String:
  "(" ++ section_owner(ensemble,owner) ++ " AND EXISTS(SELECT 1 FROM sections WHERE ensemble=" ++ q(ensemble) ++ " AND id=" ++ q(id) ++ ") AND (" ++ q(action) ++ "='remove' OR (" ++ q(action) ++ "='add' AND " ++ assigned_role(q(player)) ++ "<>'operator' AND EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ q(ensemble) ++ " AND session=" ++ q(player) ++ "))))"

def section_member_sql(+ensemble: String, +id: String, +owner: String, +player: String, +action: String) -> String:
  "DELETE FROM section_members WHERE ensemble=" ++ q(ensemble) ++ " AND section=" ++ q(id) ++ " AND session=" ++ q(player) ++ " AND " ++ q(action) ++ "='remove' AND " ++ section_member_admitted(ensemble,id,owner,player,action) ++ ";"
  ++ "INSERT OR IGNORE INTO section_members(ensemble,section,session) SELECT " ++ q(ensemble) ++ "," ++ q(id) ++ "," ++ q(player) ++ " WHERE " ++ q(action) ++ "='add' AND " ++ section_member_admitted(ensemble,id,owner,player,action) ++ ";"
  ++ section_refusal(ensemble,id,owner,section_member_admitted(ensemble,id,owner,player,action))
  ++ "SELECT json_object('ensemble'," ++ q(ensemble) ++ ",'section'," ++ q(id) ++ ",'player'," ++ q(player) ++ ",'membership'," ++ q(action) ++ ") WHERE " ++ section_member_admitted(ensemble,id,owner,player,action) ++ ";"

def players_json(condition: String) -> String:
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',s.id,'kind'," ++ session_kind("s.id") ++ ",'role'," ++ public_role("s.id") ++ ",'parent',s.parent,'harness',s.harness,'model',s.model,'effort',s.effort,'workspace',s.workspace,'branch',s.branch,'base',s.base,'native',s.native,'observedHarness',s.observed_harness,'observedModel',s.observed_model,'observedEffort',s.observed_effort,'execution',(SELECT json_object('attempt',id,'mode',mode,'phase',phase,'status',status) FROM executions WHERE session=s.id),'lastTurnId',(SELECT t.id FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'lastTurnEvent',(SELECT coalesce(json_extract(t.event,'$.type'),json_extract(t.event,'$.payload_type')) FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'latestReport',(SELECT m.body FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'latestReportId',(SELECT m.id FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'pendingCount',(SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NULL AND NOT (" ++ stopped_session_sql("s.id") ++ " AND " ++ execution_input_sql("messages.kind") ++ ")))," ++ session_state_sql("s.id") ++ ") AS item FROM sessions s WHERE " ++ condition ++ " ORDER BY s.id))"

# The per-session orchestra surface, computed once per row. The item JSON is
# the players surface item over sessions s; role carries the raw assigned
# role for the players/operators split, and id carries the session identity
# for ordering. Both role arrays read this one surface through the WITH
# clause in orchestra_sql, so the enlarged session state is assembled once
# instead of once per role array.
def surface_item() -> String:
  "json_patch(json_object('id',s.id,'kind'," ++ session_kind("s.id") ++ ",'role'," ++ public_role("s.id") ++ ",'parent',s.parent,'harness',s.harness,'model',s.model,'effort',s.effort,'workspace',s.workspace,'branch',s.branch,'base',s.base,'native',s.native,'observedHarness',s.observed_harness,'observedModel',s.observed_model,'observedEffort',s.observed_effort,'execution',(SELECT json_object('attempt',id,'mode',mode,'phase',phase,'status',status) FROM executions WHERE session=s.id),'lastTurnId',(SELECT t.id FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'lastTurnEvent',(SELECT coalesce(json_extract(t.event,'$.type'),json_extract(t.event,'$.payload_type')) FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'latestReport',(SELECT m.body FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'latestReportId',(SELECT m.id FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'pendingCount',(SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NULL AND NOT (" ++ stopped_session_sql("s.id") ++ " AND " ++ execution_input_sql("messages.kind") ++ ")))," ++ session_state_sql("s.id") ++ ")"

def orchestra_surface() -> String:
  String.concat(["(SELECT ", surface_item(), " AS item,", assigned_role("s.id"), " AS role,s.id AS id FROM sessions s)"])

def orchestra_role_array(condition: String) -> String:
  String.concat(["(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT item FROM surface WHERE role", condition, " ORDER BY id))"])

def orchestra_sql() -> String:
  String.concat(["WITH surface AS ", orchestra_surface(), " SELECT json_object('players',", orchestra_role_array("<>'operator'"), ",'operators',", orchestra_role_array("='operator'"), ",'ensembles',(SELECT json_group_array(json(item)) FROM (SELECT ", ensemble_row("e"), " AS item FROM ensembles e ORDER BY e.id)));"])

def sql(command: Command) -> String:
  match command:
    case Observe{id,player,event,sealed}: observe_sql(id,player,event,sealed)
    case Attach{+id, harness, native, endpoint}:
      "INSERT INTO sessions(id,harness,native,endpoint) VALUES(" ++ q(id) ++ "," ++ q(harness) ++ "," ++ q(native) ++ "," ++ q(endpoint) ++ ") ON CONFLICT(id) DO UPDATE SET id=CASE WHEN sessions.parent IS NULL THEN sessions.id ELSE NULL END,harness=excluded.harness,native=excluded.native,endpoint=excluded.endpoint;" ++ session_result(id)
    case Player{+id, parent, harness, model, effort, workspace, branch, base}:
      player_sql(id,parent,harness,model,effort,workspace,branch,base)
    case Connect{+id,native,endpoint}:
      connect_sql(id,native,endpoint)
    case Bind{+id, native, harness, model, effort}:
      "UPDATE sessions SET native=" ++ q(native) ++ ",observed_harness=" ++ q(harness) ++ ",observed_model=" ++ q(model) ++ ",observed_effort=" ++ q(effort) ++ " WHERE id=" ++ q(id) ++ ";" ++ session_result(id)
    case Role{session,role}: role_sql(session,role)
    case RoleRead{session}: role_result(session)
    case Ensemble{id,owner,coupling}: ensemble_sql(id,owner,coupling)
    case EnsembleEnsure{id,owner}: ensemble_ensure_sql(id,owner)
    case EnsembleRead{id}:
      "SELECT " ++ ensemble_row("ensembles") ++ " FROM ensembles WHERE id=" ++ q(id) ++ ";"
    case EnsembleMember{id,owner,session,action}: ensemble_member_sql(id,owner,session,action)
    case Message{+id, sender, +recipient, +kind, body}:
      message_sql(id,sender,recipient,kind,body)
    case Report{+id, +sender, +body}:
      "INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ q(id) ++ "," ++ q(sender) ++ "," ++ report_recipient(q(sender)) ++ ",'report'," ++ q(body) ++ ")" ++ message_upsert() ++ message_conflict_sql(q(id),q(sender),report_recipient(q(sender)),"'report'",q(body),report_recipient(q(sender)) ++ " IS NOT NULL") ++ matching_message_result_expr(q(id),q(sender),report_recipient(q(sender)),"'report'",q(body))
    case Ask{+id, +player, +body}:
      "INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ q(id) ++ "," ++ q(player) ++ "," ++ report_recipient(q(player)) ++ ",'question'," ++ q(body) ++ ")" ++ message_upsert() ++ message_conflict_sql(q(id),q(player),report_recipient(q(player)),"'question'",q(body),report_recipient(q(player)) ++ " IS NOT NULL") ++ matching_message_result_expr(q(id),q(player),report_recipient(q(player)),"'question'",q(body))
    case Ack{+id, +recipient, receipt}:
      "UPDATE messages SET receipt=coalesce(receipt," ++ q(receipt) ++ ") WHERE id=" ++ q(id) ++ " AND recipient=" ++ q(recipient) ++ ";DELETE FROM wake_claims WHERE session=" ++ q(recipient) ++ " AND NOT EXISTS(SELECT 1 FROM messages WHERE recipient=" ++ q(recipient) ++ " AND receipt IS NULL);SELECT json_object('id',id,'receipt',receipt) FROM messages WHERE id=" ++ q(id) ++ " AND recipient=" ++ q(recipient) ++ ";"
    case Session{id}: session_result(id)
    case Delivery{id}:
      "SELECT " ++ delivery_row() ++ " FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ q(id) ++ ";"
    case Pending{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ delivery_row() ++ " AS item FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL ORDER BY m.seq);"
    case PendingIndex{}: message_index_sql("messages m JOIN sessions s ON s.id=m.recipient","1")
    case Inbox{id}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body)," ++ input_state_sql("messages") ++ ") AS item FROM messages WHERE recipient=" ++ q(id) ++ " AND receipt IS NULL ORDER BY seq);"
    case InboxIndex{id}: message_index_sql("messages m","m.recipient=" ++ q(id))
    case Status{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'endpointArgv'," ++ endpoint_argv("endpoint") ++ ",'workspace',workspace,'branch',branch,'base',base,'kind'," ++ session_kind("sessions.id") ++ ",'role'," ++ public_role("sessions.id") ++ ",'pending',(SELECT count(*) FROM messages WHERE recipient=sessions.id AND receipt IS NULL AND NOT (" ++ stopped_session_sql("sessions.id") ++ " AND " ++ execution_input_sql("messages.kind") ++ ")))," ++ session_state_sql("sessions.id") ++ ") AS item FROM sessions ORDER BY id);"
    case Players{}: "SELECT " ++ players_json(assigned_role("s.id") ++ "<>'operator'") ++ ";"
    case LegacySubordinates{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',s.id,'parent',s.parent,'harness',s.harness,'model',s.model,'effort',s.effort,'workspace',s.workspace,'branch',s.branch,'base',s.base,'native',s.native,'lastTurnId',(SELECT t.id FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'lastTurnEvent',(SELECT coalesce(json_extract(t.event,'$.type'),json_extract(t.event,'$.payload_type')) FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'latestReport',(SELECT m.body FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'latestReportId',(SELECT m.id FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'pendingCount',(SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NULL AND NOT (" ++ stopped_session_sql("s.id") ++ " AND " ++ execution_input_sql("messages.kind") ++ ")))," ++ session_state_sql("s.id") ++ ") AS item FROM sessions s WHERE s.parent IS NOT NULL ORDER BY s.id);"
    case PlayerRead{id}: session_result_where("id=" ++ q(id) ++ " AND " ++ assigned_role("sessions.id") ++ "<>'operator'")
    case Section{ensemble,id,owner,capability}: section_sql(ensemble,id,owner,capability)
    case SectionRead{ensemble,id}: "SELECT " ++ section_row("sections") ++ " FROM sections WHERE ensemble=" ++ q(ensemble) ++ " AND id=" ++ q(id) ++ ";"
    case SectionMember{ensemble,id,owner,player,action}: section_member_sql(ensemble,id,owner,player,action)
    case Orchestra{}: orchestra_sql()
    case Turns{id}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('id',t.id,'player',t.worker,'eventType',coalesce(json_extract(t.event,'$.type'),json_extract(t.event,'$.payload_type')),'reportBody',m.body,'receipt',m.receipt) AS item FROM turns t JOIN messages m ON m.id=t.id WHERE t.worker=" ++ q(id) ++ " ORDER BY m.seq);"
    case Project{path}: ""
    case ProjectSessions{path}: ""
    case Resume{session,lift_stop}: ""
    case ObserveFile{id,player,path}: ""
    case ReportFile{id,sender,path}: ""
    case MessageFile{id,sender,recipient,kind,path}: ""
    case AskFile{id,player,path}: ""
    case NativeReply{parent,id,response}: ""
    case NativeReplyFile{parent,id,path}: ""
    case Stop{session,id,reason}: ""
    case ForceStop{session,id}: ""
    case RunTurn{player,id,cmd,model,effort,cwd,task,log,session}: ""
    case Receive{session,cmd,model,effort,cwd,log,message}: ""
    case RecoverObserver{session,observer}: ""
    case Start{session,harness,cmd,model,effort,cwd,log,id,task}: ""
    case Receiver{session,cmd,log,cwd}: ""
    case Configure{id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort}: ""
    case DispatchFile{id,sender,recipient,kind,path}: ""
    case DispatchTurn{player,id,cmd,log,task}: ""
    case StatusPretty{}: ""
    case Pretty{read}: ""
    case Land{player,repo,target}: ""
    case LandAt{player,repo,target,commit}: ""
    case LandCheckedAt{player,repo,target,check,files,commit}: ""
    case LandChecked{player,repo,target,check,files}: ""
    case Push{repo,branch,remote}: ""
    case RemoteTip{repo,branch,remote}: ""
    case ObservedUsage{session}: ""
    case Models{session}: ""
    case Logs{session,level}: ""
    case LogsStorage{}: ""
    case LogsClean{session}: ""
    case Recruit{id,parent,harness,model,effort,repo,branch,path,base}: ""
    case Join{id,parent,harness,model,effort,path}: ""
    case Worktree{id}: ""
    case KnowledgeRecord{id,author,claim,evidence,limits}: ""
    case KnowledgeRecordTyped{id,author,kind,claim,evidence,limits}: ""
    case KnowledgeRelate{id,author,source,relation,target}: ""
    case KnowledgeRead{reader}: ""
    case KnowledgeReadScope{reader,scope,subject}: ""
    case KnowledgeIndex{reader}: ""
    case KnowledgeDetail{reader,id}: ""
    case KnowledgeScopeIndex{reader,scope,subject}: ""
    case KnowledgeScopeDetail{reader,scope,subject,id}: ""
    case KnowledgePromote{id,promoter,source,destination,finding}: ""
    case View{subject,reader,port}: ""
    case UiSubscribe{after_cursor,generation}: ""
    case ContextEngines{session}: ""
    case ContextInstall{module_id,source}: ""
    case ContextQueryFile{owner,query,path}: ""
    case ContextResult{query}: ""
    case Serve{}: ""
    case OwnerStatus{}: ""
    case Help{}: ""
    case Invalid{}: ""

def parse_verb_only(+verb: String) -> Command:
  match verb:
    case "context-engines": ContextEngines{""}
    case "logs-storage": LogsStorage{}
    case "help": Help{}
    case "--help": Help{}
    case "status": Status{}
    case "workers": LegacySubordinates{}
    case "players": Players{}
    case "orchestra": Orchestra{}
    case "pending": Pending{}
    case "serve": Serve{}
    case "owner-status": OwnerStatus{}
    case _: Invalid{}

def parse_verb_id(+verb: String, +id: String) -> Command:
  match verb:
    case "context-engines": ContextEngines{id}
    case "context-result": ContextResult{id}
    case "logs": Logs{id,""}
    case "logs-clean": LogsClean{id}
    case "players": match id:
      case "--pretty": Pretty{Players{}}
      case _: Invalid{}
    case "orchestra": match id:
      case "--pretty": Pretty{Orchestra{}}
      case _: Invalid{}
    case "pending": match id:
      case "--pretty": Pretty{Pending{}}
      case "--index": PendingIndex{}
      case _: Invalid{}
    case "status": match id:
      case "--pretty": StatusPretty{}
      case _: Invalid{}
    case "player": PlayerRead{id}
    case "role": RoleRead{id}
    case "ensemble": EnsembleRead{id}
    case "inbox": Inbox{id}
    case "session": Session{id}
    case "delivery": Delivery{id}
    case "worktree": Worktree{id}
    case "turns": Turns{id}
    case "project": Project{id}
    case "project-sessions": ProjectSessions{id}
    case "resume": Resume{id,False{}}
    case "knowledge": KnowledgeRead{id}
    case "observed-usage": ObservedUsage{id}
    case "models": Models{id}
    case "view": View{id,id,"7682"}
    case _: Invalid{}

def parse_verb_session_id(+verb: String, +session: String, +id: String) -> Command:
  match verb:
    case "context-install": ContextInstall{session,id}
    case "pending": Bool.pick(Command,Bool.or(Bool.and(String.eq(session,"--index"),String.eq(id,"--pretty")),Bool.and(String.eq(session,"--pretty"),String.eq(id,"--index"))),Pretty{PendingIndex{}},Invalid{})
    case "resume": match id:
      case "--lift-stop": Resume{session,True{}}
      case _: Invalid{}
    case "ui-subscribe": UiSubscribe{session,id}
    case "logs": Logs{session,id}
    case "player": match id:
      case "--pretty": Pretty{PlayerRead{session}}
      case _: Invalid{}
    case "session": match id:
      case "--pretty": Pretty{Session{session}}
      case _: Invalid{}
    case "inbox": match id:
      case "--pretty": Pretty{Inbox{session}}
      case "--index": InboxIndex{session}
      case _: Invalid{}
    case "delivery": match id:
      case "--pretty": Pretty{Delivery{session}}
      case _: Invalid{}
    case "turns": match id:
      case "--pretty": Pretty{Turns{session}}
      case _: Invalid{}
    case "knowledge": match id:
      case "--pretty": Pretty{KnowledgeRead{session}}
      case "--index": KnowledgeIndex{session}
      case _: Invalid{}
    case "worktree": match id:
      case "--pretty": Pretty{Worktree{session}}
      case _: Invalid{}
    case "section": SectionRead{session,id}
    case "role": Role{session,id}
    case "ensemble": EnsembleEnsure{session,id}
    case "force-stop": ForceStop{session,id}
    case "recover-observer": RecoverObserver{session,id}
    case "view": View{session,id,"7682"}
    case _: Invalid{}

def parse_verb_three_args(+verb: String, +id: String, +one: String, +two: String) -> Command:
  match verb:
    case "inbox": Bool.pick(Command,Bool.or(Bool.and(String.eq(one,"--index"),String.eq(two,"--pretty")),Bool.and(String.eq(one,"--pretty"),String.eq(two,"--index"))),Pretty{InboxIndex{id}},Invalid{})
    case "knowledge":
      Bool.pick(Command,String.eq(one,"--id"),KnowledgeDetail{id,two},
        Bool.pick(Command,Bool.or(Bool.and(String.eq(one,"--index"),String.eq(two,"--pretty")),Bool.and(String.eq(one,"--pretty"),String.eq(two,"--index"))),Pretty{KnowledgeIndex{id}},Invalid{}))
    case "knowledge-scope": KnowledgeReadScope{id,one,two}
    case "context-query-file": ContextQueryFile{id,one,two}
    case "receiver": Receiver{id,one,two,""}
    case "ensemble": Ensemble{id,one,two}
    case "native-reply": NativeReply{id,one,two}
    case "native-reply-file": NativeReplyFile{id,one,two}
    case "stop": Stop{id,one,two}
    case "report": Report{id,one,two}
    case "report-file": ReportFile{id,one,two}
    case "ack": Ack{id,one,two}
    case "observe-file": ObserveFile{id,one,two}
    case "connect": Connect{id,one,two}
    case "land": Land{id,one,two}
    case "push": Push{id,one,two}
    case "ask": Ask{id,one,two}
    case "ask-file": AskFile{id,one,two}
    case "remote-tip": RemoteTip{id,one,two}
    case "view": View{id,one,two}
    case _: Invalid{}

def parse_verb_four_args(+verb: String, +id: String, +one: String, +two: String, +three: String) -> Command:
  match verb:
    case "knowledge":
      Bool.pick(Command,Bool.and(String.eq(one,"--id"),String.eq(three,"--pretty")),Pretty{KnowledgeDetail{id,two}},
        Bool.pick(Command,Bool.and(String.eq(one,"--pretty"),String.eq(two,"--id")),Pretty{KnowledgeDetail{id,three}},Invalid{}))
    case "knowledge-scope":
      Bool.pick(Command,String.eq(three,"--index"),KnowledgeScopeIndex{id,one,two},
        Bool.pick(Command,String.eq(three,"--pretty"),Pretty{KnowledgeReadScope{id,one,two}},Invalid{}))
    case "receiver": Receiver{id,one,two,three}
    case "section": Section{id,one,two,three}
    case "ensemble-member": EnsembleMember{id,one,two,three}
    case "attach": Attach{id,one,two,three}
    case _: Invalid{}

def parse_verb_five_args(+verb: String, +id: String, +one: String, +two: String, +three: String, +four: String) -> Command:
  match verb:
    case "knowledge-scope":
      Bool.pick(Command,String.eq(three,"--id"),KnowledgeScopeDetail{id,one,two,four},
        Bool.pick(Command,Bool.or(Bool.and(String.eq(three,"--index"),String.eq(four,"--pretty")),Bool.and(String.eq(three,"--pretty"),String.eq(four,"--index"))),Pretty{KnowledgeScopeIndex{id,one,two}},Invalid{}))
    case "dispatch-turn": DispatchTurn{id,one,two,three,four}
    case "dispatch-file": DispatchFile{id,one,two,three,four}
    case "section-member": SectionMember{id,one,two,three,four}
    case "land-checked": LandChecked{id,one,two,three,four}
    case "bind": Bind{id,one,two,three,four}
    case "message": Message{id,one,two,three,four}
    case "message-file": MessageFile{id,one,two,three,four}
    case "record": KnowledgeRecord{id,one,two,three,four}
    case "relate": KnowledgeRelate{id,one,two,three,four}
    case "promote": KnowledgePromote{id,one,two,three,four}
    case _: Invalid{}

def parse_receive(+verb: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +message: String) -> Command:
  match verb:
    case "receive": Receive{session,cmd,model,effort,cwd,log,message}
    case _: Invalid{}

def parse_verb_nine_args(+verb: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String) -> Command:
  match verb:
    case "configure": Configure{player,id,cmd,model,effort,cwd,task,log,session}
    case "start": Start{player,id,cmd,model,effort,cwd,task,log,session}
    case "turn": RunTurn{player,id,cmd,model,effort,cwd,task,log,session}
    case "recruit": Recruit{player,id,cmd,model,effort,cwd,task,log,session}
    case _: Invalid{}

def parse(args: List<String>) -> Command:
  match args:
    case +verb <> Nil{}:
      parse_verb_only(verb)
    case +verb <> +id <> Nil{}:
      parse_verb_id(verb,id)
    case +verb <> +session <> +id <> Nil{}:
      parse_verb_session_id(verb,session,id)
    case +verb <> +id <> +one <> +two <> Nil{}:
      parse_verb_three_args(verb,id,one,two)
    case +verb <> +id <> +one <> +two <> +three <> Nil{}:
      parse_verb_four_args(verb,id,one,two,three)
    case +verb <> +id <> +one <> +two <> +three <> +four <> Nil{}:
      Bool.pick(Command, Bool.and(String.eq(verb,"land"),String.eq(three,"--commit")), LandAt{id,one,two,four}, parse_verb_five_args(verb,id,one,two,three,four))
    case "knowledge-scope" <> +reader <> +scope <> +subject <> "--id" <> +id <> "--pretty" <> Nil{}:
      Pretty{KnowledgeScopeDetail{reader,scope,subject,id}}
    case "knowledge-scope" <> +reader <> +scope <> +subject <> "--pretty" <> "--id" <> +id <> Nil{}:
      Pretty{KnowledgeScopeDetail{reader,scope,subject,id}}
    case "record-typed" <> +id <> +author <> +kind <> +claim <> +evidence <> +limits <> Nil{}:
      KnowledgeRecordTyped{id,author,kind,claim,evidence,limits}
    case "join" <> +id <> +parent <> +harness <> +model <> +effort <> +path <> Nil{}:
      Join{id,parent,harness,model,effort,path}
    case +verb <> +session <> +cmd <> +model <> +effort <> +cwd <> +log <> +message <> Nil{}:
      Bool.pick(Command, Bool.and(String.eq(verb,"land-checked"),String.eq(log,"--commit")), LandCheckedAt{session,cmd,model,effort,cwd,message}, parse_receive(verb,session,cmd,model,effort,cwd,log,message))
    case +verb <> +player <> +id <> +cmd <> +model <> +effort <> +cwd <> +task <> +log <> +session <> Nil{}:
      parse_verb_nine_args(verb,player,id,cmd,model,effort,cwd,task,log,session)
    case _: Invalid{}

law help_word_selects_the_help_command:
  {parse(["help"]) == Help{} : Command}

def help_word_selects_the_help_command():
  {==}

law help_flag_selects_the_help_command:
  {parse(["--help"]) == Help{} : Command}

def help_flag_selects_the_help_command():
  {==}

law context_engines_has_a_single_command_word:
  {parse(["context-engines"]) == ContextEngines{""} : Command}

def context_engines_has_a_single_command_word():
  {==}

law context_query_file_binds_owner_query_and_path:
  for +owner: String
  for +query: String
  for +path: String
  {parse(["context-query-file",owner,query,path]) == ContextQueryFile{owner,query,path} : Command}

def context_query_file_binds_owner_query_and_path(owner,query,path):
  {==}

law context_result_selects_the_retained_query:
  for +query: String
  {parse(["context-result",query]) == ContextResult{query} : Command}

def context_result_selects_the_retained_query(query):
  {==}

law context_query_rejects_surplus_arguments:
  for +owner: String
  for +query: String
  for +path: String
  {parse(["context-query-file",owner,query,path,"extra"]) == Invalid{} : Command}

def context_query_rejects_surplus_arguments(owner,query,path):
  {==}

law message_parser_preserves_the_complete_body:
  for id: String
  for sender: String
  for recipient: String
  for kind: String
  for body: String
  {parse(["message",id,sender,recipient,kind,body]) == Message{id,sender,recipient,kind,body} : Command}

def message_parser_preserves_the_complete_body(id,sender,recipient,kind,body):
  {==}

# The declared remote read keeps the repository, branch and remote the caller
# supplied, in that order, and reads no default.
law remote_tip_parser_keeps_the_declared_names:
  for +repo: String
  for +branch: String
  for +remote: String
  {parse(["remote-tip",repo,branch,remote]) == RemoteTip{repo,branch,remote} : Command}

def remote_tip_parser_keeps_the_declared_names(repo,branch,remote):
  {==}

# The view command parses its subject, optional reader and optional port. The reader defaults to the subject and the port to 7682.
law view_parser_defaults_reader_and_port:
  for subject: String
  {parse(["view",subject]) == View{subject,subject,"7682"} : Command}

def view_parser_defaults_reader_and_port(subject):
  {==}

law view_parser_keeps_the_declared_reader:
  for subject: String
  for reader: String
  {parse(["view",subject,reader]) == View{subject,reader,"7682"} : Command}

def view_parser_keeps_the_declared_reader(subject,reader):
  {==}

law view_parser_keeps_the_declared_port:
  for subject: String
  for reader: String
  for port: String
  {parse(["view",subject,reader,port]) == View{subject,reader,port} : Command}

def view_parser_keeps_the_declared_port(subject,reader,port):
  {==}

law ui_subscription_parser_keeps_the_cursor_and_generation:
  for +after_cursor: String
  for +generation: String
  {parse(["ui-subscribe",after_cursor,generation]) == UiSubscribe{after_cursor,generation} : Command}

def ui_subscription_parser_keeps_the_cursor_and_generation(after_cursor,generation):
  {==}

law ui_subscription_parser_rejects_missing_generation:
  for +after_cursor: String
  {parse(["ui-subscribe",after_cursor]) == Invalid{} : Command}

def ui_subscription_parser_rejects_missing_generation(after_cursor):
  {==}

law ui_subscription_parser_rejects_extra_arguments:
  for +after_cursor: String
  for +generation: String
  for +extra: String
  {parse(["ui-subscribe",after_cursor,generation,extra]) == Invalid{} : Command}

def ui_subscription_parser_rejects_extra_arguments(after_cursor,generation,extra):
  {==}

law configure_parser_keeps_the_requested_and_expected_route:
  for +id: String
  for +harness: String
  for +model: String
  for +effort: String
  for +cmd: String
  for +log: String
  for +expected_harness: String
  for +expected_model: String
  for +expected_effort: String
  {parse(["configure",id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort]) == Configure{id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort} : Command}

def configure_parser_keeps_the_requested_and_expected_route(id,harness,model,effort,cmd,log,expected_harness,expected_model,expected_effort):
  {==}

law serve_parser_selects_the_fixed_coordinator:
  {parse(["serve"]) == Serve{} : Command}

def serve_parser_selects_the_fixed_coordinator():
  {==}

law serve_parser_rejects_extra_arguments:
  for +extra: String
  {parse(["serve",extra]) == Invalid{} : Command}

def serve_parser_rejects_extra_arguments(extra):
  {==}

law owner_status_parser_selects_the_readiness_check:
  {parse(["owner-status"]) == OwnerStatus{} : Command}

def owner_status_parser_selects_the_readiness_check():
  {==}

law owner_status_parser_rejects_extra_arguments:
  for +extra: String
  {parse(["owner-status",extra]) == Invalid{} : Command}

def owner_status_parser_rejects_extra_arguments(extra):
  {==}
