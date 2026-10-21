import Base

def check(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}:
      IO.print("empty")
    case +first <> _:
      IO.print(first)

def run(args: List<String>) -> IO(Unit):
  do IO<Unit>:
    c : Chan(Unit) <- IO.fork(Unit,IO.pure(Unit,Unit{}))
    x : Unit <- IO.join(Unit,c)
    check(args)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
