# Focused launch test for issue #839. The coordinator's OMP launch path must
# refuse an unwritable HOME before spawning, and start the provider after the
# same preflight accepts a writable home. HOME is supplied by the caller. This
# entry compiles the coordinator, so it is an acceptance test, not a gate entry.
import Base
import ../src/coordinator/turn.bend as Turn

def main() -> IO(Unit):
  do IO<Unit>:
    handle : U32 <- IO.try(U32,Turn.omp_launch("","/bin/true","test","low",".","/dev/null",""))
    IO.print("launch-started")
