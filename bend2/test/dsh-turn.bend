# Baton-level DSH turn fixture. It drives the real frame classifier, event
# projection and report SQL, and proves the stdin contract: raw task text and
# EOF for a non-OMP harness. It starts no model provider.
import Base
import ../src/coordinator/turn.bend as Turn
import ../src/coordinator/commands.bend as C
import ../src/host/process.bend as P
import ../src/host/sqlite.bend as DB
import ../src/host/text.bend as T
import ../src/git/text.bend as Tx

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"BEGIN;" ++ C.schema() ++ "COMMIT;")
    seated : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"INSERT INTO sessions(id,parent,harness) VALUES('operator',NULL,'operator');INSERT INTO sessions(id,parent,harness,model,effort) VALUES('dsh-player','operator','dsh','deepseek-flash','max');")
    IO.pure(Unit,Unit{})

def observe(+db: String, +line: String, id: String) -> IO(String):
  do IO<String>:
    kind : String <- Turn.frame_kind(db,line,"dsh\n")
    +event : String <- Turn.dsh_event(db,line,True{},line)
    result : String <- IO.try(String,DB.Sql.query(db,C.observe_sql(id,"dsh-player",event,False{})))
    IO.print("kind\t" ++ Tx.trim_nl(kind))
    IO.pure(String,event)

def report(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    body : String <- IO.try(String,DB.Sql.read(db,"SELECT body FROM messages WHERE id=" ++ C.q(id) ++ ";"))
    +event : String <- IO.try(String,DB.Sql.read(db,"SELECT event FROM turns WHERE id=" ++ C.q(id) ++ ";"))
    terminal : String <- IO.try(String,DB.Sql.read(db,"SELECT " ++ C.terminal(event)))
    IO.print("report\t" ++ Tx.trim_nl(body))
    IO.print("turn\t" ++ Tx.trim_nl(event))
    IO.print("terminal\t" ++ Tx.trim_nl(terminal))

def stdin_value(result: Result<&1,&1,U32 & String,U32>, out: String) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit,2,"stdin fixture process failed")
    case Done{+handle}: do IO<Unit>:
      sent : Result<&1,&1,U32 & String,Unit> <- Turn.send_prompt(handle,"hello","dsh\n","default")
      waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
      text : String <- IO.try(String,T.Text.read(out))
      IO.print("stdin\t" ++ text)

def run(args: List<String>) -> IO(Unit):
  match args:
    case +db <> +out <> Nil{}: do IO<Unit>:
      setup(db)
      session : String <- observe(db,"{\"type\":\"session\",\"sessionId\":\"session-9\",\"cwd\":\"/w\"}","turn-session")
      text : String <- observe(db,"{\"type\":\"text\",\"text\":\"hello\"}","turn-text")
      call : String <- observe(db,"{\"type\":\"tool_call\",\"callId\":\"c\",\"tool\":\"bash\",\"input\":{\"command\":\"true\"}}","turn-call")
      result : String <- observe(db,"{\"type\":\"tool_result\",\"callId\":\"c\",\"status\":\"completed\",\"result\":\"ok\"}","turn-result")
      final : String <- observe(db,"{\"type\":\"final\",\"text\":\"answer\"}","turn-final")
      native : String <- IO.try(String,DB.Sql.read(db,"SELECT native FROM sessions WHERE id='dsh-player';"))
      IO.print("native\t" ++ Tx.trim_nl(native))
      report(db,"turn-final")
      child : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv(["/bin/sh","-c","cat > " ++ out]),".","/dev/null")
      stdin_value(child,out)
    case other: IO.die(Unit,2,"usage: dsh-turn DB OUT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
