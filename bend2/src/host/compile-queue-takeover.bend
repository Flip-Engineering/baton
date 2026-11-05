import Base
import ./choice.bend as Choice
import ./compile-queue-files.bend as QF
import ./compile-queue-state.bend as S
import ./compile-queue-process.bend as Proc
import ./posix.bend as P
import ../host/files.bend as F
import ../git/text.bend as Tx

# Takeover replaces waiting supervisors of older queue executables. A waiting
# supervisor holds a scheduling ticket under the state root, has not acquired
# admission, and its executable differs from the current one. Each replaced
# supervisor is stopped, a successor of the current executable continues its
# attempt, and the requester of the attempt reads the successor's result.

def nul() -> String:
  Char.show(Char.from_u32(0))

def reason(+pid: U32, +label: String, +attempt: String) -> String:
  "skipped pid=" ++ U32.show(pid) ++ " reason=" ++ label ++ " attempt=" ++ attempt ++ "\n"

def proc_base(+pid: U32) -> String:
  "/proc/" ++ U32.show(pid)

# The mount namespace of a process, compared with the current one. A
# supervisor in another mount namespace is reported and left alone: the
# takeover command may not see its working directory.
def namespace_result_match(+own: String, theirs: Result<&1,&1,U32 & String,String>) -> String:
  match theirs:
    case Fail{(code,message)}: "mount-namespace-error-" ++ U32.show(code)
    case Done{other}: Choice.choose(String,Tx.str_eq(own,other), _choice_unit => "", _choice_unit => "other-mount-namespace")

def namespace_result(mine: Result<&1,&1,U32 & String,String>, theirs: Result<&1,&1,U32 & String,String>) -> String:
  match mine:
    case Fail{(code,message)}: "mount-namespace-error-" ++ U32.show(code)
    case Done{own}: namespace_result_match(own, theirs)

def namespace(+pid: U32) -> IO(String):
  do IO<String>:
    mine : Result<&1,&1,U32 & String,String> <- F.Files.readlink("/proc/self/ns/mnt")
    theirs : Result<&1,&1,U32 & String,String> <- F.Files.readlink(proc_base(pid) ++ "/ns/mnt")
    IO.pure(String,namespace_result(mine,theirs))

# A supervisor of the same user. The stat record fields are separated by tab;
# the user id is the seventh field.
def owned_match(+uid: U32, observed: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match observed:
    case Fail{error}: IO.pure(Bool,False{})
    case Done{record}: IO.pure(Bool,U32.is_eq(S.number(S.at(String.split(record,Char.from_u32(9)),6)),uid))

def owned(+pid: U32) -> IO(Bool):
  do IO<Bool>:
    +uid : U32 <- IO.try(U32,P.HostPosix.uid())
    observed : Result<&1,&1,U32 & String,String> <- F.Files.lstat(proc_base(pid))
    owned_match(uid, observed)

# A supervisor of another queue executable. The stat record identifies the
# executable by device and inode; fields two and three, separated by tab.
def other_executable_match(+mine: String, other: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match other:
    case Fail{error}: IO.pure(Bool,False{})
    case Done{+theirs}:
      IO.pure(Bool,Bool.not(Bool.and(
        Tx.str_eq(S.at(String.split(mine,Char.from_u32(9)),2),S.at(String.split(theirs,Char.from_u32(9)),2)),
        Tx.str_eq(S.at(String.split(mine,Char.from_u32(9)),3),S.at(String.split(theirs,Char.from_u32(9)),3)))))

def other_executable_result(own: Result<&1,&1,U32 & String,String>, other: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match own:
    case Fail{error}: IO.pure(Bool,False{})
    case Done{+mine}: other_executable_match(mine,other)

def other_executable(+pid: U32) -> IO(Bool):
  do IO<Bool>:
    own : Result<&1,&1,U32 & String,String> <- F.Files.stat("/proc/self/exe")
    other : Result<&1,&1,U32 & String,String> <- F.Files.stat(proc_base(pid) ++ "/exe")
    other_executable_result(own, other)

def has_pid(items: List<&2,String>, +pid: U32) -> Bool:
  match items:
    case Nil{}: False{}
    case item <> rest: Bool.or(U32.is_eq(S.number(S.field(item,"pid")),pid),has_pid(rest,pid))

# A stopped process keeps its /proc record; the state letter follows the
# closing parenthesis of the command name in the stat text.
def stat_state_letter(+text: String) -> String:
  S.at(String.split(S.last(String.split(text,Char.from_u32(41))),Char.from_u32(32)),1)

@unsafe
def stopped_match(~again_stopped: (@+pid: U32 -> @+start: String -> IO(Bool)), +start: String, +pid: U32, live: Result<&1,&1,U32 & String,U32>) -> IO(Bool):
  match live:
    case Fail{error}: IO.pure(Bool,False{})
    case Done{value}:
      Bool.pick(IO(Bool),U32.is_eq(value,0),IO.pure(Bool,False{}),
        do IO<Bool>:
          +text : String <- S.read(proc_base(pid) ++ "/stat")
          +state : String <- IO.pure(String,stat_state_letter(text))
          Bool.pick(IO(Bool),Bool.or(Tx.str_eq(state,"T"),Tx.str_eq(state,"t")),IO.pure(Bool,True{}),
            do IO<Bool>:
              slept : Unit <- IO.sleep(20)
              again_stopped(pid,start)))

@unsafe
def stopped(+pid: U32, +start: String) -> IO(Bool):
  do IO<Bool>:
    live : Result<&1,&1,U32 & String,U32> <- P.HostPosix.alive(pid,start)
    stopped_match(stopped, start, pid, live)

# The successor continues the attempt in the position of the old supervisor:
# it inherits the key lock of the attempt and the shared heavy lock, and the
# environment of the old supervisor.
def successor_match(+old_pid: String, +args: String, +key_fd: U32, heavy: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,U32>):
  match heavy:
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,U32>>:
        closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(key_fd)
        IO.pure(Result<&1,&1,U32 & String,U32>,Fail{error})
    case Done{+heavy_fd}:
      do IO<Result<&1,&1,U32 & String,U32>>:
        +environment : String <- S.read(proc_base(S.number(old_pid)) ++ "/environ")
        result : Result<&1,&1,U32 & String,U32> <- P.HostPosix.spawn_detached(args,key_fd,heavy_fd,environment)
        key_closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(key_fd)
        heavy_closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(heavy_fd)
        IO.pure(Result<&1,&1,U32 & String,U32>,result)

def successor(+state: String, +attempt: String, +old_pid: String, +old_start: String, +queued: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    +self : String <- IO.try(String,P.HostPosix.self_exe())
    +args : String <- IO.pure(String,self ++ nul() ++ "--" ++ nul() ++ "__takeover" ++ nul() ++ attempt ++ nul() ++ old_pid ++ nul() ++ old_start ++ nul() ++ queued ++ nul())
    +meta : String <- S.read(attempt ++ "/meta")
    +key_fd : U32 <- IO.try(U32,P.HostPosix.lock_open(S.field(meta,"keydir") ++ "/lock"))
    heavy : Result<&1,&1,U32 & String,U32> <- P.HostPosix.lock_open(state ++ "/heavy.lock")
    successor_match(old_pid, args, key_fd, heavy)

def original_args(+args: List<&2,String>, +pid: U32, +start: String, +queued: String) -> String:
  match args:
    case Nil{}: ""
    case +verb <> +rest:
      +length = List.length(&2,String,rest)
      Choice.choose(String,Bool.and(Tx.str_eq(verb,"__supervise"),Nat.is_eq(length,1n)),
        _choice_unit => "attempt=" ++ S.first(rest) ++ "\nold_pid=" ++ U32.show(pid) ++ "\nold_start=" ++ start ++ "\nqueued=" ++ queued ++ "\n",
        _choice_unit => Choice.choose(String,Bool.and(Tx.str_eq(verb,"__takeover"),Nat.is_eq(length,4n)),
          _choice_unit => "attempt=" ++ S.at(rest,0) ++ "\nold_pid=" ++ S.at(rest,1) ++ "\nold_start=" ++ S.at(rest,2) ++ "\nqueued=" ++ S.at(rest,3) ++ "\nsuccessor_kind=1\n",
          _choice_unit => original_args(rest,pid,start,queued)))

def resume_match(+pid: U32, alive: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
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
    resume_match(pid, alive)

def admission_root(+state: String) -> String:
  state ++ "/admission"

def waiters_dir(+state: String) -> String:
  state ++ "/waiters"

def kind_waiters_dir(+state: String, +kind: String) -> String:
  Bool.pick(String, Tx.str_eq(kind,"cc"), waiters_dir(state) ++ "/cc", waiters_dir(state))

def claim_bodies(+state: String, +dir: String, names: List<&1,String>, +acc: List<&2,String>) -> IO(List<&2,String>):
  match names:
    case Nil{}: IO.pure(List<&2,String>,acc)
    case Con{+name, rest}:
      do IO<List<&2,String>>:
        text : String <- S.read(dir ++ "/" ++ name)
        claim_bodies(state,dir,rest, text <> acc)

def live_claims(+state: String) -> IO(List<&2,String>):
  do IO<List<&2,String>>:
    +dir : String <- IO.pure(String, admission_root(state) ++ "/running")
    names : String <- IO.try(String,QF.list_dir(dir))
    claim_bodies(state,dir,Tx.split_nul(names),Nil{})

def publish_success(result: Result<&1,&1,U32 & String,U32>, +pid: U32, +start: String, +details: String) -> IO(String):
  match result:
    case Fail{(code,message)}:
      do IO<String>:
        continued : Unit <- resume(pid,start)
        IO.pure(String,"failed pid=" ++ U32.show(pid) ++ " errno=" ++ U32.show(code) ++ " attempt=" ++ S.field(details,"attempt") ++ "\n")
    case Done{+child}:
      do IO<String>:
        killed : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),Tx.str_eq(S.field(details,"successor_kind"),"1"),P.HostPosix.signal_pid(pid,9),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
        saved : Unit <- IO.try(Unit,F.Files.write_shared(S.field(details,"attempt") ++ "/takeover","pid=" ++ S.field(details,"old_pid") ++ "\nstarttime=" ++ S.field(details,"old_start") ++ "\nsuccessor=" ++ U32.show(child) ++ "\n"))
        IO.pure(String,"retaken pid=" ++ U32.show(pid) ++ " successor=" ++ U32.show(child) ++ " attempt=" ++ S.field(details,"attempt") ++ "\n")

# The ticket of a replaced supervisor leaves the scheduling directory, so
# the successor is not ordered behind a process that no longer competes.
def replace_stopped(+state: String, +pid: U32, +start: String, +details: String, +ticket_path: String) -> IO(String):
  do IO<String>:
    +stopped_now : Bool <- stopped(pid,start)
    +claims : List<&2,String> <- live_claims(state)
    Bool.pick(IO(String),Bool.and(stopped_now,Bool.not(has_pid(claims,pid))),
      do IO<String>:
        removed : Unit <- IO.try(Unit,F.Files.remove(ticket_path))
        result : Result<&1,&1,U32 & String,U32> <- successor(state,S.field(details,"attempt"),S.field(details,"old_pid"),S.field(details,"old_start"),S.field(details,"queued"))
        publish_success(result,pid,start,details),
      do IO<String>:
        continued : Unit <- resume(pid,start)
        IO.pure(String,reason(pid,"not-waiting",S.field(details,"attempt"))))

# The current claim view is checked while the admission lock is held. An
# admitted holder is left running even when a previously read ticket named
# its pid.
def replace_locked_stopped(+start: String, +pid: U32, +state: String, +details: String, +ticket_path: String, sigstop: Result<&1,&1,U32 & String,Unit>) -> IO(String):
  match sigstop:
    case Fail{(code,message)}: IO.pure(String,reason(pid,"not-permitted-" ++ U32.show(code),S.field(details,"attempt")))
    case Done{unit}: replace_stopped(state,pid,start,details,ticket_path)

def replace_locked_live(+start: String, +pid: U32, +state: String, +details: String, +ticket_path: String, +claims : List<&2,String>, live: Result<&1,&1,U32 & String,U32>) -> IO(String):
  match live:
    case Fail{error}: IO.pure(String,reason(pid,"not-waiting",S.field(details,"attempt")))
    case Done{value}:
      Bool.pick(IO(String),Bool.and(Bool.not(has_pid(claims,pid)),U32.is_gt(value,0)),
        do IO<String>:
          sigstop : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.signal_pid(pid,19)
          replace_locked_stopped(start, pid, state, details, ticket_path, sigstop),
        IO.pure(String,reason(pid,"not-waiting",S.field(details,"attempt"))))

def replace_locked(+state: String, +pid: U32, +start: String, +details: String, +ticket_path: String) -> IO(String):
  do IO<String>:
    +claims : List<&2,String> <- live_claims(state)
    live : Result<&1,&1,U32 & String,U32> <- P.HostPosix.alive(pid,start)
    replace_locked_live(start, pid, state, details, ticket_path, claims, live)

def replace_match(+start: String, +pid: U32, +state: String, +details: String, +ticket_path: String, locked: Result<&1,&1,U32 & String,U32>) -> IO(String):
  match locked:
    case Fail{(code,message)}: IO.pure(String,reason(pid,"no-lock-" ++ U32.show(code),S.field(details,"attempt")))
    case Done{fd}:
      do IO<String>:
        +result : String <- replace_locked(state,pid,start,details,ticket_path)
        closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.lock_release(fd)
        IO.pure(String,result)

def replace(+state: String, +pid: U32, +start: String, +details: String, +ticket_path: String) -> IO(String):
  do IO<String>:
    +owned_now : Bool <- owned(pid)
    +space : String <- namespace(pid)
    Bool.pick(IO(String),Bool.and(owned_now,String.is_empty(space)),
      do IO<String>:
        locked : Result<&1,&1,U32 & String,U32> <- P.HostPosix.lock_acquire(admission_root(state) ++ "/lock")
        replace_match(start, pid, state, details, ticket_path, locked),
      IO.pure(String,reason(pid,Choice.choose(String,owned_now, _choice_unit => space, _choice_unit => "other-uid-or-unreadable"),S.field(details,"attempt"))))


def replace_ticket(+ticket: String, +state: String, +dir: String) -> IO(String):
  do IO<String>:
    +pid : U32 <- IO.pure(U32,S.number(S.field(ticket,"pid")))
    args : Result<&1,&1,U32 & String,String> <- Proc.cmdline(pid)
    +details : String <- IO.pure(String,original_args(QF.nonempty(String.split(S.text_or_empty(args),Char.from_u32(0))),pid,S.field(ticket,"starttime"),S.field(ticket,"token")))
    +other : Bool <- other_executable(pid)
    +self : U32 <- IO.try(U32,P.HostPosix.pid())
    +attempt : String <- IO.pure(String,S.field(details,"attempt"))
    +meta : String <- S.read(attempt ++ "/meta")
    +eligible : Bool <- IO.pure(Bool,Bool.and(other,Bool.and(U32.is_ne(self,pid),Tx.str_eq(S.field(meta,"state_root"),state))))
    Bool.pick(IO(String),eligible,replace(state,pid,S.field(ticket,"starttime"),details,dir ++ "/" ++ S.field(ticket,"token")),IO.pure(String,""))

def replace_rows(items: List<&2,String>, +state: String, +dir: String) -> IO(String):
  match items:
    case Nil{}: IO.pure(String,"")
    case item <> rest:
      do IO<String>:
        +current : String <- replace_ticket(item,state,dir)
        +tail : String <- replace_rows(rest,state,dir)
        IO.pure(String,current ++ tail)

def read_tickets(+state: String, +dir: String, +names: List<&2,String>, +acc: List<&2,String>) -> IO(List<&2,String>):
  match names:
    case Nil{}: IO.pure(List<&2,String>,acc)
    case +name <> +rest:
      do IO<List<&2,String>>:
        text : String <- S.read(dir ++ "/" ++ name)
        read_tickets(state,dir,rest, text <> acc)

# The top waiter directory also holds the cc subdirectory; only files are
# tickets there.
def copy_names(args: List<&1,String>, +acc: List<&2,String>) -> List<&2,String>:
  match args:
    case Nil{}: List.reverse(&2,String,acc)
    case Con{+name, rest}: copy_names(rest, Con{name,acc})

def files_only(names: List<&2,String>) -> List<&2,String>:
  match names:
    case Nil{}: Nil{}
    case +name <> +rest: Choice.choose(List<&2,String>, Tx.str_eq(name,"cc"), _choice_unit => files_only(rest), _choice_unit => name <> files_only(rest))

def replace_group(+state: String, +dir: String, +names: List<&2,String>) -> IO(String):
  do IO<String>:
    +tickets : List<&2,String> <- read_tickets(state,dir,names,Nil{})
    replace_rows(tickets,state,dir)

def directories(+state: String) -> IO(Unit):
  do IO<Unit>:
    made_running : Unit <- IO.try(Unit,QF.mkdir_p(admission_root(state) ++ "/running"))
    made_usage : Unit <- IO.try(Unit,QF.mkdir_p(admission_root(state) ++ "/usage"))
    made_waiting : Unit <- IO.try(Unit,P.HostPosix.mkdir_sticky(admission_root(state) ++ "/waiting"))
    made_waiters : Unit <- IO.try(Unit,QF.mkdir_p(waiters_dir(state)))
    made_waiters_cc : Unit <- IO.try(Unit,QF.mkdir_p(kind_waiters_dir(state,"cc")))
    IO.pure(Unit,Unit{})

def run_linux(+state: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    dirs : Unit <- directories(state)
    cc_names : String <- IO.try(String,QF.list_dir(kind_waiters_dir(state,"cc")))
    other_names : String <- IO.try(String,QF.list_dir(waiters_dir(state)))
    +cc_rows : String <- replace_group(state,kind_waiters_dir(state,"cc"),copy_names(Tx.split_nul(cc_names),Nil{}))
    +other_rows : String <- replace_group(state,waiters_dir(state),files_only(copy_names(Tx.split_nul(other_names),Nil{})))
    IO.pure(Result<&1,&1,U32 & String,String>,Done{cc_rows ++ other_rows})

def run_platform(+state: String, +platform: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>),Tx.str_eq(platform,"linux"),
    run_linux(state),
    IO.pure(Result<&1,&1,U32 & String,String>,Fail{(38,"takeover requires Linux process and lock observations")}))

def run(+state: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +platform : String <- IO.try(String,P.HostPosix.platform())
    run_platform(state,platform)
