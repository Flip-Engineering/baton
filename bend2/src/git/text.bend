# Text helpers of the Git operations module: string walks, list joins and
# splits, hex decoding and the length-prefixed argv encoding the process
# effect uses. Every walk follows the checker's rules: the shrinking argument
# first, one dup bind per fanned value, matches only at def-body heads, and
# every helper defined before its caller.

import Base
import ./types.bend as T

def is_nl(c: Char) -> Bool:
  Bool.pick(Bool, U32.is_eq(Char.to_u32(c), 10), True{}, False{})

def is_sp(c: Char) -> Bool:
  Bool.pick(Bool, U32.is_eq(Char.to_u32(c), 32), True{}, False{})

# One UTF-8 byte length per char code.
def char_bytes(c: Char) -> U32:
  +code = Char.to_u32(c)
  Bool.pick(U32, U32.is_lt(code, 128), 1,
    Bool.pick(U32, U32.is_lt(code, 2048), 2,
      Bool.pick(U32, U32.is_lt(code, 65536), 3, 4)))

def byte_len_go(s: String, acc: U32) -> U32:
  match s:
    case SNil{}: acc
    case SCon{c, rest}:
      +acc2 = acc
      byte_len_go(rest, U32.add(char_bytes(c), acc2))

def byte_len(s: String) -> U32:
  byte_len_go(s, 0)

# Reversed copy of a string, building the answer head first.
def rev_go(s: String, acc: String) -> String:
  match s:
    case SNil{}: acc
    case SCon{c, rest}: rev_go(rest, SCon{c, acc})
def str_rev(s: String) -> String:
  rev_go(s, SNil{})

# The char-level splitters: one line or field accumulates in acc, a completed
# piece goes character-reversed onto out, and the caller reverses the list.
def split_emit(nl: Bool, acc: String, out: List<String>) -> List<String>:
  match nl:
    case True{}: Con{str_rev(acc), out}
    case False{}: out

def split_keep(nl: Bool, c: Char, acc: String) -> String:
  match nl:
    case True{}: SNil{}
    case False{}: SCon{c, acc}

def split_flush(acc: String, out: List<String>) -> List<String>:
  match acc:
    case SNil{}: out
    case SCon{c, r}: Con{str_rev(acc), out}

def split_at(s: String, acc: String, out: List<String>) -> List<String>:
  match s:
    case SNil{}: split_flush(acc, out)
    case SCon{c, rest}:
      +cc = c
      +nl = is_nl(cc)
      +acc2 = acc
      split_at(rest, split_keep(nl, cc, acc2), split_emit(nl, acc2, out))

def split_lines(s: String) -> List<String>:
  List.reverse(&1, String, split_at(s, SNil{}, Nil{}))

def split_keep_sp(nl: Bool, c: Char, acc: String) -> String:
  match nl:
    case True{}: SNil{}
    case False{}: SCon{c, acc}

def split_emit_sp(nl: Bool, acc: String, out: List<String>) -> List<String>:
  match nl:
    case True{}: Con{str_rev(acc), out}
    case False{}: out

def split_flush_sp(acc: String, out: List<String>) -> List<String>:
  match acc:
    case SNil{}: out
    case SCon{c, r}: Con{str_rev(acc), out}

def split_at_sp(s: String, acc: String, out: List<String>) -> List<String>:
  match s:
    case SNil{}: split_flush_sp(acc, out)
    case SCon{c, rest}:
      +cc = c
      +nl = is_sp(cc)
      +acc2 = acc
      split_at_sp(rest, split_keep_sp(nl, cc, acc2), split_emit_sp(nl, acc2, out))

def split_spaces(s: String) -> List<String>:
  List.reverse(&1, String, split_at_sp(s, SNil{}, Nil{}))

def str_cat(a: String, b: String) -> String:
  a ++ b

def non_empty(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{c, r}: True{}

def join_go(sep: String, xs: List<String>, s: String) -> String:
  match xs:
    case Nil{}: s
    case Con{h, t}:
      +sp = sep
      join_go(sp, t, s ++ sp ++ h)

def join(sep: String, xs: List<String>) -> String:
  match xs:
    case Nil{}: ""
    case Con{h, t}: join_go(sep, t, h)

def trim_nl(s: String) -> String:
  join("\n", split_lines(s))

def str_eq_go(a: String, b: String) -> Bool:
  match a b:
    case SNil{} SNil{}: True{}
    case SCon{ac, ar} SCon{bc, br}:
      +eq = U32.is_eq(Char.to_u32(ac), Char.to_u32(bc))
      Bool.pick(Bool, eq, str_eq_go(ar, br), False{})
    case SNil{} SCon{bc, br}: False{}
    case SCon{ac, ar} SNil{}: False{}

def str_eq(a: String, b: String) -> Bool:
  str_eq_go(a, b)

def starts_with(s: String, p: String) -> Bool:
  match s p:
    case SNil{} SNil{}: True{}
    case SNil{} SCon{pc, pr}: False{}
    case SCon{sc, sr} SNil{}: True{}
    case SCon{sc, sr} SCon{pc, pr}:
      +eq = U32.is_eq(Char.to_u32(sc), Char.to_u32(pc))
      Bool.pick(Bool, eq, starts_with(sr, pr), False{})

def hex_val(c: Char) -> U32:
  +code = Char.to_u32(c)
  +is_lo = Bool.pick(Bool, U32.is_lt(96, code), U32.is_lt(code, 123), False{})
  +is_up = Bool.pick(Bool, U32.is_lt(64, code), U32.is_lt(code, 91), False{})
  +is_dg = Bool.pick(Bool, U32.is_lt(47, code), U32.is_lt(code, 58), False{})
  Bool.pick(U32, is_dg, U32.sub(code, 48),
    Bool.pick(U32, is_lo, U32.sub(code, 87),
      Bool.pick(U32, is_up, U32.sub(code, 55), 0)))

def hex_char2(a: Char, b: Char) -> Char:
  +hi = hex_val(a)
  +lo = hex_val(b)
  Char.from_u32(U32.add(U32.mul(hi, 16), lo))

def hex_char_b(a: Char, rest: String) -> Char:
  match rest:
    case SNil{}: Char.from_u32(0)
    case SCon{b, more}: hex_char2(a, b)

def hex_char_a(p: String) -> Char:
  match p:
    case SNil{}: Char.from_u32(0)
    case SCon{a, rest}: hex_char_b(a, rest)

def hex_pairs_emit(prev: String, a: Char, out: List<String>) -> List<String>:
  match prev:
    case SNil{}: out
    case SCon{p, pr}: Con{SCon{p, SCon{a, SNil{}}}, out}

def hex_pairs_end(prev: String, out: List<String>) -> List<String>:
  match prev:
    case SNil{}: out
    case SCon{p, pr}: out

def one_char(c: Char) -> String:
  SCon{c, SNil{}}

def hex_pairs_go(s: String, prev: String, out: List<String>) -> List<String>:
  match s:
    case SNil{}: hex_pairs_end(prev, out)
    case SCon{a, rest}:
      +a2 = a
      hex_pairs_go(rest, one_char(a2), hex_pairs_emit(prev, a2, out))

def hex_cat_go(xs: List<String>, acc: String) -> String:
  match xs:
    case Nil{}: str_rev(acc)
    case Con{p, rest}:
      +acc2 = acc
      hex_cat_go(rest, SCon{hex_char_a(p), acc2})

def hex_decode(s: String) -> String:
  hex_cat_go(hex_pairs_go(s, SNil{}, Nil{}), SNil{})

# The argv encoding of the process effect: each element as its UTF-8 byte
def enc_argv_go(xs: List<String>, acc: String) -> String:
  match xs:
    case Nil{}: acc
    case Con{h, rest}:
      +h2 = h
      +acc2 = acc
      enc_argv_go(rest, acc2 ++ U32.show(byte_len(h2)) ++ ":" ++ h2)
def enc_argv(xs: List<String>) -> String:
  enc_argv_go(xs, SNil{})

def run_res_mk(st: T.Status, rest: String) -> T.RunRes:
  T.RRun{st, rest}

def run_res_sig1(n: U32, rest: String) -> T.RunRes:
  run_res_mk(T.SSignal{n}, rest)

def run_res_sig0(n: U32, rest: String) -> T.RunRes:
  run_res_mk(T.SExit{n}, rest)

def run_res_sig(sig: Bool, n: U32, rest: String) -> T.RunRes:
  match sig:
    case True{}: run_res_sig1(n, rest)
    case False{}: run_res_sig0(n, rest)

def run_res_parsed(m: Maybe<&2, U32>, rest: String, sig: Bool) -> T.RunRes:
  match m:
    case None{}: T.RSpawn{"malformed status number"}
    case Some{n}: run_res_sig(sig, n, rest)

def run_res_num(num: String, rest: String, sig: Bool) -> T.RunRes:
  run_res_parsed(U32.read(num), rest, sig)

def run_res_issig(eq: Bool, num: String, rest: String) -> T.RunRes:
  match eq:
    case True{}: run_res_num(num, rest, True{})
    case False{}: T.RSpawn{"unknown status token"}

def run_res_isexit(eq: Bool, tok: String, num: String, rest: String) -> T.RunRes:
  match eq:
    case True{}: run_res_num(num, rest, False{})
    case False{}: run_res_issig(str_eq(tok, "signal"), num, rest)

def run_res_tok(tok: String, num: String, rest: String) -> T.RunRes:
  +t2 = tok
  run_res_isexit(str_eq(t2, "exit"), t2, num, rest)

def run_res_more(tok: String, more: List<String>, rest: String) -> T.RunRes:
  match more:
    case Nil{}: T.RSpawn{"malformed status line"}
    case Con{num, Nil{}}: run_res_tok(tok, num, rest)
    case Con{num, Con{x, rest2}}: T.RSpawn{"malformed status line"}

def run_res_fields(fs: List<String>, rest: String) -> T.RunRes:
  match fs:
    case Nil{}: T.RSpawn{"malformed status line"}
    case Con{tok, more}: run_res_more(tok, more, rest)

def run_res_line(line: String, rest: String) -> T.RunRes:
  run_res_fields(split_spaces(line), rest)

def run_res_lines(ls: List<String>, out: String) -> T.RunRes:
  match ls:
    case Nil{}: T.RSpawn{"process answered nothing"}
    case Con{first, rest}: run_res_line(first, join("\n", rest))

def run_res_done(out: String) -> T.RunRes:
  +out2 = out
  run_res_lines(split_lines(out2), out2)

# A run answer "exit 3\nrest" or "signal 9\nrest": the status and the output
# that followed the status line.
def run_res(r: Result<&1, &1, U32 & String, String>) -> T.RunRes:
  match r:
    case Fail{error}:
      (code, text) = error
      T.RSpawn{text}
    case Done{value}: run_res_done(value)