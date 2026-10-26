import Base
import ./posix.bend as P
import ../host/files.bend as F
import ../host/text.bend as T
import ./compile-queue-files.bend as QF
import ./compile-queue-state.bend as S
import ./compile-queue-process.bend as Proc
import ./compile-queue-artifact.bend as Artifact
import ./compile-queue-admission.bend as A
import ./compile-queue-supervisor.bend as Supervisor
import ./compile-queue-takeover.bend as Takeover

def CompileQueueLifecycle.pid() -> IO(Result<&1,&1,U32 & String,U32>):
  P.HostPosix.pid()

def CompileQueueLifecycle.cwd() -> IO(Result<&1,&1,U32 & String,String>):
  P.HostPosix.cwd()

def CompileQueueLifecycle.now_ns() -> IO(Result<&1,&1,U32 & String,String>):
  P.HostPosix.now_ns()

def CompileQueueLifecycle.starttime(pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  P.HostPosix.starttime(pid)

def CompileQueueLifecycle.alive(pid: U32, start: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.HostPosix.alive(pid,start)

def CompileQueueLifecycle.lock_open(path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.HostPosix.lock_open(path)

def CompileQueueLifecycle.lock_acquire(path: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.HostPosix.lock_acquire(path)

def CompileQueueLifecycle.admit(attempt: String, queued: String, old_pid: U32, old_start: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  A.admit(attempt,queued,old_pid,old_start)

def CompileQueueLifecycle.admit_external(keydir: String, pid: String) -> IO(Result<&1,&1,U32 & String,U32>):
  A.external(keydir,S.number(pid))

def CompileQueueLifecycle.takeover(state: String) -> IO(Result<&1,&1,U32 & String,String>):
  Takeover.run(state)

def CompileQueueLifecycle.admission_status(state: String) -> IO(Result<&1,&1,U32 & String,String>):
  A.status(state)

def CompileQueueLifecycle.lock_fd_acquire(fd: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.HostPosix.lock_fd_acquire(fd)

def CompileQueueLifecycle.lock_release(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.HostPosix.lock_release(handle)

def CompileQueueLifecycle.close_fd(fd: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.HostPosix.close_fd(fd)

def CompileQueueLifecycle.mkdir_p(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  QF.mkdir_p(path)

def CompileQueueLifecycle.write_text(path: String, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  F.Files.write_shared(path,text)

def CompileQueueLifecycle.write_bytes(path: String, bytes: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  F.Files.write_shared(path,bytes)

def CompileQueueLifecycle.group_text(text: String, roots: String) -> IO(Result<&1,&1,U32 & String,String>):
  IO.pure(Result<&1,&1,U32 & String,String>,Done{S.group_text(text,roots)})

def CompileQueueLifecycle.backfill(state: String) -> IO(Result<&1,&1,U32 & String,String>):
  A.backfill(state)

def CompileQueueLifecycle.write_stderr(text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.HostPosix.write_stderr(text)

def CompileQueueLifecycle.set_env(name: String, value: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.HostPosix.set_env(name,value)

def CompileQueueLifecycle.read_text(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  T.Text.read(path)

def CompileQueueLifecycle.list_dir(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  QF.list_dir(path)

def CompileQueueLifecycle.remove(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  F.Files.remove(path)

def CompileQueueLifecycle.remove_tree(path: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Artifact.CompileQueueArtifact.remove(path)

def CompileQueueLifecycle.copy_file(source: String, destination: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  F.Files.copy_file(source,destination)

def CompileQueueLifecycle.wait_pid(pid: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  P.HostPosix.wait_pid(pid)

def CompileQueueLifecycle.run_command(argv: String, cwd: String, stdout_path: String, stderr_path: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  Supervisor.run(argv,cwd,stdout_path,stderr_path)

def CompileQueueLifecycle.cmdline(pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  Proc.cmdline(pid)

def CompileQueueLifecycle.environ(pid: U32, name: String) -> IO(Result<&1,&1,U32 & String,String>):
  Proc.environ(pid,name)

def CompileQueueLifecycle.cwd_of_pid(pid: U32) -> IO(Result<&1,&1,U32 & String,String>):
  Proc.cwd(pid)

def signal_result(result: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Done{unit}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Fail{(+code,message)}: IO.pure(Result<&1,&1,U32 & String,Unit>,Bool.pick(Result<&1,&1,U32 & String,Unit>,U32.is_eq(code,3),Done{Unit{}},Fail{(code,message)}))

def CompileQueueLifecycle.signal_pid(pid: U32, sig: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.signal_pid(pid,sig)
    signal_result(result)

def CompileQueueLifecycle.signal_group(pid: U32, sig: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.signal_group(pid,sig)
    signal_result(result)

def CompileQueueLifecycle.sleep_millis(millis: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    slept : Unit <- IO.sleep(millis)
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

@unsafe
def CompileQueueLifecycle.wait_external(+pid: U32, +start: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    alive : U32 <- IO.try(U32,P.HostPosix.alive(pid,start))
    Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_eq(alive,0),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),
      do IO<Result<&1,&1,U32 & String,Unit>>:
        slept : Unit <- IO.sleep(5000)
        CompileQueueLifecycle.wait_external(pid,start))

def CompileQueueLifecycle.spawn_detached(+argv: String, key_lock: U32, heavy_lock: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    self : String <- IO.try(String,P.HostPosix.self_exe())
    complete : String <- IO.pure(String,Bool.pick(String,String.starts_with(argv,"/"),argv,self ++ Char.show(Char.from_u32(0)) ++ argv))
    P.HostPosix.spawn_detached(complete,key_lock,heavy_lock,"")
