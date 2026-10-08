import Base
import ./commands.bend as C
import ./store.bend as Store
import ./receive.bend as Receive
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../host/control.bend as Host
import ../git/text.bend as Tx

# Admission driver for issue #685. Every committed message admission is
# evaluated for a due wake at exactly this event. Invocation completion is
# covered by the receive-side driver. There is no polling interval, retry
# schedule, count cutoff or time cutoff anywhere in this module.

# The identity a wake drives is the one the committed answer carries, which is
# the row the store wrote. The command argument is not that identity: a
# repeated command ID whose row already exists answers with the recorded row,
# and a refused admission answers with no row at all.
def committed_identity_sql(+saved: String) -> String:
  "SELECT coalesce(json_extract(" ++ C.q(saved) ++ ",'$.id'),json_extract(" ++ C.q(saved) ++ ",'$.reportId'),'');"

law committed_identity_reads_the_committed_row:
  for +saved: String
  {committed_identity_sql(saved) == "SELECT coalesce(json_extract(" ++ C.q(saved) ++ ",'$.id'),json_extract(" ++ C.q(saved) ++ ",'$.reportId'),'');" : String}

def committed_identity_reads_the_committed_row(saved):
  {==}

def committed_identity_read(db: String, saved: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,DB.Sql.query(db,committed_identity_sql(saved)))
    IO.pure(String,Tx.trim_nl(found))

def committed_identity(db: String, saved: String) -> IO(String):
  committed_identity_read(db,saved)

law committed_identity_is_the_trimmed_field_read:
  for db: String
  for saved: String
  {committed_identity(db,saved) == committed_identity_read(db,saved) : IO(String)}

def committed_identity_is_the_trimmed_field_read(db,saved):
  {==}

# The recipient owed by one committed message. Empty when the row is unknown,
# already acknowledged, or was never committed.
def wake_recipient_sql(+id: String) -> String:
  "SELECT coalesce((SELECT recipient FROM messages WHERE id=" ++ C.q(id) ++ " AND receipt IS NULL),'');"

law wake_recipient_sql_reads_the_committed_recipient:
  for +id: String
  {wake_recipient_sql(id) == "SELECT coalesce((SELECT recipient FROM messages WHERE id=" ++ C.q(id) ++ " AND receipt IS NULL),'');" : String}

def wake_recipient_sql_reads_the_committed_recipient(id):
  {==}

# The committed message starts through the detached native delivery entry.
def launch_wake_target(db: String, target: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Receive.wake_launch(db,target)

law admitted_wake_launches_the_detached_native_entry:
  for +db: String
  for +target: String
  {launch_wake_target(db,target) == (do IO<Result<&1,&1,U32 & String,Unit>>:
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    launched : String <- IO.try(String,Host.Control.launch(Tx.enc_argv([executable,"--dispatch-message",database,target]),database,target))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})) : IO(Result<&1,&1,U32 & String,Unit>)}

def admitted_wake_launches_the_detached_native_entry(db,target):
  {==}

def drive_session_empty(+db: String, session: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match empty:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: Receive.wake_due(db,session,"0",target => launch_wake_target(db,target))

law a_nonempty_committed_session_drives_the_detached_entry:
  for +db: String
  for session: String
  {drive_session_empty(db,session,False{}) == Receive.wake_due(db,session,"0",target => launch_wake_target(db,target)) : IO(Result<&1,&1,U32 & String,Unit>)}

def a_nonempty_committed_session_drives_the_detached_entry(db,session):
  {==}

def drive_session(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  drive_session_empty(db,session,String.is_empty(session))

def drive_id_found(+db: String, id: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match empty:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      found : String <- IO.try(String,DB.Sql.query(db,wake_recipient_sql(id)))
      drive_session(db,Tx.trim_nl(found))

law the_found_recipient_reads_the_committed_row:
  for +db: String
  for id: String
  {drive_id_found(db,id,False{}) == (do IO<Result<&1,&1,U32 & String,Unit>>:
    found : String <- IO.try(String,DB.Sql.query(db,wake_recipient_sql(id)))
    drive_session(db,Tx.trim_nl(found))) : IO(Result<&1,&1,U32 & String,Unit>)}

def the_found_recipient_reads_the_committed_row(db,id):
  {==}

def drive_id(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  drive_id_found(db,id,String.is_empty(id))

# A committed answer drives the identity it carries. A refused answer drives
# nothing, so no refused or stopped admission ever reaches the session driver.
def drive_answer(+db: String, answer: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +identity : String <- committed_identity(db,answer)
    drive_id(db,identity)

law a_committed_answer_drives_by_its_committed_identity:
  for +db: String
  for answer: String
  {drive_answer(db,answer) == (do IO<Result<&1,&1,U32 & String,Unit>>:
    +identity : String <- committed_identity(db,answer)
    drive_id(db,identity)) : IO(Result<&1,&1,U32 & String,Unit>)}

def a_committed_answer_drives_by_its_committed_identity(db,answer):
  {==}

def drive_command(db: String, command: C.Command, answer: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match answer:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Done{saved}: drive_answer(db,saved)

law a_committed_admission_drives_its_committed_identity:
  for db: String
  for command: C.Command
  for saved: String
  {drive_command(db,command,Done{saved}) == drive_answer(db,saved) : IO(Result<&1,&1,U32 & String,Unit>)}

def a_committed_admission_drives_its_committed_identity(db,command,saved):
  {==}

law refused_answer_drives_nothing:
  for db: String
  for command: C.Command
  {drive_command(db,command,Fail{(1,"denied")}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

def refused_answer_drives_nothing(db,command):
  {==}

law empty_identity_drives_nothing:
  for db: String
  {drive_id(db,"") == IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

def empty_identity_drives_nothing(db):
  {==}
