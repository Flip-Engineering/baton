# The raw reader's native fixture entry. It prints one line per path argument:
# the path, the reader's classification, and - on success - the decimal code
# points of the text the runtime decoded from the validated bytes, each preceded
# by one space. A caller compares those code points against the input bytes it
# wrote, which is the only lossless comparison available: the canonical encoder's
# demo `utf8` helper has no four-byte branch and is excluded from hashes by the
# specification, so it cannot re-encode an astral code point.
#
# This entry has no expected-output file: it needs its real C host half, so
# bend2/test/context-codec.py builds and runs it natively with real byte files.
import Base
import ./raw.bend as Raw

def code_points(s: String, acc: String) -> String:
  match s:
    case SNil{}: acc
    case SCon{+head, +tail}: code_points(tail, acc ++ " " ++ U32.show(Char.to_u32(head)))

def render(r: Raw.RawRead) -> String:
  match r:
    case Raw.RawText{value}: "text" ++ code_points(value, "")
    case Raw.RawInvalidUtf8{offset}: "invalidUtf8 " ++ offset
    case Raw.RawNul{offset}: "nul " ++ offset
    case Raw.RawBom{}: "bom"

def report(path: String, result: Result<&1,&1,U32 & String,Raw.RawRead>) -> String:
  match result:
    case Done{value}: path ++ " " ++ render(value)
    case Fail{error}: path ++ " hostfail"

def walk(paths: List<String>) -> IO(Unit):
  match paths:
    case Nil{}: IO.pure(Unit, Unit{})
    case +head <> rest:
      do IO<Unit>:
        result : Result<&1,&1,U32 & String,Raw.RawRead> <- Raw.Raw.read_utf8(head)
        line : Unit <- IO.print(report(head, result))
        walk(rest)

def main() -> IO(Unit):
  do IO<Unit>:
    paths : List<String> <- IO.args()
    walk(paths)
