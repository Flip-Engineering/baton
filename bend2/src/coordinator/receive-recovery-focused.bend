import Base
import ./receive.bend as Receive
import ../host/instance.bend as Custody
import ../host/process.bend as P

@unsafe
def recover_observer_command(+db: String, +session: String, observer: String) -> IO(Unit):
  IO.try(Unit,Receive.recover_observer(db,session,observer))

@unsafe
def recover_receive_command(+db: String, +session: String, +id: String, +cursor: String,
                            +cmd: String, +model: String, +effort: String, +cwd: String,
                            +log: String, +harness: String, +directory: String,
                            native: String) -> IO(Unit):
  IO.try(Unit,Receive.recover(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native))

@unsafe
def dispatch_recover(flag: Bool, +db: String, +session: String, +id: String, +cursor: String,
                     +cmd: String, +model: String, +effort: String, +cwd: String,
                     +log: String, +harness: String, +directory: String, native: String,
                     inputs: String) -> IO(Unit):
  match flag:
    case True{}: recover_receive_command(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native)
    case False{}: IO.die(Unit,2,"expected recovery command")

@unsafe
def dispatch_observer(flag_form: Bool, +first: String, +second: String, +session: String,
                      +observer: String) -> IO(Unit):
  match flag_form:
    case True{}: recover_observer_command(second,session,observer)
    case False{}:
      Bool.pick(IO(Unit),String.eq(second,"recover-observer"),
        recover_observer_command(first,session,observer),
        IO.die(Unit,2,"expected observer recovery command"))

@unsafe
def run_host_keeper(+directory: String, lock: Maybe<&2,U32>) -> IO(Unit):
  match lock:
    case Some{handle}: IO.try(Unit,P.ProcessChild.keeper(directory,handle))
    case None{}: IO.die(Unit,2,"invalid host process keeper lock")

@unsafe
def dispatch_host_keeper(+directory: String, +lock: String) -> IO(Unit):
  run_host_keeper(directory,U32.read(lock))

@unsafe
def dispatch_instance(owner: Bool, shutdown: Bool, +db: String) -> IO(Unit):
  match owner:
    case True{}: IO.try(Unit,Custody.Instance.owner(db))
    case False{}:
      match shutdown:
        case True{}: IO.try(Unit,Custody.Instance.shutdown(db))
        case False{}: IO.die(Unit,2,"expected instance lifecycle command")

@unsafe
def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case "--host-process-keeper" <> +directory <> +lock <> Nil{}:
      dispatch_host_keeper(directory,lock)
    case +flag <> +db <> Nil{}:
      dispatch_instance(String.eq(flag,"--instance-owner"),String.eq(flag,"--instance-shutdown"),db)
    case +flag <> +db <> +session <> +id <> +cursor <> +cmd <> +model <> +effort <> +cwd <> +log <> +harness <> +directory <> +native <> Nil{}:
      dispatch_recover(String.eq(flag,"--recover-receive"),db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,"")
    case +flag <> +db <> +session <> +id <> +cursor <> +cmd <> +model <> +effort <> +cwd <> +log <> +harness <> +directory <> +native <> +inputs <> Nil{}:
      dispatch_recover(String.eq(flag,"--recover-receive"),db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,inputs)
    case +first <> +second <> +session <> +observer <> Nil{}:
      dispatch_observer(String.eq(first,"--recover-observer"),first,second,session,observer)
    case other: IO.die(Unit,2,"observer recovery entry expects a recovery command")

@unsafe
def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
