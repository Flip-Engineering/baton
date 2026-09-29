# CLAIM: a U32 JSON integer token can be decoded incrementally in pure Bend2.
# Chunk exhaustion preserves parser state. Explicit EOF validates the token.
# Overflow is rejected before multiplication or addition can wrap.
# Scope: one unsigned decimal token with JSON whitespace; see the evidence file.
# Pin: ../reference/README.md, bend 2.0.25, a4952426.
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

def main() -> String:
  result_text(finish(feed("4967295", feed("429", UintStart{}))))
