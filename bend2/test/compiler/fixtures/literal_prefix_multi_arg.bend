import Base

def classify_used(xs: List<String>, suffix: String) -> String:
  match xs:
    case +a <> "x" <> +rest <> Nil{}: String.append(a, suffix)
    case +a <> "y" <> Nil{}: suffix
    case other: suffix

def classify_unused(xs: List<String>, suffix: String) -> String:
  match xs:
    case +a <> "x" <> +rest <> Nil{}: a
    case +a <> "y" <> Nil{}: "y"
    case other: "z"

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(classify_used(["a", "x", "r"], "!"))
    IO.print(classify_used(["a", "y"], "!"))
    IO.print(classify_used(["q"], "!"))
    IO.print(classify_unused(["a", "x", "r"], "!"))
    IO.print(classify_unused(["a", "y"], "!"))
    IO.print(classify_unused(["q"], "!"))
