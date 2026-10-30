import Base

# Validates a stable UTF-8 JSONL snapshot and returns its original byte suffix
# starting at the first matching frame. The read-only scalar SQL predicate binds
# each nonempty JSON frame as parameter 1. No match returns an empty String.
# A changed file, invalid frame, raw NUL or invalid UTF-8 returns an I/O failure.
def Jsonl.read_suffix(path: String, predicate: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./jsonl.c"
