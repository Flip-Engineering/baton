import Base

# The resolved absolute path from realpath(3).
def Files.realpath(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# The uninterpreted target of one symbolic link.
def Files.readlink(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

def Files.executable(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

# A block of UTF-8 text and its next decimal byte position. Reads up to 64 KiB
# plus the bytes that complete its final character. An empty block reports EOF.
def Files.text_chunk(path: String, position: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  import "./files.c"

# One lstat observation: kind, mode, device, inode, bytes, modification seconds,
# uid and gid, separated by tabs.
def Files.lstat(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# Creates one directory with group-write mode under umask 0007.
# EEXIST remains an error for the caller to inspect.
def Files.mkdir_shared(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

def Files.mkdir_mode(path: String, mode: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

def Files.chmod(path: String, mode: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

def Files.rmdir(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

def Files.symlink(target: String, path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

# Copies one regular file and retains its permission bits.
def Files.copy_file(source: String, path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

# Atomically publishes the complete bytes with shared file mode 0660.
def Files.write_shared(path: String, value: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

# File size, presence of NUL, and the first four bytes as hexadecimal text.
def Files.byte_properties(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# rename(2) with every failure preserved.
def Files.move(source: String, path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

# Creates one directory. An existing directory succeeds.
def Files.mkdir(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

# Reports whether this process can write the path. The check opens no file and
# writes no probe, so it leaves existing contents and symlinks untouched.
def Files.writable(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

def Files.find_suffix(directory: String, suffix: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# The file's byte size, or zero when it does not exist.
def Files.size(path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./files.c"

# The file mode bits, or the stat error as a failure.
def Files.mode_of(path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./files.c"

# Connects to the Unix socket at path and closes the connection. Done when a
# process accepts the connect; otherwise the connect error, such as
# ECONNREFUSED for a socket file no process listens on, ENOENT for a missing
# path, or ECONNREFUSED/ENOTSOCK for a regular file. The connect runs in the
# socket's directory, so the full path may be longer than a socket address.
def Files.listening(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

# Creates one owner-only regular file with O_EXCL and no symlink follow. An
# existing path is a failure; the caller chooses a fresh path.
def Files.write_private(path: String, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
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

def Files.stat(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"
