# Focused preflight test for issue #839. It calls the same check the OMP
# player uses before spawning a provider client.
#
# usage: omp-home-preflight HOME
import Base
import ../src/harness/omp-player.bend as Omp

def print_result(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{made}: IO.print("preflight-ok")
    case Fail{(code,detail)}: do IO<Unit>:
      printed : Unit <- IO.print(detail)
      IO.die(Unit,code,"preflight-refused")

def arg_home(m: Maybe<&1,String>) -> String:
  match m:
    case None{}: ""
    case Some{v}: v

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    home : String = arg_home(List.head(&1,String,args))
    result : Result<&1,&1,U32 & String,Unit> <- Omp.preflight_at(home)
    print_result(result)
