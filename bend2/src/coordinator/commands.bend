import Base

type Command is Data:
  Recruit{id: String, parent: String, harness: String, model: String, effort: String, repo: String, branch: String, path: String, base: String}
  Worktree{id: String}
  Receive{session: String, cmd: String, model: String, effort: String, cwd: String, log: String, message: String}
  Start{session: String, harness: String, cmd: String, model: String, effort: String, cwd: String, log: String, id: String, task: String}
  Receiver{session: String, cmd: String, log: String}
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
  EnsembleRead{id: String}
  EnsembleMember{id: String, owner: String, session: String, action: String}
  Message{id: String, sender: String, recipient: String, kind: String, body: String}
  MessageFile{id: String, sender: String, recipient: String, kind: String, path: String}
  Observe{id: String, player: String, event: String, sealed: Bool}
  ObserveFile{id: String, player: String, path: String}
  Report{id: String, sender: String, body: String}
  Ask{id: String, player: String, body: String}
  AskFile{id: String, player: String, path: String}
  NativeReply{parent: String, id: String, response: String}
  NativeReplyFile{parent: String, id: String, path: String}
  Ack{id: String, recipient: String, receipt: String}
  Session{id: String}
  Delivery{id: String}
  Pending{}
  Inbox{id: String}
  Land{player: String, repo: String, target: String}
  LandChecked{player: String, repo: String, target: String, check: String, files: String}
  Push{repo: String, branch: String, remote: String}
  RemoteTip{repo: String, branch: String, remote: String}
  ObservedUsage{session: String}
  Logs{session: String, level: String, budget: String, segments: String}
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
  KnowledgeRecord{id: String, author: String, claim: String, evidence: String, limits: String}
  KnowledgeRead{reader: String}
  KnowledgePromote{id: String, promoter: String, source: String, destination: String, finding: String}
  ContextEngines{}
  ContextQueryFile{owner: String, query: String, path: String}
  ContextResult{query: String}
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

# Stored role families and turn columns retain their existing names. Section
# membership references the existing Ensemble membership of each Player.

def schema() -> String:
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT REFERENCES sessions(id), harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL REFERENCES sessions(id), recipient TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);"
  ++ "CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY NOT NULL REFERENCES messages(id), worker TEXT NOT NULL REFERENCES sessions(id), event TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS executions (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), id TEXT NOT NULL, mode TEXT NOT NULL, directory TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS session_stops (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, attempt TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '', signal INTEGER NOT NULL DEFAULT 15, applied_signal INTEGER NOT NULL DEFAULT 0, control_error TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, native_status TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '');"
  ++ messaging_schema()

def stopped_session_sql(session: String) -> String:
  "EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ session ++ ")"

def execution_input_sql(kind: String) -> String:
  kind ++ " IN ('task','guidance','recovery')"

def input_state_sql(+row: String) -> String:
  "CASE WHEN " ++ stopped_session_sql(row ++ ".recipient") ++ " THEN json_object('stopId',(SELECT id FROM session_stops WHERE session=" ++ row ++ ".recipient),'executionDisposition',CASE WHEN " ++ row ++ ".receipt IS NOT NULL THEN 'accepted' WHEN " ++ execution_input_sql(row ++ ".kind") ++ " THEN 'stopped' ELSE 'retained-for-stopped-session' END) ELSE json('{}') END"

def session_state_sql(session: String) -> String:
  "coalesce((SELECT json_object('stop',json_object('id',id,'reason',reason,'status',outcome,'attempt',nullif(attempt,''),'requestedSignal',CASE WHEN attempt='' THEN NULL ELSE signal END,'submittedSignal',nullif(applied_signal,0),'controlError',nullif(control_error,''),'nativeStatus',nullif(native_status,''),'reportId',nullif(report_id,''))) FROM session_stops WHERE session=" ++ session ++ "),json('{}'))"

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
  ++ "SELECT json_object('error','player-assignment-conflict','session',id,'existing',json_object('parent',parent,'harness',harness,'model',model,'effort',effort,'workspace',workspace,'branch',branch,'base',base),'requested',json_object('parent'," ++ q(parent) ++ ",'harness'," ++ q(harness) ++ ",'model'," ++ q(model) ++ ",'effort'," ++ q(effort) ++ ",'workspace'," ++ q(workspace) ++ ",'branch'," ++ q(branch) ++ ",'base'," ++ q(base) ++ "),'condition','The session ID is already registered with a different assignment.','next','Read session ID and worktree ID. Retry recruit with the recorded assignment, or recruit a new ID with a new branch and unused path; retain the original work.') FROM sessions WHERE id=" ++ q(id) ++ " AND NOT " ++ player_matches(parent,harness,model,effort,workspace,branch,base) ++ ";"
  ++ session_result_where("id=" ++ q(id) ++ " AND " ++ player_matches(parent,harness,model,effort,workspace,branch,base))

# Empty endpoints disconnect. Other endpoints are native argv JSON, with one
# executable and text arguments representable by the host's process interface.
def endpoint_admitted(+endpoint: String) -> String:
  "(" ++ q(endpoint) ++ "='' OR CASE WHEN json_valid(" ++ q(endpoint) ++ ") THEN json_type(" ++ q(endpoint) ++ ")='array' AND json_array_length(" ++ q(endpoint) ++ ")>0 AND NOT EXISTS(SELECT 1 FROM json_each(" ++ q(endpoint) ++ ") WHERE type<>'text' OR instr(value,char(0))>0) AND coalesce(json_extract(" ++ q(endpoint) ++ ",'$[0]'),'')<>'' ELSE 0 END)"

def connect_sql(+id: String, native: String, +endpoint: String) -> String:
  "UPDATE sessions SET native=" ++ q(native) ++ ",endpoint=" ++ q(endpoint) ++ " WHERE id=" ++ q(id) ++ " AND " ++ endpoint_admitted(endpoint) ++ ";"
  ++ "SELECT json_object('error','invalid-endpoint','session'," ++ q(id) ++ ",'condition','Use an empty endpoint to disconnect, or a nonempty JSON array of text arguments with a nonempty executable and no NUL characters.','next','Pass the JSON argv array itself as one ENDPOINT argument; inspect session and inbox, then retry retained input after connecting.') WHERE NOT " ++ endpoint_admitted(endpoint) ++ ";"
  ++ session_result_where("id=" ++ q(id) ++ " AND " ++ endpoint_admitted(endpoint))

def message_result(id: String) -> String:
  "SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt)," ++ input_state_sql("messages") ++ ") FROM messages WHERE id=" ++ q(id) ++ ";"

# A repeated ID preserves the original message fields. Different input fails the transaction.
def message_upsert() -> String:
  " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN messages.sender=excluded.sender AND messages.recipient=excluded.recipient AND messages.kind=excluded.kind AND messages.body=excluded.body THEN messages.id ELSE NULL END;"

def delivery_row() -> String:
  "json_patch(json_object('id',m.id,'sender',m.sender,'recipient',m.recipient,'kind',m.kind,'body',m.body,'receipt',m.receipt,'harness',s.harness,'native',s.native,'endpoint',s.endpoint,'endpointArgv'," ++ endpoint_argv("s.endpoint") ++ ")," ++ input_state_sql("m") ++ ")"

def terminal(+event: String) -> String:
  "(json_extract(" ++ q(event) ++ ",'$.payload.kind')='run_terminal' OR json_extract(" ++ q(event) ++ ",'$.type')='result' OR (json_extract(" ++ q(event) ++ ",'$.type')='agent_end' AND coalesce(json_extract(" ++ q(event) ++ ",'$.isTerminal'),1)=1))"

# A child reports to its recorded parent. A parentless Conductor reports to the
# registered operator when that session has the explicit operator responsibility.
def report_recipient(+session: String) -> String:
  "(SELECT CASE WHEN report_sender.parent IS NOT NULL THEN report_sender.parent WHEN " ++ assigned_role("report_sender.id") ++ "='conductor' THEN (SELECT report_operator.id FROM sessions report_operator WHERE report_operator.id='operator' AND report_operator.parent IS NULL AND " ++ assigned_role("report_operator.id") ++ "='operator') END FROM sessions report_sender WHERE report_sender.id=" ++ session ++ ")"

def terminal_body(+event: String) -> String:
  "CASE WHEN json_extract(" ++ q(event) ++ ",'$.is_error')=1 OR (json_extract(" ++ q(event) ++ ",'$.payload.kind')='run_terminal' AND json_extract(" ++ q(event) ++ ",'$.payload.terminal')<>'completed') THEN " ++ q(event) ++ " ELSE coalesce(json_extract(" ++ q(event) ++ ",'$.result'),CASE WHEN json_extract(" ++ q(event) ++ ",'$.payload.kind')='run_terminal' THEN json_extract(" ++ q(event) ++ ",'$.payload.text') END,(SELECT group_concat(json_extract(c.value,'$.text'),char(10)) FROM json_each((SELECT m.value FROM json_each(" ++ q(event) ++ ",'$.messages') m WHERE json_extract(m.value,'$.role')='assistant' ORDER BY m.key DESC LIMIT 1),'$.content') c WHERE json_extract(c.value,'$.type')='text')," ++ q(event) ++ ") END"

def observe_identity_sql(+player: String, +event: String) -> String:
  "UPDATE sessions SET native=coalesce(CASE WHEN json_extract(" ++ q(event) ++ ",'$.type')='response' AND json_extract(" ++ q(event) ++ ",'$.command')='get_state' AND json_extract(" ++ q(event) ++ ",'$.success')=1 THEN json_extract(" ++ q(event) ++ ",'$.data.sessionId') END,CASE WHEN json_extract(" ++ q(event) ++ ",'$.type')='thread.started' THEN json_extract(" ++ q(event) ++ ",'$.thread_id') END,json_extract(" ++ q(event) ++ ",'$.session_id'),CASE WHEN json_extract(" ++ q(event) ++ ",'$.type')='session' THEN json_extract(" ++ q(event) ++ ",'$.id') END,CASE WHEN json_extract(" ++ q(event) ++ ",'$.stream.kind')='session' THEN json_extract(" ++ q(event) ++ ",'$.stream.id') END,native),observed_model=coalesce(CASE WHEN json_extract(" ++ q(event) ++ ",'$.type')='response' AND json_extract(" ++ q(event) ++ ",'$.command')='get_state' AND json_extract(" ++ q(event) ++ ",'$.success')=1 THEN json_extract(" ++ q(event) ++ ",'$.data.model.provider') || '/' || json_extract(" ++ q(event) ++ ",'$.data.model.id') END,CASE WHEN json_extract(" ++ q(event) ++ ",'$.payload_type')='run.model.configured' THEN json_extract(" ++ q(event) ++ ",'$.payload.model_id') END,CASE WHEN json_extract(" ++ q(event) ++ ",'$.message.provider') IS NOT NULL AND json_extract(" ++ q(event) ++ ",'$.message.model') IS NOT NULL THEN json_extract(" ++ q(event) ++ ",'$.message.provider') || '/' || json_extract(" ++ q(event) ++ ",'$.message.model') END,json_extract(" ++ q(event) ++ ",'$.message.model'),json_extract(" ++ q(event) ++ ",'$.model'),observed_model) WHERE id=" ++ q(player) ++ ";"

def completion_sql(+id: String, +player: String, +event: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id) ++ ",id," ++ report_recipient("sessions.id") ++ ",'report'," ++ terminal_body(event) ++ " FROM sessions WHERE id=" ++ q(player) ++ " AND " ++ report_recipient("sessions.id") ++ " IS NOT NULL AND " ++ terminal(event) ++ message_upsert()
  ++ "INSERT INTO turns(id,worker,event) SELECT " ++ q(id) ++ "," ++ q(player) ++ "," ++ q(event) ++ " WHERE " ++ report_recipient(q(player)) ++ " IS NOT NULL AND " ++ terminal(event) ++ " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN turns.worker=excluded.worker AND turns.event=excluded.event THEN turns.id ELSE NULL END;"
  ++ "SELECT json_object('player',id,'native',native,'eventType',coalesce(json_extract(" ++ q(event) ++ ",'$.type'),json_extract(" ++ q(event) ++ ",'$.payload_type')),'reportId',CASE WHEN " ++ report_recipient("sessions.id") ++ " IS NOT NULL AND " ++ terminal(event) ++ " THEN " ++ q(id) ++ " ELSE NULL END) FROM sessions WHERE id=" ++ q(player) ++ ";"

def observe_completion_sql(+id: String, +player: String, +event: String, sealed: Bool) -> String:
  Bool.pick(String,sealed,"",completion_sql(id,player,event))

def observe_sql(+id: String, +player: String, +event: String, sealed: Bool) -> String:
  observe_identity_sql(player,event) ++ observe_completion_sql(id,player,event,sealed)


# UNION makes ancestry finite even if a database has malformed cyclic parentage.
def ancestors(+session: String) -> String:
  "WITH RECURSIVE ancestors(id) AS (SELECT parent FROM sessions WHERE id=" ++ session ++ " AND parent IS NOT NULL UNION SELECT s.parent FROM sessions s JOIN ancestors a ON s.id=a.id WHERE s.parent IS NOT NULL) SELECT id FROM ancestors"

def descendant(+ancestor: String, session: String) -> String:
  "EXISTS(SELECT 1 FROM (" ++ ancestors(session) ++ ") WHERE id=" ++ ancestor ++ ")"

def depth(session: String) -> String:
  "(SELECT count(*) FROM (" ++ ancestors(session) ++ "))"

def peers(+left: String, +right: String) -> String:
  "(" ++ left ++ "<>" ++ right ++ " AND NOT " ++ descendant(left,right) ++ " AND NOT " ++ descendant(right,left) ++ " AND NOT (" ++ assigned_role(left) ++ "='conductor' AND " ++ assigned_role(right) ++ "='conductor' AND " ++ depth(left) ++ "<>" ++ depth(right) ++ "))"

def tight_peers(+sender: String, +recipient: String) -> String:
  "(" ++ peers(sender,recipient) ++ " AND " ++ assigned_role(sender) ++ "<>'operator' AND " ++ assigned_role(recipient) ++ "<>'operator' AND EXISTS(SELECT 1 FROM ensemble_members a JOIN ensemble_members b ON b.ensemble=a.ensemble JOIN ensembles e ON e.id=a.ensemble WHERE a.session=" ++ sender ++ " AND b.session=" ++ recipient ++ " AND e.coupling='tight' AND " ++ assigned_role("e.owner") ++ "='conductor'))"

def operator_route(+sender: String, +recipient: String) -> String:
  "((" ++ assigned_role(sender) ++ "='operator' AND " ++ assigned_role(recipient) ++ "='conductor' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ recipient ++ " AND parent IS NULL)) OR (" ++ assigned_role(recipient) ++ "='operator' AND " ++ assigned_role(sender) ++ "='conductor' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ sender ++ " AND parent IS NULL)))"

def message_route(+sender: String, +recipient: String) -> String:
  "(EXISTS(SELECT 1 FROM sessions WHERE id=" ++ sender ++ ") AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ recipient ++ ") AND " ++ sender ++ "<>" ++ recipient ++ " AND ((" ++ assigned_role(sender) ++ "<>'operator' AND " ++ assigned_role(recipient) ++ "<>'operator' AND (coalesce((SELECT parent FROM sessions WHERE id=" ++ sender ++ ")=" ++ recipient ++ ",0) OR (" ++ assigned_role(sender) ++ "='conductor' AND " ++ descendant(sender,recipient) ++ ") OR " ++ tight_peers(sender,recipient) ++ ")) OR " ++ operator_route(sender,recipient) ++ "))"

def exact_message(+id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> String:
  "EXISTS(SELECT 1 FROM messages WHERE id=" ++ q(id) ++ " AND sender=" ++ q(sender) ++ " AND recipient=" ++ q(recipient) ++ " AND kind=" ++ q(kind) ++ " AND body=" ++ q(body) ++ ")"

def matching_message_result(+id: String, sender: String, recipient: String, kind: String, body: String) -> String:
  "SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt)," ++ input_state_sql("messages") ++ ") FROM messages WHERE id=" ++ q(id) ++ " AND " ++ exact_message(id,sender,recipient,kind,body) ++ ";"

def message_sql(+id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id) ++ "," ++ q(sender) ++ "," ++ q(recipient) ++ "," ++ q(kind) ++ "," ++ q(body) ++ " WHERE (" ++ message_route(q(sender),q(recipient)) ++ " AND NOT (" ++ stopped_session_sql(q(recipient)) ++ " AND " ++ execution_input_sql(q(kind)) ++ ")) OR " ++ exact_message(id,sender,recipient,kind,body) ++ message_upsert()
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

def ensemble_sql(+id: String, +owner: String, +coupling: String) -> String:
  "INSERT INTO ensembles(id,owner,coupling) SELECT " ++ q(id) ++ "," ++ q(owner) ++ "," ++ q(coupling) ++ " WHERE " ++ assigned_role(q(owner)) ++ "='conductor' AND " ++ q(coupling) ++ " IN ('loose','tight') ON CONFLICT(id) DO UPDATE SET id=CASE WHEN ensembles.owner=excluded.owner THEN ensembles.id ELSE NULL END,coupling=excluded.coupling;SELECT " ++ ensemble_row("ensembles") ++ " FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ " AND coupling=" ++ q(coupling) ++ ";"

def ensemble_member_sql(+id: String, +owner: String, +session: String, +action: String) -> String:
  "DELETE FROM ensemble_members WHERE ensemble=" ++ q(id) ++ " AND session=" ++ q(session) ++ " AND " ++ q(action) ++ "='remove' AND EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ ");"
  ++ "INSERT OR IGNORE INTO ensemble_members(ensemble,session) SELECT " ++ q(id) ++ "," ++ q(session) ++ " WHERE " ++ q(action) ++ "='add' AND EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ ") AND " ++ assigned_role(q(owner)) ++ "='conductor' AND " ++ assigned_role(q(session)) ++ "<>'operator' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ q(session) ++ ");"
  ++ "SELECT json_object('ensemble'," ++ q(id) ++ ",'owner'," ++ q(owner) ++ ",'session'," ++ q(session) ++ ",'membership'," ++ q(action) ++ ") WHERE EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ ") AND ((" ++ q(action) ++ "='add' AND EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ q(id) ++ " AND session=" ++ q(session) ++ ")) OR (" ++ q(action) ++ "='remove' AND NOT EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ q(id) ++ " AND session=" ++ q(session) ++ ")));"


def section_owner(+ensemble: String, +owner: String) -> String:
  "(EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(ensemble) ++ " AND owner=" ++ q(owner) ++ ") AND " ++ assigned_role(q(owner)) ++ "='conductor')"

def section_admitted(ensemble: String, owner: String, capability: String) -> String:
  "(" ++ section_owner(ensemble,owner) ++ " AND " ++ q(capability) ++ "<>'')"

def section_refusal(ensemble: String, id: String, owner: String, admitted: String) -> String:
  "SELECT json_object('error','section-refused','ensemble'," ++ q(ensemble) ++ ",'section'," ++ q(id) ++ ",'owner'," ++ q(owner) ++ ",'condition','Use the named Ensemble conductor owner, a nonempty capability, and an existing Ensemble Player for membership.','next','Read ensemble ID and section ENSEMBLE SECTION. Add the Player to that Ensemble before assigning its Section; use add or remove for membership.') WHERE NOT " ++ admitted ++ ";"

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

def orchestra_sql() -> String:
  "SELECT json_object('players'," ++ players_json(assigned_role("s.id") ++ "<>'operator'") ++ ",'operators'," ++ players_json(assigned_role("s.id") ++ "='operator'") ++ ",'ensembles',(SELECT json_group_array(json(item)) FROM (SELECT " ++ ensemble_row("e") ++ " AS item FROM ensembles e ORDER BY e.id)));"


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
    case EnsembleRead{id}:
      "SELECT " ++ ensemble_row("ensembles") ++ " FROM ensembles WHERE id=" ++ q(id) ++ ";"
    case EnsembleMember{id,owner,session,action}: ensemble_member_sql(id,owner,session,action)
    case Message{+id, sender, +recipient, +kind, body}:
      message_sql(id,sender,recipient,kind,body)
    case Report{+id, +sender, body}:
      "INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ q(id) ++ "," ++ q(sender) ++ "," ++ report_recipient(q(sender)) ++ ",'report'," ++ q(body) ++ ")" ++ message_upsert() ++ message_result(id)
    case Ask{+id, +player, body}:
      "INSERT INTO messages(id,sender,recipient,kind,body) VALUES(" ++ q(id) ++ "," ++ q(player) ++ ",(SELECT parent FROM sessions WHERE id=" ++ q(player) ++ "),'question'," ++ q(body) ++ ")" ++ message_upsert() ++ message_result(id)
    case Ack{+id, +recipient, receipt}:
      "UPDATE messages SET receipt=coalesce(receipt," ++ q(receipt) ++ ") WHERE id=" ++ q(id) ++ " AND recipient=" ++ q(recipient) ++ ";SELECT json_object('id',id,'receipt',receipt) FROM messages WHERE id=" ++ q(id) ++ " AND recipient=" ++ q(recipient) ++ ";"
    case Session{id}: session_result(id)
    case Delivery{id}:
      "SELECT " ++ delivery_row() ++ " FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ q(id) ++ ";"
    case Pending{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ delivery_row() ++ " AS item FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL ORDER BY m.seq);"
    case Inbox{id}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body)," ++ input_state_sql("messages") ++ ") AS item FROM messages WHERE recipient=" ++ q(id) ++ " AND receipt IS NULL ORDER BY seq);"
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
    case ObserveFile{id,player,path}: ""
    case MessageFile{id,sender,recipient,kind,path}: ""
    case AskFile{id,player,path}: ""
    case NativeReply{parent,id,response}: ""
    case NativeReplyFile{parent,id,path}: ""
    case Stop{session,id,reason}: ""
    case ForceStop{session,id}: ""
    case RunTurn{player,id,cmd,model,effort,cwd,task,log,session}: ""
    case Receive{session,cmd,model,effort,cwd,log,message}: ""
    case Start{session,harness,cmd,model,effort,cwd,log,id,task}: ""
    case Receiver{session,cmd,log}: ""
    case DispatchFile{id,sender,recipient,kind,path}: ""
    case DispatchTurn{player,id,cmd,log,task}: ""
    case StatusPretty{}: ""
    case Pretty{read}: ""
    case Land{player,repo,target}: ""
    case LandChecked{player,repo,target,check,files}: ""
    case Push{repo,branch,remote}: ""
    case RemoteTip{repo,branch,remote}: ""
    case ObservedUsage{session}: ""
    case Logs{session,level,budget,segments}: ""
    case LogsStorage{}: ""
    case LogsClean{session}: ""
    case Recruit{id,parent,harness,model,effort,repo,branch,path,base}: ""
    case Worktree{id}: ""
    case KnowledgeRecord{id,author,claim,evidence,limits}: ""
    case KnowledgeRead{reader}: ""
    case KnowledgePromote{id,promoter,source,destination,finding}: ""
    case ContextEngines{}: ""
    case ContextQueryFile{owner,query,path}: ""
    case ContextResult{query}: ""
    case Help{}: ""
    case Invalid{}: ""

def help_verb(+verb: String) -> Bool:
  Bool.or(String.eq(verb,"help"),String.eq(verb,"--help"))

def parse(args: List<String>) -> Command:
  match args:
    case +verb <> Nil{}:
      Bool.pick(Command,String.eq(verb,"logs-storage"),LogsStorage{},
      Bool.pick(Command,help_verb(verb),Help{},
      Bool.pick(Command, String.eq(verb,"status"),Status{},
      Bool.pick(Command, String.eq(verb,"workers"),LegacySubordinates{},
      Bool.pick(Command, String.eq(verb,"players"),Players{},
      Bool.pick(Command,String.eq(verb,"orchestra"),Orchestra{},
      Bool.pick(Command, String.eq(verb,"pending"),Pending{},
      Bool.pick(Command,String.eq(verb,"context-engines"),ContextEngines{},Invalid{}))))))))
    case +verb <> +id <> Nil{}:
      Bool.pick(Command,String.eq(verb,"logs"),Logs{id,"","",""},
      Bool.pick(Command,String.eq(verb,"logs-clean"),LogsClean{id},
      Bool.pick(Command,Bool.and(Bool.or(String.eq(verb,"players"),Bool.or(String.eq(verb,"orchestra"),String.eq(verb,"pending"))),String.eq(id,"--pretty")),Pretty{Bool.pick(Command,String.eq(verb,"players"),Players{},Bool.pick(Command,String.eq(verb,"orchestra"),Orchestra{},Pending{}))},Bool.pick(Command,Bool.and(String.eq(verb,"status"),String.eq(id,"--pretty")),StatusPretty{},Bool.pick(Command,String.eq(verb,"player"),PlayerRead{id},Bool.pick(Command, String.eq(verb,"role"),RoleRead{id},Bool.pick(Command, String.eq(verb,"ensemble"),EnsembleRead{id},Bool.pick(Command, String.eq(verb,"inbox"),Inbox{id},
      Bool.pick(Command, String.eq(verb,"session"),Session{id},
      Bool.pick(Command, String.eq(verb,"delivery"),Delivery{id},
      Bool.pick(Command, String.eq(verb,"worktree"),Worktree{id},
      Bool.pick(Command, String.eq(verb,"turns"),Turns{id},
      Bool.pick(Command, String.eq(verb,"knowledge"),KnowledgeRead{id},
      Bool.pick(Command,String.eq(verb,"context-result"),ContextResult{id},
      Bool.pick(Command, String.eq(verb,"observed-usage"),ObservedUsage{id},Invalid{})))))))))))))))
    case +verb <> +session <> +id <> Nil{}:
      Bool.pick(Command,String.eq(verb,"logs"),Logs{session,id,"",""},
      Bool.pick(Command,Bool.and(Bool.or(String.eq(verb,"player"),Bool.or(String.eq(verb,"session"),Bool.or(String.eq(verb,"inbox"),Bool.or(String.eq(verb,"delivery"),Bool.or(String.eq(verb,"turns"),Bool.or(String.eq(verb,"knowledge"),String.eq(verb,"worktree"))))))),String.eq(id,"--pretty")),Pretty{Bool.pick(Command,String.eq(verb,"player"),PlayerRead{session},Bool.pick(Command,String.eq(verb,"session"),Session{session},Bool.pick(Command,String.eq(verb,"inbox"),Inbox{session},Bool.pick(Command,String.eq(verb,"delivery"),Delivery{session},Bool.pick(Command,String.eq(verb,"turns"),Turns{session},Bool.pick(Command,String.eq(verb,"knowledge"),KnowledgeRead{session},Worktree{session}))))))},Bool.pick(Command,String.eq(verb,"section"),SectionRead{session,id},Bool.pick(Command,String.eq(verb,"role"),Role{session,id},Bool.pick(Command,String.eq(verb,"ensemble"),Ensemble{session,id,"loose"},Bool.pick(Command,String.eq(verb,"force-stop"),ForceStop{session,id},Invalid{}))))))
    case +verb <> +id <> +one <> +two <> Nil{}:
      Bool.pick(Command,String.eq(verb,"logs"),Logs{id,one,two,""},
      Bool.pick(Command,String.eq(verb,"receiver"),Receiver{id,one,two},Bool.pick(Command, String.eq(verb,"ensemble"),Ensemble{id,one,two},Bool.pick(Command, String.eq(verb,"native-reply"),NativeReply{id,one,two},
      Bool.pick(Command, String.eq(verb,"native-reply-file"),NativeReplyFile{id,one,two},
      Bool.pick(Command, String.eq(verb,"stop"),Stop{id,one,two},
      Bool.pick(Command, String.eq(verb,"report"),Report{id,one,two},
      Bool.pick(Command, String.eq(verb,"ack"),Ack{id,one,two},
      Bool.pick(Command, String.eq(verb,"observe-file"),ObserveFile{id,one,two},
      Bool.pick(Command, String.eq(verb,"connect"),Connect{id,one,two},
      Bool.pick(Command, String.eq(verb,"land"),Land{id,one,two},
      Bool.pick(Command, String.eq(verb,"push"),Push{id,one,two},
      Bool.pick(Command, String.eq(verb,"ask"),Ask{id,one,two},
      Bool.pick(Command, String.eq(verb,"ask-file"),AskFile{id,one,two},Bool.pick(Command, String.eq(verb,"remote-tip"),RemoteTip{id,one,two},Invalid{})))))))))))))))
    case +verb <> +id <> +one <> +two <> +three <> Nil{}:
      Bool.pick(Command,String.eq(verb,"context-query-file"),ContextQueryFile{id,one,two},
      Bool.pick(Command,String.eq(verb,"logs"),Logs{id,one,two,three},
      Bool.pick(Command,String.eq(verb,"section"),Section{id,one,two,three},Bool.pick(Command, String.eq(verb,"ensemble-member"),EnsembleMember{id,one,two,three},Bool.pick(Command, String.eq(verb,"attach"),Attach{id,one,two,three},Invalid{}))))
    case +verb <> +id <> +one <> +two <> +three <> +four <> Nil{}:
      Bool.pick(Command,String.eq(verb,"dispatch-turn"),DispatchTurn{id,one,two,three,four},Bool.pick(Command,String.eq(verb,"dispatch-file"),DispatchFile{id,one,two,three,four},Bool.pick(Command,String.eq(verb,"section-member"),SectionMember{id,one,two,three,four},Bool.pick(Command, String.eq(verb,"land-checked"),LandChecked{id,one,two,three,four},
      Bool.pick(Command, String.eq(verb,"bind"),Bind{id,one,two,three,four},
      Bool.pick(Command, String.eq(verb,"message"),Message{id,one,two,three,four},
      Bool.pick(Command, String.eq(verb,"message-file"),MessageFile{id,one,two,three,four},Bool.pick(Command, String.eq(verb,"record"),KnowledgeRecord{id,one,two,three,four},Bool.pick(Command, String.eq(verb,"promote"),KnowledgePromote{id,one,two,three,four},Invalid{})))))))))
    case +verb <> session <> cmd <> model <> effort <> cwd <> log <> message <> Nil{}:
      Bool.pick(Command,String.eq(verb,"receive"),Receive{session,cmd,model,effort,cwd,log,message},Invalid{})
    case +verb <> +player <> +id <> +cmd <> +model <> +effort <> +cwd <> +task <> +log <> +session <> Nil{}:
      Bool.pick(Command,String.eq(verb,"start"),Start{player,id,cmd,model,effort,cwd,task,log,session},Bool.pick(Command,String.eq(verb,"turn"),RunTurn{player,id,cmd,model,effort,cwd,task,log,session},
      Bool.pick(Command,String.eq(verb,"recruit"),Recruit{player,id,cmd,model,effort,cwd,task,log,session},Invalid{})))
    case _: Invalid{}

law help_word_selects_the_help_command:
  {parse(["help"]) == Help{} : Command}

def help_word_selects_the_help_command():
  {==}

law help_flag_selects_the_help_command:
  {parse(["--help"]) == Help{} : Command}

def help_flag_selects_the_help_command():
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

law context_engines_parser_selects_the_native_discovery_command:
  {parse(["context-engines"]) == ContextEngines{} : Command}

def context_engines_parser_selects_the_native_discovery_command():
  {==}

law context_query_file_parser_preserves_owner_query_and_path:
  for +owner: String
  for +query: String
  for +path: String
  {parse(["context-query-file",owner,query,path]) == ContextQueryFile{owner,query,path} : Command}

def context_query_file_parser_preserves_owner_query_and_path(owner,query,path):
  {==}

law context_result_parser_preserves_the_query_identity:
  for +query: String
  {parse(["context-result",query]) == ContextResult{query} : Command}

def context_result_parser_preserves_the_query_identity(query):
  {==}
