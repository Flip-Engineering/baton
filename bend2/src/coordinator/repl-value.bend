import Base
import ./repl-model.bend as M
import ./repl-context.bend as Context
import ./commands.bend as C

# A checked Bend2 String carries the JSON value used by the seat's context loop.
# The compiler's canonical value is a quoted String literal, decoded once here.
def checked_value_sql(+cell: String) -> String:
  "SELECT CASE WHEN json_valid(a.stdout) THEN CASE WHEN json_extract(a.stdout,'$.kind')='pure' AND json_extract(a.stdout,'$.type')='String' AND json_valid(json_extract(a.stdout,'$.value')) THEN CASE WHEN json_type(json_extract(a.stdout,'$.value'))='text' THEN json_extract(json_extract(a.stdout,'$.value'),'$') END END END FROM repl_attempts a WHERE a.cell=" ++ cell ++ " AND a.stage='compiler'"

def checkpoint(+db: String, +actor: String, +cell: String) -> IO(Unit):
  do IO<Unit>:
    owned : String <- Context.cite(db,actor,cell)
    +value : String <- M.scalar(db,checked_value_sql(C.q(cell)))
    valid : Unit <- M.check(db,"json_valid(" ++ C.q(value) ++ ")","Context requires a successful pure Bend2 String whose complete value is JSON.")
    +guard : String = "EXISTS(SELECT 1 FROM repl_cells c JOIN repl_notebooks n ON n.id=c.notebook WHERE c.id=" ++ C.q(cell) ++ " AND n.owner=" ++ C.q(actor) ++ " AND " ++ Context.successful_sql("c.id") ++ ") AND NOT " ++ C.stopped_session_sql(C.q(actor))
    saved : Unit <- M.write(db,
      "INSERT INTO repl_context_values(cell,value) SELECT " ++ C.q(cell) ++ ",json(" ++ C.q(value) ++ ") WHERE " ++ guard ++ " ON CONFLICT(cell) DO NOTHING;"
      ++ "INSERT INTO repl_context_bindings(owner,cell,version) SELECT " ++ C.q(actor) ++ "," ++ C.q(cell) ++ ",1 WHERE " ++ guard ++ " ON CONFLICT(owner) DO UPDATE SET cell=excluded.cell,version=repl_context_bindings.version+1 WHERE repl_context_bindings.cell<>excluded.cell;")
    current : Unit <- M.check(db,"EXISTS(SELECT 1 FROM repl_context_bindings WHERE owner=" ++ C.q(actor) ++ " AND cell=" ++ C.q(cell) ++ ")","The context or session changed before its checkpoint committed.")
    body : String <- Context.cite(db,actor,cell)
    IO.write(body ++ "\n")

def bound(+db: String, +actor: String, reference: String, turn: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(turn),
    Bool.pick(IO(String),String.is_empty(reference),
      M.scalar(db,"SELECT cell FROM repl_context_bindings WHERE owner=" ++ C.q(actor)),
      IO.pure(String,reference)),
    M.scalar(db,"SELECT cell FROM repl_context_turns WHERE owner=" ++ C.q(actor) ++ " AND turn=" ++ C.q(turn)))

# Offsets and lengths count Unicode characters in the serialized JSON value.
# A caller advances the returned cursor until complete is true.
def valid_number(+value: String) -> String:
  "(" ++ C.q(value) ++ "<>'' AND " ++ C.q(value) ++ " NOT GLOB '*[^0-9]*' AND length(" ++ C.q(value) ++ ")<=9)"

def range(+db: String, +offset: String, +count: String) -> IO(Unit):
  M.check(db,valid_number(offset) ++ " AND " ++ valid_number(count)
    ++ " AND CAST(" ++ C.q(count) ++ " AS INTEGER) BETWEEN 1 AND 8192",
    "Context reads require a nonnegative character offset and a length between 1 and 8192.")

def projection_sql(+actor: String, +cell: String, +offset: String, +count: String) -> String:
  "SELECT json_patch(" ++ Context.metadata_sql()
  ++ ",json_object('context',json_object('format','baton.context-value/v1','mediaType','application/vnd.baton.context-value+json','owner',n.owner,'version',c.seq,'offset'," ++ offset
  ++ ",'length',length(substr(v.value," ++ offset ++ "+1," ++ count ++ ")),'totalCharacters',length(v.value),'fragment',substr(v.value," ++ offset ++ "+1," ++ count
  ++ "),'nextOffset',CASE WHEN " ++ offset ++ "+" ++ count ++ "<length(v.value) THEN " ++ offset ++ "+" ++ count ++ " END,'complete',json(CASE WHEN " ++ offset ++ "+" ++ count ++ ">=length(v.value) THEN 'true' ELSE 'false' END))))"
  ++ " FROM repl_context_values v JOIN repl_cells c ON c.id=v.cell JOIN repl_notebooks n ON n.id=c.notebook WHERE c.id=" ++ C.q(cell) ++ " AND " ++ Context.visible_sql(actor)

def read(+db: String, +actor: String, reference: String, turn: String, +offset: String, +count: String) -> IO(Unit):
  do IO<Unit>:
    valid : Unit <- range(db,offset,count)
    exclusive : Unit <- M.require(Bool.or(String.is_empty(reference),String.is_empty(turn)),"Select a context citation or one of your native turns.")
    selected : String <- bound(db,actor,reference,turn)
    +cell : String <- Context.selected(db,actor,selected)
    exists : Unit <- M.check(db,"EXISTS(SELECT 1 FROM repl_context_values WHERE cell=" ++ C.q(cell) ++ ")","Select a checkpointed context value.")
    message : String <- M.scalar(db,"SELECT m.id FROM repl_shares g JOIN messages m ON m.id=g.message JOIN repl_cells c ON c.id=g.cell JOIN repl_notebooks n ON n.id=c.notebook WHERE c.id=" ++ C.q(cell) ++ " AND m.recipient=" ++ C.q(actor) ++ " AND m.sender=n.owner AND m.kind='bend-repl' ORDER BY m.seq LIMIT 1")
    observed : Unit <- Context.read_received(db,message)
    body : String <- M.scalar(db,projection_sql(actor,cell,offset,count))
    IO.write(body ++ "\n")
