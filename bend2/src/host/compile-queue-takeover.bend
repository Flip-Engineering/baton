import Base
import ./choice.bend as Choice
import ./compile-queue-state.bend as S
import ./compile-queue-files.bend as QF
import ./compile-queue-process.bend as Proc
import ./compile-queue-admission.bend as A
import ./posix.bend as P
import ../host/files.bend as F
import ../host/text.bend as T

def nul() -> String:
  Char.show(Char.from_u32(0))

def reason(+pid: U32, +label: String, +attempt: String) -> String:
  "skipped pid=" ++ U32.show(pid) ++ " reason=" ++ label ++ " attempt=" ++ attempt ++ "\n"

def namespace_result_match_10(+own: String, theirs: Result<&1,&1,U32 & String,String>) -> String:
  match theirs:
    case Fail{(code,message)}: "mount-namespace-error-" ++ U32.show(code)
    case Done{other}: Choice.choose(String,String.eq(own,other), _choice_unit => "", _choice_unit => "other-mount-namespace")

def namespace_result(mine: Result<&1,&1,U32 & String,String>, theirs: Result<&1,&1,U32 & String,String>) -> String:
  match mine:
    case Fail{(code,message)}: "mount-namespace-error-" ++ U32.show(code)
    case Done{own}:
      namespace_result_match_10(own, theirs)

def namespace( +pid: U32) -> IO(String):
  do IO<String>:
    mine : Result<&1,&1,U32 & String,String> <- F.Files.readlink("/proc/self/ns/mnt")
    theirs : Result<&1,&1,U32 & String,String> <- F.Files.readlink(Proc.proc_base(pid) ++ "/ns/mnt")
    IO.pure(String,namespace_result(mine,theirs))

def owned_match_9(+uid: U32, observed: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match observed:
    case Fail{error}: IO.pure(Bool,False{})
    case Done{record}: IO.pure(Bool,U32.is_eq(S.number(S.at(String.split(record,Char.from_u32(9)),6)),uid))

def owned( +pid: U32) -> IO(Bool):
  do IO<Bool>:
    +uid : U32 <- IO.try(U32,P.HostPosix.uid())
    observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(Proc.proc_base(pid))
    owned_match_9(uid, observed)

def other_executable_match_7(+mine: String, other: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match other:
    case Fail{error}: IO.pure(Bool,False{})
    case Done{+theirs}:
      IO.pure(Bool,Bool.not(Bool.and(String.eq(S.at(String.split(mine,Char.from_u32(9)),2),S.at(String.split(theirs,Char.from_u32(9)),2)),String.eq(S.at(String.split(mine,Char.from_u32(9)),3),S.at(String.split(theirs,Char.from_u32(9)),3)))))

def other_executable_match_8(own: Result<&1,&1,U32 & String,String>, other: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match own:
    case Fail{error}: IO.pure(Bool,False{})
    case Done{+mine}:
      other_executable_match_7(mine,other)

def other_executable( +pid: U32) -> IO(Bool):
  do IO<Bool>:
    own : Result<&1,&1,U32 & String,String> <- F.Files.stat("/proc/self/exe")
    other : Result<&1,&1,U32 & String,String> <- F.Files.stat(Proc.proc_base(pid) ++ "/exe")
    other_executable_match_8(own, other)

def has_pid( +items: List<&2,String>, +pid: U32) -> Bool:
  match items:
    case Nil{}: False{}
    case item <> rest: Bool.or(U32.is_eq(S.number(S.field(item,"pid")),pid),has_pid(rest,pid))

@unsafe
def stopped_match_6(~again_stopped: (@+pid: U32 -> @+start: String -> IO(Bool)), +start: String, +pid: U32, live: Result<&1,&1,U32 & String,U32>) -> IO(Bool):
  match live:
    case Fail{error}: IO.pure(Bool,False{})
    case Done{value}:
      Bool.pick(IO(Bool),U32.is_eq(value,0),IO.pure(Bool,False{}),
        do IO<Bool>:
          +text : String <- S.read(Proc.proc_base(pid) ++ "/stat")
          +state : String <- IO.pure(String,S.first(Proc.stat_fields(text)))
          Bool.pick(IO(Bool),Bool.or(String.eq(state,"T"),String.eq(state,"t")),IO.pure(Bool,True{}),
            do IO<Bool>:
              slept : Unit <- IO.sleep(20)
              again_stopped(pid,start)))

@unsafe
def stopped(+pid: U32, +start: String) -> IO(Bool):
  do IO<Bool>:
    live : Result<&1,&1,U32 & String,U32> <- P.HostPosix.alive(pid,start)
    stopped_match_6(stopped, start, pid, live)

def successor_match_5(+old_pid: String, +args: String, +key_fd: U32, heavy: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,U32>):
  match heavy:
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,U32>>:
        closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(key_fd)
        IO.pure(Result<&1,&1,U32 & String,U32>,Fail{error})
    case Done{+heavy_fd}:
      do IO<Result<&1,&1,U32 & String,U32>>:
        +environment : String <- S.read(Proc.proc_base(S.number(old_pid)) ++ "/environ")
        result : Result<&1,&1,U32 & String,U32> <- P.HostPosix.spawn_detached(args,key_fd,heavy_fd,environment)
        key_closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(key_fd)
        heavy_closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(heavy_fd)
        IO.pure(Result<&1,&1,U32 & String,U32>,result)

def successor(+state: String, +attempt: String, +old_pid: String, +old_start: String, +queued: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    +self : String <- IO.try(String,P.HostPosix.self_exe())
    +args : String <- IO.pure(String,self ++ nul() ++ "--" ++ nul() ++ "__takeover" ++ nul() ++ attempt ++ nul() ++ old_pid ++ nul() ++ old_start ++ nul() ++ queued ++ nul())
    +key_fd : U32 <- IO.try(U32,P.HostPosix.lock_open(S.keydir(attempt) ++ "/lock"))
    heavy : Result<&1,&1,U32 & String,U32> <- P.HostPosix.lock_open(state ++ "/heavy.lock")
    successor_match_5(old_pid, args, key_fd, heavy)

def original_args(+args: List<&2,String>, +pid: U32, +start: String, +queued: String) -> String:
  match args:
    case Nil{}: ""
    case +verb <> +rest:
      +length = List.length(&2,String,rest)
      Choice.choose(String,Bool.and(String.eq(verb,"__supervise"),Nat.is_eq(length,1n)),
        _choice_unit => "attempt=" ++ S.first(rest) ++ "\nold_pid=" ++ U32.show(pid) ++ "\nold_start=" ++ start ++ "\nqueued=" ++ queued ++ "\n",
        _choice_unit => Choice.choose(String,Bool.and(String.eq(verb,"__takeover"),Nat.is_eq(length,4n)),
          _choice_unit => "attempt=" ++ S.at(rest,0) ++ "\nold_pid=" ++ S.at(rest,1) ++ "\nold_start=" ++ S.at(rest,2) ++ "\nqueued=" ++ S.at(rest,3) ++ "\nsuccessor_kind=1\n",
          _choice_unit => original_args(rest,pid,start,queued)))

def resume_match_4(+pid: U32, alive: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match alive:
    case Done{value}:
      Bool.pick(IO(Unit),U32.is_gt(value,0),
        do IO<Unit>:
          continued : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.signal_pid(pid,18)
          IO.pure(Unit,Unit{}),IO.pure(Unit,Unit{}))
    case Fail{error}: IO.pure(Unit,Unit{})

def resume(+pid: U32, +start: String) -> IO(Unit):
  do IO<Unit>:
    alive : Result<&1,&1,U32 & String,U32> <- P.HostPosix.alive(pid,start)
    resume_match_4(pid, alive)

def publish_success(result: Result<&1,&1,U32 & String,U32>, +pid: U32, +start: String, +details: String, +legacy: Bool) -> IO(String):
  match result:
    case Fail{(code,message)}:
      do IO<String>:
        continued : Unit <- resume(pid,start)
        IO.pure(String,"failed pid=" ++ U32.show(pid) ++ " errno=" ++ U32.show(code) ++ " attempt=" ++ S.field(details,"attempt") ++ "\n")
    case Done{+child}:
      do IO<String>:
        killed : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.eq(S.field(details,"successor_kind"),"1"),P.HostPosix.signal_pid(pid,9),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
        saved : Unit <- S.write(S.field(details,"attempt") ++ "/takeover","pid=" ++ S.field(details,"old_pid") ++ "\nstarttime=" ++ S.field(details,"old_start") ++ "\nsuccessor=" ++ U32.show(child) ++ "\n")
        IO.pure(String,Choice.choose(String,legacy, _choice_unit => "taken-over", _choice_unit => "retaken") ++ " pid=" ++ U32.show(pid) ++ " successor=" ++ U32.show(child) ++ " attempt=" ++ S.field(details,"attempt") ++ "\n")

def replace_stopped(+state: String, +pid: U32, +start: String, +details: String, +legacy: Bool, +ticket_id: String) -> IO(String):
  do IO<String>:
    +stopped : Bool <- stopped(pid,start)
    +view : A.QueueView <- A.load(state)
    +valid : Bool <- IO.pure(Bool,Bool.and(stopped,Bool.and(Bool.not(has_pid(A.claims(view),pid)),Choice.choose(Bool,legacy, _choice_unit => U32.is_ne(S.number(S.field(A.facts(view),"legacy_pid")),pid), _choice_unit => has_pid(A.tickets(view),pid)))))
    Bool.pick(IO(String),valid,
      do IO<String>:
        removed : Unit <- Bool.pick(IO(Unit),legacy,IO.pure(Unit,Unit{}),S.remove(state ++ "/admission/waiting/" ++ ticket_id))
        result : Result<&1,&1,U32 & String,U32> <- successor(state,S.field(details,"attempt"),S.field(details,"old_pid"),S.field(details,"old_start"),S.field(details,"queued"))
        publish_success(result,pid,start,details,legacy),
      do IO<String>:
        continued : Unit <- resume(pid,start)
        IO.pure(String,reason(pid,"not-waiting",S.field(details,"attempt"))))

# The current admission view is checked while its lock is held. An admitted
# holder is left running even when a previously read ticket named its pid.

def replace_locked_match_2(+start: String, +pid: U32, +state: String, +details: String, +legacy: Bool, +ticket_id: String, stopped: Result<&1,&1,U32 & String,Unit>) -> IO(String):
  match stopped:
    case Fail{(code,message)}: IO.pure(String,reason(pid,"not-permitted-" ++ U32.show(code),S.field(details,"attempt")))
    case Done{unit}: replace_stopped(state,pid,start,details,legacy,ticket_id)

def replace_locked_match_3(+start: String, +pid: U32, +state: String, +details: String, +legacy: Bool, +ticket_id: String, +waiting: Bool, live: Result<&1,&1,U32 & String,U32>) -> IO(String):
  match live:
    case Fail{error}: IO.pure(String,reason(pid,"not-waiting",S.field(details,"attempt")))
    case Done{value}:
      Bool.pick(IO(String),Bool.and(waiting,U32.is_gt(value,0)),
        do IO<String>:
          stopped : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.signal_pid(pid,19)
          replace_locked_match_2(start, pid, state, details, legacy, ticket_id, stopped),
        IO.pure(String,reason(pid,"not-waiting",S.field(details,"attempt"))))

def replace_locked(+state: String, +pid: U32, +start: String, +details: String, +legacy: Bool, +ticket_id: String) -> IO(String):
  do IO<String>:
    +view : A.QueueView <- A.load(state)
    +waiting : Bool <- IO.pure(Bool,Bool.and(Bool.not(has_pid(A.claims(view),pid)),Choice.choose(Bool,legacy, _choice_unit => U32.is_ne(S.number(S.field(A.facts(view),"legacy_pid")),pid), _choice_unit => has_pid(A.tickets(view),pid))))
    live : Result<&1,&1,U32 & String,U32> <- P.HostPosix.alive(pid,start)
    replace_locked_match_3(start, pid, state, details, legacy, ticket_id, waiting, live)

def replace_match_1(+start: String, +pid: U32, +state: String, +details: String, +legacy: Bool, +ticket_id: String, locked: Result<&1,&1,U32 & String,U32>) -> IO(String):
  match locked:
    case Fail{(code,message)}: IO.pure(String,reason(pid,"no-lock-" ++ U32.show(code),S.field(details,"attempt")))
    case Done{fd}:
      do IO<String>:
        +result : String <- replace_locked(state,pid,start,details,legacy,ticket_id)
        closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.lock_release(fd)
        IO.pure(String,result)

def replace(+state: String, +pid: U32, +start: String, +details: String, +legacy: Bool, +ticket_id: String) -> IO(String):
  do IO<String>:
    +owned : Bool <- owned(pid)
    +namespace : String <- namespace(pid)
    Bool.pick(IO(String),Bool.and(owned,String.is_empty(namespace)),
      do IO<String>:
        locked : Result<&1,&1,U32 & String,U32> <- A.lock(state)
        replace_match_1(start, pid, state, details, legacy, ticket_id, locked),
      IO.pure(String,reason(pid,Choice.choose(String,owned, _choice_unit => namespace, _choice_unit => "other-uid-or-unreadable"),S.field(details,"attempt"))))

def replace_ticket(+ticket: String, +state: String, +legacy: Bool) -> IO(String):
  do IO<String>:
    +pid : U32 <- IO.pure(U32,S.number(S.field(ticket,"pid")))
    args : Result<&1,&1,U32 & String,String> <- Proc.cmdline(pid)
    +details : String <- IO.pure(String,original_args(S.argv_parts(String.split(S.text_or_empty(args),Char.from_u32(0))),pid,S.field(ticket,"starttime"),S.field(ticket,"queued_ns")))
    +other : Bool <- Bool.pick(IO(Bool),legacy,IO.pure(Bool,True{}),other_executable(pid))
    +self : U32 <- IO.try(U32,P.HostPosix.pid())
    +eligible : Bool <- IO.pure(Bool,Bool.and(other,Bool.and(U32.is_ne(self,pid),String.eq(S.state(S.field(details,"attempt")),state))))
    Bool.pick(IO(String),eligible,replace(state,pid,S.field(ticket,"starttime"),details,legacy,S.field(ticket,"id")),IO.pure(String,""))

def legacy_tickets( +pids: List<&2,U32>, +state: String, +seen: List<&2,U32>) -> IO(List<&2,String>):
  match pids:
    case Nil{}: IO.pure(List<&2,String>,Nil{})
    case +pid <> rest:
      do IO<List<&2,String>>:
        +attempt : String <- Proc.attempt(pid)
        +active : String <- S.read(S.keydir(attempt) ++ "/active")
        marker : Result<&1,&1,U32 & String,String> <- F.Files.lstat(attempt ++ "/takeover")
        start : Result<&1,&1,U32 & String,String> <- P.HostPosix.starttime(pid)
        +start_text : String <- IO.pure(String,S.text_or_empty(start))
        +tail : List<&2,String> <- legacy_tickets(rest,state,pid <> seen)
        IO.pure(List<&2,String>,Choice.choose(List<&2,String>,Bool.and(Bool.not(Proc.contains_pid(seen,pid)),Bool.and(String.eq(S.state(attempt),state),Bool.and(String.is_empty(S.text_or_empty(marker)),Bool.not(String.is_empty(start_text))))), _choice_unit =>
          ("pid=" ++ U32.show(pid) ++ "\nstarttime=" ++ start_text ++ "\nqueued_ns=" ++ S.field(active,"started_ns") ++ "\n") <> tail, _choice_unit => tail))

def replace_rows( +items: List<&2,String>, +state: String, +legacy: Bool) -> IO(String):
  match items:
    case Nil{}: IO.pure(String,"")
    case item <> rest:
      do IO<String>:
        +current : String <- replace_ticket(item,state,legacy)
        +tail : String <- replace_rows(rest,state,legacy)
        IO.pure(String,current ++ tail)

def linux(+state: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    dirs : Unit <- IO.try(Unit,A.directories(state))
    +pids : List<&2,U32> <- Proc.locks(state,True{})
    +legacy : List<&2,String> <- legacy_tickets(pids,state,Nil{})
    +first : String <- replace_rows(legacy,state,True{})
    +fd : U32 <- IO.try(U32,A.lock(state))
    +view : A.QueueView <- A.load(state)
    closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.lock_release(fd)
    +next : String <- replace_rows(A.tickets(view),state,False{})
    IO.pure(Result<&1,&1,U32 & String,String>,Done{first ++ next})

def run( +state: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +platform : String <- IO.try(String,P.HostPosix.platform())
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(platform,"linux"),linux(state),IO.pure(Result<&1,&1,U32 & String,String>,Fail{(38,"takeover requires Linux process and lock observations")}))
