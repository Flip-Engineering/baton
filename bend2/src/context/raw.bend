# CLAIM: the context raw reader decides on the input's bytes before the runtime's
# lossy `io_str` conversion can see them. `Raw.read_utf8` reads a file or stdin
# without a size cutoff, refuses invalid RFC 3629 UTF-8, a decoded NUL and a
# leading BOM with their own conditions and byte offsets, and returns the decoded
# text only for a fully valid input.
# Serves: docs/bend2/semantic-context-spec.md, `Request.read_utf8`.
# Fixture: bend2/test/context-codec.py writes real byte files and reads this pair.
import Base

# The reader's answer. A refusal is an answer about the input, so it is Done here;
# only a host failure (missing file, I/O error) is Fail on the Result.
type RawRead is Data:
  RawText{value: String}
  RawInvalidUtf8{offset: String}
  RawNul{offset: String}
  RawBom{}

def Raw.read_utf8(path: String) -> IO(Result<&1,&1,U32 & String,RawRead>):
  import "./raw.c"
