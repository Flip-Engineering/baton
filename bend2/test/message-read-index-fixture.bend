import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/message-status.bend as MessageStatus
import ../src/coordinator/store.bend as Store
import ../src/host/sqlite.bend as DB

def migrate(db: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.transact_sql(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ "COMMIT;"))
    IO.write(saved)

def read(db: String, saved: String) -> IO(Unit):
  do IO<Unit>:
    answer : String <- IO.try(String,DB.Sql.read(db,MessageStatus.decorate_observed_sql(saved,False{},True{})))
    IO.write(answer)

def no_arguments(+mode: String, +db: String, rest: List<String>) -> IO(Unit):
  match rest:
    case Nil{}:
      match String.eq(mode,"schema"):
        case True{}: IO.write(C.schema())
        case False{}:
          match String.eq(mode,"migrate"):
            case True{}: migrate(db)
            case False{}: IO.die(Unit,2,"usage: message-read-index-fixture schema DB | migrate DB | read DB JSON")
    case other: IO.die(Unit,2,"unexpected fixture arguments")

def arguments(+mode: String, +db: String, +rest: List<String>) -> IO(Unit):
  match String.eq(mode,"read"):
    case True{}:
      match rest:
        case +saved <> Nil{}: read(db,saved)
        case other: IO.die(Unit,2,"read requires complete JSON")
    case False{}: no_arguments(mode,db,rest)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    match args:
      case +mode <> +db <> +rest: arguments(mode,db,rest)
      case other: IO.die(Unit,2,"fixture mode and database required")
