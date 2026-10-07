import Base
import ../src/host/instance.bend as Custody
import ../src/host/process.bend as P
import ../src/host/session-lock.bend as Lock
import ../src/host/sqlite.bend as DB
import ../src/host/text.bend as Text
import ../src/context/identity.bend as Identity

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

# Restores the recorded reducer state and resumes at the checkpointed offset.
# An observer calls this before it reads: the state and the offset are one
# durable record, so it never resumes without the state it belongs to.
def restored(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{value}: IO.print("restored:" ++ value)
    case Fail{(code,text)}: IO.print("restore-failed:" ++ U32.show(code) ++ ": " ++ text)

def restore_step(+handle: U32) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- Custody.Instance.restore(handle,1)
    printed : Unit <- restored(result)
    IO.pure(Unit,Unit{})

def observe_attached(result: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match result:
    case Done{+handle}: do IO<Unit>:
      printed : Unit <- IO.print("attached")
      restored : Unit <- restore_step(handle)
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

# Prints the outcome of one attempt-level operation.
def operation(name: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.print(name ++ "-ok")
    case Fail{(code,text)}: IO.print(name ++ "-failed:" ++ U32.show(code) ++ ": " ++ text)

@unsafe
def recovery_complete_lines(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      printed : Unit <- IO.print("native-" ++ status)
      release_result : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.release(handle)
      released : Unit <- operation("release",release_result)
      ack_result : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.acknowledge(handle)
      acknowledged : Unit <- operation("acknowledge",ack_result)
      retire_result : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.retire(handle)
      retired : Unit <- operation("retire",retire_result)
      IO.print("attempt-complete")
    case Some{text}: do IO<Unit>:
      printed : Unit <- IO.print(text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      recovery_complete_lines(handle,next)

def recovery_complete_attached(result: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match result:
    case Done{+handle}: do IO<Unit>:
      printed : Unit <- IO.print("attached")
      restored : Unit <- restore_step(handle)
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      recovery_complete_lines(handle,line)
    case Fail{(code,text)}: IO.die(Unit,1,U32.show(code) ++ ": " ++ text)

def recovery_complete_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> directory <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,U32> <- Custody.Instance.attach(database,directory)
      observed : Unit <- recovery_complete_attached(result)
      IO.pure(Unit,Unit{})
    case _: IO.die(Unit,2,"attach-complete DATABASE ATTEMPT")

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

# Prints one observed line, or states that the stream ended.
def printed_line(line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: IO.print("observed-eof")
    case Some{text}: IO.print(text)

def commit_step(+handle: U32, commit: Bool) -> IO(Unit):
  match commit:
    case True{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.commit(handle,1,"{\"reducer\":\"seen two frames\"}")
      printed : Unit <- operation("commit",result)
      IO.pure(Unit,Unit{})
    case False{}: IO.print("commit-skipped")

# The partially observed attempt. With commit=1 the observer records the
# checkpoint after reading, which stands for the observation owner's own durable
# store or report commit. With commit=0 it reads without recording, which is the
# crash-between-read-and-commit case: recovery must report that frame again
# rather than skip it.
def partial_started(start: P.RetainedStart, payload: String, commit: Bool) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{+handle}: do IO<Unit>:
      printed : Unit <- IO.print("admitted")
      written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,payload))
      first : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      shown : Unit <- printed_line(first)
      second : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      observed : Unit <- printed_line(second)
      recorded : Unit <- commit_step(handle,commit)
      gate : String <- IO.try(String,Text.Text.read("-"))
      IO.print("partial-released")

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

def attempted_started(start: P.RetainedStart, payload: String, kind: U32) -> IO(Unit):
  match kind:
    case 2: hold_started(start,payload)
    case 3: partial_started(start,payload,True{})
    case 4: partial_started(start,payload,False{})
    case _: cycle_started(start,payload)

def attempted_locked(+directory: String, +database: String, cwd: String, payload: String, program: List<String>, lock: Maybe<U32>, kind: U32) -> IO(Unit):
  do IO<Unit>:
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    start : P.RetainedStart <- IO.try(P.RetainedStart,Custody.Instance.admit(database,directory,P.argv(program),cwd,directory ++ "/native.stderr","",1,lock,P.argv([executable,"recover-retained",database,directory])))
    run : Unit <- attempted_started(start,payload,kind)
    IO.pure(Unit,Unit{})

def admit_cli(args: List<String>, kind: U32) -> IO(Unit):
  match args:
    case database <> session <> directory <> cwd <> payload <> program:
      Lock.SessionLock.acquire_session(Unit,database,session,canonical => lock => attempted_locked(directory,canonical,cwd,payload,program,lock,kind))
    case _: IO.die(Unit,2,"admit DATABASE SESSION ATTEMPT CWD PAYLOAD PROGRAM ARGS...")

def recovery_locked(+directory: String, +database: String, cwd: String, payload: String, recovery: String, program: List<String>, lock: Maybe<U32>) -> IO(Unit):
  do IO<Unit>:
    start : P.RetainedStart <- IO.try(P.RetainedStart,Custody.Instance.admit(database,directory,P.argv(program),cwd,directory ++ "/native.stderr","",1,lock,P.argv([recovery])))
    run : Unit <- attempted_started(start,payload,2)
    IO.pure(Unit,Unit{})

def admit_recovery_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> session <> directory <> cwd <> payload <> recovery <> program:
      Lock.SessionLock.acquire_session(Unit,database,session,canonical => lock => recovery_locked(directory,canonical,cwd,payload,recovery,program,lock))
    case _: IO.die(Unit,2,"admit-recovery DATABASE SESSION ATTEMPT CWD PAYLOAD RECOVERY PROGRAM ARGS...")

# Reads every frame of a prepared-file attempt and reports its exit status. The
# observer writes nothing to stdin: the artifact carries the task.
@unsafe
def read_all_lines(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      IO.print("native-" ++ status)
    case Some{text}: do IO<Unit>:
      printed : Unit <- IO.print(text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      read_all_lines(handle,next)

def prepared_finished(+handle: U32, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Fail{(code,text)}: IO.print("start-refused:" ++ U32.show(code) ++ ":" ++ text)
    case Done{unit}: do IO<Unit>:
      printed : Unit <- IO.print("start-ok")
      written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,"exit\n"))
      closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      drained : Unit <- read_all_lines(handle,line)
      IO.pure(Unit,Unit{})

def prepared_double_started(+handle: U32, wrong: Result<&1,&1,U32 & String,Unit>, first: Result<&1,&1,U32 & String,Unit>, second: Result<&1,&1,U32 & String,Unit>, changed: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  do IO<Unit>:
    wrong_shown : Unit <- operation("start-wrong",wrong)
    first_shown : Unit <- operation("start-first",first)
    second_shown : Unit <- operation("start-second",second)
    changed_shown : Unit <- operation("start-changed",changed)
    written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,"exit\n"))
    closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
    line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
    drained : Unit <- read_all_lines(handle,line)
    IO.pure(Unit,Unit{})

def prepared_cancelled(+handle: U32, +bootstrap: String, +decision: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  do IO<Unit>:
    cancelled : Unit <- operation("cancel",result)
    repeated : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.cancel(handle,bootstrap,decision)
    repeated_shown : Unit <- operation("cancel-repeat",repeated)
    changed : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.cancel(handle,bootstrap,decision ++ "-changed")
    changed_shown : Unit <- operation("cancel-changed",changed)
    started : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.start(handle,bootstrap,decision)
    refused : Unit <- operation("start-after-cancel",started)
    IO.pure(Unit,Unit{})

def prepared_changed_grant(+handle: U32, +bootstrap: String, +decision: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Fail{(code,text)}: IO.print("start-refused:" ++ U32.show(code) ++ ":" ++ text)
    case Done{unit}: do IO<Unit>:
      first : Unit <- operation("start-first",result)
      second : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.start(handle,bootstrap,decision ++ "-changed")
      changed : Unit <- operation("start-changed",second)
      written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,"exit\n"))
      closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      drained : Unit <- read_all_lines(handle,line)
      IO.pure(Unit,Unit{})

def prepared_action_code(+action: String) -> U32:
  Bool.pick(U32,String.eq(action,"only"),0,
  Bool.pick(U32,String.eq(action,"wrong-start"),1,
  Bool.pick(U32,String.eq(action,"double-start"),2,
  Bool.pick(U32,String.eq(action,"changed-grant"),3,
  Bool.pick(U32,String.eq(action,"cancel"),4,5)))))

def prepared_action(+handle: U32, +bootstrap: String, +decision: String, action: U32) -> IO(Unit):
  match action:
    case 0: IO.print("prepared-only")
    case 1: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.start(handle,bootstrap ++ "-changed",decision)
      operation("start",result)
    case 2: do IO<Unit>:
      wrong : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.start(handle,bootstrap ++ "-changed",decision)
      first : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.start(handle,bootstrap,decision)
      second : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.start(handle,bootstrap,decision)
      changed : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.start(handle,bootstrap,decision ++ "-changed")
      prepared_double_started(handle,wrong,first,second,changed)
    case 3: do IO<Unit>:
      first : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.start(handle,bootstrap,decision)
      prepared_changed_grant(handle,bootstrap,decision,first)
    case 4: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.cancel(handle,bootstrap,decision)
      prepared_cancelled(handle,bootstrap,decision,result)
    case _: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.start(handle,bootstrap,decision)
      prepared_finished(handle,result)

def bootstrap_matches(bound: String, bootstrap: String) -> U32:
  Bool.pick(U32,String.eq(bound,bootstrap),1,0)

def show_bootstrap_match(matched: U32) -> IO(Unit):
  match matched:
    case 1: IO.print("prepare-bootstrap:true")
    case _: IO.print("prepare-bootstrap:false")

def prepared_result(result: Result<&1,&1,U32 & String,U32 & String & String>, +bootstrap: String, decision: String, action: String) -> IO(Unit):
  match result:
    case Fail{(code,text)}: IO.print("prepare-refused:" ++ U32.show(code) ++ ":" ++ text)
    case Done{(handle,(bound,witness))}: do IO<Unit>:
      ready : Unit <- IO.print("prepare-ready:" ++ witness)
      shown : Unit <- show_bootstrap_match(bootstrap_matches(bound,bootstrap))
      prepared_action(handle,bootstrap,decision,prepared_action_code(action))

def prepared_locked(+directory: String, +database: String, cwd: String, payload: String, executable: String, script: String, +bootstrap: String, decision: String, action: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,1,"fixture session busy")
    case Some{+guard}: do IO<Unit>:
      helper : String <- IO.try(String,Lock.SessionLock.executable())
      result : Result<&1,&1,U32 & String,U32 & String & String> <- Custody.Instance.prepare_start(database,directory,P.argv([executable,script]),cwd,directory ++ "/native.stderr",payload,1,guard,P.argv([helper,"recover-retained",database,directory]),bootstrap)
      prepared_result(result,bootstrap,decision,action)

def prepared_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> session <> directory <> cwd <> payload <> executable <> script <> bootstrap <> decision <> action <> Nil{}:
      Lock.SessionLock.acquire_session(Unit,database,session,canonical => lock => prepared_locked(directory,canonical,cwd,payload,executable,script,bootstrap,decision,action,lock))
    case _: IO.die(Unit,2,"prepare DATABASE SESSION ATTEMPT CWD PAYLOAD EXECUTABLE SCRIPT BOOTSTRAP DECISION ACTION")

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

def role_binding(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{binding}: IO.print(binding)
    case Fail{(code,text)}: IO.die(Unit,1,U32.show(code) ++ ": " ++ text)

def role_binding_cli(args: List<String>) -> IO(Unit):
  match args:
    case path <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.binding(path)
      role_binding(result)
    case _: IO.die(Unit,2,"role-binding DATABASE")

def role_identity_cli(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: IO.print(Identity.physical_role_identity(Identity.SubjectCoordinator{},Identity.RoleCoordinator{}))
    case _: IO.die(Unit,2,"role-identity")

def role_guard_cli(args: List<String>) -> IO(Unit):
  match args:
    case path <> binding <> key <> Nil{}: do IO<Unit>:
      handle : U32 <- IO.try(U32,DB.Sql.role_guard(path,binding,key))
      printed : Unit <- IO.print("role-held")
      gate : String <- IO.try(String,Text.Text.read("-"))
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      IO.print("role-released")
    case _: IO.die(Unit,2,"role-guard DATABASE BINDING SHA256")

def file_started(start: P.RetainedStart) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{+handle}: do IO<Unit>:
      printed : Unit <- IO.print("admitted")
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      read_all_lines(handle,line)

def file_locked(+directory: String, +database: String, cwd: String, payload: String, program: List<String>, lock: Maybe<U32>) -> IO(Unit):
  do IO<Unit>:
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    start : P.RetainedStart <- IO.try(P.RetainedStart,Custody.Instance.admit_with_file(database,directory,P.argv(program),cwd,directory ++ "/native.stderr","prompt.txt",payload,"",0,lock,P.argv([executable,"recover-retained",database,directory])))
    begun : Unit <- file_started(start)
    IO.pure(Unit,Unit{})

def admit_file_cli(args: List<String>) -> IO(Unit):
  match args:
    case database <> session <> directory <> cwd <> payload <> program:
      Lock.SessionLock.acquire_session(Unit,database,session,canonical => lock => file_locked(directory,canonical,cwd,payload,program,lock))
    case _: IO.die(Unit,2,"admit-file DATABASE SESSION ATTEMPT CWD ARTIFACT PROGRAM ARGS...")

# Prints each committed-change notice. The subscription stays open until the
# owner is gone or this process is killed.
@unsafe
def notice_lines(+handle: U32) -> IO(Unit):
  do IO<Unit>:
    notice : String <- IO.try(String,Custody.Instance.notice(handle))
    printed : Unit <- IO.print("notice:" ++ notice)
    notice_lines(handle)

def subscribed(result: Result<&1,&1,U32 & String,U32 & String>) -> IO(Unit):
  match result:
    case Done{(handle,ready)}: do IO<Unit>:
      printed : Unit <- IO.print("ready:" ++ ready)
      notice_lines(handle)
    case Fail{(code,text)}: IO.print("subscribe-failed:" ++ U32.show(code) ++ ": " ++ text)

def subscribe_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> after <> generation <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,U32 & String> <- Custody.Instance.subscribe(database,after,generation)
      printed : Unit <- subscribed(result)
      IO.pure(Unit,Unit{})
    case _: IO.die(Unit,2,"subscribe DATABASE AFTER_CURSOR GENERATION")

def published(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.print("published")
    case Fail{(code,text)}: IO.print("publish-failed:" ++ U32.show(code) ++ ": " ++ text)

def publish_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> cursor <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.publish_commit(database,cursor)
      printed : Unit <- published(result)
      IO.pure(Unit,Unit{})
    case _: IO.die(Unit,2,"publish DATABASE CURSOR")

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
  Bool.pick(U32,String.eq(mode,"recover-retained"),11,
  Bool.pick(U32,String.eq(mode,"partial"),12,
  Bool.pick(U32,String.eq(mode,"partial-uncommitted"),13,Bool.pick(U32,String.eq(mode,"admit-file"),14,
  Bool.pick(U32,String.eq(mode,"subscribe"),15,Bool.pick(U32,String.eq(mode,"publish"),16,
  Bool.pick(U32,String.eq(mode,"state"),17,Bool.pick(U32,String.eq(mode,"admit-nolock"),18,
  Bool.pick(U32,String.eq(mode,"prepare"),19,Bool.pick(U32,String.eq(mode,"admit-recovery"),20,
  Bool.pick(U32,String.eq(mode,"attach-complete"),21,
  Bool.pick(U32,String.eq(mode,"role-binding"),22,
  Bool.pick(U32,String.eq(mode,"role-identity"),23,
  Bool.pick(U32,String.eq(mode,"role-guard"),24,0))))))))))))))))))))))))

# Admits under the shared owner while holding no session guard, so the record
# states no guard binding.
def nolock_started(start: P.RetainedStart, payload: String) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{+handle}: do IO<Unit>:
      printed : Unit <- IO.print("admitted")
      written : Unit <- IO.try(Unit,P.ProcessChild.write(handle,payload))
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      drained : Unit <- read_all_lines(handle,line)
      IO.pure(Unit,Unit{})

def nolock_cli(args: List<String>) -> IO(Unit):
  match args:
    case +database <> +directory <> cwd <> payload <> program: do IO<Unit>:
      executable : String <- IO.try(String,Lock.SessionLock.executable())
      start : P.RetainedStart <- IO.try(P.RetainedStart,Custody.Instance.admit(database,directory,P.argv(program),cwd,directory ++ "/native.stderr","",1,None{},P.argv([executable,"recover-retained",database,directory])))
      run : Unit <- nolock_started(start,payload)
      IO.pure(Unit,Unit{})
    case _: IO.die(Unit,2,"admit-nolock DATABASE ATTEMPT CWD PAYLOAD PROGRAM ARGS...")

def dispatch(mode: U32, rest: List<String>) -> IO(Unit):
  match mode:
    case 1: owner_cli(rest)
    case 2: admit_cli(rest,1)
    case 3: admit_cli(rest,2)
    case 4: attach_cli(rest)
    case 5: attach_owned_cli(rest)
    case 6: write_cli(rest)
    case 7: signal_cli(rest)
    case 8: shutdown_cli(rest)
    case 9: lock_cli(rest)
    case 10: owner_try_cli(rest)
    case 11: recover_cli(rest)
    case 12: admit_cli(rest,3)
    case 13: admit_cli(rest,4)
    case 14: admit_file_cli(rest)
    case 15: subscribe_cli(rest)
    case 16: publish_cli(rest)
    case 18: nolock_cli(rest)
    case 19: prepared_cli(rest)
    case 20: admit_recovery_cli(rest)
    case 21: recovery_complete_cli(rest)
    case 22: role_binding_cli(rest)
    case 23: role_identity_cli(rest)
    case 24: role_guard_cli(rest)
    case _: IO.die(Unit,2,"instance mode required")

def cli(args: List<String>) -> IO(Unit):
  match args:
    case +mode <> rest: dispatch(mode_number(mode),rest)
    case _: IO.die(Unit,2,"MODE ARGS...")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
