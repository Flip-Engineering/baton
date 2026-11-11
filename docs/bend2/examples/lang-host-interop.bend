# CLAIM: at this pin Base ships host effects for the filesystem, TCP sockets, UDP sockets and
# the environment, and a program that uses all four type-checks, runs, builds natively and builds
# JavaScript. Base ships no OS process spawn and no JSON: `bend base exec` and `bend base Json`
# both refuse, and the upstream tree has no name for either.
#
# Evidence: lang-host-interop.evidence.md (exact commands and observed output).

import Base

# A handle is affine, so every effect on one hands it back beside its result and each pair
# destructures in its own helper. The path is relative and resolves against the working
# directory, so the program runs from the worktree root.

law file_read_go:
  for m: File & Result<&1, &1, (U32 & String), String>
  IO(Unit)

def file_read_go(m):
  (f, r) = m
  do IO<Unit>:
    data : String <- IO.pass(String, r)
    w    : Unit <- IO.print("file readback: " ++ data)
    File.close(f)

law file_write_go:
  for w: File & Result<&1, &1, (U32 & String), Unit>
  for path: String
  IO(Unit)

def file_write_go(w, path):
  (f, r) = w
  do IO<Unit>:
    u  : Unit <- IO.pass(Unit, r)
    c  : Unit <- File.close(f)
    f2 : File <- IO.try(File, File.open(path, "r"))
    m  : File & Result<&1, &1, (U32 & String), String> <- File.read(f2, 64)
    file_read_go(m)

law file_demo:
  IO(Unit)

def file_demo():
  do IO<Unit>:
    f : File <- IO.try(File, File.open("node_modules/.bend/scratch-host/interop.tmp", "w"))
    w : File & Result<&1, &1, (U32 & String), Unit> <- File.write(f, "bend-host-interop")
    file_write_go(w, "node_modules/.bend/scratch-host/interop.tmp")

law tcp_recv_go:
  for l: Listener
  for c: Socket
  for m: Socket & Result<&1, &1, (U32 & String), String>
  IO(Unit)

def tcp_recv_go(l, c, m):
  (a, r) = m
  do IO<Unit>:
    data : String <- IO.pass(String, r)
    w    : Unit <- IO.print("tcp loopback: " ++ data)
    x    : Unit <- Socket.close(c)
    y    : Unit <- Socket.close(a)
    Listener.close(l)

law tcp_send_go:
  for a: Socket
  for l: Listener
  for m: Socket & Result<&1, &1, (U32 & String), Unit>
  IO(Unit)

def tcp_send_go(a, l, m):
  (c, r) = m
  do IO<Unit>:
    u  : Unit <- IO.pass(Unit, r)
    rm : Socket & Result<&1, &1, (U32 & String), String> <- TCP.recv(a, 64)
    tcp_recv_go(l, c, rm)

law tcp_accept_go:
  for c: Socket
  for p: Listener & Result<&1, &1, (U32 & String), Socket>
  IO(Unit)

def tcp_accept_go(c, p):
  (l, ar) = p
  do IO<Unit>:
    a  : Socket <- IO.pass(Socket, ar)
    sm : Socket & Result<&1, &1, (U32 & String), Unit> <- TCP.send(c, "bend-tcp")
    tcp_send_go(a, l, sm)

law tcp_demo:
  IO(Unit)

def tcp_demo():
  do IO<Unit>:
    l : Listener <- IO.try(Listener, TCP.listen(45881))
    c : Socket <- IO.try(Socket, TCP.connect("127.0.0.1", 45881))
    p : Listener & Result<&1, &1, (U32 & String), Socket> <- TCP.accept(l)
    tcp_accept_go(c, p)

law udp_send_go:
  for m: Socket & Result<&1, &1, (U32 & String), Unit>
  IO(Socket)

def udp_send_go(m):
  (s, r) = m
  do IO<Socket>:
    u : Unit <- IO.pass(Unit, r)
    return s

law udp_print_go:
  for s: Socket
  for p: String & U32 & String
  IO(Unit)

def udp_print_go(s, p):
  (host, from, data) = p
  do IO<Unit>:
    w : Unit <- IO.print("udp loopback: " ++ data)
    Socket.close(s)

law udp_recv_go:
  for m: Socket & Result<&1, &1, (U32 & String), String & U32 & String>
  IO(Unit)

def udp_recv_go(m):
  (s, r) = m
  do IO<Unit>:
    p : String & U32 & String <- IO.pass(String & U32 & String, r)
    udp_print_go(s, p)

law udp_demo:
  IO(Unit)

def udp_demo():
  do IO<Unit>:
    s  : Socket <- IO.try(Socket, UDP.bind(45882))
    sm : Socket & Result<&1, &1, (U32 & String), Unit> <- UDP.send_to(s, "127.0.0.1", 45882, "bend-udp")
    s2 : Socket <- udp_send_go(sm)
    rm : Socket & Result<&1, &1, (U32 & String), String & U32 & String> <- UDP.recv_from(s2, 64)
    udp_recv_go(rm)

law report:
  for tag : String
  for r   : Result<&1, &1, (U32 & String), String>
  IO(Unit)

def report(tag, r):
  match r:
    case Done{value}:
      IO.print(String.append(tag, "=set"))
    case Fail{error}:
      (code, message) = error
      IO.print(String.append(tag, "=unset"))

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    xs : List<String> <- IO.args()
    a  : Unit <- IO.print("args: " ++ Nat.show(List.length(&1, String, xs)))
    h  : Result<&1, &1, (U32 & String), String> <- IO.get_env("HOME")
    b  : Unit <- report("HOME", h)
    g  : Result<&1, &1, (U32 & String), String> <- IO.get_env("BEND_HOST_NO_SUCH_VAR")
    c  : Unit <- report("BEND_HOST_NO_SUCH_VAR", g)
    d  : Unit <- file_demo()
    e  : Unit <- tcp_demo()
    udp_demo()
