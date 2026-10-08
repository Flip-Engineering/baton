import Base
import ../coordinator/commands.bend as C
import ./receive.bend as Receive
import ./delivery.bend as Delivery
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

# Admission driver for issue #685. Every committed message admission is
# evaluated for a due wake at exactly this event. Invocation exit is covered
# by the receive-side driver.
def admitted_message_id(command: C.Command) -> String:
  match command:
    case C.Message{id,sender,recipient,kind,body}: id
    case C.Report{id,sender,body}: id
    case C.Ask{id,player,body}: id
    case C.Observe{id,player,event,sealed}: id
    case other: ""

# The recipient owed by one admitted message. Empty when the message is
# unknown, already acknowledged, or never committed.
def wake_recipient_sql(+id: String) -> String:
  "SELECT coalesce((SELECT recipient FROM messages WHERE id=" ++ C.q(id) ++ " AND receipt IS NULL),'');"

# The admission returns the delivery result. A live receiver owns its queued
# continuation and starts it through the receive completion path.
def launch_wake_target(db: String, target: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,target,"1","")
    IO.pure(Result<&1,&1,U32 & String,Unit>,Delivery.wake_result(delivered))

def drive_session_empty(+db: String, session: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match empty:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: Receive.wake_due(db,session,"0",target => launch_wake_target(db,target))

def drive_session(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  drive_session_empty(db,session,String.is_empty(session))

def stopped_recipient_sql(id: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM messages m JOIN session_stops st ON st.session=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL);"

# Reports addressed to a stopped session go through its parent handoff.
def drive_recipient(db: String, id: String, session: String, stopped: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stopped:
    case True{}: launch_wake_target(db,id)
    case False{}: drive_session(db,session)

def drive_id_found(+db: String, id: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match empty:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      found : String <- IO.try(String,DB.Sql.query(db,wake_recipient_sql(id)))
      stopped : String <- IO.try(String,DB.Sql.query(db,stopped_recipient_sql(id)))
      drive_recipient(db,id,Tx.trim_nl(found),String.eq(stopped,"1\n"))

def drive_id(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  drive_id_found(db,id,String.is_empty(id))

# A committed answer with a message identity reaches the session driver.
def drive_command(db: String, command: C.Command, answer: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match answer:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Done{saved}: drive_id(db,admitted_message_id(command))
