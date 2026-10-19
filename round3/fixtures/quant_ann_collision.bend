# two closed arms that differ only in quantity/annotation and let shape,
# both under a literal prefix so each is duplicated at every character
# column. Reuse is legal only when Lam.q, Let.q and Ann.T agree; the
# expected outputs change if the arms are confused.
import Base

law route:
  for xs: List<String>
  U32

def route(xs):
  match xs:
    case "--host-process-keeper" <> +a <> +b <> Nil{}:
      n : U32 = 2
      U32.add(n, 1)
    case +a <> +b <> Nil{}:
      m : U32 = 4
      (U32.add(m, 3) : U32)
    case other:
      9

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(U32.show(route(args)))
