import Base

# Reports whether one document is valid JSON. The linked SQLite reader performs
# the check; the caller decides what an invalid document means.
def Json.valid(text: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./credit-transport.c"
