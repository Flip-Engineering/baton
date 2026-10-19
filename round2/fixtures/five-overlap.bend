# five PR890 shapes in one match: literal 21-character host-keeper, then
# 2-, 13-, 14- and 4-token all-variable shapes, then the final error.
import Base

@unsafe
def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case "--host-process-keeper" <> +a <> +b <> Nil{}:
      IO.write("host")
    case +a <> +b <> Nil{}:
      IO.write("two")
    case +a <> +b <> +c <> +d <> +e <> +f <> +g <> +h <> +i <> +j <> +k <> +l <> +m <> Nil{}:
      IO.write("13")
    case +a <> +b <> +c <> +d <> +e <> +f <> +g <> +h <> +i <> +j <> +k <> +l <> +m <> +n <> Nil{}:
      IO.write("14")
    case +a <> +b <> +c <> +d <> Nil{}:
      IO.write("four")
    case other:
      IO.die(Unit,2,"other")

@unsafe
def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
