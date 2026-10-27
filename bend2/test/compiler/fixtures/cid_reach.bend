import Base

type Colour is Data:
  Red{}
  Green{}
  Blue{}
  Grey{}

def show(c: Colour) -> String:
  match c:
    case Red{}: "red"
    case Green{}: "green"
    case Blue{}: "blue"
    case _: "?"

def pick(args: List<String>) -> Colour:
  match args:
    case Nil{}: Red{}
    case +a <> Nil{}: Green{}
    case +a <> +b <> Nil{}: Blue{}
    case _: Red{}

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(show(pick(args)))
