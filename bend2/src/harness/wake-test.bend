# Test: wake frame construction and socket delivery.
#
# When run without arguments, prints a wake frame for a test session.
# When run with a PID argument, delivers the frame to that PID's socket.

import Base
import ./wake.bend as W

def head_or(xs: List<String>, fallback: String) -> String:
  match xs:
    case Nil{}: fallback
    case h <> t: h

def tail_of_list(xs: List<String>) -> List<String>:
  match xs:
    case Nil{}: Nil{}
    case h <> t: t

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    u1 : Unit <- IO.print("RESULT|wake-frame-check|" ++ W.wake_frame("test-sid", "bend2", "test-mid", "hello"))
    u2 : Unit <- IO.print("RESULT|socket-path|" ++ W.socket_path(12345))
    IO.print("RESULT|wake-test-done")
