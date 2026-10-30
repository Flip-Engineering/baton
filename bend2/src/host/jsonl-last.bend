import Base

# Scans a UTF-8 JSONL file backward from its size at open and returns the last
# frame for which the read-only scalar SQL predicate returns 1, binding the frame
# as parameter 1. Only frames that hold `needle` or a `\u` escape are parsed,
# because `\u` is the one JSON escape that can spell the needle. The read stops at
# the selected frame. No match returns an empty String. A parsed frame that is not
# valid UTF-8 JSON, a file replaced or shortened during the scan, or an unreadable
# file returns an I/O failure. Bytes appended after the file was opened are not
# read.
def Jsonl.read_last(path: String, needle: String, predicate: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./jsonl-last.c"
