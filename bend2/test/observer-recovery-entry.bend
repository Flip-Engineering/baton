import Base
import ../src/coordinator/receive.bend as Receive

# Focused observer qualification entry. It calls the production recovery
# functions directly and omits general NativeInput and command registration.
def recover_observer_command(+db: String, +session: String, observer: String) -> IO(Unit):
  IO.try(Unit,Receive.recover_observer(db,session,observer))

def recover_receive_command(+db: String, +session: String, +id: String, +cursor: String,
                            +cmd: String, +model: String, +effort: String, +cwd: String,
                            +log: String, +harness: String, +directory: String,
                            native: String) -> IO(Unit):
  IO.try(Unit,Receive.recover(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native))

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case "--recover-observer" <> db <> session <> observer <> Nil{}:
      recover_observer_command(db,session,observer)
    case "--recover-receive" <> db <> session <> id <> cursor <> cmd <> model <> effort <> cwd <> log <> harness <> directory <> native <> Nil{}:
      recover_receive_command(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native)
    case other: IO.die(Unit,2,"observer recovery fixture expects a recovery command")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
