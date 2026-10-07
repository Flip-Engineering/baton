import Base
import ../src/host/instance.bend as Custody
import ../src/host/process.bend as P
import ../src/host/session-lock.bend as Lock
import ../src/host/text.bend as Text

# The shared owner entry. The custody client starts this shape of process when
# no owner answers for a database.
def owner_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> Nil{}: IO.try(Unit,Custody.Instance.owner(database))
    case _: IO.die(Unit,2,"--instance-owner DATABASE")

def answer(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.print("shutdown-ok")
    case Fail{(code,text)}: IO.print("shutdown-failed:" ++ U32.show(code) ++ ": " ++ text)

def shutdown_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.shutdown(database)
      printed : Unit <- answer(result)
      IO.pure(Unit,Unit{})
    case _: IO.die(Unit,2,"shutdown DATABASE")

# States the binding outcome as a value instead of halting, so a test can read
# a refusal (a second owner, a multiply-linked database) as its own result.
def owner_answer(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.print("owner-ok")
    case Fail{(code,text)}: IO.print("owner-refused:" ++ U32.show(code) ++ ": " ++ text)

def owner_try_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.owner(database)
      printed : Unit <- owner_answer(result)
      IO.pure(Unit,Unit{})
    case _: IO.die(Unit,2,"owner-try DATABASE")

# Prints each retained line, then the actual exit status. This observer exits
# without releasing the attempt, so the owner keeps the native work.
@unsafe
def attached_lines(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      printed : Unit <- IO.print("native-" ++ status)
      IO.pure(Unit,Unit{})
    case Some{text}: do IO<Unit>:
      printed : Unit <- IO.print(text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      attached_lines(handle,next)

def observe_attached(result: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match result:
    case Done{+handle}: do IO<Unit>:
      printed : Unit <- IO.print("attached")
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      attached_lines(handle,line)
    case Fail{(code,text)}: IO.die(Unit,1,U32.show(code) ++ ": " ++ text)

def attach_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> directory <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,U32> <- Custody.Instance.attach(database,directory)
      observed : Unit <- observe_attached(result)
      IO.pure(Unit,Unit{})
    case _: IO.die(Unit,2,"attach DATABASE ATTEMPT")

# The observer the owner launches when it loses a client. It reattaches and
# reads the attempt's retained output from the beginning of its spool.
def recover_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> directory <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,U32> <- Custody.Instance.attach(database,directory)
      observed : Unit <- observe_attached(result)
      IO.pure(Unit,Unit{})
    case _: IO.die(Unit,2,"recover-retained DATABASE ATTEMPT")

def attached_locked(database: String, directory: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,1,"fixture session busy")
    case Some{+handle}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,U32> <- Custody.Instance.attach_owned(database,directory,handle)
      observed : Unit <- observe_attached(result)
      IO.pure(Unit,Unit{})

def attach_owned_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> directory <> Nil{}: Lock.SessionLock.acquire_session(Unit,database,"fixture",canonical => lock => attached_locked(canonical,directory,lock))
    case _: IO.die(Unit,2,"attach-owned DATABASE ATTEMPT")

# Prints the outcome of one attempt-level operation.
def operation(name: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.print(name ++ "-ok")
    case Fail{(code,text)}: IO.print(name ++ "-failed:" ++ U32.show(code) ++ ": " ++ text)

# The completion cycle. Release and acknowledgment end custody; retirement
# releases the capability, and a later write through it must be refused.
def release_and_ack(+handle: U32) -> IO(Unit):
  do IO<Unit>:
    release_result : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.release(handle)
    released : Unit <- operation("release",release_result)
    ack_result : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.acknowledge(handle)
    acknowledged : Unit <- operation("acknowledge",ack_result)
    retire_result : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.retire(handle)
    retired : Unit <- operation("retire",retire_result)
    stale_result : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.write(handle,"after retire")
    stale : Unit <- operation("stale-write",stale_result)
    IO.pure(Unit,Unit{})

@unsafe
def cycle_lines(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      printed : Unit <- IO.print("native-" ++ status)
      settled : Unit <- release_and_ack(handle)
      IO.print("attempt-complete")
    case Some{text}: do IO<Unit>:
      printed : Unit <- IO.print(text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      cycle_lines(handle,next)

def cycle_started(start: P.RetainedStart, payload: String) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{+handle}: do IO<Unit>:
      printed : Unit <- IO.print("admitted")
      written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,payload))
      closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      cycle_lines(handle,line)

# The held attempt: the observer writes the payload and then stops reading, so
# its owner keeps the native work and the spool. The driver kills this process
# and reads the attempt's retained output through the owner's recovery observer.
def hold_started(start: P.RetainedStart, payload: String) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{+handle}: do IO<Unit>:
      printed : Unit <- IO.print("admitted")
      written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,payload))
      gate : String <- IO.try(String,Text.Text.read("-"))
      IO.print("hold-released")

def attempted_started(start: P.RetainedStart, payload: String, cycle: Bool) -> IO(Unit):
  match cycle:
    case True{}: cycle_started(start,payload)
    case False{}: hold_started(start,payload)

def attempted_locked(+directory: String, database: String, cwd: String, payload: String, program: List<String>, lock: Maybe<U32>, cycle: Bool) -> IO(Unit):
  do IO<Unit>:
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    start : P.RetainedStart <- IO.try(P.RetainedStart,Custody.Instance.admit(database,directory,P.argv(program),cwd,directory ++ "/native.stderr","",1,lock,P.argv([executable,"recover-retained",database,directory])))
    run : Unit <- attempted_started(start,payload,cycle)
    IO.pure(Unit,Unit{})

def admit_cli(args: List<String>, cycle: Bool) -> IO(Unit):
  match args:
    case database <> session <> directory <> cwd <> payload <> program:
      Lock.SessionLock.acquire_session(Unit,database,session,canonical => lock => attempted_locked(directory,canonical,cwd,payload,program,lock,cycle))
    case _: IO.die(Unit,2,"admit DATABASE SESSION ATTEMPT CWD PAYLOAD PROGRAM ARGS...")

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

def lock_result(lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.print("busy")
    case Some{handle}: do IO<Unit>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      IO.print("acquired")

def lock_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> session <> Nil{}: Lock.SessionLock.acquire_session(Unit,database,session,canonical => lock => lock_result(lock))
    case _: IO.die(Unit,2,"lock-try DATABASE SESSION")

def mode_number(+mode: String) -> U32:
  Bool.pick(U32,Bool.or(String.eq(mode,"--instance-owner"),String.eq(mode,"owner")),1,
  Bool.pick(U32,String.eq(mode,"admit"),2,
  Bool.pick(U32,String.eq(mode,"hold"),3,
  Bool.pick(U32,String.eq(mode,"attach"),4,
  Bool.pick(U32,String.eq(mode,"attach-owned"),5,
  Bool.pick(U32,String.eq(mode,"control-write"),6,
  Bool.pick(U32,String.eq(mode,"control-signal"),7,
  Bool.pick(U32,String.eq(mode,"shutdown"),8,
  Bool.pick(U32,String.eq(mode,"lock-try"),9,
  Bool.pick(U32,String.eq(mode,"owner-try"),10,
  Bool.pick(U32,String.eq(mode,"recover-retained"),11,0)))))))))))

def dispatch(mode: U32, rest: List<String>) -> IO(Unit):
  match mode:
    case 1: owner_cli(rest)
    case 2: admit_cli(rest,True{})
    case 3: admit_cli(rest,False{})
    case 4: attach_cli(rest)
    case 5: attach_owned_cli(rest)
    case 6: write_cli(rest)
    case 7: signal_cli(rest)
    case 8: shutdown_cli(rest)
    case 9: lock_cli(rest)
    case 10: owner_try_cli(rest)
    case 11: recover_cli(rest)
    case _: IO.die(Unit,2,"instance mode required")

def cli(args: List<String>) -> IO(Unit):
  match args:
    case +mode <> rest: dispatch(mode_number(mode),rest)
    case _: IO.die(Unit,2,"MODE ARGS...")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
