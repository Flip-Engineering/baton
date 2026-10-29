import Base
import ../context/request.bend as Req

# A row records one complete owned read in one admitted attempt. It persists
# whether or not the turn later succeeds. The handled column retains historical
# values for compatibility. Legacy receipts backfill as read rows, and current
# read state derives from message_reads.
def schema() -> String:
  "CREATE TABLE IF NOT EXISTS message_reads(attempt TEXT NOT NULL, message TEXT NOT NULL REFERENCES messages(id), recipient TEXT NOT NULL REFERENCES sessions(id), native TEXT NOT NULL, identity TEXT NOT NULL, handled TEXT, PRIMARY KEY(attempt,identity,message));"
  ++ "CREATE INDEX IF NOT EXISTS message_reads_by_message ON message_reads(message);"
  ++ "CREATE INDEX IF NOT EXISTS message_reads_message ON message_reads(message,recipient);"
  ++ "INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT 'legacy',m.id,m.recipient,'','receipt' FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NOT NULL AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.recipient=m.recipient) ON CONFLICT(attempt,identity,message) DO NOTHING;"

def q(value: String) -> String:
  Req.sql_quote(value)

# Message lifecycle is delivered/read. A message is owed while the recipient
# has no recorded complete read, and read state derives from message_reads
# alone. The backfill above translates each historical receipt into a read row
# once, so a stored receipt value never gates delivery or read state.
def owed_sql(+row: String) -> String:
  "NOT EXISTS(SELECT 1 FROM message_reads owed_read WHERE owed_read.message=" ++ row ++ ".id AND owed_read.recipient=" ++ row ++ ".recipient)"

def read_sql(+row: String) -> String:
  "EXISTS(SELECT 1 FROM message_reads has_read WHERE has_read.message=" ++ row ++ ".id AND has_read.recipient=" ++ row ++ ".recipient)"

# A public read of an owned message records the read event itself. An active
# attempt binds its own attempt and native witness before this path is reached;
# this row is the recipient's CLI read, so it uses the stable CLI identity.
def cli_read_sql(+session: String, saved: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT 'cli',m.id,m.recipient,coalesce((SELECT s.native FROM sessions s WHERE s.id=m.recipient),''),'cli' FROM json_each(" ++ q(saved) ++ ") j JOIN messages m ON m.id=coalesce(json_extract(j.value,'$.delivery.id'),json_extract(j.value,'$.id')) WHERE m.recipient=" ++ q(session)
  ++ " AND m.recipient=coalesce(json_extract(j.value,'$.delivery.recipient'),json_extract(j.value,'$.recipient')) AND m.body=coalesce(json_extract(j.value,'$.delivery.body'),json_extract(j.value,'$.body'))"
  ++ " AND ((json_extract(j.value,'$.status')='found' AND json_type(j.value,'$.delivery')='object') OR (json_extract(j.value,'$.status') IS NULL AND json_type(j.value,'$.body')='text')) ON CONFLICT(attempt,identity,message) DO NOTHING;"
  ++ "DELETE FROM wake_claims WHERE session=" ++ q(session) ++ " AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.recipient=" ++ q(session) ++ " AND " ++ owed_sql("m") ++ ");COMMIT;"

def present_sql() -> String:
  "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='message_reads';"

def exposed(+read: Bool, +field: String) -> String:
  Bool.pick(String,read,"coalesce(json_extract(j.value,'$.delivery." ++ field ++ "'),json_extract(j.value,'$." ++ field ++ "'))","json_extract(j.value,'$." ++ field ++ "')")

def found(read: Bool) -> String:
  Bool.pick(String,read,"((json_extract(j.value,'$.status')='found' AND json_type(j.value,'$.delivery')='object' AND json_type(j.value,'$.delivery.body')='text' AND json_type(j.value,'$.delivery.recipient')='text') OR (json_extract(j.value,'$.status') IS NULL AND json_type(j.value,'$.body')='text' AND json_type(j.value,'$.recipient')='text'))","1")

def projection(+message: String) -> String:
  "json_object('delivered','recorded',"
  ++ "'read',CASE WHEN EXISTS(SELECT 1 FROM message_reads r WHERE r.message=" ++ message ++ ") THEN 'recorded' ELSE 'unrecorded' END,"
  ++ "'attempts',json(coalesce((SELECT json_group_array(json_object('id',r.attempt,'recipient',r.recipient,'native',r.native,'identity',r.identity)) FROM message_reads r WHERE r.message=" ++ message ++ "),'[]')))"

def decorate_observed_sql(saved: String, read: Bool, known: Bool) -> String:
  "SELECT coalesce(json_group_array(json(item)),'[]') FROM (SELECT json_patch(j.value,json_object('nativeInputStatus'," ++ Bool.pick(String,known,projection(exposed(read,"id")),"json_object('delivered','unrecorded','read','unrecorded','attempts',json('[]'))") ++ ")) AS item FROM json_each(" ++ q(saved) ++ ") j ORDER BY CAST(j.key AS INTEGER));"

def decorate_detail_sql(+saved: String) -> String:
  "SELECT json_set(" ++ q(saved) ++ ",'$.message.nativeInputStatus',json(" ++ projection("json_extract(" ++ q(saved) ++ ",'$.message.id')") ++ "),'$.attemptRelation',json_object('status',CASE WHEN EXISTS(SELECT 1 FROM message_reads r WHERE r.message=json_extract(" ++ q(saved) ++ ",'$.message.id')) THEN 'recorded' ELSE 'unrecorded' END,'attempts',json(coalesce((SELECT json_group_array(json_object('id',r.attempt,'recipient',r.recipient,'native',r.native,'identity',r.identity)) FROM message_reads r WHERE r.message=json_extract(" ++ q(saved) ++ ",'$.message.id')),'[]'))));"

def current_sql(session: String, directory: String) -> String:
  "SELECT hex(e.id) || char(9) || hex(s.native) FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ q(session)
  ++ " AND e.directory=" ++ q(directory) ++ " AND e.phase='running' AND s.native<>'' AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=e.session);"

def record_sql(+session: String, +directory: String, +attempt: String, +native: String, identity: String, saved: String, +read: Bool) -> String:
  "BEGIN IMMEDIATE;INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT " ++ q(attempt) ++ ",m.id,m.recipient," ++ q(native) ++ "," ++ q(identity)
  ++ " FROM json_each(" ++ q(saved) ++ ") j JOIN messages m ON m.id=" ++ exposed(read,"id")
  ++ " JOIN executions e ON e.session=m.recipient JOIN sessions s ON s.id=e.session WHERE " ++ found(read)
  ++ " AND m.recipient=" ++ q(session) ++ " AND m.recipient=" ++ exposed(read,"recipient") ++ " AND m.body=" ++ exposed(read,"body")
  ++ " AND e.id=" ++ q(attempt) ++ " AND e.directory=" ++ q(directory) ++ " AND e.phase='running' AND s.native=" ++ q(native)
  ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=e.session) ON CONFLICT(attempt,identity,message) DO NOTHING;"
  ++ "DELETE FROM wake_claims WHERE session=" ++ q(session) ++ " AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.recipient=" ++ q(session) ++ " AND " ++ owed_sql("m") ++ ");COMMIT;"

# The running execution of a session: attempt, native identity witness
# directory and native conversation, for read recording at guidance
# forwarding time.
def forward_scope_sql(+session: String) -> String:
  "SELECT hex(e.id) || char(9) || hex(e.directory) || char(9) || hex(s.native) FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ q(session)
  ++ " AND e.phase='running' AND s.native<>'' AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=e.session);"

# Guidance written to the native input stream is read by the recipient at
# forwarding time. The read row is recorded in the same transaction as the
# forwarding decision, independent of how the turn later ends.
def forwarded_read_sql(+session: String, +attempt: String, +native: String, identity: String, +next: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT " ++ q(attempt) ++ ",m.id,m.recipient," ++ q(native) ++ "," ++ q(identity)
  ++ " FROM messages m JOIN executions e ON e.session=m.recipient JOIN sessions s ON s.id=e.session WHERE m.seq=CAST(" ++ q(next) ++ " AS INTEGER)"
  ++ " AND m.recipient=" ++ q(session) ++ " AND e.id=" ++ q(attempt) ++ " AND e.phase='running' AND s.native=" ++ q(native)
  ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=e.session)"
  ++ " ON CONFLICT(attempt,identity,message) DO NOTHING;"
  ++ "DELETE FROM wake_claims WHERE session=" ++ q(session) ++ " AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.recipient=" ++ q(session) ++ " AND " ++ owed_sql("m") ++ ");COMMIT;"

# The instruction a conductor receives with a completion request. Each
# argument is an SQL expression for the message row's kind and sender.
def review_instruction_sql(+kind: String, +sender: String) -> String:
  "CASE WHEN " ++ kind ++ "='completion-request' THEN char(10) || 'Review the work against ' || " ++ sender ++ " || char(39) || 's assignment and the supplied evidence. When the assignment is satisfied, use completion-confirmed --to ' || " ++ sender ++ " || ' to end the Player, or add --next TEXT to confirm and dispatch its next assignment together. When work remains, use guide --to ' || " ++ sender ++ " || ' --text TEXT to state what is missing and direct the remaining work.' ELSE '' END"

# One complete message as delivered into a native conversation: the stored
# header and complete body, then the review instruction for a completion
# request. Each argument is an SQL expression. Read recording matches the
# header and body, so the instruction follows them.
def complete_message_sql(+id: String, +kind: String, +sender: String, +body: String) -> String:
  "'Message (' || " ++ kind ++ " || ') from ' || " ++ sender ++ " || ' [id: ' || " ++ id ++ " || ']:' || char(10) || " ++ body ++ " || " ++ review_instruction_sql(kind,sender)

# Turn-start input carries complete bodies for task, task-assignment,
# completion-request and completion-confirmed messages. DSH sessions receive
# complete bodies for all owed messages. Complete prompts record read events
# through prompt_record_sql. Other message kinds carry a pointer to the stored
# body.
def prompt_selection_sql(+session: String, +cursor: String) -> String:
  "SELECT json_object('ids',json_group_array(id),'text',coalesce(group_concat(input,char(10)||char(10)),'')) FROM (SELECT id,CASE WHEN kind IN ('task','task-assignment','completion-request','completion-confirmed') OR EXISTS(SELECT 1 FROM sessions prompt_session WHERE prompt_session.id=" ++ q(session) ++ " AND prompt_session.harness='dsh') THEN " ++ complete_message_sql("id","kind","sender","body") ++ " ELSE 'Message (' || kind || ') from ' || sender || ' [id: ' || id || '] retained ' || CAST(length(CAST(body AS BLOB)) AS TEXT) || ' bytes; read the complete body with baton read ' || id || '.' END AS input FROM messages WHERE recipient=" ++ q(session) ++ " AND " ++ owed_sql("messages") ++ " AND seq<=CAST(" ++ q(cursor) ++ " AS INTEGER) ORDER BY seq);"

# The admitted complete prompt supplies the exact stored header and body.
def prompt_record_sql(+session: String, +attempt: String, +native: String, identity: String, +input: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT " ++ q(attempt) ++ ",m.id,m.recipient," ++ q(native) ++ "," ++ q(identity)
  ++ " FROM json_each(json_extract(" ++ q(input) ++ ",'$.inputMessages')) selected JOIN messages m ON m.id=selected.value JOIN executions e ON e.session=m.recipient JOIN sessions s ON s.id=e.session WHERE selected.type='text' AND m.recipient=" ++ q(session)
  ++ " AND e.id=" ++ q(attempt) ++ " AND s.native=" ++ q(native)
  ++ " AND json_extract(" ++ q(input) ++ ",'$.session')=" ++ q(session) ++ " AND json_extract(" ++ q(input) ++ ",'$.attempt')=" ++ q(attempt)
  ++ " AND CASE WHEN json_extract(" ++ q(input) ++ ",'$.direct') THEN m.id=" ++ q(attempt ++ ":task-input") ++ " ELSE m.seq<=CAST(json_extract(" ++ q(input) ++ ",'$.cursor') AS INTEGER) END"
  ++ " AND instr(json_extract(" ++ q(input) ++ ",'$.prompt'),'Message (' || m.kind || ') from ' || m.sender || ' [id: ' || m.id || ']:' || char(10) || m.body)>0"
  ++ " ON CONFLICT(attempt,identity,message) DO NOTHING;"
  ++ "DELETE FROM wake_claims WHERE session=" ++ q(session) ++ " AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.recipient=" ++ q(session) ++ " AND " ++ owed_sql("m") ++ ");COMMIT;"

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
  ++ " ON CONFLICT(attempt,identity,message) DO NOTHING;"
  ++ "DELETE FROM wake_claims WHERE session=" ++ q(session) ++ " AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.recipient=" ++ q(session) ++ " AND " ++ owed_sql("m") ++ ");COMMIT;"
