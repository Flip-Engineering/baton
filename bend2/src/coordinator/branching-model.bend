import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./knowledge.bend as Knowledge
import ./native-initial-input.bend as Initial
import ../host/sqlite.bend as DB
import ../context/request.bend as Req
import ../git/text.bend as Tx

# A round records an explicit Conductor intervention. Native attempts, receipts,
# stops, initialization seeds and usage retain their existing owning tables.
def schema() -> String:
  "CREATE TABLE IF NOT EXISTS branch_rounds(id TEXT PRIMARY KEY NOT NULL,ensemble TEXT NOT NULL REFERENCES ensembles(id),owner TEXT NOT NULL REFERENCES sessions(id),source TEXT NOT NULL REFERENCES sessions(id),ancestor TEXT REFERENCES branch_rounds(id),workspace TEXT NOT NULL,branch_count INTEGER NOT NULL CHECK(branch_count>0),snapshot TEXT NOT NULL DEFAULT '',task TEXT NOT NULL,inputs TEXT NOT NULL CHECK(json_valid(inputs)),knowledge TEXT NOT NULL CHECK(json_valid(knowledge)),includes TEXT NOT NULL CHECK(json_valid(includes)),evaluator TEXT NOT NULL CHECK(json_valid(evaluator)),direction TEXT NOT NULL CHECK(direction IN('max','min')),harness TEXT NOT NULL,model TEXT NOT NULL,effort TEXT NOT NULL,command TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"
  ++ "CREATE TABLE IF NOT EXISTS branch_candidates(round TEXT NOT NULL REFERENCES branch_rounds(id),ordinal INTEGER NOT NULL,session TEXT UNIQUE NOT NULL,workspace TEXT NOT NULL,branch TEXT NOT NULL,PRIMARY KEY(round,ordinal));"
  ++ "CREATE TABLE IF NOT EXISTS branch_operations(id INTEGER PRIMARY KEY AUTOINCREMENT,round TEXT NOT NULL REFERENCES branch_rounds(id),session TEXT NOT NULL,operation TEXT NOT NULL,result TEXT NOT NULL CHECK(json_valid(result)),recorded TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"
  ++ "CREATE TABLE IF NOT EXISTS branch_evaluations(id TEXT PRIMARY KEY NOT NULL,round TEXT NOT NULL REFERENCES branch_rounds(id),session TEXT NOT NULL REFERENCES sessions(id),snapshot TEXT NOT NULL DEFAULT '',workspace TEXT NOT NULL,argv TEXT NOT NULL CHECK(json_valid(argv)),native TEXT NOT NULL,attempt TEXT NOT NULL,phase TEXT NOT NULL,native_status TEXT NOT NULL,result TEXT CHECK(result IS NULL OR json_valid(result)),accepted INTEGER,score REAL,recorded TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"
  ++ "CREATE TABLE IF NOT EXISTS branch_selections(round TEXT PRIMARY KEY NOT NULL REFERENCES branch_rounds(id),session TEXT NOT NULL,evaluation TEXT REFERENCES branch_evaluations(id),reason TEXT NOT NULL,actor TEXT NOT NULL REFERENCES sessions(id),recorded TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"

def ensure(+db: String) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- Store.ensure_before_begin(db)
    made : String <- IO.try(String,DB.Sql.query(db,Knowledge.knowledge_schema() ++ Initial.schema() ++ schema()))
    IO.pure(Unit,Unit{})

def scalar(+db: String, expression: String) -> IO(String):
  do IO<String>:
    encoded : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(coalesce((" ++ expression ++ "),''));"))
    IO.pure(String,Req.scalar_value(Req.decode_scalar_utf8(Tx.hex_decode(Tx.trim_nl(encoded)))))

def field(db: String, table: String, +id: String, name: String) -> IO(String):
  scalar(db,"SELECT " ++ name ++ " FROM " ++ table ++ " WHERE id=" ++ C.q(id))

def require(ok: Bool, cause: String) -> IO(Unit):
  Bool.pick(IO(Unit),ok,IO.pure(Unit,Unit{}),IO.die(Unit,2,cause))

def check(+db: String, expression: String, cause: String) -> IO(Unit):
  do IO<Unit>:
    answer : String <- scalar(db,expression)
    require(String.eq(answer,"1"),cause)

def write(+db: String, sql: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.transact_sql(db,"BEGIN IMMEDIATE;" ++ sql ++ "COMMIT;"))
    IO.pure(Unit,Unit{})

def identity(db: String, prefix: String) -> IO(String):
  scalar(db,C.q(prefix) ++ "||lower(hex(randomblob(16)))")

def ensemble(+db: String, +actor: String, +selected: String) -> IO(String):
  do IO<String>:
    authorized : Unit <- check(db,"SELECT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(actor) ++ " AND " ++ C.assigned_role("id") ++ "='conductor' AND NOT " ++ C.stopped_session_sql("id") ++ ")","Branching requires an unstopped recorded Conductor.")
    +found : String <- scalar(db,"SELECT CASE WHEN count(*)=1 THEN min(id) ELSE '' END FROM ensembles WHERE owner=" ++ C.q(actor) ++ Bool.pick(String,String.is_empty(selected),""," AND id=" ++ C.q(selected)))
    exact : Unit <- require(Bool.not(String.is_empty(found)),"Select --ensemble NAME for one Ensemble owned by this Conductor.")
    IO.pure(String,found)

def round(+db: String, +ensemble: String, +selected: String) -> IO(String):
  do IO<String>:
    +found : String <- scalar(db,"SELECT id FROM branch_rounds WHERE ensemble=" ++ C.q(ensemble) ++ Bool.pick(String,String.is_empty(selected)," ORDER BY rowid DESC LIMIT 1"," AND id=" ++ C.q(selected)))
    exists : Unit <- require(Bool.not(String.is_empty(found)),"This Ensemble has no selected branching round. Start one, or select an existing --round ID.")
    IO.pure(String,found)

def settled(+session: String) -> String:
  "EXISTS(SELECT 1 FROM executions WHERE session=" ++ session ++ " AND phase='exited' AND status<>'' AND status<>'owner-death')"

def operation(db: String, round: String, session: String, kind: String, result: String) -> IO(Unit):
  write(db,"INSERT INTO branch_operations(round,session,operation,result) VALUES(" ++ C.q(round) ++ "," ++ C.q(session) ++ "," ++ C.q(kind) ++ "," ++ C.q(result) ++ ");")

def candidate(+session: String) -> String:
  "json_object('player'," ++ session ++ ",'session',json((SELECT json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'workspace',workspace,'branch',branch,'base',base) FROM sessions WHERE id=" ++ session ++ ")),'execution',(SELECT json_object('id',id,'directory',directory,'phase',phase,'status',status) FROM executions WHERE session=" ++ session ++ "),'settled',json(CASE WHEN " ++ settled(session) ++ " THEN 'true' ELSE 'false' END),'stop',(SELECT json_object('id',id,'reason',reason,'outcome',outcome) FROM session_stops WHERE session=" ++ session ++ "),'initialInputs',json((SELECT coalesce(json_group_array(json_object('attempt',attempt,'turn',turn,'seed',seed,'instruction',instruction,'guidance',guidance)),'[]') FROM native_initial_inputs WHERE session=" ++ session ++ ")), 'reports',json((SELECT coalesce(json_group_array(json_object('id',id,'body',body,'read'," ++ C.read_sql("messages") ++ ")),'[]') FROM messages WHERE sender=" ++ session ++ " AND kind IN('report','completion-request'))),'pending',json((SELECT coalesce(json_group_array(json_object('id',id,'kind',kind,'body',body)),'[]') FROM messages WHERE recipient=" ++ session ++ " AND " ++ C.owed_sql("messages") ++ ")))"

# Evaluation evidence is separate from Player reports and includes its exact
# native settlement observation. Missing settlement remains visible as unknown.
def status_sql(+round: String) -> String:
  "SELECT json_object('round',r.id,'ensemble',r.ensemble,'owner',r.owner,'source',r.source,'ancestor',r.ancestor,'snapshot',nullif(r.snapshot,''),'task',r.task,'inputs',json(r.inputs),'knowledge',json(r.knowledge),'includes',json(r.includes),'evaluator',json(r.evaluator),'direction',r.direction,'candidates',json((SELECT coalesce(json_group_array(json_object('ordinal',b.ordinal,'workspace',b.workspace,'branch',b.branch,'state',json(" ++ candidate("b.session") ++ "))),'[]') FROM branch_candidates b WHERE b.round=r.id)),'evaluations',json((SELECT coalesce(json_group_array(json_object('id',e.id,'player',e.session,'snapshot',nullif(e.snapshot,''),'workspace',e.workspace,'argv',json(e.argv),'native',e.native,'attempt',e.attempt,'phase',e.phase,'nativeStatus',e.native_status,'result',json(e.result),'accepted',e.accepted,'score',e.score)),'[]') FROM branch_evaluations e WHERE e.round=r.id)),'selection',(SELECT json_object('player',s.session,'evaluation',s.evaluation,'reason',s.reason,'actor',s.actor) FROM branch_selections s WHERE s.round=r.id),'operations',json((SELECT coalesce(json_group_array(json_object('player',o.session,'operation',o.operation,'result',json(o.result))),'[]') FROM branch_operations o WHERE o.round=r.id))) FROM branch_rounds r WHERE r.id=" ++ C.q(round) ++ ";"

def status(+db: String, round: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.read(db,status_sql(round)))
    IO.write(saved)
