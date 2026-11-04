import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/coordinator/agent-domain.bend as Domain
import ../src/host/sqlite.bend as DB
import ../src/context/native.bend as ContextNative
import ../src/git/text.bend as Tx

# Focused native entry for the #959 context evaluation regressions. It reaches
# the real context command, request decoder, provider selection and retained
# result path without building the complete coordinator. The MCP adapter and
# the installed-package tests use this entry as the compiled candidate when the
# full-router artifact is unavailable.

def help_text() -> String:
  "usage: baton2 as SESSION ACTION ARGS\nActions: inbox, read, session, player, players, assignment, send, completion-request, completion-confirmed, guide, acknowledge, status, pending, orchestra, role, knowledge, context, models, observed-usage, logs.\n"

def attach(db: String, args: List<String>) -> IO(Unit):
  match args:
    case id <> harness <> native <> endpoint <> Nil{}: do IO<Unit>:
      result : String <- IO.try(String,Store.apply(db,C.Attach{id,harness,native,endpoint}))
      IO.write(result)
    case other: IO.die(Unit,2,"attach SESSION HARNESS NATIVE ENDPOINT")

def latest_query(+db: String, +owner: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.read(db,"SELECT coalesce((SELECT id FROM semantic_queries WHERE owner=" ++ C.q(owner) ++ " ORDER BY rowid DESC LIMIT 1),'');"))
    IO.pure(String,Tx.trim_nl(value))

def context_result(+db: String, args: List<String>) -> IO(Unit):
  match args:
    case owner <> +query <> Nil{}:
      Bool.pick(IO(Unit),String.is_empty(query),
        do IO<Unit>:
          +latest : String <- latest_query(db,owner)
          ContextNative.result(db,latest),
        ContextNative.result(db,query))
    case other: IO.die(Unit,2,"context-result OWNER QUERY")

def run(+db: String, args: List<String>) -> IO(Unit):
  match args:
    case "attach" <> rest: attach(db,rest)
    case "context-eval" <> owner <> query <> session <> expression <> frame <> cwd <> Nil{}:
      ContextNative.eval(db,owner,query,session,expression,frame,cwd)
    case "context-result" <> rest: context_result(db,rest)
    case "context-query-file" <> owner <> query <> path <> Nil{}:
      ContextNative.query_file(db,owner,query,path)
    case "context-install" <> module_id <> source <> Nil{}:
      ContextNative.install_module(module_id,source)
    case "context-engines" <> session <> Nil{}:
      ContextNative.engines(db,session)
    case other: IO.die(Unit,2,"focused context entry: attach|context-eval|context-result|context-query-file|context-install|context-engines")

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case "--help" <> Nil{}: IO.write(help_text())
    case "help" <> "context" <> Nil{}: IO.write(Domain.help("context"))
    case "help" <> action <> Nil{}: IO.write(Domain.help(action))
    case db <> rest: run(db,rest)
    case Nil{}: IO.die(Unit,2,"DATABASE ACTION")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
