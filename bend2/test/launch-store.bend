# Focused fixture for the OMP and Muse configured store binding (#933). It
# drives the production argv composition, the final-argv preflight and the
# child environment. No provider or credential is contacted.
import Base
import ../src/host/process.bend as P
import ../src/coordinator/subscription-fallback.bend as Subs
import ../src/harness/omp-player.bend as Omp
import ../src/harness/muse-player.bend as Muse
import ../src/git/text.bend as Tx

def print_arg_list(+label: String, xs: List<String>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> rest: do IO<Unit>:
      IO.print(label ++ "\t" ++ head)
      print_arg_list(label,rest)

def binding(harness: String, +store: String) -> List<String>:
  Bool.pick(List<String>,String.is_empty(store),Nil{},Subs.store_binding(harness,store))

def print_argv(argv: String) -> IO(Unit):
  print_arg_list("arg",Tx.split_nul(argv))

def argv_mode(mode: String, store: String) -> IO(Unit):
  match mode:
    case "omp-fresh": print_argv(Omp.argv_profile(binding("omp",store),"/usr/bin/omp","deepseek/deepseek-flash","max","/fixture/sessions","",True{}))
    case "omp-resume": print_argv(Omp.argv_profile(binding("omp",store),"/usr/bin/omp","deepseek/deepseek-flash","max","/fixture/sessions","native-fixture",False{}))
    case "omp-plain": print_argv(Omp.argv("/usr/bin/omp","deepseek/deepseek-flash","max","/fixture/sessions","",True{}))
    case "muse-fresh": print_argv(Muse.argv_profile(binding("muse",store),"/usr/bin/muse","muse-wonder-1.0","high","/fixture/prompt.txt","",True{}))
    case "muse-resume": print_argv(Muse.argv_profile(binding("muse",store),"/usr/bin/muse","muse-wonder-1.0","high","/fixture/prompt.txt","native-fixture",False{}))
    case "muse-plain": print_argv(Muse.argv_profile(Nil{},"/usr/bin/muse","muse-wonder-1.0","high","/fixture/prompt.txt","",True{}))
    case other: IO.die(Unit,2,"unknown argv mode")

def verdict(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{made}: IO.print("preflight-ok")
    case Fail{(code,detail)}: IO.print("preflight-refused")

def preflight(store: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Unit> <- Omp.preflight_arguments(Omp.argv_profile(Subs.store_binding("omp",store),"/usr/bin/omp","deepseek/deepseek-flash","max","/fixture/sessions","",True{}))
    verdict(result)

def awaited(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{(code,detail)}: IO.die(Unit,2,"wait failed: " ++ U32.show(code) ++ ": " ++ detail)
    case Done{status}: IO.print("spawn\t" ++ status)

def spawned(result: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match result:
    case Fail{(code,detail)}: IO.die(Unit,2,"spawn failed: " ++ U32.show(code) ++ ": " ++ detail)
    case Done{handle}: do IO<Unit>:
      waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
      awaited(waited)

def start(harness: String, selected: List<String>, cmd: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match harness:
    case "omp": Omp.start_player_profile(selected,cmd,"deepseek/deepseek-flash","max",".","/fixture/sessions","",fresh,"/dev/null")
    case "muse": Muse.start_player_profile(selected,cmd,"muse-wonder-1.0","high",".","/dev/null","/dev/null","",fresh)
    case other: IO.die(Result<&1,&1,U32 & String,U32>,2,"unknown harness")

def spawn(+harness: String, cmd: String, store: String, fresh: Bool) -> IO(Unit):
  do IO<Unit>:
    selected : List<String> <- IO.pure(List<String>,binding(harness,store))
    result : Result<&1,&1,U32 & String,U32> <- start(harness,selected,cmd,fresh)
    spawned(result)

def run(args: List<String>) -> IO(Unit):
  match args:
    case "preflight" <> store <> Nil{}: preflight(store)
    case "spawn" <> harness <> cmd <> store <> fresh <> Nil{}: spawn(harness,cmd,store,String.eq(fresh,"fresh"))
    case mode <> store <> Nil{}: argv_mode(mode,store)
    case other: IO.die(Unit,2,"usage: launch-store MODE STORE | preflight STORE | spawn HARNESS CMD STORE fresh|resume")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
