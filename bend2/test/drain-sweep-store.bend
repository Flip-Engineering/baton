import Base
import ../src/coordinator/store.bend as Store
import ../src/host/session-lock.bend as Lock
import ../src/git/process.bend as Process
import ../src/git/text.bend as Tx

def deferred_sessions_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> Nil{}: do IO<Unit>:
      rows : String <- Store.deferred_sessions(database)
      IO.write(rows)
    case other: IO.die(Unit,2,"--deferred-sessions DATABASE")

def defer_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> +session <> +owner <> +generation <> Nil{}:
      Store.defer_claim(database,session,owner,generation)
    case other: IO.die(Unit,2,"--defer DATABASE SESSION OWNER GENERATION")

def clear_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> +session <> +generation <> Nil{}:
      Store.clear_drain_deferred(database,session,generation)
    case other: IO.die(Unit,2,"--clear DATABASE SESSION GENERATION")

def probe_release_result(released: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match released:
    case Done{unit}: IO.print("free")
    case Fail{(+code,+detail)}: IO.die(Unit,code,detail)

def probe_result(+database: String, +session: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.print("busy")
    case Some{handle}: do IO<Unit>:
      released : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(handle)
      probe_release_result(released)

def probe_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> +session <> Nil{}: do IO<Unit>:
      +canonical : String <- IO.try(String,Lock.SessionLock.canonical(database))
      lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire_drain_sweep(canonical,session))
      probe_result(canonical,session,lock)
    case other: IO.die(Unit,2,"--probe-sweep-lock DATABASE SESSION")

def finish_wait_result(waited: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match waited:
    case Done{output}: IO.print("lock-released")
    case Fail{(+code,+detail)}: IO.die(Unit,code,detail)

def finish_hold(waited: Result<&1,&1,U32 & String,String>, released: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match released:
    case Fail{(+code,+detail)}: IO.die(Unit,code,"sweep lock release failed: " ++ detail)
    case Done{unit}: finish_wait_result(waited)

def hold_result(+database: String, +session: String, +python: String, +script: String, +gate: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,1,"sweep lock was already held")
    case Some{handle}: do IO<Unit>:
      announced : Unit <- IO.print("lock-held")
      waited : Result<&1,&1,U32 & String,String> <- Process.Process.run(Tx.enc_argv([python,script,gate]),".")
      released : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(handle)
      finish_hold(waited,released)

def hold_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> +session <> +python <> +script <> +gate <> Nil{}: do IO<Unit>:
      +canonical : String <- IO.try(String,Lock.SessionLock.canonical(database))
      lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire_drain_sweep(canonical,session))
      hold_result(canonical,session,python,script,gate,lock)
    case other: IO.die(Unit,2,"--hold-sweep-lock DATABASE SESSION PYTHON SCRIPT GATE")

def dispatch(mode: String, args: List<String>) -> IO(Unit):
  match mode:
    case "--deferred-sessions": deferred_sessions_cli(args)
    case "--defer": defer_cli(args)
    case "--clear": clear_cli(args)
    case "--probe-sweep-lock": probe_cli(args)
    case "--hold-sweep-lock": hold_cli(args)
    case other: IO.die(Unit,2,"unsupported drain sweep store fixture command")

def cli(args: List<String>) -> IO(Unit):
  match args:
    case mode <> rest: dispatch(mode,rest)
    case other: IO.die(Unit,2,"drain sweep store fixture requires a command")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
