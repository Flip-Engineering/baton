import Base
import ./stop.bend as Stop
import ./receive.bend as Receive
import ./commands.bend as C
import ../host/process.bend as P
import ../host/session-lock.bend as Lock
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

# These equations bind command admission and keeper control effects. SQLite
# transaction isolation and native process lifetime remain host obligations;
# the stop fixtures exercise those boundaries with controlled native processes.
law stopped_receive_cannot_acquire_an_owner:
  for db: String
  for session: String
  for cmd: String
  for model: String
  for effort: String
  for cwd: String
  for log: String
  for again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.available(db,session,cmd,model,effort,cwd,log,again,True{}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Session is terminally stopped; queued input will not execute. Read its session and retained inbox.")}) : IO(Result<&1,&1,U32 & String,Unit>)}

def stopped_receive_cannot_acquire_an_owner(db,session,cmd,model,effort,cwd,log,again):
  {==}

def refused_admission_releases(lock: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Session is terminally stopped; queued input will not execute. Read its session and retained inbox.")})

law stopped_admission_releases_without_launch:
  for db: String
  for session: String
  for id: String
  for cmd: String
  for route: String
  for thinking: String
  for workspace: String
  for log: String
  for +lock: U32
  for cursor: String
  for native: String
  for attempt: String
  for harness: String
  for storage: String
  for prompt: String
  for recovery: String
  for again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.start_admitted(db,session,id,cmd,route,thinking,workspace,log,lock,cursor,native,attempt,harness,storage,prompt,recovery,again,False{}) == refused_admission_releases(lock) : IO(Result<&1,&1,U32 & String,Unit>)}

def stopped_admission_releases_without_launch(db,session,id,cmd,route,thinking,workspace,log,lock,cursor,native,attempt,harness,storage,prompt,recovery,again):
  {==}

# Both direct turns and retained receives call this transaction while holding
# their session lock. The terminal stop predicate also decides the result.
law stop_admission_transaction_preserves_terminal_state:
  for +session: String
  for +id: String
  for +mode: String
  for +directory: String
  {Stop.admit_sql(session,id,mode,directory) == "BEGIN IMMEDIATE;INSERT INTO executions(session,id,mode,directory,phase,status) SELECT " ++ C.q(session) ++ "," ++ C.q(id) ++ "," ++ C.q(mode) ++ "," ++ C.q(directory) ++ ",'starting','' WHERE NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ ") ON CONFLICT(session) DO UPDATE SET id=excluded.id,mode=excluded.mode,directory=excluded.directory,phase=excluded.phase,status='';SELECT NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ ");COMMIT;" : String}

def stop_admission_transaction_preserves_terminal_state(session,id,mode,directory):
  {==}

law force_stop_keeps_the_recorded_live_attempt:
  for +session: String
  for +id: String
  {Stop.force_sql(session,id) == "BEGIN IMMEDIATE;" ++ C.schema() ++ "UPDATE session_stops SET signal=9 WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(id) ++ " AND EXISTS(SELECT 1 FROM executions e WHERE e.session=session_stops.session AND e.id=session_stops.attempt AND e.phase<>'exited');SELECT CASE WHEN EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ " AND id=" ++ C.q(id) ++ ") THEN '' ELSE 'Force requires the exact existing stop ID for this session; read the session before retrying.' END;COMMIT;" : String}

def force_stop_keeps_the_recorded_live_attempt(session,id):
  {==}

def submit_term(+db: String, session: String, attempt: String, directory: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.control_signal(directory,15)
    saved : String <- IO.try(String,DB.Sql.query(db,Stop.control_result_sql(session,attempt,15,result)))
    IO.pure(Unit,Unit{})

law ordinary_stop_submits_term_to_its_attempt:
  for +db: String
  for +session: String
  for +attempt: String
  for +directory: String
  {Stop.send_control(db,session,attempt,directory,15) == submit_term(db,session,attempt,directory) : IO(Unit)}

def ordinary_stop_submits_term_to_its_attempt(db,session,attempt,directory):
  {==}

def submit_force(+db: String, session: String, attempt: String, directory: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.control_signal(directory,9)
    saved : String <- IO.try(String,DB.Sql.query(db,Stop.control_result_sql(session,attempt,9,result)))
    IO.pure(Unit,Unit{})

law explicit_force_submits_kill_to_its_attempt:
  for +db: String
  for +session: String
  for +attempt: String
  for +directory: String
  {Stop.send_control(db,session,attempt,directory,9) == submit_force(db,session,attempt,directory) : IO(Unit)}

def explicit_force_submits_kill_to_its_attempt(db,session,attempt,directory):
  {==}

law idle_stop_submits_no_signal:
  for db: String
  for session: String
  for attempt: String
  for directory: String
  {Stop.send_control(db,session,attempt,directory,0) == IO.pure(Unit,Unit{}) : IO(Unit)}

def idle_stop_submits_no_signal(db,session,attempt,directory):
  {==}

# Stop acceptance writes its current state after control submission. Native
# exit and parent report delivery are performed by the retained observer.
def accepted_stop(+db: String, +session: String, id: String, reason: String, force: Bool) -> IO(Unit):
  do IO<Unit>:
    error : String <- IO.try(String,Stop.request(db,session,id,reason,force))
    checked : Unit <- Stop.validate(error)
    reconciled : Unit <- Stop.reconcile_request(db,session)
    result : String <- IO.try(String,DB.Sql.query(db,Stop.result_sql(session)))
    IO.write(result)

law stop_acceptance_does_not_wait_for_completion:
  for +db: String
  for +session: String
  for +id: String
  for +reason: String
  for +force: Bool
  {Stop.run(db,session,id,reason,force) == accepted_stop(db,session,id,reason,force) : IO(Unit)}

def stop_acceptance_does_not_wait_for_completion(db,session,id,reason,force):
  {==}

# Signal selection reads the terminal stop and current execution together. The
# submitted signal is compared by identity: TERM and KILL have unrelated numbers.
def reconcile_recorded_stop(+db: String, +session: String, +attempt: String, directory: String) -> IO(Unit):
  do IO<Unit>:
    signal : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT s.signal FROM session_stops s JOIN executions e ON e.session=s.session AND e.id=s.attempt WHERE s.session=" ++ C.q(session) ++ " AND s.attempt=" ++ C.q(attempt) ++ " AND e.phase<>'exited' AND s.applied_signal<>s.signal),0);"))
    Stop.send_control(db,session,attempt,directory,Stop.selected_signal(U32.read(Tx.trim_nl(signal))))

law stop_reconcile_selects_the_recorded_signal_and_attempt:
  for +db: String
  for +session: String
  for +attempt: String
  for +directory: String
  {Stop.reconcile(db,session,attempt,directory) == reconcile_recorded_stop(db,session,attempt,directory) : IO(Unit)}

def stop_reconcile_selects_the_recorded_signal_and_attempt(db,session,attempt,directory):
  {==}

# The answer reads the stored operation and distinguishes an idle stop from a
# requested native signal. SQLite rendering is exercised by the idle fixture.
law stop_result_reads_recorded_execution_status:
  for +session: String
  {Stop.result_sql(session) == "SELECT json_object('session',session,'stopId',id,'reason',reason,'status',outcome,'attempt',nullif(attempt,''),'requestedSignal',CASE WHEN attempt='' THEN NULL ELSE signal END,'submittedSignal',nullif(applied_signal,0),'controlError',nullif(control_error,''),'nativeStatus',nullif(native_status,''),'reportId',nullif(report_id,''),'stoppedInputs',(SELECT count(*) FROM messages WHERE recipient=session_stops.session AND receipt IS NULL AND kind IN ('task','guidance','recovery')),'pendingReports',(SELECT count(*) FROM messages WHERE recipient=session_stops.session AND receipt IS NULL AND kind IN ('report','question'))) FROM session_stops WHERE session=" ++ C.q(session) ++ ";" : String}

def stop_result_reads_recorded_execution_status(session):
  {==}
