# Focused retained-launch test for issue #839. Retained receive prepares the
# provider argv before admission; an unwritable HOME must stop that preparation
# before it reads the database or writes attempt files.
import Base
import ../src/coordinator/turn.bend as Turn

def print_result(result: Result<&1,&1,U32 & String,Turn.RetainedLaunch>) -> IO(Unit):
  match result:
    case Done{launch}: IO.die(Unit,1,"retained preflight did not refuse")
    case Fail{(code,detail)}: do IO<Unit>:
      printed : Unit <- IO.print(detail)
      IO.die(Unit,code,"retained-preflight-refused")

def main() -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Turn.RetainedLaunch> <- Turn.retained_prepare("/tmp/baton-preflight-missing.db","player","/tmp/baton-preflight-missing-dir","/bin/true","test","low","","omp\n","","prompt","default",True{},"")
    print_result(result)
