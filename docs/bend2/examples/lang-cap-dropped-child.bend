# CLAIM: dropping the Chan returned by IO.fork does not cancel or join the
# computation. The parent returns first, the child continues after its sleep,
# and the program waits until the child completes.
#
# Evidence: lang-cap-dropped-child.evidence.md.

import Base

def child() -> IO(Unit):
  do IO<Unit>:
    slept : Unit <- IO.sleep(25)
    printed : Unit <- IO.print("child continued")
    return Unit{}

def main() -> IO(Unit):
  do IO<Unit>:
    pending : Chan(Unit) <- IO.fork(Unit, child())
    printed : Unit <- IO.print("parent returned without joining")
    return Unit{}
