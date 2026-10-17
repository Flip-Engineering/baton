import Base

def Text.read(path: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./text.c"
  import "./text-read.js"

def Text.append(path: String, text: String) -> IO(Result<&1, &1, U32 & String, Unit>):
  import "./text.c"

# Writes UTF-8 bytes at a decimal file position and returns the next position.
# Existing equal bytes are retained. An empty position appends; finish=1 removes
# an older tail after the written bytes.
def Text.write_at(path: String, position: String, text: String, finish: U32) -> IO(Result<&1, &1, U32 & String, String>):
  import "./text.c"

def Text.control_output(text: String) -> IO(Result<&1, &1, U32 & String, Unit>):
  import "./text.c"
