# CLAIM: bend 2.0.25's checker enforces affine use and Data-only copying at the
# type level, verifies termination by shrinking arguments, and its
# expressiveness limits are checker rules: a computed value cannot be a match
# scrutinee, mutually recursive defs are refused, and Type-kinded values
# (closures) cannot be marked reusable.
#
# Evidence: lang-core-types.evidence.md (exact commands and observed output,
# including the four refusals).

import Base

type Shape is Data:
  Circle{r: U32}
  Square{s: U32}

# Matching a Data value hands out + fields, so the body may use them freely.
def area(x: Shape) -> U32:
  match x:
    case Circle{+r}:
      (3 * r * r : U32)
    case Square{+s}:
      (s * s : U32)

# Functions are values; a closure is affine and is called exactly once here.
def adder(k: U32) -> U32 -> U32:
  x => (x + k : U32)

# A reusable parameter requires Data: U32 is Data, so +x is accepted.
def pair_of(+x: U32) -> List<U32>:
  [x, x]

# One length def serves lists of any element kind: Kind(a) accepts both
# Data elements (&2) and closure elements (&1).
def length(a, -A: Kind(a), xs: List<a, A>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+length(a, A, t)

def main() -> String:
  a    = area(Square{7})
  add2 = adder(40)
  b    = add2(2)
  U32.show(a) ++ " " ++ U32.show(b) ++ " " ++ Nat.show(length(&1, U32, pair_of(5)))
