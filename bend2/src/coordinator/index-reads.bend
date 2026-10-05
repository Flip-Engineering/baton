import Base
import ./commands.bend as C
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

# Each projection executes in one SQLite statement on a read-only connection.
def snapshot(db: String, command: C.Command) -> IO(Result<&1,&1,U32 & String,String>):
  DB.Sql.read(db,C.sql(command))

def render(saved: String, pretty: Bool) -> IO(Unit):
  match pretty:
    case False{}: IO.write(saved)
    case True{}:
      do IO<Unit>:
        text : String <- IO.try(String,DB.Sql.read(":memory:","SELECT json_pretty(" ++ C.q(Tx.trim_nl(saved)) ++ ");"))
        IO.write(text)

def answer(saved: String, pretty: Bool, refused: Bool) -> IO(Unit):
  match refused:
    case True{}: IO.die(Unit,2,saved)
    case False{}: render(saved,pretty)

def run(db: String, command: C.Command, pretty: Bool) -> IO(Unit):
  do IO<Unit>:
    +saved : String <- IO.try(String,snapshot(db,command))
    answer(saved,pretty,Tx.starts_with(saved,"{\"error\":\"orchestra-subject-unknown\""))
