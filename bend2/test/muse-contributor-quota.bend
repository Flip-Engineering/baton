import Base
import ../src/coordinator/turn.bend as Turn
import ../src/coordinator/commands.bend as C
import ../src/harness/muse-player.bend as Muse
import ../src/host/sqlite.bend as DB
import ../src/host/instance.bend as Custody

def check(label: String, ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print("muse-contributor " ++ label ++ ": ok")
    case False{}: IO.die(Unit,1,"muse-contributor " ++ label ++ ": refused")

def contributor_args(args: List<String>) -> Bool:
  match args:
    case cmd <> exec <> json <> prompt_flag <> task <> model_flag <> model <> effort_flag <> effort <> approval <> mode_flag <> mode <> Nil{}:
      Bool.and(String.eq(model,"muse-spark-1.3-contributor"),Bool.and(String.eq(effort,"high"),Bool.and(String.eq(mode_flag,"--contributor-mode"),String.eq(mode,"on"))))
    case other: False{}

def wonder_args(args: List<String>) -> Bool:
  match args:
    case cmd <> exec <> json <> prompt_flag <> task <> model_flag <> model <> effort_flag <> effort <> approval <> Nil{}:
      Bool.and(String.eq(model,"muse-wonder-full-1.0"),String.eq(approval,"--yolo"))
    case other: False{}

def db_arg(args: List<String>) -> IO(String):
  match args:
    case path <> Nil{}: IO.pure(String,path)
    case other: IO.die(String,2,"usage: muse-contributor-quota DB_PATH")

def fixture(+db: String) -> IO(Unit):
  do IO<Unit>:
    contributor : Unit <- check("explicit-contributor-argv",contributor_args(Muse.arguments("/fixture/bin/muse","muse-spark-1.3-contributor","high","/fixture/task")))
    wonder : Unit <- check("wonder-full-route-unchanged",wonder_args(Muse.arguments("/fixture/bin/muse","muse-wonder-full-1.0","high","/fixture/task")))
    +reason : String <- IO.pure(String,"API error 429 [request_id=4a883f25-1542-43e1-bcdf-08b6eb1bf0fc]: Subscription quota exhausted. Your usage window resets at 2026-10-12T23:25:59Z. (rate_limit_error)")
    +refusal : String <- IO.pure(String,"{\"payload_type\":\"run.terminal.failed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"failed\",\"reason\":\"" ++ reason ++ "\"}}")
    +contributor_reason : String <- IO.pure(String,"API error 429 [request_id=f9e12f59-6d51-4ddf-b37b-2959e7f78b78]: Subscription quota exhausted. Your usage window resets at 2026-10-12T23:25:59Z. (rate_limit_error)")
    +contributor_refusal : String <- IO.pure(String,"{\"payload_type\":\"run.terminal.failed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"failed\",\"reason\":\"" ++ contributor_reason ++ "\"}}")
    +other : String <- IO.pure(String,"{\"payload_type\":\"run.terminal.failed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"failed\",\"reason\":\"API error 429: temporary rate limit\"}}")
    +success : String <- IO.pure(String,"{\"payload_type\":\"run.terminal.completed\",\"payload\":{\"kind\":\"run_terminal\",\"terminal\":\"completed\",\"reason\":\"Subscription quota exhausted.\"}}")
    prepared : String <- IO.try(String,DB.Sql.query(db,C.schema() ++ "INSERT INTO sessions(id,parent,harness,model,effort) VALUES('parent',NULL,'muse','',''),('muse-child','parent','muse','muse-wonder-full-1.0','high'),('contributor-child','parent','muse','muse-spark-1.3-contributor','high'),('other-child','parent','codex','','');" ++ "INSERT INTO messages(id,sender,recipient,kind,body) VALUES('muse-turn','parent','muse-child','task-assignment','task'),('contributor-turn','parent','contributor-child','task-assignment','task'),('other-turn','parent','other-child','task-assignment','task'),('unrelated-turn','parent','muse-child','task-assignment','task'),('completed-turn','parent','muse-child','task-assignment','task');" ++ "INSERT INTO turns(id,worker,event) VALUES('muse-turn','muse-child'," ++ C.q(refusal) ++ "),('contributor-turn','contributor-child'," ++ C.q(contributor_refusal) ++ "),('other-turn','other-child'," ++ C.q(refusal) ++ "),('unrelated-turn','muse-child'," ++ C.q(other) ++ "),('completed-turn','muse-child'," ++ C.q(success) ++ ");"))
    reported : Unit <- Turn.prepare_finished(db,"muse-child","muse-turn","/fixture/log","","","exit 1",refusal)
    replayed : Unit <- Turn.prepare_finished(db,"muse-child","muse-turn","/fixture/log","","","exit 1",refusal)
    contributor_result : Unit <- Turn.prepare_finished(db,"contributor-child","contributor-turn","/fixture/log","","","exit 1",contributor_refusal)
    other_harness : Unit <- Turn.prepare_finished(db,"other-child","other-turn","/fixture/log","","","exit 0",refusal)
    other_cause : Unit <- Turn.prepare_finished(db,"muse-child","unrelated-turn","/fixture/log","","","exit 0",other)
    success_result : Unit <- Turn.prepare_finished(db,"muse-child","completed-turn","/fixture/log","","","exit 0",success)
    saved : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM messages WHERE id LIKE '%:exit' AND sender='muse-child' AND recipient='parent' AND kind='report' AND body='Player process ended with exit 1';"))
    once : Unit <- check("one-original-exit-report-after-repeat",String.eq(saved,"1\n"))
    contributor_exit : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM messages WHERE id LIKE '%:exit' AND sender='contributor-child' AND recipient='parent' AND kind='report' AND body='Player process ended with exit 1';"))
    contributor_reported : Unit <- check("failed-contributor-exit-report-retained",String.eq(contributor_exit,"1\n"))
    option_reports : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM messages WHERE id IN ('muse-turn:muse-contributor-option','contributor-turn:muse-contributor-option','other-turn:muse-contributor-option','unrelated-turn:muse-contributor-option','completed-turn:muse-contributor-option');"))
    no_availability_claim : Unit <- check("failed-trial-adds-no-quota-option",String.eq(option_reports,"0\n"))
    retained : String <- IO.try(String,DB.Sql.query(db,"SELECT json_extract(event,'$.payload.reason') FROM turns WHERE id='muse-turn';"))
    original_reason : Unit <- check("original-provider-reason-and-reset-retained",String.eq(retained,reason ++ "\n"))
    retained_contributor : String <- IO.try(String,DB.Sql.query(db,"SELECT json_extract(event,'$.payload.reason') FROM turns WHERE id='contributor-turn';"))
    contributor_reason_saved : Unit <- check("failed-contributor-reason-and-reset-retained",String.eq(retained_contributor,contributor_reason ++ "\n"))
    IO.print("muse-contributor-quota-ok")

def owner_cli(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    database : String <- db_arg(args)
    IO.try(Unit,Custody.Instance.owner(database))

def shutdown_cli(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    database : String <- db_arg(args)
    IO.try(Unit,Custody.Instance.shutdown(database))

def mode_number(+mode: String) -> U32:
  Bool.pick(U32,String.eq(mode,"--instance-owner"),1,Bool.pick(U32,String.eq(mode,"shutdown"),2,0))

def dispatch(kind: U32, mode: String, rest: List<String>) -> IO(Unit):
  match kind:
    case 1: owner_cli(rest)
    case 2: shutdown_cli(rest)
    case _: fixture(mode)

def cli(args: List<String>) -> IO(Unit):
  match args:
    case +mode <> rest: dispatch(mode_number(mode),mode,rest)
    case _: IO.die(Unit,2,"usage: muse-contributor-quota DB_PATH")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
