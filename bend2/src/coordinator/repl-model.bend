import Base
import ../coordinator/repl-schema.bend as Schema
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../context/request.bend as Req
import ../git/text.bend as Tx

# Source and outcomes share the actor's existing coordination database.
def schema() -> String:
  Schema.schema()

def ensure(+db: String) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- Store.ensure_before_begin(db)
    installed : String <- IO.try(String,DB.Sql.query(db,schema()))
    IO.pure(Unit,Unit{})

def scalar(+db: String, expression: String) -> IO(String):
  do IO<String>:
    encoded : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(coalesce((" ++ expression ++ "),''));"))
    IO.pure(String,Req.scalar_value(Req.decode_scalar_utf8(Tx.hex_decode(Tx.trim_nl(encoded)))))

def write(+db: String, sql: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.transact_sql(db,"BEGIN IMMEDIATE;" ++ sql ++ "COMMIT;"))
    IO.pure(Unit,Unit{})

def require(ok: Bool, cause: String) -> IO(Unit):
  match ok:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,cause)

def check(+db: String, expression: String, cause: String) -> IO(Unit):
  do IO<Unit>:
    actual : String <- scalar(db,expression)
    require(String.eq(actual,"1"),cause)

def identity(db: String, prefix: String) -> IO(String):
  scalar(db,C.q(prefix) ++ "||lower(hex(randomblob(16)))")

def field(db: String, +cell: String, column: String) -> IO(String):
  scalar(db,"SELECT " ++ column ++ " FROM repl_cells WHERE id=" ++ C.q(cell))

def notebook_field(db: String, +notebook: String, column: String) -> IO(String):
  scalar(db,"SELECT " ++ column ++ " FROM repl_notebooks WHERE id=" ++ C.q(notebook))

def attempt_field(db: String, +cell: String, +stage: String, column: String) -> IO(String):
  scalar(db,"SELECT " ++ column ++ " FROM repl_attempts WHERE cell=" ++ C.q(cell) ++ " AND stage=" ++ C.q(stage))

def actor_ready(+db: String, +actor: String) -> IO(Unit):
  check(db,"EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(actor) ++ " AND workspace<>'' AND NOT " ++ C.stopped_session_sql(C.q(actor)) ++ ")","The REPL requires an unstopped recorded actor with a workspace.")

def notebook(+db: String, +actor: String, +name: String, +compiler: String) -> IO(String):
  do IO<String>:
    named : Unit <- require(Bool.not(String.is_empty(name)),"Select a nonempty notebook name.")
    ready : Unit <- check(db,"EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(actor) ++ " AND workspace<>'')","The REPL requires a recorded actor with a workspace.")
    +id : String <- identity(db,"repl:")
    saved : Unit <- write(db,"INSERT OR IGNORE INTO repl_notebooks(id,owner,name,workspace,compiler) SELECT " ++ C.q(id) ++ ",id," ++ C.q(name) ++ ",workspace," ++ C.q(compiler) ++ " FROM sessions WHERE id=" ++ C.q(actor) ++ ";")
    scalar(db,"SELECT id FROM repl_notebooks WHERE owner=" ++ C.q(actor) ++ " AND name=" ++ C.q(name))

def selected_cell(+db: String, +notebook: String, +selected: String) -> IO(String):
  do IO<String>:
    +found : String <- scalar(db,"SELECT id FROM repl_cells WHERE notebook=" ++ C.q(notebook) ++ Bool.pick(String,String.is_empty(selected)," ORDER BY seq DESC LIMIT 1"," AND (id=" ++ C.q(selected) ++ " OR label=" ++ C.q(selected) ++ ") ORDER BY seq DESC LIMIT 1"))
    present : Unit <- require(Bool.not(String.is_empty(found)),"This notebook has no matching cell. Use repl read to inspect it.")
    IO.pure(String,found)

# Only definitions whose canonical check completed successfully enter a snapshot.
def definitions(db: String, notebook: String) -> IO(String):
  scalar(db,"SELECT coalesce(json_group_array(source),'[]') FROM (SELECT c.source FROM repl_cells c JOIN repl_attempts a ON a.cell=c.id AND a.stage='compiler' WHERE c.notebook=" ++ C.q(notebook) ++ " AND c.operation='define' AND a.wait_status='exit 0' AND a.cause='' ORDER BY c.seq)")

def cell(+db: String, +notebook: String, +operation: String, +source: String, +expected_type: String, +label: String) -> IO(String):
  do IO<String>:
    +id : String <- identity(db,"repl-cell:")
    snapshot : String <- definitions(db,notebook)
    saved : Unit <- write(db,"INSERT INTO repl_cells(id,notebook,operation,source,expected_type,label,snapshot) VALUES(" ++ C.q(id) ++ "," ++ C.q(notebook) ++ "," ++ C.q(operation) ++ "," ++ C.q(source) ++ "," ++ C.q(expected_type) ++ "," ++ C.q(label) ++ "," ++ C.q(snapshot) ++ ");")
    IO.pure(String,id)

def attempt_json() -> String:
  "json_object('stage',a.stage,'directory',a.directory,'argv',json(a.argv),'stdin',a.input,'stdout',a.stdout,'stdoutPath',a.directory||'/stdout.saved','stderr',a.stderr,'stderrPath',a.directory||'/stderr','waitStatus',a.wait_status,'cause',a.cause)"

def cell_json() -> String:
  "json_object('reference',c.id,'id',c.id,'operation',c.operation,'label',c.label,'source',c.source,'expectedType',nullif(c.expected_type,''),'declarations',json(c.snapshot),'attempts',json((SELECT coalesce(json_group_array(json(" ++ attempt_json() ++ ")),'[]') FROM (SELECT * FROM repl_attempts WHERE cell=c.id ORDER BY stage) a)))"

def read(+db: String, notebook: String, +selected: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.read(db,"SELECT json_object('notebook',n.id,'name',n.name,'owner',n.owner,'workspace',n.workspace,'compiler',n.compiler,'cells',json((SELECT coalesce(json_group_array(json(" ++ cell_json() ++ ")),'[]') FROM (SELECT * FROM repl_cells WHERE notebook=n.id" ++ Bool.pick(String,String.is_empty(selected),""," AND id=" ++ C.q(selected)) ++ " ORDER BY seq) c))) FROM repl_notebooks n WHERE n.id=" ++ C.q(notebook) ++ ";"))
    IO.pure(String,saved)

# An IO cell is complete only after its admitted native program ends.
def finished_sql(+cell: String) -> String:
  "EXISTS(SELECT 1 FROM repl_attempts a WHERE a.cell=" ++ cell ++ " AND a.stage='compiler' AND a.wait_status IS NOT NULL AND CASE WHEN a.wait_status='exit 0' AND a.cause='' AND json_valid(a.stdout) THEN CASE WHEN json_extract(a.stdout,'$.kind')='native' THEN EXISTS(SELECT 1 FROM repl_attempts n WHERE n.cell=a.cell AND n.stage='native' AND n.wait_status IS NOT NULL) ELSE 1 END ELSE 1 END)"
