import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./receive.bend as Receive
import ./delivery.bend as Delivery
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

# Admission driver for issue #685. Every committed message admission is
# evaluated for a due wake at exactly this event. Invocation exit is covered
# by the receive-side driver. There is no polling interval, retry schedule,
# count cutoff or time cutoff anywhere in this module.
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

# The launch a wake hands to the continuation driver: exactly the admitted
# message through the existing delivery path, converted to the wake result.
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

def drive_id_found(+db: String, id: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match empty:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      found : String <- IO.try(String,DB.Sql.query(db,wake_recipient_sql(id)))
      drive_session(db,Tx.trim_nl(found))

def drive_id(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  drive_id_found(db,id,String.is_empty(id))

# A refused or stopped admission drives nothing. Only a committed answer with
# a message identity reaches the session driver.
def drive_command(db: String, command: C.Command, answer: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match answer:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Done{saved}: drive_id(db,admitted_message_id(command))

law admitted_message_drives_by_its_identity:
  for id: String
  for sender: String
  for recipient: String
  for kind: String
  for body: String
  {admitted_message_id(C.Message{id,sender,recipient,kind,body}) == id : String}

def admitted_message_drives_by_its_identity(id,sender,recipient,kind,body):
  {==}

law report_admission_drives_by_its_identity:
  for id: String
  for sender: String
  for body: String
  {admitted_message_id(C.Report{id,sender,body}) == id : String}

def report_admission_drives_by_its_identity(id,sender,body):
  {==}

law non_message_admission_drives_nothing:
  for id: String
  {admitted_message_id(C.Session{id}) == "" : String}

def non_message_admission_drives_nothing(id):
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
