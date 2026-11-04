import Base

def pick(args: List<String>) -> String:
  match args:
    case "a" <> _:
      "one"
    case _:
      "x" ++ "y"

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(pick(args))
