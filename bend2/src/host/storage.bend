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

# `own` when PATH and every descendant belong to the caller's effective uid,
# `foreign:<name>` when another uid owns an entry below it, `unknown` when the
# tree cannot be read. A foreign uid preserves the candidate because the host
# process scan may be unable to observe that identity's live references.
def StorageHost.uid_boundary(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Removes exactly the path whose identity is `kind:device:inode`. The answer is
# `removed<TAB>bytes<TAB>nodes`, `already-absent<TAB>0<TAB>0`,
# `changed<TAB>0<TAB>0` or `refused<TAB>detail`. Directories are removed as a
# tree through directory handles opened with O_NOFOLLOW; symlink entries are
# unlinked and never traversed. A path reached through a symlinked parent is
# refused. The candidate root itself and every walked child are checked for
# mount identity: a same-device bind mount and an unverifiable mount identity
# both preserve the whole subtree before any deletion.
def StorageHost.remove(path: String, identity: String, root: String, root_identity: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Cargo cache-tag and native lock-layout observation:
# `cargo<TAB>dir:device:inode<TAB>tag|layout`, or `unclassified`.
def StorageHost.cargo_probe(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Revalidates Cargo output and its identity, acquires every native profile
# lock without waiting, and holds the locks through rename and removal.
# Associated names the effective build directory when it differs from path.
# The caller resolves current consumers and selections; the cleanup leases
# and locks the caller's pipeline already holds stay held.
def StorageHost.cargo_remove(path: String, identity: String, associated: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Process references through cwd, executable, descriptors and mapped files:
# present:PIDS, absent, or unknown:REASON. Failed reads report their PID, path
# and error to stderr. Every observable process identity is scanned. A live
# process whose links, descriptors or mappings cannot be read (for example
# another uid's process without sufficient privilege) makes the custody
# unknown, so the candidate is preserved.
def StorageHost.runtime_refs(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# The same reference scan used for process ownership. Directory and mapping
# enumeration continues through the actual end. Unreadable live evidence
# returns unknown; an exited process has released its references. The
# all-identity scope above applies here too.
def StorageHost.process_refs(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# 1 while the PID exists or belongs to another user, 0 when it is gone.
def StorageHost.pid_alive(pid: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./storage.c"

# A shared lease on ROOT/.baton-writer-lease held for the duration of a writer
# operation. The answer is `handle:<fd>` or `none` on contention or any open or
# flock error; the Bend wrapper turns it into a handle value.
def StorageHost.writer_try_acquire(root: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# An exclusive lease on the same file. Cleanup acquires it for every configured
# root before it removes a candidate. The answer is `handle:<fd>` or `none` on
# contention or any open or flock error, and the caller refuses the apply.
def StorageHost.cleanup_try_acquire(root: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./storage.c"

# Releases a lease descriptor. Process exit releases it as well.
def StorageHost.lease_release(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./storage.c"
