import Base

def pick1(+s: String) -> String:
  match s:
    case "alpha": "A"
    case "beta": "B"
    case "gamma": "G"
    case "delta": "D"
    case "epsilon": "E"
    case _: "-"

def pick2(+s: String, +t: String) -> String:
  match s:
    case "alpha": String.append("A", t)
    case "beta": String.append("B", t)
    case "gamma": String.append("G", t)
    case "delta": String.append("D", t)
    case "epsilon": String.append("E", t)
    case _: String.append(s, t)

def pick_linear(+s: String, u: String) -> String:
  match s:
    case "alpha": u
    case "beta": String.append(u, "!")
    case _: u

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(pick1("beta"))
    IO.print(pick2("gamma", "1"))
    IO.print(pick2("zzz", "2"))
    IO.print(pick_linear("alpha", "x"))
    IO.print(pick_linear("beta", "y"))
    IO.print(pick_linear("other", "z"))
