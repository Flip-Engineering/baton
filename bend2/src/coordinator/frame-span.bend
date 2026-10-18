import Base
import ../host/text.bend as T
import ../json/canonical.bend as J
import ../git/text.bend as Tx

# A frame either arrives as text or as a byte range in the immutable retained
# stdout spool. A span token names the spool and the range. Kept in one string
# so held frame state and checkpoints carry it unchanged; the token holds no
# tab or newline, and no JSON line holds a raw unit separator.
#
# The token layout is
#
#   US spool US offset ":" length
#
# where US is the unit separator (U+001E).
#
# The token avoids the default-level receive path materializing a cumulative
# provider snapshot as a Bend String. Reads and SQL binding use the spool range;
# a write copies the range to the log without a String.

type FrameSpan is Data:
  FrameSpan{spool: String, offset: String, length: String}

def mark() -> Char:
  Char.from_u32(30)

def colon() -> Char:
  Char.from_u32(58)

def token_of(+spool: String, +offset: String, +length: String) -> String:
  SCon{mark(), spool ++ SCon{mark(), offset ++ ":" ++ length}}

def is_digit(c: Char) -> Bool:
  +code = J.cp(c)
  Bool.and(U32.is_lt(47,code),U32.is_lt(code,58))

def digits_tail(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{c, rest}: Bool.and(is_digit(c),digits_tail(rest))

def digits(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{c, rest}: Bool.and(is_digit(c),digits_tail(rest))

# The token has three unit-separated parts; the range part has two
# colon-separated decimal fields. A malformed token is a text frame; the native
# SQLite and file effects reject a range outside the spool.
def span_range_fields(spool: String, +offset: String, +length: String) -> Maybe<FrameSpan>:
  Bool.pick(Maybe<FrameSpan>,Bool.and(digits(offset),digits(length)),Some{FrameSpan{spool,offset,length}},None{})

def span_range(spool: String, parts: List<&2,String>) -> Maybe<FrameSpan>:
  match parts:
    case offset <> length <> Nil{}: span_range_fields(spool,offset,length)
    case other: None{}

def span_parts(parts: List<&2,String>) -> Maybe<FrameSpan>:
  match parts:
    case first <> spool <> tail <> Nil{}:
      Bool.pick(Maybe<FrameSpan>,String.is_empty(first),span_range(spool,String.split(tail,colon())),None{})
    case other: None{}

def span_of(frame: String) -> Maybe<FrameSpan>:
  span_parts(String.split(frame,mark()))

def spool(span: FrameSpan) -> String:
  match span:
    case FrameSpan{spool,offset,length}: spool

def offset(span: FrameSpan) -> String:
  match span:
    case FrameSpan{spool,offset,length}: offset

def length(span: FrameSpan) -> String:
  match span:
    case FrameSpan{spool,offset,length}: length


# One consumed frame line in the form its consumer handles. The text case is
# direct-mode provider text; the span case names the expected attempt spool;
# the invalid case is a malformed or foreign token observed in spanned mode
# and is an observation error, never provider text.
type FrameDecoded is Data:
  TextFrame{line: String}
  SpanFrame{spool: String, offset: String, length: String}
  InvalidFrame{line: String}

def decode_expected(span: Maybe<FrameSpan>, +expected: String, +frame: String) -> FrameDecoded:
  match span:
    case None{}: InvalidFrame{frame}
    case Some{FrameSpan{spool,offset,length}}:
      path = expected
      +same = String.eq(spool,expected)
      Bool.pick(FrameDecoded,same,SpanFrame{path,offset,length},InvalidFrame{frame})

# Decode one consumed frame line. Direct mode never parses provider text as
# a token; spanned mode accepts only a token naming the expected attempt spool.
def decode(+frame: String, +expected: String, spanned: Bool) -> FrameDecoded:
  match spanned:
    case False{}: TextFrame{frame}
    case True{}: decode_expected(span_of(frame),expected,frame)

# The frame text, materialized only for a consumer that needs the bytes as a
# value. A text frame is returned unchanged; a span is read from its range; an
# invalid token fails instead of falling back to provider text.
def text_result_decoded(decoded: FrameDecoded) -> IO(Result<&1,&1,U32 & String,String>):
  match decoded:
    case TextFrame{line}: IO.pure(Result<&1,&1,U32 & String,String>,Done{line})
    case SpanFrame{spool,offset,length}: T.Text.read_span(spool,offset,length)
    case InvalidFrame{line}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(0,"span token is malformed or names a foreign spool")})

def text_result(+frame: String, +expected: String, spanned: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  +decoded = decode(frame,expected,spanned)
  text_result_decoded(decoded)

def is_invalid(decoded: FrameDecoded) -> Bool:
  match decoded:
    case InvalidFrame{line}: True{}
    case other: False{}

def invalid_error() -> String:
  "span token is malformed or names a foreign spool"

# The text form for text-only consumers. A span frame contributes no text: its
# bytes stay in the spool until a consumer materializes them by range.
def text_value(decoded: FrameDecoded) -> String:
  match decoded:
    case TextFrame{line}: line
    case SpanFrame{spool,offset,length}: ""
    case InvalidFrame{line}: ""

def span_value(decoded: FrameDecoded) -> Maybe<FrameSpan>:
  match decoded:
    case TextFrame{line}: None{}
    case SpanFrame{spool,offset,length}: Some{FrameSpan{spool,offset,length}}
    case InvalidFrame{line}: None{}

# Materialize one frame for a consumer that needs the bytes. Text passes
# through; a span is read by range; nothing is available for the invalid case.
def materialize(span: Maybe<FrameSpan>, +line: String) -> IO(Result<&1,&1,U32 & String,String>):
  match span:
    case None{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{line})
    case Some{frame_span}:
      match frame_span:
        case FrameSpan{spool,offset,length}: T.Text.read_span(spool,offset,length)


# Materialize a span only when a durable checkpoint must outlive its attempt
# spool. Previously materialized checkpoint text passes through unchanged.
def checkpoint_line_token(expected: String, +line: String) -> Bool:
  match line:
    case SNil{}: False{}
    case SCon{c, rest}: Bool.and(Bool.not(String.is_empty(expected)),Char.is_eq(c,mark()))

def materialize_checkpoint_decoded(decoded: FrameDecoded) -> IO(Result<&1,&1,U32 & String,String>):
  match decoded:
    case SpanFrame{spool,offset,length}: T.Text.read_span(spool,offset,length)
    case InvalidFrame{line}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(0,invalid_error())})
    case TextFrame{line}: IO.pure(Result<&1,&1,U32 & String,String>,Done{line})

def materialize_checkpoint_token(+expected: String, +line: String) -> IO(Result<&1,&1,U32 & String,String>):
  +decoded = decode(line,expected,True{})
  materialize_checkpoint_decoded(decoded)

def materialize_checkpoint(+expected: String, +line: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>),checkpoint_line_token(expected,line),
    materialize_checkpoint_token(expected,line),
    IO.pure(Result<&1,&1,U32 & String,String>,Done{line}))


def materialize_checkpoint_text_decoded(decoded: FrameDecoded) -> IO(String):
  match decoded:
    case SpanFrame{spool,offset,length}: IO.try(String,T.Text.read_span(spool,offset,length))
    case InvalidFrame{line}: IO.die(String,22,invalid_error())
    case TextFrame{line}: IO.pure(String,line)

def materialize_checkpoint_text_token(+expected: String, +line: String) -> IO(String):
  +decoded = decode(line,expected,True{})
  materialize_checkpoint_text_decoded(decoded)

def materialize_checkpoint_text(+expected: String, +line: String) -> IO(String):
  Bool.pick(IO(String),checkpoint_line_token(expected,line),
    materialize_checkpoint_text_token(expected,line),
    IO.pure(String,line))
