import Base
import ../coordinator/commands.bend as C
import ./../coordinator/logs.bend as Logs
import ../harness/omp-player.bend as Omp
import ./store.bend as Store
import ./stop.bend as Stop
import ./subscription-fallback.bend as Subs
import ./turn.bend as Turn
import ./native-requests.bend as NativeRequests
import ./delivery.bend as Delivery
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../host/process.bend as P
import ../host/instance.bend as Custody
import ../host/files.bend as F
import ../host/control.bend as Host
import ../git/text.bend as Tx
import ../git/process.bend as Proc
import ../git/types.bend as T
import ../host/text.bend as Text

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
  +command = shell(executable) ++ " " ++ shell(database)
  "You are session " ++ session ++ " in a Baton2 Orchestra. A Player is an individual agent. Review pending messages and follow your task.\n"
  ++ "Recorded orientation: " ++ orientation ++ "\n"
  ++ "The Principal Conductor is the main orchestrator. An Associate Conductor is a sub-orchestrator. An Ensemble is a coordinated team of agents. A Section is a capability-specific subgroup. The Orchestra is the whole coordinated system. When coordinating players, direct their work according to your task.\n"
  ++ "The players command lists all Players, including Principal and Associate Conductors. PLAYER denotes a player session ID.\n"
  ++ "Public messages follow assigned roles, parent links and explicit tight Ensemble membership. A Conductor can message its descendants; report and ask reach your immediate parent. Peer messages require a shared tight Ensemble.\n"
  ++ "Coordinator CLI:\n  " ++ command ++ " inbox " ++ shell(session) ++ "\n  " ++ command ++ " ack MESSAGE_ID " ++ shell(session) ++ " RECEIPT\n"
  ++ "Acknowledge each message after accepting it.\n  " ++ command ++ " orchestra\n  " ++ command ++ " players\n  " ++ command ++ " session ID\n  " ++ command ++ " worktree ID\n  " ++ command ++ " turns ID\n"
  ++ "Use join for Players working in an existing checkout. Use recruit when the task needs a separate worktree.\n"
  ++ "  " ++ command ++ " join PLAYER " ++ shell(session) ++ " HARNESS MODEL EFFORT WORKSPACE\n"
  ++ "  " ++ command ++ " recruit PLAYER " ++ shell(session) ++ " HARNESS MODEL EFFORT REPO BRANCH PATH BASE\n"
  ++ "  " ++ command ++ " receiver PLAYER HARNESS_CMD OUTPUT_LOG [CWD]\n  " ++ command ++ " dispatch-file ID " ++ shell(session) ++ " PLAYER task TASK_FILE\n"
  ++ "  " ++ command ++ " dispatch-turn PLAYER TURN_ID HARNESS_CMD OUTPUT_LOG TASK_FILE\n  " ++ command ++ " status --pretty\n"
  ++ "  " ++ command ++ " message ID " ++ shell(session) ++ " PLAYER guidance BODY\n  " ++ command ++ " land PLAYER REPO TARGET [--commit COMMIT]\n  " ++ command ++ " land-checked PLAYER REPO TARGET CHECK FILES [--commit COMMIT]\n  " ++ command ++ " push REPO TARGET REMOTE\nland and land-checked default to the recorded branch tip; --commit selects an ancestor.\n"
  ++ "For source work, coordinate edits in the shared checkout and commit completed changes. Include the intended target branch and remaining work in your report. When a Player reports completed work, its Conductor integrates that contribution into the target and pushes it to the requested remote. Use land for a fast-forward contribution; reconcile divergent contributions into the target with ordinary Git operations and source edits. After the Player's owned turn finishes, move that same Player to the shared checkout with receiver PLAYER HARNESS_CMD OUTPUT_LOG SHARED_CWD. This preserves its native conversation, parent, base and retained input, and records the shared checkout's current branch. Then use ordinary git worktree remove and git branch -d for its clean, inactive temporary checkout and fully integrated task branch. Preserve checkouts used by active Players, unfinished changes and later unintegrated commits. Keep the shared checkout, target branch and explicit stops available.\n"
  ++ "  " ++ command ++ " role SESSION\n  " ++ command ++ " role SESSION player|principal-conductor|associate-conductor|operator\n  " ++ command ++ " ensemble ENSEMBLE\n  " ++ command ++ " ensemble ENSEMBLE OWNER [loose|tight]\n  " ++ command ++ " ensemble-member ENSEMBLE OWNER PLAYER add|remove\n  " ++ command ++ " section ENSEMBLE SECTION [OWNER CAPABILITY]\n  " ++ command ++ " section-member ENSEMBLE SECTION OWNER PLAYER add|remove\n"
  ++ "  " ++ command ++ " native-reply " ++ shell(session) ++ " REQUEST RESPONSE_JSON\n  " ++ command ++ " native-reply-file " ++ shell(session) ++ " REQUEST PATH\n"
  ++ "  " ++ command ++ " record FINDING_ID " ++ shell(session) ++ " CLAIM EVIDENCE LIMITS\n  " ++ command ++ " knowledge " ++ shell(session) ++ "\n"
  ++ "  " ++ command ++ " promote PROMOTION_ID " ++ shell(session) ++ " SOURCE " ++ shell(session) ++ " FINDING_ID\n"
  ++ "Author findings from reviewed evidence. Cite the source of the finding and state the claim's limits. A message:MESSAGE_ID reference includes the retained message body. knowledge lists every finding visible to your session, with its cited evidence and promotion history. Review a finding before explicitly promoting it from its recorded SOURCE into your own scope; its original author remains recorded. A promotion notice names a finding shared into your scope. Retrieve it with knowledge, review its evidence and decide which players should receive a message about it.\n"
  ++ "Run coordinator operations through these CLI commands. Use receiver then dispatch-file for Codex, OMP, Muse and Claude Players. dispatch-turn also launches a recorded Player directly. Dispatch returns the launched delivery PID; inspect turns, inbox and output logs for completion. These commands take identity and workspace from the recorded assignment and apply configured model Git identities. Dispatch independent Players concurrently and finish your native turn so their reports can continue your session.\n\n"

def receive_status(db: String, session: String, status: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('session'," ++ C.q(session) ++ ",'status'," ++ C.q(status) ++ ");"))
    Text.Text.control_output(result)

def exit_status(failed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match failed:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(1,"Native receive failed; read the retained native log and pending inbox.")})

# A terminal's latest assistant can record an OMP failure with host exit zero.
def outcome_failed(db: String, outcome: Turn.Outcome) -> IO(Bool):
  match outcome:
    case Turn.Ended{+status,+event,+error,incomplete}: do IO<Bool>:
      failure : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(event) ++ "='' THEN 1 WHEN coalesce(json_extract(" ++ C.q(event) ++ ",'$.is_error'),0)=1 THEN 1 ELSE " ++ C.omp_terminal_error_sql(event) ++ " END;"))
      IO.pure(Bool,Bool.or(Turn.failed(status,event,error),String.eq(failure,"1\n")))

def native_observation_failed(outcome: Turn.Outcome) -> Bool:
  match outcome:
    case Turn.Ended{status,event,error,incomplete}: incomplete

# True only when a recorded advance may stand in for the provider's own exit failure: the
# observation completed and recorded no error, so an incomplete observation or a real
# observation or logging failure keeps its own aggregate native failure.
def superseding(superseded: Bool, outcome: Turn.Outcome) -> Bool:
  (+status,+event,+error,+incomplete)=outcome
  Bool.and(superseded,Bool.and(Bool.not(incomplete),String.is_empty(error)))

# A clean completion of the whole observed path: observation, delivery, question
# settlement, acknowledgment and retirement each returned their own success. A failure
# there keeps its own result and runs no continuation, so a real cleanup failure never
# launches the next profile.
def finished_clean(result: Result<&1,&1,U32 & String,Unit>) -> Bool:
  match result:
    case Done{unit}: True{}
    case Fail{error}: False{}

def continue_if(again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), present: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match present:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: again(Unit{})

# How much input is still owed after the cursor. Busy writers have committed
# before trying the lock, so the owner reads this again after releasing it.
def pending_count_sql(+session: String, cursor: String) -> String:
  "SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"

# The message the wake hands to the invocation. It is the first unacknowledged
# message after the cursor, so the wake never re-delivers input the attempt
# already carried. Claim writers record it as the obligation owner.
def wake_found(db: String, session: String, cursor: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,DB.Sql.query(db,Delivery.wake_sql(session,cursor)))
    IO.pure(String,Tx.trim_nl(found))

# The continuation takes the session lock and re-reads the count while holding
# it, so the in-invocation continuation and the wake driver cannot both proceed
# for one session. The claim records the driver that took the obligation.
def continue_owned(+db: String, +session: String, +cursor: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), lock: Maybe<U32>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match lock:
    case None{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Some{handle}: do IO<Result<&1,&1,U32 & String,Unit>>:
      pending : String <- IO.try(String,DB.Sql.query(db,pending_count_sql(session,cursor)))
      head : String <- wake_found(db,session,cursor)
      claimed : Unit <- Store.claim(db,session,head)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      continue_if(again,Bool.not(String.eq(pending,"0\n")))

def continue_locked(+db: String, +session: String, +cursor: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), owed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match owed:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: Lock.SessionLock.acquire_session(Result<&1,&1,U32 & String,Unit>,db,session,
      +canonical => lock => continue_owned(canonical,session,cursor,again,lock))

def continue_pending(+db: String, +session: String, +cursor: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    pending : String <- IO.try(String,DB.Sql.query(db,pending_count_sql(session,cursor)))
    continue_locked(db,session,cursor,again,Bool.not(String.eq(pending,"0\n")))

# The lock holder deletes the claim row only once nothing is owed and no
# retained attempt is recorded live. A finished turn with unacknowledged input
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
# claim. The holder deletes the row only when no unacknowledged input remains
# and host custody observes the recorded attempt dead, so a finished turn that
# still owes input keeps the obligation for the next driver. The delete names
# the exact ticket read under this same hold, so it removes nothing a newer
# admission wrote. Takeover never reads the row for custody: any driver that
# takes the lock may claim again once custody is observed dead, so a dead
# owner never suppresses the wake. Acknowledging the owed input deletes the row
# on the acknowledgement path; an admitted stop deletes it on the stop path.
def settle_owned(+db: String, +session: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.pure(Unit,Unit{})
    case Some{handle}: do IO<Unit>:
      +owner : String <- Store.claim_owner(db,session)
      +generation : String <- Store.claim_generation(db,session)
      pending : String <- IO.try(String,DB.Sql.query(db,pending_count_sql(session,"0")))
      dir : String <- IO.try(String,DB.Sql.query(db,attempt_dir_sql(session)))
      +trimmed : String <- IO.pure(String,Tx.trim_nl(dir))
      dead : Bool <- custody_dead(db,trimmed,String.is_empty(trimmed))
      left : Unit <- release_if_ticket(db,session,Tx.trim_nl(owner),generation,Bool.and(String.eq(pending,"0\n"),dead))
      unlocked : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      IO.pure(Unit,Unit{})

def claim_left(+db: String, +session: String) -> IO(Unit):
  Lock.SessionLock.acquire_session(Unit,db,session,
    +canonical => lock => settle_owned(canonical,session,lock))

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

# The wake reads the claim and retained attempt under the session lock. A
# retained attempt with unknown native status keeps its claim for public receive
# adoption. Observed native death updates the execution and admits the message.
def wake_fenced(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), lock: U32, owed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match owed:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      state : String <- Store.claim_state(db,session)
      dir : String <- IO.try(String,DB.Sql.query(db,attempt_dir_sql(session)))
      +trimmed : String <- IO.pure(String,Tx.trim_nl(dir))
      +dead : Bool <- custody_dead(db,trimmed,String.is_empty(trimmed))
      recovered : Unit <- recover_if_dead(db,session,dead)
      replay_cursor : String = Bool.pick(String,Bool.and(dead,Bool.not(String.is_empty(trimmed))),"0",cursor)
      wake_admit(db,session,replay_cursor,launch,lock,state,dead)

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

# The exit-status synthesis suppresses only the provider failure a complete observation
# superseded; every other Result below keeps its own combination, and an attempt whose
# advance was recorded runs the advance's own continuation instead of the ordinary one.
def finish_pending(+db: String, +session: String, id: String, log: String, cursor: String, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), acknowledge: Unit -> IO(Result<&1,&1,U32 & String,Unit>), superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +failed : Bool <- outcome_failed(db,outcome)
    delivery_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,Turn.finish(db,session,id,log,outcome))
    continued_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),superseded,IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),continue_pending(db,session,cursor,again)))
    finished : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,delivery_task)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    stopped : Bool <- Stop.stopped(db,session)
    ack : Result<&1,&1,U32 & String,Unit> <- acknowledge_if_observed(Bool.and(native_observation_failed(outcome),Bool.not(stopped)),acknowledge)
    status : Result<&1,&1,U32 & String,Unit> <- exit_status(Bool.and(failed,Bool.not(superseding(superseded,outcome))))
    next : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,continued_task)
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(finished,Turn.combine(questions,Turn.combine(next,Turn.combine(ack,status)))))

# Retirement follows acknowledgment on the same attempt handle: the shared
# owner frees the attempt slot and advances its generation once the attempt
# is acknowledged. The combined result keeps an acknowledgment failure
# first, so a failed marker write still reports its own error.
def ack_then_retire(+handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    acked : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.acknowledge(handle)
    retired : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.retire(handle)
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(acked,retired))

def completed_wake(+db: String, session: String, cursor: String, finished: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match finished:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: wake_due(db,session,cursor,target => wake_launch(db,target))

# The wake follows a completion that recorded no advance: an advance's own continuation
# drains the owed input, and a completion failure keeps its own result from here.
def wake_if_kept(db: String, session: String, cursor: String, superseded: Bool, finished: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match superseded:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,finished)
    case False{}: completed_wake(db,session,cursor,finished)

# The owed-input cursor keeps using the provider failure: a superseded attempt still
# leaves its input owed, and the advance's own continuation drains it, so the ordinary
# wake does not fire for that advance. A failure from the completion keeps its own result
# in every case.
def completed(+db: String, +session: String, +id: String, +log: String, stderr: String, +cursor: String, +handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    failed : Bool <- outcome_failed(db,outcome)
    +pending_cursor : String <- IO.pure(String,Bool.pick(String,failed,cursor,"0"))
    prepared : Unit <- Turn.prepare(db,session,id,log,stderr,outcome)
    observer_released : Unit <- release_observer(lock)
    native_released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
    finished : Result<&1,&1,U32 & String,Unit> <- finish_pending(db,session,id,log,pending_cursor,outcome,deliveries,again,u => ack_then_retire(handle),superseded)
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

def restart_pending(+db: String, +session: String, +id: String, +cursor: String, native: String, cwd: String, +handle: U32, lock: Maybe<U32>, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":recovery-input") ++ ");"))
    saved : Unit <- record_recovery(db,session,id,native,cwd,String.eq(recorded,"1\n"))
    observer_released : Unit <- release_observer(lock)
    native_released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
    delivery_task : Chan(Result<&1,&1,U32 & String,String>) <- IO.fork(Result<&1,&1,U32 & String,String>,Delivery.deliver(db,id ++ ":recovery","1",""))
    next : Result<&1,&1,U32 & String,Unit> <- again(Unit{})
    woken : Result<&1,&1,U32 & String,Unit> <- wake_due(db,session,cursor,launch => wake_launch(db,launch))
    delivered : Result<&1,&1,U32 & String,String> <- IO.join(Result<&1,&1,U32 & String,String>,delivery_task)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
    retired : Unit <- IO.try(Unit,Custody.Instance.retire(handle))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(Delivery.wake_result(delivered),Turn.combine(questions,Turn.combine(next,woken))))

def complete_or_restart(db: String, session: String, id: String, log: String, stderr: String, cursor: String, native: String, cwd: String, handle: U32, lock: Maybe<U32>, outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), gone: Bool, superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match gone:
    case False{}: completed(db,session,id,log,stderr,cursor,handle,lock,outcome,deliveries,again,superseded)
    case True{}: restart_pending(db,session,id,cursor,native,cwd,handle,lock,deliveries,again)

def observed(+db: String, +session: String, +id: String, +log: String, cursor: String, +native: String, cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    exited : Unit <- Turn.record_exit(db,session,id,log,outcome)
    closed : Bool <- Stop.stopped(db,session)
    gone : Bool <- Turn.refusal(attempt ++ "/native.stderr",Bool.not(String.is_empty(native)),outcome)
    complete_or_restart(db,session,id,log,attempt ++ "/native.stderr",cursor,native,cwd,handle,lock,outcome,deliveries,again,Bool.and(gone,Bool.not(closed)),superseded)

def reconciled_cursor(cursor: String, adopted: Bool, outcome: Turn.Outcome) -> String:
  match adopted:
    case False{}: cursor
    case True{}: match outcome:
      case Turn.Ended{status,event,error,incomplete}:
        Bool.pick(String,Bool.and(String.eq(status,"unknown after keeper loss"),Bool.and(String.is_empty(event),String.is_empty(error))),"0",cursor)

def observed_output(db: String, session: String, id: String, log: String, cursor: String, native: String, cwd: String, attempt: String, handle: U32, lock: Maybe<U32>, observation: Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool, superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  (outcome,deliveries)=observation
  +current=outcome
  observed(db,session,id,log,reconciled_cursor(cursor,adopted,current),native,cwd,attempt,handle,lock,current,deliveries,again,superseded)

# --- subscription profile handoff (#702) -------------------------------------
#
# Only a provider-stated usage exhaustion advances a profile; every other outcome keeps
# its behavior and cause. A handoff rebinds the credential store, leaving the session id,
# parentage, workspace, branch, task, pending messages and recorded native session
# untouched. Provider history storage across a store switch is #703's seam.
def file_text(path: String) -> IO(String):
  do IO<String>:
    read : Result<&1,&1,U32 & String,String> <- Text.Text.read(path)
    IO.pass(String,Subs.optional_text(read))

def profile_list_path(db: String) -> IO(String):
  do IO<String>:
    listed : String <- IO.try(String,DB.Sql.query(db,Subs.profile_list_sql(db)))
    IO.pure(String,Tx.trim_nl(listed))

def profile_record_path(db: String, session: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,Subs.profile_record_sql(db,session)))
    IO.pure(String,Tx.trim_nl(saved))

def terminal_event(outcome: Turn.Outcome) -> String:
  (+status,+event,+error,+incomplete)=outcome
  event

def current_outcome(observation: Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>) -> Turn.Outcome:
  (outcome,deliveries)=observation
  outcome

# The provider's own cause for a terminal frame that names usage exhaustion, or "" for
# every other outcome. A terminal that stated no event carries no cause, and its text is
# never read as JSON.
def exhaustion_cause(db: String, +event: String) -> IO(String):
  exhaustion_present(db,event,String.is_empty(event))

def exhaustion_present(db: String, event: String, empty: Bool) -> IO(String):
  match empty:
    case True{}: IO.pure(String,"")
    case False{}: exhaustion_stated(db,event)

def exhaustion_stated(+db: String, +event: String) -> IO(String):
  do IO<String>:
    stated : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ Subs.exhausted_sql(event) ++ ";"))
    reason : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(" ++ Subs.exhausted_reason_sql(event) ++ ",'');"))
    IO.pure(String,Bool.pick(String,String.eq(Tx.trim_nl(stated),"1"),Tx.trim_nl(reason),""))

# True only when a next operator-listed profile was recorded, so the caller continues the
# same actor; false when the list is exhausted, which terminates with the report.
def profile_handoff(+db: String, session: String, id: String, outcome: Turn.Outcome, native: String, cmd: String, cwd: String) -> IO(Bool):
  do IO<Bool>:
    +cause : String <- exhaustion_cause(db,terminal_event(outcome))
    advanced : Bool <- Bool.pick(IO(Bool),String.is_empty(cause),IO.pure(Bool,False{}),advance_profile(db,session,id,cause,native,cmd,cwd))
    IO.pure(Bool,advanced)

def history_path(+db: String, session: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,Subs.history_record_sql(db,session)))
    IO.pure(String,Tx.trim_nl(saved))

# The verdict of the sidecar write, at the head of the definition so the caller's do block
# ends on a term. A failed write reports its cause and returns false, so no profile is
# advanced and the original input stays owed.
def history_appended(db: String, session: String, id: String, path: String, variable: String, appended: Result<&1,&1,U32 & String,Unit>) -> IO(Bool):
  match appended:
    case Done{unit}: IO.pure(Bool,True{})
    case Fail{error}: match error:
      case (code,detail): do IO<Bool>:
        noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":profile-history-failed") ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q("subscription profile history home record failed at " ++ path ++ " for " ++ variable ++ ": " ++ U32.show(code) ++ ": " ++ detail ++ "; the provider cause stands and no profile was advanced.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
        IO.pure(Bool,False{})

def run_text(result: T.RunRes) -> String:
  match result:
    case T.RRun{T.SExit{code}, out}: out
    case T.RRun{T.SSignal{num}, out}: out
    case T.RSpawn{detail}: ""

# The packaged native history helper of the runtime this coordinator runs: the sibling of the
# identity helper the host resolves. The script is invoked as it is, so a runtime that does not
# install it fails this step with the helper's own cause and no history value is substituted
# for the answer it did not give.
def helper_script() -> IO(String):
  do IO<String>:
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
    (registry,helper)=identity
    IO.pure(String,Subs.history_helper(helper))

# The preserved history home for this handoff. The packaged native runtime helper reads the
# original account's effective provider history home and materializes what the next account
# needs, and its answer is recorded for the continuation to bind. A helper that fails
# reports its own cause and leaves the original input owed, so no profile is advanced.
def prepare_history(+db: String, +session: String, +id: String, +harness: String, +from_store: String, +cmd: String, +cwd: String, +native: String, decided: Maybe<Subs.Profile>) -> IO(Bool):
  match decided:
    case None{}: IO.pure(Bool,True{})
    case Some{profile}: prepare_history_variable(db,session,id,harness,from_store,cmd,cwd,native,profile,Subs.store_variable(harness))

def prepare_history_variable(+db: String, +session: String, id: String, harness: String, from_store: String, cmd: String, cwd: String, native: String, profile: Subs.Profile, selected: Maybe<String>) -> IO(Bool):
  match selected:
    case None{}: IO.pure(Bool,True{})
    case Some{variable}: do IO<Bool>:
      +path : String <- history_path(db,session)
      recorded : String <- file_text(path)
      last : String <- IO.pure(String,Subs.last_line(Tx.split_lines(recorded)))
      script : String <- helper_script()
      history_from_helper(db,session,id,harness,variable,from_store,path,profile,script,cmd,cwd,native,last)

# The helper's own answer is the sidecar line: it carries the provider history home, the
# source and selected stores, the native identity and the rollout and history paths, and the
# continuation reads its home from it. An answer that names no home is not a usable one.
def history_from_helper(db: String, session: String, id: String, +harness: String, variable: String, +from_store: String, path: String, profile: Subs.Profile, script: String, cmd: String, +cwd: String, native: String, existing: String) -> IO(Bool):
  do IO<Bool>:
    run : T.RunRes <- Proc.runFull(Subs.history_prepare_args(script,harness,cmd,cwd,native,from_store,profile.store,existing),cwd)
    history_helper_result(db,session,id,harness,variable,from_store,path,run)

def history_helper_result(+db: String, +session: String, +id: String, harness: String, variable: String, from_store: String, path: String, run: T.RunRes) -> IO(Bool):
  match run:
    case T.RRun{T.SExit{0}, out}: do IO<Bool>:
      +answer : String <- IO.pure(String,Subs.last_line(Tx.split_lines(Tx.trim_nl(out))))
      home : String <- IO.try(String,DB.Sql.query(db,Subs.history_home_sql(answer)))
      history_answered(db,session,id,variable,path,answer,Tx.trim_nl(home))
    case +other: do IO<Bool>:
      noted : Unit <- report_body(db,session,id,"profile-history-failed","the native history helper did not prepare the preserved provider history; the provider cause stands and no profile was advanced; helper exit and output: " ++ Tx.trim_nl(run_status(other)) ++ " " ++ Tx.trim_nl(run_text(other)))
      IO.pure(Bool,False{})

# A usable answer is recorded whole, so the sidecar keeps what the helper resolved.
def history_answered(+db: String, +session: String, +id: String, variable: String, path: String, answer: String, +home: String) -> IO<Bool>:
  history_answered_empty(db,session,id,variable,path,answer,String.is_empty(home))

def history_answered_empty(db: String, session: String, id: String, variable: String, path: String, answer: String, empty: Bool) -> IO<Bool>:
  match empty:
    case True{}: do IO<Bool>:
      noted : Unit <- report_body(db,session,id,"profile-history-failed","the native history helper answered without a provider history home; the provider cause stands and no profile was advanced; helper output: " ++ Tx.trim_nl(answer))
      IO.pure(Bool,False{})
    case False{}: history_recorded(db,session,id,variable,path,answer)

def run_status(result: T.RunRes) -> String:
  match result:
    case T.RRun{T.SExit{code}, out}: "exit " ++ U32.show(code)
    case T.RRun{T.SSignal{num}, out}: "signal " ++ U32.show(num)
    case T.RSpawn{detail}: detail

def history_recorded(db: String, session: String, id: String, variable: String, +path: String, line: String) -> IO<Bool>:
  do IO<Bool>:
    appended : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(path,Tx.trim_nl(line) ++ "\n")
    history_appended(db,session,id,path,variable,appended)

def advance_profile(+db: String, +session: String, +id: String, cause: String, native: String, cmd: String, cwd: String) -> IO(Bool):
  do IO<Bool>:
    +harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    list_path : String <- profile_list_path(db)
    listed : String <- file_text(list_path)
    +profiles : List<Subs.Profile> <- IO.pure(List<Subs.Profile>,Subs.profile_lines(Tx.split_lines(listed)))
    +record_path : String <- profile_record_path(db,session)
    +current : String <- file_text(record_path)
    +from_label : String <- IO.pure(String,Subs.record_label(Subs.last_line(Tx.split_lines(current))))
    from_store : String <- IO.pure(String,Subs.record_store(Subs.last_line(Tx.split_lines(current))))
    prepared : Bool <- prepare_history(db,session,id,Tx.trim_nl(harness),from_store,cmd,cwd,native,Subs.started_or_next(profiles,Tx.trim_nl(harness),from_label))
    taken : Bool <- Bool.pick(IO(Bool),prepared,choose_profile(db,session,id,record_path,Tx.trim_nl(harness),from_label,cause,Subs.started_or_next(profiles,Tx.trim_nl(harness),from_label)),IO.pure(Bool,False{}))
    IO.pure(Bool,taken)

def choose_profile(db: String, session: String, id: String, record_path: String, harness: String, from_label: String, cause: String, decided: Maybe<Subs.Profile>) -> IO(Bool):
  match decided:
    case Some{+profile}: record_and_report(db,session,id,record_path,harness,from_label,profile,cause)
    case None{}: report_all_refused(db,session,id,harness,from_label,cause)

# The record is append-only, so the next spawn reads the profile now bound; the report
# names the account change and keeps the provider's own cause. Nothing here touches a
# message receipt, so the original task input stays owed and the same actor's own wake
# driver fires it against the new binding.
def append_ok(result: Result<&1,&1,U32 & String,Unit>) -> Bool:
  match result:
    case Done{unit}: True{}
    case Fail{error}: False{}

def append_error(result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{unit}: ""
    case Fail{error}: match error:
      case (code,detail): U32.show(code) ++ ": " ++ detail

def report_body(db: String, session: String, id: String, kind: String, body: String) -> IO<Unit>:
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":" ++ kind) ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q(body) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
    IO.pure(Unit,Unit{})

# The append is observed: the advance proceeds only on success. A failed append reports
# the IO failure against this attempt and returns false, so no continuation runs and the
# attempt's own outcome, cause and owed input stay exactly as the failure path leaves them.
def record_and_report(+db: String, +session: String, +id: String, +record_path: String, harness: String, from_label: String, +profile: Subs.Profile, cause: String) -> IO(Bool):
  do IO<Bool>:
    +appended : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(record_path,Subs.record_line(profile) ++ "\n")
    advanced : Bool <- Bool.pick(IO(Bool),append_ok(appended),record_handoff(db,session,id,harness,from_label,profile,cause),record_append_failure(db,session,id,record_path,append_error(appended)))
    IO.pure(Bool,advanced)

def record_handoff(db: String, session: String, id: String, harness: String, from_label: String, +profile: Subs.Profile, cause: String) -> IO(Bool):
  do IO<Bool>:
    noted : Unit <- report_body(db,session,id,"profile-handoff",Subs.handoff_body(harness,from_label,profile.label,profile.store,cause))
    IO.pure(Bool,True{})

def record_append_failure(db: String, session: String, id: String, record_path: String, detail: String) -> IO(Bool):
  do IO<Bool>:
    noted : Unit <- report_body(db,session,id,"profile-append-failed","subscription profile record append failed at " ++ record_path ++ ": " ++ detail ++ "; the provider cause stands and no profile was advanced.")
    IO.pure(Bool,False{})

def report_all_refused(db: String, session: String, id: String, harness: String, from_label: String, cause: String) -> IO(Bool):
  do IO<Bool>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":profile-exhausted") ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q(Subs.all_refused_body(harness,from_label,cause)) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
    IO.pure(Bool,False{})

# One completion shared by a fresh start and a recovered observation: the provider
# outcome decides whether a profile advance is recorded, an exhausted terminal advances
# through this same path for a recovered attempt too, and a recorded advance is handed to
# the exit-status synthesis so only the provider failure a complete observation superseded
# is suppressed. The advance's continuation runs exactly once and only after the observed
# path completed cleanly, so a real delivery, settlement, acknowledgment or retirement
# failure keeps its own result and launches nothing.
def completed_observation(+db: String, +session: String, +id: String, +log: String, cursor: String, +native: String, +cwd: String, +attempt: String, +handle: U32, lock: Maybe<U32>, +observation: Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>, +again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool, cmd: String) -> IO<Result<&1,&1,U32 & String,Unit>>:
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +superseded : Bool <- profile_handoff(db,session,id,current_outcome(observation),native,cmd,cwd)
    +observed : Result<&1,&1,U32 & String,Unit> <- observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,lock,observation,again,adopted,superseded)
    continued : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),Bool.and(superseded,finished_clean(observed)),continue_after_advance(db,session,id,attempt,again),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(observed,continued))

# After a successful cleanup and a recorded handoff the same actor continues on the binding
# the advance recorded. The guidance belongs only when the whole inbox holds nothing for this
# session, which the zero cursor asks for: the attempt cursor excludes the input that attempt
# already read, so a task the attempt never acknowledged would read as empty there and the
# continuation would run without it. No receipt is reset and no operator task is repeated.
def continue_after_advance(+db: String, +session: String, id: String, attempt: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    owed : Bool <- wake_owed(db,session,"0")
    noted : Unit <- Bool.pick(IO(Unit),owed,IO.pure(Unit,Unit{}),handoff_guidance(db,session,id,attempt))
    again(Unit{})

# The guidance message is written only for this session and names the retained attempt the
# continuation resumes, so a session that already holds owed input is left untouched.
def handoff_guidance(db: String, session: String, id: String, attempt: String) -> IO(Unit):
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":handoff-guidance") ++ ",id,id,'guidance'," ++ C.q("The provider reported usage exhaustion and the subscription profile advanced to the next operator-listed account. Continue the original retained attempt " ++ attempt ++ " on this binding; the task message that started it is already acknowledged.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"))
    IO.pure(Unit,Unit{})

def started(+db: String, +session: String, +id: String, +log: String, cursor: String, native: String, cwd: String, +attempt: String, harness: String, level: String, lock: U32, start: P.RetainedStart, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), cmd: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match start:
    case P.Retained{+handle}: do IO<Result<&1,&1,U32 & String,Unit>>:
      reconciled : Unit <- Stop.started(db,session,id,attempt)
      observation : Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- Turn.retained_output(db,session,id,log,harness,attempt,handle,Omp.filter_events(level))
      completed_observation(db,session,id,log,cursor,native,cwd,attempt,handle,Some{lock},observation,again,False{},cmd)
    case P.Unstarted{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +outcome : Turn.Outcome <- IO.pure(Turn.Outcome,Turn.Ended{"start failed","","Player process could not start: " ++ error,True{}})
      exited : Unit <- Turn.record_exit(db,session,id,log,outcome)
      prepared : Unit <- Turn.prepare(db,session,id,log,attempt ++ "/native.stderr",outcome)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      finish_pending(db,session,id,log,cursor,outcome,Nil{},again,u => IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),False{})

# An admitted start takes the obligation under the held session lock before the
# native process exists: the claim names the head unacknowledged message as
# owner and fences the generation past any stale row, so a driver that dies
# before launch never suppresses the next wake.
def start_admitted(+db: String, +session: String, +id: String, cmd: String, route: String, thinking: String, +workspace: String, +log: String, +lock: U32, cursor: String, +native: String, +attempt: String, +harness: String, storage: String, prompt: String, recovery: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), allowed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match allowed:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Session is terminally stopped; queued input will not execute. Read its session and retained inbox.")})
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      head : String <- wake_found(db,session,"0")
      owned : Unit <- Store.claim(db,session,head)
      +policy : Logs.Policy <- Logs.policy(db,session)
      +level : String <- IO.pure(String,Turn.policy_level(policy))
      start : P.RetainedStart <- IO.try(P.RetainedStart,Turn.retained(db,session,attempt,cmd,route,thinking,workspace,native,harness,storage,prompt,lock,recovery,level))
      started(db,session,id,log,cursor,native,workspace,attempt,harness,level,lock,start,again,cmd)

def selected(+db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +lock: U32, +cursor: String, present: Bool, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match present:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      empty : Result<&1,&1,U32 & String,Unit> <- receive_status(db,session,"empty")
      continue_pending(db,session,cursor,again)
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +executable : String <- IO.try(String,Lock.SessionLock.executable())
      +harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
      supported : Unit <- Turn.supported_harness(Bool.or(String.eq(harness,"omp\n"),Bool.or(String.eq(harness,"codex\n"),Bool.or(String.eq(harness,"claude-code\n"),String.eq(harness,"muse\n")))))
      +native : String <- field(db,session,"native","")
      +route : String <- field(db,session,"model",model)
      +thinking : String <- field(db,session,"effort",effort)
      +workspace : String <- field(db,session,"workspace",cwd)
      storage : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
      ident : String <- IO.try(String,DB.Sql.query(db,"SELECT 'receive:' || " ++ C.q(session) ++ " || ':' || CAST(" ++ C.q(cursor) ++ " AS INTEGER) || ':' || lower(hex(randomblob(16)));"))
      +id : String <- IO.pure(String,Tx.trim_nl(ident))
      body : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(group_concat(body,char(10)||char(10)), '') FROM (SELECT 'Message (' || kind || ') from ' || sender || ' [id: ' || id || ']:' || char(10) || body AS body FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq<=CAST(" ++ C.q(cursor) ++ " AS INTEGER) ORDER BY seq);"))
      directory : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.q(db ++ ".attempt-") ++ " || lower(hex(" ++ C.q(id) ++ "));"))
      +attempt : String <- IO.pure(String,Tx.trim_nl(directory))
      recovery : String <- IO.pure(String,P.argv([executable,"--recover-receive",db,session,id,cursor,cmd,route,thinking,workspace,log,harness,attempt,native]))
      allowed : Bool <- Stop.admit(db,session,id,"retained",attempt)
      orientation : String <- orientation_text(db,session)
      start_admitted(db,session,id,cmd,route,thinking,workspace,log,lock,cursor,native,attempt,harness,Tx.trim_nl(storage),instructions(executable,db,session,orientation) ++ body,recovery,again,allowed)

def acquired_pending(+db: String, +session: String, cmd: String, model: String, effort: String, cwd: String, log: String, lock: U32, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +cursor : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(max(seq),0) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL;"))
    selected(db,session,cmd,model,effort,cwd,log,lock,cursor,Bool.not(String.eq(cursor,"0\n")),again)

def observe_guarded(+db: String, +session: String, +id: String, cursor: String, cmd: String, model: String, effort: String, +cwd: String, +log: String, harness: String, +directory: String, native: String, +handle: U32, lock: Maybe<U32>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    reconciled : Unit <- Stop.reconcile(db,session,id,directory)
    observation : Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- Turn.retained_output(db,session,id,log,harness,directory,handle,"unknown")
    completed_observation(db,session,id,log,cursor,native,cwd,directory,handle,lock,observation,again,adopted,cmd)

def recover_owned(+db: String, +session: String, +directory: String, +lock: U32, args: List<&2,String>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match args:
    case executable <> flag <> saved_db <> saved_session <> id <> cursor <> cmd <> model <> effort <> cwd <> log <> harness <> saved_directory <> native <> Nil{}:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        valid : Unit <- Stop.error_result("Recorded native recovery arguments differ from the current session; retain the attempt and inspect its manifest.",Bool.and(String.eq(flag,"--recover-receive"),Bool.and(String.eq(session,saved_session),String.eq(directory,saved_directory))))
        handle : U32 <- IO.try(U32,Custody.Instance.attach_owned(db,directory,lock))
        observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,Some{lock},again,True{})
    case other: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Recorded native recovery arguments are invalid; retain the attempt and inspect its manifest.")})

def acquired_attempt(db: String, session: String, cmd: String, model: String, effort: String, cwd: String, log: String, lock: U32, directory: String, recovery: Maybe<String>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match recovery:
    case None{}: acquired_pending(db,session,cmd,model,effort,cwd,log,lock,again)
    case Some{args}: recover_owned(db,session,directory,lock,String.split(args,Char.from_u32(0)),again)

# The canonical guard owner resolves the current durable attempt before admission.
def acquired_recorded(+db: String, +session: String, cmd: String, model: String, effort: String, cwd: String, log: String, +lock: U32, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +directory : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(session) ++ " AND mode='retained'),'');"))
    +attempt : String <- IO.pure(String,Tx.trim_nl(directory))
    recovery : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.recovery_argv(attempt))
    acquired_attempt(db,session,cmd,model,effort,cwd,log,lock,attempt,recovery,again)

def acquired(db: String, session: String, cmd: String, model: String, effort: String, cwd: String, log: String, result: Maybe<U32>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case None{}: receive_status(db,session,"queued")
    case Some{lock}: acquired_recorded(db,session,cmd,model,effort,cwd,log,lock,again)

def registered(exists: Bool) -> IO(Unit):
  match exists:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"Session is not registered; attach a conductor or recruit a player before receiving messages.")

def available(+db: String, +session: String, cmd: String, model: String, effort: String, cwd: String, log: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), closed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match closed:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Session is terminally stopped; queued input will not execute. Read its session and retained inbox.")})
    case False{}: Lock.SessionLock.acquire_session(Result<&1,&1,U32 & String,Unit>,db,session,
      +database => lock => acquired(database,session,cmd,model,effort,cwd,log,lock,again))

# MESSAGE_ID names the wake. The lock owner reads all pending inputs together.
@unsafe
def run(+db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, message: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,Store.commit(db,C.Session{session}))
    exists : Unit <- registered(Bool.not(String.is_empty(recorded)))
    closed : Bool <- Stop.stopped(db,session)
    result : Result<&1,&1,U32 & String,Unit> <- available(db,session,cmd,model,effort,cwd,log,u => run(db,session,cmd,model,effort,cwd,log,""),closed)
    settled : Unit <- claim_left(db,session)
    IO.pure(Result<&1,&1,U32 & String,Unit>,result)

def attach_recorded(+db: String, directory: String, next: @+handle: U32 -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    handle : U32 <- IO.try(U32,Custody.Instance.attach(db,directory))
    next(handle)

def observe_attached(+db: String, +session: String, id: String, cursor: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, harness: String, directory: String, native: String, +handle: U32, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,None{},again,False{})

# The keeper invokes this with the original attempt and inbox cutoff after the
# observer exits. Attachment never launches a native process or sends its prompt.
def recover(+db: String, +session: String, id: String, cursor: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, harness: String, +directory: String, native: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  attach_recorded(db,directory,handle => observe_attached(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,u => run(db,session,cmd,model,effort,cwd,log,"")))
