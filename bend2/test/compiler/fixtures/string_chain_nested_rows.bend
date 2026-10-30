import Base

type Body is Data:
  Missing{}
  Text{value: String}
  Bad{cause: String}

def body_text(body: Body) -> String:
  match body:
    case Missing{}: "-"
    case Text{value}: value
    case Bad{cause}: String.append("!", cause)

def verb_id(+verb: String, +id: String) -> String:
  match verb:
    case "show": String.append("show:", id)
    case "players": match id:
      case "--pretty": "players-pretty"
      case _: "invalid"
    case "pending": match id:
      case "--pretty": "pending-pretty"
      case "--index": "pending-index"
      case _: "invalid"
    case "view": String.append(id, id)
    case _: "invalid"

def verb_two(+verb: String, +session: String, +id: String) -> String:
  match verb:
    case "batch": String.append(session, id)
    case "resume": match id:
      case "--lift-stop": String.append("resume-lift:", session)
      case "--clear-stop": String.append("clear:", session)
      case _: "invalid"
    case "inbox": match id:
      case "--pretty": String.append("inbox-pretty:", session)
      case "--index": String.append("inbox-index:", session)
      case other: String.append(String.append("inbox-other:", session), other)
    case _: "invalid"

def index(args: List<String>, +acc: String, +state: String) -> String:
  match args:
    case Nil{}: String.append(acc, String.append("|", state))
    case "--index" <> rest: index(rest, String.append(acc, "i"), state)
    case "--sender" <> value <> rest: index(rest, String.append(acc, value), state)
    case "--state" <> value <> rest:
      match value:
        case "pending": index(rest, acc, "P")
        case "read": index(rest, acc, "R")
        case "all": index(rest, acc, "A")
        case _: "invalid-state"
    case _: "invalid"

def send(args: List<String>, +to: String, body: Body) -> String:
  match args:
    case "--text" <> value <> rest: send(rest, to, Text{value})
    case "and" <> target <> rest:
      match body:
        case Missing{}: "missing-before-and"
        case Bad{cause}: String.append("bad:", cause)
        case value: String.append(String.append(String.append(to, "="), body_text(value)), String.append(";", send(rest, target, Missing{})))
    case Nil{}: String.append(String.append(to, "="), body_text(body))
    case other: "unknown"

def deep2(+a: String, +b: String, +c: String) -> String:
  match a:
    case "x": match b:
      case "y": match c:
        case "z": "xyz"
        case _: "xy_"
      case _: "x_"
    case _: "_"

def subst(args: List<String>, +tag: String) -> String:
  match args:
    case "--mode" <> value <> rest:
      match value:
        case "fast": String.append("mode:", value)
        case "slow": String.append(value, "!")
        case other: String.append("other:", other)
    case _: tag

def marked2(args: List<String>, +tag: String) -> String:
  match args:
    case "--twice" <> value <> rest:
      match value:
        case "": "empty"
        case +v: String.append(v, v)
    case _: tag

def flags(args: List<String>, flag: Bool) -> String:
  match args:
    case "--on" <> rest: match flag:
      case True{}: "on-true"
      case False{}: "on-false"
    case _: "none"

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(verb_id("show", "s1"))
    IO.print(verb_id("players", "--pretty"))
    IO.print(verb_id("players", "x"))
    IO.print(verb_id("pending", "--index"))
    IO.print(verb_id("pending", "--pretty"))
    IO.print(verb_id("pending", ""))
    IO.print(verb_id("view", "ab"))
    IO.print(verb_id("other", "--pretty"))
    IO.print(verb_two("batch", "s", "i"))
    IO.print(verb_two("resume", "s", "--lift-stop"))
    IO.print(verb_two("resume", "s", "--clear-stop"))
    IO.print(verb_two("resume", "s", "--x"))
    IO.print(verb_two("inbox", "s", "--index"))
    IO.print(verb_two("inbox", "s", "--pretty"))
    IO.print(verb_two("inbox", "s", "q"))
    IO.print(verb_two("nope", "s", "--pretty"))
    IO.print(index(["--index", "--sender", "a", "--state", "read", "--sender", "b"], ">", "-"))
    IO.print(index(["--state", "all"], "", "-"))
    IO.print(index(["--state", "bogus", "--index"], "", "-"))
    IO.print(index(["--state"], "", "-"))
    IO.print(index(["--sender"], "", "-"))
    IO.print(index(["x"], "", "-"))
    IO.print(index([], "acc", "st"))
    IO.print(send(["--text", "hi", "and", "bob", "--text", "yo"], "al", Missing{}))
    IO.print(send(["and", "bob"], "al", Missing{}))
    IO.print(send(["and", "bob"], "al", Bad{"e"}))
    IO.print(send([], "al", Bad{"e"}))
    IO.print(send(["--text"], "al", Missing{}))
    IO.print(send(["zz", "q"], "al", Missing{}))
    IO.print(deep2("x", "y", "z"))
    IO.print(deep2("x", "y", "w"))
    IO.print(deep2("x", "q", "z"))
    IO.print(deep2("q", "y", "z"))
    IO.print(subst(["--mode", "fast"], "none"))
    IO.print(subst(["--mode", "slow", "x"], "none"))
    IO.print(subst(["--mode", "warp"], "none"))
    IO.print(subst(["--mode"], "none"))
    IO.print(marked2(["--twice", "ab"], "none"))
    IO.print(marked2(["--twice", ""], "none"))
    IO.print(marked2(["--once", "ab"], "none"))
    IO.print(flags(["--on"], True{}))
    IO.print(flags(["--on", "x"], False{}))
    IO.print(flags(["--off"], True{}))
