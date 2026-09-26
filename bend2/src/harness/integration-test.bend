# Integration test: spawn a simulated worker, read its result, deliver a wake.
#
# Uses /bin/sh as the worker process (not a real Claude session) to prove the
# end-to-end pipeline: spawn -> write stdin -> read result line -> socket wake.
# The simulated worker prints a {"type":"result"...} JSON line after reading
# its prompt.

import Base
import ../host/process.bend as P
import ./wake.bend as W

def main() -> IO(Unit):
  do IO<Unit>:
    # Spawn a shell that simulates a stream-json worker: reads stdin, then
    # writes one system init line and one result line.
    +handle : U32 <- P.ProcessChild.spawn("/bin/sh", "-c\nread prompt; echo '{\"type\":\"system\",\"subtype\":\"init\",\"sessionId\":\"test-session-abc\"}'; echo '{\"type\":\"result\",\"result\":\"turn completed\",\"sessionId\":\"test-session-abc\"}'", "")
    u1 : Unit <- IO.print("RESULT|worker-spawned|handle=" ++ U32.show(handle))

    # Send a prompt to the worker.
    u2 : Unit <- P.ProcessChild.write(handle, "hello worker\n")
    u3 : Unit <- P.ProcessChild.close_stdin(handle)

    # Read until we get the result line.
    +result_line : String <- P.ProcessChild.read_until_result(handle)
    u4 : Unit <- IO.print("RESULT|turn-result|" ++ result_line)

    # Wait for the worker to exit.
    exit_code : U32 <- P.ProcessChild.wait(handle)
    u5 : Unit <- IO.print("RESULT|worker-exited|" ++ U32.show(exit_code))

    # Show the wake frame that would be delivered.
    u6 : Unit <- IO.print("RESULT|wake-frame|" ++ W.wake_frame("test-session-abc", "bend2-harness", "msg-001", result_line))

    IO.print("RESULT|integration-test-done")
