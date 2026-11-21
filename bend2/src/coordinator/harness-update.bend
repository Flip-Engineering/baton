import Base
import ../coordinator/commands.bend as C
import ./delivery.bend as Delivery
import ./harness-installations.bend as Install
import ./harness-refresh.bend as Refresh
import ../host/sqlite.bend as DB
import ../host/posix.bend as Posix
import ../git/text.bend as Tx

type Selection is Data:
  Selected{command: String, receipt: String}

def supported(harness: String) -> Bool:
  match harness:
    case "codex": True{}
    case "claude-code": True{}
    case "omp": True{}
    case "muse": True{}
    case other: False{}

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

def refreshed(+db: String, session: String, path: String, result: Result<&1,&1,U32 & String,String>) -> IO(Selection):
  match result:
    case Done{+receipt}: do IO<Selection>:
      notified : Unit <- report(db,session,receipt)
      IO.pure(Selection,Selected{path,receipt})
    case Fail{(code,detail)}: do IO<Selection>:
      logged : Result<&1,&1,U32 & String,Unit> <- Posix.HostPosix.write_stderr(detail ++ "\n")
      IO.pure(Selection,Selected{path,""})

def check_route(+db: String, +session: String, +harness: String, home: String, route: Install.Route) -> IO(Selection):
  match route:
    case Install.Route{"",path}: IO.pure(Selection,Selected{path,""})
    case Install.Route{alias,path}: do IO<Selection>:
      result : Result<&1,&1,U32 & String,String> <- Refresh.refresh(db,home,harness,alias)
      refreshed(db,session,path,result)

def check(+db: String, session: String, harness: String, command: String, enabled: Bool) -> IO(Selection):
  match enabled:
    case False{}: IO.pure(Selection,Selected{command,""})
    case True{}: do IO<Selection>:
      +home : String <- Install.home()
      +paths : List<&2,String> <- Install.paths(home,harness)
      route : Install.Route <- Install.route(home,harness,command,paths)
      check_route(db,session,harness,home,route)

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

@unsafe
def sweep_paths(+db: String, +home: String, +harness: String, paths: List<&2,String>) -> IO(Unit):
  match paths:
    case Nil{}: IO.pure(Unit,Unit{})
    case path <> rest: do IO<Unit>:
      result : Selection <- check_route(db,"",harness,home,Install.Route{path,""})
      printed : Unit <- print_receipt(result)
      sweep_paths(db,home,harness,rest)

@unsafe
def sweep(+db: String, +home: String, harnesses: List<String>) -> IO(Unit):
  match harnesses:
    case Nil{}: IO.pure(Unit,Unit{})
    case +harness <> rest: do IO<Unit>:
      paths : List<&2,String> <- Install.paths(home,harness)
      checked : Unit <- sweep_paths(db,home,harness,paths)
      sweep(db,home,rest)

def scheduled(db: String) -> IO(Unit):
  do IO<Unit>:
    home : String <- Install.home()
    sweep(db,home,["codex","claude-code","omp","muse"])
