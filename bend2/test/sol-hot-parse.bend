import Base
import ../src/coordinator/commands.bend as C

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(C.sql(C.parse(args)))
