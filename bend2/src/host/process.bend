# Host process effects: spawn a child process, write to its stdin, read from
# its stdout, wait for exit, send a signal, read its PID.
#
# Each effect is a C-only foreign def backed by bend2/src/host/process-spawn.c.
# The handle is a U32 index into a growable child table (malloc/realloc).
# An OS-level failure calls io_fail, which aborts the IO chain with an error.

import Base

def ProcessChild.spawn(cmd: String, args: String, cwd: String) -> IO(U32):
  import "./process-spawn.c"

def ProcessChild.write(handle: U32, data: String) -> IO(Unit):
  import "./process-spawn.c"

def ProcessChild.close_stdin(handle: U32) -> IO(Unit):
  import "./process-spawn.c"

def ProcessChild.read_line(handle: U32) -> IO(String):
  import "./process-spawn.c"

def ProcessChild.wait(handle: U32) -> IO(U32):
  import "./process-spawn.c"

def ProcessChild.signal(handle: U32, sig: U32) -> IO(Unit):
  import "./process-spawn.c"

def ProcessChild.pid(handle: U32) -> IO(U32):
  import "./process-spawn.c"

def ProcessChild.read_until_result(handle: U32) -> IO(String):
  import "./process-read-result.c"
