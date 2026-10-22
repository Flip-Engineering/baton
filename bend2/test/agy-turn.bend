# Baton-level agy turn fixture. It launches the fake agy through the real player
# launcher, writes the user frame, closes stdin, reads stdout to EOF, and projects
# each admitted frame (init and result) into the session identity and the turn
# report SQL.
# Mode `fresh` creates the database and starts a conversation. Mode `resume` reads the
# native identity recorded by an earlier `fresh` run and resumes it. No model provider
# is contacted.
import Base
import ../src/harness/agy-player.bend as Agy
import ../src/coordinator/commands.bend as C
import ../src/host/process.bend as P
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"BEGIN;" ++ C.schema() ++ "COMMIT;")
    seated : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"INSERT INTO sessions(id,parent,harness) VALUES('operator',NULL,'operator');INSERT INTO sessions(id,parent,harness,model,effort) VALUES('agy-player','operator','agy','agy-model-test','high');")
    IO.pure(Unit,Unit{})

def observe(+db: String, +id: String, +line: String) -> IO(Unit):
  do IO<Unit>:
    +event : String <- Agy.event(db,line)
    result : String <- IO.try(String,DB.Sql.query(db,C.observe_sql(id,"agy-player",event,False{})))
    IO.print("event\t" ++ event)

def admitted_line(+db: String, +id: String, +line: String, admit: Bool) -> IO(Unit):
  match admit:
    case True{}: observe(db,id,line)
    case False{}: IO.pure(Unit,Unit{})

def lines(+db: String, +mode: String, +handle: U32, next: Maybe<String>) -> IO(Unit):
  match next:
    case None{}: IO.pure(Unit,Unit{})
    case Some{text}: do IO<Unit>:
      line : String <- IO.pure(String,Tx.trim_nl(text))
      kind : String <- IO.pure(String,Agy.kind(line))
      IO.print("kind\t" ++ kind)
      admit : Bool <- IO.pure(Bool,Agy.admitted(kind))
      observed : Unit <- admitted_line(db,mode ++ "-" ++ kind,line,admit)
      following : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      lines(db,mode,handle,following)

def sent(+db: String, +mode: String, +handle: U32, text: String) -> IO(Unit):
  do IO<Unit>:
    written : Result<&1,&1,U32 & String,Unit> <- Agy.input(handle,text)
    closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
    first : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
    lines(db,mode,handle,first)

def launched(+db: String, mode: String, text: String, result: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit,2,"agy launch failed")
    case Done{+handle}: sent(db,mode,handle,text)

def start(+db: String, mode: String, cmd: String, text: String) -> IO(Unit):
  match mode:
    case "fresh": do IO<Unit>:
      setup(db)
      spawned : Result<&1,&1,U32 & String,U32> <- Agy.start_player(cmd,"agy-model-test","high",".",db ++ ".stderr")
      launched(db,mode,text,spawned)
    case "resume": do IO<Unit>:
      found : String <- IO.try(String,DB.Sql.read(db,"SELECT native FROM sessions WHERE id='agy-player';"))
      spawned : Result<&1,&1,U32 & String,U32> <- Agy.resume_player(cmd,"agy-model-test","high",".",db ++ ".stderr",Tx.trim_nl(found))
      launched(db,mode,text,spawned)
    case other: IO.die(Unit,2,"unknown mode")

def report(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    body : String <- IO.try(String,DB.Sql.read(db,"SELECT body FROM messages WHERE id=" ++ C.q(id) ++ ";"))
    +event : String <- IO.try(String,DB.Sql.read(db,"SELECT event FROM turns WHERE id=" ++ C.q(id) ++ ";"))
    terminal : String <- IO.try(String,DB.Sql.read(db,"SELECT " ++ C.terminal(event)))
    IO.print("report\t" ++ Tx.trim_nl(body))
    IO.print("turn\t" ++ Tx.trim_nl(event))
    IO.print("terminal\t" ++ Tx.trim_nl(terminal))

def run(args: List<String>) -> IO(Unit):
  match args:
    case +db <> cmd <> mode <> text <> Nil{}: do IO<Unit>:
      start(db,mode,cmd,text)
      native : String <- IO.try(String,DB.Sql.read(db,"SELECT native FROM sessions WHERE id='agy-player';"))
      IO.print("native\t" ++ Tx.trim_nl(native))
      report(db,mode ++ "-result")
    case other: IO.die(Unit,2,"usage: agy-turn DB CMD fresh|resume TEXT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
