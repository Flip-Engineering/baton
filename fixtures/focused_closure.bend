# focused literal-string dispatch returning closures: one 21-char literal,
# siblings of 2, 13 and 4 characters, and a default row. Each leaf is a
# pure stub closure.
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
  U32 -> U32

def pick(s):
  match s:
    case "abcdefghijklmnopqrstu":
      x => U32.add(x, 1)
    case "ab":
      x => U32.add(x, 2)
    case "abcdefghijklm":
      x => U32.add(x, 3)
    case "abcd":
      x => U32.add(x, 4)
    case _:
      x => U32.add(x, 0)

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    xs : List<String> <- IO.args()
    IO.print(U32.show(pick(first(xs))(7)))
