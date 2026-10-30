import Base

def subst1(args: List<String>) -> String:
  match args:
    case "--mode" <> value <> rest:
      match value:
        case "fast": String.append("mode:", value)
        case other: String.append("other:", other)
    case _: "none"

def framed(args: List<String>) -> String:
  match args:
    case exe <> "--level" <> level <> Nil{}:
      match level:
        case "high": String.append(exe, ":high")
        case other: String.append(exe, String.append(":", other))
    case other: "none"

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(subst1(["--mode", "fast"]))
    IO.print(subst1(["--mode", "warp", "x"]))
    IO.print(subst1([]))
    IO.print(framed(["bend", "--level", "high"]))
    IO.print(framed(["bend", "--level", "low"]))
    IO.print(framed(["bend", "--level", "low", "x"]))
