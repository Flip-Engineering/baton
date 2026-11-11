# focused same-source C fixture: a literal dispatch with a 21-character
# case, 2-, 13- and 4-character siblings, and a default row. The leaves are
# pure stubs and the argument is runtime data, so the dispatch emits.
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

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    xs : List<String> <- IO.args()
    IO.print(U32.show(pick(first(xs))))
