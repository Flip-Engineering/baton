import Base
import ./control.bend as Control

def register(+executable: String, +db: String, +session: String, +cmd: String, +log: String, +cwd: String) -> IO(Unit):
  do IO<Unit>:
    answer : String <- Control.receiver_using(db,session,cmd,log,cwd,executable)
    IO.write(answer)

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case +executable <> +db <> "receiver" <> +session <> +cmd <> +log <> Nil{}:
      register(executable,db,session,cmd,log,"")
    case +executable <> +db <> "receiver" <> +session <> +cmd <> +log <> +cwd <> Nil{}:
      register(executable,db,session,cmd,log,cwd)
    case +executable <> "--database" <> +db <> "receiver" <> +session <> +cmd <> +log <> Nil{}:
      register(executable,db,session,cmd,log,"")
    case +executable <> "--database" <> +db <> "receiver" <> +session <> +cmd <> +log <> +cwd <> Nil{}:
      register(executable,db,session,cmd,log,cwd)
    case other: IO.die(Unit,2,"unsupported receiver registration command")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
