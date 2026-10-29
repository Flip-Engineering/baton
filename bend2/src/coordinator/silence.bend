# CLAIM: a session that holds a claimed wake with owed input, whose attempt has
# not exited and whose retained native output file has not been written for the
# silence period, reports to its coordinator. The report names the session, the
# attempt, the native pid, the last output time and the owed input count, and
# goes through the committed-message and delivery path that every report uses.
# Baton does not stop, restart or signal the native; the coordinator decides.
#
# Everything is derived from rows and files Baton already writes: the claim,
# the attempt phase and directory, the owed input rows, the output file's
# modification time and the native pid file. The report's identity names the
# attempt, the output's modification time and the owed count, so a silence is
# reported once for each owed count and a repeated check finds the row.
#
# The observer runs the check when a commit notice wakes it; the stall-wake
# command runs it for every session. Every query is handled as a result, so
# the check cannot end the observer.
# Serves: docs/pure-bend2/pending-stall-bend2.md.
import Base
import ../git/text.bend as Tx
import ../host/sqlite.bend as DB
import ../host/files.bend as Files
import ../host/text.bend as Text
import ../host/clock.bend as Clock
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./delivery.bend as Delivery

# The seconds without output after which a claimed wake with owed input is
# reported to the coordinator.
def silence_seconds() -> String:
  "900"

# The owed-input count for one session. A completed assignment admits no new
# native attempt, so its owed input is not a wake obligation.
def owed_expr(+session: String) -> String:
  "(SELECT count(*) FROM messages m WHERE m.recipient=" ++ session ++ " AND " ++ C.owed_sql("m") ++ " AND NOT " ++ C.task_closed_sql(session) ++ ")"

# An explicit stop resolves the session's wake obligation.
def stopped_expr(+session: String) -> String:
  "EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ session ++ ")"

# The claim state the coordinator records for one session. A database without
# the claim table reports an empty state and classifies no candidate as claimed.
def claim_state_expr(+session: String, +present: Bool) -> String:
  Bool.pick(String, present, "coalesce((SELECT state FROM wake_claims WHERE session=" ++ session ++ "),'')", "''")

# Sessions that hold a claimed wake with owed input and an attempt that has not
# exited: session, attempt id, attempt directory and owed count, tab separated.
# An empty session selects every session.
def silent_rows_sql(+present: Bool, +session: String) -> String:
  "SELECT s.id||char(9)||e.id||char(9)||e.directory||char(9)||CAST(" ++ owed_expr("s.id") ++ " AS TEXT)"
  ++ " FROM sessions s JOIN executions e ON e.session=s.id"
  ++ " WHERE " ++ owed_expr("s.id") ++ ">0 AND e.phase<>'exited' AND e.directory<>''"
  ++ " AND NOT " ++ stopped_expr("s.id")
  ++ " AND " ++ claim_state_expr("s.id",present) ++ "='claimed'"
  ++ Bool.pick(String,String.is_empty(session),""," AND s.id=" ++ C.q(session))
  ++ " ORDER BY s.id;"

# The clock reading and the output file's modification seconds are compared in
# SQL. The answer is the last output instant in UTC when the silence period has
# elapsed, and empty while the output is recent.
def silent_since_sql(+millis: String, +mtime: String) -> String:
  "SELECT CASE WHEN CAST(" ++ C.q(millis) ++ " AS INTEGER)/1000-CAST(" ++ C.q(mtime) ++ " AS INTEGER)>=" ++ silence_seconds() ++ " THEN datetime(CAST(" ++ C.q(mtime) ++ " AS INTEGER),'unixepoch') ELSE '' END;"

def silent_recorded_sql(+id: String) -> String:
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ ") THEN '1' ELSE '' END;"

def silent_body(+session: String, +attempt: String, +pid: String, +last: String, +owed: String) -> String:
  "Native output is silent while session " ++ session ++ " holds a claimed wake with owed input. Attempt " ++ attempt ++ ", native pid " ++ pid ++ ", last output " ++ last ++ " UTC, owed inputs " ++ owed ++ ". Baton does not stop or restart the native; decide whether to wait, nudge, stop or replace it."

def silent_pid(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{+text}: Tx.trim_nl(text)
    case Fail{error}: "unknown"

def silent_drop(chan: Chan(Result<&1,&1,U32 & String,String>)) -> IO(Unit):
  IO.pure(Unit, Unit{})

# The observer hands the delivery to a forked task so a coordinator launch
# cannot hold the output read; the command waits for it.
@unsafe
def silent_wake(+db: String, +id: String, +text: String, +forked: Bool) -> IO(Unit):
  Bool.pick(IO(Unit), forked,
    (do IO<Unit>:
      task : Chan(Result<&1,&1,U32 & String,String>) <- IO.fork(Result<&1,&1,U32 & String,String>,Delivery.deliver(db,id,"1",text))
      silent_drop(task)),
    (do IO<Unit>:
      delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id,"1",text)
      IO.pure(Unit, Unit{})))

def silent_send(+db: String, +id: String, +forked: Bool, saved: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match saved:
    case Fail{error}: IO.pure(Unit, Unit{})
    case Done{+text}: silent_wake(db,id,text,forked)

# The report goes from the session to its coordinator as a committed report;
# a busy store answer is tried again.
def silent_commit(+db: String, +session: String, +id: String, +body: String, +forked: Bool) -> IO(Unit):
  do IO<Unit>:
    saved : Result<&1,&1,U32 & String,String> <- Store.apply_through_busy(db,C.Report{id,session,body})
    silent_send(db,id,forked,saved)

def silent_report(+db: String, +session: String, +attempt: String, +id: String, +owed: String, +last: String, +forked: Bool, pid: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  silent_commit(db,session,id,silent_body(session,attempt,silent_pid(pid),last,owed),forked)

def silent_new(+db: String, +session: String, +attempt: String, +directory: String, +id: String, +owed: String, +last: String, +forked: Bool) -> IO(Unit):
  do IO<Unit>:
    pid : Result<&1,&1,U32 & String,String> <- Text.Text.read(directory ++ "/native.pid")
    silent_report(db,session,attempt,id,owed,last,forked,pid)

# A silence already reported leaves its row; nothing is committed or delivered
# again for the same attempt, output time and owed count.
def silent_recorded(+db: String, +session: String, +attempt: String, +directory: String, +id: String, +owed: String, +last: String, +forked: Bool, recorded: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match recorded:
    case Fail{error}: IO.pure(Unit, Unit{})
    case Done{+text}: Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(text)),silent_new(db,session,attempt,directory,id,owed,last,forked),IO.pure(Unit, Unit{}))

def silent_decided(+db: String, +session: String, +attempt: String, +directory: String, +owed: String, +mtime: String, +last: String, +forked: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(last),IO.pure(Unit, Unit{}),
    (do IO<Unit>:
      +id : String = attempt ++ ":silent:" ++ mtime ++ ":" ++ owed
      recorded : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,silent_recorded_sql(id))
      silent_recorded(db,session,attempt,directory,id,owed,last,forked,recorded)))

def silent_since(+db: String, +session: String, +attempt: String, +directory: String, +owed: String, +mtime: String, +forked: Bool, since: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match since:
    case Fail{error}: IO.pure(Unit, Unit{})
    case Done{+text}: silent_decided(db,session,attempt,directory,owed,mtime,Tx.trim_nl(text),forked)

def silent_clocked(+db: String, +session: String, +attempt: String, +directory: String, +owed: String, +mtime: String, +forked: Bool, millis: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match millis:
    case Fail{error}: IO.pure(Unit, Unit{})
    case Done{+now}: do IO<Unit>:
      since : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,silent_since_sql(now,mtime))
      silent_since(db,session,attempt,directory,owed,mtime,forked,since)

# Files.stat answers kind, mode, device, inode, bytes, modification seconds,
# uid and gid, separated by tabs. A missing output file derives no silence.
def silent_stat_fields(+db: String, +session: String, +attempt: String, +directory: String, +owed: String, +forked: Bool, fields: List<String>) -> IO(Unit):
  match fields:
    case kind <> mode <> device <> inode <> bytes <> +mtime <> uid <> gid <> Nil{}: do IO<Unit>:
      now : Result<&1,&1,U32 & String,String> <- Clock.Clock.millis()
      silent_clocked(db,session,attempt,directory,owed,mtime,forked,now)
    case other: IO.pure(Unit, Unit{})

def silent_statted(+db: String, +session: String, +attempt: String, +directory: String, +owed: String, +forked: Bool, stat: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match stat:
    case Fail{error}: IO.pure(Unit, Unit{})
    case Done{+text}: silent_stat_fields(db,session,attempt,directory,owed,forked,Tx.split_tabs(Tx.trim_nl(text)))

def silent_fields(+db: String, +forked: Bool, fields: List<String>) -> IO(Unit):
  match fields:
    case +session <> +attempt <> +directory <> +owed <> Nil{}: do IO<Unit>:
      stat : Result<&1,&1,U32 & String,String> <- Files.Files.stat(directory ++ "/stdout")
      silent_statted(db,session,attempt,directory,owed,forked,stat)
    case other: IO.pure(Unit, Unit{})

def silent_each(+db: String, +forked: Bool, lines: List<String>) -> IO(Unit):
  match lines:
    case Nil{}: IO.pure(Unit, Unit{})
    case +head <> rest: do IO<Unit>:
      checked : Unit <- silent_fields(db,forked,Tx.split_tabs(head))
      silent_each(db,forked,rest)

def silent_rows(+db: String, +forked: Bool, found: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match found:
    case Fail{error}: IO.pure(Unit, Unit{})
    case Done{+text}: silent_each(db,forked,Tx.split_lines(Tx.trim_nl(text)))

# The check for one session, or for every session when the session is empty.
# The observer passes forked so its delivery does not hold the output read.
def check(+db: String, +session: String, +present: Bool, +forked: Bool) -> IO(Unit):
  do IO<Unit>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,silent_rows_sql(present,session))
    silent_rows(db,forked,found)
