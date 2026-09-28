import Base
import ./laws.bend as Laws
import ./startup.bend as Startup

def main() -> IO(Unit):
  IO.print(Startup.explain(Startup.start()))
