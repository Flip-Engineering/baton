# A differential fixture for one decision written two ways.
#
# The first form reads the separator character and passes a duplicated string
# binder into two sibling lazy branches. The second form tags the separator and
# matches the tag, so each branch reads the string once.
#
# The checker accepts a law that equates the two forms. This program reports
# what the compiled binary computes, so the two can be compared on the admitted
# remote runner:
#
#   BEND_NO_TELEMETRY=1 "$BEND" bend2/tests/context-environment/dup-binder-differential.bend -o .scratch/bend2/dup-binder-differential.c
#   clang -O1 .scratch/bend2/dup-binder-differential.c -lm -o .scratch/bend2/dup-binder-differential
#   .scratch/bend2/dup-binder-differential
#
# Expected when the runtime agrees with the checker: every line reads "true"
# and the program exits 0. The historical observation on this host, recorded
# before the remote-only execution boundary, was v_dup(-beta)=false against
# v_mode(-beta)=true; the generated C and the binary of that run were lost with
# the host's temporary directory, so this file is the reproducible source.

import Base

def non_empty(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{c, r}: True{}

def b(x: Bool) -> String:
  Bool.pick(String, x, "true", "false")

def same(a: Bool, b2: Bool) -> Bool:
  match a:
    case True{}: b2
    case False{}: Bool.not(b2)

# Form one: the tail is a duplicated binder read by two sibling branches.
def v_dup(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{+c, +rest}:
      Bool.or(Bool.pick(Bool, U32.is_eq(Char.to_u32(c), 45), non_empty(rest), False{}),
              Bool.pick(Bool, U32.is_eq(Char.to_u32(c), 43), non_empty(rest), False{}))

type SepMode is Data:
  SepNone{}
  SepDash{}
  SepPlus{}

def sep_of(c: Char) -> SepMode:
  +code = Char.to_u32(c)
  Bool.pick(SepMode, U32.is_eq(code, 45), SepDash{},
    Bool.pick(SepMode, U32.is_eq(code, 43), SepPlus{}, SepNone{}))

def v_mode_go(m: SepMode, rest: String) -> Bool:
  match m:
    case SepNone{}: False{}
    case SepDash{}: non_empty(rest)
    case SepPlus{}: non_empty(rest)

# Form two: the decision is a match on a tag, and each branch reads the tail
# once.
def v_mode(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{+c, rest}: v_mode_go(sep_of(c), rest)

def line(s: String) -> String:
  s ++ ": dup=" ++ b(v_dup(s)) ++ " mode=" ++ b(v_mode(s))

def agree(s: String) -> Bool:
  same(v_dup(s), v_mode(s))

def all_agree() -> Bool:
  Bool.and(agree("-beta"), Bool.and(agree("+build"), Bool.and(agree("~x"),
    Bool.and(agree(""), Bool.and(agree("-"), agree("+"))))))

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(line("-beta"))
    IO.print(line("+build"))
    IO.print(line("~x"))
    IO.print(line(""))
    IO.print(line("-"))
    IO.print(line("+"))
    Bool.pick(IO(Unit), all_agree(),
      IO.print("dup-binder differential: the two forms agree"),
      IO.die(Unit, 1, "dup-binder differential: the two forms differ"))
