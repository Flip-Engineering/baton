import Base

@unsafe
def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case "--host-process-keeper" <> +directory <> +lock <> Nil{}:
      IO.write("host")
    case +flag <> +db <> Nil{}:
      IO.write("two")
    case +flag <> +db <> +session <> +id <> +cursor <> +cmd <> +model <> +effort <> +cwd <> +log <> +harness <> +directory <> +native <> Nil{}:
      IO.write("13")
    case +flag <> +db <> +session <> +id <> +cursor <> +cmd <> +model <> +effort <> +cwd <> +log <> +harness <> +directory <> +native <> +inputs <> Nil{}:
      IO.write("14")
    case +first <> +second <> +session <> +observer <> Nil{}:
      IO.write("4")
    case other:
      IO.die(Unit,2,"other")

@unsafe
def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
