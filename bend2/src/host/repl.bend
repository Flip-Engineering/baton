import Base

# One complete authored UTF-8 line, including its terminating newline.
def ReplHost.line() -> IO(Result<&1,&1,U32 & String,Maybe<String>>):
  import "../context/raw.c"

# Retain the complete stdout bytes before custody acknowledges its spool.
def ReplHost.preserve_output(directory: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./repl.c"
