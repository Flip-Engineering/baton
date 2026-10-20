import Base

# Artifact bindings for the compile queue.
#
# `digest` hashes a regular file, or a directory as sorted
# `./relative/path <sha256>` lines over its regular files. Verification uses
# that tree digest rather than only checking that a directory exists.
#
# `copy` copies a file, directory tree or symlink to a fresh staging path.
# `install` copies to staging and then publishes it with rename. A directory
# destination is moved to `<staging>.previous`, the staged tree is renamed
# into place, and the old tree is removed after the new tree is installed. A
# failed install restores the previous destination; the destination is never
# deleted before the replacement exists.

def CompileQueueArtifact.kind(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-artifact.c"

def CompileQueueArtifact.digest(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-artifact.c"

def CompileQueueArtifact.copy(source: String, staging: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-artifact.c"

def CompileQueueArtifact.install(source: String, destination: String, staging: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-artifact.c"

def CompileQueueArtifact.remove(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-artifact.c"
