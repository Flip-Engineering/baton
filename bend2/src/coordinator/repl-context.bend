import Base
import ./repl-model.bend as M
import ./store.bend as Store
import ./wake.bend as Wake
import ./agent-input.bend as AgentInput
import ./commands.bend as C

# A citation pins the immutable cell sequence within its owner's notebook.
def citation_sql() -> String:
  "'repl:'||n.id||':'||CASE WHEN c.label='' THEN c.id ELSE c.label END||'@'||c.seq"

def successful_sql(+cell: String) -> String:
  "EXISTS(SELECT 1 FROM repl_attempts a WHERE a.cell=" ++ cell ++ " AND a.stage='compiler' AND a.wait_status='exit 0' AND a.cause='' AND CASE WHEN json_valid(a.stdout) THEN json_extract(a.stdout,'$.kind')<>'native' OR EXISTS(SELECT 1 FROM repl_attempts r WHERE r.cell=a.cell AND r.stage='native' AND r.wait_status='exit 0' AND r.cause='') ELSE 0 END) AND NOT EXISTS(SELECT 1 FROM repl_attempts a WHERE a.cell=" ++ cell ++ " AND (a.wait_status IS NULL OR a.wait_status<>'exit 0' OR a.cause<>''))"

def metadata_sql() -> String:
  "json_object('format','baton.repl-context/v1','citation'," ++ citation_sql() ++ ",'reference',c.id,'owner',n.owner,'notebook',n.name,'label',c.label,'version',c.seq,'operation',c.operation,'context',(SELECT json_object('format','baton.context-value/v1','mediaType','application/vnd.baton.context-value+json','totalCharacters',length(v.value),'preview',substr(v.value,1,1024),'complete',json(CASE WHEN length(v.value)<=1024 THEN 'true' ELSE 'false' END)) FROM repl_context_values v WHERE v.cell=c.id),'result',json((SELECT CASE WHEN json_valid(a.stdout) THEN json_object('kind',json_extract(a.stdout,'$.kind'),'type',json_extract(a.stdout,'$.type')) ELSE '{}' END FROM repl_attempts a WHERE a.cell=c.id AND a.stage='compiler')))"

def cite(+db: String, +actor: String, cell: String) -> IO(String):
  do IO<String>:
    ready : Unit <- M.actor_ready(db,actor)
    +body : String <- M.scalar(db,"SELECT " ++ metadata_sql() ++ " FROM repl_cells c JOIN repl_notebooks n ON n.id=c.notebook WHERE c.id=" ++ C.q(cell) ++ " AND n.owner=" ++ C.q(actor) ++ " AND " ++ successful_sql("c.id"))
    found : Unit <- M.require(Bool.not(String.is_empty(body)),"Select a completed successful cell owned by this actor.")
    IO.pure(String,body)

# The message and its recipient's read grant commit in one transaction.
def share(+db: String, +actor: String, +cell: String, +recipient: String) -> IO(Unit):
  do IO<Unit>:
    +body : String <- cite(db,actor,cell)
    +id : String <- M.identity(db,"repl-share:")
    +guard : String = "NOT " ++ C.stopped_session_sql(C.q(actor)) ++ " AND NOT " ++ C.stopped_session_sql(C.q(recipient)) ++ " AND " ++ successful_sql(C.q(cell))
    +command : C.Command = C.Message{id,actor,recipient,"bend-repl",body}
    result : Result<&1,&1,U32 & String,String> <- Store.transact_sql(db,"BEGIN IMMEDIATE;" ++ C.message_guarded_sql(id,actor,recipient,"bend-repl",body,guard) ++ "INSERT INTO repl_shares(message,cell) SELECT " ++ C.q(id) ++ "," ++ C.q(cell) ++ " WHERE " ++ C.exact_message(id,actor,recipient,"bend-repl",body) ++ " AND " ++ guard ++ ";COMMIT;")
    +saved : String <- IO.try(String,Store.committed(result))
    granted : Unit <- M.check(db,"EXISTS(SELECT 1 FROM repl_shares WHERE message=" ++ C.q(id) ++ ")","The cell or session changed before context sharing committed.")
    woken : Unit <- IO.try(Unit,Wake.drive_command(db,command,Done{saved}))
    IO.write(saved)

def visible_sql(+actor: String) -> String:
  "(n.owner=" ++ C.q(actor) ++ " OR EXISTS(SELECT 1 FROM repl_shares g JOIN messages m ON m.id=g.message WHERE g.cell=c.id AND m.recipient=" ++ C.q(actor) ++ " AND m.sender=n.owner AND m.kind='bend-repl'))"

def selected(+db: String, +actor: String, +reference: String) -> IO(String):
  do IO<String>:
    ready : Unit <- M.actor_ready(db,actor)
    +cell : String <- M.scalar(db,"SELECT c.id FROM repl_cells c JOIN repl_notebooks n ON n.id=c.notebook WHERE (c.id=" ++ C.q(reference) ++ " OR " ++ citation_sql() ++ "=" ++ C.q(reference) ++ ") AND " ++ visible_sql(actor) ++ " AND " ++ successful_sql("c.id"))
    found : Unit <- M.require(Bool.not(String.is_empty(cell)),"Select an owned or received citation to a completed successful cell.")
    IO.pure(String,cell)

def read_message(+db: String, message: String) -> IO(Unit):
  do IO<Unit>:
    +command : C.Command = C.Delivery{message}
    body : String <- IO.try(String,Store.read(db,command))
    AgentInput.command_output(db,command,body)

def read_received(db: String, +message: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(message),IO.pure(Unit,Unit{}),read_message(db,message))

def resolve(+db: String, +actor: String, reference: String) -> IO(Unit):
  do IO<Unit>:
    +cell : String <- selected(db,actor,reference)
    message : String <- M.scalar(db,"SELECT m.id FROM repl_shares g JOIN messages m ON m.id=g.message JOIN repl_cells c ON c.id=g.cell JOIN repl_notebooks n ON n.id=c.notebook WHERE c.id=" ++ C.q(cell) ++ " AND m.recipient=" ++ C.q(actor) ++ " AND m.sender=n.owner AND m.kind='bend-repl' ORDER BY m.seq LIMIT 1")
    read : Unit <- read_received(db,message)
    body : String <- M.scalar(db,"SELECT json_patch(" ++ metadata_sql() ++ ",json_object('source',c.source,'expectedType',nullif(c.expected_type,''),'declarations',json(c.snapshot),'attempts',json((SELECT coalesce(json_group_array(json_object('stage',a.stage,'stdout',a.stdout,'stderr',a.stderr,'waitStatus',a.wait_status,'cause',a.cause)),'[]') FROM repl_attempts a WHERE a.cell=c.id)))) FROM repl_cells c JOIN repl_notebooks n ON n.id=c.notebook WHERE c.id=" ++ C.q(cell) ++ " AND " ++ visible_sql(actor))
    IO.write(body ++ "\n")

# Import resolves only grants minted by share. Legacy complete snapshots remain readable.
def import_source(db: String, +actor: String, +message: String) -> IO(String):
  M.scalar(db,"SELECT CASE WHEN g.cell IS NOT NULL THEN CASE WHEN c.operation='define' AND n.owner=m.sender AND " ++ successful_sql("c.id") ++ " THEN json_insert(json(c.snapshot),'$[#]',c.source) ELSE '' END ELSE CASE WHEN json_valid(m.body) THEN CASE WHEN json_array_length(m.body,'$.cells')=1 AND json_extract(m.body,'$.cells[0].operation')='define' THEN json_insert(json(json_extract(m.body,'$.cells[0].declarations')),'$[#]',json_extract(m.body,'$.cells[0].source')) ELSE '' END ELSE '' END END FROM messages m LEFT JOIN repl_shares g ON g.message=m.id LEFT JOIN repl_cells c ON c.id=g.cell LEFT JOIN repl_notebooks n ON n.id=c.notebook WHERE m.id=" ++ C.q(message) ++ " AND m.recipient=" ++ C.q(actor) ++ " AND m.kind='bend-repl'")
