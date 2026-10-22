# focused literal-dispatch fixture (#776): a 21-character literal case with
# 2/13/4-element siblings. Leaves are pure stubs.
import Base

law dispatch:
  for s: String
  U32

def dispatch(s):
  match s:
    case "abcdefghijklmnopqrstu":
      21
    case "ab":
      2
    case "abcdefghijklm":
      13
    case "abcd":
      4
    case _:
      0

def main() -> U32:
  dispatch("abcdefghijklmnopqrstu")
