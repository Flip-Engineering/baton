# CLAIM: a host effect Base does not ship is a def whose body is two imports, one `.c` and one
# `.js`; a program that adds its own process-spawn effect type-checks, runs natively, runs under
# bun and runs through the interpreter. The effect answers the command's whole standard output
# and reports its exit status as a failure code. It blocks the program's one event loop for the
# life of the command, and it exposes no process handle, no streaming read, no signal and no
# cancellation. Base ships no process spawn of its own.

import Base

# `HostProc.exec(cmd)` starts `sh -c cmd` with popen, waits for it to finish, and answers its
# standard output, or Fail with its exit status. The host function is this def's name lowercased
# with dots as underscores: `hostproc_exec`. The command list, the process handle, its streams
# and its signals are outside what this effect carries.
def HostProc.exec(cmd: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./lang-host-foreign-exec.c"
  import "./lang-host-foreign-exec.js"

law report:
  for r: Result<&1, &1, (U32 & String), String>
  IO(Unit)

def report(r):
  match r:
    case Done{value}:
      IO.print("host process said: " ++ value)
    case Fail{error}:
      (code, message) = error
      IO.print("host process failed with status " ++ U32.show(code))

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    ok  : Result<&1, &1, (U32 & String), String> <- HostProc.exec("echo bend-foreign-exec")
    a   : Unit <- report(ok)
    bad : Result<&1, &1, (U32 & String), String> <- HostProc.exec("exit 3")
    report(bad)
