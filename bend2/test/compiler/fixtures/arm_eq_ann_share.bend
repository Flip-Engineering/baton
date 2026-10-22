# A literal prefix, a 2-token fallback and a catch-all. The flattener
# duplicates the fallback row at every character column, so emit_arm_shared
# receives closed copies of one row with the same hint. base arm_eq ignores
# Ann.T and shares a copy after the annotation type changes; a total equality
# emits a separate spin.
import Base

@unsafe
def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case "--host-process-keeper" <> +a <> +b <> Nil{}:
      IO.write("host")
    case +a <> +b <> Nil{}:
      IO.write("two")
    case other:
      IO.write("other")

@unsafe
def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
