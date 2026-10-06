import Base
import ./commands.bend as C
import ./delivery.bend as Delivery
import ../host/sqlite.bend as DB
import ../host/process.bend as P
import ../git/text.bend as Tx

# The session lock owner publishes one current attempt before it launches.
# Stop and attempt admission use the same database transaction order.
def admit_sql(+session: String, +id: String, +mode: String, +directory: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO executions(session,id,mode,directory,phase,status) SELECT " ++ C.q(session) ++ "," ++ C.q(id) ++ "," ++ C.q(mode) ++ "," ++ C.q(directory) ++ ",'starting','' WHERE NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ ") ON CONFLICT(session) DO UPDATE SET id=excluded.id,mode=excluded.mode,directory=excluded.directory,phase=excluded.phase,status='';SELECT NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ ");COMMIT;"

def admit(+db: String, +session: String, +id: String, +mode: String, +directory: String) -> IO(Bool):
  do IO<Bool>:
    result : String <- IO.try(String,DB.Sql.query(db,admit_sql(session,id,mode,directory)))
    IO.pure(Bool,String.eq(result,"1\n"))

def stopped_sql(+session: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ ");"

def stopped(+db: String, +session: String) -> IO(Bool):
  do IO<Bool>:
    value : String <- IO.try(String,DB.Sql.query(db,stopped_sql(session)))
    IO.pure(Bool,String.eq(value,"1\n"))

def require_open(closed: Bool) -> IO(Unit):
  match closed:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: IO.die(Unit,2,"Session is terminally stopped. Read its session and retained inbox; recruit a new session for new work.")

def admitted(allowed: Bool) -> IO(Unit):
  require_open(Bool.not(allowed))

def result_sql(+session: String) -> String:
  "SELECT json_object('session',session,'stopId',id,'reason',reason,'status',outcome,'attempt',nullif(attempt,''),'requestedSignal',CASE WHEN attempt='' THEN NULL ELSE signal END,'submittedSignal',nullif(applied_signal,0),'controlError',nullif(control_error,''),'nativeStatus',nullif(native_status,''),'reportId',nullif(report_id,''),'stoppedInputs',(SELECT count(*) FROM messages WHERE recipient=session_stops.session AND receipt IS NULL AND kind IN ('task','guidance','recovery')),'pendingReports',(SELECT count(*) FROM messages WHERE recipient=session_stops.session AND receipt IS NULL AND kind IN ('report','question'))) FROM session_stops WHERE session=" ++ C.q(session) ++ ";"

# A direct owner is unsupported. Refusal leaves the session and inbox unchanged.
def supported_sql(+session: String) -> String:
  "EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ " AND harness IN ('omp','codex')) AND NOT EXISTS(SELECT 1 FROM executions WHERE session=" ++ C.q(session) ++ " AND mode='direct' AND phase<>'exited')"

# The operator resolution of a stopped session's wake obligation: the terminal
# stop clears the claim, so no driver hands the retained input on, and the input
# itself stays retained and visible. The clear runs inside the stop transaction.
def stop_claim_sql(+session: String) -> String:
  "DELETE FROM wake_claims WHERE session=" ++ C.q(session) ++ ";"

def request_sql(+session: String, +id: String, +reason: String) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema()
  ++ "INSERT INTO session_stops(session,id,reason,attempt,directory,outcome,report_id) SELECT s.id," ++ C.q(id) ++ "," ++ C.q(reason) ++ ",CASE WHEN e.phase<>'exited' THEN e.id ELSE '' END,CASE WHEN e.phase<>'exited' THEN e.directory ELSE '' END,CASE WHEN e.phase<>'exited' THEN 'requested' ELSE 'stopped' END,CASE WHEN e.phase<>'exited' THEN 'stop-result:' || lower(hex(" ++ C.q(id) ++ ")) ELSE '' END FROM sessions s LEFT JOIN executions e ON e.session=s.id WHERE s.id=" ++ C.q(session) ++ " AND " ++ supported_sql(session) ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=s.id OR id=" ++ C.q(id) ++ ");"
  ++ stop_claim_sql(session)
  ++ "SELECT CASE WHEN EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(id) ++ " AND reason=" ++ C.q(reason) ++ ") THEN '' WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ") THEN 'Session is not registered; inspect status.' WHEN NOT (" ++ supported_sql(session) ++ ") THEN 'Stop supports retained OMP and Codex sessions; an active direct turn is unsupported and was left unchanged.' WHEN NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(id) ++ " AND reason=" ++ C.q(reason) ++ ") THEN 'Stop identity differs from the recorded operation; read the session and retry its exact stop ID and reason.' ELSE '' END;COMMIT;"

def force_sql(+session: String, +id: String) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema()
  ++ "UPDATE session_stops SET signal=9 WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(id) ++ " AND EXISTS(SELECT 1 FROM executions e WHERE e.session=session_stops.session AND e.id=session_stops.attempt AND e.phase<>'exited');SELECT CASE WHEN EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(id) ++ ") THEN '' ELSE 'Force requires the exact existing stop ID for this session; read the session before retrying.' END;COMMIT;"

def error_result(+error: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,error)

def validate(+error: String) -> IO(Unit):
  error_result(error,String.is_empty(Tx.trim_nl(error)))

def control_result_sql(+session: String, +attempt: String, +signal: U32, result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{unit}:
      "UPDATE session_stops SET applied_signal=(" ++ U32.show(signal) ++ "),control_error='' WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ " AND signal=" ++ U32.show(signal) ++ ";"
    case Fail{(code,error)}:
      "UPDATE session_stops SET control_error=" ++ C.q(U32.show(code) ++ ": " ++ error) ++ " WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ " AND signal=" ++ U32.show(signal) ++ ";"

def send_control(+db: String, +session: String, +attempt: String, +directory: String, +signal: U32) -> IO(Unit):
  match signal:
    case 0: IO.pure(Unit,Unit{})
    case other: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.control_signal(directory,other)
      saved : String <- IO.try(String,DB.Sql.query(db,control_result_sql(session,attempt,other,result)))
      IO.pure(Unit,Unit{})

def selected_signal(value: Maybe<&2,U32>) -> U32:
  match value:
    case None{}: 0
    case Some{signal}: signal

# A starting attempt may not have its keeper socket yet. The accepted stop is
# retained and the owner reconciles it immediately after launch and on recovery.
def reconcile(+db: String, +session: String, +attempt: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    signal : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT s.signal FROM session_stops s JOIN executions e ON e.session=s.session AND e.id=s.attempt WHERE s.session=" ++ C.q(session) ++ " AND s.attempt=" ++ C.q(attempt) ++ " AND e.phase<>'exited' AND s.applied_signal<>s.signal),0);"))
    send_control(db,session,attempt,directory,selected_signal(U32.read(Tx.trim_nl(signal))))

def started(+db: String, +session: String, +attempt: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,"UPDATE executions SET phase='running' WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(attempt) ++ " AND phase='starting';"))
    reconcile(db,session,attempt,directory)

# Completion preserves the native event and status. Its stop report is committed
# before the owner releases custody; native acceptance receipts are unchanged.
def exited_sql(+session: String, +attempt: String, +status: String, +event: String, +error: String, +log: String) -> String:
  "BEGIN IMMEDIATE;UPDATE executions SET phase='exited',status=" ++ C.q(status) ++ " WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(attempt) ++ ";"
  ++ "UPDATE session_stops SET outcome='stopped',native_status=" ++ C.q(status) ++ " WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ ";"
  ++ "INSERT INTO messages(id,sender,recipient,kind,body) SELECT st.report_id,s.id," ++ C.report_recipient("s.id") ++ ",'report',json_object('type','session-stopped','session',s.id,'stopId',st.id,'reason',st.reason,'attempt',st.attempt,'requestedSignal',st.signal,'nativeStatus',st.native_status,'nativeEvent',CASE WHEN " ++ C.q(event) ++ "='' THEN NULL ELSE json(" ++ C.q(event) ++ ") END,'observationError',nullif(" ++ C.q(error) ++ ",''),'output'," ++ C.q(log) ++ ",'workspace',s.workspace,'branch',s.branch,'native',s.native) FROM session_stops st JOIN sessions s ON s.id=st.session WHERE st.session=" ++ C.q(session) ++ " AND st.attempt=" ++ C.q(attempt) ++ " AND st.report_id<>'' AND " ++ C.report_recipient("s.id") ++ " IS NOT NULL" ++ C.message_upsert() ++ "COMMIT;"

def exited(+db: String, +session: String, +attempt: String, +status: String, +event: String, +error: String, +log: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,exited_sql(session,attempt,status,event,error,log)))
    IO.pure(Unit,Unit{})

def deliver(+db: String, +session: String, +attempt: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    id : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT report_id FROM session_stops WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ "),'');"))
    result : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,Tx.trim_nl(id),"1","")
    IO.pure(Result<&1,&1,U32 & String,Unit>,Delivery.wake_result(result))

def reconcile_request(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    attempt : String <- IO.try(String,DB.Sql.query(db,"SELECT attempt FROM session_stops WHERE session=" ++ C.q(session) ++ ";"))
    directory : String <- IO.try(String,DB.Sql.query(db,"SELECT directory FROM session_stops WHERE session=" ++ C.q(session) ++ ";"))
    reconcile(db,session,Tx.trim_nl(attempt),Tx.trim_nl(directory))

def request(+db: String, +session: String, +id: String, +reason: String, force: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  DB.Sql.query(db,Bool.pick(String,force,force_sql(session,id),request_sql(session,id,reason)))

def run(+db: String, +session: String, +id: String, +reason: String, force: Bool) -> IO(Unit):
  do IO<Unit>:
    error : String <- IO.try(String,request(db,session,id,reason,force))
    checked : Unit <- validate(error)
    reconciled : Unit <- reconcile_request(db,session)
    result : String <- IO.try(String,DB.Sql.query(db,result_sql(session)))
    IO.write(result)
