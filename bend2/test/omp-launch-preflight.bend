# Focused launch test for issue #839. The coordinator's OMP launch path must
# refuse an unwritable HOME (including the root home for the service account)
# before spawning, and start the provider after the same preflight accepts a
# writable home. HOME is supplied by the caller. This entry compiles the
# coordinator, so it is an acceptance test rather than a gate entry.
import Base
import ../src/coordinator/turn.bend as Turn

def print_result(result: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match result:
    case Done{handle}: IO.print("launch-started")
    case Fail{(code,detail)}: do IO<Unit>:
      printed : Unit <- IO.print(detail)
      IO.die(Unit,code,"launch-refused")

def main() -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,U32> <- Turn.omp_launch("","/bin/true","test","low",".","/dev/null","")
    print_result(result)
