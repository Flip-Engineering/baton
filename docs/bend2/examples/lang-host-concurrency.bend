# CLAIM: Bend2's parallelism is a binary fork-join call written as two calls in one statement
# (`a b = f(x) f(y)`; four calls is the burst form of the same statement), the CPU runtime
# spreads such calls over the cores given to `--threads`, and `IO.fork`/`IO.join` runs
# computations concurrently on the program's one event loop. On this host, with a load average
# of 10.5 from the other lanes, the balanced tree below takes a median 1.736 s at `--threads 1`
# and 0.330 s at `--threads 10` (5.3x) and prints the same value in both runs; the JavaScript
# target runs the same program sequentially.
#
# Evidence: lang-host-concurrency.evidence.md (exact commands and observed output).

import Base

# leaf(n, i) is a chain of n dependent multiply-adds on i; it is the unit of work.
law leaf:
  for +n: Nat
  for i: U32
  U32

def leaf(n, i):
  match n:
    case 0n:
      i
    case 1n+p:
      leaf(p, U32.add(U32.mul(i, 1664525), 1013904223))

# tree(d, n) is a balanced binary tree of 2^d leaves. The parallel call is the one
# statement `a b = tree(p, n) tree(p, n)`: the two calls are independent and of equal size.
law tree:
  for +d: Nat
  for +n: Nat
  U32

def tree(d, n):
  match d:
    case 0n:
      leaf(n, 1)
    case 1n+p:
      a b = tree(p, n) tree(p, n)
      U32.add(a, b)

# Four independent calls in one statement: the burst form of the parallel call.
law burst:
  for +n: Nat
  U32

def burst(n):
  a b c d = leaf(n, 1) leaf(n, 2) leaf(n, 3) leaf(n, 4)
  U32.add(U32.add(a, b), U32.add(c, d))

# One concurrent computation: fork it, let it sleep, join its channel.
law worker:
  for +id: U32
  IO(String)

def worker(id):
  do IO<String>:
    IO.sleep(20)
    return "worker " ++ U32.show(id) ++ " joined"

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    IO.print("tree(14, 50000) = " ++ U32.show(tree(14n, 50000n)))
    IO.print("burst(50000)    = " ++ U32.show(burst(50000n)))
    one : Chan(String) <- IO.fork(String, worker(1))
    two : Chan(String) <- IO.fork(String, worker(2))
    a : String <- IO.join(String, one)
    b : String <- IO.join(String, two)
    IO.print(a)
    IO.print(b)
