# CLAIM: a U32 JSON integer token can be decoded incrementally in pure Bend2: chunk
# exhaustion preserves parser state, explicit EOF validates the token, and overflow is
# rejected before multiplication or addition can wrap. Scope: one unsigned decimal token
# with JSON whitespace; rejection keeps the first reason across later chunks.
# Serves: LANG-CAP-06 (B2-JSON), decoder slice.
# Fixture: inline corpus (def fixtures()); no external file. The 35 fixtures and their
# classifications are the corpus of the docs driver
# docs/bend2/examples/b2-json-uint-check.py — 11 accepted cases with their integer values
# and 24 rejected cases with their named reasons — expanded to every two-part split
# (including the empty first and last chunks) plus the one-character-per-chunk partition
# with empty chunks at both ends, and the four pending-state observations before EOF:
# 233 checks, one printed line each.
# Pin: bend 2.0.25, bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868.
# Promoted from: docs/bend2/examples/b2-json-uint-decoder.bend — the decision code below
# is that prototype byte-identical, and the corpus with its measured verdict is recorded
# in docs/bend2/examples/b2-json-uint-decoder.evidence.md.

import Base

type UintInput is Data:
  UintDigit{value: U32}
  UintSpace{}
  UintOther{}

type UintState is Data:
  UintStart{}
  UintZero{}
  UintDigits{value: U32}
  UintTrailing{value: U32}
  UintRejected{reason: String}

type UintResult is Data:
  UintAccepted{value: U32}
  UintRefused{reason: String}

def is_space(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(code, 32), True{},
    Bool.pick(Bool, U32.is_eq(code, 9), True{},
      Bool.pick(Bool, U32.is_eq(code, 10), True{}, U32.is_eq(code, 13))))

def classify(+code: U32) -> UintInput:
  Bool.pick(UintInput, U32.is_lt(code, 48),
    Bool.pick(UintInput, is_space(code), UintSpace{}, UintOther{}),
    Bool.pick(UintInput, U32.is_lt(code, 58), UintDigit{U32.sub(code, 48)}, UintOther{}))

def begin(input: UintInput) -> UintState:
  match input:
    case UintDigit{+value}: Bool.pick(UintState, U32.is_eq(value, 0), UintZero{}, UintDigits{value})
    case UintSpace{}: UintStart{}
    case UintOther{}: UintRejected{"expected_digit"}

def after_zero(input: UintInput) -> UintState:
  match input:
    case UintDigit{+value}: UintRejected{"leading_zero"}
    case UintSpace{}: UintTrailing{0}
    case UintOther{}: UintRejected{"invalid_character"}

# 4294967295 = 429496729 * 10 + 5. The predicate precedes arithmetic.
def append_checked(value: U32, digit: U32, fits: Bool) -> UintState:
  match fits:
    case True{}: UintDigits{U32.add(U32.mul(value, 10), digit)}
    case False{}: UintRejected{"u32_overflow"}

def append_digit(+value: U32, +digit: U32) -> UintState:
  append_checked(value, digit,
    Bool.pick(Bool, U32.is_lt(value, 429496729), True{},
      Bool.pick(Bool, U32.is_eq(value, 429496729), U32.is_lt(digit, 6), False{})))

def after_digits(value: U32, input: UintInput) -> UintState:
  match input:
    case UintDigit{digit}: append_digit(value, digit)
    case UintSpace{}: UintTrailing{value}
    case UintOther{}: UintRejected{"invalid_character"}

def after_space(value: U32, input: UintInput) -> UintState:
  match input:
    case UintDigit{+digit}: UintRejected{"trailing_data"}
    case UintSpace{}: UintTrailing{value}
    case UintOther{}: UintRejected{"trailing_data"}

def step(state: UintState, input: UintInput) -> UintState:
  match state:
    case UintStart{}: begin(input)
    case UintZero{}: after_zero(input)
    case UintDigits{value}: after_digits(value, input)
    case UintTrailing{value}: after_space(value, input)
    case UintRejected{reason}: UintRejected{reason}

def feed(chunk: String, state: UintState) -> UintState:
  match chunk:
    case SNil{}: state
    case SCon{head, tail}: feed(tail, step(state, classify(Char.to_u32(head))))

def finish(state: UintState) -> UintResult:
  match state:
    case UintStart{}: UintRefused{"expected_digit"}
    case UintZero{}: UintAccepted{0}
    case UintDigits{value}: UintAccepted{value}
    case UintTrailing{value}: UintAccepted{value}
    case UintRejected{reason}: UintRefused{reason}

def result_text(result: UintResult) -> String:
  match result:
    case UintAccepted{value}: "accepted:" ++ U32.show(value)
    case UintRefused{reason}: "refused:" ++ reason

def state_text(state: UintState) -> String:
  match state:
    case UintStart{}: "pending:start"
    case UintZero{}: "pending:zero"
    case UintDigits{value}: "pending:digits:" ++ U32.show(value)
    case UintTrailing{value}: "pending:trailing:" ++ U32.show(value)
    case UintRejected{reason}: "refused:" ++ reason

# The corpus expansion. A fixture is a code-point list; text_of renders it as the String
# the decoder reads. Every two-part split includes the empty first and last chunks, and
# the last partition of each fixture carries one character per chunk with empty chunks at
# both ends — the expansion docs/bend2/examples/b2-json-uint-check.py performs.

def text_of(xs: List<U32>) -> String:
  match xs:
    case Nil{}: SNil{}
    case h <> t: SCon{Char.from_u32(h), text_of(t)}

def singles_of(text: String) -> List<String>:
  match text:
    case SNil{}: Nil{}
    case SCon{h, t}: SCon{h, SNil{}} <> singles_of(t)

def cat_list(xs: List<String>, ys: List<String>) -> List<String>:
  match xs:
    case Nil{}: ys
    case h <> t: h <> cat_list(t, ys)

def cat_cases(xs: List<List<String>>, ys: List<List<String>>) -> List<List<String>>:
  match xs:
    case Nil{}: ys
    case h <> t: h <> cat_cases(t, ys)

# The two-part splits. prefix carries the consumed head characters; each level emits the
# boundary case [prefix, text] — the split at that boundary — and recurses into the tail,
# so the boundaries run from the empty-first-chunk split to the [whole, ""] split the
# exhausted text yields.
def split_case(a: String, b: String) -> List<List<String>>:
  [[a, b]]

def splits_go(text: String, +prefix: String) -> List<List<String>>:
  match text:
    case SNil{}: [[prefix, SNil{}]]
    case SCon{+h, +t}:
      cat_cases(split_case(prefix, text), splits_go(t, prefix ++ SCon{h, SNil{}}))

def one_char_partition(text: String) -> List<String>:
  cat_list([SNil{}], cat_list(singles_of(text), [SNil{}]))

def cases_of(+text: String) -> List<List<String>>:
  cat_cases(splits_go(text, SNil{}), [one_char_partition(text)])

def all_cases(rows: List<List<U32>>) -> List<List<String>>:
  match rows:
    case Nil{}: Nil{}
    case h <> t: cat_cases(cases_of(text_of(h)), all_cases(t))

# The frozen corpus of docs/bend2/examples/b2-json-uint-check.py, in its order:
# eleven accepted fixtures, then twenty-four rejected ones, each as a code-point
# list; the line comment names the classification the driver asserts for it.
def fixtures() -> List<List<U32>>:
  [
    [48],  # accepted:0
    [49],  # accepted:1
    [57],  # accepted:9
    [49, 48],  # accepted:10
    [52, 48, 57, 54],  # accepted:4096
    [52, 50, 57, 52, 57, 54, 55, 50, 57],  # accepted:429496729
    [52, 50, 57, 52, 57, 54, 55, 50, 57, 48],  # accepted:4294967290
    [52, 50, 57, 52, 57, 54, 55, 50, 57, 52],  # accepted:4294967294
    [52, 50, 57, 52, 57, 54, 55, 50, 57, 53],  # accepted:4294967295
    [32, 9, 13, 10, 52, 50, 10, 13, 9, 32],  # accepted:42
    [48, 32],  # accepted:0
    [],  # refused:expected_digit
    [32, 9, 13, 10],  # refused:expected_digit
    [48, 48],  # refused:leading_zero
    [48, 49],  # refused:leading_zero
    [48, 32, 49],  # refused:trailing_data
    [49, 32, 50],  # refused:trailing_data
    [52, 50, 57, 52, 57, 54, 55, 50, 57, 54],  # refused:u32_overflow
    [52, 50, 57, 52, 57, 54, 55, 51, 48, 48],  # refused:u32_overflow
    [57, 57, 57, 57, 57, 57, 57, 57, 57, 57],  # refused:u32_overflow
    [52, 50, 57, 52, 57, 54, 55, 50, 57, 53, 48],  # refused:u32_overflow
    [45, 49],  # refused:expected_digit
    [43, 49],  # refused:expected_digit
    [49, 46, 48],  # refused:invalid_character
    [49, 101, 50],  # refused:invalid_character
    [48, 120, 49, 48],  # refused:invalid_character
    [49, 44],  # refused:invalid_character
    [49, 0],  # refused:invalid_character
    [11, 49],  # refused:expected_digit
    [49, 12],  # refused:invalid_character
    [160, 49],  # refused:expected_digit
    [1633],  # refused:expected_digit
    [49, 65297],  # refused:invalid_character
    [49, 32, 116, 114, 117, 101],  # refused:trailing_data
    [52, 50, 57, 52, 57, 54, 55, 50, 57, 54, 120],  # refused:u32_overflow
  ]

def chunks(parts: List<String>, state: UintState) -> UintState:
  match parts:
    case Nil{}: state
    case h <> t: chunks(t, feed(h, state))

def run(rows: List<List<String>>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(result_text(finish(chunks(h, UintStart{}))))
        run(t)

def main() -> IO(Unit):
  do IO<Unit>:
    a : Unit <- IO.print(state_text(feed("", UintStart{})))
    b : Unit <- IO.print(state_text(feed("0", UintStart{})))
    c : Unit <- IO.print(state_text(feed("429", UintStart{})))
    d : Unit <- IO.print(state_text(feed("42 ", UintStart{})))
    run(all_cases(fixtures()))
