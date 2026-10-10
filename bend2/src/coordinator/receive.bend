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
  ++ "Public messages follow assigned roles, parent links and explicit tight Ensemble membership. A Conductor can message its descendants. Report, ask and ask-file reach your recorded parent; a parentless Principal Conductor reaches the registered operator. Peer messages require a shared tight Ensemble.\n"
  ++ "Coordinator CLI:\n  " ++ command ++ " inbox " ++ shell(session) ++ "\n  " ++ command ++ " ack MESSAGE_ID " ++ shell(session) ++ " RECEIPT\n"
  ++ "Read each pending message in full and acknowledge your own handled input with its disposition. A receipt records input handling. Keep unfinished work and outstanding qualification in your reports and project state. Read your inbox again as work continues.\n  " ++ command ++ " orchestra\n  " ++ command ++ " players\n  " ++ command ++ " session ID\n  " ++ command ++ " worktree ID\n  " ++ command ++ " turns ID\n"
  ++ "Use join for Players working in the shared checkout. Use recruit when the task needs a separate worktree. Each source assignment names the shared checkout, target branch, requested remote and Conductor who owns integration and publication.\n"
  ++ "  " ++ command ++ " join PLAYER " ++ shell(session) ++ " HARNESS MODEL EFFORT WORKSPACE\n"
  ++ "  " ++ command ++ " recruit PLAYER " ++ shell(session) ++ " HARNESS MODEL EFFORT REPO BRANCH PATH BASE\n"
  ++ "  " ++ command ++ " receiver PLAYER HARNESS_CMD OUTPUT_LOG [CWD]\n  " ++ command ++ " dispatch-file ID " ++ shell(session) ++ " PLAYER task TASK_FILE\n"
  ++ "  " ++ command ++ " dispatch-turn PLAYER TURN_ID HARNESS_CMD OUTPUT_LOG TASK_FILE\n  " ++ command ++ " status --pretty\n"
  ++ "  " ++ command ++ " message ID " ++ shell(session) ++ " PLAYER guidance BODY\n  " ++ command ++ " land PLAYER REPO TARGET [--commit COMMIT]\n  " ++ command ++ " land-checked PLAYER REPO TARGET CHECK FILES [--commit COMMIT]\n  " ++ command ++ " push REPO TARGET REMOTE\nland and land-checked default to the recorded branch tip; --commit selects an ancestor.\n"
  ++ "For source work, coordinate edits in the shared checkout and commit completed changes. Include the intended target branch and remaining work in your report. When a Player reports completed work, its Conductor integrates that contribution into the target and pushes it to the requested remote. Use land for a fast-forward contribution; reconcile divergent contributions into the target with ordinary Git operations and source edits. After the Player's owned turn finishes, move that same Player to the shared checkout with receiver PLAYER HARNESS_CMD OUTPUT_LOG SHARED_CWD. This preserves its native conversation, parent, base and retained input, and records the shared checkout's current branch. Then use ordinary git worktree remove and git branch -d for its clean, inactive temporary checkout and fully integrated task branch. Preserve checkouts used by active Players, unfinished changes and later unintegrated commits. Keep the shared checkout, target branch and explicit stops available.\n"
  ++ "  " ++ command ++ " role SESSION\n  " ++ command ++ " role SESSION player|principal-conductor|associate-conductor|operator\n  " ++ command ++ " ensemble ENSEMBLE\n  " ++ command ++ " ensemble ENSEMBLE OWNER [loose|tight]\n  " ++ command ++ " ensemble-member ENSEMBLE OWNER PLAYER add|remove\n  " ++ command ++ " section ENSEMBLE SECTION [OWNER CAPABILITY]\n  " ++ command ++ " section-member ENSEMBLE SECTION OWNER PLAYER add|remove\n"
  ++ "  " ++ command ++ " native-reply " ++ shell(session) ++ " REQUEST RESPONSE_JSON\n  " ++ command ++ " native-reply-file " ++ shell(session) ++ " REQUEST PATH\n"
  ++ "  " ++ command ++ " record FINDING_ID " ++ shell(session) ++ " CLAIM EVIDENCE LIMITS\n  " ++ command ++ " knowledge " ++ shell(session) ++ " [--index | --id FINDING_ID] [--pretty]\n"
  ++ "  " ++ command ++ " record-typed FINDING_ID " ++ shell(session) ++ " KIND CLAIM EVIDENCE LIMITS\n  " ++ command ++ " relate RELATION_ID " ++ shell(session) ++ " SOURCE RELATION TARGET\n  " ++ command ++ " knowledge-scope " ++ shell(session) ++ " universal|worker|group|all SUBJECT [--index | --id FINDING_ID] [--pretty]\n"
  ++ "  " ++ command ++ " promote PROMOTION_ID " ++ shell(session) ++ " SOURCE " ++ shell(session) ++ " FINDING_ID\n"
  ++ "Knowledge kinds and relationship names are authored strings. Use finding:ID and message:ID references to connect observations, decisions, corrections and their sources. Scoped knowledge reads select universal holdings from a Principal Conductor, worker holdings from that session, or group holdings from an Ensemble owner. A holding is authored or explicitly received by promotion. The all scope discovers every stored finding. Author findings from reviewed evidence. Cite the source of the finding and state the claim's limits. A message:MESSAGE_ID reference includes the retained message body. knowledge lists every finding visible to your session, with its cited evidence and promotion history. Review a finding before explicitly promoting it from its recorded SOURCE into your own scope; its original author remains recorded. A promotion notice names a finding shared into your scope. Retrieve that finding with knowledge --id FINDING_ID and review its evidence. Use knowledge --index for metadata discovery and follow detailRead or evidenceMessage.deliveryRead for complete stored records.\n"
  ++ "Run coordinator operations through these CLI commands. Use receiver then dispatch-file for Codex, OMP, Muse and Claude Players. dispatch-turn also launches a recorded Player directly. Dispatch returns the launched delivery PID; inspect turns, inbox and output logs for completion. These commands take identity and workspace from the recorded assignment and apply configured model Git identities. Dispatch independent Players concurrently and finish your native turn so their reports can continue your session.\n\n"

def receive_status(db: String, session: String, status: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('session'," ++ C.q(session) ++ ",'status'," ++ C.q(status) ++ ");"))
    Text.Text.control_output(result)

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
def result_ok(result: Result<&1,&1,U32 & String,Unit>) -> Bool:
  match result:
    case Fail{error}: False{}
    case Done{unit}: True{}

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

# The exit-status synthesis suppresses only the provider failure a complete observation
# superseded, or a classified complete provider failure whose owed continuation succeeded;
# every other Result below keeps its own combination, and an attempt whose
# advance was recorded runs the advance's own continuation instead of the ordinary one.
def finish_pending(+db: String, +session: String, id: String, log: String, +cursor: String, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), acknowledge: Unit -> IO(Result<&1,&1,U32 & String,Unit>), +superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +failed : Bool <- outcome_failed(db,outcome)
    owed : Bool <- wake_owed(db,session,cursor)
    delivery_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,Turn.finish(db,session,id,log,outcome))
    continued_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),superseded,IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),continue_pending(db,session,cursor,again)))
    finished : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,delivery_task)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    stopped : Bool <- Stop.stopped(db,session)
    ack : Result<&1,&1,U32 & String,Unit> <- acknowledge_if_observed(Bool.and(native_observation_failed(outcome),Bool.not(stopped)),acknowledge)
    +next : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,continued_task)
    transient : Bool <- transient_provider_error(db,outcome)
    status : Result<&1,&1,U32 & String,Unit> <- exit_status(Bool.and(failed,Bool.not(Bool.or(superseding(superseded,outcome),Bool.and(transient,Bool.and(observation_clear(outcome),Bool.and(owed,result_ok(next))))))))
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
  do IO<Result<&1,&1,U32 & String,Unit>>:
    woke : Result<&1,&1,U32 & String,Unit> <- wake_due(db,session,cursor,target => wake_launch(db,target))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(finished,woke))

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
def completed(+db: String, +session: String, +id: String, +log: String, stderr: String, +cursor: String, +handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), +superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
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
# Receive and direct turns share the account handoff helpers in Subs.

# The guidance message is written only for this session and names the retained attempt the
# continuation resumes, so a session that already holds owed input is left untouched.
def handoff_guidance(db: String, +session: String, id: String, attempt: String) -> IO(Unit):
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":handoff-guidance") ++ ",id,id,'guidance'," ++ C.q("The provider reported usage exhaustion and the subscription profile advanced to the next operator-listed account. Continue the original retained attempt " ++ attempt ++ " on this binding; the task message that started it is already acknowledged.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"))
    IO.pure(Unit,Unit{})

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

# The guidance message is written only for this session when a transient
# provider error interrupted its accepted task: the failed turn stays recorded with
# the provider's own cause, and the same actor continues the unfinished task
# on the same conversation. The task message that started it is already
# acknowledged.
def transient_guidance(db: String, +session: String, id: String, attempt: String) -> IO(Unit):
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":transient-guidance") ++ ",id,id,'guidance'," ++ C.q("The attempt ended with a transient provider error. Continue the unfinished task on the retained attempt " ++ attempt ++ " in the same conversation and account; the task message that started it is already acknowledged and the failed turn stays recorded with the provider cause.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"))
    IO.pure(Unit,Unit{})

# After a recorded transient failure with nothing owed, the same actor resumes
# its retained attempt: the guidance above names the attempt, and the existing
# wake driver fires it on the same binding.
def resume_after_transient(+db: String, +session: String, id: String, attempt: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    noted : Unit <- transient_guidance(db,session,id,attempt)
    again(Unit{})

# A selected transient continuation reuses the handoff completion distinction: only a
# cleanly observed path resumes. Any delivery, settlement, finish, or acknowledgment
# failure keeps its own result and launches nothing, while the failed turn row stays
# recorded from the outcome itself.
def transient_continue(db: String, session: String, id: String, attempt: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), observed: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: resume_after_transient(db,session,id,attempt,again)

# One completion for the non-advanced path: without a selected continuation the
# observed path runs exactly as before, with one it runs without the ordinary
# continuation and without the classified provider exit-status failure, so a clean
# observation returns Done and only then resumes. A task queued during completion is
# never drained twice: the ordinary wake stands down for the suppressed run and the
# explicit resume is the single continuation.
def completed_transient(+db: String, +session: String, +id: String, log: String, cursor: String, native: String, cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool, proceed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
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
def advanced_completed(db: String, session: String, id: String, attempt: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), observed: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: continue_after_advance(db,session,id,attempt,again)

def completed_profile(+db: String, +session: String, +id: String, log: String, cursor: String, native: String, cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, +again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool, superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match superseded:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      proceed : Bool <- transient_precheck(db,session,outcome)
      completed_transient(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again,adopted,proceed)
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      observed : Result<&1,&1,U32 & String,Unit> <- observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,lock,(outcome,deliveries),u => IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),adopted,True{})
      advanced_completed(db,session,id,attempt,again,observed)

def completed_observation(+db: String, +session: String, +id: String, log: String, cursor: String, +native: String, +cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, observation: Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool, cmd: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  (+outcome,deliveries)=observation
  do IO<Result<&1,&1,U32 & String,Unit>>:
    superseded : Bool <- Subs.profile_handoff(db,session,id,terminal_event(outcome),native,cmd,cwd)
    completed_profile(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again,adopted,superseded)

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
def start_admitted(+db: String, +session: String, +id: String, +cmd: String, route: String, thinking: String, +workspace: String, +log: String, +lock: U32, cursor: String, +native: String, +attempt: String, +harness: String, storage: String, prompt: String, recovery: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), allowed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
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
    reconciled : Unit <- Stop.observing(db,session,id,directory)
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

def acquired(+db: String, session: String, cmd: String, model: String, effort: String, cwd: String, log: String, result: Maybe<U32>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case None{}: receive_status(db,session,"queued")
    case Some{lock}: do IO<Result<&1,&1,U32 & String,Unit>>:
      ensured : Unit <- Store.ensure_before_begin(db)
      acquired_recorded(db,session,cmd,model,effort,cwd,log,lock,again)

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
    recorded : String <- IO.try(String,DB.Sql.read(db,"SELECT id FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    exists : Unit <- registered(Bool.not(String.is_empty(recorded)))
    closed : Bool <- Stop.stopped(db,session)
    result : Result<&1,&1,U32 & String,Unit> <- available(db,session,cmd,model,effort,cwd,log,u => run(db,session,cmd,model,effort,cwd,log,""),closed)
    settled : Unit <- claim_left(db,session)
    IO.pure(Result<&1,&1,U32 & String,Unit>,result)

def serve_acquired(+db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, lock: U32, closed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match closed:
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      receive_status(db,session,"stopped")
    case False{}: acquired_recorded(db,session,cmd,model,effort,cwd,log,lock,u => run(db,session,cmd,model,effort,cwd,log,""))

# The coordinator waits for physical ownership, then reads stops and pending input.
@unsafe
def serve(+db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    recorded : String <- IO.try(String,Store.commit(canonical,C.Session{session}))
    exists : Unit <- registered(Bool.not(String.is_empty(recorded)))
    lock : U32 <- IO.try(U32,Lock.SessionLock.wait_acquire(canonical,session))
    closed : Bool <- Stop.stopped(canonical,session)
    result : Result<&1,&1,U32 & String,Unit> <- serve_acquired(canonical,session,cmd,model,effort,cwd,log,lock,closed)
    settled : Unit <- claim_left(canonical,session)
    IO.pure(Result<&1,&1,U32 & String,Unit>,result)

def recover_observer_acquired(+db: String, +session: String, id: String, cursor: String, +cmd: String, model: String, effort: String, cwd: String, +log: String, harness: String, directory: String, native: String, acquired: U32 & U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  match acquired:
    case (lock,handle): observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,Some{lock},u => run(db,session,cmd,"","","",log,""),True{})

def recover_observer_arguments(+db: String, +session: String, +directory: String, observer: U32, args: List<&2,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match args:
    case executable <> flag <> saved_db <> saved_session <> id <> cursor <> +cmd <> model <> effort <> cwd <> +log <> harness <> saved_directory <> native <> Nil{}:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        valid : Unit <- Stop.error_result("Recorded native recovery arguments differ from the current session; retain the attempt and inspect its manifest.",Bool.and(String.eq(flag,"--recover-receive"),Bool.and(String.eq(session,saved_session),String.eq(directory,saved_directory))))
        acquired : U32 & U32 <- IO.try(U32 & U32,Lock.SessionLock.recover_observer(db,session,directory,observer))
        recover_observer_acquired(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,acquired)
    case other: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Recorded native recovery arguments are invalid; retain the attempt and inspect its manifest.")})

def recover_observer_recorded(+db: String, +session: String, +directory: String, observer: U32, recovery: Maybe<String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match recovery:
    case Some{args}: recover_observer_arguments(db,session,directory,observer,String.split(args,Char.from_u32(0)))
    case None{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"The session has no unfinished retained receive attempt.")})

def recover_observer_pid(+db: String, +session: String, observer: Maybe<&2,U32>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observer:
    case None{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Observer PID must be a positive process ID.")})
    case Some{pid}: do IO<Result<&1,&1,U32 & String,Unit>>:
      found : String <- IO.try(String,DB.Sql.read(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(session) ++ " AND mode='retained'),'');"))
      +directory : String <- IO.pure(String,Tx.trim_nl(found))
      recovery : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.recovery_argv(directory))
      result : Result<&1,&1,U32 & String,Unit> <- recover_observer_recorded(db,session,directory,pid,recovery)
      settled : Unit <- claim_left(db,session)
      IO.pure(Result<&1,&1,U32 & String,Unit>,result)

# The selected observer holds a completed native attempt.
# Adoption reads its recorded recovery arguments and restores its checkpoint.
def recover_observer(+db: String, +session: String, observer: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,Store.read(db,C.Session{session}))
    exists : Unit <- registered(Bool.not(String.is_empty(recorded)))
    canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    recover_observer_pid(canonical,session,U32.read(observer))

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
