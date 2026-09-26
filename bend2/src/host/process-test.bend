# Test: process spawn, stdin write, stdout read, wait.
#
# Spawns /bin/sh -c 'read line; echo "got: $line"', writes a line to stdin,
# closes stdin, reads the echoed output, and waits for exit status 0.

import Base
import ./process.bend as P

def main() -> IO(Unit):
  do IO<Unit>:
    +handle : U32 <- P.ProcessChild.spawn("/bin/sh", "-c\nread line; echo got: $line", "")
    u1 : Unit <- IO.print("RESULT|spawned|handle=" ++ U32.show(handle))
    u2 : Unit <- P.ProcessChild.write(handle, "hello from bend2\n")
    u3 : Unit <- P.ProcessChild.close_stdin(handle)
    line : String <- P.ProcessChild.read_line(handle)
    u4 : Unit <- IO.print("RESULT|read-line|" ++ line)
    exit_code : U32 <- P.ProcessChild.wait(handle)
    IO.print("RESULT|exited|" ++ U32.show(exit_code))
