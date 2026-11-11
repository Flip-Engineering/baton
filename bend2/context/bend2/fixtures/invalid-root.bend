import Base
import ./invalid.bend as Bad

def use(x: U32) -> U32:
  Bad.broken(x)
