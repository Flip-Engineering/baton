# Focused behavioral entry for knowledge PRs. The production AgentActions
# parser validates every command; Store seeds the fixture and Knowledge
# executes the read/write. No native attach, owner socket or Main entry is
# involved, so the entry cannot wait on an absent owner.
#
# usage: knowledge-behavior seed DB
#        knowledge-behavior DB search READER SCOPE SUBJECT QUERY
#        knowledge-behavior DB traverse READER SCOPE SUBJECT REFERENCE DIRECTION RELATION RECURSIVE
#        knowledge-behavior DB detail READER ID
#        knowledge-behavior DB record ID AUTHOR KIND CLAIM EVIDENCE LIMITS
#        knowledge-behavior DB relate ID AUTHOR SOURCE RELATION TARGET
#        knowledge-behavior DB report ID SENDER BODY
#        knowledge-behavior DB notice ID AUTHOR CLAIM EVIDENCE LIMITS
#        knowledge-behavior DB refused SAVED
import Base
import ../src/coordinator/agent-actions.bend as A
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/coordinator/knowledge.bend as Knowledge

def parsed_checked(action: A.Action) -> IO(Unit):
  match action:
    case A.Invalid{cause}: IO.die(Unit,2,cause)
    case other: IO.pure(Unit,Unit{})

def parsed_ok(args: List<String>) -> IO(Unit):
  action = A.parse(args)
  parsed_checked(action)

def seed_apply(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- Store.apply(db,command)
    IO.pure(Unit,Unit{})

def seed(+db: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    attached : Unit <- seed_apply(db,C.Attach{"root","requested-harness","native-test","native-endpoint"})
    worker : Unit <- seed_apply(db,C.Player{"worker","root","requested-harness","requested-model","high","/tmp/worker","worker-branch","base"})
    grand : Unit <- seed_apply(db,C.Player{"grand","worker","requested-harness","requested-model","high","/tmp/grand","grand-branch","base"})
    sibling : Unit <- seed_apply(db,C.Player{"sibling","root","requested-harness","requested-model","high","/tmp/sibling","sibling-branch","base"})
    role : Unit <- seed_apply(db,C.Role{"root","principal-conductor"})
    IO.pure(Unit,Unit{})

def search(+db: String, reader: String, +scope: String, +subject: String, +query: String) -> IO(Unit):
  do IO<Unit>:
    checked : Unit <- parsed_ok(["knowledge","search","--scope",scope,"--subject",subject,"--query",query])
    Knowledge.graph_read(db,reader,scope,subject,query,True{},"both","",False{})

def traverse(+db: String, reader: String, +scope: String, +subject: String, +reference: String, +direction: String, +relation: String, +recursive: String) -> IO(Unit):
  do IO<Unit>:
    checked : Unit <- parsed_ok(["knowledge","traverse","--scope",scope,"--subject",subject,"--reference",reference,"--direction",direction,"--relation",relation,"--recursive"])
    Knowledge.graph_read(db,reader,scope,subject,reference,False{},direction,relation,String.eq(recursive,"recursive"))

def detail(+db: String, reader: String, id: String) -> IO(Unit):
  Knowledge.read_detail(db,reader,"all","",id)

def record(+db: String, id: String, author: String, kind: String, claim: String, evidence: String, limits: String) -> IO(Unit):
  Knowledge.record_typed(db,id,author,kind,claim,evidence,limits)

def relate(+db: String, id: String, author: String, source: String, relation: String, target: String) -> IO(Unit):
  Knowledge.relate(db,id,author,source,relation,target)

def report(+db: String, id: String, sender: String, body: String) -> IO(Unit):
  seed_apply(db,C.Report{id,sender,body})

def notice(+db: String, id: String, author: String, claim: String, evidence: String, limits: String) -> IO(Unit):
  IO.write(Knowledge.notice_statement(id,author,claim,evidence,limits))

def print_stored(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{value}: IO.write(value)
    case Fail{(code,detail)}: IO.die(Unit,code,detail)

def inbox(+db: String, id: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- Store.read(db,C.Inbox{id})
    print_stored(result)

def session_sql(condition: String) -> IO(Unit):
  IO.write(C.session_result_where(condition))

def connect_sql(id: String, native: String, endpoint: String) -> IO(Unit):
  IO.write(C.connect_sql(id,native,endpoint))

def status_sql() -> IO(Unit):
  IO.write(C.sql(C.Status{}))

def refused(saved: String) -> IO(Unit):
  IO.write(Bool.pick(String,Store.refused(saved),"true","false"))

def dispatch(+db: String, args: List<String>) -> IO(Unit):
  match args:
    case "search" <> reader <> scope <> subject <> query <> Nil{}: search(db,reader,scope,subject,query)
    case "traverse" <> reader <> scope <> subject <> reference <> direction <> relation <> recursive <> Nil{}:
      traverse(db,reader,scope,subject,reference,direction,relation,recursive)
    case "detail" <> reader <> id <> Nil{}: detail(db,reader,id)
    case "record" <> id <> author <> kind <> claim <> evidence <> limits <> Nil{}: record(db,id,author,kind,claim,evidence,limits)
    case "relate" <> id <> author <> source <> relation <> target <> Nil{}: relate(db,id,author,source,relation,target)
    case "report" <> id <> sender <> body <> Nil{}: report(db,id,sender,body)
    case "notice" <> id <> author <> claim <> evidence <> limits <> Nil{}: notice(db,id,author,claim,evidence,limits)
    case "inbox" <> id <> Nil{}: inbox(db,id)
    case "session-sql" <> condition <> Nil{}: session_sql(condition)
    case "connect-sql" <> id <> native <> endpoint <> Nil{}: connect_sql(id,native,endpoint)
    case "status-sql" <> Nil{}: status_sql()
    case "refused" <> saved <> Nil{}: refused(saved)
    case other: IO.die(Unit,2,"usage: knowledge-behavior seed DB | DB search|traverse|detail|record|relate|report|notice|refused ...")

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "seed" <> db <> Nil{}: seed(db)
    case db <> rest: dispatch(db,rest)
    case other: IO.die(Unit,2,"usage: knowledge-behavior seed DB | DB COMMAND...")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
