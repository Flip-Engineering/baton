import Base

# Host boundary for the Bend2 compile queue. Each function names one C effect
# in compile-queue-lifecycle.c. The module name and function name form the
# effect identifier, for example lock_acquire is
# CID_COMPILEQUEUELIFECYCLE_LOCK_ACQUIRE.

# The running queue executable, resolved from /proc/self/exe or the platform
# equivalent. The supervisor and guard re-exec this path.
def CompileQueueLifecycle.self_exe() -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.pid() -> IO(Result<&1,&1,U32 & String,U32>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.uid() -> IO(Result<&1,&1,U32 & String,U32>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.cwd() -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.now_ns() -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.monotonic_ns() -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.starttime(pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.alive(pid: U32, start: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.watch_heavy(attempt: String, pid: U32, start: String, fd: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.wait_external(pid: U32, start: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.signal_group(pid: U32, sig: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.signal_pid(pid: U32, sig: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

# Opens a lock file without acquiring it. The descriptor crosses into a
# detached supervisor or guard as descriptor 8 (heavy) or 9 (key). The
# descriptor is inheritable so the flock open-file description survives exec.
def CompileQueueLifecycle.lock_open(path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./compile-queue-lifecycle.c"

# Blocking flock(LOCK_EX) exclusive lock on a path.
def CompileQueueLifecycle.lock_acquire(path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./compile-queue-lifecycle.c"

# Non-blocking flock(LOCK_EX|LOCK_NB) exclusive lock on a path.
def CompileQueueLifecycle.lock_try(path: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32>>):
  import "./compile-queue-lifecycle.c"

# Blocking flock(LOCK_EX) on an inherited descriptor. The lock belongs to the
# open file description, so a supervisor and its requester share it.
def CompileQueueLifecycle.lock_fd_acquire(fd: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.lock_release(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

# Closes one descriptor without changing the shared lock state. A parent uses
# this after a detached supervisor inherits the lock open file description.
def CompileQueueLifecycle.close_fd(fd: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.mkdir_p(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.write_text(path: String, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"
def CompileQueueLifecycle.write_stderr(text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.set_env(name: String, value: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"


def CompileQueueLifecycle.read_text(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.list_dir(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.remove(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.remove_tree(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.copy_file(source: String, destination: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.sleep_millis(millis: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./compile-queue-lifecycle.c"

# argv is the NUL-terminated argument string used by host/process.bend. The
# child starts in a new session through setsid(2), inherits key_lock as
# descriptor 9 and heavy_lock as descriptor 8, and has stdin/stdout/stderr on
# /dev/null. The parent receives the child pid after descriptor transfer.
def CompileQueueLifecycle.spawn_detached(argv: String, key_lock: U32, heavy_lock: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.wait_pid(pid: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./compile-queue-lifecycle.c"

# Runs one command in cwd with stdout and stderr appended to the named files.
# The child owns a separate process group. TERM, INT and HUP are forwarded to
# that group. The answer is (exit code, "exit" | "signal" | "canceled").
def CompileQueueLifecycle.run_command(argv: String, cwd: String, stdout_path: String, stderr_path: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.cmdline(pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.environ(pid: U32, name: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-lifecycle.c"

def CompileQueueLifecycle.cwd_of_pid(pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./compile-queue-lifecycle.c"
