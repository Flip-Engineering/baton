import Base

def twice_other(s: String) -> String:
  match s:
    case "alpha": "A"
    case other: String.append(other, other)

def main() -> IO(Unit):
  IO.print(twice_other("x"))
