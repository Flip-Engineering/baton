import Base

# SHA-256 of the complete string bytes, including embedded NUL bytes.
def HostDigest.text(value: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./digest.c"

# SHA-256 of the file bytes, read through one fixed-size buffer.
def HostDigest.file(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./digest.c"
