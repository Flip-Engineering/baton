import Base

type Opt is Data:
  Field{name: String, value: String}
  Flag{name: String}

def join(+xs: List<&2,String>) -> String:
  match xs:
    case Nil{}: ""
    case h <> t: String.append(h, String.append(",", join(t)))

def run(+index: U32, +verb: String, +args: List<&2,String>, +path: String) -> String:
  match args:
    case exe <> db <> "--project-settings" <> project <> Nil{}: String.append(String.append("settings:", project), path)
    case exe <> db <> "agent-contextual-input" <> session <> action: String.append(String.append("contextual:", session), String.append(verb, U32.show(index)))
    case exe <> db <> legacy: String.append("legacy:", String.append(db, join(legacy)))
    case other: String.append("missing:", path)

def execute(db: String, actor: String, args: List<String>) -> String:
  match args:
    case Nil{}: String.append("help:", actor)
    case "--help" <> rest: String.append("help:", db)
    case "-h" <> Nil{}: "h"
    case verb <> rest: String.append(verb, actor)

def options(args: List<String>, +found: List<&2,String>) -> List<&2,String>:
  match args:
    case Nil{}: found
    case "--stdin" <> rest: options(rest, "-" <> found)
    case "--source" <> value <> rest: options(rest, value <> found)
    case other <> rest: options(rest, other <> found)

def pair(+args: List<&2,String>, +tag: String) -> String:
  match args:
    case "a" <> "b" <> rest: String.append("ab:", tag)
    case "a" <> other <> rest: String.append("a:", other)
    case first <> rest: String.append("first:", first)
    case Nil{}: String.append("none:", tag)

def marked(args: List<String>, +tag: String) -> String:
  match args:
    case "x" <> rest: String.append("x:", tag)
    case +h <> rest: String.append(h, h)
    case Nil{}: tag

def two(s: String, xs: List<String>) -> String:
  match s, xs:
    case "a", Nil{}: "a-nil"
    case "a", x <> rest: String.append("a-cons:", x)
    case "b", ys: "b-any"
    case other, Nil{}: String.append("other-nil:", other)
    case other, x <> rest: String.append(String.append("other-cons:", other), x)

def opt(o: Opt) -> String:
  match o:
    case Field{"--source", v}: String.append("source=", v)
    case Field{"--label", v}: String.append("label=", v)
    case Field{n, v}: String.append(String.append(n, "="), v)
    case Flag{"--pretty"}: "pretty"
    case Flag{n}: String.append("flag:", n)

def echo(+xs: List<&2,String>, +acc: String) -> String:
  match xs:
    case Nil{}: acc
    case "stop" <> rest: acc
    case "dup" <> rest: echo(rest, String.append(acc, join(xs)))
    case h <> rest: echo(rest, String.append(acc, h))

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(run(7, "v", ["exe", "db", "--project-settings", "proj"], "/p"))
    IO.print(run(7, "v", ["exe", "db", "--project-settings", "proj", "extra"], "/p"))
    IO.print(run(7, "v", ["exe", "db", "agent-contextual-input", "sess", "a1", "a2"], "/p"))
    IO.print(run(7, "v", ["exe", "db", "agent-contextual-input"], "/p"))
    IO.print(run(7, "v", ["exe", "db", "other-mode", "x"], "/p"))
    IO.print(run(7, "v", ["exe", "db"], "/p"))
    IO.print(run(7, "v", ["exe"], "/p"))
    IO.print(execute("d", "a", []))
    IO.print(execute("d", "a", ["--help", "x"]))
    IO.print(execute("d", "a", ["-h"]))
    IO.print(execute("d", "a", ["-h", "y"]))
    IO.print(execute("d", "a", ["go"]))
    IO.print(join(options(["--stdin", "--source", "s1", "x", "--source"], [])))
    IO.print(pair(["a", "b", "c"], "t"))
    IO.print(pair(["a", "z"], "t"))
    IO.print(pair(["a"], "t"))
    IO.print(pair(["q", "b"], "t"))
    IO.print(pair([], "t"))
    IO.print(marked(["x", "y"], "t"))
    IO.print(marked(["hh"], "t"))
    IO.print(two("a", []))
    IO.print(two("a", ["p", "q"]))
    IO.print(two("b", ["p"]))
    IO.print(two("b", []))
    IO.print(two("c", []))
    IO.print(two("c", ["p"]))
    IO.print(two("", ["p"]))
    IO.print(opt(Field{"--source", "s1"}))
    IO.print(opt(Field{"--label", "l1"}))
    IO.print(opt(Field{"--other", "o1"}))
    IO.print(opt(Field{"", ""}))
    IO.print(opt(Flag{"--pretty"}))
    IO.print(opt(Flag{"--pretty2"}))
    IO.print(echo(["p", "dup", "q", "stop", "r"], ">"))
    IO.print(echo(["p", "q"], ">"))
