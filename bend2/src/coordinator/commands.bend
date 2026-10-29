import Base
import ../coordinator/message-status.bend as MessageStatus
import ./log-schema.bend as LogSchema

type Command is Data:
  Join{id: String, parent: String, harness: String, model: String, effort: String, path: String}
  Recruit{id: String, parent: String, harness: String, model: String, effort: String, repo: String, branch: String, path: String, base: String}
  Worktree{id: String}
  Receive{session: String, cmd: String, model: String, effort: String, cwd: String, log: String, message: String}
  RecoverObserver{session: String, observer: String}
  Start{session: String, harness: String, cmd: String, model: String, effort: String, cwd: String, log: String, id: String, task: String}
  StartSetup{session: String, harness: String, cmd: String, model: String, effort: String, cwd: String, log: String}
  ProfileBind{session: String, harness: String, label: String, store: String}
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
  ConfirmNext{id: String, sender: String, recipient: String, request: String, task_id: String, task: String}
  MessageFile{id: String, sender: String, recipient: String, kind: String, path: String}
  MessageBatch{sender: String, input: String}
  MessageBatchFile{sender: String, path: String}
  TaskContinue{session: String, id: String}
  Succeed{successor: String, predecessor: String}
  Observe{id: String, player: String, event: String, sealed: Bool, harness: String}
  ObserveFile{id: String, player: String, path: String}
  Report{id: String, sender: String, body: String}
  ReportFile{id: String, sender: String, path: String}
  Ask{id: String, player: String, body: String}
  AskFile{id: String, player: String, path: String}
  NativeReply{parent: String, id: String, response: String}
  NativeReplyFile{parent: String, id: String, path: String}
  Session{id: String}
  Delivery{id: String}
  InputDetail{id: String}
  DeliveryBatch{input: String}
  DeliveryBatchFile{path: String}
  Pending{}
  PendingIndex{}
  Inbox{id: String}
  InboxIndex{id: String}
  Outbox{id: String}
  MessageIndex{inbox: Bool, condition: String, state: String}
  Land{player: String, repo: String, target: String}
  LandAt{player: String, repo: String, target: String, commit: String}
  LandCheckedAt{player: String, repo: String, target: String, check: String, files: String, commit: String}
  LandChecked{player: String, repo: String, target: String, check: String, files: String}
  Push{repo: String, branch: String, remote: String}
  RemoteTip{repo: String, branch: String, remote: String}
  ObservedUsage{session: String}
  Account{action: String, id: String, provider: String, harness: String, funding: String, secret_ref: String, organization: String, detail: String, session: String}
  Models{session: String}
  ModelsAll{session: String}
  HarnessInventory{}
  UsageWindows{session: String}
  UsageWindowRefresh{session: String}
  Logs{session: String, level: String}
  LogsStorage{}
  LogsClean{session: String}
  LogsCleanAll{}
  StoragePolicy{}
  StoragePreview{session: String}
  StorageApply{session: String}
  StorageCollect{session: String}
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
  ClearStop{session: String}
  KnowledgeRecord{id: String, author: String, claim: String, evidence: String, limits: String}
  KnowledgeRecordTyped{id: String, author: String, kind: String, claim: String, evidence: String, limits: String}
  KnowledgeRecordLinked{id: String, author: String, kind: String, claim: String, evidence: String, limits: String, links: String}
  KnowledgeSearch{reader: String, scope: String, subject: String, query: String}
  KnowledgeTraverse{reader: String, scope: String, subject: String, reference: String, direction: String, relation: String, recursive: Bool}
  KnowledgeRelate{id: String, author: String, source: String, relation: String, target: String}
  KnowledgeRead{reader: String}
  KnowledgeReadScope{reader: String, scope: String, subject: String}
  KnowledgeRelations{reader: String, scope: String, subject: String}
  KnowledgeIndex{reader: String}
  KnowledgeDetail{reader: String, id: String}
  KnowledgeScopeIndex{reader: String, scope: String, subject: String}
  KnowledgeScopeDetail{reader: String, scope: String, subject: String, id: String}
  KnowledgePromote{id: String, promoter: String, source: String, destination: String, finding: String}
  KnowledgePromoteScoped{id: String, promoter: String, source_kind: String, source: String, destination_kind: String, destination: String, finding: String}
  View{subject: String, reader: String, port: String}
  UiSubscribe{after_cursor: String, generation: String}
  ContextEngines{session: String}
  ContextInstall{module_id: String, source: String}
  ContextQueryFile{owner: String, query: String, path: String}
  ContextEval{owner: String, query: String, session: String, expression: String, frame: String, cwd: String}
  ContextResult{query: String}
  Serve{}
  Stall{}
  StallWake{}
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
# a recorded read clears the obligation. A separate table keeps existing
# databases upgrade-safe: every commit runs schema(), so the table
# self-creates on first commit after upgrade, and readers tolerate absence.
def wake_claim_schema() -> String:
  "CREATE TABLE IF NOT EXISTS wake_claims (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), state TEXT NOT NULL DEFAULT 'claimed', owner TEXT NOT NULL DEFAULT '', generation INTEGER NOT NULL DEFAULT 0);"
  ++ "CREATE TABLE IF NOT EXISTS wake_claim_tickets (session TEXT NOT NULL REFERENCES sessions(id), directory TEXT NOT NULL, owner TEXT NOT NULL, generation INTEGER NOT NULL, PRIMARY KEY(session,directory));"

def task_input_schema() -> String:
  "CREATE TABLE IF NOT EXISTS task_input_requests (id TEXT PRIMARY KEY NOT NULL,request TEXT NOT NULL CHECK(json_valid(request) AND json_type(request)='object'),result TEXT CHECK(result IS NULL OR (json_valid(result) AND json_type(result)='object')));"

# Provider refusal evidence (#797): one row per provider exhaustion terminal,
# bound to the session's harness, the provider prefix of its model, and the
# account label in force. usage_reads (#1025) keeps one row per live read of a
# provider's usage API; the seat's hold derives from those rows only.
def usage_windows_schema() -> String:
  "CREATE TABLE IF NOT EXISTS usage_windows (id INTEGER PRIMARY KEY AUTOINCREMENT, recorded_at INTEGER NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', account TEXT NOT NULL DEFAULT '', window TEXT NOT NULL, resets_at INTEGER, reset_source TEXT NOT NULL, used_fraction REAL, receipt TEXT NOT NULL, message TEXT NOT NULL DEFAULT '');"
  ++ "CREATE INDEX IF NOT EXISTS idx_usage_windows_match ON usage_windows(harness, provider, account, recorded_at);"
  ++ "CREATE TABLE IF NOT EXISTS usage_reads (id INTEGER PRIMARY KEY AUTOINCREMENT, observed_at INTEGER NOT NULL, provider TEXT NOT NULL, account TEXT NOT NULL DEFAULT '', session TEXT NOT NULL DEFAULT '', trigger TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('read','unreadable')), source TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', document TEXT NOT NULL CHECK(json_valid(document)));"
  ++ "CREATE INDEX IF NOT EXISTS idx_usage_reads_scope ON usage_reads(provider, account, id);"

def schema() -> String:
  wake_claim_schema()
  ++ task_input_schema()
  ++ usage_windows_schema()
  ++ "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT REFERENCES sessions(id), harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL REFERENCES sessions(id), recipient TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);"
  ++ "DROP INDEX IF EXISTS messages_pending;CREATE INDEX IF NOT EXISTS messages_recipient_seq ON messages(recipient,seq,id);"
  ++ "CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY NOT NULL REFERENCES messages(id), worker TEXT NOT NULL REFERENCES sessions(id), event TEXT NOT NULL);"
  ++ "CREATE TABLE IF NOT EXISTS executions (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), id TEXT NOT NULL, mode TEXT NOT NULL, directory TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT '');"
  ++ MessageStatus.schema()
  ++ "CREATE TABLE IF NOT EXISTS session_stops (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, attempt TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '', signal INTEGER NOT NULL DEFAULT 15, applied_signal INTEGER NOT NULL DEFAULT 0, control_error TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, native_status TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '');"
  ++ messaging_schema()
  ++ log_schema()

def stopped_session_sql(session: String) -> String:
  "EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ session ++ ")"

# Message lifecycle is delivered/read; the canonical predicates live in
# message-status.bend so every gate derives from the same expression.
def owed_sql(+row: String) -> String:
  MessageStatus.owed_sql(row)

def read_sql(+row: String) -> String:
  MessageStatus.read_sql(row)

def execution_input_sql(kind: String) -> String:
  kind ++ " IN ('task','guidance','recovery','task-assignment','task-continuation','completion-confirmed')"

def input_state_sql(+row: String) -> String:
  "CASE WHEN " ++ stopped_session_sql(row ++ ".recipient") ++ " THEN json_object('stopId',(SELECT id FROM session_stops WHERE session=" ++ row ++ ".recipient),'executionDisposition',CASE WHEN " ++ read_sql(row) ++ " THEN 'accepted' WHEN " ++ execution_input_sql(row ++ ".kind") ++ " THEN 'stopped' ELSE 'retained-for-stopped-session' END) ELSE json('{}') END"

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
  ++ " WHEN (SELECT route.harness FROM sessions AS route WHERE route.id=" ++ session ++ ") NOT IN ('codex','omp','muse','claude-code','dsh','antigravity') THEN 'harness-unsupported'"
  ++ " WHEN " ++ blocked_endpoint_absent_sql(session) ++ " AND NOT " ++ direct_app_route_sql(session) ++ " THEN 'endpoint-absent'"
  ++ " WHEN EXISTS(SELECT 1 FROM executions e WHERE e.session=" ++ session ++ " AND e.phase='exited' AND (e.status<>'exit 0' OR EXISTS(SELECT 1 FROM turns t WHERE t.id=e.id AND t.worker=e.session AND (coalesce(json_extract(t.event,'$.is_error'),0)=1 OR " ++ omp_terminal_error_sql_expr("t.event") ++ " OR (json_extract(t.event,'$.payload.kind')='run_terminal' AND json_extract(t.event,'$.payload.terminal')<>'completed'))))) THEN 'provider-failure'"
  ++ " ELSE '' END"

def assigned_role(session: String) -> String:
  "coalesce((SELECT role FROM session_roles WHERE session=" ++ session ++ "),'player')"

# The registered operator session, the final coordinator of a session whose
# recorded ancestors have all ended.
def operator_destination_sql() -> String:
  "(SELECT report_operator.id FROM sessions report_operator WHERE report_operator.id='operator' AND report_operator.parent IS NULL AND " ++ assigned_role("report_operator.id") ++ "='operator')"

# The coordinators with authority over a worker: its recorded parent, every
# ancestor of that parent, and every successor recorded for any of them by the
# admitted succession action (message succession:PREDECESSOR:SUCCESSOR of kind
# succession, sent by the successor to the predecessor). The relation holds
# whether or not those sessions are live, so a confirmation recorded by one of
# them stays valid. UNION keeps the walk finite for malformed cyclic records.
def coordinator_closure_sql(+worker: String) -> String:
  "WITH RECURSIVE chain_kinds(k) AS (VALUES(0),(1)),coordinator_closure(id) AS (SELECT chain_start.parent FROM sessions chain_start WHERE chain_start.id=" ++ worker ++ " AND chain_start.parent IS NOT NULL UNION SELECT CASE chain_edge.k WHEN 0 THEN chain_session.parent ELSE chain_succession.sender END FROM coordinator_closure chain_node JOIN sessions chain_session ON chain_session.id=chain_node.id LEFT JOIN messages chain_succession ON chain_succession.kind='succession' AND chain_succession.recipient=chain_node.id AND chain_succession.id='succession:' || chain_succession.recipient || ':' || chain_succession.sender JOIN chain_kinds chain_edge) SELECT id FROM coordinator_closure"

def coordinator_chain_sql(+worker: String, +candidate: String) -> String:
  "(" ++ candidate ++ " IN (" ++ coordinator_closure_sql(worker) ++ "))"

# A session is over when it has an explicit stop, or the confirmation of its
# current completion request by its recorded parent or the parent's recorded
# successor is the latest assignment, request or confirmation exchanged with that
# coordinator. Other sessions skip an over session when they look for a live
# coordinator.
def session_over_sql(+session: String) -> String:
  "(" ++ stopped_session_sql(session) ++ " OR EXISTS(SELECT 1 FROM messages confirmation WHERE confirmation.recipient=" ++ session ++ " AND confirmation.kind='completion-confirmed' AND confirmation.sender IN (SELECT over_parent.parent FROM sessions over_parent WHERE over_parent.id=" ++ session ++ " UNION SELECT over_succession.sender FROM messages over_succession JOIN sessions over_child ON over_child.parent=over_succession.recipient WHERE over_child.id=" ++ session ++ " AND over_succession.kind='succession' AND over_succession.id='succession:' || over_succession.recipient || ':' || over_succession.sender) AND EXISTS(SELECT 1 FROM messages over_request WHERE over_request.id=confirmation.body AND over_request.sender=" ++ session ++ " AND over_request.kind='completion-request')"
  ++ " AND NOT EXISTS(SELECT 1 FROM messages later_assignment WHERE later_assignment.seq>confirmation.seq AND later_assignment.recipient=" ++ session ++ " AND later_assignment.sender=confirmation.sender AND later_assignment.kind IN ('task','guidance','recovery','task-assignment'))"
  ++ " AND NOT EXISTS(SELECT 1 FROM messages later_request WHERE later_request.seq>confirmation.seq AND later_request.sender=" ++ session ++ " AND later_request.recipient=confirmation.sender AND later_request.kind='completion-request')))"

# The worker's current coordinator for reports and requests: the first session
# in the walk from its recorded parent that is not over, else the registered
# operator. From a coordinator that is over the walk continues to the successor
# recorded for it, else to its own parent.
def coordinator_sql(+worker: String) -> String:
  "coalesce((WITH RECURSIVE coordinator_path(id) AS (SELECT chain_start.parent FROM sessions chain_start WHERE chain_start.id=" ++ worker ++ " AND chain_start.parent IS NOT NULL UNION SELECT coalesce(succession.sender,path_session.parent) FROM coordinator_path path_node JOIN sessions path_session ON path_session.id=path_node.id LEFT JOIN messages succession ON succession.kind='succession' AND succession.recipient=path_node.id AND succession.id='succession:' || succession.recipient || ':' || succession.sender WHERE " ++ session_over_sql("path_node.id") ++ ") SELECT live_node.id FROM coordinator_path live_node WHERE live_node.id IS NOT NULL AND NOT " ++ session_over_sql("live_node.id") ++ " LIMIT 1)," ++ operator_destination_sql() ++ ")"

# The current coordinator of a parented worker; a parentless session has none.
def current_coordinator_sql(+worker: String) -> String:
  "(SELECT CASE WHEN coordinated_worker.parent IS NOT NULL THEN " ++ coordinator_sql("coordinated_worker.id") ++ " END FROM sessions coordinated_worker WHERE coordinated_worker.id=" ++ worker ++ ")"

# The accountable owner for blocked input is the current coordinator, else the
# registered operator. This mirrors report_recipient without naming it, which
# is defined below.
def blocked_owner_sql(+session: String) -> String:
  "CASE WHEN (SELECT report_sender.parent FROM sessions report_sender WHERE report_sender.id=" ++ session ++ ") IS NOT NULL THEN " ++ coordinator_sql(session) ++ " WHEN " ++ assigned_role(session) ++ "='conductor' AND EXISTS(SELECT 1 FROM sessions report_sender WHERE report_sender.id=" ++ session ++ ") THEN " ++ operator_destination_sql() ++ " END"

# An assignment remains open across native turns. Its worker explicitly asks
# its coordinator to confirm completion through ordinary messages. A message is
# an assignment of the worker when a coordinator of the worker sent it as a
# task, guidance, recovery or task-assignment, or the worker recorded its own
# initial task input. The row names a messages alias and the worker row a
# sessions alias.
def task_assigned_sql(+row: String, +worker: String, +session: String) -> String:
  row ++ ".recipient=" ++ session ++ " AND (" ++ worker ++ ".parent IS NULL AND " ++ row ++ ".sender<>" ++ row ++ ".recipient AND " ++ row ++ ".kind IN ('task','guidance','recovery') OR " ++ worker ++ ".parent IS NULL AND " ++ row ++ ".kind='task-assignment'"
  ++ " OR " ++ worker ++ ".parent IS NOT NULL AND " ++ coordinator_chain_sql(session,row ++ ".sender") ++ " AND " ++ row ++ ".kind IN ('task','guidance','recovery','task-assignment')"
  ++ " OR " ++ worker ++ ".parent IS NOT NULL AND " ++ row ++ ".sender=" ++ row ++ ".recipient AND " ++ row ++ ".kind='task-assignment' AND substr(" ++ row ++ ".id,-11)=':task-input')"

def task_assignment_sql(+session: String) -> String:
  "(SELECT a.seq FROM messages a JOIN sessions assigned_worker ON assigned_worker.id=a.recipient WHERE " ++ task_assigned_sql("a","assigned_worker",session) ++ " ORDER BY a.seq DESC LIMIT 1)"

# The registered operator receives and confirms completion requests of any
# worker. Other operator input to a worker is direct operator input.
def task_addressee_sql(+row: String, +session: String) -> String:
  "(" ++ coordinator_chain_sql(session,row ++ ".recipient") ++ " OR " ++ row ++ ".recipient=" ++ operator_destination_sql() ++ ")"

def task_request_sql(+session: String) -> String:
  "(SELECT r.id FROM messages r WHERE r.sender=" ++ session ++ " AND " ++ task_addressee_sql("r",session) ++ " AND r.kind='completion-request' AND NOT EXISTS(SELECT 1 FROM messages a JOIN sessions assigned_worker ON assigned_worker.id=a.recipient WHERE a.seq>r.seq AND " ++ task_assigned_sql("a","assigned_worker",session) ++ ") ORDER BY r.seq DESC LIMIT 1)"

# The current request is the worker's latest request to a coordinator with no
# assignment after it; a confirmation of it by a coordinator or the operator
# confirms the assignment.
def task_confirmed_sql(+session: String) -> String:
  "EXISTS(SELECT 1 FROM messages c JOIN messages r ON r.id=c.body WHERE c.recipient=" ++ session ++ " AND (" ++ coordinator_chain_sql(session,"c.sender") ++ " OR c.sender=" ++ operator_destination_sql() ++ ") AND c.kind='completion-confirmed' AND c.seq>r.seq AND r.sender=" ++ session ++ " AND r.kind='completion-request' AND " ++ task_addressee_sql("r",session)
  ++ " AND NOT EXISTS(SELECT 1 FROM messages later WHERE later.sender=" ++ session ++ " AND later.kind='completion-request' AND later.seq>r.seq AND " ++ task_addressee_sql("later",session) ++ ")"
  ++ " AND NOT EXISTS(SELECT 1 FROM messages a JOIN sessions assigned_worker ON assigned_worker.id=a.recipient WHERE a.seq>r.seq AND " ++ task_assigned_sql("a","assigned_worker",session) ++ "))"

# An assignment ends when its current completion request is confirmed and no
# newer assignment follows; a newer assignment makes the request no longer
# current, so the confirmation stops applying. The state derives from the
# retained messages whichever path recorded the confirmation.
def task_ended_sql(+session: String) -> String:
  "(" ++ task_confirmed_sql(session) ++ " AND NOT " ++ stopped_session_sql(session) ++ ")"

# Operator input to an ended assignment stays effective, so a confirmed
# assignment closes new native admission only while no owed input came from an
# operator. A newer coordinator assignment makes the assignment not ended.
def task_closed_sql(+session: String) -> String:
  "(" ++ task_confirmed_sql(session) ++ " AND NOT " ++ stopped_session_sql(session) ++ " AND NOT EXISTS(SELECT 1 FROM messages operator_input WHERE operator_input.recipient=" ++ session ++ " AND " ++ owed_sql("operator_input") ++ " AND EXISTS(SELECT 1 FROM session_roles operator_role WHERE operator_role.session=operator_input.sender AND operator_role.role='operator')))"

# Wake and ownership projection shared by every session surface. Pending input
# uses the continuation count: owed (delivered, not yet read) input on an
# unstopped session whose assignment is not closed by a confirmation.
# The claim reads the wake_claims table, which every commit creates through
# schema() before any surface query runs in the same transaction.
def wake_state_sql(+session: String) -> String:
  "json_object('pending',CASE WHEN " ++ stopped_session_sql(session) ++ " OR " ++ task_closed_sql(session) ++ " THEN 0 ELSE (SELECT count(*) FROM messages WHERE recipient=" ++ session ++ " AND " ++ owed_sql("messages") ++ ") END,'claim',coalesce((SELECT state FROM wake_claims WHERE session=" ++ session ++ "),'') )"

def task_open_sql(+session: String) -> String:
  "((SELECT task_parent.parent FROM sessions task_parent WHERE task_parent.id=" ++ session ++ ") IS NOT NULL AND " ++ task_assignment_sql(session) ++ " IS NOT NULL AND NOT " ++ task_confirmed_sql(session) ++ " AND NOT " ++ stopped_session_sql(session) ++ ")"

def task_state_sql(+session: String) -> String:
  "json_object('assignmentId',(SELECT id FROM messages WHERE seq=" ++ task_assignment_sql(session) ++ "),'coordinator'," ++ current_coordinator_sql(session) ++ ",'requestId'," ++ task_request_sql(session) ++ ",'confirmed',json(CASE WHEN " ++ task_confirmed_sql(session) ++ " THEN 'true' ELSE 'false' END),'open',json(CASE WHEN " ++ task_open_sql(session) ++ " THEN 'true' ELSE 'false' END),'ended',json(CASE WHEN " ++ task_ended_sql(session) ++ " THEN 'true' ELSE 'false' END))"

# A current completion request delivers the finished work to its coordinator.
# Further input wakes the worker; a newer assignment can generate continuation.
# A normal terminal with no other input uses this continuation to keep an open
# assignment active and remind the worker to request completion.
def task_continuation_sql(+session: String, +id: String) -> String:
  "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id ++ ":task-continuation") ++ ",worker.id,worker.id,'task-continuation','Continue assignment ' || (SELECT id FROM messages WHERE seq=" ++ task_assignment_sql("worker.id") ++ ") || '. Review the complete stored assignment and current inbox, and carry out the coordinator-authorized work. Before ending this turn, use completion-request --text SUMMARY to request the conductor completion decision. Explicit operator stops remain effective.' FROM sessions worker WHERE worker.id=" ++ q(session) ++ " AND " ++ task_open_sql("worker.id") ++ " AND " ++ task_request_sql("worker.id") ++ " IS NULL AND NOT EXISTS(SELECT 1 FROM messages owed WHERE owed.recipient=worker.id AND " ++ owed_sql("owed") ++ ");"

def session_state_sql(+session: String) -> String:
  "json_patch(coalesce((SELECT json_object('stop',json_object('id',id,'reason',reason,'status',outcome,'attempt',nullif(attempt,''),'requestedSignal',CASE WHEN attempt='' THEN NULL ELSE signal END,'submittedSignal',nullif(applied_signal,0),'controlError',nullif(control_error,''),'nativeStatus',nullif(native_status,''),'reportId',nullif(report_id,''))) FROM session_stops WHERE session=" ++ session ++ "),json('{}'))"
  ++ ",json_object('blockedCause',CASE WHEN NOT " ++ stopped_session_sql(session) ++ " AND " ++ task_closed_sql(session) ++ " THEN 'assignment-ended' ELSE " ++ blocked_cause_sql(session) ++ " END,'blockedOwner'," ++ blocked_owner_sql(session) ++ ",'wake'," ++ wake_state_sql(session) ++ "))"

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
  "SELECT json_patch(json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'endpointArgv'," ++ endpoint_argv("endpoint") ++ ",'workspace',workspace,'branch',branch,'base',base,'kind'," ++ session_kind("sessions.id") ++ ",'role'," ++ public_role("sessions.id") ++ ",'taskCompletion'," ++ task_state_sql("sessions.id") ++ ")," ++ session_state_sql("sessions.id") ++ ") FROM sessions WHERE " ++ condition ++ ";"

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
# An effort-only same-route save preserves the existing endpoint. Explicit
# --command and --output-log rebind it. A command without a log is refused; a
# log without a command preserves the recorded endpoint.
# The expected route identifies the session configuration being changed.
# The predicate is a subquery so it also stands in a SELECT with no FROM clause,
# which is where the refusal answer is built.
def configure_matches(session: String, harness: String, model: String, effort: String) -> String:
  "EXISTS(SELECT 1 FROM sessions WHERE id=" ++ q(session) ++ " AND harness=" ++ q(harness) ++ " AND model=" ++ q(model) ++ " AND effort=" ++ q(effort) ++ ")"

def configure_admitted(+session: String, +harness: String, +model: String, +endpoint: String, +expected_harness: String, +expected_model: String, expected_effort: String) -> String:
  "(" ++ q(harness) ++ " IN ('codex','omp','muse','claude-code','dsh','antigravity') AND " ++ q(model) ++ "<>'' AND " ++ configure_matches(session,expected_harness,expected_model,expected_effort)
  ++ " AND (" ++ q(endpoint) ++ "='' OR " ++ endpoint_admitted(endpoint) ++ ")"
  ++ " AND ((" ++ q(harness) ++ "=" ++ q(expected_harness) ++ " AND " ++ q(model) ++ "=" ++ q(expected_model) ++ ") OR (NOT " ++ stopped_session_sql(q(session))
  ++ " AND NOT EXISTS(SELECT 1 FROM executions WHERE session=" ++ q(session) ++ " AND phase<>'exited')"
  ++ " AND " ++ endpoint_admitted(endpoint) ++ ")))"

def configure_update_sql(+session: String, +harness: String, +model: String, +effort: String, +endpoint: String, +expected_harness: String, +expected_model: String, expected_effort: String, +admitted: String) -> String:
  "UPDATE sessions SET harness=" ++ q(harness) ++ ",model=" ++ q(model) ++ ",effort=" ++ q(effort) ++ ",endpoint=CASE WHEN " ++ q(endpoint) ++ "<>'' THEN " ++ q(endpoint) ++ " WHEN " ++ q(harness) ++ "=" ++ q(expected_harness) ++ " AND " ++ q(model) ++ "=" ++ q(expected_model) ++ " THEN endpoint ELSE " ++ q(endpoint) ++ " END WHERE id=" ++ q(session) ++ " AND " ++ admitted ++ ";"
  ++ "SELECT json_object('error','configure-refused','session'," ++ q(session) ++ ",'expected',json_object('harness'," ++ q(expected_harness) ++ ",'model'," ++ q(expected_model) ++ ",'effort'," ++ q(expected_effort) ++ "),'requested',json_object('harness'," ++ q(harness) ++ ",'model'," ++ q(model) ++ ",'effort'," ++ q(effort) ++ "),'condition','Configuration requires the recorded harness, model and effort to match the expected route. Saving effort on the same harness and model preserves the receiver, current attempt and stop. A same-route --command with --output-log rebinds the endpoint; --command without --output-log is refused; --output-log without --command preserves the recorded endpoint. Changing harness or model requires a launchable receiver, no owned attempt and no stop.','next','Read session ID and pass its recorded harness, model and effort as the expected route. Change provider after the current attempt exits. Resume SESSION --lift-stop explicitly lifts a stop.') WHERE changes()=0;"
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

# An input detail keeps the exact stored message and its delivered/read state
# beside current recipient state. Historical wake outcomes and the ordinary
# input-to-attempt relation are not stored, so both remain explicit unknowns.
def input_detail_row() -> String:
  "json_object('message',json_patch(" ++ delivery_row() ++ ",json_object('seq',m.seq))"
  ++ ",'admission',json_object('status','admitted','sequence',m.seq)"
  ++ ",'handling',json_object('status',CASE WHEN " ++ read_sql("m") ++ " THEN 'read' ELSE 'pending' END,'owner',m.recipient,'receipt',m.receipt)"
  ++ ",'wake',json_object('historicalStatus','unrecorded','condition','Historical per-input wake outcomes are not stored.','current'," ++ wake_state_sql("s.id") ++ ")"
  ++ ",'recipientCurrent',json_patch(json_object('scope','current','id',s.id,'parent',s.parent,'role'," ++ public_role("s.id") ++ ",'route',json_object('harness',s.harness,'native',s.native,'endpoint',s.endpoint,'endpointArgv'," ++ endpoint_argv("s.endpoint") ++ "),'execution',(SELECT json_object('attempt',id,'mode',mode,'directory',directory,'phase',phase,'status',status,'qualification','recorded') FROM executions WHERE session=s.id),'taskCompletion'," ++ task_state_sql("s.id") ++ ")," ++ session_state_sql("s.id") ++ ")"
  ++ ",'attemptRelation',json_object('status','unrecorded','condition','No durable input-to-attempt relation is stored for ordinary retained input. The recipient current execution is a current-state reference.')"
  ++ ",'reads',json_object('message',json_array('delivery',m.id),'recipient',json_array('player',m.recipient),'roster',json_array('players'),'turns',json_array('turns',m.recipient),'inbox',json_array('inbox',m.recipient,'--index','--state','all')))"

def message_index_sql(source: String, condition: String, state: String) -> String:
  "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('seq',m.seq,'id',m.id,'sender',m.sender,'recipient',m.recipient,'kind',m.kind,'receipt',m.receipt)," ++ input_state_sql("m") ++ ") AS item FROM " ++ source ++ " WHERE " ++ state ++ " AND " ++ condition ++ " ORDER BY m.seq);"

def terminal_expr(+event: String) -> String:
  "(json_extract(" ++ event ++ ",'$.payload.kind')='run_terminal' OR json_extract(" ++ event ++ ",'$.type')='result' OR (json_extract(" ++ event ++ ",'$.type')='agent_end' AND coalesce(json_extract(" ++ event ++ ",'$.isTerminal'),1)=1))"

def terminal(+event: String) -> String:
  "(SELECT " ++ terminal_expr("native_frame.value") ++ " FROM (SELECT " ++ q(event) ++ " AS value) native_frame)"

def terminal_span(+event: String) -> String:
  "(SELECT " ++ terminal_expr("native_frame.value") ++ " FROM (SELECT " ++ event ++ " AS value) native_frame)"

# A child reports to its current coordinator: the recorded parent while that
# parent is not over, else the parent's recorded successor or the nearest
# ancestor that is not over, else the registered operator. A parentless
# Conductor reports to the registered operator when that session has the
# explicit operator responsibility.
def report_recipient(+session: String) -> String:
  "(SELECT CASE WHEN report_sender.parent IS NOT NULL THEN " ++ coordinator_sql("report_sender.id") ++ " WHEN " ++ assigned_role("report_sender.id") ++ "='conductor' THEN " ++ operator_destination_sql() ++ " END FROM sessions report_sender WHERE report_sender.id=" ++ session ++ ")"

# The recorded continuation identifies the turn-end outcome sent to the coordinator.
def open_assignment_report_sql(+id: String, +session: String) -> String:
  "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id ++ ":assignment") ++ ",worker.id," ++ report_recipient("worker.id") ++ ",'report','Turn ' || " ++ q(id) ++ " || ' ended with assignment ' || (SELECT id FROM messages WHERE seq=" ++ task_assignment_sql("worker.id") ++ ") || ' still open. ' || worker.id || ' sent no completion request. Baton queued continuation ' || continuation.id || ' to continue the assignment and request completion. Review the worker report and send guidance for any remaining work.' FROM sessions worker JOIN messages continuation ON continuation.id=" ++ q(id ++ ":task-continuation") ++ " AND continuation.sender=worker.id AND continuation.recipient=worker.id AND continuation.kind='task-continuation' WHERE worker.id=" ++ q(session) ++ " AND " ++ report_recipient("worker.id") ++ " IS NOT NULL AND " ++ task_open_sql("worker.id") ++ " AND " ++ task_request_sql("worker.id") ++ " IS NULL;"

# A settled turn records its continuation and the coordinator report together.
def task_settlement_sql(+session: String, +id: String) -> String:
  "BEGIN IMMEDIATE;" ++ task_continuation_sql(session,id) ++ open_assignment_report_sql(id,session) ++ "COMMIT;"

def last_assistant_sql(+event: String) -> String:
  "(SELECT " ++ last_assistant_sql_expr("native_frame.value") ++ " FROM (SELECT " ++ q(event) ++ " AS value) native_frame)"

def omp_terminal_error_sql(+event: String) -> String:
  "(SELECT " ++ omp_terminal_error_sql_expr("native_frame.value") ++ " FROM (SELECT " ++ q(event) ++ " AS value) native_frame)"

# The report carries the observed provider status and diagnostic. The native
# log retains the complete terminal frame.
def omp_terminal_error_text_sql_expr(+event: String) -> String:
  "CASE WHEN json_valid(" ++ event ++ ") THEN CASE WHEN json_extract(" ++ event ++ ",'$.type')='agent_end' THEN (SELECT 'OMP provider failure: stopReason=error, errorStatus=' || coalesce(CAST(json_extract(m.value,'$.errorStatus') AS TEXT),'unknown') || '; ' || coalesce(json_extract(m.value,'$.errorMessage'),'the retained frame carries no provider diagnostic') FROM (SELECT " ++ last_assistant_sql_expr(event) ++ " AS value) m WHERE json_extract(m.value,'$.stopReason')='error') END END"

def omp_terminal_error_text_sql(+event: String) -> String:
  "(SELECT " ++ omp_terminal_error_text_sql_expr("native_frame.value") ++ " FROM (SELECT " ++ q(event) ++ " AS value) native_frame)"

def assistant_text_sql_expr(+event: String) -> String:
  "(SELECT group_concat(CASE WHEN c.type='object' THEN json_extract(c.value,'$.text') END,char(10)) FROM json_each(CASE WHEN json_type(" ++ last_assistant_sql_expr(event) ++ ",'$.content')='array' THEN json_extract(" ++ last_assistant_sql_expr(event) ++ ",'$.content') ELSE '[]' END) c WHERE CASE WHEN c.type='object' THEN json_extract(c.value,'$.type') END='text')"

def terminal_body_expr(+event: String) -> String:
  "coalesce(" ++ omp_terminal_error_text_sql_expr(event) ++ ",CASE WHEN json_extract(" ++ event ++ ",'$.is_error')=1 OR (json_extract(" ++ event ++ ",'$.payload.kind')='run_terminal' AND json_extract(" ++ event ++ ",'$.payload.terminal')<>'completed') THEN " ++ event ++ " ELSE coalesce(json_extract(" ++ event ++ ",'$.result'),CASE WHEN json_extract(" ++ event ++ ",'$.payload.kind')='run_terminal' THEN json_extract(" ++ event ++ ",'$.payload.text') END," ++ assistant_text_sql_expr(event) ++ "," ++ event ++ ") END)"

# Identity and model frames update the session only when the attempt ran under the
# session's configured harness. A replayed frame of an earlier harness, after a route
# change, matches no row, so it cannot write its conversation id back to the session.
def observe_identity_sql_expr(+player: String, +event: String, +harness: String) -> String:
  "UPDATE sessions SET native=coalesce(CASE WHEN json_extract(" ++ event ++ ",'$.type')='response' AND json_extract(" ++ event ++ ",'$.command')='get_state' AND json_extract(" ++ event ++ ",'$.success')=1 THEN json_extract(" ++ event ++ ",'$.data.sessionId') END,CASE WHEN json_extract(" ++ event ++ ",'$.type')='thread.started' THEN json_extract(" ++ event ++ ",'$.thread_id') END,json_extract(" ++ event ++ ",'$.session_id'),CASE WHEN json_extract(" ++ event ++ ",'$.type')='session' THEN json_extract(" ++ event ++ ",'$.id') END,CASE WHEN json_extract(" ++ event ++ ",'$.stream.kind')='session' THEN json_extract(" ++ event ++ ",'$.stream.id') END,native),observed_model=coalesce(CASE WHEN json_extract(" ++ event ++ ",'$.type')='response' AND json_extract(" ++ event ++ ",'$.command')='get_state' AND json_extract(" ++ event ++ ",'$.success')=1 THEN json_extract(" ++ event ++ ",'$.data.model.provider') || '/' || json_extract(" ++ event ++ ",'$.data.model.id') END,CASE WHEN json_extract(" ++ event ++ ",'$.payload_type')='run.model.configured' THEN json_extract(" ++ event ++ ",'$.payload.model_id') END,CASE WHEN json_extract(" ++ event ++ ",'$.message.provider') IS NOT NULL AND json_extract(" ++ event ++ ",'$.message.model') IS NOT NULL THEN json_extract(" ++ event ++ ",'$.message.provider') || '/' || json_extract(" ++ event ++ ",'$.message.model') END,json_extract(" ++ event ++ ",'$.message.model'),json_extract(" ++ event ++ ",'$.model'),observed_model) WHERE id=" ++ q(player) ++ " AND harness=" ++ q(harness) ++ ";"

# Completion record for issue #685. Every terminal observation records its
# completion report and turn row. The answer carries the pending-input
# reconciliation state, counted over unread input on unstopped
# sessions.
def completion_pending_sql(+player: String) -> String:
  "(SELECT count(*) FROM messages WHERE recipient=" ++ q(player) ++ " AND " ++ owed_sql("messages") ++ " AND NOT " ++ stopped_session_sql(q(player)) ++ " AND NOT " ++ task_closed_sql(q(player)) ++ ")"

def completion_oldest_sql(+player: String) -> String:
  "(SELECT id FROM messages WHERE recipient=" ++ q(player) ++ " AND " ++ owed_sql("messages") ++ " AND NOT " ++ stopped_session_sql(q(player)) ++ " AND NOT " ++ task_closed_sql(q(player)) ++ " ORDER BY seq LIMIT 1)"

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

def observe_sql(+id: String, +player: String, +event: String, sealed: Bool, +harness: String) -> String:
  observation_frame_sql(event)
  ++ observe_identity_sql_expr(player,observation_frame(),harness)
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
  "(" ++ peers(sender,recipient) ++ " AND " ++ assigned_role(sender) ++ "<>'operator' AND " ++ assigned_role(recipient) ++ "<>'operator' AND EXISTS(SELECT 1 FROM ensembles e WHERE e.coupling='tight' AND (e.owner=" ++ sender ++ " OR EXISTS(SELECT 1 FROM ensemble_members a WHERE a.ensemble=e.id AND a.session=" ++ sender ++ ")) AND (e.owner=" ++ recipient ++ " OR EXISTS(SELECT 1 FROM ensemble_members b WHERE b.ensemble=e.id AND b.session=" ++ recipient ++ "))))"

def operator_route(+sender: String, +recipient: String) -> String:
  "((" ++ assigned_role(sender) ++ "='operator' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ recipient ++ " AND (parent=" ++ sender ++ " OR (parent IS NULL AND " ++ assigned_role(recipient) ++ "='conductor')))) OR (" ++ assigned_role(recipient) ++ "='operator' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ sender ++ " AND (parent=" ++ recipient ++ " OR (parent IS NULL AND " ++ assigned_role(sender) ++ "='conductor')))))"

# A worker and its current coordinator may message each other: the parent that
# is not over, a recorded successor, the nearest ancestor that is not over, or
# the registered operator when every ancestor is over.
def coordinated_route(+sender: String, +recipient: String) -> String:
  "(coalesce(" ++ recipient ++ "=" ++ current_coordinator_sql(sender) ++ ",0) OR coalesce(" ++ sender ++ "=" ++ current_coordinator_sql(recipient) ++ ",0))"

def message_route(+sender: String, +recipient: String) -> String:
  "(EXISTS(SELECT 1 FROM sessions WHERE id=" ++ sender ++ ") AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ recipient ++ ") AND " ++ sender ++ "<>" ++ recipient ++ " AND ((" ++ assigned_role(sender) ++ "<>'operator' AND " ++ assigned_role(recipient) ++ "<>'operator' AND (coalesce((SELECT parent FROM sessions WHERE id=" ++ sender ++ ")=" ++ recipient ++ ",0) OR coalesce((SELECT parent FROM sessions WHERE id=" ++ recipient ++ ")=" ++ sender ++ ",0) OR (" ++ assigned_role(sender) ++ "='conductor' AND " ++ descendant(sender,recipient) ++ ") OR " ++ tight_peers(sender,recipient) ++ ")) OR " ++ operator_route(sender,recipient) ++ " OR " ++ coordinated_route(sender,recipient) ++ "))"

def exact_message(+id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> String:
  "EXISTS(SELECT 1 FROM messages WHERE id=" ++ q(id) ++ " AND sender=" ++ q(sender) ++ " AND recipient=" ++ q(recipient) ++ " AND kind=" ++ q(kind) ++ " AND body=" ++ q(body) ++ ")"

def matching_message_result(+id: String, sender: String, recipient: String, kind: String, body: String) -> String:
  "SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt)," ++ input_state_sql("messages") ++ ") FROM messages WHERE id=" ++ q(id) ++ " AND " ++ exact_message(id,sender,recipient,kind,body) ++ ";"

# The stored row answers only an exact replay; a derived recipient arrives as an
# SQL expression rather than a value.
def matching_message_result_expr(+id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> String:
  "SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body,'receipt',receipt)," ++ input_state_sql("messages") ++ ") FROM messages WHERE id=" ++ id ++ " AND EXISTS(SELECT 1 FROM messages WHERE id=" ++ id ++ " AND sender=" ++ sender ++ " AND recipient=" ++ recipient ++ " AND kind=" ++ kind ++ " AND body=" ++ body ++ ");"

# The guard is an extra condition on a first write. An exact replay of a stored
# message passes the insert's own conflict handling whatever the guard says.
def message_guarded_sql(+id: String, +sender: String, +recipient: String, +kind: String, +body: String, +guard: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id) ++ "," ++ q(sender) ++ "," ++ q(recipient) ++ "," ++ q(kind) ++ "," ++ q(body) ++ " WHERE ((" ++ message_route(q(sender),q(recipient)) ++ " AND NOT (" ++ stopped_session_sql(q(recipient)) ++ " AND " ++ execution_input_sql(q(kind)) ++ ")) OR " ++ exact_message(id,sender,recipient,kind,body) ++ ") AND " ++ guard ++ message_upsert() ++ message_conflict_sql(q(id),q(sender),q(recipient),q(kind),q(body),"1")
  ++ "SELECT json_object('error','message-route-denied','sender'," ++ q(sender) ++ ",'recipient'," ++ q(recipient) ++ ",'condition','Use an immediate parent, a conductor descendant route, an explicitly tight Ensemble peer, or the operator and top-level conductor route.','next','Inspect session roles and Ensemble membership; send through your immediate conductor when a direct route is unavailable.') WHERE NOT " ++ message_route(q(sender),q(recipient)) ++ " AND NOT " ++ exact_message(id,sender,recipient,kind,body) ++ ";"
  ++ "SELECT json_object('error','session-stopped','session'," ++ q(recipient) ++ ") WHERE NOT " ++ exact_message(id,sender,recipient,kind,body) ++ " AND " ++ message_route(q(sender),q(recipient)) ++ " AND " ++ stopped_session_sql(q(recipient)) ++ " AND " ++ execution_input_sql(q(kind)) ++ ";" ++ matching_message_result(id,sender,recipient,kind,body)

# Input the session owes or has not resolved: unread messages addressed to it,
# and the current completion request of a worker that was read but not
# confirmed. The owner and the successor are SQL values; the row names a
# messages alias.
def unresolved_input_sql(+row: String, +owner: String, +successor: String) -> String:
  "(" ++ row ++ ".recipient=" ++ owner ++ " AND " ++ row ++ ".sender<>" ++ row ++ ".recipient AND " ++ row ++ ".sender<>" ++ successor ++ " AND " ++ row ++ ".kind NOT IN ('succession','completion-confirmed','task-continuation') AND (" ++ owed_sql(row) ++ " OR (" ++ row ++ ".kind='completion-request' AND " ++ row ++ ".id=coalesce(" ++ task_request_sql(row ++ ".sender") ++ ",'') AND NOT " ++ task_confirmed_sql(row ++ ".sender") ++ ")))"

# A session that ended with live children or unresolved input is reported to
# its current coordinator. The report identity follows the ending action, so a
# repeated action adds no second report. The statement sequence stages the
# children and the input in temporary tables of its own transaction.
def ended_report_sql(+session: String, +key: String, +reason: String) -> String:
  +ended = q(session)
  "DROP TABLE IF EXISTS temp.baton_ended_children;DROP TABLE IF EXISTS temp.baton_ended_input;CREATE TEMP TABLE baton_ended_children(id TEXT NOT NULL);CREATE TEMP TABLE baton_ended_input(id TEXT NOT NULL);"
  ++ "INSERT INTO temp.baton_ended_children SELECT live_child.id FROM sessions live_child WHERE live_child.parent=" ++ ended ++ " AND " ++ session_over_sql(ended) ++ " AND NOT " ++ session_over_sql("live_child.id") ++ " ORDER BY live_child.id;"
  ++ "INSERT INTO temp.baton_ended_input SELECT pending.id FROM messages pending WHERE " ++ session_over_sql(ended) ++ " AND " ++ unresolved_input_sql("pending",ended,"''") ++ " ORDER BY pending.seq;"
  ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ q("ended:" ++ key) ++ ",ended_session.id," ++ report_recipient("ended_session.id") ++ ",'report',json_object('type','session-ended','session',ended_session.id,'reason'," ++ q(reason)
  ++ ",'liveChildren',json((SELECT json_group_array(id) FROM temp.baton_ended_children)),'unresolvedInput',json((SELECT json_group_array(id) FROM temp.baton_ended_input))"
  ++ ",'next','Run succeed --from ' || ended_session.id || ' as the replacement conductor to inherit its children and receive its unresolved input, or assign or stop the children.') FROM sessions ended_session WHERE ended_session.id=" ++ ended ++ " AND " ++ report_recipient("ended_session.id") ++ " IS NOT NULL AND (EXISTS(SELECT 1 FROM temp.baton_ended_children) OR EXISTS(SELECT 1 FROM temp.baton_ended_input));"
  ++ "DROP TABLE temp.baton_ended_children;DROP TABLE temp.baton_ended_input;"

# The kind succession is recorded only by the succession action, which names
# the predecessor and the successor and checks both.
def reserved_kind_sql(+id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> String:
  "SELECT json_object('error','message-route-denied','sender'," ++ q(sender) ++ ",'recipient'," ++ q(recipient) ++ ",'condition','The kind succession is recorded only by the succeed action.','next','Run succeed --from PREDECESSOR as the successor.') WHERE NOT " ++ exact_message(id,sender,recipient,kind,body) ++ ";" ++ matching_message_result(id,sender,recipient,kind,body)

# A confirmation that ends the Player reports its live children and unresolved
# input to the Player's current coordinator, in the confirmation transaction.
def message_sql(+id: String, +sender: String, +recipient: String, +kind: String, +body: String) -> String:
  Bool.pick(String,String.eq(kind,"succession"),reserved_kind_sql(id,sender,recipient,kind,body),
    message_guarded_sql(id,sender,recipient,kind,body,"1") ++ Bool.pick(String,String.eq(kind,"completion-confirmed"),ended_report_sql(recipient,id,"completion"),""))

# The decision that confirms a request and dispatches the next assignment is one
# transaction. Both writes pass the ordinary route and stop admission, so a
# stored confirmation never lets a new task past an explicit stop.
# The confirmation is written when the derived task identity is free or holds
# the same task, and the request is the Player's current request or the whole
# decision (both rows) is already stored. The task is written when the exact
# confirmation is stored and the request is still current or the exact task is
# already stored. A stored confirmation alone therefore never admits a task
# after a newer assignment replaced its request. A conflict admits neither
# message, and a repeat of the whole decision stores nothing new.
def confirm_next_current(+recipient: String, +request: String) -> String:
  "(" ++ q(request) ++ "=coalesce(" ++ task_request_sql(q(recipient)) ++ ",''))"

def confirm_next_guard(+id: String, +sender: String, +recipient: String, +request: String, +task_id: String, +task: String) -> String:
  "NOT EXISTS(SELECT 1 FROM messages WHERE id=" ++ q(task_id) ++ " AND NOT " ++ exact_message(task_id,sender,recipient,"task",task) ++ ") AND (" ++ confirm_next_current(recipient,request) ++ " OR (" ++ exact_message(id,sender,recipient,"completion-confirmed",request) ++ " AND " ++ exact_message(task_id,sender,recipient,"task",task) ++ "))"

def confirm_next_task_guard(+id: String, +sender: String, +recipient: String, +request: String, +task_id: String, +task: String) -> String:
  exact_message(id,sender,recipient,"completion-confirmed",request) ++ " AND (" ++ confirm_next_current(recipient,request) ++ " OR " ++ exact_message(task_id,sender,recipient,"task",task) ++ ")"

def confirm_next_refused_sql(+id: String, +sender: String, +recipient: String, +request: String, +task_id: String, +task: String) -> String:
  "SELECT json_object('error','completion-decision-refused','request'," ++ q(request) ++ ",'task'," ++ q(task_id) ++ ",'condition','The completion request is not the Player current request and the whole decision is not stored, or an identity holds different content. Nothing was recorded.','next','Read the Player assignment; confirm its current request, or replay the exact decision.') WHERE NOT (" ++ exact_message(id,sender,recipient,"completion-confirmed",request) ++ " AND " ++ exact_message(task_id,sender,recipient,"task",task) ++ ");"

def confirm_next_sql(+id: String, +sender: String, +recipient: String, +request: String, +task_id: String, +task: String) -> String:
  message_guarded_sql(id,sender,recipient,"completion-confirmed",request,confirm_next_guard(id,sender,recipient,request,task_id,task))
  ++ message_guarded_sql(task_id,sender,recipient,"task",task,confirm_next_task_guard(id,sender,recipient,request,task_id,task))
  ++ confirm_next_refused_sql(id,sender,recipient,request,task_id,task)

def parent_message_sql(+id: String, +sender: String, +kind: String, +body: String) -> String:
  +recipient = report_recipient(q(sender))
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ q(id) ++ "," ++ q(sender) ++ "," ++ recipient ++ "," ++ q(kind) ++ "," ++ q(body) ++ " WHERE " ++ recipient ++ " IS NOT NULL" ++ message_upsert()
  ++ message_conflict_sql(q(id),q(sender),recipient,q(kind),q(body),recipient ++ " IS NOT NULL")
  ++ "SELECT json_object('error','report-recipient-missing','sender'," ++ q(sender) ++ ",'kind'," ++ q(kind) ++ ",'condition','The session has no recorded parent that is not over and no registered operator report recipient.','next','Read session SENDER. Reports go to its recorded parent, that parent successor or the nearest ancestor that is not over, else the registered operator session; a parentless Conductor reports to the registered operator session with the operator role.') WHERE " ++ recipient ++ " IS NULL;"
  ++ matching_message_result_expr(q(id),q(sender),recipient,q(kind),q(body))

def succession_record_id(+predecessor: String, +successor: String) -> String:
  "succession:" ++ predecessor ++ ":" ++ successor

def succession_admitted(+successor: String, +predecessor: String) -> String:
  "(" ++ successor ++ "<>" ++ predecessor ++ " AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ successor ++ ") AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ predecessor ++ ") AND " ++ session_over_sql(predecessor) ++ " AND NOT " ++ session_over_sql(successor)
  ++ " AND ((SELECT parent FROM sessions WHERE id=" ++ successor ++ ") IS (SELECT parent FROM sessions WHERE id=" ++ predecessor ++ ") OR " ++ descendant(successor,predecessor) ++ ") AND NOT " ++ descendant(predecessor,successor)
  ++ " AND NOT EXISTS(SELECT 1 FROM messages other_succession WHERE other_succession.kind='succession' AND other_succession.recipient=" ++ predecessor ++ " AND other_succession.sender<>" ++ successor ++ "))"

def succession_recorded(+successor: String, +predecessor: String) -> String:
  "EXISTS(SELECT 1 FROM messages recorded_succession WHERE recorded_succession.id=" ++ q(succession_record_id(predecessor,successor)) ++ " AND recorded_succession.kind='succession' AND recorded_succession.sender=" ++ q(successor) ++ " AND recorded_succession.recipient=" ++ q(predecessor) ++ ")"

def forwarded_prefix(+predecessor: String, +successor: String) -> String:
  "forward:" ++ predecessor ++ ":" ++ successor ++ ":"

# The successor takes over a session that is over. Baton records the
# succession and forwards each unresolved input of the predecessor to the
# successor as a new message that carries the complete original text and names
# the original message. Original messages, their recipients, read states and
# the children's assignments and completion requests stay as recorded; the
# successor then holds the coordinator authority for them. Repeating the action
# forwards only input that arrived since.
def succession_sql(+successor: String, +predecessor: String) -> String:
  +s = q(successor)
  +p = q(predecessor)
  +record = q(succession_record_id(predecessor,successor))
  +prefix = q(forwarded_prefix(predecessor,successor))
  "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ record ++ "," ++ s ++ "," ++ p ++ ",'succession',json_object('type','conductor-succession','predecessor'," ++ p ++ ",'successor'," ++ s ++ ") WHERE " ++ succession_admitted(s,p) ++ " ON CONFLICT(id) DO NOTHING;"
  ++ "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ prefix ++ " || forwarded.id,forwarded.sender," ++ s ++ ",'forwarded-input','Forwarded from ' || " ++ p ++ " || ' by conductor succession ' || " ++ record ++ " || ': message ' || forwarded.id || ' (' || forwarded.kind || ') from ' || forwarded.sender || char(10) || forwarded.body || CASE WHEN forwarded.kind='completion-request' THEN char(10) || 'This request is still the current completion request of ' || forwarded.sender || ' and is unconfirmed. Review the work against its assignment and use completion-confirmed --to ' || forwarded.sender || ' when it is satisfied, or guide --to ' || forwarded.sender || ' --text TEXT.' ELSE '' END FROM messages forwarded WHERE " ++ succession_recorded(successor,predecessor) ++ " AND " ++ unresolved_input_sql("forwarded",p,s) ++ " ON CONFLICT(id) DO NOTHING;"
  ++ "SELECT json_object('error','succession-refused','successor'," ++ s ++ ",'predecessor'," ++ p ++ ",'condition','Succession requires a registered predecessor that is over (explicitly stopped or completed), a different registered successor that is not over and is under the predecessor parent or an ancestor of the predecessor, and no other recorded successor of the predecessor.','next','Stop the predecessor with stop --session PREDECESSOR, then run succeed --from PREDECESSOR as the successor.') WHERE NOT " ++ succession_recorded(successor,predecessor) ++ ";"
  ++ "SELECT json_object('predecessor'," ++ p ++ ",'successor'," ++ s ++ ",'record'," ++ record ++ ",'forwarded',json((SELECT json_group_array(forwarded_input.id) FROM messages forwarded_input WHERE forwarded_input.recipient=" ++ s ++ " AND forwarded_input.kind='forwarded-input' AND substr(forwarded_input.id,1,length(" ++ prefix ++ "))=" ++ prefix ++ "))) WHERE " ++ succession_recorded(successor,predecessor) ++ ";"

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

def ensemble_member_result_sql(+id: String, +owner: String, +session: String, +action: String) -> String:
  +accepted = "EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ ") AND ((" ++ q(action) ++ "='add' AND EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ q(id) ++ " AND session=" ++ q(session) ++ ")) OR (" ++ q(action) ++ "='remove' AND NOT EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=" ++ q(id) ++ " AND session=" ++ q(session) ++ ")))"
  "SELECT json_object('error','ensemble-member-refused','ensemble'," ++ q(id) ++ ",'owner'," ++ q(owner) ++ ",'existingOwner',(SELECT owner FROM ensembles WHERE id=" ++ q(id) ++ "),'session'," ++ q(session) ++ ",'action'," ++ q(action) ++ ",'condition','Membership requires the recorded Ensemble owner, add or remove, and an existing non-operator Player when adding.','next','Read ensemble ENSEMBLE and session PLAYER; use the recorded owner and add or remove.') WHERE NOT (" ++ accepted ++ ");"
  ++ "SELECT json_object('ensemble'," ++ q(id) ++ ",'owner'," ++ q(owner) ++ ",'session'," ++ q(session) ++ ",'membership'," ++ q(action) ++ ") WHERE " ++ accepted ++ ";"

def ensemble_member_sql(+id: String, +owner: String, +session: String, +action: String) -> String:
  "DELETE FROM ensemble_members WHERE ensemble=" ++ q(id) ++ " AND session=" ++ q(session) ++ " AND " ++ q(action) ++ "='remove' AND EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ ");"
  ++ "INSERT OR IGNORE INTO ensemble_members(ensemble,session) SELECT " ++ q(id) ++ "," ++ q(session) ++ " WHERE " ++ q(action) ++ "='add' AND EXISTS(SELECT 1 FROM ensembles WHERE id=" ++ q(id) ++ " AND owner=" ++ q(owner) ++ ") AND " ++ assigned_role(q(session)) ++ "<>'operator' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ q(session) ++ ");"
  ++ ensemble_member_result_sql(id,owner,session,action)

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
  "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',s.id,'kind'," ++ session_kind("s.id") ++ ",'role'," ++ public_role("s.id") ++ ",'parent',s.parent,'harness',s.harness,'model',s.model,'effort',s.effort,'workspace',s.workspace,'branch',s.branch,'base',s.base,'native',s.native,'observedHarness',s.observed_harness,'observedModel',s.observed_model,'observedEffort',s.observed_effort,'execution',(SELECT json_object('attempt',id,'mode',mode,'phase',phase,'status',status) FROM executions WHERE session=s.id),'lastTurnId',(SELECT t.id FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'lastTurnEvent',(SELECT coalesce(json_extract(t.event,'$.type'),json_extract(t.event,'$.payload_type')) FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'latestReport',(SELECT m.body FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'latestReportId',(SELECT m.id FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'pendingCount',(SELECT count(*) FROM messages WHERE recipient=s.id AND " ++ owed_sql("messages") ++ " AND NOT (" ++ stopped_session_sql("s.id") ++ " AND " ++ execution_input_sql("messages.kind") ++ ")),'taskCompletion'," ++ task_state_sql("s.id") ++ ")," ++ session_state_sql("s.id") ++ ") AS item FROM sessions s WHERE " ++ condition ++ " ORDER BY s.id))"

# The per-session orchestra surface, computed once per row. The item JSON is
# the players surface item over sessions s; role carries the raw assigned
# role for the players/operators split, and id carries the session identity
# for ordering. Both role arrays read this one surface through the WITH
# clause in orchestra_sql, so the enlarged session state is assembled once
# instead of once per role array.
def surface_item() -> String:
  "json_patch(json_object('id',s.id,'kind'," ++ session_kind("s.id") ++ ",'role'," ++ public_role("s.id") ++ ",'parent',s.parent,'harness',s.harness,'model',s.model,'effort',s.effort,'workspace',s.workspace,'branch',s.branch,'base',s.base,'native',s.native,'observedHarness',s.observed_harness,'observedModel',s.observed_model,'observedEffort',s.observed_effort,'execution',(SELECT json_object('attempt',id,'mode',mode,'phase',phase,'status',status) FROM executions WHERE session=s.id),'lastTurnId',(SELECT t.id FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'lastTurnEvent',(SELECT coalesce(json_extract(t.event,'$.type'),json_extract(t.event,'$.payload_type')) FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'latestReport',(SELECT m.body FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'latestReportId',(SELECT m.id FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'pendingCount',(SELECT count(*) FROM messages WHERE recipient=s.id AND " ++ owed_sql("messages") ++ " AND NOT (" ++ stopped_session_sql("s.id") ++ " AND " ++ execution_input_sql("messages.kind") ++ ")),'taskCompletion'," ++ task_state_sql("s.id") ++ ")," ++ session_state_sql("s.id") ++ ")"

def orchestra_surface() -> String:
  String.concat(["(SELECT ", surface_item(), " AS item,", assigned_role("s.id"), " AS role,s.id AS id FROM sessions s)"])

def orchestra_role_array(condition: String) -> String:
  String.concat(["(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT item FROM surface WHERE role", condition, " ORDER BY id))"])

def orchestra_sql() -> String:
  String.concat(["WITH surface AS ", orchestra_surface(), " SELECT json_object('players',", orchestra_role_array("<>'operator'"), ",'operators',", orchestra_role_array("='operator'"), ",'ensembles',(SELECT json_group_array(json(item)) FROM (SELECT ", ensemble_row("e"), " AS item FROM ensembles e ORDER BY e.id)));"])

def sql(command: Command) -> String:
  match command:
    case Succeed{+successor,+predecessor}: succession_sql(successor,predecessor)
    case TaskContinue{+session,+id}:
      task_continuation_sql(session,id) ++ "SELECT json_object('session',id,'continuationId',(SELECT id FROM messages WHERE id=" ++ q(id ++ ":task-continuation") ++ " AND recipient=" ++ q(session) ++ " AND " ++ owed_sql("messages") ++ "),'taskCompletion'," ++ task_state_sql("sessions.id") ++ ") FROM sessions WHERE id=" ++ q(session) ++ ";"
    case Observe{id,player,event,sealed,harness}: observe_sql(id,player,event,sealed,harness)
    case Attach{+id, harness, native, endpoint}:
      "INSERT INTO sessions(id,harness,native,endpoint) VALUES(" ++ q(id) ++ "," ++ q(harness) ++ "," ++ q(native) ++ "," ++ q(endpoint) ++ ") ON CONFLICT(id) DO UPDATE SET harness=excluded.harness,native=excluded.native,endpoint=excluded.endpoint WHERE sessions.parent IS NULL;"
      ++ "SELECT json_object('error','attach-parent-conflict','session',id,'parent',parent,'condition','The session is already registered with a parent.','next','Read session ID and use connect or receiver to update its native endpoint.') FROM sessions WHERE id=" ++ q(id) ++ " AND parent IS NOT NULL;"
      ++ session_result_where("id=" ++ q(id) ++ " AND parent IS NULL")
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
    case ConfirmNext{+id, +sender, +recipient, +request, +task_id, +task}:
      confirm_next_sql(id,sender,recipient,request,task_id,task)
    case Report{+id, +sender, +body}:
      parent_message_sql(id,sender,"report",body)
    case Ask{+id, +player, +body}:
      parent_message_sql(id,player,"question",body)
    case Session{id}: session_result(id)
    case Delivery{id}:
      "SELECT " ++ delivery_row() ++ " FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ q(id) ++ ";"
    case InputDetail{id}:
      "SELECT " ++ input_detail_row() ++ " FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ q(id) ++ ";"
    case Pending{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ delivery_row() ++ " AS item FROM messages m JOIN sessions s ON s.id=m.recipient WHERE " ++ owed_sql("m") ++ " ORDER BY m.seq);"
    case PendingIndex{}: message_index_sql("messages m JOIN sessions s ON s.id=m.recipient","1",owed_sql("m"))
    case Inbox{id}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',id,'sender',sender,'recipient',recipient,'kind',kind,'body',body)," ++ input_state_sql("messages") ++ ") AS item FROM messages WHERE recipient=" ++ q(id) ++ " AND " ++ owed_sql("messages") ++ " ORDER BY seq);"
    case InboxIndex{id}: message_index_sql("messages m","m.recipient=" ++ q(id),owed_sql("m"))
    case Outbox{id}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(" ++ delivery_row() ++ ",json_object('detailRead',json_array('delivery',m.id))) AS item FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.sender=" ++ q(id) ++ " ORDER BY m.seq);"
    case MessageIndex{inbox,condition,state}:
      message_index_sql(Bool.pick(String,inbox,"messages m","messages m JOIN sessions s ON s.id=m.recipient"),condition,state)
    case Status{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'endpointArgv'," ++ endpoint_argv("endpoint") ++ ",'workspace',workspace,'branch',branch,'base',base,'kind'," ++ session_kind("sessions.id") ++ ",'role'," ++ public_role("sessions.id") ++ ",'pending',(SELECT count(*) FROM messages WHERE recipient=sessions.id AND " ++ owed_sql("messages") ++ " AND NOT (" ++ stopped_session_sql("sessions.id") ++ " AND " ++ execution_input_sql("messages.kind") ++ ")),'taskCompletion'," ++ task_state_sql("sessions.id") ++ ")," ++ session_state_sql("sessions.id") ++ ") AS item FROM sessions ORDER BY id);"
    case Players{}: "SELECT " ++ players_json(assigned_role("s.id") ++ "<>'operator'") ++ ";"
    case LegacySubordinates{}:
      "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',s.id,'parent',s.parent,'harness',s.harness,'model',s.model,'effort',s.effort,'workspace',s.workspace,'branch',s.branch,'base',s.base,'native',s.native,'lastTurnId',(SELECT t.id FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'lastTurnEvent',(SELECT coalesce(json_extract(t.event,'$.type'),json_extract(t.event,'$.payload_type')) FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'latestReport',(SELECT m.body FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'latestReportId',(SELECT m.id FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'pendingCount',(SELECT count(*) FROM messages WHERE recipient=s.id AND " ++ owed_sql("messages") ++ " AND NOT (" ++ stopped_session_sql("s.id") ++ " AND " ++ execution_input_sql("messages.kind") ++ ")),'taskCompletion'," ++ task_state_sql("s.id") ++ ")," ++ session_state_sql("s.id") ++ ") AS item FROM sessions s WHERE s.parent IS NOT NULL ORDER BY s.id);"
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
    case ClearStop{session}: ""
    case ObserveFile{id,player,path}: ""
    case ReportFile{id,sender,path}: ""
    case MessageFile{id,sender,recipient,kind,path}: ""
    case MessageBatch{sender,input}: ""
    case MessageBatchFile{sender,path}: ""
    case DeliveryBatch{input}: ""
    case DeliveryBatchFile{path}: ""
    case AskFile{id,player,path}: ""
    case NativeReply{parent,id,response}: ""
    case NativeReplyFile{parent,id,path}: ""
    case Stop{session,id,reason}: ""
    case ForceStop{session,id}: ""
    case RunTurn{player,id,cmd,model,effort,cwd,task,log,session}: ""
    case Receive{session,cmd,model,effort,cwd,log,message}: ""
    case RecoverObserver{session,observer}: ""
    case Start{session,harness,cmd,model,effort,cwd,log,id,task}: ""
    case StartSetup{session,harness,cmd,model,effort,cwd,log}: ""
    case ProfileBind{session,harness,label,store}: ""
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
    case Account{action,id,provider,harness,funding,secret_ref,organization,detail,session}: ""
    case Models{session}: ""
    case ModelsAll{session}: ""
    case HarnessInventory{}: ""
    case UsageWindows{session}: ""
    case UsageWindowRefresh{session}: ""
    case Logs{session,level}: ""
    case LogsStorage{}: ""
    case StoragePolicy{}: ""
    case StoragePreview{session}: ""
    case StorageApply{session}: ""
    case StorageCollect{session}: ""
    case LogsClean{session}: ""
    case LogsCleanAll{}: ""
    case Recruit{id,parent,harness,model,effort,repo,branch,path,base}: ""
    case Join{id,parent,harness,model,effort,path}: ""
    case Worktree{id}: ""
    case KnowledgeRecord{id,author,claim,evidence,limits}: ""
    case KnowledgeRecordTyped{id,author,kind,claim,evidence,limits}: ""
    case KnowledgeRecordLinked{id,author,kind,claim,evidence,limits,links}: ""
    case KnowledgeSearch{reader,scope,subject,query}: ""
    case KnowledgeTraverse{reader,scope,subject,reference,direction,relation,recursive}: ""
    case KnowledgeRelate{id,author,source,relation,target}: ""
    case KnowledgeRead{reader}: ""
    case KnowledgeReadScope{reader,scope,subject}: ""
    case KnowledgeRelations{reader,scope,subject}: ""
    case KnowledgeIndex{reader}: ""
    case KnowledgeDetail{reader,id}: ""
    case KnowledgeScopeIndex{reader,scope,subject}: ""
    case KnowledgeScopeDetail{reader,scope,subject,id}: ""
    case KnowledgePromote{id,promoter,source,destination,finding}: ""
    case KnowledgePromoteScoped{id,promoter,source_kind,source,destination_kind,destination,finding}: ""
    case View{subject,reader,port}: ""
    case UiSubscribe{after_cursor,generation}: ""
    case ContextEngines{session}: ""
    case ContextInstall{module_id,source}: ""
    case ContextQueryFile{owner,query,path}: ""
    case ContextEval{owner,query,session,expression,frame,cwd}: ""
    case ContextResult{query}: ""
    case Stall{}: ""
    case StallWake{}: ""
    case Serve{}: ""
    case OwnerStatus{}: ""
    case Help{}: ""
    case Invalid{}: ""

def parse_verb_only(+verb: String) -> Command:
  match verb:
    case "context-engines": ContextEngines{""}
    case "logs-storage": LogsStorage{}
    case "logs-clean-all": LogsCleanAll{}
    case "storage-policy": StoragePolicy{}
    case "help": Help{}
    case "--help": Help{}
    case "status": Status{}
    case "harness-inventory": HarnessInventory{}
    case "workers": LegacySubordinates{}
    case "players": Players{}
    case "orchestra": Orchestra{}
    case "stall": Stall{}
    case "stall-wake": StallWake{}
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
    case "storage-preview": StoragePreview{id}
    case "storage-apply": StorageApply{id}
    case "storage-collect": StorageCollect{id}
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
    case "outbox": Outbox{id}
    case "session": Session{id}
    case "delivery": Delivery{id}
    case "input": InputDetail{id}
    case "delivery-batch": DeliveryBatch{id}
    case "delivery-batch-file": DeliveryBatchFile{id}
    case "worktree": Worktree{id}
    case "turns": Turns{id}
    case "project": Project{id}
    case "project-sessions": ProjectSessions{id}
    case "resume": Resume{id,False{}}
    case "clear-stop": ClearStop{id}
    case "knowledge": KnowledgeRead{id}
    case "knowledge-relations": KnowledgeRelations{id,"worker",id}
    case "observed-usage": ObservedUsage{id}
    case "models": Models{id}
    case "usage-windows": UsageWindows{id}
    case "usage-window-refresh": UsageWindowRefresh{id}
    case "view": View{id,id,"7682"}
    case _: Invalid{}

def parse_verb_session_id(+verb: String, +session: String, +id: String) -> Command:
  match verb:
    case "message-batch": MessageBatch{session,id}
    case "message-batch-file": MessageBatchFile{session,id}
    case "context-install": ContextInstall{session,id}
    case "pending": Bool.pick(Command,Bool.or(Bool.and(String.eq(session,"--index"),String.eq(id,"--pretty")),Bool.and(String.eq(session,"--pretty"),String.eq(id,"--index"))),Pretty{PendingIndex{}},Invalid{})
    case "resume": match id:
      case "--lift-stop": Resume{session,True{}}
      case "--clear-stop": ClearStop{session}
      case _: Invalid{}
    case "stop": match id:
      case "--clear": ClearStop{session}
      case _: Invalid{}
    case "models": match id:
      case "--all": ModelsAll{session}
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
    case "outbox": match id:
      case "--pretty": Pretty{Outbox{session}}
      case _: Invalid{}
    case "delivery": match id:
      case "--pretty": Pretty{Delivery{session}}
      case _: Invalid{}
    case "input": match id:
      case "--pretty": Pretty{InputDetail{session}}
      case _: Invalid{}
    case "turns": match id:
      case "--pretty": Pretty{Turns{session}}
      case _: Invalid{}
    case "knowledge": match id:
      case "--pretty": Pretty{KnowledgeRead{session}}
      case "--index": KnowledgeIndex{session}
      case _: Invalid{}
    case "knowledge-relations": match id:
      case "--pretty": Pretty{KnowledgeRelations{session,"worker",session}}
      case _: Invalid{}
    case "worktree": match id:
      case "--pretty": Pretty{Worktree{session}}
      case _: Invalid{}
    case "section": SectionRead{session,id}
    case "role": Role{session,id}
    case "ensemble": EnsembleEnsure{session,id}
    case "force-stop": ForceStop{session,id}
    case "recover-observer": RecoverObserver{session,id}
    case "continue-task": TaskContinue{session,id}
    case "succeed": Succeed{session,id}
    case "view": View{session,id,"7682"}
    case _: Invalid{}

def parse_verb_three_args(+verb: String, +id: String, +one: String, +two: String) -> Command:
  match verb:
    case "inbox": Bool.pick(Command,Bool.or(Bool.and(String.eq(one,"--index"),String.eq(two,"--pretty")),Bool.and(String.eq(one,"--pretty"),String.eq(two,"--index"))),Pretty{InboxIndex{id}},Invalid{})
    case "knowledge":
      Bool.pick(Command,String.eq(one,"--id"),KnowledgeDetail{id,two},
        Bool.pick(Command,Bool.or(Bool.and(String.eq(one,"--index"),String.eq(two,"--pretty")),Bool.and(String.eq(one,"--pretty"),String.eq(two,"--index"))),Pretty{KnowledgeIndex{id}},Invalid{}))
    case "knowledge-scope": KnowledgeReadScope{id,one,two}
    case "knowledge-relations": KnowledgeRelations{id,one,two}
    case "context-query-file": ContextQueryFile{id,one,two}
    case "receiver": Receiver{id,one,two,""}
    case "ensemble": Ensemble{id,one,two}
    case "native-reply": NativeReply{id,one,two}
    case "native-reply-file": NativeReplyFile{id,one,two}
    case "stop": Stop{id,one,two}
    case "report": Report{id,one,two}
    case "report-file": ReportFile{id,one,two}
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
    case "profile-bind": ProfileBind{id,one,two,three}
    case "knowledge-search": KnowledgeSearch{id,one,two,three}
    case "knowledge":
      Bool.pick(Command,Bool.and(String.eq(one,"--id"),String.eq(three,"--pretty")),Pretty{KnowledgeDetail{id,two}},
        Bool.pick(Command,Bool.and(String.eq(one,"--pretty"),String.eq(two,"--id")),Pretty{KnowledgeDetail{id,three}},Invalid{}))
    case "knowledge-scope":
      Bool.pick(Command,String.eq(three,"--index"),KnowledgeScopeIndex{id,one,two},
        Bool.pick(Command,String.eq(three,"--pretty"),Pretty{KnowledgeReadScope{id,one,two}},Invalid{}))
    case "knowledge-relations":
      Bool.pick(Command,String.eq(three,"--pretty"),Pretty{KnowledgeRelations{id,one,two}},Invalid{})
    case "receiver": Receiver{id,one,two,three}
    case "section": Section{id,one,two,three}
    case "ensemble-member": EnsembleMember{id,one,two,three}
    case "attach": Attach{id,one,two,three}
    case _: Invalid{}

def parse_verb_five_args(+verb: String, +id: String, +one: String, +two: String, +three: String, +four: String) -> Command:
  match verb:
    case "knowledge-search":
      Bool.pick(Command,String.eq(four,"--pretty"),Pretty{KnowledgeSearch{id,one,two,three}},Invalid{})
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
    case "start-setup": StartSetup{session,cmd,model,effort,cwd,log,message}
    case "receive": Receive{session,cmd,model,effort,cwd,log,message}
    case "promote-scoped": KnowledgePromoteScoped{session,cmd,model,effort,cwd,log,message}
    case _: Invalid{}

def parse_verb_nine_args(+verb: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String) -> Command:
  match verb:
    case "configure": Configure{player,id,cmd,model,effort,cwd,task,log,session}
    case "account": Account{player,id,cmd,model,effort,cwd,task,log,session}
    case "start": Start{player,id,cmd,model,effort,cwd,task,log,session}
    case "turn": RunTurn{player,id,cmd,model,effort,cwd,task,log,session}
    case "recruit": Recruit{player,id,cmd,model,effort,cwd,task,log,session}
    case _: Invalid{}

def parse_basic_seven(+verb: String, +one: String, +two: String, +three: String, +four: String, +five: String, +six: String) -> Command:
  match verb:
    case "knowledge-scope":
      Bool.pick(Command,Bool.and(String.eq(four,"--id"),String.eq(six,"--pretty")),
        Pretty{KnowledgeScopeDetail{one,two,three,five}},
        Bool.pick(Command,Bool.and(String.eq(four,"--pretty"),String.eq(five,"--id")),
          Pretty{KnowledgeScopeDetail{one,two,three,six}},Invalid{}))
    case "record-typed": KnowledgeRecordTyped{one,two,three,four,five,six}
    case "join": Join{one,two,three,four,five,six}
    case "context-eval": ContextEval{one,two,three,four,five,six}
    case _: Invalid{}

def parse_basic_eight(+verb: String, +one: String, +two: String, +three: String, +four: String, +five: String, +six: String, +seven: String) -> Command:
  match verb:
    case "record-linked": KnowledgeRecordLinked{one,two,three,four,five,six,seven}
    case "knowledge-traverse": KnowledgeTraverse{one,two,three,four,five,six,String.eq(seven,"recursive")}
    case "land-checked": Bool.pick(Command,String.eq(six,"--commit"),LandCheckedAt{one,two,three,four,five,seven},Invalid{})
    case other: parse_receive(other,one,two,three,four,five,six,seven)

def parse_basic_nine(+verb: String, +one: String, +two: String, +three: String, +four: String, +five: String, +six: String, +seven: String, +eight: String) -> Command:
  match verb:
    case "knowledge-traverse": Bool.pick(Command,String.eq(eight,"--pretty"),Pretty{KnowledgeTraverse{one,two,three,four,five,six,String.eq(seven,"recursive")}},Invalid{})
    case _: Invalid{}

def parse_basic_9(+verb: String, +one: String, +two: String, +three: String, +four: String, +five: String, +six: String, +seven: String, +eight: String, +nine: String, args: List<String>) -> Command:
  match args:
    case Nil{}: parse_verb_nine_args(verb,one,two,three,four,five,six,seven,eight,nine)
    case _: Invalid{}

def parse_basic_8(+verb: String, +one: String, +two: String, +three: String, +four: String, +five: String, +six: String, +seven: String, +eight: String, args: List<String>) -> Command:
  match args:
    case Nil{}: parse_basic_nine(verb,one,two,three,four,five,six,seven,eight)
    case +nine <> rest: parse_basic_9(verb,one,two,three,four,five,six,seven,eight,nine,rest)

def parse_basic_7(+verb: String, +one: String, +two: String, +three: String, +four: String, +five: String, +six: String, +seven: String, args: List<String>) -> Command:
  match args:
    case Nil{}: parse_basic_eight(verb,one,two,three,four,five,six,seven)
    case +eight <> rest: parse_basic_8(verb,one,two,three,four,five,six,seven,eight,rest)

def parse_basic_6(+verb: String, +one: String, +two: String, +three: String, +four: String, +five: String, +six: String, args: List<String>) -> Command:
  match args:
    case Nil{}: parse_basic_seven(verb,one,two,three,four,five,six)
    case +seven <> rest: parse_basic_7(verb,one,two,three,four,five,six,seven,rest)

def parse_basic_5(+verb: String, +one: String, +two: String, +three: String, +four: String, +five: String, args: List<String>) -> Command:
  match args:
    case Nil{}: Bool.pick(Command,Bool.and(String.eq(verb,"land"),String.eq(four,"--commit")),LandAt{one,two,three,five},parse_verb_five_args(verb,one,two,three,four,five))
    case +six <> rest: parse_basic_6(verb,one,two,three,four,five,six,rest)

def parse_basic_4(+verb: String, +one: String, +two: String, +three: String, +four: String, args: List<String>) -> Command:
  match args:
    case Nil{}: parse_verb_four_args(verb,one,two,three,four)
    case +five <> rest: parse_basic_5(verb,one,two,three,four,five,rest)

def parse_basic_3(+verb: String, +one: String, +two: String, +three: String, args: List<String>) -> Command:
  match args:
    case Nil{}: parse_verb_three_args(verb,one,two,three)
    case +four <> rest: parse_basic_4(verb,one,two,three,four,rest)

def parse_basic_2(+verb: String, +one: String, +two: String, args: List<String>) -> Command:
  match args:
    case Nil{}: parse_verb_session_id(verb,one,two)
    case +three <> rest: parse_basic_3(verb,one,two,three,rest)

def parse_basic_1(+verb: String, +one: String, args: List<String>) -> Command:
  match args:
    case Nil{}: parse_verb_id(verb,one)
    case +two <> rest: parse_basic_2(verb,one,two,rest)

def parse_basic_0(+verb: String, args: List<String>) -> Command:
  match args:
    case Nil{}: parse_verb_only(verb)
    case +one <> rest: parse_basic_1(verb,one,rest)

def parse_basic(args: List<String>) -> Command:
  match args:
    case Nil{}: Invalid{}
    case +verb <> rest: parse_basic_0(verb,rest)

def index_digits(value: String) -> Bool:
  match value:
    case SNil{}: True{}
    case SCon{head,tail}:
      +code = Char.to_u32(head)
      Bool.and(Bool.and(U32.is_lt(47,code),U32.is_lt(code,58)),index_digits(tail))

def index_integer(value: String) -> Bool:
  match value:
    case SNil{}: False{}
    case SCon{+head,+tail}:
      Bool.pick(Bool,Bool.or(Char.is_eq(head,Char.from_u32(43)),Char.is_eq(head,Char.from_u32(45))),
        Bool.and(Bool.not(String.is_empty(tail)),index_digits(tail)),index_digits(SCon{head,tail}))

def index_finish(base: Command, inbox: Bool, condition: String, state: String, +index: Bool, pretty: Bool, filtered: Bool) -> Command:
  +selected = Bool.pick(Command,index,MessageIndex{inbox,condition,state},base)
  Bool.pick(Command,Bool.and(Bool.not(index),filtered),Invalid{},Bool.pick(Command,pretty,Pretty{selected},selected))

def index_sequence_condition(condition: String, +value: String, after: Bool) -> String:
  Bool.pick(String,index_integer(value),
    condition ++ Bool.pick(String,after," AND m.seq>CAST("," AND m.seq<=CAST(") ++ q(value) ++ " AS INTEGER)","")

# Option values are consumed literally, including values that name another option.
def index_options(args: List<String>, +base: Command, +inbox: Bool, +condition: String, +state: String, +index: Bool, +pretty: Bool, +filtered: Bool) -> Command:
  match args:
    case Nil{}: index_finish(base,inbox,condition,state,index,pretty,filtered)
    case "--index" <> rest: index_options(rest,base,inbox,condition,state,True{},pretty,filtered)
    case "--pretty" <> rest: index_options(rest,base,inbox,condition,state,index,True{},filtered)
    case "--sender" <> value <> rest:
      index_options(rest,base,inbox,condition ++ " AND m.sender=" ++ q(value),state,index,pretty,True{})
    case "--recipient" <> value <> rest:
      index_options(rest,base,inbox,condition ++ " AND m.recipient=" ++ q(value),state,index,pretty,True{})
    case "--kind" <> value <> rest:
      index_options(rest,base,inbox,condition ++ " AND m.kind=" ++ q(value),state,index,pretty,True{})
    case "--state" <> value <> rest:
      match value:
        case "pending": index_options(rest,base,inbox,condition,owed_sql("m"),index,pretty,True{})
        case "read": index_options(rest,base,inbox,condition,read_sql("m"),index,pretty,True{})
        case "all": index_options(rest,base,inbox,condition,"1",index,pretty,True{})
        case _: Invalid{}
    case "--after-seq" <> value <> rest:
      +next_condition = index_sequence_condition(condition,value,True{})
      Bool.pick(Command,Bool.not(String.is_empty(next_condition)),index_options(rest,base,inbox,next_condition,state,index,pretty,True{}),Invalid{})
    case "--through-seq" <> value <> rest:
      +next_condition = index_sequence_condition(condition,value,False{})
      Bool.pick(Command,Bool.not(String.is_empty(next_condition)),index_options(rest,base,inbox,next_condition,state,index,pretty,True{}),Invalid{})
    case _: Invalid{}

def parse(args: List<String>) -> Command:
  match args:
    case "pending" <> rest:
      index_options(rest,Pending{},False{},"1",owed_sql("m"),False{},False{},False{})
    case "inbox" <> +id <> rest:
      index_options(rest,Inbox{id},True{},"m.recipient=" ++ q(id),owed_sql("m"),False{},False{},False{})
    case other: parse_basic(other)

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

law stall_parser_selects_the_candidate_report:
  {parse(["stall"]) == Stall{} : Command}

def stall_parser_selects_the_candidate_report():
  {==}

law stall_wake_parser_selects_the_wake:
  {parse(["stall-wake"]) == StallWake{} : Command}

def stall_wake_parser_selects_the_wake():
  {==}
