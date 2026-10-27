import Base

def describe(xs: List<String>) -> String:
  match xs:
    case Nil{}: "empty"
    case +h <> _: h

def classify(xs: List<String>) -> String:
  match xs:
    case +a <> "x" <> +rest <> Nil{}: a
    case +a <> "y" <> Nil{}: a
    case +a <> +b <> Nil{}: a
    case other: describe(other)

def classify_text(+s: String) -> String:
  match s:
    case "a": "A"
    case "ab": "AB"
    case "abc": "ABC"
    case other: other

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(classify(["a","x","b"]))
    IO.print(classify(["a","y"]))
    IO.print(classify(["z"]))
    IO.print(classify(Nil{}))
    IO.print(classify(["a","z"]))
    IO.print(classify_text("a"))
    IO.print(classify_text("ab"))
    IO.print(classify_text("abc"))
    IO.print(classify_text("z"))
    IO.print(classify_text(""))
