import Base
import ./dep.bend as D
import ./dep.bend as E

def use(x: U32) -> U32:
  D.twice(E.twice(x))
