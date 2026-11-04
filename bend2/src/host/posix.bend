import Base

def HostPosix.pid() -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.uid() -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.sid() -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.cwd() -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.self_exe() -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.now_ns() -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.monotonic_ns() -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.starttime(pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.alive(pid: U32, start: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.signal_pid(pid: U32, signal: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.signal_group(pid: U32, signal: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.lock_open(path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.lock_acquire(path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.lock_try(path: String) -> IO(Result<&1,&1,U32 & String,Maybe<&2,U32>>):
  import "./posix.c"

def HostPosix.lock_fd_acquire(fd: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.lock_release(fd: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.close_fd(fd: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.dup_to(fd: U32, target: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.held(path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.create_locked(path: String, bytes: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.spawn_detached(argv: String, first: U32, second: U32, environment: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.spawn_detached_identity(argv: String, first: U32, second: U32, environment: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.spawn_held(argv: String, cwd: String, stdout: String, stderr: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.start(gate: U32, status: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.try_wait(attempt: String, pid: U32, start: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.wait_supervisor(pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.wait_pid(pid: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.watch_signals() -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.restore_signals() -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.pending_signal() -> IO(Result<&1,&1,U32 & String,U32>):
  import "./posix.c"

def HostPosix.children_peak() -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.set_env(name: String, value: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.write_stderr(value: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.platform() -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.meminfo() -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.session_kb(pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.lock_shared_try(path: String) -> IO(Result<&1,&1,U32 & String,Maybe<&2,U32>>):
  import "./posix.c"

def HostPosix.now_seconds() -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"

def HostPosix.mkdir_sticky(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./posix.c"

def HostPosix.exclusive_lock_pid(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./posix.c"
