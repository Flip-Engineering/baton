import Base

# The proxy inherits the receiver's current directory and recorded environment.
def CodexProxy.open() -> IO(Result<&1,&1,U32 & String,U32>):
  import "./codex-proxy.c"

def CodexProxy.send(handle: U32, raw_json: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./codex-proxy.c"

# Returns one complete UTF-8 text message with its original JSON bytes.
def CodexProxy.next(handle: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./codex-proxy.c"

# Completes the close handshake, drains stdout, and waits for the actual child.
# The result uses ProcessChild.wait's "exit N" or "signal N" representation.
def CodexProxy.close(handle: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./codex-proxy.c"

def CodexProxy.cancel(handle: U32, signal: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./codex-proxy.c"
