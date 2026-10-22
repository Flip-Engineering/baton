import Base
import ../src/host/process.bend as P
import ../src/host/session-lock.bend as Lock
import ../src/host/instance.bend as Custody
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

@unsafe
def retained_span_lines(+handle: U32, lock: Maybe<U32>, sender: Chan(Unit), span: Maybe<String> & String) -> IO(Unit):
  match span:
    case (offset,length):
      match offset:
        case None{}: retained_finish(handle,lock,sender)
        case Some{value}: do IO<Unit>:
          printed : Unit <- IO.print(value ++ "\t" ++ length)
          next : Maybe<String> & String <- IO.try(Maybe<String> & String,P.ProcessChild.read_retained_line_span(handle))
          retained_span_lines(handle,lock,sender,next)

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
    ready : Unit <- IO.print("observer-write-start")
    written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,payload))
    printed : Unit <- IO.print("observer-write-complete")
    closed : Unit <- observer_close(handle,close)
    sender : Chan(Unit) <- IO.fork(Unit,IO.pure(Unit,Unit{}))
    first : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
    retained_lines(handle,lock,sender,first)

def retained_started(start: P.RetainedStart, lock: U32, payload: String, close: Bool) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{handle}: observe_retained(handle,Some{lock},payload,close)

def observe_retained_spans(+handle: U32, lock: Maybe<U32>, payload: String, close: Bool) -> IO(Unit):
  do IO<Unit>:
    attempt : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.release(handle)
    checked : Unit <- early_release(attempt)
    sender : Chan(Unit) <- IO.fork(Unit,observer_write(handle,payload,close))
    first : Maybe<String> & String <- IO.try(Maybe<String> & String,P.ProcessChild.read_retained_line_span(handle))
    retained_span_lines(handle,lock,sender,first)

def retained_span_started(start: P.RetainedStart, lock: U32, payload: String, close: Bool) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{handle}: observe_retained_spans(handle,Some{lock},payload,close)

def checkpoint_span_replay(+handle: U32, lock: Maybe<U32>, sender: Chan(Unit), replay: Maybe<String> & String) -> IO(Unit):
  match replay:
    case (None{},_): IO.die(Unit,1,"checkpoint-replay-missing")
    case (Some{offset},length): do IO<Unit>:
      shown : Unit <- IO.print("replay:" ++ offset ++ "\t" ++ length)
      next : Maybe<String> & String <- IO.try(Maybe<String> & String,P.ProcessChild.read_retained_line_span(handle))
      retained_span_lines(handle,lock,sender,next)

def checkpoint_span_result(+handle: U32, lock: Maybe<U32>, sender: Chan(Unit), result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{(code,text)}: IO.die(Unit,1,"checkpoint-restore:" ++ U32.show(code) ++ ":" ++ text)
    case Done{value}: do IO<Unit>:
      printed : Unit <- IO.print("restored:" ++ value)
      replay : Maybe<String> & String <- IO.try(Maybe<String> & String,P.ProcessChild.read_retained_line_span(handle))
      checkpoint_span_replay(handle,lock,sender,replay)

def checkpoint_span_pending(+handle: U32, lock: Maybe<U32>, sender: Chan(Unit), pending: Maybe<String> & String) -> IO(Unit):
  match pending:
    case (None{},_): IO.die(Unit,1,"checkpoint-pending-line-missing")
    case (Some{next_offset},next_length): do IO<Unit>:
      shown_pending : Unit <- IO.print("uncommitted:" ++ next_offset ++ "\t" ++ next_length)
      restored : Result<&1,&1,U32 & String,String> <- Custody.Instance.restore(handle,1)
      checkpoint_span_result(handle,lock,sender,restored)

def checkpoint_span_saved(+handle: U32, lock: Maybe<U32>, sender: Chan(Unit), saved: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match saved:
    case Fail{(code,text)}: IO.die(Unit,1,"checkpoint-commit:" ++ U32.show(code) ++ ":" ++ text)
    case Done{unit}: do IO<Unit>:
      pending : Maybe<String> & String <- IO.try(Maybe<String> & String,P.ProcessChild.read_retained_line_span(handle))
      checkpoint_span_pending(handle,lock,sender,pending)

def checkpoint_span_first(+handle: U32, lock: Maybe<U32>, sender: Chan(Unit), span: Maybe<String> & String) -> IO(Unit):
  match span:
    case (None{},_): IO.die(Unit,1,"checkpoint-first-line-missing")
    case (Some{offset},length): do IO<Unit>:
      shown : Unit <- IO.print("durable:" ++ offset ++ "\t" ++ length)
      saved : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.commit(handle,1,"durable")
      checkpoint_span_saved(handle,lock,sender,saved)

def observe_retained_checkpoint_spans(+handle: U32, lock: Maybe<U32>, payload: String, close: Bool) -> IO(Unit):
  do IO<Unit>:
    attempt : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.release(handle)
    checked : Unit <- early_release(attempt)
    sender : Chan(Unit) <- IO.fork(Unit,observer_write(handle,payload,close))
    first : Maybe<String> & String <- IO.try(Maybe<String> & String,P.ProcessChild.read_retained_line_span(handle))
    checkpoint_span_first(handle,lock,sender,first)

def checkpoint_span_started(start: P.RetainedStart, lock: U32, payload: String, close: Bool) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{handle}: observe_retained_checkpoint_spans(handle,Some{lock},payload,close)

def retained_choose(start: P.RetainedStart, lock: U32, payload: String, mode: String, close: Bool) -> IO(Unit):
  match mode:
    case "span": retained_span_started(start,lock,payload,close)
    case "checkpoint-span": checkpoint_span_started(start,lock,payload,close)
    case _: retained_started(start,lock,payload,close)

def recovery_program(mode: String, executable: String, directory: String) -> String:
  P.argv([executable,
    Bool.pick(String,String.eq(mode,"recovery-fails"),"recover-retained-fail","recover-retained"),
    directory])

def retained_locked(database: String, +directory: String, +cwd: String, payload: String, +mode: String, program: List<String>, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,1,"fixture session busy")
    case Some{+handle}: do IO<Unit>:
      executable : String <- IO.try(String,Lock.SessionLock.executable())
      bytes : String <- IO.try(String,Text.Text.read(payload))
      stderr : String = Bool.pick(String,String.eq(mode,"setup-failure"),cwd ++ "/setup.stderr",directory ++ "/native.stderr")
      start : P.RetainedStart <- IO.try(P.RetainedStart,Custody.Instance.admit(database,directory,P.argv(program),cwd,stderr,"",1,Some{handle},recovery_program(mode,executable,directory)))
      retained_choose(start,handle,bytes,mode,String.eq(mode,"close"))

def retained_cli(args: List<String>) -> IO(Unit):
  match args:
    case db <> directory <> cwd <> payload <> mode <> program:
      Lock.SessionLock.acquire_session(Unit,db,"fixture",canonical => lock => retained_locked(canonical,directory,cwd,payload,mode,program,lock))
    case _: IO.die(Unit,2,"retain DATABASE ATTEMPT CWD PAYLOAD MODE PROGRAM ARGS...")

def failed_recovery_cli(args: List<String>) -> IO(Unit):
  match args:
    case +directory <> Nil{}: do IO<Unit>:
      recorded : Unit <- IO.try(Unit,Text.Text.append(directory ++ "/recovery-started","failed\n"))
      +handle : U32 <- IO.try(U32,P.ProcessChild.attach(directory ++ "/missing"))
      IO.die(Unit,3,"fixture recovery unexpectedly attached")
    case _: IO.die(Unit,2,"recover-retained-fail ATTEMPT")

def recovery_cli(args: List<String>) -> IO(Unit):
  match args:
    case +directory <> Nil{}: do IO<Unit>:
      recorded : Unit <- IO.try(Unit,Text.Text.append(directory ++ "/recovery-started","recovered\n"))
      +handle : U32 <- IO.try(U32,P.ProcessChild.attach(directory))
      attached : Unit <- IO.try(Unit,Text.Text.append(directory ++ "/recovery-attached","attached\n"))
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

@unsafe
def observer_recovery_lines(+lock: U32, +handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
      acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
      unlocked : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.print("observer-recovered:" ++ status)
    case Some{text}: do IO<Unit>:
      printed : Unit <- IO.print(text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      observer_recovery_lines(lock,handle,next)

def observer_recovery_result(result: Result<&1,&1,U32 & String,U32 & U32>) -> IO(Unit):
  match result:
    case Fail{(code,text)}: IO.die(Unit,1,U32.show(code) ++ ": " ++ text)
    case Done{(+lock,+handle)}: do IO<Unit>:
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      observer_recovery_lines(lock,handle,line)

def recover_observer_with_pid(database: String, directory: String,
                              parsed: Maybe<&2,U32>) -> IO(Unit):
  match parsed:
    case None{}: IO.die(Unit,2,"invalid observer PID")
    case Some{observer}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,U32 & U32> <- Lock.SessionLock.recover_observer(database,"fixture",directory,observer)
      observer_recovery_result(result)

def recover_observer_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> directory <> observer <> Nil{}:
      recover_observer_with_pid(database,directory,U32.read(observer))
    case _: IO.die(Unit,2,"recover-observer DATABASE ATTEMPT OBSERVER_PID")

def observer_probe_line(line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: IO.print("probe-eof")
    case Some{text}: IO.print("probe:" ++ text)

def observer_probe_result(result: Result<&1,&1,U32 & String,U32 & U32>) -> IO(Unit):
  match result:
    case Fail{(code,text)}: IO.die(Unit,1,U32.show(code) ++ ": " ++ text)
    case Done{(+lock,+handle)}: do IO<Unit>:
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      shown : Unit <- observer_probe_line(line)
      unlocked : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.print("probe-custody-open")

def recover_observer_probe_with_pid(database: String, directory: String,
                                    parsed: Maybe<&2,U32>) -> IO(Unit):
  match parsed:
    case None{}: IO.die(Unit,2,"invalid observer PID")
    case Some{pid}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,U32 & U32> <- Lock.SessionLock.recover_observer(database,"fixture",directory,pid)
      observer_probe_result(result)

def recover_observer_probe_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> directory <> observer <> Nil{}:
      recover_observer_probe_with_pid(database,directory,U32.read(observer))
    case _: IO.die(Unit,2,"recover-probe DATABASE ATTEMPT OBSERVER_PID")

def observer_hold_cli(args: List<String>) -> IO(Unit):
  match args:
    case directory <> Nil{}: do IO<Unit>:
      +handle : U32 <- IO.try(U32,P.ProcessChild.attach(directory))
      held : String <- IO.try(String,Text.Text.read("-"))
      IO.print("observer-holder-released")
    case _: IO.die(Unit,2,"observer-hold ATTEMPT")

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

def instance_owner_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> Nil{}: IO.try(Unit,Custody.Instance.owner(database))
    case _: IO.die(Unit,2,"--instance-owner DATABASE")

def instance_shutdown_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(database))
    case _: IO.die(Unit,2,"shutdown DATABASE")

def mode_number(+mode: String) -> U32:
  Bool.pick(U32,String.eq(mode,"--host-process-keeper"),1,
  Bool.pick(U32,String.eq(mode,"--instance-owner"),8,
  Bool.pick(U32,String.eq(mode,"shutdown"),9,
  Bool.pick(U32,String.eq(mode,"retain"),2,
  Bool.pick(U32,String.eq(mode,"recover-retained"),3,
  Bool.pick(U32,String.eq(mode,"recover-retained-fail"),12,
  Bool.pick(U32,String.eq(mode,"lock-try"),4,
  Bool.pick(U32,String.eq(mode,"control-write"),5,
  Bool.pick(U32,String.eq(mode,"control-signal"),6,
  Bool.pick(U32,String.eq(mode,"recover-observer"),7,
  Bool.pick(U32,String.eq(mode,"recover-probe"),10,
  Bool.pick(U32,String.eq(mode,"observer-hold"),11,0))))))))))))

def dispatch(mode: U32, original: String, rest: List<String>) -> IO(Unit):
  match mode:
    case 1: keeper_cli(rest)
    case 2: retained_cli(rest)
    case 3: recovery_cli(rest)
    case 4: lock_cli(rest)
    case 5: write_cli(rest)
    case 6: signal_cli(rest)
    case 7: recover_observer_cli(rest)
    case 8: instance_owner_cli(rest)
    case 9: instance_shutdown_cli(rest)
    case 10: recover_observer_probe_cli(rest)
    case 11: observer_hold_cli(rest)
    case 12: failed_recovery_cli(rest)
    case _: spawn_cli(original <> rest)

def cli(args: List<String>) -> IO(Unit):
  match args:
    case +mode <> rest: dispatch(mode_number(mode),mode,rest)
    case _: IO.die(Unit,2,"MODE ARGS...")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
