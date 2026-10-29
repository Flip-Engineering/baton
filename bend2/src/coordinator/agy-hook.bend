# Antigravity injects complete input before a model invocation and checks
# assignment completion at its Stop boundary.
import Base
import ../coordinator/commands.bend as C
import ../coordinator/message-status.bend as Status
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ./input-hook.bend as InputHook

def message_text_sql(+saved: String) -> String:
  "coalesce((SELECT group_concat(line,char(10)||char(10)) FROM (SELECT " ++ Status.complete_message_sql("json_extract(j.value,'$.id')","json_extract(j.value,'$.kind')","json_extract(j.value,'$.sender')","json_extract(j.value,'$.body')") ++ " AS line FROM json_each(" ++ C.q(saved) ++ ") j ORDER BY CAST(j.key AS INTEGER))),'')"

def pre_invocation_sql(+saved: String) -> String:
  "SELECT json_object('injectSteps',CASE WHEN json_array_length(" ++ C.q(saved) ++ ")=0 THEN json('[]') ELSE json_array(json_object('userMessage','Baton input for this turn. Handle the following complete messages:' || char(10) || " ++ message_text_sql(saved) ++ ")) END);"

# The assignment is finished when the owed input is only completion
# confirmations and the session's current request is confirmed and the session
# is not stopped (task_ended_sql). A confirmation without a matching current
# request, or one that predates later guidance or a new assignment, does not end
# the assignment, so its delivery keeps the instruction to continue.
def confirmations_only_sql(+saved: String) -> String:
  "NOT EXISTS(SELECT 1 FROM json_each(" ++ C.q(saved) ++ ") j WHERE json_extract(j.value,'$.kind')<>'completion-confirmed')"

def stop_instruction_sql(+session: String, +saved: String) -> String:
  "CASE WHEN " ++ confirmations_only_sql(saved) ++ " AND " ++ C.task_ended_sql(C.q(session)) ++ " THEN 'The conductor confirmed your completion request and the assignment is finished. Make no further changes and end your turn.' ELSE 'Continue the work. When the assignment is ready, call completion-request --text SUMMARY with run_command.' END"

def stop_sql(+session: String, +saved: String) -> String:
  "SELECT CASE WHEN json_array_length(" ++ C.q(saved) ++ ")>0 THEN json_object('decision','continue','reason','Baton has complete input for this turn:' || char(10) || " ++ message_text_sql(saved) ++ " || char(10) || " ++ stop_instruction_sql(session,saved) ++ ")"
  ++ " WHEN " ++ C.task_open_sql(C.q(session)) ++ " AND " ++ C.task_request_sql(C.q(session)) ++ " IS NULL THEN json_object('decision','continue','reason','The current assignment remains open. Continue the work. When it is ready, call completion-request --text SUMMARY with run_command so the conductor can review it.')"
  ++ " WHEN " ++ C.task_open_sql(C.q(session)) ++ " THEN json_object('decision','continue','reason','Completion request ' || " ++ C.task_request_sql(C.q(session)) ++ " || ' is awaiting the conductor decision. Continue the assignment and follow any guidance they send.')"
  ++ " ELSE json_object('decision','allow') END;"

def record_input(db: String, session: String, directory: String, saved: String, fields: List<String>) -> IO(Unit):
  match fields:
    case attempt <> native <> identity <> Nil{}: do IO<Unit>:
      stored : String <- IO.try(String,DB.Sql.query(db,InputHook.record_sql(session,directory,Tx.hex_decode(attempt),Tx.hex_decode(native),Tx.hex_decode(identity),saved)))
      IO.pure(Unit,Unit{})
    case other: IO.pure(Unit,Unit{})

def delivered(+db: String, +session: String, +directory: String, +witness: String, +saved: String, output: String) -> IO(Unit):
  do IO<Unit>:
    printed : Unit <- IO.print(Tx.trim_nl(output))
    scope : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(e.id)||char(9)||hex(s.native)||char(9)||hex(json_extract(" ++ C.q(witness) ++ ",'$.identity')) FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ C.q(session) ++ " AND e.directory=" ++ C.q(directory) ++ " AND e.phase='running' AND s.native<>'' AND json_extract(" ++ C.q(witness) ++ ",'$.live')=1 AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"))
    record_input(db,session,directory,saved,Tx.split_tabs(Tx.trim_nl(scope)))

def pre_invocation(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    +directory : String <- InputHook.environment("BATON_ATTEMPT_DIRECTORY")
    +witness : String <- InputHook.witness(db,directory,String.is_empty(directory))
    saved : String <- IO.try(String,DB.Sql.read(db,InputHook.selection_sql(session)))
    +messages : String <- IO.pure(String,Tx.trim_nl(saved))
    output : String <- IO.try(String,DB.Sql.read(db,pre_invocation_sql(messages)))
    delivered(db,session,directory,witness,messages,output)

def stop(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    +directory : String <- InputHook.environment("BATON_ATTEMPT_DIRECTORY")
    +witness : String <- InputHook.witness(db,directory,String.is_empty(directory))
    saved : String <- IO.try(String,DB.Sql.read(db,InputHook.selection_sql(session)))
    +messages : String <- IO.pure(String,Tx.trim_nl(saved))
    output : String <- IO.try(String,DB.Sql.read(db,stop_sql(session,messages)))
    delivered(db,session,directory,witness,messages,output)
