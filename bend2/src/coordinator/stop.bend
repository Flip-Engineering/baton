import Base
import ../coordinator/commands.bend as C
import ./delivery.bend as Delivery
import ./store.bend as Store
import ../host/session-lock.bend as Lock
import ../host/sqlite.bend as DB
import ../host/process.bend as P
import ../git/text.bend as Tx
import ../context/native-runtime.bend as ContextRuntime
import ../host/files.bend as F

# The session lock owner publishes one current attempt before it launches.
# Stop and attempt admission use the same database transaction order.
def admit_sql(+session: String, +id: String, +mode: String, +directory: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO executions(session,id,mode,directory,phase,status) SELECT " ++ C.q(session) ++ "," ++ C.q(id) ++ "," ++ C.q(mode) ++ "," ++ C.q(directory) ++ ",'starting','' WHERE NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ ") AND NOT " ++ C.task_closed_sql(C.q(session)) ++ " ON CONFLICT(session) DO UPDATE SET id=excluded.id,mode=excluded.mode,directory=excluded.directory,phase=excluded.phase,status='';SELECT NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ ") AND NOT " ++ C.task_closed_sql(C.q(session)) ++ ";COMMIT;"

def admit(+db: String, +session: String, +id: String, +mode: String, +directory: String) -> IO(Bool):
  do IO<Bool>:
    result : String <- IO.try(String,DB.Sql.query(db,admit_sql(session,id,mode,directory)))
    IO.pure(Bool,String.eq(result,"1\n"))

# A held start admitted under the session lock never launches, so the row that
# admission wrote for it is removed. The id and phase guards leave any row that
# a later admission has already replaced.
def held_release_sql(+session: String, +id: String) -> String:
  "DELETE FROM executions WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(id) ++ " AND phase='starting';"

def held_release(+db: String, +session: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,held_release_sql(session,id)))
    IO.pure(Unit,Unit{})

def stopped_sql(+session: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ ");"

def stopped(+db: String, +session: String) -> IO(Bool):
  do IO<Bool>:
    value : String <- IO.try(String,DB.Sql.query(db,stopped_sql(session)))
    IO.pure(Bool,String.eq(value,"1\n"))

def lift_completed(saved: Result<&1,&1,U32 & String,String>, released: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match saved:
    case Done{output}: IO.pass(Unit,released)
    case Fail{(code,cause)}: match released:
      case Done{unit}: IO.die(Unit,code,cause)
      case Fail{(release_code,release_cause)}: IO.die(Unit,code,cause ++ "\nSession lock release failed: " ++ U32.show(release_code) ++ ": " ++ release_cause)

# Explicit resume waits for the current owner's stop report, then removes the stop.
def lift(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    lock : U32 <- IO.try(U32,Lock.SessionLock.wait_acquire(canonical,session))
    lifted : Result<&1,&1,U32 & String,String> <- Store.transact_sql(canonical,"BEGIN IMMEDIATE;DELETE FROM session_stops WHERE session=" ++ C.q(session) ++ ";COMMIT;")
    released : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(lock)
    lift_completed(lifted,released)

# A clear-only operation removes a terminal stop without continuing the
# conversation: it delivers no input, drives no wake, starts no native and
# makes no provider request. The terminal predicate keeps a stop that still
# owns a live attempt; that stop is cleared only after its attempt exits.
def clear_terminal_sql() -> String:
  "(attempt='' OR EXISTS(SELECT 1 FROM executions e WHERE e.session=session_stops.session AND e.id=session_stops.attempt AND e.phase='exited'))"

def clear_result_sql(+session: String) -> String:
  +s = C.q(session)
  "json_object('schema','baton2-clear-stop-v1','cleared',json('true'),'session'," ++ s
  ++ ",'stopId',id,'reason',reason,'stopStatus',outcome,'attempt',nullif(attempt,''),'nativeStatus',nullif(native_status,''),'reportId',nullif(report_id,'')"
  ++ ",'native',(SELECT native FROM sessions WHERE id=" ++ s ++ ")"
  ++ ",'workspace',(SELECT workspace FROM sessions WHERE id=" ++ s ++ ")"
  ++ ",'branch',(SELECT branch FROM sessions WHERE id=" ++ s ++ ")"
  ++ ",'base',(SELECT base FROM sessions WHERE id=" ++ s ++ ")"
  ++ ",'preserved',json_object("
  ++ "'native',(SELECT native FROM sessions WHERE id=" ++ s ++ ")"
  ++ ",'workspace',(SELECT workspace FROM sessions WHERE id=" ++ s ++ ")"
  ++ ",'branch',(SELECT branch FROM sessions WHERE id=" ++ s ++ ")"
  ++ ",'base',(SELECT base FROM sessions WHERE id=" ++ s ++ ")"
  ++ ",'messages',(SELECT count(*) FROM messages WHERE recipient=" ++ s ++ ")"
  ++ ",'retainedInputs',(SELECT count(*) FROM messages WHERE recipient=" ++ s ++ " AND " ++ C.owed_sql("messages") ++ ")"
  ++ ",'executions',(SELECT count(*) FROM executions WHERE session=" ++ s ++ "))"
  ++ ",'execution',(SELECT json_object('attempt',id,'mode',mode,'phase',phase,'status',status) FROM executions WHERE session=" ++ s ++ " ORDER BY rowid DESC LIMIT 1)"
  ++ ",'executionCreated',json('false'),'providerRequest',json('false'))"

# The refusal names the observed condition after the delete matched no row.
# changes() belongs to the delete above, so a successful clear emits only the
# RETURNING row and no refusal row.
def clear_refusal_sql(+session: String) -> String:
  +s = C.q(session)
  "SELECT json_object('error','clear-stop-refused','session'," ++ s
  ++ ",'condition',CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ s ++ ") THEN 'session-not-registered'"
  ++ " WHEN NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ s ++ ") THEN 'no-terminal-stop'"
  ++ " WHEN EXISTS(SELECT 1 FROM session_stops st JOIN executions e ON e.session=st.session AND e.id=st.attempt WHERE st.session=" ++ s ++ " AND e.phase<>'exited') THEN 'stop-owns-live-attempt'"
  ++ " ELSE 'stop-not-terminal' END"
  ++ ",'next','Inspect the session. Only a terminal stop whose attempt has no live execution can be cleared without continuing the conversation; wait for its report, use force-stop for a live attempt, or use resume --lift-stop to continue after it exits.')"
  ++ " WHERE changes()=0;"

def clear_sql(+session: String) -> String:
  "BEGIN IMMEDIATE;DELETE FROM session_stops WHERE session=" ++ C.q(session) ++ " AND " ++ clear_terminal_sql()
  ++ " RETURNING " ++ clear_result_sql(session) ++ ";" ++ clear_refusal_sql(session) ++ "COMMIT;"

def clear_release(saved: Result<&1,&1,U32 & String,String>, released: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match saved:
    case Done{+output}: do IO<Unit>:
      released_ok : Unit <- IO.pass(Unit,released)
      Bool.pick(IO(Unit),Tx.starts_with(output,"{\"error\""),IO.die(Unit,2,Tx.trim_nl(output)),IO.write(output))
    case Fail{(code,cause)}: match released:
      case Done{unit}: IO.die(Unit,code,cause)
      case Fail{(release_code,release_cause)}: IO.die(Unit,code,cause ++ "\nSession lock release failed: " ++ U32.show(release_code) ++ ": " ++ release_cause)

# Explicit clear waits for the current owner, removes the terminal stop and
# stops there. The caller observes the returned preserved state; no delivery,
# wake, launch or provider query follows.
def clear(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    lock : U32 <- IO.try(U32,Lock.SessionLock.wait_acquire(canonical,session))
    cleared : Result<&1,&1,U32 & String,String> <- Store.transact_sql(canonical,clear_sql(session))
    released : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(lock)
    clear_release(cleared,released)

def require_open(closed: Bool) -> IO(Unit):
  match closed:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: IO.die(Unit,2,"Session is terminally stopped or its assignment is complete. Read its session and retained inbox; resume SESSION --lift-stop explicitly lifts a stop and continues the same conversation, and a new assignment from its coordinator continues a completed one.")

def admitted(allowed: Bool) -> IO(Unit):
  require_open(Bool.not(allowed))

def result_sql(+session: String) -> String:
  "SELECT json_object('session',session,'stopId',id,'reason',reason,'status',outcome,'attempt',nullif(attempt,''),'requestedSignal',CASE WHEN attempt='' THEN NULL ELSE signal END,'submittedSignal',nullif(applied_signal,0),'controlError',nullif(control_error,''),'nativeStatus',nullif(native_status,''),'reportId',nullif(report_id,''),'stoppedInputs',(SELECT count(*) FROM messages WHERE recipient=session_stops.session AND " ++ C.owed_sql("messages") ++ " AND kind IN ('task','guidance','recovery')),'pendingReports',(SELECT count(*) FROM messages WHERE recipient=session_stops.session AND " ++ C.owed_sql("messages") ++ " AND kind IN ('report','question'))) FROM session_stops WHERE session=" ++ C.q(session) ++ ";"

# Legacy direct attempts have no keeper directory. Refusal preserves their rows.
def supported_sql(+session: String) -> String:
  "EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ " AND harness IN ('omp','codex','muse','claude-code','dsh','antigravity')) AND NOT EXISTS(SELECT 1 FROM executions WHERE session=" ++ C.q(session) ++ " AND mode='direct' AND phase<>'exited' AND directory='')"

# The operator resolution of a stopped session's wake obligation: the admitted
# stop clears the claim, so no driver hands the retained input on, and the input
# itself stays retained and visible. The clear runs inside the stop transaction
# and fires only when the stop row it names was actually admitted, so a refused
# stop leaves a live claim alone.
def stop_claim_sql(+session: String, +id: String, +reason: String) -> String:
  "DELETE FROM wake_claims WHERE session=" ++ C.q(session) ++ " AND EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(id) ++ " AND reason=" ++ C.q(reason) ++ ");"

def request_sql(+session: String, +id: String, +reason: String) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema()
  ++ "INSERT INTO session_stops(session,id,reason,attempt,directory,outcome,report_id) SELECT s.id," ++ C.q(id) ++ "," ++ C.q(reason) ++ ",CASE WHEN e.phase<>'exited' THEN e.id ELSE '' END,CASE WHEN e.phase<>'exited' THEN e.directory ELSE '' END,CASE WHEN e.phase<>'exited' THEN 'requested' ELSE 'stopped' END,CASE WHEN e.phase<>'exited' THEN 'stop-result:' || lower(hex(" ++ C.q(id) ++ ")) ELSE '' END FROM sessions s LEFT JOIN executions e ON e.session=s.id WHERE s.id=" ++ C.q(session) ++ " AND " ++ supported_sql(session) ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=s.id OR id=" ++ C.q(id) ++ ");"
  ++ stop_claim_sql(session,id,reason)
  ++ C.ended_report_sql(session,id,"stop")
  ++ "SELECT CASE WHEN EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(id) ++ " AND reason=" ++ C.q(reason) ++ ") THEN '' WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ") THEN 'Session is not registered; inspect status.' WHEN NOT (" ++ supported_sql(session) ++ ") THEN 'Stop supports retained OMP, Codex, Muse, Claude Code, DSH and Antigravity sessions; a legacy direct turn without a keeper directory was left unchanged.' WHEN NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(id) ++ " AND reason=" ++ C.q(reason) ++ ") THEN 'Stop identity differs from the recorded operation; read the session and retry its exact stop ID and reason.' ELSE '' END;COMMIT;"

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
    id : String <- IO.try(String,DB.Sql.query(db,"WITH reports AS (SELECT id,seq,CASE WHEN json_valid(body) THEN body ELSE '{}' END AS document FROM messages WHERE sender=" ++ C.q(session) ++ " AND kind='report') SELECT coalesce((SELECT id FROM reports WHERE json_extract(document,'$.type')='session-stopped' AND json_extract(document,'$.attempt')=" ++ C.q(attempt) ++ " ORDER BY seq DESC LIMIT 1),'');"))
    result : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,Tx.trim_nl(id),"1","")
    IO.pure(Result<&1,&1,U32 & String,Unit>,Delivery.wake_result(result))

# A stop names an attempt from the executions row. When its directory is
# absent, the session lock distinguishes a live owner preparing the attempt
# from missing custody with no live owner.
def directory_missing_result(observed: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match observed:
    case Fail{(code,detail)}: IO.pure(Bool,U32.is_eq(code,2))
    case Done{value}: IO.pure(Bool,False{})

def directory_missing(+directory: String) -> IO(Bool):
  do IO<Bool>:
    observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(directory)
    directory_missing_result(observed)

def custody_missing_sql(+session: String, +attempt: String, +detail: String) -> String:
  +s = C.q(session)
  +a = C.q(attempt)
  "BEGIN IMMEDIATE;UPDATE session_stops SET outcome='custody-missing',control_error=" ++ C.q(detail) ++ " WHERE session=" ++ s ++ " AND attempt=" ++ a ++ " AND outcome IN ('requested','custody-missing');"
  ++ "INSERT INTO messages(id,sender,recipient,kind,body) SELECT 'stop-custody-missing:' || lower(hex(st.id)),s.id," ++ C.report_recipient("s.id") ++ ",'report',json_object('type','session-stop-custody-missing','session',s.id,'stopId',st.id,'reason',st.reason,'attempt',st.attempt,'requestedSignal',st.signal,'nativeStatus',NULL,'observationError',nullif(" ++ C.q(detail) ++ ",''),'workspace',s.workspace,'branch',s.branch,'native',s.native) FROM session_stops st JOIN sessions s ON s.id=st.session WHERE st.session=" ++ s ++ " AND st.attempt=" ++ a ++ " AND st.report_id<>'' AND " ++ C.report_recipient("s.id") ++ " IS NOT NULL" ++ C.message_upsert() ++ ";COMMIT;"

def mark_custody_missing(+db: String, +session: String, +attempt: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    +detail : String = "Attempt custody is missing at " ++ directory ++ "; the native process identity was not established and no native exit is recorded."
    saved : String <- IO.try(String,DB.Sql.query(db,custody_missing_sql(session,attempt,detail)))
    IO.pure(Unit,Unit{})

def missing_identity_signal_result(+db: String, +session: String, +attempt: String, +signal: U32, +directory: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{native_status}: do IO<Unit>:
      Bool.pick(IO(Unit),String.eq(native_status,"signaled"),
        do IO<Unit>:
          saved : String <- IO.try(String,DB.Sql.query(db,"UPDATE session_stops SET outcome='requested',applied_signal=" ++ U32.show(signal) ++ ",control_error='' WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ " AND signal=" ++ U32.show(signal) ++ " AND outcome IN ('requested','custody-missing');"))
          IO.pure(Unit,Unit{}),
        exited(db,session,attempt,native_status,"","",""))
    case Fail{error}: mark_custody_missing(db,session,attempt,directory)

def missing_identity_signal(+db: String, +session: String, +attempt: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    state : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN st.applied_signal=st.signal THEN 'applied' ELSE cast(st.signal AS TEXT) END FROM session_stops st JOIN executions e ON e.session=st.session AND e.id=st.attempt WHERE st.session=" ++ C.q(session) ++ " AND st.attempt=" ++ C.q(attempt) ++ " AND st.outcome IN ('requested','custody-missing') AND e.phase<>'exited';"))
    +value : String = Tx.trim_nl(state)
    Bool.pick(IO(Unit),String.is_empty(value),IO.pure(Unit,Unit{}),
      Bool.pick(IO(Unit),String.eq(value,"applied"),IO.pure(Unit,Unit{}),
        do IO<Unit>:
          +signal : U32 = U32.read(value)
          Bool.pick(IO(Unit),U32.is_eq(signal,0),mark_custody_missing(db,session,attempt,directory),
            do IO<Unit>:
              result : Result<&1,&1,U32 & String,String> <- P.ProcessChild.instance_attempt_signal(db,directory,signal)
              missing_identity_signal_result(db,session,attempt,signal,directory,result))))

# When the lock is held during startup, the existing lifecycle reconciliation
# retries after the attempt enters the running phase.
def missing_custody_owner_locked(+db: String, +session: String, +attempt: String, +directory: String, owner: Maybe<U32>) -> IO(Unit):
  match owner:
    case None{}: do IO<Unit>:
      phase : String <- IO.try(String,DB.Sql.query(db,"SELECT phase FROM executions WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(attempt) ++ ";"))
      Bool.pick(IO(Unit),String.eq(Tx.trim_nl(phase),"starting"),IO.pure(Unit,Unit{}),
        missing_identity_signal(db,session,attempt,directory))
    case Some{handle}: do IO<Unit>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      missing_identity_signal(db,session,attempt,directory)

def missing_custody_owner(+db: String, +session: String, +attempt: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    owner : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(canonical,session))
    missing_custody_owner_locked(db,session,attempt,directory,owner)

# The host verifies the retained manifest and native birth before delivering
# a signal; no PID or path inference is used.

def control_attempt_result(+db: String, +session: String, +attempt: String, +signal: U32, result: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Done{unit}: do IO<Result<&1,&1,U32 & String,Unit>>:
      saved : String <- IO.try(String,DB.Sql.query(db,control_result_sql(session,attempt,signal,Done{Unit{}})))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Fail{(+code,+detail)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      saved : String <- IO.try(String,DB.Sql.query(db,control_result_sql(session,attempt,signal,Fail{(code,detail)})))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,detail)})

def control_attempt(+db: String, +session: String, +attempt: String, +directory: String, +signal: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.control_signal(directory,signal)
    control_attempt_result(db,session,attempt,signal,result)

def restore_requested_sql(+session: String, +attempt: String) -> String:
  "UPDATE session_stops SET outcome='requested',control_error='' WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ " AND outcome='custody-missing' AND EXISTS(SELECT 1 FROM executions e WHERE e.session=session_stops.session AND e.id=session_stops.attempt AND e.phase<>'exited');"

def restore_requested(+db: String, +session: String, +attempt: String) -> IO(Unit):
  do IO<Unit>:
    restored : String <- IO.try(String,DB.Sql.query(db,restore_requested_sql(session,attempt)))
    IO.pure(Unit,Unit{})

def reconcile_restored_control_result(+db: String, +session: String, +attempt: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: restore_requested(db,session,attempt)
    case Fail{error}: IO.pure(Unit,Unit{})

def reconcile_restored_signal(+db: String, +session: String, +attempt: String, +directory: String, signal: U32) -> IO(Unit):
  match signal:
    case 0: restore_requested(db,session,attempt)
    case other: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> <- control_attempt(db,session,attempt,directory,other)
      reconcile_restored_control_result(db,session,attempt,result)

def reconcile_restored(+db: String, +session: String, +attempt: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    signal : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT s.signal FROM session_stops s JOIN executions e ON e.session=s.session AND e.id=s.attempt WHERE s.session=" ++ C.q(session) ++ " AND s.attempt=" ++ C.q(attempt) ++ " AND e.phase<>'exited' AND s.applied_signal<>s.signal),0);"))
    reconcile_restored_signal(db,session,attempt,directory,selected_signal(U32.read(Tx.trim_nl(signal))))

def reconcile_request(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    attempt : String <- IO.try(String,DB.Sql.query(db,"SELECT attempt FROM session_stops WHERE session=" ++ C.q(session) ++ ";"))
    directory : String <- IO.try(String,DB.Sql.query(db,"SELECT directory FROM session_stops WHERE session=" ++ C.q(session) ++ ";"))
    outcome : String <- IO.try(String,DB.Sql.query(db,"SELECT outcome FROM session_stops WHERE session=" ++ C.q(session) ++ ";"))
    +id : String = Tx.trim_nl(attempt)
    +path : String = Tx.trim_nl(directory)
    +state : String = Tx.trim_nl(outcome)
    Bool.pick(IO(Unit),Bool.and(Bool.or(String.eq(state,"requested"),String.eq(state,"custody-missing")),Bool.not(String.is_empty(id))),
      do IO<Unit>:
        missing : Bool <- directory_missing(path)
    Bool.pick(IO(Unit),missing,missing_custody_owner(db,session,id,path),reconcile_restored(db,session,id,path)),
      IO.pure(Unit,Unit{}))

# Every reconcile entry reads the current attempt and path from the durable stop
# row. The caller's attempt and directory can be stale after observer recovery.
def reconcile(+db: String, +session: String, +attempt: String, +directory: String) -> IO(Unit):
  reconcile_request(db,session)

def started(+db: String, +session: String, +attempt: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,"UPDATE executions SET phase='running' WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(attempt) ++ " AND phase='starting';"))
    reconcile(db,session,attempt,"")

# A successful attachment resumes observation of this current attempt. Its
# retained native status becomes the execution status when observation finishes.
def observing(+db: String, +session: String, +attempt: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,"UPDATE executions SET phase='running',status='' WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(attempt) ++ " AND directory=" ++ C.q(directory) ++ ";"))
    reconcile(db,session,attempt,directory)

# The same observation resume, with the first database failure returned as a
# result. The recovery path uses it so SQLITE_BUSY reaches its typed cause
# handler instead of aborting the executing call with the database code.
def observing_after_query(+db: String, +session: String, saved: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match saved:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: do IO<Result<&1,&1,U32 & String,Unit>>:
      reconciled : Unit <- reconcile(db,session,"","")
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def observing_result(+db: String, +session: String, +attempt: String, +directory: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    saved : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"UPDATE executions SET phase='running',status='' WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(attempt) ++ " AND directory=" ++ C.q(directory) ++ ";")
    observing_after_query(db,session,saved)

def request(+db: String, +session: String, +id: String, +reason: String, force: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  Store.transact_sql(db,Bool.pick(String,force,force_sql(session,id),request_sql(session,id,reason)))

# A stop of a session with live children or unresolved input reports them to the
# session's current coordinator inside the stop transaction. The report wakes
# its recipient after the stop commits.
def ended_report_found_sql(+id: String) -> String:
  "SELECT coalesce((SELECT id FROM messages WHERE id=" ++ C.q("ended:" ++ id) ++ " AND " ++ C.owed_sql("messages") ++ "),'');"

def announce_ended_found(+db: String, +found: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,found,"1","")
      IO.pure(Unit,Unit{})

def announce_ended(+db: String, +id: String, force: Bool) -> IO(Unit):
  match force:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      found : String <- IO.try(String,DB.Sql.query(db,ended_report_found_sql(id)))
      +name : String = Tx.trim_nl(found)
      announce_ended_found(db,name,String.is_empty(name))

def run(+db: String, +session: String, +id: String, +reason: String, +force: Bool) -> IO(Unit):
  do IO<Unit>:
    error : String <- IO.try(String,request(db,session,id,reason,force))
    checked : Unit <- validate(error)
    reconciled : Unit <- reconcile_request(db,session)
    announced : Unit <- announce_ended(db,id,force)
    runtime_stopped : Unit <- ContextRuntime.runtime_stop_owner(db,session)
    result : String <- IO.try(String,DB.Sql.query(db,result_sql(session)))
    IO.write(result)
