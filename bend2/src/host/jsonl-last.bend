import Base

# Scans a UTF-8 JSONL file backward from its size at open and returns the last
# frame that holds `needle` and for which the read-only scalar SQL predicate
# returns 1, binding the frame as parameter 1. Only frames that hold `needle` are
# parsed. The read stops at that frame. No match returns an empty String. A frame
# that holds `needle` and is not valid UTF-8 JSON, a file replaced or shortened
# during the scan, or an unreadable file returns an I/O failure. Bytes appended
# after the file was opened are not read.
def Jsonl.read_last(path: String, needle: String, predicate: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./jsonl-last.c"
