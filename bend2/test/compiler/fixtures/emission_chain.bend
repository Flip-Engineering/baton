import Base

def classify(xs: List<String>) -> String:
  match xs:
    case "--stop-hook" <> Nil{}: "stop"
    case "--redeliver-message" <> +db <> +id <> Nil{}: db ++ id
    case +arg <> Nil{}: arg ++ "!"
    case other: "other"

def project(xs: List<String>) -> String:
  classify(xs)

def route(xs: List<String>) -> String:
  project(xs)

def cli(xs: List<String>) -> String:
  route(xs)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(cli(args))
