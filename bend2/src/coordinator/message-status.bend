import Base
import ../context/request.bend as Req

# A row records one complete owned action output in one admitted attempt.
# Handling is recorded by the owned acknowledgement or successful settlement.
def schema() -> String:
  "CREATE TABLE IF NOT EXISTS message_reads(attempt TEXT NOT NULL, message TEXT NOT NULL REFERENCES messages(id), recipient TEXT NOT NULL REFERENCES sessions(id), native TEXT NOT NULL, identity TEXT NOT NULL, handled TEXT, PRIMARY KEY(attempt,identity,message));"

def q(value: String) -> String:
  Req.sql_quote(value)

def present_sql() -> String:
  "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='message_reads';"

def exposed(+read: Bool, +field: String) -> String:
  Bool.pick(String,read,"json_extract(j.value,'$.delivery." ++ field ++ "')","json_extract(j.value,'$." ++ field ++ "')")

def found(read: Bool) -> String:
  Bool.pick(String,read,"json_extract(j.value,'$.status')='found'","1")

def projection(+message: String) -> String:
  "json_object('delivered',CASE WHEN EXISTS(SELECT 1 FROM message_reads r WHERE r.message=" ++ message ++ ") THEN 'recorded' ELSE 'unrecorded' END,"
  ++ "'read',CASE WHEN EXISTS(SELECT 1 FROM message_reads r WHERE r.message=" ++ message ++ ") THEN 'recorded' ELSE 'unrecorded' END,"
  ++ "'handled',CASE WHEN EXISTS(SELECT 1 FROM message_reads r WHERE r.message=" ++ message ++ " AND r.handled IS NOT NULL) THEN 'recorded' WHEN EXISTS(SELECT 1 FROM message_reads r WHERE r.message=" ++ message ++ ") THEN 'incomplete' ELSE 'unrecorded' END,"
  ++ "'attempts',json(coalesce((SELECT json_group_array(json_object('id',r.attempt,'recipient',r.recipient,'native',r.native,'identity',r.identity,'handled',r.handled)) FROM message_reads r WHERE r.message=" ++ message ++ "),'[]')))"

def decorate_observed_sql(saved: String, read: Bool, known: Bool) -> String:
  "SELECT coalesce(json_group_array(json(item)),'[]') FROM (SELECT json_patch(j.value,json_object('nativeInputStatus'," ++ Bool.pick(String,known,projection(exposed(read,"id")),"json_object('delivered','unrecorded','read','unrecorded','handled','unrecorded','attempts',json('[]'))") ++ ")) AS item FROM json_each(" ++ q(saved) ++ ") j ORDER BY CAST(j.key AS INTEGER));"

def decorate_detail_sql(+saved: String) -> String:
  "SELECT json_set(" ++ q(saved) ++ ",'$.message.nativeInputStatus',json(" ++ projection("json_extract(" ++ q(saved) ++ ",'$.message.id')") ++ "),'$.attemptRelation',json_object('status',CASE WHEN EXISTS(SELECT 1 FROM message_reads r WHERE r.message=json_extract(" ++ q(saved) ++ ",'$.message.id')) THEN 'recorded' ELSE 'unrecorded' END,'attempts',json(coalesce((SELECT json_group_array(json_object('id',r.attempt,'recipient',r.recipient,'native',r.native,'identity',r.identity,'handled',r.handled)) FROM message_reads r WHERE r.message=json_extract(" ++ q(saved) ++ ",'$.message.id')),'[]'))));"

def current_sql(session: String, directory: String) -> String:
  "SELECT hex(e.id) || char(9) || hex(s.native) FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ q(session)
  ++ " AND e.directory=" ++ q(directory) ++ " AND e.phase='running' AND s.native<>'' AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=e.session);"

def record_sql(+session: String, +directory: String, +attempt: String, +native: String, identity: String, saved: String, +read: Bool) -> String:
  "BEGIN IMMEDIATE;INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT " ++ q(attempt) ++ ",m.id,m.recipient," ++ q(native) ++ "," ++ q(identity)
  ++ " FROM json_each(" ++ q(saved) ++ ") j JOIN messages m ON m.id=" ++ exposed(read,"id")
  ++ " JOIN executions e ON e.session=m.recipient JOIN sessions s ON s.id=e.session WHERE " ++ found(read)
  ++ " AND m.recipient=" ++ q(session) ++ " AND m.recipient=" ++ exposed(read,"recipient") ++ " AND m.body=" ++ exposed(read,"body")
  ++ " AND e.id=" ++ q(attempt) ++ " AND e.directory=" ++ q(directory) ++ " AND e.phase='running' AND s.native=" ++ q(native)
  ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=e.session) ON CONFLICT(attempt,identity,message) DO NOTHING;COMMIT;"

def settle_sql(+session: String, +attempt: String, +identity: String) -> String:
  +receipt = "native-turn:" ++ attempt
  "BEGIN IMMEDIATE;UPDATE message_reads SET handled=coalesce(handled," ++ q(receipt) ++ ") WHERE recipient=" ++ q(session) ++ " AND attempt=" ++ q(attempt) ++ " AND identity=" ++ q(identity)
  ++ " AND EXISTS(SELECT 1 FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ q(session) ++ " AND e.id=" ++ q(attempt) ++ " AND s.native=message_reads.native)"
  ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ q(session) ++ ");"
  ++ "UPDATE messages SET receipt=coalesce(receipt," ++ q(receipt) ++ ") WHERE recipient=" ++ q(session) ++ " AND id IN(SELECT r.message FROM message_reads r JOIN executions e ON e.id=r.attempt AND e.session=r.recipient JOIN sessions s ON s.id=r.recipient WHERE r.recipient=" ++ q(session) ++ " AND r.attempt=" ++ q(attempt) ++ " AND r.identity=" ++ q(identity) ++ " AND s.native=r.native AND r.handled IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ q(session) ++ ");COMMIT;"

# A successfully completed turn consumes every input carried by its admitted
# prompt and every guidance frame forwarded to the native attempt before it
# stopped. Input after the prompt that was not forwarded stays owed. The
# initial cursor covers the prompt; the delivered cursor covers live guidance.
def consume_delivered_sql(+session: String, +attempt: String, +native: String, +initial_cursor: String, +delivered_cursor: String) -> String:
  +receipt = "native-turn:" ++ attempt
  +eligible = "recipient=" ++ q(session) ++ " AND receipt IS NULL AND (seq<=CAST(" ++ q(initial_cursor) ++ " AS INTEGER) OR (kind='guidance' AND seq<=CAST(" ++ q(delivered_cursor) ++ " AS INTEGER)))"
  +current = "EXISTS(SELECT 1 FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ q(session) ++ " AND e.id=" ++ q(attempt) ++ " AND e.phase='exited' AND s.native=" ++ q(native) ++ ")"
  +unstopped = "NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ q(session) ++ ")"
  "BEGIN IMMEDIATE;UPDATE message_reads SET handled=coalesce(handled," ++ q(receipt) ++ ") WHERE recipient=" ++ q(session) ++ " AND attempt=" ++ q(attempt) ++ " AND native=" ++ q(native)
  ++ " AND message IN(SELECT id FROM messages WHERE " ++ eligible ++ ") AND " ++ current ++ " AND " ++ unstopped ++ ";"
  ++ "UPDATE messages SET receipt=coalesce(receipt," ++ q(receipt) ++ ") WHERE " ++ eligible ++ " AND " ++ current ++ " AND " ++ unstopped ++ ";COMMIT;"

# The admitted complete prompt supplies the exact stored header and body.
def prompt_record_sql(+session: String, +attempt: String, +native: String, identity: String, +input: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT " ++ q(attempt) ++ ",m.id,m.recipient," ++ q(native) ++ "," ++ q(identity)
  ++ " FROM json_each(json_extract(" ++ q(input) ++ ",'$.inputMessages')) selected JOIN messages m ON m.id=selected.value JOIN executions e ON e.session=m.recipient JOIN sessions s ON s.id=e.session WHERE selected.type='text' AND m.recipient=" ++ q(session)
  ++ " AND e.id=" ++ q(attempt) ++ " AND s.native=" ++ q(native)
  ++ " AND json_extract(" ++ q(input) ++ ",'$.session')=" ++ q(session) ++ " AND json_extract(" ++ q(input) ++ ",'$.attempt')=" ++ q(attempt)
  ++ " AND CASE WHEN json_extract(" ++ q(input) ++ ",'$.direct') THEN m.id=" ++ q(attempt ++ ":task-input") ++ " ELSE m.seq<=CAST(json_extract(" ++ q(input) ++ ",'$.cursor') AS INTEGER) END"
  ++ " AND instr(json_extract(" ++ q(input) ++ ",'$.prompt'),'Message (' || m.kind || ') from ' || m.sender || ' [id: ' || m.id || ']:' || char(10) || m.body)>0"
  ++ " ON CONFLICT(attempt,identity,message) DO NOTHING;COMMIT;"

def codex_context_sql(session: String, native: String) -> String:
  "SELECT count(*) FROM sessions s WHERE s.id=" ++ q(session) ++ " AND s.native=" ++ q(native) ++ " AND s.harness='codex' AND s.native<>'' AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=s.id);"

def codex_attempt(turn: String) -> String:
  "codex-turn:" ++ turn

def codex_identity(native: String, turn: String) -> String:
  "json_array('codex'," ++ q(native) ++ "," ++ q(turn) ++ ")"

def codex_record_sql(+session: String, +native: String, +turn: String, saved: String, +read: Bool) -> String:
  "BEGIN IMMEDIATE;INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT " ++ q(codex_attempt(turn)) ++ ",m.id,m.recipient," ++ q(native) ++ "," ++ codex_identity(native,turn)
  ++ " FROM json_each(" ++ q(saved) ++ ") j JOIN messages m ON m.id=" ++ exposed(read,"id") ++ " JOIN sessions s ON s.id=m.recipient WHERE " ++ found(read)
  ++ " AND m.recipient=" ++ q(session) ++ " AND m.recipient=" ++ exposed(read,"recipient") ++ " AND m.body=" ++ exposed(read,"body")
  ++ " AND s.native=" ++ q(native) ++ " AND s.harness='codex' AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=s.id)"
  ++ " AND NOT EXISTS(SELECT 1 FROM messages terminal WHERE terminal.id=" ++ q("codex-inbox-turn:" ++ session ++ ":" ++ native ++ ":" ++ turn) ++ " AND terminal.sender=s.id AND terminal.kind='report')"
  ++ " ON CONFLICT(attempt,identity,message) DO NOTHING;COMMIT;"

def codex_terminal_sql(+session: String, +native: String, +turn: String) -> String:
  "EXISTS(SELECT 1 FROM messages terminal JOIN sessions s ON s.id=terminal.sender WHERE terminal.id=" ++ q("codex-inbox-turn:" ++ session ++ ":" ++ native ++ ":" ++ turn)
  ++ " AND terminal.sender=" ++ q(session) ++ " AND terminal.kind='report' AND s.native=" ++ q(native) ++ " AND s.harness='codex'"
  ++ " AND CASE WHEN json_valid(terminal.body) THEN json_extract(terminal.body,'$.type')='codex-inbox-turn-settled' AND json_extract(terminal.body,'$.session')=" ++ q(session)
  ++ " AND json_extract(terminal.body,'$.threadId')=" ++ q(native) ++ " AND json_extract(terminal.body,'$.turn.id')=" ++ q(turn) ++ " AND json_extract(terminal.body,'$.turn.status')='completed' ELSE 0 END)"

def settle_codex_sql(+session: String, +native: String, +turn: String) -> String:
  +attempt = codex_attempt(turn)
  +receipt = "native-turn:" ++ attempt
  "BEGIN IMMEDIATE;UPDATE message_reads SET handled=coalesce(handled," ++ q(receipt) ++ ") WHERE recipient=" ++ q(session) ++ " AND native=" ++ q(native) ++ " AND attempt=" ++ q(attempt) ++ " AND identity=" ++ codex_identity(native,turn)
  ++ " AND " ++ codex_terminal_sql(session,native,turn) ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ q(session) ++ ");"
  ++ "UPDATE messages SET receipt=coalesce(receipt," ++ q(receipt) ++ ") WHERE recipient=" ++ q(session) ++ " AND id IN(SELECT message FROM message_reads WHERE recipient=" ++ q(session) ++ " AND native=" ++ q(native) ++ " AND attempt=" ++ q(attempt) ++ " AND identity=" ++ codex_identity(native,turn) ++ " AND handled IS NOT NULL)"
  ++ " AND " ++ codex_terminal_sql(session,native,turn) ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ q(session) ++ ");COMMIT;"
