# Executable corpus for bend2/src/receive/output-json-lex.bend.
# CLAIM: every named case asserts a complete typed lexer result through explicit equality over
# the constructor and its exact octet and token lists, so token order, token kind, token
# payload and the whole original input are checked independently, and a second group asserts
# the result comparator by requiring inequality when exactly one of token kind, token order,
# token payload, original octets, disposition, reason or fault value differs.
# Expectations are written independently of the implementation and name every expected byte.
# Two cases are labelled tokenization only: unmatched punctuation and several top-level
# scalars are legitimate lexical successes, because whole-frame acceptance belongs to the
# structural parser and not to this module.
# Refusal reasons are the ones the unchanged number and string decoders produce, read from
# those sources rather than guessed.
# Language forms: definitions before their callers, nested matches over the pinned result
# constructors with positional binders, Bool.pick with a first type argument, and a computed
# value bound to a parameter before it is matched. UNCOMPILED and UNTESTED.

import Base
import ../src/receive/output-json-lex.bend as L

def same_units(left: List<U32>, right: List<U32>) -> Bool:
  match left:
    case Nil{}:
      match right:
        case Nil{}: True{}
        case _r <> _rt: False{}
    case lh <> lt:
      match right:
        case Nil{}: False{}
        case rh <> rt: Bool.pick(Bool, U32.is_eq(lh, rh), same_units(lt, rt), False{})

def same_tok(left: L.LexTok, right: L.LexTok) -> Bool:
  match left:
    case L.Punctuation{a_code}:
      match right:
        case L.Punctuation{b_code}: U32.is_eq(a_code, b_code)
        case L.StrTok{_u, _o}: False{}
        case L.NumTok{_o}: False{}
        case L.LitTok{_n, _o}: False{}
    case L.StrTok{a_units, a_orig}:
      match right:
        case L.Punctuation{_c}: False{}
        case L.StrTok{b_units, b_orig}:
          Bool.and(same_units(a_units, b_units), same_units(a_orig, b_orig))
        case L.NumTok{_o}: False{}
        case L.LitTok{_n, _o}: False{}
    case L.NumTok{a_orig}:
      match right:
        case L.Punctuation{_c}: False{}
        case L.StrTok{_u, _o}: False{}
        case L.NumTok{b_orig}: same_units(a_orig, b_orig)
        case L.LitTok{_n, _o}: False{}
    case L.LitTok{a_name, a_orig}:
      match right:
        case L.Punctuation{_c}: False{}
        case L.StrTok{_u, _o}: False{}
        case L.NumTok{_o}: False{}
        case L.LitTok{b_name, b_orig}:
          Bool.and(String.eq(a_name, b_name), same_units(a_orig, b_orig))

def same_toks(left: List<L.LexTok>, right: List<L.LexTok>) -> Bool:
  match left:
    case Nil{}:
      match right:
        case Nil{}: True{}
        case _r <> _rt: False{}
    case lh <> lt:
      match right:
        case Nil{}: False{}
        case rh <> rt: Bool.pick(Bool, same_tok(lh, rh), same_toks(lt, rt), False{})

def same_result(left: L.LexResult, right: L.LexResult) -> Bool:
  match left:
    case L.LexTokens{a_toks, a_orig}:
      match right:
        case L.LexTokens{b_toks, b_orig}:
          Bool.and(same_toks(a_toks, b_toks), same_units(a_orig, b_orig))
        case L.LexRefused{_r, _o}: False{}
        case L.LexUnsupported{_r, _o}: False{}
        case L.LexHostFault{_v, _o}: False{}
    case L.LexRefused{a_reason, a_orig}:
      match right:
        case L.LexTokens{_t, _o}: False{}
        case L.LexRefused{b_reason, b_orig}:
          Bool.and(String.eq(a_reason, b_reason), same_units(a_orig, b_orig))
        case L.LexUnsupported{_r, _o}: False{}
        case L.LexHostFault{_v, _o}: False{}
    case L.LexUnsupported{a_reason, a_orig}:
      match right:
        case L.LexTokens{_t, _o}: False{}
        case L.LexRefused{_r, _o}: False{}
        case L.LexUnsupported{b_reason, b_orig}:
          Bool.and(String.eq(a_reason, b_reason), same_units(a_orig, b_orig))
        case L.LexHostFault{_v, _o}: False{}
    case L.LexHostFault{a_value, a_orig}:
      match right:
        case L.LexTokens{_t, _o}: False{}
        case L.LexRefused{_r, _o}: False{}
        case L.LexUnsupported{_r, _o}: False{}
        case L.LexHostFault{b_value, b_orig}:
          Bool.and(U32.is_eq(a_value, b_value), same_units(a_orig, b_orig))

def toks(tokens: List<L.LexTok>, original: List<U32>) -> L.LexResult:
  L.LexTokens{tokens, original}

def refused(reason: String, original: List<U32>) -> L.LexResult:
  L.LexRefused{reason, original}

def unsupported(reason: String, original: List<U32>) -> L.LexResult:
  L.LexUnsupported{reason, original}

def fault(value: U32, original: List<U32>) -> L.LexResult:
  L.LexHostFault{value, original}

def punct(code: U32) -> L.LexTok:
  L.Punctuation{code}

def str_tok(units: List<U32>, original: List<U32>) -> L.LexTok:
  L.StrTok{units, original}

def num_tok(original: List<U32>) -> L.LexTok:
  L.NumTok{original}

def lit_tok(name: String, original: List<U32>) -> L.LexTok:
  L.LitTok{name, original}

def cases() -> List<List<U32> & L.LexResult & String>:
  [
    ([], toks([], []), "empty-input"),
    ([32, 9, 10, 13], toks([], [32, 9, 10, 13]), "whitespace-only"),
    ([32, 123, 9, 125, 10, 91, 13, 93, 32, 58, 44],
      toks([punct(123), punct(125), punct(91), punct(93), punct(58), punct(44)],
        [32, 123, 9, 125, 10, 91, 13, 93, 32, 58, 44]),
      "all-punctuation-bytes-in-order"),
    ([116, 114, 117, 101], toks([lit_tok("true", [116, 114, 117, 101])], [116, 114, 117, 101]),
      "literal-true"),
    ([102, 97, 108, 115, 101],
      toks([lit_tok("false", [102, 97, 108, 115, 101])], [102, 97, 108, 115, 101]),
      "literal-false"),
    ([110, 117, 108, 108], toks([lit_tok("null", [110, 117, 108, 108])], [110, 117, 108, 108]),
      "literal-null"),
    ([116, 114, 117, 101, 120], refused("unrecognized_atom", [116, 114, 117, 101, 120]),
      "literal-prefix-longer-word-refused"),
    ([49, 50, 51], toks([num_tok([49, 50, 51])], [49, 50, 51]), "number-lexeme-retained"),
    ([45, 48], toks([num_tok([45, 48])], [45, 48]), "negative-zero-lexeme-retained"),
    ([49, 46, 53, 101, 43, 55], toks([num_tok([49, 46, 53, 101, 43, 55])], [49, 46, 53, 101, 43, 55]),
      "exponent-spelling-retained"),
    ([52, 53, 48, 51, 53, 57, 57, 54, 50, 55, 51, 55, 48, 52, 57, 54],
      toks([num_tok([52, 53, 48, 51, 53, 57, 57, 54, 50, 55, 51, 55, 48, 52, 57, 54])],
        [52, 53, 48, 51, 53, 57, 57, 54, 50, 55, 51, 55, 48, 52, 57, 54]),
      "integer-beyond-two-to-fifty-three-retained"),
    ([48, 49], refused("leading_zero", [48, 49]), "leading-zero-refused"),
    ([49, 46], refused("expected_fraction_digit", [49, 46]), "incomplete-fraction-refused"),
    ([49, 101], refused("expected_exponent_digit", [49, 101]), "incomplete-exponent-refused"),
    ([49, 120], refused("trailing_data", [49, 120]), "numeric-suffix-refused"),
    ([45], refused("expected_digit", [45]), "minus-only-refused"),
    ([34, 97, 34], toks([str_tok([97], [34, 97, 34])], [34, 97, 34]), "string-unit-a"),
    ([34, 92, 34, 34], toks([str_tok([34], [34, 92, 34, 34])], [34, 92, 34, 34]),
      "string-escaped-quote-decoded"),
    ([34, 92, 92, 34], toks([str_tok([92], [34, 92, 92, 34])], [34, 92, 92, 34]),
      "string-escaped-backslash-decoded"),
    ([34, 123, 125, 91, 93, 44, 34],
      toks([str_tok([123, 125, 91, 93, 44], [34, 123, 125, 91, 93, 44, 34])],
        [34, 123, 125, 91, 93, 44, 34]),
      "structural-bytes-inside-string"),
    ([34, 92, 117, 48, 48, 52, 49, 34], toks([str_tok([65], [34, 92, 117, 48, 48, 52, 49, 34])],
      [34, 92, 117, 48, 48, 52, 49, 34]),
      "unicode-escape-decoded"),
    ([34, 0, 34], refused("raw_control", [34, 0, 34]), "raw-nul-inside-string-refused"),
    ([34, 92, 120, 34], refused("invalid_escape", [34, 92, 120, 34]), "invalid-escape-refused"),
    ([34, 97], refused("unterminated_string", [34, 97]), "unterminated-string-refused"),
    ([34, 92, 92, 92, 34], refused("unterminated_string", [34, 92, 92, 92, 34]),
      "odd-backslashes-escape-the-close"),
    ([34, 92, 92, 92, 92, 34], toks([str_tok([92, 92], [34, 92, 92, 92, 92, 34])],
      [34, 92, 92, 92, 92, 34]),
      "even-backslashes-close-the-token"),
    ([34, 240, 128, 128, 128, 34], refused("overlong_utf8", [34, 240, 128, 128, 128, 34]),
      "four-byte-overlong-refused"),
    ([97], refused("unrecognized_atom", [97]), "bare-atom-refused"),
    ([49, 32, 50], toks([num_tok([49]), num_tok([50])], [49, 32, 50]),
      "multiple-top-level-scalars-tokenization-only"),
    ([123, 125], toks([punct(123), punct(125)], [123, 125]),
      "unmatched-punctuation-tokenization-only"),
    ([34, 97, 34, 44, 34, 98, 34],
      toks([str_tok([97], [34, 97, 34]), punct(44), str_tok([98], [34, 98, 34])],
        [34, 97, 34, 44, 34, 98, 34]),
      "string-punctuation-string-order"),
    ([34, 97, 34, 49], toks([str_tok([97], [34, 97, 34]), num_tok([49])], [34, 97, 34, 49]),
      "string-then-number-order"),
    ([256], fault(256, [256]), "host-fault-first-byte"),
    ([34, 97, 34, 256], fault(256, [34, 97, 34, 256]), "host-fault-after-closed-token"),
    ([97, 256], fault(256, [97, 256]), "host-fault-after-early-bad-atom"),
    ([300, 256], fault(300, [300, 256]), "first-competing-host-fault"),
    ([49, 256, 48], fault(256, [49, 256, 48]), "host-fault-inside-number-atom"),
  ]

def unequal_pairs() -> List<L.LexResult & L.LexResult & String>:
  [
    (toks([punct(44)], [44]), toks([punct(58)], [58]), "comparator-token-code"),
    (toks([punct(44), punct(58)], [44, 58]), toks([punct(58), punct(44)], [58, 44]),
      "comparator-token-order"),
    (toks([str_tok([97], [34, 97, 34])], [34, 97, 34]),
      toks([str_tok([98], [34, 97, 34])], [34, 97, 34]), "comparator-token-payload"),
    (toks([num_tok([49])], [49]), toks([num_tok([50])], [50]), "comparator-number-lexeme"),
    (toks([lit_tok("true", [116, 114, 117, 101])], [116, 114, 117, 101]),
      toks([lit_tok("null", [116, 114, 117, 101])], [116, 114, 117, 101]),
      "comparator-literal-name"),
    (toks([punct(44)], [44]), toks([punct(44)], [44, 32]), "comparator-original-length"),
    (toks([punct(44)], [44]), toks([punct(44)], [58]), "comparator-original-bytes"),
    (toks([], []), refused("unrecognized_atom", []), "comparator-disposition"),
    (toks([punct(44)], [44]), toks([], [44]), "comparator-token-count"),
    (refused("unrecognized_atom", [97]), refused("leading_zero", [97]), "comparator-refusal-reason"),
    (refused("unrecognized_atom", [97]), refused("unrecognized_atom", [98]),
      "comparator-refusal-original"),
    (unsupported("first_reason", [1]), unsupported("second_reason", [1]),
      "comparator-unsupported-reason"),
    (unsupported("first_reason", [1]), unsupported("first_reason", [2]),
      "comparator-unsupported-original"),
    (fault(256, [256]), fault(255, [255]), "comparator-host-fault-value"),
    (fault(256, [256]), fault(256, [256, 32]), "comparator-host-fault-original"),
    (fault(256, [256]), refused("unrecognized_atom", [256]), "comparator-host-fault-disposition"),
  ]

def judge(actual: L.LexResult, expected: L.LexResult, name: String) -> IO(Unit):
  +verdict = same_result(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_unequal(left: L.LexResult, right: L.LexResult, name: String) -> IO(Unit):
  +verdict = same_result(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def check(case: List<U32> & L.LexResult & String) -> IO(Unit):
  (octets, expected, name) = case
  judge(L.lex(octets), expected, name)

def check_pair(pair: L.LexResult & L.LexResult & String) -> IO(Unit):
  (left, right, name) = pair
  judge_unequal(left, right, name)

def run(rows: List<List<U32> & L.LexResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check(h)
        run(t)

def run_pairs(rows: List<L.LexResult & L.LexResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_pair(h)
        run_pairs(t)

def main() -> IO(Unit):
  do IO<Unit>:
    all : Unit <- run(cases())
    pairs : Unit <- run_pairs(unequal_pairs())
    IO.pure(Unit, Unit{})
