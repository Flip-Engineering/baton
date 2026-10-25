import Base
import ./agent-guidance.bend as AgentGuidance
import ../coordinator/commands.bend as C
import ./../coordinator/logs.bend as Logs
import ../storage/lifecycle.bend as Storage
import ../harness/omp-player.bend as Omp
import ./control.bend as Control
import ./store.bend as Store
import ./stop.bend as Stop
import ./subscription-fallback.bend as Subs
import ./accounts.bend as Accounts
import ./usage-windows.bend as UW
import ./turn.bend as Turn
import ./native-initial-input.bend as NativeInitialInput
import ../json/canonical.bend as J
import ./native-requests.bend as NativeRequests
import ./observer-checkpoint.bend as Observer
import ./delivery.bend as Delivery
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../host/process.bend as P
import ../host/instance.bend as Custody
import ../host/files.bend as F
import ../host/control.bend as Host
import ../git/text.bend as Tx
import ../host/text.bend as Text
import ../context/request.bend as Req
import ../coordinator/message-status.bend as MessageStatus

def field(+db: String, session: String, name: String, +supplied: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(supplied) ++ "<>'' THEN " ++ C.q(supplied) ++ " ELSE " ++ name ++ " END FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    IO.pure(String,Tx.trim_nl(value))

def shell_chars(value: String) -> String:
  match value:
    case SNil{}: ""
    case SCon{+char,rest}: Bool.pick(String,Char.is_eq(char,Char.from_u32(39)),"'\\''",SCon{char,SNil{}}) ++ shell_chars(rest)

def shell(value: String) -> String:
  "'" ++ shell_chars(value) ++ "'"

# The recipient's recorded orientation, read from existing coordinator state as compact
# JSON: its actual parent id, every Ensemble membership with coupling, every Section
# membership with its ensemble/section ids and capability, and the admitted recipients
# that the message route predicate accepts (each with its recorded route metadata).
# Nothing is invented; an unrecorded part reads `none recorded`.
def orientation_sql(+session: String) -> String:
  "SELECT json_object('parent',coalesce(nullif((SELECT parent FROM sessions WHERE id=" ++ C.q(session) ++ "),''),'none recorded'),"
  ++ "'ensembles',coalesce(nullif((SELECT json_group_array(json(item)) FROM (SELECT json_object('ensemble',m.ensemble,'coupling',e.coupling) AS item FROM ensemble_members m JOIN ensembles e ON e.id=m.ensemble WHERE m.session=" ++ C.q(session) ++ " ORDER BY m.ensemble)),'[]'),'none recorded'),"
  ++ "'sections',coalesce(nullif((SELECT json_group_array(json(item)) FROM (SELECT json_object('ensemble',sm.ensemble,'section',sm.section,'capability',se.capability) AS item FROM section_members sm JOIN sections se ON se.ensemble=sm.ensemble AND se.id=sm.section WHERE sm.session=" ++ C.q(session) ++ " ORDER BY sm.ensemble,sm.section)),'[]'),'none recorded'),"
  ++ "'recipients',coalesce(nullif((SELECT json_group_array(json(item)) FROM (SELECT json_object('id',r.id,'harness',r.harness,'model',r.model,'effort',r.effort) AS item FROM sessions r WHERE " ++ C.message_route(C.q(session),"r.id") ++ " ORDER BY r.id)),'[]'),'none recorded'));"

def orientation_text(db: String, session: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,orientation_sql(session)))
    IO.pure(String,Tx.trim_nl(saved))

def instructions(executable: String, database: String, +session: String, orientation: String) -> String:
  "You are session " ++ session ++ " in a Baton Orchestra.\nRecorded orientation: " ++ orientation ++ "\nCoordinator executable/database argv: [" ++ J.string_literal(executable) ++ "," ++ J.string_literal(database) ++ "]\n"
  ++ "Read complete owed input with inbox. Baton resolves the database, current actor, assignment and coordinator from the launch context. Baton records delivery and complete reads internally. Read your inbox again as work continues. Explicit stops and direct operator instructions remain effective.\nUse report --text TEXT and ask --text TEXT to reach your recorded coordinator. Use completion-request --text SUMMARY when your assignment is ready. A parentless session follows its operator task. A coordinator uses completion-confirmed --to PLAYER to confirm that Player's current request. Pending delivery reports state their retained byte count; read each complete body with baton read MESSAGE_ID before acting on it. Use guide --to PLAYER --text TEXT for further instructions and native-reply --to PLAYER --text JSON for a pending native question.\nUse dispatch --to PLAYER --text TEXT to deliver a task to a recorded Player. An open assignment receives continuation input. Dispatch stores the complete text, request and setup outcome in the database. Use dispatch --stdin for standard input and dispatch --help for route selection. Independent Players can run concurrently. Their retained reports reach the recorded coordinator when their native turns end.\nUse join --session PLAYER --harness HARNESS --model MODEL --effort EFFORT --path WORKSPACE for a shared checkout. Use recruit --session PLAYER --harness HARNESS --model MODEL --effort EFFORT --repo REPO --branch BRANCH --path PATH --base COMMIT for a separate worktree. Baton records the current actor as parent. Register a receiver with receiver --session PLAYER --command EXECUTABLE --output-log PATH.\nFor source work, name the checkout, target branch and remote in the assignment. Commit completed contributions and report remaining work. The coordinating Conductor integrates and publishes contributions. Use land --session PLAYER --repo REPO --target BRANCH for a fast-forward contribution, or reconcile divergent contributions with ordinary Git operations. After the Player's owned turn finishes, receiver --session PLAYER --command EXECUTABLE --output-log PATH --cwd SHARED_CWD preserves its conversation and moves its recorded workspace. Remove a clean inactive temporary worktree and fully integrated branch with ordinary Git commands. Preserve active checkouts, unfinished changes, later unintegrated commits and explicit stops.\nUse players, orchestra, assignment, attempts and status to inspect recorded work. Use knowledge read for complete scoped findings and knowledge promote --to DESTINATION --finding FINDING to share reviewed evidence. Existing finding and message references select evidence; Baton generates identities for new records and relations. Use help ACTION for named arguments and as SESSION for an explicit actor override.\n"
  ++ AgentGuidance.actions()
  ++ Turn.task_instructions()
  ++ Turn.knowledge_instructions()

def receive_status(db: String, session: String, status: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('session'," ++ C.q(session) ++ ",'status'," ++ C.q(status) ++ ");"))
    Text.Text.control_output(result)

# The receive wrapper prints the invocation result. Admission status paths that
# have no attempt return silently so the wrapper remains the one output.
def receive_silent(+status: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def exit_status(failed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match failed:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(1,"Native receive failed; read the retained native log and pending inbox.")})

# A terminal can record a provider failure with host exit zero: an OMP
# assistant frame with stopReason error, or a Muse primary run_terminal whose
# payload terminal is not completed.
def outcome_failed(db: String, outcome: Turn.Outcome) -> IO(Bool):
  match outcome:
    case Turn.Ended{+status,+event,+error,incomplete}: do IO<Bool>:
      failure : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(event) ++ "='' THEN 1 WHEN coalesce(json_extract(" ++ C.q(event) ++ ",'$.is_error'),0)=1 THEN 1 WHEN json_extract(" ++ C.q(event) ++ ",'$.payload.kind')='run_terminal' AND json_extract(" ++ C.q(event) ++ ",'$.payload.terminal')<>'completed' THEN 1 ELSE " ++ C.omp_terminal_error_sql(event) ++ " END;"))
      IO.pure(Bool,Bool.or(Turn.failed(status,event,error),String.eq(failure,"1\n")))

def native_observation_failed(outcome: Turn.Outcome) -> Bool:
  match outcome:
    case Turn.Ended{status,event,error,incomplete}: incomplete

# True only when a recorded advance may stand in for the provider's own exit failure: the
# observation completed and recorded no error, so an incomplete observation or a real
# observation or logging failure keeps its own aggregate native failure.
def superseding(superseded: Bool, outcome: Turn.Outcome) -> Bool:
  match outcome:
    case Turn.Ended{status,event,error,incomplete}: Bool.and(superseded,Bool.and(Bool.not(incomplete),String.is_empty(error)))

# True only for a successfully finished continuation: a classified complete provider
# failure whose ordinary continuation succeeded reports the continuation outcome.
# The old turn row and provider cause remain recorded from the outcome itself.
def continue_if(again: String -> IO(Result<&1,&1,U32 & String,Unit>), present: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match present:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: again("")

# How much input is still owed after the cursor. Busy writers have committed
# before trying the lock, so the owner reads this again after releasing it.
def pending_count_sql(+session: String, cursor: String) -> String:
  "SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND " ++ C.owed_sql("messages") ++ " AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"

# The message the wake hands to the invocation. It is the first unread
# message after the cursor, so the wake never re-delivers input the attempt
# already carried. Claim writers record it as the obligation owner.
def wake_found(db: String, session: String, cursor: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,DB.Sql.query(db,Delivery.wake_sql(session,cursor)))
    IO.pure(String,Tx.trim_nl(found))

# The continuation takes the session lock and re-reads the count while holding
# it, so the in-invocation continuation and the wake driver cannot both proceed
# for one session. The claim records the driver that took the obligation.
def continue_owned(+db: String, +session: String, +cursor: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: Maybe<U32>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match lock:
    case None{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Some{handle}: do IO<Result<&1,&1,U32 & String,Unit>>:
      pending : String <- IO.try(String,DB.Sql.query(db,pending_count_sql(session,cursor)))
      head : String <- wake_found(db,session,cursor)
      claimed : Unit <- Store.claim(db,session,head)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      continue_if(again,Bool.not(String.eq(pending,"0\n")))

def continue_locked(+db: String, +session: String, +cursor: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>), owed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match owed:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: Lock.SessionLock.acquire_session(Result<&1,&1,U32 & String,Unit>,db,session,
      +canonical => lock => continue_owned(canonical,session,cursor,again,lock))

def continue_pending(+db: String, +session: String, +cursor: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    pending : String <- IO.try(String,DB.Sql.query(db,pending_count_sql(session,cursor)))
    continue_locked(db,session,cursor,again,Bool.not(String.eq(pending,"0\n")))

# The lock holder deletes the claim row only once nothing is owed and no
# retained attempt is recorded live. A finished turn with unread input
# still owes the wake, so the row survives for the next driver.
# The settler releases only the exact admission ticket it read under its own
# held lock: the owner and generation the claim carried when this hold began.
# A ticket that names a stale row removes nothing.
def release_if_ticket(+db: String, +session: String, +owner: String, +generation: String, settled: Bool) -> IO(Unit):
  match settled:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: Store.release_ticket(db,session,owner,generation)

# Observed host custody for the attempt the executions row records, read only
# through established file and recovery surfaces that never take custody or
# move any offset. A reaped status file is genuine death: the keeper writes it
# when it reaps the native. Without it, the recovery markers decide: a gone
# directory, terminal markers, or a missing launch marker all mean nothing
# holds the attempt, while a launch marker without terminal marks means the
# attempt started with an unknown fate. An empty directory means no attempt is
# on record. Anything ambiguous keeps the obligation. The executions phase is
# never read as custody here.
def attempt_dir_sql(+session: String) -> String:
  "SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(session) ++ "),'');"

def custody_recovery_none(recovery: Result<&1,&1,U32 & String,Maybe<String>>) -> Bool:
  match recovery:
    case Done{found}: match found:
      case Some{argv}: False{}
      case None{}: True{}
    case Fail{error}: False{}

def custody_dead_recovery(+directory: String) -> IO(Bool):
  do IO<Bool>:
    recovery : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.recovery_argv(directory)
    IO.pure(Bool,custody_recovery_none(recovery))

def custody_dead_sized(+directory: String, missing: Bool) -> IO(Bool):
  match missing:
    case True{}: custody_dead_recovery(directory)
    case False{}: IO.pure(Bool,True{})

def custody_dead_size(+directory: String, reaped: Result<&1,&1,U32 & String,U32>) -> IO(Bool):
  match reaped:
    case Done{size}: custody_dead_sized(directory,U32.is_eq(size,0))
    case Fail{error}: custody_dead_recovery(directory)

def custody_dead(+db: String, +directory: String, empty: Bool) -> IO(Bool):
  match empty:
    case True{}: IO.pure(Bool,True{})
    case False{}: do IO<Bool>:
      reaped : Result<&1,&1,U32 & String,U32> <- F.Files.size(directory ++ "/status")
      custody_dead_size(directory,reaped)

# Only the lock holder settles a claim. A queued invocation that finds the lock
# held returns without touching the row, so it can never clear a live driver's
# claim. The holder releases the exact ticket it read under this hold only when
# no unread input remains and host custody observes the recorded
# attempt dead. A recovery passes the ticket it admitted, so a newer owner or a
# later generation is preserved. A recorded read of the owed input deletes the row
# on the read path; an admitted stop deletes it on the stop path.
def ticket_match(+expected_owner: String, +expected_generation: String, +owner: String, +generation: String) -> Bool:
  +current_owner : String = Tx.trim_nl(owner)
  +current_generation : String = Tx.trim_nl(generation)
  Bool.or(String.is_empty(expected_owner),
    Bool.and(String.eq(expected_owner,current_owner),String.eq(expected_generation,current_generation)))

def settle_owned(+db: String, +session: String, +expected_owner: String, +expected_generation: String, +ticket_directory: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.pure(Unit,Unit{})
    case Some{handle}: do IO<Unit>:
      +owner : String <- Store.claim_owner(db,session)
      +generation : String <- Store.claim_generation(db,session)
      pending : String <- IO.try(String,DB.Sql.query(db,pending_count_sql(session,"0")))
      dir : String <- IO.try(String,DB.Sql.query(db,attempt_dir_sql(session)))
      +trimmed : String <- IO.pure(String,Tx.trim_nl(dir))
      dead : Bool <- custody_dead(db,trimmed,String.is_empty(trimmed))
      +settled : Bool = Bool.and(String.eq(pending,"0\n"),Bool.and(dead,ticket_match(expected_owner,expected_generation,owner,generation)))
      left : Unit <- release_if_ticket(db,session,Tx.trim_nl(owner),generation,settled)
      +remove : String = Bool.pick(String,String.is_empty(ticket_directory),trimmed,ticket_directory)
      cleaned : Unit <- Bool.pick(IO(Unit),settled,Store.delete_ticket(db,session,remove),IO.pure(Unit,Unit{}))
      unlocked : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      IO.pure(Unit,Unit{})

def claim_left(+db: String, +session: String) -> IO(Unit):
  Lock.SessionLock.acquire_session(Unit,db,session,
    +canonical => lock => settle_owned(canonical,session,"","","",lock))

def claim_left_ticket(+db: String, +session: String, +expected_owner: String, +expected_generation: String, +directory: String) -> IO(Unit):
  Lock.SessionLock.acquire_session(Unit,db,session,
    +canonical => lock => settle_owned(canonical,session,expected_owner,expected_generation,directory,lock))

# How much input is still owed after the cursor.
def wake_owed(db: String, session: String, cursor: String) -> IO(Bool):
  do IO<Bool>:
    pending : String <- IO.try(String,DB.Sql.query(db,pending_count_sql(session,cursor)))
    IO.pure(Bool,Bool.not(String.eq(pending,"0\n")))

# The launch of one message through the existing delivery path. The delivery runs
# as the detached self entry the admission path already uses, so the handing
# invocation returns without carrying the delivered turn itself.
def wake_launch(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    launched : String <- IO.try(String,Host.Control.launch(Tx.enc_argv([executable,"--dispatch-message",database,id]),database,id))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def wake_refused(+db: String, +session: String, launched: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match launched:
    case Done{unit}: IO.pure(Result<&1,&1,U32 & String,Unit>,launched)
    case Fail{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
      settled : Unit <- claim_left(db,session)
      IO.pure(Result<&1,&1,U32 & String,Unit>,launched)

# A target that is absent or already handed over leaves the obligation as it
# stands. A refused launch settles through the lock-gated sweep, which skips
# when a live owner has taken the obligation in the meantime.
def wake_target(+db: String, +session: String, +target: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: U32, empty: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match empty:
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      claimed : Unit <- Store.claim(db,session,target)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      launched : Result<&1,&1,U32 & String,Unit> <- launch(target)
      wake_refused(db,session,launched)

def wake_decided(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: U32, owed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match owed:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +found : String <- wake_found(db,session,cursor)
      wake_target(db,session,found,launch,lock,String.eq(found,""))

# A claimed retained attempt with an available session lock is adopted through
# detached public delivery. Adoption preserves its claim and native process.
def wake_stand(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: U32, owned: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match owned:
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +found : String <- wake_found(db,session,cursor)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.is_empty(found),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),wake_launch(db,found))
    case False{}: wake_decided(db,session,cursor,launch,lock,True{})

# The obligation is held exactly when the claim row names an owner while host
# custody cannot observe its death. A finished attempt, a missing directory,
# and a session with no attempt on record are all observed dead; anything else
# may still hold a live child, which public receive adopts under its session lock.
def wake_held(+state: String, +dead: Bool) -> Bool:
  Bool.and(String.eq(Tx.trim_nl(state),"claimed"),Bool.not(dead))

def recover_if_dead(+db: String, +session: String, dead: Bool) -> IO(Unit):
  match dead:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: Store.record_owner_death(db,session)

def wake_admit(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: U32, state: String, +dead: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  wake_stand(db,session,cursor,launch,lock,wake_held(state,dead))

# The usage gate runs before the claim read: a seat held by a live read keeps the
# owed input unlaunched, and the gate has announced the hold to the seat's
# orchestrator and the root. An open or unknown read admits the owed input on its
# retained assignment and account.
def wake_fenced_owed(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    state : String <- Store.claim_state(db,session)
    dir : String <- IO.try(String,DB.Sql.query(db,attempt_dir_sql(session)))
    +trimmed : String <- IO.pure(String,Tx.trim_nl(dir))
    +dead : Bool <- custody_dead(db,trimmed,String.is_empty(trimmed))
    recovered : Unit <- recover_if_dead(db,session,dead)
    replay_cursor : String = Bool.pick(String,Bool.and(dead,Bool.not(String.is_empty(trimmed))),"0",cursor)
    wake_admit(db,session,replay_cursor,launch,lock,state,dead)

def wake_fenced_gate(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: U32, gate: UW.Gate) -> IO(Result<&1,&1,U32 & String,Unit>):
  match gate:
    case UW.GateHeld{+window,+resets_at,+source,+receipt}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +found : String <- wake_found(db,session,cursor)
      held : Unit <- UW.held(db,session,Tx.trim_nl(found),"wake",UW.GateHeld{window,resets_at,source,receipt})
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case other: wake_fenced_owed(db,session,cursor,launch,lock)

def wake_fenced_gated(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +label : String <- Accounts.handoff_label_io(db,session)
    current : UW.Gate <- UW.window_gate(db,session,Tx.trim_nl(label))
    gate : UW.Gate <- Accounts.order_gate(db,session,current)
    next : Result<&1,&1,U32 & String,Unit> <- wake_fenced_gate(db,session,cursor,launch,lock,gate)
    IO.pure(Result<&1,&1,U32 & String,Unit>,next)

# The wake reads the claim and retained attempt under the session lock. A
# retained attempt with unknown native status keeps its claim for public receive
# adoption. Observed native death updates the execution and admits the message.
def wake_fenced(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: U32, owed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match owed:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: wake_fenced_gated(db,session,cursor,launch,lock)

def wake_owned(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: Maybe<U32>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match lock:
    case None{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Some{handle}: do IO<Result<&1,&1,U32 & String,Unit>>:
      owed : Bool <- wake_owed(db,session,cursor)
      wake_fenced(db,session,cursor,launch,handle,owed)

def wake_locked(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), owed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match owed:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: Lock.SessionLock.acquire_session(Result<&1,&1,U32 & String,Unit>,db,session,
      +canonical => lock => wake_owned(canonical,session,cursor,launch,lock))

# The wake driver. It reads the pending count for the session, takes the session
# lock, re-reads the count under the lock, claims the obligation and only then
# releases the lock and launches the one message the obligation names. A held
# lock is a live owner, which evaluates the obligation itself.
def wake_due(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    owed : Bool <- wake_owed(db,session,cursor)
    wake_locked(db,session,cursor,launch,owed)


def release_observer(lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.pure(Unit,Unit{})
    case Some{handle}: IO.try(Unit,Lock.SessionLock.release(handle))

# The queued continuation runs beside this attempt's own finish: the parent
# delivery, native-request settle and attempt acknowledge join before the
# continuation does, so a completed attempt releases while later work runs.
# The acknowledge callback returns its Result as a value. An acknowledge
# failure returns through that Result; the queued continuation is joined and
# the failure is part of the combined outcome.
# An incomplete native observation keeps custody available for same-attempt
# recovery. A provider-reported failure in a fully observed terminal event still
# fails the receive and leaves input owed, while its consumed native attempt can
# be acknowledged and retired.
def acknowledge_if_observed(incomplete: Bool, acknowledge: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match incomplete:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: acknowledge(Unit{})

# The terminal event carried by an Ended outcome.
def terminal_event(outcome: Turn.Outcome) -> String:
  match outcome:
    case Turn.Ended{status,event,error,incomplete}: event

# A settled provider transport error or rate refusal, read through the shared
# subscription classifier: the same actor continues on the same conversation
# and subscription; no account changes.
def transient_provider_error(+db: String, outcome: Turn.Outcome) -> IO(Bool):
  Subs.transient_provider_error(db,terminal_event(outcome))

# True only when the observation completed and recorded no error: the same
# requirement superseding applies before an advance stands in for a failure.
def observation_clear(outcome: Turn.Outcome) -> Bool:
  match outcome:
    case Turn.Ended{status,event,error,incomplete}: Bool.and(Bool.not(incomplete),String.is_empty(error))

def finish_pending_known(finished: Result<&1,&1,U32 & String,Unit>, questions: Result<&1,&1,U32 & String,Unit>, ack: Result<&1,&1,U32 & String,Unit>, failed: Bool, superseded: Bool, +outcome: Turn.Outcome, transient: Bool, owed: Bool, next_ok: Bool, next: Result<&1,&1,U32 & String,Unit>, reminder: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    status : Result<&1,&1,U32 & String,Unit> <- exit_status(Bool.and(failed,Bool.not(Bool.or(superseding(superseded,outcome),Bool.and(transient,Bool.and(observation_clear(outcome),Bool.and(owed,next_ok)))))))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(reminder,Turn.combine(finished,Turn.combine(questions,Turn.combine(next,Turn.combine(ack,status))))))

def finish_pending_result(finished: Result<&1,&1,U32 & String,Unit>, questions: Result<&1,&1,U32 & String,Unit>, ack: Result<&1,&1,U32 & String,Unit>, failed: Bool, superseded: Bool, outcome: Turn.Outcome, transient: Bool, owed: Bool, next: Result<&1,&1,U32 & String,Unit>, reminder: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match next:
    case Fail{error}: finish_pending_known(finished,questions,ack,failed,superseded,outcome,transient,owed,False{},Fail{error},reminder)
    case Done{unit}: finish_pending_known(finished,questions,ack,failed,superseded,outcome,transient,owed,True{},Done{unit},reminder)

# A failed continuation is reported to the recorded conductor; the turn
# settlement still returns the failure and retained cause unchanged.
def report_continuation_text(+db: String, +session: String, id: String, attempt: String, code: U32, +text: String) -> IO(Unit):
  Delivery.failure_report(db,session,id ++ ":continuation-failure",
    "Continuation of retained attempt " ++ attempt ++ " failed: " ++ U32.show(code) ++ ": " ++ text)

def report_continuation_pass(+db: String, +session: String, id: String, attempt: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Done{unit}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{unit})
    case Fail{(+code,+text)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      reported : Unit <- report_continuation_text(db,session,id,attempt,code,text)
      IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,text)})

def report_reminder_text(+db: String, +session: String, +id: String, code: U32, +text: String) -> IO(Unit):
  Delivery.failure_report(db,session,id ++ ":reminder-failure",
    "Completion reminder for attempt " ++ id ++ " failed: " ++ U32.show(code) ++ ": " ++ text)

def report_reminder_pass(+db: String, +session: String, id: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Done{unit}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{unit})
    case Fail{(+code,+text)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      reported : Unit <- report_reminder_text(db,session,id,code,text)
      IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,text)})

def report_recovery_text(+db: String, +session: String, +id: String, +directory: String, code: U32, +text: String) -> IO(Unit):
  Delivery.failure_report(db,session,id ++ ":recovery-failure",
    "Recovery of retained attempt " ++ id ++ " at " ++ directory ++ " failed: " ++ U32.show(code) ++ ": " ++ text)

def report_recovery_pass(+db: String, +session: String, +id: String, +directory: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Done{unit}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{unit})
    case Fail{(+code,+text)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      reported : Unit <- report_recovery_text(db,session,id,directory,code,text)
      IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(code,text)})

# The exit-status synthesis suppresses only the provider failure a complete observation
# superseded, or a classified complete provider failure whose owed continuation succeeded;
# every other Result below keeps its own combination, and an attempt whose
# advance was recorded runs the advance's own continuation instead of the ordinary one.
def finish_pending(+db: String, +session: String, +id: String, +attempt: String, +log: String, +cursor: String, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), acknowledge: Unit -> IO(Result<&1,&1,U32 & String,Unit>), +superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +failed : Bool <- outcome_failed(db,outcome)
    +transient : Bool <- transient_provider_error(db,outcome)
    +exhaustion : String <- Subs.exhaustion_cause(db,terminal_event(outcome))
    +exhausted : Bool = Bool.not(String.is_empty(exhaustion))
    +normal : Bool = Bool.and(Bool.not(failed),Bool.and(Bool.not(transient),Bool.not(Bool.or(superseded,exhausted))))
    reminder : Result<&1,&1,U32 & String,String> <- Bool.pick(IO(Result<&1,&1,U32 & String,String>),normal,
      DB.Sql.query(db,C.task_continuation_sql(session,id)),
      IO.pure(Result<&1,&1,U32 & String,String>,Done{""}))
    reminder0 : Result<&1,&1,U32 & String,Unit> = Delivery.wake_result(reminder)
    reminder_unit : Result<&1,&1,U32 & String,Unit> <- report_reminder_pass(db,session,id,reminder0)
    owed : Bool <- wake_owed(db,session,cursor)
    delivery_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,Turn.finish(db,session,id,log,outcome,True{}))
    continued_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),Bool.or(superseded,exhausted),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),continue_pending(db,session,cursor,previous => again(Bool.pick(String,Bool.and(failed,transient),attempt,previous)))))
    finished : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,delivery_task)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    stopped : Bool <- Stop.stopped(db,session)
    ack : Result<&1,&1,U32 & String,Unit> <- acknowledge_if_observed(Bool.and(native_observation_failed(outcome),Bool.not(stopped)),acknowledge)
    next0 : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,continued_task)
    next : Result<&1,&1,U32 & String,Unit> <- report_continuation_pass(db,session,id,attempt,next0)
    finish_pending_result(finished,questions,ack,failed,superseded,outcome,transient,owed,next,reminder_unit)

# Retirement follows acknowledgment on the same attempt handle: the shared
# owner frees the attempt slot and advances its generation once the attempt
# is acknowledged. The combined result keeps an acknowledgment failure
# first, so a failed marker write still reports its own error. The durable
# admission ticket is removed only after the acknowledgment succeeded.
def ack_retire_ticket(+db: String, +session: String, +attempt: String, +handle: U32, acked: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match acked:
    case Done{unit}: do IO<Result<&1,&1,U32 & String,Unit>>:
      cleaned : Unit <- Store.delete_ticket(db,session,attempt)
      retired : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.retire(handle)
      IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(Done{Unit{}},retired))
    case Fail{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
      retired : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.retire(handle)
      IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(Fail{error},retired))

def ack_then_retire(+db: String, +session: String, +attempt: String, +handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    acked : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.acknowledge(handle)
    ack_retire_ticket(db,session,attempt,handle,acked)

def completed_wake(+db: String, session: String, cursor: String, finished: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    woke : Result<&1,&1,U32 & String,Unit> <- wake_due(db,session,cursor,target => wake_launch(db,target))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(finished,woke))

# The wake follows a completion that recorded no advance: an advance's own continuation
# drains the owed input, and a completion failure keeps its own result from here.

def wake_starting_result(phase: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match phase:
    case Fail{error}: IO.pure(Bool,True{})
    case Done{output}: IO.pure(Bool,String.eq(Tx.trim_nl(output),"starting"))

def wake_starting(db: String, session: String) -> IO(Bool):
  do IO<Bool>:
    phase : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"SELECT phase FROM executions WHERE session=" ++ C.q(session) ++ ";")
    wake_starting_result(phase)

def failed_wake(starting: Bool, db: String, session: String, cursor: String, error: U32 & String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match starting:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case False{}: completed_wake(db,session,cursor,Fail{error})

def wake_if_kept(+db: String, +session: String, cursor: String, superseded: Bool, finished: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match superseded:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,finished)
    case False{}: match finished:
      case Done{unit}: completed_wake(db,session,cursor,Done{unit})
      case Fail{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
        starting : Bool <- wake_starting(db,session)
        failed_wake(starting,db,session,cursor,error)

# Record an ended adopted attempt with unknown status, preserve its stdout,
# and retire its capability before continuing with the pending inbox.
def completed_orphan_final(+db: String, +session: String, +id: String, +log: String, attempt: String, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), combined: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match combined:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: do IO<Result<&1,&1,U32 & String,Unit>>:
      finished : Result<&1,&1,U32 & String,Unit> <- finish_pending(db,session,id,attempt,log,"0",outcome,deliveries,again,u => IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),False{})
      wake_if_kept(db,session,"0",False{},finished)

def completed_orphan(+db: String, +session: String, +id: String, +log: String, +attempt: String, stderr: String, +handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    prepared : Unit <- Turn.prepare(db,session,id,log,stderr,outcome)
    combined : Result<&1,&1,U32 & String,Unit> <- ack_then_retire(db,session,attempt,handle)
    observer_released : Unit <- release_observer(lock)
    completed_orphan_final(db,session,id,log,attempt,outcome,deliveries,again,combined)

# Successful observations and complete recoverable provider errors resume all owed
# input. Other failures retain the attempt cursor. A recorded profile advance runs
# its own continuation, and completion operations preserve their results.
# An adopted monitor handle refuses release; its custody stays open so a later
# retry can restore the same attempt. Every other handle releases normally.
def release_native(db: String, +handle: U32) -> IO(Unit):
  do IO<Unit>:
    +monitor : Bool <- Observer.monitor_handle(db,handle)
    Bool.pick(IO(Unit),monitor,IO.pure(Unit,Unit{}),IO.try(Unit,P.ProcessChild.release(handle)))

def completed(+db: String, +session: String, +id: String, +log: String, +attempt: String, stderr: String, +cursor: String, +handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), +superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +failed : Bool <- outcome_failed(db,outcome)
    transient : Bool <- transient_provider_error(db,outcome)
    +pending_cursor : String <- IO.pure(String,Bool.pick(String,Bool.and(failed,Bool.not(Bool.and(transient,observation_clear(outcome)))),cursor,"0"))
    attempt_current : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(session) ++ "),'');"))
    account_settled : Unit <- Turn.settle_account_attempt(db,Tx.trim_nl(attempt_current),outcome)
    prepared : Unit <- Turn.prepare(db,session,id,log,stderr,outcome)
    settled : Unit <- Accounts.attempt_settled(db,session,attempt,failed,terminal_event(outcome))
    observer_released : Unit <- release_observer(lock)
    native_released : Unit <- release_native(db,handle)
    finished : Result<&1,&1,U32 & String,Unit> <- finish_pending(db,session,id,attempt,log,pending_cursor,outcome,deliveries,again,u => ack_then_retire(db,session,attempt,handle),superseded)
    wake_if_kept(db,session,pending_cursor,superseded,finished)

# The recovery input records the workspace state and makes clearing the refused
# identity atomic. Replaying the old attempt preserves a later native identity.
def recovery_input(db: String, +session: String, +id: String, native: String, note: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;"
      ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":recovery-input") ++ ",id,id,'recovery'," ++ C.q(note) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND native=" ++ C.q(native) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"
      ++ "UPDATE sessions SET native='' WHERE id=" ++ C.q(session) ++ " AND changes()=1;"
      ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":recovery") ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q("The recorded conversation could not be resumed; pending input will continue in a fresh conversation with the workspace's current state.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL AND EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":recovery-input") ++ ");COMMIT;"))
    IO.pure(Unit,Unit{})

def record_recovery(db: String, session: String, id: String, native: String, cwd: String, recorded: Bool) -> IO(Unit):
  match recorded:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      note : String <- Turn.refused_note(cwd,"")
      recovery_input(db,session,id,native,note)

def restart_pending(+db: String, +session: String, +id: String, +attempt: String, +cursor: String, native: String, cwd: String, +handle: U32, lock: Maybe<U32>, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":recovery-input") ++ ");"))
    saved : Unit <- record_recovery(db,session,id,native,cwd,String.eq(recorded,"1\n"))
    observer_released : Unit <- release_observer(lock)
    native_released : Unit <- release_native(db,handle)
    delivery_task : Chan(Result<&1,&1,U32 & String,String>) <- IO.fork(Result<&1,&1,U32 & String,String>,Delivery.deliver(db,id ++ ":recovery","1",""))
    next : Result<&1,&1,U32 & String,Unit> <- again(attempt)
    woken : Result<&1,&1,U32 & String,Unit> <- wake_due(db,session,cursor,launch => wake_launch(db,launch))
    delivered : Result<&1,&1,U32 & String,String> <- IO.join(Result<&1,&1,U32 & String,String>,delivery_task)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
    cleaned : Unit <- Store.delete_ticket(db,session,attempt)
    retired : Unit <- IO.try(Unit,Custody.Instance.retire(handle))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(Delivery.wake_result(delivered),Turn.combine(questions,Turn.combine(next,woken))))

def complete_or_restart(db: String, session: String, id: String, log: String, stderr: String, attempt: String, cursor: String, native: String, cwd: String, handle: U32, lock: Maybe<U32>, outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), gone: Bool, superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match gone:
    case False{}: completed(db,session,id,log,attempt,stderr,cursor,handle,lock,outcome,deliveries,again,superseded)
    case True{}: restart_pending(db,session,id,attempt,cursor,native,cwd,handle,lock,deliveries,again)

def observed(+db: String, +session: String, +id: String, +log: String, cursor: String, +native: String, cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    exited : Unit <- Turn.record_exit(db,session,id,log,outcome)
    closed : Bool <- Stop.stopped(db,session)
    gone : Bool <- Turn.refusal(attempt ++ "/native.stderr",Bool.not(String.is_empty(native)),outcome)
    retained : Bool <- IO.pure(Bool,Bool.and(Bool.not(native_observation_failed(outcome)),Bool.and(gone,Bool.not(closed))))
    complete_or_restart(db,session,id,log,attempt ++ "/native.stderr",attempt,cursor,native,cwd,handle,lock,outcome,deliveries,again,retained,superseded)

def reconciled_cursor(cursor: String, adopted: Bool, outcome: Turn.Outcome) -> String:
  match adopted:
    case False{}: cursor
    case True{}: match outcome:
      case Turn.Ended{status,event,error,incomplete}:
        Bool.pick(String,Bool.and(String.eq(status,"unknown after keeper loss"),Bool.and(String.is_empty(event),String.is_empty(error))),"0",cursor)

def observed_output(db: String, session: String, id: String, log: String, cursor: String, native: String, cwd: String, attempt: String, handle: U32, lock: Maybe<U32>, observation: Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool, superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  (outcome,deliveries)=observation
  +current=outcome
  observed(db,session,id,log,reconciled_cursor(cursor,adopted,current),native,cwd,attempt,handle,lock,current,deliveries,again,superseded)

# --- subscription profile handoff (#702) -------------------------------------
#
# Receive and direct turns share the account handoff helpers in Subs.

# The guidance message is written only for this session and names the retained attempt the
# continuation resumes, so a session that already holds owed input is left untouched.
def handoff_guidance(db: String, +session: String, id: String, attempt: String) -> IO(Unit):
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":handoff-guidance") ++ ",id,id,'guidance'," ++ C.q("The provider reported usage exhaustion and the subscription profile advanced to the next operator-listed account. Continue the original retained attempt " ++ attempt ++ " on this binding.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"))
    IO.pure(Unit,Unit{})

# After a successful cleanup and a recorded handoff the same actor continues on the binding
# the advance recorded. The guidance belongs only when the whole inbox holds nothing for this
# session, which the zero cursor asks for: the attempt cursor excludes the input that attempt
# already read, so a task the attempt never read would look empty there and the
# continuation would run without it. No read row is removed and no operator task is repeated.
def continue_after_advance(+db: String, +session: String, id: String, +attempt: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    owed : Bool <- wake_owed(db,session,"0")
    noted : Unit <- Bool.pick(IO(Unit),owed,IO.pure(Unit,Unit{}),handoff_guidance(db,session,id,attempt))
    again(attempt)

# The guidance message is written only for this session when a transient
# provider error interrupted its accepted task: the failed turn stays recorded with
# the provider's own cause, and the same actor continues the unfinished task
# on the same conversation. The task message that started it is already
# read.
def transient_guidance(db: String, +session: String, id: String, attempt: String) -> IO(Unit):
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":transient-guidance") ++ ",id,id,'guidance'," ++ C.q("The attempt ended with a transient provider error. Continue the unfinished task on the retained attempt " ++ attempt ++ " in the same conversation and account; the failed turn stays recorded with the provider cause.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"))
    IO.pure(Unit,Unit{})

# After a recorded transient failure with nothing owed, the same actor resumes
# its retained attempt: the guidance above names the attempt, and the existing
# wake driver fires it on the same binding.
def resume_after_transient(+db: String, +session: String, id: String, +attempt: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    noted : Unit <- transient_guidance(db,session,id,attempt)
    again(attempt)

# A selected transient continuation reuses the handoff completion distinction: only a
# cleanly observed path resumes. Any delivery, settlement, finish, or acknowledgment
# failure keeps its own result and launches nothing, while the failed turn row stays
# recorded from the outcome itself.
def transient_continue(db: String, session: String, id: String, attempt: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>), observed: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: resume_after_transient(db,session,id,attempt,again)

# One completion for the non-advanced path: without a selected continuation the
# observed path runs exactly as before, with one it runs without the ordinary
# continuation and without the classified provider exit-status failure, so a clean
# observation returns Done and only then resumes. A task queued during completion is
# never drained twice: the ordinary wake stands down for the suppressed run and the
# explicit resume is the single continuation.
def completed_transient(+db: String, +session: String, +id: String, log: String, cursor: String, native: String, cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool, proceed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match proceed:
    case False{}: observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,lock,(outcome,deliveries),again,adopted,False{})
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      observed : Result<&1,&1,U32 & String,Unit> <- observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,lock,(outcome,deliveries),u => IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),adopted,True{})
      transient_continue(db,session,id,attempt,again,observed)

# The transient continuation is decided before the observed path runs its ordinary
# pending-input continuation, so one failure routes exactly one continuation: a failed
# terminal provider error with a completely observed outcome, an unstopped session, and
# an empty inbox. Anything else keeps the observed result untouched.
def transient_precheck(+db: String, +session: String, +outcome: Turn.Outcome) -> IO(Bool):
  do IO<Bool>:
    failed : Bool <- outcome_failed(db,outcome)
    transient : Bool <- transient_provider_error(db,outcome)
    closed : Bool <- Stop.stopped(db,session)
    owed : Bool <- wake_owed(db,session,"0")
    IO.pure(Bool,Bool.and(failed,Bool.and(transient,Bool.and(Bool.not(closed),Bool.and(Bool.not(owed),Bool.not(native_observation_failed(outcome)))))))

# One completion shared by a fresh start and a recovered observation: the provider
# outcome decides whether a profile advance is recorded, an exhausted terminal advances
# through this same path for a recovered attempt too, and a recorded advance is handed to
# the exit-status synthesis so only the provider failure a complete observation superseded
# is suppressed. The advance's continuation runs exactly once and only after the observed
# path completed cleanly, so a real delivery, settlement, acknowledgment or retirement
# failure keeps its own result and launches nothing.
def advanced_completed(db: String, session: String, id: String, attempt: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>), observed: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: continue_after_advance(db,session,id,attempt,again)

def completed_profile(+db: String, +session: String, +id: String, log: String, cursor: String, native: String, cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool, superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match superseded:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      proceed : Bool <- transient_precheck(db,session,outcome)
      completed_transient(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again,adopted,proceed)
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      observed : Result<&1,&1,U32 & String,Unit> <- observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,lock,(outcome,deliveries),u => IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),adopted,True{})
      advanced_completed(db,session,id,attempt,again,observed)

# A route switch runs only on a complete, clean exhaustion terminal with no profile
# advanced. The shared Turn.route_observed decision requires the same completely
# observed availability episode as the Direct path; history and lineage append IO
# failures and stops keep the ordinary failed settlement.
def route_terminal(+db: String, +session: String, +id: String, outcome: Turn.Outcome) -> IO(Bool):
  match outcome:
    case Turn.Ended{status,event,error,incomplete}: Turn.route_observed(db,session,id,event,error,incomplete)

def route_decided(+db: String, +session: String, +id: String, +outcome: Turn.Outcome, advanced: Bool) -> IO(Bool):
  match advanced:
    case True{}: IO.pure(Bool,False{})
    case False{}: route_terminal(db,session,id,outcome)

# The recovery guidance for a route switch names the original assignment and the old
# native lineage. It is written even when other reports are owed, so the continuation
# carries its provenance on a busy session too.
def route_guidance(db: String, +session: String, id: String, attempt: String, native: String, harness: String, model: String) -> IO(Unit):
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":route-guidance") ++ ",id,id,'guidance'," ++ C.q("All subscription accounts refused with provider-reported usage exhaustion and the task continues on another operator-listed route: harness=" ++ harness ++ " model=" ++ model ++ ". Continue the original retained attempt " ++ attempt ++ " from the original assignment and context; the previous native conversation lineage is " ++ native ++ "; the failed turn stays recorded with the provider cause.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"))
    IO.pure(Unit,Unit{})

def route_applied(+db: String, +session: String, +id: String, +attempt: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>), native: String, log: String, +cause: String, +old_harness: String, old_model: String, +effort: String, chosen: Maybe<&2,Subs.Route>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match chosen:
    case None{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      noted : Unit <- Subs.report_route_unavailable(db,session,id,old_harness,cause)
      exit_status(True{})
    case Some{+route}: do IO<Result<&1,&1,U32 & String,Unit>>:
      noted : Unit <- Subs.report_route_chosen(db,session,id,route,cause)
      configured : String <- Control.configure(db,session,Subs.route_harness(route),Subs.route_model(route),effort,Subs.route_cmd(route),log,old_harness,old_model,effort)
      cleared : Unit <- Subs.clear_incompatible_native(db,session,old_harness,Subs.route_harness(route))
      guided : Unit <- route_guidance(db,session,id,attempt,native,Subs.route_harness(route),Subs.route_model(route))
      next : Result<&1,&1,U32 & String,Unit> <- again(attempt)
      IO.pure(Result<&1,&1,U32 & String,Unit>,next)

def route_continue(+db: String, +session: String, +id: String, +attempt: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>), native: String, log: String, outcome: Turn.Outcome) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +cause : String <- Subs.exhaustion_cause(db,terminal_event(outcome))
    +old_harness : String <- IO.try(String,DB.Sql.query(db,Subs.session_route_sql(db,session)))
    +old_model : String <- IO.try(String,DB.Sql.query(db,Subs.session_model_sql(db,session)))
    +effort : String <- IO.try(String,DB.Sql.query(db,"SELECT effort FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    chosen : Maybe<&2,Subs.Route> <- Subs.select_route(db,session,id)
    route_applied(db,session,id,attempt,again,native,log,cause,Tx.trim_nl(old_harness),Tx.trim_nl(old_model),Tx.trim_nl(effort),chosen)

# A selected route continuation reuses the suppressed-settle distinction: only a
# cleanly observed path continues. Any delivery, settlement, finish, or acknowledgment
# failure keeps its own result and launches nothing, while the failed turn row stays
# recorded from the outcome itself.
def route_after_advance(+db: String, +session: String, +id: String, +attempt: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>), native: String, log: String, outcome: Turn.Outcome, observed: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: route_continue(db,session,id,attempt,again,native,log,outcome)

def completed_routed(+db: String, +session: String, +id: String, +log: String, cursor: String, +native: String, +cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool, superseded: Bool, routed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match routed:
    case False{}: completed_profile(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again,adopted,superseded)
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      observed : Result<&1,&1,U32 & String,Unit> <- observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,lock,(outcome,deliveries),u => IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),adopted,True{})
      route_after_advance(db,session,id,attempt,again,native,log,outcome,observed)

def completed_observation(+db: String, +session: String, +id: String, log: String, cursor: String, +native: String, +cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, observation: Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool, cmd: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  (+outcome,deliveries)=observation
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +conversation : String <- Turn.direct_conversation(db,session,native)
    +superseded : Bool <- Accounts.handoff(db,session,id,terminal_event(outcome),conversation,cmd,cwd)
    routed : Bool <- route_decided(db,session,id,outcome,superseded)
    completed_routed(db,session,id,log,cursor,conversation,cwd,attempt,handle,lock,outcome,deliveries,again,adopted,superseded,routed)

def started(+db: String, +session: String, +id: String, +log: String, cursor: String, native: String, cwd: String, +attempt: String, harness: String, level: String, lock: U32, start: P.RetainedStart, again: String -> IO(Result<&1,&1,U32 & String,Unit>), cmd: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match start:
    case P.Retained{+handle}: do IO<Result<&1,&1,U32 & String,Unit>>:
      reconciled : Unit <- Stop.started(db,session,id,attempt)
      observation : Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- Turn.retained_output(db,session,id,log,harness,attempt,attempt,handle,Omp.filter_events(level))
      completed_observation(db,session,id,log,cursor,native,cwd,attempt,handle,Some{lock},observation,again,False{},cmd)
    case P.Unstarted{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +outcome : Turn.Outcome <- IO.pure(Turn.Outcome,Turn.Ended{"start failed","","Player process could not start: " ++ error,True{}})
      exited : Unit <- Turn.record_exit(db,session,id,log,outcome)
      prepared : Unit <- Turn.prepare(db,session,id,log,attempt ++ "/native.stderr",outcome)
      cleaned : Unit <- Store.delete_ticket(db,session,attempt)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      finish_pending(db,session,id,attempt,log,cursor,outcome,Nil{},again,u => IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),False{})

def started_result(start: Result<&1,&1,U32 & String,P.RetainedStart>, +db: String, +session: String, +id: String, +log: String, cursor: String, native: String, cwd: String, +attempt: String, harness: String, level: String, +lock: U32, again: String -> IO(Result<&1,&1,U32 & String,Unit>), cmd: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match start:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{+value}: started(db,session,id,log,cursor,native,cwd,attempt,harness,level,lock,value,again,cmd)


# An admitted start takes the obligation under the held session lock before the
# native process exists: the claim names the head unread message as
# owner and fences the generation past any stale row, so a driver that dies
# before launch never suppresses the next wake.
#
# The receiver endpoint is also entered directly by retained endpoints, so the
# usage gate is checked under this admission's held session lock before any
# native process exists: a seat held by a live read starts the reset-time
# continuation, removes the execution row that this admission wrote, releases
# the lock and leaves the input owed. The message is not claimed, so the next
# wake still owns it.
def window_held_start(+db: String, +session: String, +id: String, +head: String, +lock: U32, gate: UW.Gate) -> IO(Bool):
  match gate:
    case UW.GateHeld{+window,+resets_at,+source,+receipt}:
      Bool.pick(IO(Bool),String.is_empty(head),
        IO.pure(Bool,False{}),
        do IO<Bool>:
          held : Unit <- UW.held(db,session,head,"start",UW.GateHeld{window,resets_at,source,receipt})
          cleared : Unit <- Stop.held_release(db,session,id)
          released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
          IO.pure(Bool,True{}))
    case other: IO.pure(Bool,False{})

def start_admitted(+db: String, +session: String, +id: String, +cmd: String, route: String, thinking: String, +workspace: String, +log: String, +lock: U32, cursor: String, +native: String, +attempt: String, +harness: String, storage: String, prompt: String, recovery: String, predecessor: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>), allowed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match allowed:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Session is terminally stopped; queued input will not execute. Read its session and retained inbox.")})
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +head : String <- wake_found(db,session,"0")
      +conversation : String <- Turn.direct_conversation(db,session,native)
      checked : Unit <- Accounts.order_move(db,session,conversation,cmd,workspace)
      +label : String <- Accounts.handoff_label_io(db,session)
      gate : UW.Gate <- UW.window_gate(db,session,Tx.trim_nl(label))
      held : Bool <- window_held_start(db,session,id,head,lock,gate)
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),held,
        IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),
        Storage.with_writer_leases(Result<&1,&1,U32 & String,Unit>, log, attempt,
          error => do IO<Result<&1,&1,U32 & String,Unit>>:
            released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
            IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error}),
          unit => do IO<Result<&1,&1,U32 & String,Unit>>:
            owned : Unit <- Store.claim(db,session,head)
            +claim_owner : String <- Store.claim_owner(db,session)
            +claim_generation : String <- Store.claim_generation(db,session)
            retained_ticket : Unit <- Store.retain_ticket(db,session,attempt,Tx.trim_nl(claim_owner),Tx.trim_nl(claim_generation))
            +policy : Logs.Policy <- Logs.policy(db,session)
            +level : String <- IO.pure(String,Turn.policy_level(policy))
            start_result : Result<&1,&1,U32 & String,P.RetainedStart> <- Turn.retained(db,session,attempt,cmd,route,thinking,workspace,native,harness,storage,prompt,lock,recovery,level,predecessor)
            started_result(start_result,db,session,id,log,cursor,native,workspace,attempt,harness,level,lock,again,cmd)))

def input_text(decoded: Req.Scalar) -> IO(String):
  match decoded:
    case Req.ScalarText{value}: IO.pure(String,value ++ "\n")
    case other: IO.die(String,22,"Complete selected input could not be decoded: " ++ Req.scalar_reason(other))

# The invocation's own admitted attempt identity travels out through this
# channel. A concurrent receiver can replace the session's execution row; it
# cannot write this invocation's channel. The collector keeps the last identity
# the admission path reported, which is this invocation's current attempt.
# Fold admitted attempt IDs without reading the session execution row.
@unsafe
def collect_admitted(+updates: Chan(String), last: String, next: Maybe<&1,String>) -> IO(String):
  match next:
    case None{}: IO.pure(String,last)
    case Some{+value}: do IO<String>:
      following : Maybe<&1,String> <- Chan.recv(String,updates)
      collect_admitted(updates,value,following)

@unsafe
def collect_admitted_start(+updates: Chan(String)) -> IO(String):
  do IO<String>:
    first : Maybe<&1,String> <- Chan.recv(String,updates)
    collect_admitted(updates,"",first)

# The receiver drains invocation-owned admissions when it does not return them.
@unsafe
def discard_admitted(+updates: Chan(String), next: Maybe<&1,String>) -> IO(Unit):
  match next:
    case None{}: IO.pure(Unit,Unit{})
    case Some{value}: do IO<Unit>:
      following : Maybe<&1,String> <- Chan.recv(String,updates)
      discard_admitted(updates,following)

@unsafe
def discard_admitted_start(+updates: Chan(String)) -> IO(Unit):
  do IO<Unit>:
    first : Maybe<&1,String> <- Chan.recv(String,updates)
    discard_admitted(updates,first)

def selected(+db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +lock: U32, +cursor: String, present: Bool, again: String -> IO(Result<&1,&1,U32 & String,Unit>), predecessor: String, +updates: Chan(String)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match present:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      continue_pending(db,session,cursor,again)
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +executable : String <- IO.try(String,Lock.SessionLock.executable())
      +harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
      supported : Unit <- Turn.supported_harness(Bool.or(String.eq(harness,"omp\n"),Bool.or(String.eq(harness,"codex\n"),Bool.or(String.eq(harness,"claude-code\n"),Bool.or(String.eq(harness,"muse\n"),Bool.or(String.eq(harness,"dsh\n"),String.eq(harness,"antigravity\n")))))))
      +native : String <- field(db,session,"native","")
      +route : String <- field(db,session,"model",model)
      +thinking : String <- field(db,session,"effort",effort)
      +workspace : String <- field(db,session,"workspace",cwd)
      storage : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
      ident : String <- IO.try(String,DB.Sql.query(db,"SELECT 'receive:' || " ++ C.q(session) ++ " || ':' || CAST(" ++ C.q(cursor) ++ " AS INTEGER) || ':' || lower(hex(randomblob(16)));"))
      +id : String <- IO.pure(String,Tx.trim_nl(ident))
      +selection : String <- IO.try(String,DB.Sql.query(db,MessageStatus.prompt_selection_sql(session,cursor)))
