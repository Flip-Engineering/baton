import Base
import ../coordinator/commands.bend as C
import ./delivery.bend as Delivery
import ./subscription-fallback.bend as Subs
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock
import ../host/sqlite.bend as DB
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../git/types.bend as T

type Selection is Data:
  Selected{command: String, receipt: String}

def supported(harness: String) -> Bool:
  match harness:
    case "codex": True{}
    case "claude-code": True{}
    case "omp": True{}
    case "muse": True{}
    case other: False{}

def script_path(found: Result<&1,&1,U32 & String,String>) -> String:
  match found:
    case Done{path}: Subs.directory_of(path) ++ "/harness-clients.py"
    case Fail{error}: ""

def script() -> IO(String):
  do IO<String>:
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    helper : Result<&1,&1,U32 & String,String> <- Host.Control.agent_helper(executable)
    IO.pure(String,script_path(helper))

def report_sql(+session: String, +receipt: String) -> String:
  "WITH RECURSIVE ancestors(id,parent) AS (SELECT id,parent FROM sessions WHERE id=" ++ C.q(session) ++ " UNION SELECT s.id,s.parent FROM sessions s JOIN ancestors a ON a.parent=s.id) "
  ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT 'harness-update:' || json_extract(receipt,'$.id') || ':' || root.id,"
  ++ "coalesce((SELECT id FROM sessions WHERE id=" ++ C.q(session) ++ "),root.id),root.id,'report','Harness update failed. ' || receipt "
  ++ "FROM sessions root CROSS JOIN (SELECT " ++ C.q(receipt) ++ " AS receipt) WHERE json_extract(receipt,'$.result')='failed' AND root.parent IS NULL AND ("
  ++ C.q(session) ++ "='' OR root.id IN (SELECT id FROM ancestors)) RETURNING id;"

def wake_notices(+db: String, ids: List<String>) -> IO(Unit):
  match ids:
    case Nil{}: IO.pure(Unit,Unit{})
    case id <> rest: do IO<Unit>:
      notified : Result<&1,&1,U32 & String,String> <- Delivery.dispatch_existing(db,id)
      wake_notices(db,rest)

def report_result(+db: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{ids}: wake_notices(db,Tx.split_lines(ids))
    case Fail{error}: IO.pure(Unit,Unit{})

def report(+db: String, session: String, receipt: String) -> IO(Unit):
  do IO<Unit>:
    ids : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,report_sql(session,receipt))
    report_result(db,ids)

def report_receipts(+db: String, +session: String, receipts: List<String>) -> IO(Unit):
  match receipts:
    case Nil{}: IO.pure(Unit,Unit{})
    case receipt <> rest: do IO<Unit>:
      notified : Unit <- report(db,session,receipt)
      report_receipts(db,session,rest)

def checked_lines(+db: String, session: String, lines: List<String>, fallback: String) -> IO(Selection):
  match lines:
    case selected <> receipts: do IO<Selection>:
      +recorded : String <- IO.pure(String,Tx.join("\n",receipts))
      notified : Unit <- report_receipts(db,session,Tx.split_lines(recorded))
      IO.pure(Selection,Selected{selected,recorded})
    case Nil{}: IO.pure(Selection,Selected{fallback,""})

def checked_result(db: String, session: String, fallback: String, result: T.RunRes) -> IO(Selection):
  match result:
    case T.RRun{T.SExit{0},out}: checked_lines(db,session,Tx.split_lines(out),fallback)
    case other: IO.pure(Selection,Selected{fallback,""})

def check_script(+db: String, session: String, harness: String, +command: String, +helper: String) -> IO(Selection):
  match helper:
    case "": IO.pure(Selection,Selected{command,""})
    case other: do IO<Selection>:
      result : T.RunRes <- Process.runFull(["python3",helper,"check",harness,command],".")
      checked_result(db,session,command,result)

def check(+db: String, session: String, harness: String, command: String, enabled: Bool) -> IO(Selection):
  match enabled:
    case False{}: IO.pure(Selection,Selected{command,""})
    case True{}: do IO<Selection>:
      helper : String <- script()
      check_script(db,session,harness,command,helper)

def command(selection: Selection) -> String:
  match selection:
    case Selected{path,receipt}: path

def environment(selection: Selection, +harness: String) -> List<String>:
  match selection:
    case Selected{path,receipt}:
      Bool.pick(List<String>,String.is_empty(receipt),Nil{},
        Bool.pick(List<String>,String.eq(harness,"muse"),["MUSE_NO_AUTO_UPDATE=1"],
          Bool.pick(List<String>,String.eq(harness,"claude-code"),["DISABLE_AUTOUPDATER=1"],Nil{})))

def print_receipt(selection: Selection) -> IO(Unit):
  match selection:
    case Selected{path,""}: IO.pure(Unit,Unit{})
    case Selected{path,receipt}: IO.print(receipt)

def sweep(+db: String, +helper: String, harnesses: List<String>) -> IO(Unit):
  match harnesses:
    case Nil{}: IO.pure(Unit,Unit{})
    case harness <> rest: do IO<Unit>:
      result : Selection <- check_script(db,"",harness,"",helper)
      printed : Unit <- print_receipt(result)
      sweep(db,helper,rest)

def scheduled(db: String) -> IO(Unit):
  do IO<Unit>:
    +helper : String <- script()
    Bool.pick(IO(Unit),String.is_empty(helper),IO.die(Unit,2,"The harness update helper is missing."),
      sweep(db,helper,["codex","claude-code","omp","muse"]))
