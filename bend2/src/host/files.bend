import Base

# Creates one directory. An existing directory succeeds.
def Files.mkdir(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

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

# Reports whether a directory entry exists. Filesystem failures retain their cause.
def Files.exists(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# Every entry name in one directory, joined with one NUL each, in readdir
# order with no ordering promise: consumers sort before comparing. The
# entries named "." and ".." are excluded here; every other name passes,
# including names containing newlines, which is why the join is NUL. A
# directory that cannot be opened keeps its cause, so an empty listing
# stays distinguishable from a missing directory.
def Files.entries(directory: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# What the path names when opened: file, dir, or other for anything else.
# The lookup follows symlinks, so a broken link keeps its ENOENT cause.
def Files.kind(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"
