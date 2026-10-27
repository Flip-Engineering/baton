import Base
import ../src/coordinator/codex-inbox.bend as Inbox
import ../src/host/instance.bend as Custody

def invalid() -> IO(Unit):
  IO.die(Unit,2,"DATABASE follow SESSION THREAD | DATABASE session SESSION THREAD MESSAGE TOKEN | DATABASE witness THREAD")

def owner_args(args: List<String>) -> IO(Unit):
  match args:
    case database <> Nil{}: IO.try(Unit,Custody.Instance.owner(database))
    case other: invalid()

def follow_args(database: String, args: List<String>) -> IO(Unit):
  match args:
    case session <> thread <> Nil{}: IO.try(Unit,Inbox.follow(database,session,thread))
    case other: invalid()

def session_args(database: String, args: List<String>) -> IO(Unit):
  match args:
    case session <> thread <> message <> token <> Nil{}: IO.try(Unit,Inbox.session(database,session,thread,message,token))
    case other: invalid()

def witness_args(database: String, args: List<String>) -> IO(Unit):
  match args:
    case thread <> Nil{}: IO.try(Unit,Inbox.witness(database,thread))
    case other: invalid()

def witness_selected(database: String, args: List<String>, selected: Bool) -> IO(Unit):
  match selected:
    case True{}: witness_args(database,args)
    case False{}: invalid()

def session_selected(+database: String, mode: String, args: List<String>, selected: Bool) -> IO(Unit):
  match selected:
    case True{}: session_args(database,args)
    case False{}: witness_selected(database,args,String.eq(mode,"witness"))

def follow_selected(+database: String, +mode: String, args: List<String>, selected: Bool) -> IO(Unit):
  match selected:
    case True{}: follow_args(database,args)
    case False{}: session_selected(database,mode,args,String.eq(mode,"session"))

def database_mode(database: String, +mode: String, args: List<String>) -> IO(Unit):
  follow_selected(database,mode,args,String.eq(mode,"follow"))

def database_args(database: String, args: List<String>) -> IO(Unit):
  match args:
    case mode <> rest: database_mode(database,mode,rest)
    case other: invalid()

def head_selected(+head: String, rest: List<String>, owner: Bool) -> IO(Unit):
  match owner:
    case True{}: owner_args(rest)
    case False{}: database_args(head,rest)

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case +head <> rest: head_selected(head,rest,String.eq(head,"--instance-owner"))
    case Nil{}: invalid()

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
