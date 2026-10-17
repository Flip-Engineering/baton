import Base

# Atomically replaces the latest incomplete frames. An empty value removes the checkpoint.
def LogCheckpoint.save(path: String, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./log-checkpoint.c"
