# quantity and annotation carriers under a literal prefix: the flattener
# duplicates the 2-token fallback row at every character column. The arms
# are closed (no free probes) and keep a + pattern binder, a typed let and
# an annotated result, so Lam.q/Let.q/Ann.T are compared before reuse.
import Base

law pick:
  for xs: List<String>
  U32

def pick(xs):
  match xs:
    case "--host-process-keeper" <> +a <> +b <> Nil{}:
      n : U32 = 1
      (U32.add(n, 1) : U32)
    case +a <> +b <> Nil{}:
      m : U32 = 5
      (U32.add(m, 2) : U32)
    case other:
      9

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(U32.show(pick(args)))
