import Base
import ../src/host/instance.bend as Instance
import ../src/host/process.bend as P
import ../src/host/session-lock.bend as Lock
import ../src/host/text.bend as Text

# The shared owner entry. The custody client starts this shape of process when
# no owner answers for a database.
def owner_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> Nil{}: IO.try(Unit,Instance.owner(database))
    case _: IO.die(Unit,2,"--instance-owner DATABASE")

def shutdown_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> Nil{}: answer(Instance.shutdown(database))
    case _: IO.die(Unit,2,"shutdown DATABASE")

def answer(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.print("shutdown-ok")
    case Fail{error}: IO.print("shutdown-failed:" ++ error)

def attach_result(result: Result<&1,&1,U32 & String,U32>) -> IO<Unit>:
  match result:
    case Done{unit}: IO.print("attached")
    case Fail{error}: IO.die(Unit,1,error)

# Prints each retained line, then the actual exit status. The observer exits
# without releasing the attempt, so the owner keeps the native work.
@unsafe
def attached_lines(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      IO.print("native-" ++ status)
    case Some{text}: do IO<Unit>:
      printed : Unit <- IO.print(text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      attached_lines(handle,next)

def attach_cli(args: List<String>, owned: Bool) -> IO(Unit):
  match args:
    case database <> directory <> lock_value <> Nil{}:
      match Bool.pick(Maybe<U32>,owned,lock_value,None{}):
        case Some{value}: do IO<Unit>:
          joined : Result<&1,&1,U32 & String,U32> <- if_owned(owned,database,directory,value)
          attach_result(joined)
        case None{}: do IO<Unit>:
          result : Result<&1,&1,U32 & String,U32> <- Instance.attach(database,directory)
          attach_result(result)
    case database <> directory <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,U32> <- Instance.attach(database,directory)
      attach_result(result)
    case _: IO.die(Unit,2,"attach DATABASE ATTEMPT [LOCK]")

def if_owned(owned: Bool, database: String, directory: String, lock: U32) -> IO<Result<&1,&1,U32 & String,U32>>:
  match owned:
    case True{}: Instance.attach_owned(database,directory,lock)
    case False{}: Instance.attach(database,directory)

def observe_attached(result: Result<&1,&1,U32 & String,U32>) -> IO<Unit>:
  match result:
    case Done{+handle}: do IO<Unit>:
      printed : Unit <- IO.print("attached")
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      attached_lines(handle,line)
    case Fail{error}: IO.die(Unit,1,error)

def attached_locked(database: String, directory: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,1,"fixture session busy")
    case Some{+handle}: observe_attached(Instance.attach_owned(database,directory,handle))

def attach_owned_cli(args: List<String>) -> IO<Unit):
  match args:
    case database <> directory <> Nil{}: Lock.SessionLock.acquire_session(Unit,database,"fixture",canonical => lock => attached_locked(database,directory,lock))
    case _: IO.die(Unit,2,"attach-owned DATABASE ATTEMPT")

# Prints the outcome of one attempt-level operation.
def operation(name: String, result: Result<&1,&1,U32 & String,Unit>) -> IO<Unit>:
  match result:
    case Done{unit}: IO.print(name ++ "-ok")
    case Fail{error}: IO.print(name ++ "-failed:" ++ error)

def release_and_ack(+handle: U32, retire: Bool) -> IO<Unit>:
  do IO<Unit>:
    released : Unit <- operation("release",P.ProcessChild.release(handle))
    acknowledged : Unit <- operation("acknowledge",P.ProcessChild.acknowledge(handle))
    retired : Unit <- retired_step(handle,retire)

def retired_step(+handle: U32, retire: Bool) -> IO<Unit>:
  match retire:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      outcome : Unit <- operation("retire",Instance.retire(handle))
      stale : Unit <- operation("stale-write",P.ProcessChild.write(handle,"after retire"))

# An admitted attempt: the caller sees admitted, then the native output, then
# the actual exit status and the release and acknowledgment results.
@unsafe
def admitted_lines(+handle: U32, mode: String, line: Maybe<String>) -> IO<Unit>:
  match line:
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      printed : Unit <- IO.print("native-" ++ status)
      settled : Unit <- release_and_ack(handle,String.eq(mode,"cycle"))
      IO.print("attempt-complete")
    case Some{text}: do IO<Unit>:
      printed : Unit <- IO.print(text)
      held : Unit <- held_step(handle,mode)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      admitted_lines(handle,mode,next)

# In hold mode the attempt stays alive while the driver kills this observer.
def held_step(+handle: U32, mode: String) -> IO<Unit>:
  match String.eq(mode,"hold"):
    case True{}: do IO<Unit>:
      gate : String <- IO.try(String,Text.Text.read("-"))
      IO.pure(Unit,Unit{})
    case False{}: IO.pure(Unit,Unit{})

def admitted_started(start: P.RetainedStart, payload: String, mode: String) -> IO<Unit>:
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{handle}: do IO<Unit>:
      printed : Unit <- IO.print("admitted")
      written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,payload))
      closed : Unit <- closed_step(handle,mode)
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      admitted_lines(handle,mode,line)

def closed_step(+handle: U32, mode: String) -> IO<Unit>:
  match String.eq(mode,"hold"):
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.try(Unit,P.ProcessChild.close_stdin(handle))

def admitted_locked(database: String, directory: String, cwd: String, payload: String, mode: String, program: List<String>, lock: Maybe<U32>) -> IO<Unit>:
  do IO<Unit>:
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    start : P.RetainedStart <- IO.try(P.RetainedStart,Instance.admit(database,directory,P.argv(program),cwd,directory ++ "/native.stderr",payload,1,lock,P.argv([executable,"recover-retained",directory])))
    admitted_started(start,payload,mode)

def admit_cli(args: List<String>) -> IO<Unit>:
  match args:
    case database <> session <> directory <> cwd <> payload <> mode <> program:
      Lock.SessionLock.acquire_session(Unit,database,session,canonical => lock => admitted_locked(database,directory,cwd,payload,mode,program,lock))
    case _: IO.die(Unit,2,"admit DATABASE SESSION ATTEMPT CWD PAYLOAD MODE PROGRAM ARGS...")

def write_cli(args: List<String>) -> IO<Unit>:
  match args:
    case directory <> path <> Nil{}: do IO<Unit>:
      bytes : String <- IO.try(String,Text.Text.read(path))
      started : Unit <- IO.print("control-write-start")
      written : Unit <- IO.try(Unit,P.ProcessChild.control_write(directory,bytes))
      IO.print("control-write-complete")
    case _: IO.die(Unit,2,"control-write ATTEMPT PAYLOAD")

def signal_value(directory: String, value: Maybe<&2,U32>) -> IO<Unit>:
  match value:
    case None{}: IO.die(Unit,2,"invalid signal")
    case Some{sig}: do IO<Unit>:
      sent : Unit <- IO.try(Unit,P.ProcessChild.control_signal(directory,sig))
      IO.print("control-signal-complete")

def signal_cli(args: List<String>) -> IO<Unit>:
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
  Bool.pick(U32,String.eq(mode,"attach"),3,
  Bool.pick(U32,String.eq(mode,"attach-owned"),4,
  Bool.pick(U32,String.eq(mode,"control-write"),5,
  Bool.pick(U32,String.eq(mode,"control-signal"),6,
  Bool.pick(U32,String.eq(mode,"shutdown"),7,
  Bool.pick(U32,String.eq(mode,"lock-try"),8,0))))))))

def dispatch(mode: U32, original: String, rest: List<String>) -> IO(Unit):
  match mode:
    case 1: owner_cli(rest)
    case 2: admit_cli(rest)
    case 3: attach_cli(rest,False{})
    case 4: attach_owned_cli(rest)
    case 5: write_cli(rest)
    case 6: signal_cli(rest)
    case 7: shutdown_cli(rest)
    case 8: lock_cli(rest)
    case _: IO.die(Unit,2,"instance mode required")

def cli(args: List<String>) -> IO(Unit):
  match args:
    case +mode <> rest: dispatch(mode_number(mode),mode,rest)
    case _: IO.die(Unit,2,"MODE ARGS...")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
