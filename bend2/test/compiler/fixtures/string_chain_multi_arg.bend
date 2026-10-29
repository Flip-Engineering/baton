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

def pick_second(u: String, +s: String) -> String:
  match s:
    case "alpha": u
    case "beta": String.append(u, "!")
    case "gamma": String.append(u, s)
    case "delta": String.append("D", u)
    case "epsilon": String.append("E", u)
    case _: String.append(u, s)

def pick_third(+n: Nat, +a: String, +s: String, u: String) -> String:
  match s:
    case "alpha": String.append(a, u)
    case "beta": u
    case "gamma": String.append(String.append(a, s), u)
    case "delta": String.append(Nat.show(n), u)
    case "epsilon": String.append(a, u)
    case _: String.append(String.append(a, "?"), u)

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(pick1("beta"))
    IO.print(pick2("gamma", "1"))
    IO.print(pick2("zzz", "2"))
    IO.print(pick_linear("alpha", "x"))
    IO.print(pick_linear("beta", "y"))
    IO.print(pick_linear("other", "z"))
    IO.print(pick_second("x", "beta"))
    IO.print(pick_second("x", "gamma"))
    IO.print(pick_second("x", "nope"))
    IO.print(pick_third(7n, "a", "alpha", "u"))
    IO.print(pick_third(7n, "a", "gamma", "u"))
    IO.print(pick_third(7n, "a", "delta", "u"))
    IO.print(pick_third(7n, "a", "zzz", "u"))
