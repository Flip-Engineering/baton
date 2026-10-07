import Base

def Files.find_suffix(directory: String, suffix: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# The file's byte size, or zero when it does not exist.
def Files.size(path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./files.c"

# Moves one log file onto another name. A source that does not exist is a no-op.
def Files.rename(from: String, to: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

# The numbered segment indices beside one log, sorted, one per line.
def Files.segments(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# Removes one log file. A path that does not exist is a no-op.
def Files.remove(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

# Removes one regular diagnostic file from a settled attempt beside its database.
# The helper rejects symlinked directories, escaped paths and non-regular files.
def Files.remove_attempt_file(database: String, directory: String, name: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# Reports whether a path names a regular file without following a symlink.
def Files.regular(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"
