import Base

# Host evidence for the storage policy. Every function returns a text record
# the Bend modules parse; classification and decisions stay in Bend2.

# One path observation: `kind<TAB>device<TAB>inode<TAB>bytes`. Kind is
# `missing`, `file`, `dir`, `symlink` or `other`. Parent components are opened
# without following symlinks, so a path reached through a link is an ELOOP
# failure rather than the target's identity. The final component is observed
# with lstat semantics.
def StorageHost.observe(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# The recursive byte and node count of a path without following symlinks:
# `bytes<TAB>nodes<TAB>other`. A missing path is `0<TAB>0<TAB>0`.
def StorageHost.measure(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Immediate children of a directory as NUL-terminated `kind<TAB>name` records.
# The directory is opened without following a symlink; a missing directory
# answers no records.
def StorageHost.entries(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Removes exactly the path whose identity is `kind:device:inode`. The answer is
# `removed<TAB>bytes<TAB>nodes`, `already-absent<TAB>0<TAB>0`,
# `changed<TAB>0<TAB>0` or `refused<TAB>detail`. Directories are removed as a
# tree through directory handles opened with O_NOFOLLOW; symlink entries are
# unlinked and never traversed. A path reached through a symlinked parent is
# refused.
def StorageHost.remove(path: String, identity: String, root: String, root_identity: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Cargo cache-tag and native lock-layout observation:
# `cargo<TAB>dir:device:inode<TAB>tag|layout`, or `unclassified`.
def StorageHost.cargo_probe(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Revalidates Cargo output and its identity, acquires every native profile
# lock without waiting, and holds the locks through rename and removal.
# Associated names the effective build directory when it differs from path.
# The caller holds its producer boundary and resolves current selections.
def StorageHost.cargo_remove(path: String, identity: String, associated: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Live process descriptor references to a path, comma-separated PIDs. This is
# the open-file half of runtime input; process_refs covers cwd.
def StorageHost.runtime_refs(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Live process cwd references to a path, comma-separated PIDs, or an empty
# string. The scan is bounded and ignores processes it cannot inspect.
def StorageHost.process_refs(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# 1 while the PID exists or belongs to another user, 0 when it is gone.
def StorageHost.pid_alive(pid: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./storage.c"
