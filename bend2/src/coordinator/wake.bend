import Base
import ../coordinator/commands.bend as C
import ./receive.bend as Receive
import ./delivery.bend as Delivery
import ./codex-route.bend as CodexRoute
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
    case C.TaskContinue{session,id}: id ++ ":task-continuation"
    case other: ""

# The recipient owed by one admitted message. Empty when the message is
# unknown, already acknowledged, or never committed.
def wake_recipient_sql(+id: String) -> String:
  "SELECT coalesce((SELECT recipient FROM messages WHERE id=" ++ C.q(id) ++ " AND receipt IS NULL),'');"

# Short endpoints return their public input admission result.
def deliver_wake_target(db: String, target: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,target,"1","")
    IO.pure(Result<&1,&1,U32 & String,Unit>,Delivery.wake_result(delivered))

# Explicit receiver argv can carry the whole native lifetime. A stopped
# recipient's report or question follows its recorded parent handoff.
def detached_endpoint_sql(id: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM messages m JOIN sessions s ON s.id=CASE WHEN " ++ C.stopped_session_sql("m.recipient") ++ " AND m.kind IN ('report','question') THEN " ++ C.report_recipient("m.recipient") ++ " ELSE m.recipient END WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND NOT " ++ C.stopped_session_sql("s.id") ++ " AND CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 ELSE 0 END AND NOT (s.harness='codex' AND " ++ CodexRoute.managed_sql("s.endpoint","s.id","s.native") ++ "));"

# Public resume and direct delivery retain their attached endpoint behavior.
# Managed Codex endpoints return their native input admission result here.
def endpoint_selected(db: String, target: String, detached: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match detached:
    case True{}: Receive.wake_launch(db,target)
    case False{}: deliver_wake_target(db,target)

law explicit_endpoint_admission_hands_over_delivery:
  for db: String
  for target: String
  {endpoint_selected(db,target,True{}) == Receive.wake_launch(db,target) : IO(Result<&1,&1,U32 & String,Unit>)}

def explicit_endpoint_admission_hands_over_delivery(db,target):
  {==}

law short_endpoint_admission_returns_its_result:
  for db: String
  for target: String
  {endpoint_selected(db,target,False{}) == deliver_wake_target(db,target) : IO(Result<&1,&1,U32 & String,Unit>)}

def short_endpoint_admission_returns_its_result(db,target):
  {==}

# Ordinary admissions hand explicit argv to the retained detached self entry.
def launch_wake_target(+db: String, +target: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    detached : String <- IO.try(String,DB.Sql.query(db,detached_endpoint_sql(target)))
    endpoint_selected(db,target,String.eq(detached,"1\n"))

def drive_session_empty(+db: String, session: String, id: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match empty:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      cursor : String <- IO.try(String,DB.Sql.query(db,"SELECT CAST(seq-1 AS TEXT) FROM messages WHERE id=" ++ C.q(id) ++ ";"))
      Receive.wake_due(db,session,Tx.trim_nl(cursor),target => launch_wake_target(db,target))

def drive_session(+db: String, +session: String, id: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  drive_session_empty(db,session,id,String.is_empty(session))

def stopped_recipient_sql(id: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM messages m JOIN session_stops st ON st.session=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL);"

# Reports addressed to a stopped session go through its parent handoff.
def drive_recipient(db: String, id: String, session: String, stopped: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stopped:
    case True{}: launch_wake_target(db,id)
    case False{}: drive_session(db,session,id)

def drive_id_found(+db: String, +id: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
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
