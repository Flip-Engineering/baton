# focused literal-dispatch fixture (#776/#900): a 21-character string
# literal element in a List<String> case, with 2/13/4-element sibling
# cases. Leaves are pure U32 stubs.
import Base

law dispatch:
  for args: List<String>
  U32

def dispatch(args):
  match args:
    case "--host-process-keeper" <> +directory <> +lock <> Nil{}:
      1
    case +flag <> +db <> Nil{}:
      2
    case +flag <> +db <> +session <> +id <> +cursor <> +cmd <> +model
      <> +effort <> +cwd <> +log <> +harness <> +directory <> +native <> Nil{}:
      13
    case +first <> +second <> +session <> +observer <> Nil{}:
      4
    case _:
      0

def main() -> U32:
  dispatch(["--host-process-keeper", "a", "b"])
