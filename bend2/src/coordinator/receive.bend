import Base
import ./commands.bend as C
import ./store.bend as Store
import ./turn.bend as Turn
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../git/text.bend as Tx

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

def instructions(executable: String, database: String, +session: String) -> String:
  +command = shell(executable) ++ " " ++ shell(database)
  "You are session " ++ session ++ " in a Bend2 coordinator. Review the pending messages and direct your workers.\n"
  ++ "Coordinator CLI:\n  " ++ command ++ " inbox " ++ shell(session) ++ "\n  " ++ command ++ " ack MESSAGE_ID " ++ shell(session) ++ " RECEIPT\n"
  ++ "Acknowledge each message after accepting it.\n  " ++ command ++ " status\n  " ++ command ++ " workers\n  " ++ command ++ " session ID\n  " ++ command ++ " worktree ID\n  " ++ command ++ " turns ID\n"
  ++ "  " ++ command ++ " recruit WORKER " ++ shell(session) ++ " HARNESS MODEL EFFORT REPO BRANCH PATH BASE\n"
  ++ "  " ++ command ++ " message ID " ++ shell(session) ++ " WORKER guidance BODY\n  " ++ command ++ " land-checked WORKER REPO TARGET CHECK FILES\n"
  ++ "Start long worker turns in the background and finish your native turn so their reports can continue your session.\n\n"

def receive_status(db: String, session: String, status: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('session'," ++ C.q(session) ++ ",'status'," ++ C.q(status) ++ ");"))
    written : Unit <- IO.write(result)
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def exit_status(failed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match failed:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(1,"Native receive failed; read the retained native log and pending inbox.")})

def outcome_failed(db: String, outcome: Turn.Outcome) -> IO(Bool):
  match outcome:
    case Turn.Ended{+status,+event,+error}: do IO<Bool>:
      failure : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(event) ++ "='' THEN 1 ELSE coalesce(json_extract(" ++ C.q(event) ++ ",'$.is_error'),0) END;"))
      IO.pure(Bool,Bool.or(Turn.failed(status,event,error),String.eq(failure,"1\n")))

def continue_if(again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), present: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match present:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: again(Unit{})

# Busy writers have committed before trying the lock. Read again after release.
def continue_pending(db: String, session: String, cursor: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    pending : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER);"))
    continue_if(again,Bool.not(String.eq(pending,"0\n")))

def selected(+db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, lock: U32, +cursor: String, present: Bool, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match present:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      empty : Result<&1,&1,U32 & String,Unit> <- receive_status(db,session,"empty")
      continue_pending(db,session,cursor,again)
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      executable : String <- IO.try(String,Lock.SessionLock.executable())
      +harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
      supported : Unit <- Turn.supported_harness(Bool.or(String.eq(harness,"omp\n"),String.eq(harness,"codex\n")))
      native : String <- field(db,session,"native","")
      route : String <- field(db,session,"model",model)
      thinking : String <- field(db,session,"effort",effort)
      workspace : String <- field(db,session,"workspace",cwd)
      storage : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
      ident : String <- IO.try(String,DB.Sql.query(db,"SELECT 'receive:' || " ++ C.q(session) ++ " || ':' || CAST(" ++ C.q(cursor) ++ " AS INTEGER) || ':' || (count(*)+1) FROM messages WHERE kind='report' AND sender=" ++ C.q(session) ++ ";"))
      +id : String <- IO.pure(String,Tx.trim_nl(ident))
      body : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(group_concat(body,char(10)||char(10)), '') FROM (SELECT 'Message (' || kind || ') from ' || sender || ' [id: ' || id || ']:' || char(10) || body AS body FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq<=CAST(" ++ C.q(cursor) ++ " AS INTEGER) ORDER BY seq);"))
      +outcome : Turn.Outcome <- Turn.supervise(db,session,id,cmd,route,thinking,workspace,"",log,native,harness,Tx.trim_nl(storage),instructions(executable,db,session) ++ body)
      prepared : Unit <- Turn.prepare(db,session,id,log,outcome)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      failed : Bool <- outcome_failed(db,outcome)
      delivery_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,Turn.finish(db,session,id,log,outcome))
      next : Result<&1,&1,U32 & String,Unit> <- continue_pending(db,session,cursor,again)
      finished : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,delivery_task)
      status : Result<&1,&1,U32 & String,Unit> <- exit_status(failed)
      IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(finished,Turn.combine(next,status)))

def acquired(+db: String, +session: String, cmd: String, model: String, effort: String, cwd: String, log: String, result: Maybe<U32>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case None{}: receive_status(db,session,"queued")
    case Some{lock}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +cursor : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(max(seq),0) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL;"))
      selected(db,session,cmd,model,effort,cwd,log,lock,cursor,Bool.not(String.eq(cursor,"0\n")),again)

def registered(exists: Bool) -> IO(Unit):
  match exists:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"Session is not registered; attach a root or recruit a worker before receiving messages.")

# MESSAGE_ID names the wake. The lock owner reads all pending inputs together.
@unsafe
def run(+db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, message: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,Store.commit(db,C.Session{session}))
    exists : Unit <- registered(Bool.not(String.is_empty(recorded)))
    +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(database,session))
    acquired(database,session,cmd,model,effort,cwd,log,lock,u => run(db,session,cmd,model,effort,cwd,log,""))
