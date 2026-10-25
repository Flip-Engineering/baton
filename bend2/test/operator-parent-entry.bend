import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

# The full CLI creates the sessions; this entry exercises message admission.
def admit(+db: String, sql: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ sql ++ "COMMIT;")
    accepted : String <- IO.try(String,Store.committed(result))
    IO.write(accepted)

def message(db: String, verb: String, id: String, sender: String,
            recipient: String, kind: String, body: String) -> IO(Unit):
  match verb:
    case "dispatch": admit(db,C.message_sql(id,sender,recipient,kind,body))
    case "report": admit(db,C.parent_message_sql(id,sender,"report",body))
    case "ask": admit(db,C.parent_message_sql(id,sender,"question",body))
    case other: IO.die(Unit,2,"expected dispatch, report or ask")

def run(args: List<String>) -> IO(Unit):
  match args:
    case +db <> verb <> sender <> recipient <> kind <> body <> Nil{}: do IO<Unit>:
      random : String <- IO.try(String,DB.Sql.read(db,"SELECT lower(hex(randomblob(16)));"))
      message(db,verb,Tx.trim_nl(random),sender,recipient,kind,body)
    case other: IO.die(Unit,2,"expected DB VERB SENDER RECIPIENT KIND BODY")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
