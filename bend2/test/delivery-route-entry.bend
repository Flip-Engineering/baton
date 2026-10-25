import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/delivery.bend as Delivery
import ../src/host/sqlite.bend as DB

def deliver(db: String, id: String, condition: String, saved: String) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,Delivery.deliver(db,id,condition,saved))
    IO.write(result)

def report(+db: String, +id: String, body: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.parent_message_sql(id,"root","report",body) ++ "COMMIT;"))
    deliver(db,id,"1",saved)

def selected(mode: String, db: String, id: String, text: String) -> IO(Unit):
  match mode:
    case "report": report(db,id,text)
    case "deliver": deliver(db,id,text,"retained-output")
    case other: IO.die(Unit,2,"expected report or deliver")

def schema(mode: String) -> IO(Unit):
  match mode:
    case "schema": IO.write(C.schema())
    case other: IO.die(Unit,2,"expected schema")

def run(args: List<String>) -> IO(Unit):
  match args:
    case mode <> Nil{}: schema(mode)
    case mode <> db <> id <> text <> Nil{}: selected(mode,db,id,text)
    case other: IO.die(Unit,2,"expected schema, report DB ID BODY or deliver DB ID CONDITION")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
