import Base

def twice_head(args: List<String>, t: String) -> String:
  match args:
    case "x" <> rest: t
    case h <> rest: String.append(h, h)
    case Nil{}: t

def main() -> IO(Unit):
  IO.print(twice_head(["y"], "t"))
