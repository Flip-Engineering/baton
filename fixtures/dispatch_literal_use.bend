import Base

law g:
  for s: String
  U32

def g(s):
  U32.from_nat(String.length(s))

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
    case t:
      g(t)

def main() -> U32:
  dispatch("zz")
