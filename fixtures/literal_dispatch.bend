# typing fixture: keeper-style literal dispatch plus the String.eq form.
# A runtime argument feeds the dispatch, so nothing folds at check time.
import Base

law first:
  for xs: List<String>
  String

def first(xs):
  match xs:
    case []:
      ""
    case s <> _:
      s

law pick:
  for s: String
  U32

def pick(s):
  match s:
    case "abcdefghijklmnopqrstu":
      1
    case "ab":
      2
    case "abcdefghijklm":
      3
    case "abcd":
      4
    case _:
      0

law keep_host:
  for first: String
  for second: String
  U32

def keep_host(first, second):
  U32.from_nat(Nat.add(String.length(first), String.length(second)))

law keep_message:
  for first: String
  for second: String
  U32

def keep_message(first, second):
  U32.add(U32.from_nat(String.length(second)), 1)

law keeper:
  for selected: Bool
  for first: String
  for second: String
  U32

def keeper(selected, first, second):
  match selected:
    case True{}:
      keep_host(first, second)
    case False{}:
      keep_message(first, second)

law route:
  for flag: String
  for db: String
  U32

def route(flag, db):
  Bool.pick(U32, String.eq(flag, "--host-process-keeper"),
    U32.from_nat(String.length(db)), 2)

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    xs : List<String> <- IO.args()
    IO.print(U32.show(U32.add(pick(first(xs)),
      U32.add(keeper(True{}, "a", "b"),
        route("--host-process-keeper", "db")))))
