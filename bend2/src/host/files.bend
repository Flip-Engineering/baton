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
# order with no ordering promise: consumers sort before comparing. Exactly
# the two pseudo-entries "." and ".." are excluded; every dot-prefixed
# name passes. The join is NUL because entry names may contain newlines. A
# directory that cannot be opened keeps its cause, so an empty listing
# stays distinguishable from a missing directory.
# Names are bytes in the host and Strings in Bend2: a name that is not
# valid UTF-8 decodes with replacement characters at this boundary, so a
# manifest walk comparing names must treat non-UTF-8 names as outside
# its contract rather than as different files.

def Files.entries(directory: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# What the path names when opened: file, dir, or other for anything else.
# The lookup follows symlinks, so a broken link keeps its ENOENT cause.

def Files.kind(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# The path's own type without following symlinks: file, dir, link for a
# symlink, or other for anything else. A broken link answers link rather
# than an error, which is the point: a walk classifying entries needs
# the link as a link. Matches the published Dirent semantics the module
# runner was written against.
def Files.kind_link(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# The permission bits of what the path names when opened, as octal text
# with no leading zero: 644, 755, 0. A path that cannot be stat'd keeps
# its cause.
def Files.mode(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# Whether this user may execute the path: 1 or 0. A refusal to check is
# not a no: a missing path keeps its ENOENT cause, so a consumer can
# distinguish an absent tool from one it may not run.
def Files.executable(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# Copies one regular file's bytes and permission bits. The source must
# exist and must be a regular file: a directory source is refused EISDIR
# and any other non-regular source EINVAL, before the destination is
# touched. A source and destination naming the same file (same path,
# hardlink or symlink alias) are refused EINVAL before any truncation, so
# a refused copy preserves both sides' bytes and mode. A destination
# directory that cannot be opened for writing keeps its cause.
def Files.copy(from: String, to: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./files.c"

# The first PATH entry naming an executable regular file of this name,
# answered as the joined directory path with no canonicalization. An
# empty answer names the variable: no PATH entry carries the name at
# all. A name that is present but not executable by this user is a
# refusal EACCES, so an absent tool stays distinguishable from a broken
# installation.
def Files.which(name: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"

# The SHA-256 of the file's bytes, streamed: 64 lowercase hex digits.
# A path that cannot be opened or read keeps its cause. The compression
# core is the role identity digest's, shared through host/sha256.h.
def Files.digest(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./files.c"
