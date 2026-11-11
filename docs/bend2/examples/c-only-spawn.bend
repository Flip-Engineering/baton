# CLAIM: an effect whose only host half is a C file type-checks and builds a native binary that
# runs without any JavaScript; the interpreter lane needs the JavaScript half, the native build
# does not.
#
# Evidence: c-only-spawn.evidence.md.

import Base

def HostEcho.run(cmd: String) -> IO(String):
  import "./c-only-spawn-exec.c"

def main() -> IO(Unit):
  do IO<Unit>:
    text : String <- HostEcho.run("echo c-only-effect")
    IO.print(text)
