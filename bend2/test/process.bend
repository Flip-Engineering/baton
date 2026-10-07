import Base
import ../src/host/process.bend as P
import ../src/host/session-lock.bend as Lock
import ../src/host/text.bend as Text

def finish(handle: U32) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,P.ProcessChild.wait(handle))
    IO.print(result)

@unsafe
def lines(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: finish(handle)
    case Some{text}:
      do IO<Unit>:
        printed : Unit <- IO.print(text)
        next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
        lines(handle,next)

def closed(+handle: U32) -> IO(Unit):
  do IO<Unit>:
    done : String <- IO.try(String,P.ProcessChild.wait(handle))
    IO.try(Unit,P.ProcessChild.write(handle,"closed stdin"))

def start_read(+handle: U32, should_write: Bool) -> IO(Unit):
  match should_write:
    case True{}: closed(handle)
    case False{}:
      do IO<Unit>:
        close : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
        line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
        lines(handle,line)

def spawn_cli(args: List<String>) -> IO(Unit):
  match args:
    case mode <> cwd <> log <> program:
      do IO<Unit>:
        handle : U32 <- IO.try(U32,P.ProcessChild.spawn(P.argv(program),cwd,log))
        start_read(handle,String.eq(mode,"closed"))
    case _: IO.die(Unit,2,"MODE CWD STDERR PROGRAM ARGS...")

def release_lock(lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.pure(Unit,Unit{})
    case Some{handle}: IO.try(Unit,Lock.SessionLock.release(handle))

def retained_finish(+handle: U32, lock: Maybe<U32>, sender: Chan(Unit)) -> IO(Unit):
  do IO<Unit>:
    status : String <- IO.try(String,P.ProcessChild.wait(handle))
    sent : Unit <- IO.join(Unit,sender)
    printed : Unit <- IO.print("native-" ++ status)
    # The test closes observer stdin after checking the exited keeper.
    gate : String <- IO.try(String,Text.Text.read("-"))
    unlocked : Unit <- release_lock(lock)
    released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
    acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
    IO.print("retained-complete")

@unsafe
def retained_lines(+handle: U32, lock: Maybe<U32>, sender: Chan(Unit), line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: retained_finish(handle,lock,sender)
    case Some{text}: do IO<Unit>:
      printed : Unit <- IO.print(text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      retained_lines(handle,lock,sender,next)

def observer_close(handle: U32, close: Bool) -> IO(Unit):
  match close:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
      IO.print("observer-input-closed")

def observer_write(+handle: U32, payload: String, close: Bool) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- IO.print("observer-write-start")
    written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,payload))
    printed : Unit <- IO.print("observer-write-complete")
    observer_close(handle,close)

def early_release(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.print("early-release-accepted")
    case Fail{error}: IO.print("early-release-refused")

def observe_retained(+handle: U32, lock: Maybe<U32>, payload: String, close: Bool) -> IO(Unit):
  do IO<Unit>:
    attempt : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.release(handle)
    checked : Unit <- early_release(attempt)
    sender : Chan(Unit) <- IO.fork(Unit,observer_write(handle,payload,close))
    first : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
    retained_lines(handle,lock,sender,first)

def retained_started(start: P.RetainedStart, lock: U32, payload: String, close: Bool) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{handle}: observe_retained(handle,Some{lock},payload,close)

def retained_locked(+directory: String, cwd: String, payload: String, mode: String, program: List<String>, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,1,"fixture session busy")
    case Some{+handle}: do IO<Unit>:
      executable : String <- IO.try(String,Lock.SessionLock.executable())
      bytes : String <- IO.try(String,Text.Text.read(payload))
      start : P.RetainedStart <- IO.try(P.RetainedStart,P.ProcessChild.retain(directory,P.argv(program),cwd,directory ++ "/native.stderr","",1,handle,P.argv([executable,"recover-retained",directory])))
      retained_started(start,handle,bytes,String.eq(mode,"close"))

def retained_cli(args: List<String>) -> IO(Unit):
  match args:
    case db <> directory <> cwd <> payload <> mode <> program:
      Lock.SessionLock.acquire_session(Unit,db,"fixture",canonical => lock => retained_locked(directory,cwd,payload,mode,program,lock))
    case _: IO.die(Unit,2,"retain DATABASE ATTEMPT CWD PAYLOAD MODE PROGRAM ARGS...")

def recovery_cli(args: List<String>) -> IO(Unit):
  match args:
    case +directory <> Nil{}: do IO<Unit>:
      recorded : Unit <- IO.try(Unit,Text.Text.append(directory ++ "/recovery-started","recovered\n"))
      +handle : U32 <- IO.try(U32,P.ProcessChild.attach(directory))
      sender : Chan(Unit) <- IO.fork(Unit,IO.pure(Unit,Unit{}))
      first : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      retained_lines(handle,None{},sender,first)
    case _: IO.die(Unit,2,"recover-retained ATTEMPT")

def lock_result(lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.print("busy")
    case Some{handle}: do IO<Unit>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      IO.print("acquired")

def lock_cli(args: List<String>) -> IO(Unit):
  match args:
    case db <> Nil{}: Lock.SessionLock.acquire_session(Unit,db,"fixture",canonical => lock => lock_result(lock))
    case _: IO.die(Unit,2,"lock-try DATABASE")

def write_cli(args: List<String>) -> IO(Unit):
  match args:
    case directory <> path <> Nil{}: do IO<Unit>:
      bytes : String <- IO.try(String,Text.Text.read(path))
      started : Unit <- IO.print("control-write-start")
      written : Unit <- IO.try(Unit,P.ProcessChild.control_write(directory,bytes))
      IO.print("control-write-complete")
    case _: IO.die(Unit,2,"control-write ATTEMPT PAYLOAD")

def signal_value(directory: String, value: Maybe<&2,U32>) -> IO(Unit):
  match value:
    case None{}: IO.die(Unit,2,"invalid signal")
    case Some{sig}: do IO<Unit>:
      sent : Unit <- IO.try(Unit,P.ProcessChild.control_signal(directory,sig))
      IO.print("control-signal-complete")

def signal_cli(args: List<String>) -> IO(Unit):
  match args:
    case directory <> sig <> Nil{}: signal_value(directory,U32.read(sig))
    case _: IO.die(Unit,2,"control-signal ATTEMPT SIGNAL")

def keeper_value(directory: String, value: Maybe<&2,U32>) -> IO(Unit):
  match value:
    case None{}: IO.die(Unit,2,"invalid inherited lock")
    case Some{handle}: IO.try(Unit,P.ProcessChild.keeper(directory,handle))

def keeper_cli(args: List<String>) -> IO(Unit):
  match args:
    case directory <> lock <> Nil{}: keeper_value(directory,U32.read(lock))
    case _: IO.die(Unit,2,"--host-process-keeper ATTEMPT LOCK")

def mode_number(+mode: String) -> U32:
  Bool.pick(U32,String.eq(mode,"--host-process-keeper"),1,
  Bool.pick(U32,String.eq(mode,"retain"),2,
  Bool.pick(U32,String.eq(mode,"recover-retained"),3,
  Bool.pick(U32,String.eq(mode,"lock-try"),4,
  Bool.pick(U32,String.eq(mode,"control-write"),5,
  Bool.pick(U32,String.eq(mode,"control-signal"),6,0))))))

def dispatch(mode: U32, original: String, rest: List<String>) -> IO(Unit):
  match mode:
    case 1: keeper_cli(rest)
    case 2: retained_cli(rest)
    case 3: recovery_cli(rest)
    case 4: lock_cli(rest)
    case 5: write_cli(rest)
    case 6: signal_cli(rest)
    case _: spawn_cli(original <> rest)

def cli(args: List<String>) -> IO(Unit):
  match args:
    case +mode <> rest: dispatch(mode_number(mode),mode,rest)
    case _: IO.die(Unit,2,"MODE ARGS...")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
