import Base

# Generic digest bindings for queue lifecycle records and regression checks.
# Identity effects keep the CompileQueueIdentity prefix; this module exposes
# the same portable SHA-256 implementation for callers that only need a file
# or text digest.

def CompileQueueDigest.file(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"

def CompileQueueDigest.text(text: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-digest.c"
