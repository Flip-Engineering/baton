# CLAIM: given a suffix that starts at a possible opening quote, this helper locates the
# closing quote of one JSON string token by list recursion with a reverse accumulator and a
# single escaped flag, and returns the exact token including both quotes together with the
# exact unconsumed suffix, or an exact record of the input when no close or no open exists.
# Internal precondition: every element is already a validated octet in 0..255. This helper
# does not perform full input host validation; the whole-input lexer must establish that
# precondition independently before any grammar decision.
# Scope: string boundary only. Invalid escape spellings, raw control characters and UTF8
# validation belong to the unchanged string decoder applied to the returned token. Object,
# array and whole-frame acceptance stay outside this helper.
# Language forms grounded by reading the pinned Base and the number and string components:
# element-with-list cons, definition before its callers, Bool.pick with a first type
# argument, a computed value bound to a helper parameter before it is matched, and a plus
# binder on any value used more than once.
# UNCOMPILED and UNTESTED.

import Base

type SliceResult is Data:
  Closed{token: List<U32>, rest: List<U32>}
  MissingClose{scanned: List<U32>}
  MissingOpen{original: List<U32>}

def rev_units(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_units(t, h <> acc)

# The walker accumulates the consumed octets in reverse. While escaped is true the current
# octet is appended and the state returns to false whatever its value. While escaped is
# false a backslash appends and sets the flag, a quote appends and closes the token, and any
# other octet appends and continues. End of input in either state reports MissingClose with
# the exact original input.
def walk(rest: List<U32>, acc: List<U32>, escaped: Bool) -> SliceResult:
  match rest:
    case Nil{}: MissingClose{rev_units(acc, Nil{})}
    case +h <> t:
      Bool.pick(SliceResult, escaped, walk(t, h <> acc, False{}),
        Bool.pick(SliceResult, U32.is_eq(h, 92), walk(t, h <> acc, True{}),
          Bool.pick(SliceResult, U32.is_eq(h, 34),
            Closed{rev_units(h <> acc, Nil{}), t},
            walk(t, h <> acc, False{}))))

def slice(octets: List<U32>) -> SliceResult:
  match octets:
    case Nil{}: MissingOpen{Nil{}}
    case +h <> t:
      Bool.pick(SliceResult, U32.is_eq(h, 34), walk(t, h <> Nil{}, False{}), MissingOpen{octets})
