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

def digits(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{c, rest}: Bool.and(is_digit(c),digits(rest))

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

def found_spool(span: Maybe<FrameSpan>) -> String:
  match span:
    case None{}: ""
    case Some{frame_span}: spool(frame_span)

def found_offset(span: Maybe<FrameSpan>) -> String:
  match span:
    case None{}: ""
    case Some{frame_span}: offset(frame_span)

def found_length(span: Maybe<FrameSpan>) -> String:
  match span:
    case None{}: ""
    case Some{frame_span}: length(frame_span)

def is_span(+frame: String) -> Bool:
  Bool.not(String.is_empty(found_spool(span_of(frame))))

def spool_of(+frame: String) -> String:
  found_spool(span_of(frame))

def offset_of(+frame: String) -> String:
  found_offset(span_of(frame))

def length_of(+frame: String) -> String:
  found_length(span_of(frame))

# The frame text, materialized only for a consumer that needs the bytes as a
# value. A text frame is returned unchanged.
def text(+frame: String) -> IO(String):
  Bool.pick(IO(String),is_span(frame),
    IO.try(String,T.Text.read_span(spool_of(frame),offset_of(frame),length_of(frame))),
    IO.pure(String,frame))
