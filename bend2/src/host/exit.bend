import Base

# Halts the process with this exit code and writes nothing: no message,
# no newline, no diagnostic. The driver paths whose stderr is a delivery
# contract halt through this effect; IO.die always emits its message plus
# one line feed and cannot produce an empty stream. This call never
# returns.
def Host.exit(code: U32) -> IO(Unit):
  import "./exit.c"
  import "./exit.js"
