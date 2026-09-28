import Base

def Files.find_suffix(directory: String, suffix: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"
