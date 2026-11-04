import Base

def twice(args: List<String>, +tag: String) -> String:
  match args:
    case "--x" <> value <> rest:
      match value:
        case "a": "a"
        case other: String.append(other, other)
    case _: tag

def main() -> IO(Unit):
  IO.print(twice(["--x", "b"], "none"))
