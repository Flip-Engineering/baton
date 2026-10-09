import Base

def Text.read(path: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./text.c"
  import "./text-read.js"

def Text.append(path: String, text: String) -> IO(Result<&1, &1, U32 & String, Unit>):
  import "./text.c"

def Text.control_output(text: String) -> IO(Result<&1, &1, U32 & String, Unit>):
  import "./text.c"
