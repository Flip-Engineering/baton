import Base
import ./choice.bend as Choice
import ./compile-queue-state.bend as S
import ../host/files.bend as F
import ./posix.bend as P

def nul() -> String:
  Char.show(Char.from_u32(0))

def watch_command(+attempt: String, +child: U32, +start: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    +self : String <- IO.try(String,P.HostPosix.self_exe())
    +args : String <- IO.pure(String,self ++ nul() ++ "--" ++ nul() ++ "__watch-heavy" ++ nul() ++ attempt ++ nul() ++ U32.show(child) ++ nul() ++ start ++ nul())
    P.HostPosix.spawn_detached(args,9,8,"")

# The native wait owner publishes the terminal exit_status the moment waitpid
# collects the expected child: attempt identity, normalized exit code and
# signal. Written to a temporary name and renamed so the watcher never sees a
# partial marker; a failed write leaves no marker and must not trigger the
# watcher release.
@unsafe
def publish_collected(+attempt: String, +child: U32, +status: String) -> IO(Unit):
  do IO<Unit>:
    +temporary : String <- IO.pure(String,attempt ++ "/exit_status.tmp")
    +marker : String <- IO.pure(String,attempt ++ "/exit_status")
    +text : String <- IO.pure(String,"child=" ++ U32.show(child) ++ "\nexit=" ++ S.field(status,"exit") ++ "\nsignal=" ++ S.field(status,"signal") ++ "\n")
    wrote : Unit <- IO.try(Unit,F.Files.write_shared(temporary,text))
    renamed : Unit <- IO.try(Unit,F.Files.rename(temporary,marker))
    IO.pure(Unit, Unit{})

@unsafe
def wait_running_match_2(~again_wait_running: (@+attempt: String -> @+child: U32 -> @+delay: U32 -> IO(Result<&1,&1,U32 & String,String>)), +attempt: String, +child: U32, +delay: U32, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+status}:
      Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(S.field(status,"running"),"1"),
        do IO<Result<&1,&1,U32 & String,String>>:
          slept : Unit <- IO.sleep(delay)
          again_wait_running(attempt,child,U32.min(U32.mul(delay,2),128)),
        do IO<Result<&1,&1,U32 & String,String>>:
          published : Unit <- publish_collected(attempt,child,status)
          IO.pure(Result<&1,&1,U32 & String,String>,Done{status}))

@unsafe
def wait_running(+attempt: String, +child: U32, +delay: U32) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- P.HostPosix.try_wait(child)
    wait_running_match_2(wait_running,attempt,child,delay,result)

def disposition(+status: String, +canceled: U32) -> U32 & String:
  +signal = S.number(S.field(status,"signal"))
  Choice.choose(U32 & String,U32.is_gt(canceled,0), _choice_unit => (130,"canceled"), _choice_unit =>
    Choice.choose(U32 & String,U32.is_gt(signal,0), _choice_unit => (U32.add(128,signal),"signal"), _choice_unit => (S.number(S.field(status,"exit")),"exit")))

def finish_wait(result: Result<&1,&1,U32 & String,String>, +canceled: U32) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,U32 & String>,Fail{error})
    case Done{+status}: IO.pure(Result<&1,&1,U32 & String,U32 & String>,Done{disposition(status,canceled)})

def run_started(+attempt: String, started: Result<&1,&1,U32 & String,Unit>, +child: U32) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  match started:
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        waited : Result<&1,&1,U32 & String,U32> <- P.HostPosix.wait_pid(child)
        restored : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.restore_signals()
        IO.pure(Result<&1,&1,U32 & String,U32 & String>,Fail{error})
    case Done{unit}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        result : Result<&1,&1,U32 & String,String> <- wait_running(attempt,child,2)
        +canceled : U32 <- IO.try(U32,P.HostPosix.pending_signal())
        restored : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.restore_signals()
        finish_wait(result,canceled)

def run_spawned_match_1(+attempt: String, +child: U32, +gate: U32, +status: U32, watcher: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  match watcher:
    case Done{pid}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        started : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.start(gate,status)
        run_started(attempt,started,child)
    case Fail{error}:
      do IO<Result<&1,&1,U32 & String,U32 & String>>:
        closed : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(gate)
        closed_status : Result<&1,&1,U32 & String,Unit> <- P.HostPosix.close_fd(status)
        run_started(attempt,Fail{error},child)

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
        watcher : Result<&1,&1,U32 & String,U32> <- watch_command(attempt,child,start)
        run_spawned_match_1(attempt,child,gate,status,watcher)

def run(+argv: String, +cwd: String, +stdout: String, +stderr: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  do IO<Result<&1,&1,U32 & String,U32 & String>>:
    handling : Unit <- IO.try(Unit,P.HostPosix.watch_signals())
    result : Result<&1,&1,U32 & String,String> <- P.HostPosix.spawn_held(argv,cwd,stdout,stderr)
    run_spawned(result,S.dirname(stdout))
