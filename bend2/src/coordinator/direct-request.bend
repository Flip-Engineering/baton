import Base
import ./commands.bend as C
import ../json/canonical.bend as J
import ../host/sqlite.bend as DB

# These values are captured by the ordinary entry before keeper preparation.
# Recorded assignment values remain separate from normalized invocation paths.
type Assignment is Data:
  Assignment{session: String, harness: String, parent: Maybe<&2,String>, recipient: Maybe<&2,String>, model: String, effort: String, workspace: String}

type Invocation is Data:
  Invocation{executable: String, model: String, effort: String, workspace: String, output: String, taskPath: String, task: String, explicitResume: Maybe<&2,String>, resolvedResume: String, adapterArgv: String, initial: String, keepStdin: U32}

type Request is Data:
  Request{assignment: Assignment, invocation: Invocation}

# The host prepare result supplies the directory and qualified keeper identity.
# This record carries evidence; constructing it does not establish lifetime.
type Preparation is Data:
  Preparation{directory: String, keeper: String, protocol: U32}

def nullable(value: Maybe<&2,String>) -> String:
  match value:
    case None{}: "null"
    case Some{text}: J.string_literal(text)

def completion_target(recipient: Maybe<&2,String>) -> String:
  match recipient:
    case None{}: "local"
    case Some{id}: "remote"

def assignment_json(assignment: Assignment) -> String:
  match assignment:
    case Assignment{session,harness,parent,+recipient,model,effort,workspace}:
      "\"version\":1,\"session\":" ++ J.string_literal(session) ++ ",\"harness\":" ++ J.string_literal(harness) ++ ",\"parent\":" ++ nullable(parent) ++ ",\"recipient\":" ++ nullable(recipient) ++ ",\"assignmentModel\":" ++ J.string_literal(model) ++ ",\"assignmentEffort\":" ++ J.string_literal(effort) ++ ",\"assignmentWorkspace\":" ++ J.string_literal(workspace) ++ ",\"completionTarget\":" ++ J.string_literal(completion_target(recipient))

def invocation_json(invocation: Invocation) -> String:
  match invocation:
    case Invocation{executable,model,effort,workspace,output,taskPath,task,explicitResume,resolvedResume,adapterArgv,initial,keepStdin}:
      "\"executable\":" ++ J.string_literal(executable) ++ ",\"model\":" ++ J.string_literal(model) ++ ",\"effort\":" ++ J.string_literal(effort) ++ ",\"workspace\":" ++ J.string_literal(workspace) ++ ",\"output\":" ++ J.string_literal(output) ++ ",\"taskPath\":" ++ J.string_literal(taskPath) ++ ",\"task\":" ++ J.string_literal(task) ++ ",\"explicitResume\":" ++ nullable(explicitResume) ++ ",\"resolvedResume\":" ++ J.string_literal(resolvedResume) ++ ",\"adapterArgv\":" ++ J.string_literal(adapterArgv) ++ ",\"initial\":" ++ J.string_literal(initial) ++ ",\"keepStdin\":" ++ U32.show(keepStdin)

def request_json(request: Request) -> String:
  match request:
    case Request{assignment,invocation}: "{" ++ assignment_json(assignment) ++ "," ++ invocation_json(invocation) ++ "}"

def schema() -> String:
  "CREATE TABLE IF NOT EXISTS direct_requests(id TEXT PRIMARY KEY NOT NULL,session TEXT NOT NULL REFERENCES sessions(id),version INTEGER NOT NULL CHECK(version=1),request TEXT NOT NULL CHECK(json_valid(request)),directory TEXT NOT NULL,keeper TEXT NOT NULL CHECK(json_valid(keeper)),protocol INTEGER NOT NULL CHECK(protocol=1),decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),reason TEXT NOT NULL,phase TEXT NOT NULL,outcome TEXT NOT NULL DEFAULT 'unavailable',local_result TEXT,result_message TEXT,notification TEXT NOT NULL,cleanup TEXT NOT NULL,lifetime TEXT NOT NULL DEFAULT 'unavailable');"

def fields() -> List<&2,String>:
  ["version","session","harness","parent","recipient","assignmentModel","assignmentEffort","assignmentWorkspace","completionTarget","executable","model","effort","workspace","output","taskPath","task","explicitResume","resolvedResume","adapterArgv","initial","keepStdin"]

def field(+json: String, name: String) -> String:
  "json_extract(" ++ json ++ "," ++ C.q("$." ++ name) ++ ")"

def mismatch_clauses(names: List<&2,String>, +original: String, +requested: String) -> String:
  match names:
    case Nil{}: ""
    case +name <> rest:
      " WHEN " ++ field(original,name) ++ " IS NOT " ++ field(requested,name) ++ " THEN " ++ C.q(name) ++ mismatch_clauses(rest,original,requested)

def mismatch(original: String, requested: String) -> String:
  "CASE" ++ mismatch_clauses(fields(),original,requested) ++ " ELSE '' END"

# The retained decision is consumed unchanged after a lost transaction reply.
# Only an absent ID reaches current admission facts.
def admission_reason(+payload: String, detached: Bool) -> String:
  +session = field(payload,"session")
  "CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ session ++ ") THEN 'direct-session-unregistered'"
  ++ " WHEN " ++ field(payload,"harness") ++ " NOT IN ('omp','codex','muse','claude-code') THEN 'direct-harness-unsupported'"
  ++ " WHEN NOT EXISTS(SELECT 1 FROM sessions s WHERE s.id=" ++ session ++ " AND s.harness=" ++ field(payload,"harness") ++ " AND s.parent IS " ++ field(payload,"parent") ++ " AND s.model=" ++ field(payload,"assignmentModel") ++ " AND s.effort=" ++ field(payload,"assignmentEffort") ++ " AND s.workspace=" ++ field(payload,"assignmentWorkspace") ++ ") THEN 'direct-assignment-changed'"
  ++ " WHEN " ++ C.report_recipient(session) ++ " IS NOT " ++ field(payload,"recipient") ++ " THEN 'direct-owner-changed'"
  ++ " WHEN " ++ Bool.pick(String,detached,"1","0") ++ " AND (" ++ field(payload,"recipient") ++ " IS NULL OR NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ field(payload,"recipient") ++ ")) THEN 'direct-owner-unavailable'"
  ++ " WHEN EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ session ++ ") THEN 'direct-session-stopped'"
  ++ " WHEN EXISTS(SELECT 1 FROM executions WHERE session=" ++ session ++ " AND phase<>'exited') THEN 'direct-execution-unresolved' ELSE '' END"

def input_table(+id: String, request: Request, preparation: Preparation, detached: Bool) -> String:
  match preparation:
    case Preparation{directory,keeper,protocol}:
      "CREATE TEMP TABLE direct_input AS SELECT " ++ C.q(id) ++ " AS id," ++ C.q(request_json(request)) ++ " AS request," ++ C.q(directory) ++ " AS directory," ++ C.q(keeper) ++ " AS keeper," ++ U32.show(protocol) ++ " AS protocol," ++ Bool.pick(String,detached,"1","0") ++ " AS detached;"

def frozen_decision(detached: Bool) -> String:
  "CREATE TEMP TABLE direct_decision AS SELECT i.*,EXISTS(SELECT 1 FROM direct_requests r WHERE r.id=i.id) AS existing,"
  ++ "coalesce((SELECT CASE WHEN " ++ mismatch("r.request","i.request") ++ "<>'' THEN " ++ mismatch("r.request","i.request") ++ " WHEN r.directory<>i.directory THEN 'attemptDirectory' WHEN r.keeper<>i.keeper OR r.protocol<>i.protocol THEN 'keeperBinding' ELSE '' END FROM direct_requests r WHERE r.id=i.id),'') AS conflict,"
  ++ "coalesce((SELECT reason FROM direct_requests r WHERE r.id=i.id),CASE WHEN EXISTS(SELECT 1 FROM messages WHERE id=i.id) THEN 'direct-history-unbound' ELSE " ++ admission_reason("i.request",detached) ++ " END) AS reason FROM direct_input i;"

def insert_decision() -> String:
  "INSERT INTO direct_requests(id,session,version,request,directory,keeper,protocol,decision,reason,phase,notification,cleanup) SELECT id," ++ field("request","session") ++ ",1,request,directory,keeper,protocol,CASE WHEN reason='' THEN 'accepted' ELSE 'rejected' END,reason,'prepared',CASE WHEN " ++ field("request","recipient") ++ " IS NULL THEN 'notRequiredLocal' ELSE 'pending' END,CASE WHEN reason='' THEN 'notRequired' ELSE 'owed' END FROM direct_decision WHERE existing=0 AND conflict='' AND EXISTS(SELECT 1 FROM sessions WHERE id=" ++ field("request","session") ++ ");"

# An exact retry cannot rewrite a newer current pointer or revive an exited one.
def publish_execution() -> String:
  "INSERT INTO executions(session,id,mode,directory,phase,status) SELECT " ++ field("request","session") ++ ",id,'direct',directory,'starting','' FROM direct_decision WHERE existing=0 AND conflict='' AND reason='' ON CONFLICT(session) DO UPDATE SET id=excluded.id,mode=excluded.mode,directory=excluded.directory,phase=excluded.phase,status=excluded.status;"

def decision_result() -> String:
  "SELECT CASE WHEN d.conflict<>'' THEN json_object('error','direct-request-conflict','requestId',d.id,'field',d.conflict,'originalRequest',json(r.request),'attemptDirectory',r.directory) WHEN r.id IS NULL THEN json_object('error',d.reason,'requestId',d.id,'admissionDecision',NULL,'attemptDirectory',d.directory) ELSE json_object('requestId',r.id,'session',r.session,'request',json(r.request),'attemptDirectory',r.directory,'keeper',json(r.keeper),'protocol',r.protocol,'admissionDecision',r.decision,'reason',r.reason,'phase',r.phase,'outcome',r.outcome,'notification',r.notification,'cleanup',r.cleanup,'lifetime',r.lifetime,'resultId',r.result_message,'localResult',r.local_result) END FROM direct_decision d LEFT JOIN direct_requests r ON r.id=d.id;"

def decide_sql(+id: String, request: Request, preparation: Preparation, +detached: Bool) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema() ++ schema() ++ input_table(id,request,preparation,detached) ++ frozen_decision(detached) ++ insert_decision() ++ publish_execution() ++ decision_result() ++ "COMMIT;"

# The caller holds the session guard and owns the prepared keeper. The returned
# row is the sole admission authority; host errors require same-binding readback.
def decide(db: String, id: String, request: Request, preparation: Preparation, detached: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  DB.Sql.query(db,decide_sql(id,request,preparation,detached))

law existing_requests_are_compared_field_by_field:
  for original: String
  for requested: String
  {mismatch(original,requested) == "CASE" ++ mismatch_clauses(fields(),original,requested) ++ " ELSE '' END" : String}

def existing_requests_are_compared_field_by_field(original,requested):
  {==}

law decisions_commit_after_the_current_pointer_and_answer:
  for id: String
  for request: Request
  for preparation: Preparation
  for +detached: Bool
  {decide_sql(id,request,preparation,detached) == "BEGIN IMMEDIATE;" ++ C.schema() ++ schema() ++ input_table(id,request,preparation,detached) ++ frozen_decision(detached) ++ insert_decision() ++ publish_execution() ++ decision_result() ++ "COMMIT;" : String}

def decisions_commit_after_the_current_pointer_and_answer(id,request,preparation,detached):
  {==}

law replay_never_republishes_the_execution_pointer:
  {publish_execution() == "INSERT INTO executions(session,id,mode,directory,phase,status) SELECT " ++ field("request","session") ++ ",id,'direct',directory,'starting','' FROM direct_decision WHERE existing=0 AND conflict='' AND reason='' ON CONFLICT(session) DO UPDATE SET id=excluded.id,mode=excluded.mode,directory=excluded.directory,phase=excluded.phase,status=excluded.status;" : String}

def replay_never_republishes_the_execution_pointer():
  {==}

law local_completion_target_is_explicit:
  {completion_target(None{}) == "local" : String}

def local_completion_target_is_explicit():
  {==}
