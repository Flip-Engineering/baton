import Base
import ./choice.bend as Choice
import ./compile-queue-state.bend as S
import ./posix.bend as P

def nul() -> String:
  Char.show(Char.from_u32(0))

def watch_command(+attempt: String, +child: U32, +start: String, +supervisor: U32, +supervisor_start: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    +self : String <- IO.try(String,P.HostPosix.self_exe())
    +args : String <- IO.pure(String,self ++ nul() ++ "--" ++ nul() ++ "__watch-heavy" ++ nul() ++ attempt ++ nul() ++ U32.show(child) ++ nul() ++ start ++ nul() ++ U32.show(supervisor) ++ nul() ++ supervisor_start ++ nul())
    P.HostPosix.spawn_detached(args,9,8,"")

@unsafe
def wait_running_match_2(~again_wait_running: (@+attempt: String -> @+child: U32 -> @+start: String -> @+delay: U32 -> IO(Result<&1,&1,U32 & String,String>)), +attempt: String, +child: U32, +start: String, +delay: U32, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+status}:
      Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(S.field(status,"running"),"1"),
        do IO<Result<&1,&1,U32 & String,String>>:
          slept : Unit <- IO.sleep(delay)
          again_wait_running(attempt,child,start,U32.min(U32.mul(delay,2),128)),
        IO.pure(Result<&1,&1,U32 & String,String>,Done{status}))

@unsafe
def wait_running(+attempt: String, +child: U32, +start: String, +delay: U32) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- P.HostPosix.try_wait(attempt,child,start)
    wait_running_match_2(wait_running,attempt,child,start,delay,result)

def disposition(+status: String, +canceled: U32) -> U32 & String:
  +signal = S.number(S.field(status,"signal"))
  Choice.choose(U32 & String,U32.is_gt(canceled,0), _choice_unit => (130,"canceled"), _choice_unit =>
    Choice.choose(U32 & String,U32.is_gt(signal,0), _choice_unit => (U32.add(128,signal),"signal"), _choice_unit => (S.number(S.field(status,"exit")),"exit")))

def finish_wait(result: Result<&1,&1,U32 & String,String>, +canceled: U32) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,U32 & String>,Fail{error})
    case Done{+status}: IO.pure(Result<&1,&1,U32 & String,U32 & String>,Done{disposition(status,canceled)})

# A termination signal that reached the supervisor while the command was being
# started is a cancellation, whatever the start reported: the cancel command signals
# the process group of the supervisor, and the held child, which has not executed
# yet, is in it. Its death before the release byte makes the start fail. A start
# that fails with no signal recorded is a spawn failure and keeps its own error.
def run_started(started: Result<&1,&1,U32 & String,Unit>, +child: U32, +attempt: String, +start: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  match started:
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        waited : Result<&1,&1,U32 & String,U32> <- P.HostPosix.wait_pid(child)
        +canceled : U32 <- IO.try(U32,P.HostPosix.pending_signal())
        restored : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.restore_signals()
        Bool.pick(IO(Result<&1,&1,U32 & String,U32 & String>),U32.is_gt(canceled,0),
          IO.pure(Result<&1,&1,U32 & String,U32 & String>,Done{(130,"canceled")}),
          IO.pure(Result<&1,&1,U32 & String,U32 & String>,Fail{error}))
    case Done{unit}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        result : Result<&1,&1,U32 & String,String> <- wait_running(attempt,child,start,2)
        +canceled : U32 <- IO.try(U32,P.HostPosix.pending_signal())
        restored : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.restore_signals()
        finish_wait(result,canceled)

def run_spawned_match_1(+child: U32, +gate: U32, +status: U32, +attempt: String, +start: String, watcher: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  match watcher:
    case Done{pid}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        started : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.start(gate,status)
        run_started(started,child,attempt,start)
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(gate)
        closed_status : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(status)
        run_started(Fail{error},child,attempt,start)

def run_spawned(result: Result<&1,&1,U32 & String,String>, +attempt: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  match result:
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        restored : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.restore_signals()
        IO.pure(Result<&1,&1,U32 & String,U32 & String>,Fail{error})
    case Done{+handles}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        +child : U32 <- IO.pure(U32,S.number(S.field(handles,"pid")))
        gate : U32 <- IO.pure(U32,S.number(S.field(handles,"gate")))
        status : U32 <- IO.pure(U32,S.number(S.field(handles,"status")))
        +start : String <- IO.try(String,P.HostPosix.starttime(child))
        +supervisor : U32 <- IO.try(U32,P.HostPosix.pid())
        +supervisor_start : String <- IO.try(String,P.HostPosix.starttime(supervisor))
        watcher : Result<&1,&1,U32 & String,U32> <- watch_command(attempt,child,start,supervisor,supervisor_start)
        run_spawned_match_1(child,gate,status,attempt,start,watcher)

def run(+argv: String, +cwd: String, +stdout: String, +stderr: String, +attempt: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  do IO<Result<&1,&1,U32 & String,U32 & String>>:
    handling : Unit <- IO.try(Unit,P.HostPosix.watch_signals())
    result : Result<&1,&1,U32 & String,String> <- P.HostPosix.spawn_held(argv,cwd,stdout,stderr)
    run_spawned(result,attempt)
