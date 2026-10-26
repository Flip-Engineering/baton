import Base
import ./compile-queue-state.bend as S
import ./compile-queue-process.bend as Proc
import ./compile-queue-admission.bend as A
import ./compile-queue-history.bend as H
import ./posix.bend as P
import ../host/files.bend as F
import ./wide.bend as W

# Sampler state lasts for the owned execution. Usage and peak files remain the
# observations consumed by the existing admission and history contracts.
def claim_set( +items: List<&2,String>) -> W.Wide64:
  match items:
    case Nil{}: W.zero()
    case item <> rest: W.add(S.fnv(S.field(item,"id"),W.Wide64{3421674724,2216829733}),claim_set(rest))

def steady_claims( +items: List<&2,String>) -> Bool:
  match items:
    case Nil{}: True{}
    case +item <> rest: Bool.and(Nat.is_gt(S.nat(S.field(item,"current_kb")),0n),Bool.and(Bool.not(String.eq(S.field(item,"unreliable"),"1")),steady_claims(rest)))

def listed( +items: List<&2,String>, +id: String) -> Bool:
  match items:
    case Nil{}: False{}
    case item <> rest: Bool.or(String.eq(S.field(item,"id"),id),listed(rest,id))

def outside_sample(+sample: String, +own: Nat, +view: A.QueueView, +again: A.QueueView) -> String:
  +set = claim_set(A.claims(view))
  +steady = Bool.and(steady_claims(A.claims(view)),Bool.and(W.equal(set,claim_set(A.claims(again))),Bool.or(String.is_empty(S.field(sample,"claims")),String.eq(W.hex(set),S.field(sample,"claims")))))
  +unsteady = Nat.add(S.nat(S.field(sample,"unsteady")),1n)
  +outside = Nat.sub(A.outside(view),Bool.pick(Nat,listed(A.claims(view),S.field(sample,"claim")),0n,own))
  +baseline = Bool.pick(Nat,String.is_empty(S.field(sample,"baseline")),outside,S.nat(S.field(sample,"baseline")))
  Bool.pick(String,steady,
    S.put(S.put(S.put(S.put(S.put(sample,"claims",W.hex(set)),"unsteady","0"),"baseline",Nat.show(baseline)),"growth",Nat.show(Nat.sub(outside,baseline))),"samples",Nat.show(Nat.add(S.nat(S.field(sample,"samples")),1n))),
    S.put(S.put(S.put(sample,"claims",W.hex(set)),"unsteady",Nat.show(unsteady)),"growth",Bool.pick(String,Nat.is_ge(unsteady,5n),"0",S.field(sample,"growth"))))

def outside_locked(+state: String, +sample: String, +own: Nat) -> IO(String):
  do IO<String>:
    +view : A.QueueView <- A.load(state)
    +again : A.QueueView <- A.load(state)
    IO.pure(String,Bool.pick(String,Nat.is_gt(S.nat(S.field(A.facts(view),"total")),0n),outside_sample(sample,own,view,again),sample))

def sample_outside(+sample: String, +own: Nat) -> IO(String):
  do IO<String>:
    +state : String <- IO.pure(String,S.field(sample,"state"))
    locked : Result<&1,&1,U32 & String,U32> <- A.lock(state)
    match locked:
      case Fail{error}: IO.pure(String,sample)
      case Done{fd}:
        do IO<String>:
          +next : String <- outside_locked(state,sample,own)
          closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.lock_release(fd)
          IO.pure(String,next)

def publish(+sample: String, +own: Nat) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(S.field(sample,"claim")),IO.pure(Unit,Unit{}),
    S.write(S.field(sample,"state") ++ "/admission/usage/" ++ S.field(sample,"claim"),"kb=" ++ Nat.show(own) ++ "\ngrowth_kb=" ++ S.field(sample,"growth") ++ "\n"))

def take_sample(+sample: String, +now: String) -> IO(String):
  do IO<String>:
    +table : List<&2,String> <- Proc.table()
    +root : U32 <- IO.try(U32,P.HostPosix.sid())
    +kb : Nat <- Proc.measure(table,root,False{})
    +current : String <- IO.pure(String,S.put(S.put(sample,"peak",Nat.show(Nat.max(S.nat(S.field(sample,"peak")),kb))),"next",W.after(now,2000000000)))
    saved : Unit <- publish(current,kb)
    +next : String <- sample_outside(current,kb)
    saved_again : Unit <- publish(next,kb)
    IO.pure(String,next)

def sample(+state: String, +final: Bool) -> IO(String):
  do IO<String>:
    +now : String <- IO.try(String,P.HostPosix.monotonic_ns())
    Bool.pick(IO(String),Bool.or(final,W.at_or_after(now,S.field(state,"next"))),take_sample(state,now),IO.pure(String,state))

def initialize(+attempt: String) -> IO(String):
  do IO<String>:
    link : Result<&1,&1,U32 & String,String> <- F.Files.readlink("/proc/self/fd/8")
    IO.pure(String,"state=" ++ S.state(attempt) ++ "\nclaim=" ++ S.basename(S.text_or_empty(link)) ++ "\ngrowth=0\npeak=0\nnext=0\n")

def nul() -> String:
  Char.show(Char.from_u32(0))

def watch_command(+attempt: String, +child: U32, +start: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    +self : String <- IO.try(String,P.HostPosix.self_exe())
    +args : String <- IO.pure(String,self ++ nul() ++ "--" ++ nul() ++ "__watch-heavy" ++ nul() ++ attempt ++ nul() ++ U32.show(child) ++ nul() ++ start ++ nul())
    P.HostPosix.spawn_detached(args,9,8,"")

@unsafe
def wait_running(+child: U32, +sample_state: String, +delay: U32) -> IO(Result<&1,&1,U32 & String,String & String>):
  do IO<Result<&1,&1,U32 & String,String & String>>:
    result : Result<&1,&1,U32 & String,String> <- P.HostPosix.try_wait(child)
    match result:
      case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String & String>,Fail{error})
      case Done{+status}:
        Bool.pick(IO(Result<&1,&1,U32 & String,String & String>),String.eq(S.field(status,"running"),"1"),
          do IO<Result<&1,&1,U32 & String,String & String>>:
            +next : String <- sample(sample_state,False{})
            slept : Unit <- IO.sleep(delay)
            wait_running(child,next,U32.min(U32.mul(delay,2),128)),
          IO.pure(Result<&1,&1,U32 & String,String & String>,Done{(status,sample_state)}))

def disposition(+status: String, +canceled: U32) -> U32 & String:
  +signal = S.number(S.field(status,"signal"))
  Bool.pick(U32 & String,U32.is_gt(canceled,0),(130,"canceled"),
    Bool.pick(U32 & String,U32.is_gt(signal,0),(U32.add(128,signal),"signal"),(S.number(S.field(status,"exit")),"exit")))

def finish_wait(result: Result<&1,&1,U32 & String,String & String>, +attempt: String, +canceled: U32) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,U32 & String>,Fail{error})
    case Done{(+status,+sample_state)}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        +final : String <- Bool.pick(IO(String),U32.is_eq(canceled,0),sample(sample_state,True{}),IO.pure(String,sample_state))
        usage : Result<&1,&1,U32 & String,String> <- P.HostPosix.children_peak()
        +peak : Nat <- IO.pure(Nat,Nat.max(S.nat(S.field(final,"peak")),S.nat(S.text_or_empty(usage))))
        recorded : Unit <- Bool.pick(IO(Unit),U32.is_eq(canceled,0),H.record(attempt,peak,Bool.not(Bool.and(String.eq(S.field(status,"exit"),"0"),String.eq(S.field(status,"signal"),"0")))),IO.pure(Unit,Unit{}))
        IO.pure(Result<&1,&1,U32 & String,U32 & String>,Done{disposition(status,canceled)})

def run_started(started: Result<&1,&1,U32 & String,Unit>, +child: U32, +attempt: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  match started:
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        waited : Result<&1,&1,U32 & String,U32> <- P.HostPosix.wait_pid(child)
        restored : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.restore_signals()
        IO.pure(Result<&1,&1,U32 & String,U32 & String>,Fail{error})
    case Done{unit}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        +sample_state : String <- initialize(attempt)
        result : Result<&1,&1,U32 & String,String & String> <- wait_running(child,sample_state,2)
        +canceled : U32 <- IO.try(U32,P.HostPosix.pending_signal())
        restored : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.restore_signals()
        finish_wait(result,attempt,canceled)

def run_spawned(result: Result<&1,&1,U32 & String,U32 & (U32 & U32)>, +attempt: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  match result:
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        restored : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.restore_signals()
        IO.pure(Result<&1,&1,U32 & String,U32 & String>,Fail{error})
    case Done{(+child,(+gate,+status))}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        +start : String <- IO.try(String,P.HostPosix.starttime(child))
        watcher : Result<&1,&1,U32 & String,U32> <- watch_command(attempt,child,start)
        match watcher:
          case Done{pid}:
            do IO<Result<&1,&1,U32 & String,U32 & String>>:
              started : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.start(gate,status)
              run_started(started,child,attempt)
          case Fail{error}:
            do IO<Result<&1,&1,U32 & String,U32 & String>>:
              closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(gate)
              closed_status : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(status)
              run_started(Fail{error},child,attempt)

def run( +argv: String, +cwd: String, +stdout: String, +stderr: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  do IO<Result<&1,&1,U32 & String,U32 & String>>:
    handling : Unit <- IO.try(Unit,P.HostPosix.watch_signals())
    result : Result<&1,&1,U32 & String,U32 & (U32 & U32)> <- P.HostPosix.spawn_held(argv,cwd,stdout,stderr)
    run_spawned(result,S.dirname(stdout))
