import Base

def pick_many(+s: String) -> String:
  match s:
    case "alpha": "A"
    case "beta": "B"
    case "gamma": "G"
    case "delta": "D"
    case "epsilon": "E"
    case other: String.append("?", other)

def pick_lone(s: String) -> String:
  match s:
    case "alpha": "A"
    case "beta": "B"
    case "gamma": "G"
    case "delta": "D"
    case "epsilon": "E"
    case other: String.append("?", other)

def pick_lone_param(s: String) -> String:
  match s:
    case "alpha": "A"
    case "twice": String.append(s, s)
    case _: String.append(s, "!")

def pick_lone_plus(s: String) -> String:
  match s:
    case "alpha": "A"
    case +other: String.append(other, other)

def pick_lone_middle(u: String, s: String, +t: String) -> String:
  match s:
    case "alpha": String.append(u, t)
    case "beta": String.append(t, u)
    case "gamma": String.append(u, "G")
    case other: String.append(String.append(u, other), t)

def pick_lone_total(s: String) -> U32:
  match s:
    case "one": 1
    case "two": 2
    case "three": 3
    case _: 0

def pick_lone_nested(s: String, t: String) -> String:
  match s:
    case "alpha": "A"
    case "beta": match t:
      case "x": "BX"
      case _: "B"
    case _: "-"

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(pick_many("beta"))
    IO.print(pick_many("zeta"))
    IO.print(pick_lone("gamma"))
    IO.print(pick_lone("epsilon"))
    IO.print(pick_lone("zeta"))
    IO.print(pick_lone(""))
    IO.print(pick_lone("alphas"))
    IO.print(pick_lone_param("alpha"))
    IO.print(pick_lone_param("twice"))
    IO.print(pick_lone_param("tw"))
    IO.print(pick_lone_plus("alpha"))
    IO.print(pick_lone_plus("ab"))
    IO.print(pick_lone_middle("u", "alpha", "t"))
    IO.print(pick_lone_middle("u", "beta", "t"))
    IO.print(pick_lone_middle("u", "gamma", "t"))
    IO.print(pick_lone_middle("u", "other", "t"))
    IO.print(U32.show(pick_lone_total("two")))
    IO.print(U32.show(pick_lone_total("four")))
    IO.print(pick_lone_nested("beta", "x"))
    IO.print(pick_lone_nested("beta", "y"))
    IO.print(pick_lone_nested("gamma", "x"))
