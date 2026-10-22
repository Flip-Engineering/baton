# control: same runtime surface, no literal dispatch
import Base

law pick:
  for s: String
  U32

def pick(s):
  0

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    xs : List<String> <- IO.args()
    IO.print(U32.show(pick("x")))
